/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The agent role's commands (docs/specs/vimma-mcp.md, decision 4): list, read, open and close
// tabs of the agent workspace, and nothing else. What an agent can reach is decided here, in
// the browser, when each command runs (decision 7): a tab of the agent workspace **and** of its
// container, in a normal window (private windows have no workspaces and are never enumerated).
// Every command but hello and ping asks through AgentGate first (decision 12), and after the
// yes the tab and URL must still be the ones asked about, or nothing happens (decision 19).

import { AGENT_TOOLS, wrapUntrusted } from "../core/agent.mjs";
import { MAX_LINE_LENGTH, MAX_READ_CHARS } from "../core/control.mjs";
import { workspaceOfTab } from "../core/workspaces.mjs";
import { VimmaActors } from "../actors/VimmaActors.sys.mjs";
import { McpHost } from "../host/mcp-ops.mjs";
import { WindowWorkspaces } from "../workspaces/WindowWorkspaces.sys.mjs";
import { WorkspaceStore } from "../workspaces/WorkspaceStore.sys.mjs";
import { AgentGate } from "./AgentGate.sys.mjs";

/** @import { ConnId } from "../core/agent.mjs" */

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

/** How long a read waits for a page (a lazy tab's first load) before it gives up. */
const LOAD_TIMEOUT_MS = 20000;
/** How long the extractor may take on a loaded page: a hostile page must not hold a read. */
const EXTRACT_TIMEOUT_MS = 30000;
/** Room in the 1 MiB reply line for everything but the text (protocol, decision 4). */
const REPLY_OVERHEAD = 64 * 1024;
const DEFAULT_MAX_READ = 200000;

/** A refusal with a protocol error code (and, for `denied`, its reason). */
export class AgentError extends Error {
  /** @param {string} code @param {string} message @param {string} [reason] */
  constructor(code, message, reason) {
    super(message);
    this.code = code;
    this.reason = reason;
  }
}

/** The denial texts, by reason (decision 4); the MCP layer words them for the model. */
const DENIED = /** @type {Record<string, string>} */ ({
  user: "the user denied this request in Vimma",
  timeout: "no answer in Vimma in time; treated as denied",
  busy: "too many agent requests are waiting in Vimma; try again later",
  muted: "this agent connection is muted in Vimma after repeated denials",
  changed: "the tab changed after the user was asked; nothing was done",
  cancelled: "the request was cancelled",
});

/** @param {string} reason */
const denied = (reason) => new AgentError("denied", DENIED[reason] ?? reason, reason);

/**
 * @typedef {any} Win
 * @typedef {any} Tab
 * @typedef {{ id: string, name: string, userContextId: number }} AgentWorkspace
 * @typedef {{ agent?: { client: string, via?: string } }} AgentConn
 */

/** The agent workspace, or a refusal when there is none (containers off). */
function agentWorkspace() {
  const w = WorkspaceStore.agent;
  if (!w || w.userContextId === null || w.userContextId === undefined) {
    throw new AgentError("failed", "there is no agent workspace in Vimma (containers off?)");
  }
  return /** @type {AgentWorkspace} */ (/** @type {unknown} */ (w));
}

/** Normal browser windows: never a private one (decision 7). */
function normalWindows() {
  /** @type {Win[]} */
  const out = [];
  for (const win of /** @type {any} */ (Services.wm).getEnumerator("navigator:browser")) {
    if (win.closed || !win.gBrowser || lazy.PrivateBrowsingUtils.isWindowPrivate(win)) continue;
    out.push(win);
  }
  return out;
}

/**
 * Whether `tab` belongs to the agent: its container is the agent workspace's, and its window's
 * model has it in that workspace, not adopted there as a foreign tab (decision 7).
 * @param {Win} win @param {Tab} tab @param {AgentWorkspace} agent
 */
function isAgentTab(win, tab, agent) {
  if (tab.closing || tab.pinned || tab.userContextId !== agent.userContextId) return false;
  const ww = WindowWorkspaces.get(win);
  const model = ww?.model;
  if (!ww || !model || ww.isForeign(tab)) return false;
  return workspaceOfTab(model, ww.idOf(tab))?.id === agent.id;
}

