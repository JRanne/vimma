/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The agent role's gate (docs/specs/vimma-mcp.md, decisions 12-22): every agent request but
// hello and ping waits here for the user's answer, or runs under a grant of its connection and
// tool. Core's AgentQueue holds the rules (the queue and its caps, the mute, the grants); this
// adds the clock: the ask timeout (50 s, `[mcp] ask_timeout`) and the grants' expiry. One per
// app, in memory only: nothing here is written to disk (decision 22), and a restart ends it all.
//
// The question itself (ui/agent-prompt.mjs, host/agent-ui.mjs: the line, the status bar's
// `◇ agent 1?`, `ctrl+b shift+a`) watches the gate through `addListener` and answers through
// `answer`. While MCP is on, a new full-control connection asks here too (`askFull`, decision
// 29 C), as a question of its own that no grant can cover.

import { AgentQueue, grantLength } from "../core/agent.mjs";
import { FULL_CONTROL } from "../core/agent-prompt.mjs";
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
 * @typedef {{ kind: "asked", question: Question }
 *   | { kind: "answered", question: Question, answer: string,
 *       length: { minutes: number, capped: boolean } | null }
 *   | { kind: "timeout", question: Question }
 *   | { kind: "ran", conn: ConnId, tool: string, what: object, label: AgentLabel,
 *       until: number }} GateEvent  what listeners hear, for the notices (decisions 16, 20, 23)
 */

const queue = new AgentQueue();
/** Agent connections after their hello: what the question and `:mcp` call them. */
/** @type {Map<ConnId, AgentLabel>} */
const labels = new Map();
/** Waiting requests: what is asked, and how to answer the agent. */
/** @type {Map<number, Question & { resolve: (o: Outcome) => void, timer: any }>} */
const pending = new Map();
/** @type {Set<(event?: GateEvent) => void>} */
const listeners = new Set();
/** When an allowed request last ran (the status bar's `◇ agent ·`). @type {number | null} */
let ranAt = null;
/** The queue's key for full-control questions (decision 29 C); never an agent connection. */
const FULL_CONN = "full";

/**
 * Withdraw question `id` unanswered: its connection went away.
 * @param {number} id
 */
function cancel(id) {
  const p = pending.get(id);
  if (!p || !queue.cancel(id)) return;
  pending.delete(id);
  lazy.clearTimeout(p.timer);
  p.resolve({ allow: false, reason: "cancelled" });
  changed();
}

/** @param {GateEvent} [event] */
function changed(event) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      console.error("vimma agent gate:", e);
    }
  }
}

/** @param {number} id */
const questionOf = (id) => {
  const p = pending.get(id);
  if (!p) return null;
  const { conn, tool, what, label, asked, deadline } = p;
  return { id, conn, tool, what, label, asked, deadline };
};

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
    if (r.allow) ranAt = Date.now();
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
      ranAt = now;
      changed({ kind: "ran", conn, tool, what, label, until: admission.grant.until });
      return Promise.resolve({ allow: true, grant: { until: admission.grant.until } });
    }
    if (admission.kind === "deny") {
      return Promise.resolve({ allow: false, reason: admission.reason });
    }
    const { id } = admission;
    const timeout = askTimeoutMs();
    return new Promise((resolve) => {
      const timer = lazy.setTimeout(() => {
        const question = questionOf(id);
        settle(queue.expire(id, Date.now()).resolved);
        changed(question ? { kind: "timeout", question } : undefined);
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
      changed({ kind: "asked", question: /** @type {Question} */ (questionOf(id)) });
    });
  },

  /**
   * A new full-control connection while MCP is on (decision 29 C): resolves once the user said
   * yes, or with the denial (no, `x`, timeout, a full queue). Nothing is remembered: the next
   * connection asks again.
   * @param {(cancel: () => void) => void} [onCancel]  given a way to withdraw the question
   *   (the connection closed while it waited)
   * @returns {Promise<Outcome>}
   */
  askFull(onCancel) {
    // One connection key for every full-control question: one waits at a time, and three noes
    // in a row mute them all for a minute (decision 18), so a token holder cannot flood.
    if (!labels.has(FULL_CONN)) this.connect(FULL_CONN, { client: "vimma-ctl" });
    if (AgentGate.waiting.some((q) => q.conn === FULL_CONN)) {
      return Promise.resolve({ allow: false, reason: "busy" });
    }
    const outcome = this.request(FULL_CONN, FULL_CONTROL, {});
    const mine = [...pending.values()].find((p) => p.conn === FULL_CONN);
    if (mine) onCancel?.(() => cancel(mine.id));
    return outcome;
  },

  /**
   * The user's answer to question `id` (the prompt line, sub-PR 2b): `once`, `deny`, `mute`
   * (`x`), or `grant` for `minutes` (capped at `[mcp] grant_max_minutes`).
   * @param {number} id
   * @param {Answer | { kind: "grant", minutes: number | null }} answer
   * @returns {{ minutes: number, capped: boolean } | null} the grant's length, for a grant
   */
  answer(id, answer) {
    const question = questionOf(id);
    let length = null;
    /** @type {Answer} */
    let final = /** @type {Answer} */ (answer);
    // Full control is one connection's yes or no: no grant covers it, and `x` is a plain no.
    if (question?.tool === FULL_CONTROL) {
      if (answer.kind === "grant") return null;
      if (answer.kind === "mute") final = { kind: "deny" };
    }
    if (answer.kind === "grant") {
      length = grantLength(answer.minutes, McpHost.config ?? DEFAULT_GRANT);
      final = { kind: "grant", minutes: length.minutes };
    }
    const { resolved, grant } = queue.answer(id, final, Date.now());
    settle(resolved, grant);
    const granted = resolved.length && length ? length : null;
    changed(
      question && resolved.length
        ? { kind: "answered", question, answer: final.kind, length: granted }
        : undefined,
    );
    return granted;
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

  /** When an allowed request last ran, or null. */
  get ranAt() {
    return ranAt;
  },

  /** Grants in force, the one ending first first, with their connection's label. */
  grants() {
    return queue.grants(Date.now()).map((g) => ({ ...g, label: labels.get(g.conn) ?? null }));
  },

  /** Agent connections and their labels (`:mcp`, about:vimma); never a full-control question's. */
  get connections() {
    return [...labels.entries()].filter(([conn]) => conn !== FULL_CONN).map(([, label]) => label);
  },

  /**
   * @param {(event?: GateEvent) => void} listener  told after any change: a question, an
   *   answer, a grant, a call under a grant
   */
  addListener(listener) {
    listeners.add(listener);
  },

  /** @param {(event?: GateEvent) => void} listener */
  removeListener(listener) {
    listeners.delete(listener);
  },
};
