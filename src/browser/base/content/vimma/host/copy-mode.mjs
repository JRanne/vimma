/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Copy mode's actions on the focused page (spec: docs/specs/m1-copy-mode.md): `v` / `prefix+[`
// enter it (the `visual` mode), the motions move the caret in the focused frame, `v` starts or
// drops a selection, `y` copies it as plain text. VimmaHost spreads these into CONTENT_RUNNERS;
// Esc is its `mode.normal`, which asks the frame to leave copy mode first.

import { VimmaActors } from "../actors/VimmaActors.sys.mjs";

/** @import { Action } from "../core/dispatcher.mjs" */

/** Action id → the frame's motion (actors/caret.mjs). */
const MOTIONS = Object.freeze({
  "caret.left": "left",
  "caret.right": "right",
  "caret.up": "up",
  "caret.down": "down",
  "caret.word_forward": "word_forward",
  "caret.word_backward": "word_backward",
  "caret.line_start": "line_start",
  "caret.line_end": "line_end",
  "caret.top": "top",
  "caret.bottom": "bottom",
});

/** Shown when there is no text on screen to put the caret in. */
export const NO_TEXT = "copy mode: no text on screen";
/** Shown after `y` with nothing selected. */
export const NOTHING_TO_YANK = "nothing to yank";

/**
 * @param {string} text
 * @returns {string}
 */
export function yankedText(text) {
  const n = [...text].length;
  return `yanked ${n} ${n === 1 ? "char" : "chars"}`;
}

/**
 * The runners, given how the host sets a tab's page mode and shows a notice in its window.
 * The mode changes before the frame is asked, so the next key is already dispatched in it.
 * @param {(browser: any, mode: "normal" | "visual") => void} setMode
 * @param {(browser: any, text: string) => void} notify
 * @returns {Record<string, (browser: any, action: Action) => void>}
 */
export function copyModeRunners(setMode, notify) {
  /** Copy mode is over in the frame (no text, or it navigated): back to normal, told why. */
  const leave = (/** @type {any} */ b, /** @type {string | null} */ why) => {
    setMode(b, "normal");
    if (why) notify(b, why);
  };
  /** @type {Record<string, (browser: any, action: Action) => void>} */
  const runners = {
    "mode.visual": async (b) => {
      setMode(b, "visual");
      if (!(await VimmaActors.caret(b, "enter"))) leave(b, NO_TEXT);
    },
    "selection.toggle": async (b) => {
      if (!(await VimmaActors.caret(b, "toggle"))) leave(b, null);
    },
    "selection.yank": async (b) => {
      setMode(b, "normal");
      const text = await VimmaActors.caret(b, "yank");
      if (typeof text !== "string" || !text) {
        notify(b, NOTHING_TO_YANK);
        return;
      }
      Cc["@mozilla.org/widget/clipboardhelper;1"]
        .getService(Ci.nsIClipboardHelper)
        .copyString(text);
      notify(b, yankedText(text));
    },
  };
  for (const [id, op] of Object.entries(MOTIONS)) {
    runners[id] = async (b, a) => {
      if (!(await VimmaActors.caret(b, op, a.count))) leave(b, null);
    };
  }
  return runners;
}