/**
 * The agent's tabs, in window and strip order. A lazy one (restored, or unloaded under memory
 * pressure) gets its browser first, which gives it the id agents name it by; its page loads
 * only when it is read (spec B2).
 * @param {AgentWorkspace} agent @returns {{ win: Win, tab: Tab }[]}
 */
function agentTabs(agent) {
  return normalWindows().flatMap((win) =>
    win.gBrowser.tabs
      .filter((/** @type {Tab} */ t) => isAgentTab(win, t, agent))
      .map((/** @type {Tab} */ tab) => {
        if (!tab.linkedPanel) win.gBrowser.insertBrowser(tab);
        return { win, tab };
      }),
  );
}

/** @param {Tab} tab */
const tabId = (tab) => String(tab.linkedBrowser.browserId);
/**
 * The tab's URL. A tab not loaded yet (lazy, or restored and pending) shows about:blank in its
 * browser: its URL is in its session history, as SessionStore keeps it.
 * @param {Tab} tab
 */
function tabUrl(tab) {
  const uri = String(tab.linkedBrowser.currentURI?.spec ?? "about:blank");
  if (uri !== "about:blank" || (tab.linkedPanel && !tab.hasAttribute("pending"))) return uri;
  try {
    const state = JSON.parse(lazy.SessionStore.getTabState(tab));
    const entries = Array.isArray(state?.entries) ? state.entries : [];
    const entry = entries[(Number(state.index) || entries.length) - 1];
    if (typeof entry?.url === "string" && entry.url) return entry.url;
  } catch {
    // no session for it: what the browser says
  }
  return uri;
}

/**
 * The agent tab with id `id`, or invalid-args: a tab of any other workspace, container or
 * window is unknown to the agent (decision 7), and nothing is asked.
 * @param {AgentWorkspace} agent @param {string} id
 */
function findAgentTab(agent, id) {
  const all = agentTabs(agent);
  const index = all.findIndex(({ tab }) => tabId(tab) === id);
  if (index === -1) {
    throw new AgentError("invalid-args", `tab ${id} is not a tab of the agent workspace`);
  }
  return { ...all[index], index: index + 1 };
}

/** @param {Tab} tab */
function describeTab(tab) {
  return { tab: tabId(tab), title: String(tab.label ?? ""), url: tabUrl(tab) };
}

/**
 * The URL an agent may load: http or https, checked on what the URL parser made of the text too
 * (the validator checked the text).
 * @param {string} url
 */
function agentUri(url) {
  /** @type {any} */
  let uri;
  try {
    uri = Services.io.newURI(url);
  } catch {
    throw new AgentError("invalid-args", "url is not a valid URL");
  }
  if (uri.scheme !== "http" && uri.scheme !== "https") {
    throw new AgentError("invalid-args", "url scheme must be http or https");
  }
  return uri;
}

/** A principal for loads an agent asks for: no authority, in the agent's container. */
function agentPrincipal(/** @type {number} */ userContextId) {
  return /** @type {any} */ (Services.scriptSecurityManager).createNullPrincipal({ userContextId });
}

/**
 * Ask, and wait: resolves when allowed, throws `denied` otherwise.
 * @param {ConnId} conn @param {string} command @param {object} what
 */
async function ask(conn, command, what) {
  const tool = /** @type {Record<string, string>} */ (AGENT_TOOLS)[command];
  const outcome = await AgentGate.request(conn, /** @type {string} */ (tool), what);
  if (!outcome.allow) throw denied(outcome.reason);
  return outcome;
}

/**
 * After the yes: the tab must still be the agent's with the URL asked about (decision 19).
 * @param {AgentWorkspace} asked @param {string} id @param {string} url
 */
function stillAsAsked(asked, id, url) {
  const agent = WorkspaceStore.agent;
  if (!agent || agent.id !== asked.id || agent.userContextId !== asked.userContextId) {
    throw denied("changed");
  }
  let found;
  try {
    found = findAgentTab(asked, id);
  } catch {
    throw denied("changed");
  }
  if (tabUrl(found.tab) !== url) throw denied("changed");
  return found;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => lazy.setTimeout(resolve, ms));

