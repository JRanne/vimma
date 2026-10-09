/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Chrome-window key capture and dispatch (specs: docs/specs/m0-key-capture.md,
// docs/specs/m0-help-overlay.md, docs/specs/m1-actor-insert-scroll.md,
// docs/specs/m2-tab-keys.md). Sees every keydown
// before the URL bar, about: pages and the PDF viewer, runs it through the vimma-core
// dispatcher and consumes the keys that are ours.

import { VimmaActors } from "../actors/VimmaActors.sys.mjs";
import { createDispatcher } from "../core/dispatcher.mjs";
import { insertModeAfterFocus } from "../core/editable.mjs";
import { HintError, hintKey, startHints } from "../core/hints.mjs";
import { chordFromEvent, formatKey } from "../core/keys.mjs";
import { compileKeymap } from "../core/keymap.mjs";
import { notImplementedText } from "../core/actions.mjs";
import { HelpOverlay } from "../ui/help-overlay.mjs";
import { HintOverlay } from "../ui/hint-overlay.mjs";
import { StatusBar } from "../ui/statusbar.mjs";
import { Find } from "./find.mjs";
import { Notice } from "../ui/notice.mjs";
import { TabStrip } from "../ui/tabstrip.mjs";
import { closeTab, newTab, selectTab } from "./tab-ops.mjs";

/** @import { Chord } from "../core/keys.mjs" */
/** @import { Mode } from "../core/modes.mjs" */
/** @import { FindStatus } from "../core/find.mjs" */
/** @import { Action, DispatchResult } from "../core/dispatcher.mjs" */
/** @import { EditableDescriptor, InsertTrigger } from "../core/editable.mjs" */
/** @import { Keymap, TrieNode } from "../core/keymap.mjs" */
/** @import { HintAction, HintState } from "../core/hints.mjs" */
/** @import { HintTarget } from "../actors/VimmaActors.sys.mjs" */

/**
 * Hint mode in one window (m1-hints): from `f` until a label is chosen or Esc. While the
 * targets are being collected, keys are kept and replayed once the labels are up.
 * @typedef {object} HintSession
 * @property {any} browser  the <browser> the hints are on
 * @property {HintAction} action
 * @property {HintState<HintTarget> | null} hs  null while collecting
 * @property {Chord[]} buffered  keys typed while collecting
 */

const DEBUG_PREF = "vimma.debug.keys";
const MAX_RECORDED = 50;
const MODIFIERS = /** @type {const} */ (["ctrl", "alt", "shift", "meta"]);

/**
 * @typedef {object} WindowState
 * @property {Window} win
 * @property {Keymap} keymap
 * @property {(e: KeyboardEvent) => void} onKeyDown
 * @property {() => void} onTabSelect
 * @property {ReturnType<typeof createDispatcher>} dispatcher
 * @property {HelpOverlay} help
 * @property {Notice} notice  "<action>: not implemented yet" (m2-tab-keys)
 * @property {TabStrip | null} tabStrip  hides Firefox's tab strip (m0-tabstrip-hidden)
 * @property {number | null} timer   pending-sequence timeout (dispatcher.flush)
 * @property {() => void} onCancelHints  resize, a mouse click in chrome
 * @property {HintSession | null} hint
 * @property {HintOverlay} hintOverlay
 * @property {Set<() => void>} listeners  told after mode or pending keys may have changed
 * @property {StatusBar | null} statusBar  m2-statusbar-whichkey
 * @property {Find} find  `/`, `?`, `n`, `N` over Firefox's find bar (m1-find)
 */

/**
 * What the host can execute so far, with CONTENT_RUNNERS. An action without an entry is left to
 * Firefox when it is a single key outside help (ctrl+i, ctrl+u keep working until their
 * milestones land); inside a sequence (or after a count) it is consumed and shows "<action>: not
 * implemented yet", so `ctrl+b <key>` never leaks the second key to the page and is never silent
 * (m2-tab-keys). Unbound keys always pass (m1-actor-insert-scroll, Settled).
 * @type {Record<string, (state: WindowState, action: Action) => void>}
 */
export const RUNNERS = Object.freeze({
  "help.show": (/** @type {WindowState} */ s) => s.help.toggle(),
  "help.close": (/** @type {WindowState} */ s) => s.help.close(),
  "help.filter": (/** @type {WindowState} */ s) => s.help.focusFilter(),
  "hint.cancel": (/** @type {WindowState} */ s) => VimmaHost._cancelHints(s),
  "tab.new": (/** @type {WindowState} */ s) => newTab(s.win),
  "tab.next": (/** @type {WindowState} */ s, /** @type {Action} */ a) => selectTab(s.win, a),
  "tab.previous": (/** @type {WindowState} */ s, /** @type {Action} */ a) => selectTab(s.win, a),
  "tab.goto": (/** @type {WindowState} */ s, /** @type {Action} */ a) => selectTab(s.win, a),
  "tab.close": (/** @type {WindowState} */ s) => closeTab(s.win),
});

/**
 * The page mode of each tab's <browser>, from the actor's focus reports; absent = normal.
 * Written only through setBrowserMode.
 * @type {WeakMap<object, "normal" | "insert">}
 */
const browserModes = new WeakMap();

/**
 * @param {any} browser
 * @param {"normal" | "insert"} mode
 */
function setBrowserMode(browser, mode) {
  if ((browserModes.get(browser) ?? "normal") === mode) return;
  browserModes.set(browser, mode);
  VimmaHost.onModeChange(browser, mode);
}

/**
 * Actions on the focused page (m1-actor-insert-scroll). Runnable only while a content browser
 * with our actor has focus; elsewhere (the URL bar) they count as not runnable, so Esc there
 * still reaches Firefox. Every runnable id is a key of RUNNERS or CONTENT_RUNNERS; whether one
 * runs right now is `VimmaHost._runnable(state, id)`.
 * @type {Readonly<Record<string, (browser: any, action: Action) => void>>}
 */
export const CONTENT_RUNNERS = Object.freeze({
  "scroll.down": (b, a) => VimmaActors.scroll(b, "down", a.count),
  "scroll.up": (b, a) => VimmaActors.scroll(b, "up", a.count),
  "scroll.left": (b, a) => VimmaActors.scroll(b, "left", a.count),
  "scroll.right": (b, a) => VimmaActors.scroll(b, "right", a.count),
  "scroll.half_down": (b, a) => VimmaActors.scroll(b, "half_down", a.count),
  "scroll.half_up": (b, a) => VimmaActors.scroll(b, "half_up", a.count),
  "scroll.top": (b) => VimmaActors.scroll(b, "top"),
  "scroll.bottom": (b) => VimmaActors.scroll(b, "bottom"),
  // Esc in insert (escape.mjs: blur); the focusout recheck that follows stays in normal.
  "mode.normal": (b) => {
    setBrowserMode(b, "normal");
    VimmaActors.blur(b);
  },
  "hint.follow": (b, a) => VimmaHost._startHints(b, a),
  "hint.follow_new_tab": (b, a) => VimmaHost._startHints(b, a),
  // Explicit insert, even with no text field to focus (pass-through for pages that take keys).
  "mode.insert": (b) => {
    setBrowserMode(b, "insert");
    VimmaActors.focusInput(b);
  },
  // Find in page over Firefox's find bar (m1-find).
  "find.forward": (b) => findOf(b)?.start(b, false),
  "find.backward": (b) => findOf(b)?.start(b, true),
  "find.next": (b) => findOf(b)?.again(b, false),
  "find.previous": (b) => findOf(b)?.again(b, true),
});

/**
 * The find state of the window that owns `browser`.
 * @param {any} browser
 * @returns {Find | undefined}
 */
function findOf(browser) {
  const win = browser?.ownerDocument?.defaultView;
  return (win && states.get(win))?.find ?? undefined;
}

/**
 * Every action id the host implements: the one source for the help overlay's dimmed rows, the
 * not-implemented notice and (when wired) the which-key strip. Whether one runs right now is
 * `VimmaHost._runnable(state, id)`, which adds "a page with our actor has focus" for
 * CONTENT_RUNNERS.
 * @type {ReadonlySet<string>}
 */
export const RUNNABLE = Object.freeze(
  new Set([...Object.keys(RUNNERS), ...Object.keys(CONTENT_RUNNERS)]),
);

/** @type {WeakMap<Window, WindowState>} */
const states = new WeakMap();

/** @param {Event} e */
function consume(e) {
  e.preventDefault();
  e.stopPropagation();
}

export const VimmaHost = {
  /**
   * Test-only: formatted chords seen by any window, oldest first.
   * @type {string[]}
   */
  _lastChords: [],

  /**
   * Test-only: hint collections finished (with or without targets), across windows.
   * @type {number}
   */
  _hintRuns: 0,

  /** @param {Window} win */
  init(win) {
    if (states.has(win)) return;
    const keymap = compileKeymap();
    /** @type {WindowState} */
    const state = {
      win,
      keymap,
      onKeyDown: (e) => this._onKeyDown(win, state, e),
      // The overlay is modal, but tabs can still change underneath it (a script closes the
      // selected tab): close it and focus the newly selected browser.
      onTabSelect: () => {
        this._cancelPending(win, state);
        this._cancelHints(state);
        state.help.close({ tabChanged: true });
      },
      dispatcher: createDispatcher(keymap),
      help: new HelpOverlay(win, keymap, RUNNABLE),
      notice: new Notice(win),
      tabStrip: null,
      timer: null,
      onCancelHints: () => this._cancelHints(state),
      hint: null,
      hintOverlay: new HintOverlay(win),
      listeners: new Set(),
      statusBar: null,
      find: new Find(win, () => this._emit(state)),
    };
    states.set(win, state);
    win.addEventListener("keydown", state.onKeyDown, true);
    win.addEventListener("TabSelect", state.onTabSelect, true);
    // The labels are drawn for one layout of the page: a resize or a click moves on.
    win.addEventListener("resize", state.onCancelHints);
    win.addEventListener("mousedown", state.onCancelHints, true);
    // After the keys: an upstream change in tab code must not cost us ctrl+b.
    try {
      const tabStrip = new TabStrip(win);
      tabStrip.init();
      state.tabStrip = tabStrip;
    } catch (e) {
      console.error("vimma: tab strip not hidden", e);
    }
    try {
      const statusBar = new StatusBar(win, {
        status: () => this.status(win),
        subscribe: (fn) => this.onStateChange(win, fn),
        runnable: () => this.runnable(),
        keymap,
      });
      statusBar.init();
      state.statusBar = statusBar;
    } catch (e) {
      console.error("vimma: no status bar", e);
    }
  },

  /** @param {Window} win */
  uninit(win) {
    const state = states.get(win);
    if (!state) return;
    this._cancelPending(win, state);
    win.removeEventListener("keydown", state.onKeyDown, true);
    win.removeEventListener("TabSelect", state.onTabSelect, true);
    win.removeEventListener("resize", state.onCancelHints);
    win.removeEventListener("mousedown", state.onCancelHints, true);
    this._cancelHints(state);
    state.help.destroy();
    state.notice.destroy();
    state.tabStrip?.uninit();
    state.statusBar?.uninit();
    state.find.destroy();
    state.listeners.clear();
    states.delete(win);
  },

  /**
   * What the status bar and which-key strip show: the mode keys are dispatched in and the keys
   * of a pending sequence (dispatcher.pending() labels); `command` while a `/` or `?` search is
   * typed (Vim's command-line mode), and that search or the page's last one (m1-find).
   * @param {Window} win
   * @returns {{ mode: Mode, pending: string[], find?: FindStatus | null }}
   */
  status(win) {
    const state = states.get(win);
    if (!state) return { mode: "insert", pending: [] };
    const browser = /** @type {any} */ (win).gBrowser?.selectedBrowser;
    return {
      mode: state.find.typing ? "command" : this._mode(state),
      pending: state.dispatcher.pending(),
      find: browser ? state.find.status(browser) : null,
    };
  },

  /**
   * Calls `fn` after anything that may change `status(win)`. Cheap to call often: listeners
   * debounce. Whatever changes the mode (focus detection, a content actor) calls `_emit`.
   * @param {Window} win
   * @param {() => void} fn
   * @returns {() => void} unsubscribe
   */
  onStateChange(win, fn) {
    const state = states.get(win);
    if (!state) return () => {};
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  },

  /**
   * Action ids the host implements (RUNNABLE): the which-key strip greys the rest, as the help
   * overlay dims them.
   * @returns {ReadonlySet<string>}
   */
  runnable() {
    return RUNNABLE;
  },

  /** @param {WindowState} state */
  _emit(state) {
    for (const fn of state.listeners) {
      try {
        fn();
      } catch (e) {
        console.error("vimma: state listener failed", e);
      }
    }
  },

  /**
   * A focus report from the content actor (VimmaParent) for a tab's <browser>.
   * @param {any} browser
   * @param {{ descriptor: EditableDescriptor, trigger: InsertTrigger }} report
   */
  onFocusReport(browser, { descriptor, trigger }) {
    const mode = browserModes.get(browser) ?? "normal";
    const next = insertModeAfterFocus({ mode, trigger, descriptor });
    setBrowserMode(browser, next === "insert" ? "insert" : "normal");
  },

  /**
   * Called after a tab's page mode changes (normal ↔ insert), whatever caused it (a focus
   * report, `i`, `Esc`): tells the owning window's state listeners (the status bar).
   * The listeners read the mode back through `status(win)`, so the mode argument is unused.
   * @type {(browser: any, mode: "normal" | "insert") => void}
   */
  onModeChange: (browser) => {
    // defaultView is the WindowProxy init() was given; ownerGlobal is the inner window, a
    // different object as a WeakMap key.
    const win = browser?.ownerDocument?.defaultView;
    const state = win && states.get(win);
    if (state) VimmaHost._emit(state);
  },

  /**
   * The page mode keys get while `browser` has focus. A page without our actor (extension
   * pages, data:, view-source:) stays in insert, as every page was before M1.
   * @param {any} browser
   * @returns {"normal" | "insert"}
   */
  _browserMode(browser) {
    if (!VimmaActors.has(browser)) return "insert";
    return browserModes.get(browser) ?? "normal";
  },

  /**
   * The content <browser> that has focus, or null when focus is in chrome (URL bar, find bar).
   * @param {Window} win
   */
  _focusedBrowser(win) {
    const el = win.document.activeElement;
    return el?.localName === "browser" ? el : null;
  },

  /**
   * `help` while the overlay is open; the focused page's mode; `insert` in chrome, so chrome
   * text fields keep their keys and only global chords are ours.
   * @param {WindowState} state
   * @returns {Mode}
   */
  _mode(state) {
    if (state.help.isOpen) return "help";
    const browser = this._focusedBrowser(state.win);
    if (state.hint && state.hint.browser === browser) return "hint";
    return browser ? this._browserMode(browser) : "insert";
  },

  /**
   * @param {WindowState} state
   * @param {string} id
   */
  _runnable(state, id) {
    if (!RUNNABLE.has(id)) return false;
    if (id in RUNNERS) return true;
    return !!this._contentBrowser(state);
  },

  /**
   * The focused content <browser> when it has our actor, else null.
   * @param {WindowState} state
   */
  _contentBrowser(state) {
    const browser = this._focusedBrowser(state.win);
    return browser && VimmaActors.has(browser) ? browser : null;
  },

  /**
   * Whether any action reachable from `node` is runnable now.
   * @param {WindowState} state
   * @param {TrieNode} node
   * @returns {boolean}
   */
  _leadsToRunnable(state, node) {
    if (node.action && this._runnable(state, node.action.id)) return true;
    for (const child of node.children.values()) {
      if (this._leadsToRunnable(state, child)) return true;
    }
    return false;
  },

  /**
   * @param {Window} win
   * @param {WindowState} state
   * @param {KeyboardEvent} e
   */
  _onKeyDown(win, state, e) {
    const chord = chordFromEvent(e);
    if (!chord) return; // a bare modifier
    const key = formatKey(chord);
    // Focus left the page the hints are on (URL bar, another pane): they no longer apply.
    if (state.hint && state.hint.browser !== this._focusedBrowser(win)) this._cancelHints(state);
    const mode = this._mode(state);
    this._lastChords.push(key);
    if (this._lastChords.length > MAX_RECORDED) this._lastChords.shift();
    if (Services.prefs.getBoolPref(DEBUG_PREF, false)) {
      const mods = MODIFIERS.filter((m) => chord[m]);
      console.debug("vimma key", { key, mods, mode });
    }
    // Enter and Esc in a `/` search, and keys typed before its input exists (m1-find).
    if (state.dispatcher.pending().length === 0 && state.find.onKeyDown(e)) {
      this._emit(state);
      return;
    }
    // Typing into the help filter: plain keys belong to the input; Esc and chords stay ours.
    const typing = !chord.ctrl && !chord.alt && !chord.meta && chord.key !== "esc";
    if (typing && state.help.filterFocused && state.dispatcher.pending().length === 0) return;
    this._dispatch(win, state, e, mode, chord);
    this._emit(state);
  },

  /**
   * @param {Window} win
   * @param {WindowState} state
   * @param {KeyboardEvent} e
   * @param {Mode} mode
   * @param {Chord} chord
   */
  _dispatch(win, state, e, mode, chord) {
    const first = state.dispatcher.pending().length === 0;
    this._clearTimer(win, state);
    const result = state.dispatcher.dispatch(mode, chord);
    // The overlay is modal: in help mode every key is ours, handled or not, so nothing reaches
    // the browser underneath (ctrl+w would close the tab behind it). Hint mode too: every key
    // is a label key or ignored, never the page's.
    const modal = mode === "help" || mode === "hint";
    switch (result.kind) {
      case "pass":
        if (modal) consume(e);
        if (mode === "hint") this._hintKey(state, chord);
        return;
      case "cancel":
        consume(e);
        return;
      case "pending": {
        // The first key of a sequence that leads to nothing runnable yet passes, so ctrl+w (the
        // M4 <C-w> pane keys) keeps closing the tab. A count is not in the trie, so it is ours.
        const node = first && !modal && state.keymap.trie(mode).children.get(formatKey(chord));
        if (node && !this._leadsToRunnable(state, node)) {
          state.dispatcher.reset();
          return;
        }
        consume(e);
        // Only an ambiguous sequence (g vs gg) times out; a bare prefix waits for the next key.
        if (state.dispatcher.ambiguous()) {
          state.timer = win.setTimeout(() => {
            state.timer = null;
            this._run(state, state.dispatcher.flush());
            this._emit(state);
          }, state.dispatcher.timeoutMs);
        }
        return;
      }
      case "action": {
        if (result.replay) {
          // The earlier keys completed an action; this key starts over (core rule 5) and decides
          // for itself whether it is consumed.
          this._run(state, result);
          this._dispatch(win, state, e, this._mode(state), chord);
          return;
        }
        if (first && !modal && !this._runnable(state, result.action.id)) return;
        consume(e);
        // Another binding in hint mode (a ctrl+b sequence) leaves hint mode first.
        if (mode === "hint" && result.action.id !== "hint.cancel") this._cancelHints(state);
        this._run(state, result);
      }
    }
  },

  /**
   * Runs a completed action: on the focused page (CONTENT_RUNNERS), else in chrome (RUNNERS),
   * else says it is not implemented yet. A content action with no page of ours focused does
   * nothing: it is built, just not applicable here. A single key the host cannot run never gets
   * here: `_dispatch` leaves it to Firefox, without a notice.
   * @param {WindowState} state  carries `win` for the runners
   * @param {DispatchResult | null} result
   */
  _run(state, result) {
    if (result?.kind !== "action") return;
    const { action } = result;
    const contentRunner = CONTENT_RUNNERS[action.id];
    if (contentRunner) {
      const browser = this._contentBrowser(state);
      if (browser) contentRunner(browser, action);
      return;
    }
    const runner = RUNNERS[action.id];
    if (runner) runner(state, action);
    else state.notice.show(notImplementedText(action));
  },

  /**
   * Test-only: a window's state.
   * @param {Window} win
   */
  _state(win) {
    return states.get(win);
  },

  /**
   * Test-only: the window's hint mode, or null.
   * @param {Window} win
   */
  _hints(win) {
    const hint = states.get(win)?.hint;
    if (!hint) return null;
    return { action: hint.action, typed: hint.hs?.typed ?? "", hints: hint.hs?.hints ?? [] };
  },

  /**
   * `f` / `F`: collects the targets, then enters hint mode with a label on each. With none,
   * the tab stays in normal (the status bar will say so, M2).
   * @param {any} browser
   * @param {Action} action
   */
  _startHints(browser, action) {
    // The window proxy init() was given; ownerGlobal is the inner window, another key.
    const state = states.get(browser.ownerDocument.defaultView);
    if (!state) return;
    this._cancelHints(state);
    const id = /** @type {HintAction} */ (action.id);
    /** @type {HintSession} */
    const session = { browser, action: id, hs: null, buffered: [] };
    state.hint = session;
    this._emit(state);
    VimmaActors.collectHints(browser, id)
      .then((targets) => {
        if (state.hint !== session) return;
        try {
          session.hs = startHints(targets, { action: id });
        } catch (e) {
          if (!(e instanceof HintError && e.code === "no-targets")) throw e;
          state.hint = null;
          this._emit(state);
          console.info("vimma: no hint targets");
          return;
        }
        state.hintOverlay.show(browser, session.hs.hints);
        for (const chord of session.buffered.splice(0)) {
          if (state.hint !== session) break;
          this._hintKey(state, chord);
        }
      })
      .catch((e) => {
        console.error("vimma: hints failed", e);
        if (state.hint === session) this._cancelHints(state);
      })
      .finally(() => this._hintRuns++);
  },

  /**
   * One key in hint mode (core hintKey): narrow, follow, or nothing.
   * @param {WindowState} state
   * @param {Chord} chord
   */
  _hintKey(state, chord) {
    const session = state.hint;
    if (!session) return;
    if (!session.hs) {
      session.buffered.push(chord);
      return;
    }
    const { state: next, result } = hintKey(session.hs, chord);
    session.hs = next;
    switch (result.kind) {
      case "cancel":
        this._cancelHints(state);
        return;
      case "narrow":
        state.hintOverlay.filter(next.typed);
        return;
      case "select":
        this._cancelHints(state);
        if (result.action === "hint.follow_new_tab") {
          VimmaActors.openInBackground(session.browser, result.target);
        } else {
          VimmaActors.activateHint(result.target);
        }
    }
  },

  /**
   * Leaves hint mode, if on: removes the labels and drops a collection in flight.
   * @param {WindowState} state
   */
  _cancelHints(state) {
    if (!state.hint) return;
    state.hint = null;
    state.hintOverlay.hide();
    this._emit(state); // the status bar leaves HINT, also when no key ended hint mode
    VimmaActors.cancelHints(state.win);
  },

  /**
   * @param {Window} win
   * @param {WindowState} state
   */
  _cancelPending(win, state) {
    this._clearTimer(win, state);
    state.dispatcher.reset();
    this._emit(state);
  },

  /**
   * @param {Window} win
   * @param {WindowState} state
   */
  _clearTimer(win, state) {
    if (state.timer === null) return;
    win.clearTimeout(state.timer);
    state.timer = null;
  },
};
