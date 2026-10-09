/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Chrome-window key capture (spec: docs/specs/m0-key-capture.md). Sees every keydown before the
// URL bar, about: pages and the PDF viewer; never consumes keys yet.

import { chordFromEvent, formatKey } from "../core/keys.mjs";

const DEBUG_PREF = "vimma.debug.keys";
const MAX_RECORDED = 50;
const MODIFIERS = /** @type {const} */ (["ctrl", "alt", "shift", "meta"]);

/** @type {WeakMap<Window, (e: KeyboardEvent) => void>} */
const handlers = new WeakMap();

export const VimmaHost = {
  /**
   * Test-only: formatted chords seen by any window, oldest first.
   * @type {string[]}
   */
  _lastChords: [],

  /** @param {Window} win */
  init(win) {
    if (handlers.has(win)) return;
    /** @param {KeyboardEvent} e */
    const handler = (e) => this._onKeyDown(e);
    handlers.set(win, handler);
    win.addEventListener("keydown", handler, true);
  },

  /** @param {Window} win */
  uninit(win) {
    const handler = handlers.get(win);
    if (!handler) return;
    win.removeEventListener("keydown", handler, true);
    handlers.delete(win);
  },

  /** @param {KeyboardEvent} e */
  _onKeyDown(e) {
    const chord = chordFromEvent(e);
    if (!chord) return; // a bare modifier
    const key = formatKey(chord);
    this._lastChords.push(key);
    if (this._lastChords.length > MAX_RECORDED) this._lastChords.shift();
    if (Services.prefs.getBoolPref(DEBUG_PREF, false)) {
      const mods = MODIFIERS.filter((m) => chord[m]);
      console.debug("vimma key", { key, mods, mode: "normal" });
    }
  },
};