/**
 * `promise`, or a `failed` refusal after `ms`.
 * @template T
 * @param {number} ms @param {Promise<T>} promise
 * @returns {Promise<T>}
 */
function within(ms, promise) {
  return Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new AgentError("failed", "reading the page took too long");
    }),
  ]);
}

/**
 * A tab's page, loaded: a lazy tab (restored, or unloaded under memory pressure) gets its
 * browser and loads `url` in the background first (spec B2). Never selected, never shown.
 * @param {Win} win @param {Tab} tab @param {string} url @param {number} userContextId
 */
async function loadedPage(win, tab, url, userContextId) {
  const browser = tab.linkedBrowser;
  if (!tab.linkedPanel) win.gBrowser.insertBrowser(tab);
  if (tab.hasAttribute("pending") || !browser.browsingContext?.currentWindowGlobal) {
    browser.loadURI(agentUri(url), { triggeringPrincipal: agentPrincipal(userContextId) });
  }
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  for (;;) {
    const wg = browser.browsingContext?.currentWindowGlobal;
    const loading = browser.webProgress?.isLoadingDocument ?? true;
    if (wg && !loading && !tab.hasAttribute("pending") && !wg.isInitialDocument) return wg;
    if (Date.now() > deadline) throw new AgentError("failed", "the page did not load in time");
    await sleep(100);
  }
}

/**
 * Cut `text` to `max` code points.
 * @param {string} text @param {number} max
 */
function cut(text, max) {
  const chars = [...text];
  return chars.length > max
    ? { text: chars.slice(0, max).join(""), truncated: true }
    : { text, truncated: false };
}

/** UTF-8 length of `value` as JSON. @param {unknown} value */
const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

