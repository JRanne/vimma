/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The private workspace in place of the Vimma window on Hyprland (docs/specs/private-swap.md).
// Going to private parks the normal window in special:vimma and puts the private window in its
// exact slot; going back swaps again. This module does the I/O around core's hyprswap.mjs: it
// finds Hyprland, learns each Vimma window's address from a random nonce title, keeps the pair
// in memory (nothing on disk, decision 8), and never leaves a window stranded (decision 7).
// Elsewhere, or with `[private] placement = "window"`, it does nothing and private-ops.mjs
// shows windows as before.

import {
  PARK,
  PROBE_LUA,
  QUERY_CLIENTS,
  QUERY_VERSION,
  detectDialect,
  encodeBatch,
  findNonce,
  nonceTitle,
  pairStep,
  parkedWindow,
  parseClients,
  parseEvent,
  planShow,
  repliesOk,
  workspaceTarget,
} from "../core/hyprswap.mjs";
import { HyprIpc, REPLY_MS } from "./hypr/HyprIpc.sys.mjs";

/** @import { Client, Dialect, Pair, PairEvent, ShowOp } from "../core/hyprswap.mjs" */
/** @import { PrivatePlacement } from "../core/config.mjs" */

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  VimmaHost: "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
});

/** What a failed swap says, once (decision 7). */
export const SWAP_REFUSED = "private: the window manager refused the swap; showing it as a window";

/** @type {PrivatePlacement} */
let placement = "swap";
/** A swap failed: "window" placement until the next config reload (decision 7). */
let failed = false;
/**
 * @type {{ state: "unknown" } | { state: "pending", promise: Promise<boolean> }
 *   | { state: "ok", dialect: Dialect, version: string }
 *   | { state: "none", reason: string, retry: boolean }}
 */
let wm = { state: "unknown" };
/** The one console line a session gets (decision 3). */
let logged = false;
/** Tests: a fake Hyprland, so the headless and Wayland checks do not apply. */
let forced = false;

/** @type {WeakMap<Window, string>} */
const addresses = new WeakMap();
/** @type {WeakMap<Window, Promise<string | null>>} */
const resolving = new WeakMap();
/** @type {Map<string, WeakRef<Window>>} */
const byAddress = new Map();
/** Pending nonce titles and who waits for them. @type {Map<string, (a: string | null) => void>} */
const nonces = new Map();
/** The last known record of each of our windows, for a window already gone (decision 7). */
/** @type {Map<string, Client>} */
const records = new Map();
/** @type {Set<Window>} every browser window seen, to resolve once swap applies */
const windows = new Set();
/** @type {{ close: () => void } | null} */
let events = null;
/** @type {Pair} */
let pair = null;
/** Swaps run one after another. */
let chain = Promise.resolve(true);
/** A swap is running: activations meanwhile are the swap's own. */
let running = 0;

/** @param {string} text */
function logOnce(text) {
  if (logged) return;
  logged = true;
  console.warn(`vimma: ${text}`);
}

/** Why Hyprland is not even tried, or null. */
function gate() {
  if (!forced) {
    if (Services.env.get("MOZ_HEADLESS")) return "headless";
    if (!(/** @type {any} */ (Services.appinfo).isWayland)) return "not on Wayland";
  }
  return HyprIpc.sockets ? null : "not on Hyprland";
}

/**
 * Finds Hyprland and its dialect, once per session; a timeout is tried again at the next
 * switch (decision 3).
 * @returns {Promise<boolean>}
 */
function detect() {
  if (wm.state === "ok") return Promise.resolve(true);
  if (wm.state === "pending") return wm.promise;
  if (wm.state === "none" && !wm.retry) return Promise.resolve(false);
  /** @param {string} reason @param {boolean} retry */
  const none = (reason, retry) => {
    wm = { state: "none", reason, retry };
    if (reason !== "not on Hyprland" && reason !== "not on Wayland" && reason !== "headless") {
      logOnce(`private workspace shown as a window: ${reason}`);
    }
    return false;
  };
  const promise = (async () => {
    const why = gate();
    if (why) return none(why, false);
    try {
      const version = await HyprIpc.request(QUERY_VERSION);
      const probe = await HyprIpc.request(PROBE_LUA);
      const found = detectDialect(version, probe);
      if ("error" in found) return none("Hyprland's socket gave no version", false);
      wm = { state: "ok", dialect: found.dialect, version: found.version };
      return true;
    } catch (e) {
      const timeout = /** @type {any} */ (e)?.message === "no reply";
      return none(
        timeout ? "Hyprland did not reply" : "Hyprland's socket is not reachable",
        timeout,
      );
    }
  })();
  wm = { state: "pending", promise };
  return promise;
}

