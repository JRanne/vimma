/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Chrome-window key capture and dispatch (specs: docs/specs/m0-key-capture.md,
// docs/specs/m0-help-overlay.md). Sees every keydown before the URL bar, about: pages and the
// PDF viewer, runs it through the vimma-core dispatcher and consumes the keys that are ours.

import { createDispatcher } from "../core/dispatcher.mjs";
import { chordFromEvent, formatKey } from "../core/keys.mjs";
import { compileKeymap } from "../core/keymap.mjs";
import { HelpOverlay } from "../ui/help-overlay.mjs";
import { TabStrip } from "../ui/tabstrip.mjs";

/** @import { Chord } from "../core/keys.mjs" */
/** @import { Mode } from "../core/modes.mjs" */
/** @import { Action, DispatchResult } from "../core/dispatcher.mjs" */

const DEBUG_PREF = "vimma.debug.keys";
const MAX_RECORDED = 50;
const MODIFIERS = /** @type {const} */ (["ctrl", "alt", "shift", "meta"]);

/**
 * @typedef {object} WindowState
 * @property {(e: KeyboardEvent) => void} onKeyDown
 * @property {() => void} onTabSelect
 * @property {ReturnType<typeof createDispatcher>} dispatcher
 * @property {HelpOverlay} help
 * @property {TabStrip | null} tabStrip  hides Firefox's tab strip (m0-tabstrip-hidden)
 * @property {number | null} timer   pending-sequence timeout (dispatcher.flush)
 */

/**
 * What the host can execute so far. An action without an entry here is left to Firefox when it
 * is a single key outside help (Esc, ctrl+i, ctrl+u keep working until their milestones land;
 * revisit in M1 once `normal` mode is real); inside a sequence it is consumed, so
 * `ctrl+b <key>` never leaks the second key to the page.
 * @type {Record<string, (state: WindowState, action: Action) => void>}
 */
const RUNNERS = {
  "help.show": (s) => s.help.toggle(),
  "help.close": (s) => s.help.close(),
  "help.filter": (s) => s.help.focusFilter(),
};

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

  /** @param {Window} win */
  init(win) {
    if (states.has(win)) return;
    const keymap = compileKeymap();
    /** @type {WindowState} */
    const state = {
      onKeyDown: (e) => this._onKeyDown(win, state, e),
      // The overlay is modal, but tabs can still change underneath it (a script closes the
      // selected tab): close it and focus the newly selected browser.
      onTabSelect: () => {
        this._cancelPending(win, state);
        state.help.close({ tabChanged: true });
      },
      dispatcher: createDispatcher(keymap),
      help: new HelpOverlay(win, keymap),
      tabStrip: null,
      timer: null,
    };
    states.set(win, state);
    win.addEventListener("keydown", state.onKeyDown, true);
    win.addEventListener("TabSelect", state.onTabSelect, true);
    // After the keys: an upstream change in tab code must not cost us ctrl+b.
    try {
      const tabStrip = new TabStrip(win);
      tabStrip.init();
      state.tabStrip = tabStrip;
    } catch (e) {
      console.error("vimma: tab strip not hidden", e);
    }
  },

  /** @param {Window} win */
  uninit(win) {
    const state = states.get(win);
    if (!state) return;
    this._cancelPending(win, state);
    win.removeEventListener("keydown", state.onKeyDown, true);
    win.removeEventListener("TabSelect", state.onTabSelect, true);
    state.help.destroy();
    state.tabStrip?.uninit();
    states.delete(win);
  },

  /**
   * The window's mode and pending sequence, for the control socket's `state`
   * (docs/specs/m0-control-server.md), or null for a window without Vimma.
   * @param {Window} win
   * @returns {{ mode: Mode, pending: string[] } | null}
   */
  controlState(win) {
    const state = states.get(win);
    if (!state) return null;
    return { mode: this._mode(state), pending: state.dispatcher.pending() };
  },

  /**
   * M0 has no content actor to report focus in editable elements (M1), so outside the help
   * overlay every key is treated as typed into the page: `insert` mode, where only global
   * chords (prefix sequences, ctrl/alt/meta bindings) are ours.
   * @param {WindowState} state
   * @returns {Mode}
   */
  _mode(state) {
    return state.help.isOpen ? "help" : "insert";
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
    const mode = this._mode(state);
    this._lastChords.push(key);
    if (this._lastChords.length > MAX_RECORDED) this._lastChords.shift();
    if (Services.prefs.getBoolPref(DEBUG_PREF, false)) {
      const mods = MODIFIERS.filter((m) => chord[m]);
      console.debug("vimma key", { key, mods, mode });
    }
    // Typing into the help filter: plain keys belong to the input; Esc and chords stay ours.
    const typing = !chord.ctrl && !chord.alt && !chord.meta && chord.key !== "esc";
    if (typing && state.help.filterFocused && state.dispatcher.pending().length === 0) return;
    this._dispatch(win, state, e, mode, chord);
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
    // the browser underneath (ctrl+w would close the tab behind it).
    const modal = mode === "help";
    switch (result.kind) {
      case "pass":
        if (modal) consume(e);
        return;
      case "cancel":
        consume(e);
        return;
      case "pending":
        consume(e);
        // Only an ambiguous sequence (g vs gg) times out; a bare prefix waits for the next key.
        if (state.dispatcher.ambiguous()) {
          state.timer = win.setTimeout(() => {
            state.timer = null;
            this._run(state, state.dispatcher.flush());
          }, state.dispatcher.timeoutMs);
        }
        return;
      case "action": {
        if (result.replay) {
          // The earlier keys completed an action; this key starts over (core rule 5) and decides
          // for itself whether it is consumed.
          this._run(state, result);
          this._dispatch(win, state, e, this._mode(state), chord);
          return;
        }
        if (first && !modal && !(result.action.id in RUNNERS)) return;
        consume(e);
        this._run(state, result);
      }
    }
  },

  /**
   * @param {WindowState} state
   * @param {DispatchResult | null} result
   */
  _run(state, result) {
    if (result?.kind !== "action") return;
    RUNNERS[result.action.id]?.(state, result.action);
  },

  /**
   * @param {Window} win
   * @param {WindowState} state
   */
  _cancelPending(win, state) {
    this._clearTimer(win, state);
    state.dispatcher.reset();
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