const COMMANDS = {
  /**
   * The connection's first command (decision 4): labels for the question. Neither is proof.
   * @param {ConnId} conn @param {AgentConn} state @param {any} args
   */
  "agent-hello"(conn, state, { client, via }) {
    state.agent = {
      client: client.name,
      ...(client.version ? { version: client.version } : {}),
      ...(via ? { via } : {}),
    };
    AgentGate.connect(conn, state.agent);
    const agent = WorkspaceStore.agent;
    return { workspace: agent?.name ?? WorkspaceStore.agentName ?? "agent", exists: !!agent };
  },

  "agent-ping"() {
    return {};
  },

  /** @param {ConnId} conn */
  async "agent-tabs"(conn) {
    const agent = agentWorkspace();
    await ask(conn, "agent-tabs", { count: agentTabs(agent).length });
    // The list as it is now, checked again (decision 7).
    const now = agentWorkspace();
    if (now.id !== agent.id) throw denied("changed");
    return {
      tabs: agentTabs(now).map(({ tab }) => ({
        id: tabId(tab),
        url: tabUrl(tab),
        title: String(tab.label ?? ""),
        loading: tab.hasAttribute("busy") || tab.hasAttribute("pending") || !tab.linkedPanel,
      })),
    };
  },

  /** @param {ConnId} conn @param {AgentConn} _state @param {any} args */
  async "agent-read"(conn, _state, { tab: id, format = "markdown", max_chars }) {
    const agent = agentWorkspace();
    const asked = findAgentTab(agent, id);
    const what = { ...describeTab(asked.tab), index: asked.index };
    await ask(conn, "agent-read", what);
    const { win, tab } = stillAsAsked(agent, id, what.url);
    const limit = Math.min(
      max_chars ?? Infinity,
      McpHost.config?.maxReadChars ?? DEFAULT_MAX_READ,
      MAX_READ_CHARS,
    );
    const wg = await loadedPage(win, tab, what.url, agent.userContextId);
    let extractor;
    try {
      extractor = wg.getActor("PageExtractor");
    } catch {
      throw new AgentError("failed", "Vimma cannot read this page (an error page or a viewer)");
    }
    const result = await within(
      EXTRACT_TIMEOUT_MS,
      extractor.getText({
        removeBoilerplate: true,
        useSimpleText: format === "text",
        sufficientLength: limit,
        sourceUrl: what.url,
      }),
    );
    if (!result || typeof result.text !== "string") {
      throw new AgentError("failed", "Vimma could not read text from this page");
    }
    // The page may have navigated while it was read: the text must be the asked page's.
    stillAsAsked(agent, id, what.url);
    let { text, truncated } = cut(result.text, limit);
    const selection = await VimmaActors.selection(tab.linkedBrowser, limit);
    let language = null;
    try {
      const meta = await extractor.getPageMetadata();
      language = typeof meta?.language === "string" && meta.language ? meta.language : null;
    } catch {
      // metadata is a nicety; the text stands without it
    }
    const reply = () => ({
      url: what.url,
      title: String(tab.label ?? ""),
      text: wrapUntrusted(text),
      truncated,
      selection,
      language,
      background: !(tab.selected && /** @type {any} */ (Services.focus).activeWindow === win),
    });
    // The whole reply line must fit the protocol's 1 MiB (decision 4).
    while (jsonBytes(reply()) > MAX_LINE_LENGTH - REPLY_OVERHEAD && text.length) {
      text = cut(text, Math.floor([...text].length * 0.9)).text;
      truncated = true;
    }
    return reply();
  },

  /** @param {ConnId} conn @param {AgentConn} _state @param {any} args */
  async "agent-open"(conn, _state, { url, tab: id }) {
    const agent = agentWorkspace();
    const uri = agentUri(url);
    const into = id === undefined ? null : findAgentTab(agent, id);
    const current = into ? describeTab(into.tab) : null;
    // The tab's own URL is `current`; `url` is what it would load.
    const what = {
      url: uri.spec,
      host: uri.host,
      ...(current ? { tab: current.tab, title: current.title, current: current.url } : {}),
    };
    await ask(conn, "agent-open", what);
    const principal = agentPrincipal(agent.userContextId);
    if (current) {
      const { tab } = stillAsAsked(agent, current.tab, current.url);
      tab.linkedBrowser.loadURI(uri, { triggeringPrincipal: principal });
      return { tab: tabId(tab) };
    }
    const now = WorkspaceStore.agent;
    if (!now || now.id !== agent.id || now.userContextId !== agent.userContextId)
      throw denied("changed");
    // The most recently focused normal window, in the background (decision 10): the agent's
    // container explicitly, so no routing rule moves it, and no workspace switch.
    const win =
      lazy.BrowserWindowTracker.getTopWindow({ private: false, allowPopups: false }) ??
      normalWindows()[0];
    const ww = win && WindowWorkspaces.get(win);
    if (!ww?.model) throw new AgentError("failed", "no normal browser window to open in");
    const tab = ww.quietly(() =>
      win.gBrowser.addTab(uri.spec, {
        triggeringPrincipal: principal,
        userContextId: agent.userContextId,
        inBackground: true,
        skipAnimation: true,
      }),
    );
    return { tab: tabId(tab) };
  },

  /** @param {ConnId} conn @param {AgentConn} _state @param {any} args */
  async "agent-close"(conn, _state, { tab: id }) {
    const agent = agentWorkspace();
    const asked = findAgentTab(agent, id);
    const what = { ...describeTab(asked.tab), index: asked.index };
    await ask(conn, "agent-close", what);
    const { win, tab } = stillAsAsked(agent, id, what.url);
    win.gBrowser.removeTab(tab, { closeWindowWithLastTab: false, skipPermitUnload: true });
    return { closed: true };
  },
};

/**
 * Run an agent command, validated already. `state` is the connection's: `agent` once its
 * hello is in. Throws AgentError for every refusal.
 * @param {ConnId} conn
 * @param {AgentConn} state
 * @param {string} command
 * @param {any} args
 */
export function runAgentCommand(conn, state, command, args) {
  if (command === "agent-hello") {
    if (state.agent) throw new AgentError("bad-request", "agent-hello was already sent");
  } else if (!state.agent) {
    throw new AgentError("bad-request", "agent-hello must be the connection's first command");
  }
  const run = /** @type {Record<string, (c: ConnId, s: AgentConn, a: any) => any>} */ (COMMANDS)[
    command
  ];
  if (!run) throw new AgentError("unknown-command", `unknown command ${command}`);
  return run(conn, state, args);
}