/** Whether a switch tries the swap at all. */
function wanted() {
  return placement === "swap" && !failed && !(wm.state === "none" && !wm.retry);
}

function ensureEvents() {
  if (events) return;
  try {
    events = HyprIpc.listen(onLine, () => {
      events = null;
    });
  } catch {
    events = null;
  }
}

/** @param {string} line  never logged: it can hold any window's title (decision 8) */
function onLine(line) {
  const ev = parseEvent(line, new Set(nonces.keys()));
  if (!ev) return;
  switch (ev.type) {
    case "nonce": {
      const resolve = nonces.get(ev.nonce);
      nonces.delete(ev.nonce);
      resolve?.(ev.address);
      return;
    }
    case "close": {
      const known = byAddress.has(ev.address);
      byAddress.delete(ev.address);
      // Too late for the unload swap: the parked window still comes back (decision 7).
      if (known) step({ type: "closing", window: ev.address }, { cached: true });
      records.delete(ev.address);
      return;
    }
    case "move":
      step({ type: "moved", window: ev.address, workspace: ev.workspace });
      return;
    default:
  }
}

/**
 * The window's Hyprland address, learnt once: it carries a random title until Hyprland's event
 * names it, then its own title again (decision 5).
 * @param {Window} win
 * @returns {Promise<string | null>}
 */
function addressOf(win) {
  const known = addresses.get(win);
  if (known) return Promise.resolve(known);
  const running_ = resolving.get(win);
  if (running_) return running_;
  const promise = (async () => {
    if (win.closed || !(await detect())) return null;
    ensureEvents();
    const nonce = nonceTitle(crypto.getRandomValues(new Uint8Array(16)));
    /** @type {Promise<string | null>} */
    const heard = new Promise((resolve) => {
      nonces.set(nonce, resolve);
      lazy.setTimeout(() => {
        if (nonces.delete(nonce)) resolve(null);
      }, REPLY_MS);
    });
    // Held until Hyprland names the window: a page loading meanwhile would retitle it.
    const doc = win.document;
    doc.title = nonce;
    const keep = new /** @type {any} */ (win).MutationObserver(() => {
      if (doc.title !== nonce) doc.title = nonce;
    });
    keep.observe(doc.documentElement, { subtree: true, childList: true, characterData: true });
    let address = await heard;
    if (!address) {
      try {
        address = findNonce(
          await HyprIpc.request(QUERY_CLIENTS),
          nonce,
          Services.appinfo.processID,
        );
      } catch {
        address = null;
      }
    }
    keep.disconnect();
    if (!win.closed) /** @type {any} */ (win).gBrowser?.updateTitlebar();
    if (address && !win.closed) {
      addresses.set(win, address);
      byAddress.set(address, new WeakRef(win));
    }
    return address;
  })();
  resolving.set(win, promise);
  promise.finally(() => resolving.delete(win));
  return promise;
}

/** @returns {Promise<Client[] | null>} */
async function clients() {
  try {
    const list = parseClients(await HyprIpc.request(QUERY_CLIENTS));
    for (const c of list) if (byAddress.has(c.address)) records.set(c.address, c);
    return list;
  } catch {
    return null;
  }
}

/**
 * The swap could not be done: the parked window is shown where the other one is, the pair is
 * forgotten, and switches show windows until the next config reload (decision 7).
 * @param {Dialect} dialect
 * @param {string} show  the window to show
 * @param {string} place
 * @param {boolean} closing  the slot window was closing: not a refusal, nothing said
 */
