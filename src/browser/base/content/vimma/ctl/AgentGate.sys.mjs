/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The agent role's gate (docs/specs/vimma-mcp.md, decisions 12-22): every agent request but
// hello and ping waits here for the user's answer, or runs under a grant of its connection and
// tool. Core's AgentQueue holds the rules (the queue and its caps, the mute, the grants); this
// adds the clock: the ask timeout (50 s, `[mcp] ask_timeout`) and the grants' expiry. One per
// app, in memory only: nothing here is written to disk (decision 22), and a restart ends it all.
//
// The question itself (ui/agent-prompt.mjs, the status bar's `◇ agent 1?`, `ctrl+b shift+a`) is
// sub-PR 2b. It watches the gate through `addListener` and answers through `answer`; until then a
// request that is not under a grant waits for its timeout and is denied.

import { AgentQueue, grantLength } from "../core/agent.mjs";
import { McpHost } from "../host/mcp-ops.mjs";

/** @import { Answer, ConnId } from "../core/agent.mjs" */

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

/** Test-only: the ask timeout in ms, in place of `[mcp] ask_timeout`. */
const ASK_TIMEOUT_PREF = "vimma.mcp.askTimeoutMs";
const DEFAULT_ASK_TIMEOUT_S = 50;
const DEFAULT_GRANT = { grantMinutes: 10, grantMaxMinutes: 480 };

/**
 * @typedef {{ allow: true, grant?: { until: number } }
 *   | { allow: false, reason: "user" | "timeout" | "busy" | "muted" | "cancelled" }} Outcome
 * @typedef {{ client: string, version?: string, via?: string, since: number }} AgentLabel
 * @typedef {{ id: number, conn: ConnId, tool: string, what: object, label: AgentLabel,
 *   asked: number, deadline: number }} Question
 */

const queue = new AgentQueue();
/** Agent connections after their hello: what the question and `:mcp` call them. */
/** @type {Map<ConnId, AgentLabel>} */
const labels = new Map();
/** Waiting requests: what is asked, and how to answer the agent. */
/** @type {Map<number, Question & { resolve: (o: Outcome) => void, timer: any }>} */
const pending = new Map();
/** @type {Set<() => void>} */
const listeners = new Set();

function changed() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (e) {
      console.error("vimma agent gate:", e);
    }
  }
}

function askTimeoutMs() {
  const override = Services.prefs.getIntPref(ASK_TIMEOUT_PREF, 0);
  if (override > 0) return override;
  return (McpHost.config?.askTimeout ?? DEFAULT_ASK_TIMEOUT_S) * 1000;
}

/**
 * Answer the agents of the requests `resolved` names.
 * @param {{ id: number, allow: boolean, reason?: string }[]} resolved
 * @param {{ until: number }} [grant]
 */
function settle(resolved, grant) {
  for (const r of resolved) {
    const p = pending.get(r.id);
    if (!p) continue;
    pending.delete(r.id);
    lazy.clearTimeout(p.timer);
    p.resolve(
      r.allow
        ? { allow: true, ...(grant ? { grant: { until: grant.until } } : {}) }
        : /** @type {Outcome} */ ({ allow: false, reason: r.reason }),
    );
  }
}

export const AgentGate = {
  /**
   * An agent connection said hello: it may ask from now on.
   * @param {ConnId} conn
   * @param {{ client: string, version?: string, via?: string }} label  self-reported: labels only
   */
  connect(conn, label) {
    queue.connect(conn);
    labels.set(conn, { ...label, since: Date.now() });
    changed();
  },

  /**
   * The connection closed: its waiting requests go unanswered and its grants end (decision 22).
   * @param {ConnId} conn
   */
  disconnect(conn) {
    const had = labels.delete(conn);
    for (const id of queue.disconnect(conn)) {
      const p = pending.get(id);
      if (!p) continue;
      pending.delete(id);
      lazy.clearTimeout(p.timer);
      p.resolve({ allow: false, reason: "cancelled" });
    }
    if (had) changed();
  },

  /**
   * An agent request: resolves once it may run (a yes, or a grant of its connection and tool)
   * or is denied (no, timeout, busy, muted). The caller checks again, when it runs, that what
   * was asked about is still so (decision 19).
   * @param {ConnId} conn
   * @param {string} tool  the MCP tool (core AGENT_TOOLS)
   * @param {object} what  what it touches, for the question: plain data, shown as text
   * @returns {Promise<Outcome>}
   */
  request(conn, tool, what) {
    const label = labels.get(conn);
    if (!label) return Promise.resolve({ allow: false, reason: "busy" });
    const now = Date.now();
    const admission = queue.ask(conn, tool, now);
    if (admission.kind === "run") {
      return Promise.resolve({ allow: true, grant: { until: admission.grant.until } });
    }
    if (admission.kind === "deny") {
      return Promise.resolve({ allow: false, reason: admission.reason });
    }
    const { id } = admission;
    const timeout = askTimeoutMs();
    return new Promise((resolve) => {
      const timer = lazy.setTimeout(() => {
        settle(queue.expire(id, Date.now()).resolved);
        changed();
      }, timeout);
      pending.set(id, {
        id,
        conn,
        tool,
        what,
        label,
        asked: now,
        deadline: now + timeout,
        resolve,
        timer,
      });
      changed();
    });
  },

  /**
   * The user's answer to question `id` (the prompt line, sub-PR 2b): `once`, `deny`, `mute`
   * (`x`), or `grant` for `minutes` (capped at `[mcp] grant_max_minutes`).
   * @param {number} id
   * @param {Answer | { kind: "grant", minutes: number | null }} answer
   * @returns {{ minutes: number, capped: boolean } | null} the grant's length, for a grant
   */
  answer(id, answer) {
    let length = null;
    /** @type {Answer} */
    let final = /** @type {Answer} */ (answer);
    if (answer.kind === "grant") {
      length = grantLength(answer.minutes, McpHost.config ?? DEFAULT_GRANT);
      final = { kind: "grant", minutes: length.minutes };
    }
    const { resolved, grant } = queue.answer(id, final, Date.now());
    settle(resolved, grant);
    changed();
    return resolved.length && length ? length : null;
  },

  /**
   * End every grant (`:mcp revoke`, decision 22).
   * @returns {number} how many ended
   */
  revoke() {
    const n = queue.revoke();
    if (n) changed();
    return n;
  },

  /**
   * The waiting questions, oldest first: the one to ask now is the first.
   * @returns {Question[]}
   */
  get waiting() {
    return queue.waiting.flatMap((r) => {
      const p = pending.get(r.id);
      if (!p) return [];
      const { id, conn, tool, what, label, asked, deadline } = p;
      return [{ id, conn, tool, what, label, asked, deadline }];
    });
  },

  /** Grants in force, the one ending first first, with their connection's label. */
  grants() {
    return queue.grants(Date.now()).map((g) => ({ ...g, label: labels.get(g.conn) ?? null }));
  },

  /** Agent connections and their labels (`:mcp`, about:vimma). */
  get connections() {
    return [...labels.values()];
  },

  /** @param {() => void} listener  told after any change: a question, an answer, a grant */
  addListener(listener) {
    listeners.add(listener);
  },

  /** @param {() => void} listener */
  removeListener(listener) {
    listeners.delete(listener);
  },
};