async function rescue(dialect, show, place, closing) {
  pair = null;
  if (!closing) failed = true;
  const list = await clients();
  const x = list?.find((c) => c.address === show) ?? records.get(show);
  const y = list?.find((c) => c.address === place) ?? records.get(place);
  // A batch is not a transaction: either window may have reached special:vimma.
  const stuck = [x, y].find((c) => c?.workspace.name === PARK);
  const other = stuck === x ? y : x;
  const ws = workspaceTarget(other?.workspace);
  /** @type {import("../core/hyprswap.mjs").Command[]} */
  const commands = [];
  if (stuck && ws !== null) commands.push({ verb: "move", window: stuck.address, workspace: ws });
  if (x && x.workspace.name !== PARK) commands.push({ verb: "focus", window: show });
  else if (stuck && ws !== null) commands.push({ verb: "focus", window: stuck.address });
  const batch = commands.length ? encodeBatch(dialect, commands) : null;
  if (batch) await HyprIpc.request(batch.text).catch(() => {});
  if (closing) return;
  logOnce(SWAP_REFUSED);
  const win = byAddress.get(show)?.deref();
  if (win && !win.closed) lazy.VimmaHost.say(win, SWAP_REFUSED);
}

/**
 * Shows `op.show` in `op.place`'s slot.
 * @param {ShowOp} op
 * @param {{ cached?: boolean }} options  cached: the slot window is closing; its last record
 * @returns {Promise<boolean>}
 */
async function showInPlace(op, { cached = false }) {
  if (wm.state !== "ok") return false;
  const { dialect } = wm;
  const list = cached ? null : await clients();
  const x = list?.find((c) => c.address === op.show) ?? (cached ? records.get(op.show) : null);
  const y = list?.find((c) => c.address === op.place) ?? (cached ? records.get(op.place) : null);
  if (!x || !y) {
    await rescue(dialect, op.show, op.place, cached);
    return false;
  }
  const plan = planShow(dialect, x, y);
  if (plan.kind === "refuse") {
    await rescue(dialect, op.show, op.place, cached);
    return false;
  }
  const batch = /** @type {{ text: string, count: number }} */ (
    encodeBatch(dialect, plan.commands)
  );
  let reply = "";
  try {
    reply = await HyprIpc.request(batch.text);
  } catch {
    // no reply: the check below treats it as a failure
  }
  if (!repliesOk(reply, batch.count)) {
    await rescue(dialect, op.show, op.place, cached);
    return false;
  }
  // A grouped or pinned slot: shown beside, nothing parked.
  if (!plan.parks) {
    pair = null;
    return true;
  }
  // What Hyprland now has, for a slot window that closes before the next read (unload).
  const { workspace, at, size, floating, fullscreen, fullscreenClient } = y;
  records.set(x.address, { ...x, workspace, at, size, floating, fullscreen, fullscreenClient });
  records.set(y.address, { ...y, workspace: { id: 0, name: PARK }, fullscreen: 0 });
  return true;
}

/**
 * Advances the pair and runs its swaps, in order.
 * @param {PairEvent} event
 * @param {{ cached?: boolean }} [options]
 * @returns {Promise<boolean>} whether every swap was done
 */
function step(event, options = {}) {
  if (/** @type {any} */ (Services).startup.shuttingDown) return Promise.resolve(false);
  const { state, ops } = pairStep(pair, event);
  pair = state;
  if (!ops.length) return Promise.resolve(true);
  running++;
  chain = chain.then(async () => {
    try {
      for (const op of ops) if (!(await showInPlace(op, options))) return false;
      return true;
    } catch (e) {
      console.error("vimma: private swap failed", e);
      return false;
    } finally {
      running--;
    }
  });
  return chain;
}

/** @param {Window} win */
function onActivated(win) {
  const a = addresses.get(win);
  if (!a || running || parkedWindow(pair) !== a) return;
  step({ type: "activated", window: a });
}

/** @param {Window} win */
function onUnload(win) {
  windows.delete(win);
  const a = addresses.get(win);
  if (!a) return;
  step({ type: "closing", window: a }, { cached: true });
}

/** @param {Window} win */
function track(win) {
  if (placement !== "swap" || failed || win.closed) return;
  addressOf(win).then((a) => {
    if (a) clients();
  });
}

export const PrivateSwap = {
  /**
   * Once per browser window (vimma.js): its address is learnt while swap placement applies,
   * and its close, activation and new tabs are watched (decision 7).
   * @param {Window} win
   */
  init(win) {
    if (windows.has(win)) return;
    windows.add(win);
    win.addEventListener("unload", () => onUnload(win), { once: true });
    win.addEventListener("activate", () => onActivated(win));
    /** @type {any} */ (win).gBrowser?.tabContainer.addEventListener("TabOpen", () =>
      onActivated(win),
    );
    track(win);
  },

  /**
   * `[private] placement` from config.toml, live. A reload also lifts a failure's fallback.
   * @param {PrivatePlacement} next
   */
  configure(next) {
    placement = next;
    failed = false;
    if (next === "window") {
      events?.close();
      events = null;
      return;
    }
    for (const win of windows) track(win);
  },

  /**
   * Going to private (private-ops enterPrivate): shows `priv` in `from`'s slot. False when the
   * swap does not apply, and the caller focuses `priv` as before.
   * @param {Window} from  a normal window
   * @param {Window} priv  the most recent private window
   * @param {boolean} fresh  just opened by this switch
   * @returns {boolean}
   */
  enter(from, priv, fresh) {
    if (!wanted()) return false;
    (async () => {
      if (fresh) await /** @type {any} */ (priv).delayedStartupPromise;
      const [normal, p] = await Promise.all([addressOf(from), addressOf(priv)]);
      // A private window shown somewhere else (a second one from ctrl+n): focus it, as today.
      if (!normal || !p || (!fresh && p !== pair?.private)) {
        if (!fresh && !priv.closed) priv.focus();
        return;
      }
      if (!(await step({ type: "enter", normal, private: p })) && !priv.closed) priv.focus();
    })().catch((e) => console.error("vimma: private swap failed", e));
    return true;
  },

  /**
   * Going back to normal window `win` (private-ops showNormal): the parked window comes back in
   * the private one's slot, then `win` is focused if it is another one. False when nothing is
   * parked, and the caller focuses `win` as before.
   * @param {Window} win
   * @returns {boolean}
   */
  show(win) {
    if (pair?.parked !== "normal") return false;
    const back = pair.normal;
    step({ type: "leave" }).then((ok) => {
      if ((!ok || addresses.get(win) !== back) && !win.closed) win.focus();
    });
    return true;
  },

  /**
   * Before the private workspace closes (ctrl+b shift+d): the parked normal window is shown in
   * its slot first, and the close waits for Hyprland's reply (decision 7).
   * @returns {Promise<void>}
   */
  async beforeClose() {
    if (pair?.parked !== "normal") return;
    await step({ type: "closing", window: pair.private });
  },

  /** about:vimma's line (decision 10): no addresses, no titles. */
  get status() {
    const how = placement === "window" ? "window (config)" : failed ? "window (swap failed)" : "";
    switch (wm.state) {
      case "ok":
        return `Hyprland ${wm.version} (${wm.dialect}), private placement: ${how || "swap"}`;
      case "none":
        return `none (${wm.reason}), private placement: window`;
      default:
        return `not checked yet, private placement: ${how || placement}`;
    }
  },

  /** Tests: the pair, as addresses. */
  get _pair() {
    return pair;
  },

  /**
   * Tests only: forget Hyprland, the pair and every address, and talk to `sockets` (a fake)
   * from now on; undefined: back to the environment.
   * @param {{ request: string, events: string } | null | undefined} sockets
   */
  _resetForTests(sockets) {
    events?.close();
    events = null;
    HyprIpc._setSocketsForTests(sockets);
    forced = sockets !== undefined;
    wm = { state: "unknown" };
    pair = null;
    failed = false;
    logged = false;
    placement = "swap";
    nonces.clear();
    byAddress.clear();
    records.clear();
    for (const win of windows) addresses.delete(win);
    chain = Promise.resolve(true);
    running = 0;
  },

  /** Tests: settles once the swaps queued so far are done. */
  _settled() {
    return chain;
  },
};
