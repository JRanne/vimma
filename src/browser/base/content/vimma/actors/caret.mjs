/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Copy mode in one frame (spec: docs/specs/m1-copy-mode.md), for VimmaChild. Firefox's caret
// browsing (F7) without its pref: the motions are nsISelectionController's, the methods F7's
// key bindings call, and the caret is enabled on this document's PresShell only.

/**
 * Motions: [nsISelectionController method, forward].
 * @type {Readonly<Record<string, ["characterMove" | "lineMove" | "wordMove" | "intraLineMove" | "completeMove", boolean]>>}
 */
const MOVES = Object.freeze({
  left: ["characterMove", false],
  right: ["characterMove", true],
  up: ["lineMove", false],
  down: ["lineMove", true],
  word_forward: ["wordMove", true],
  word_backward: ["wordMove", false],
  line_start: ["intraLineMove", false],
  line_end: ["intraLineMove", true],
  top: ["completeMove", false],
  bottom: ["completeMove", true],
});
/** The ops that are not motions. */
const OPS = new Set(["enter", "toggle", "yank", "exit"]);
/** A count above this is cut to it (`9999j`): each step is a layout query. */
const MAX_COUNT = 1000;
/** At most this many text nodes are searched for the first one on screen. */
const SEARCH_LIMIT = 20000;
/** NodeFilter.SHOW_TEXT (a system module has no NodeFilter global). */
const SHOW_TEXT = 0x4;

/**
 * Whether `data` is a well-formed copy-mode message: a known op, and a count that is a positive
 * safe integer when present.
 * @param {unknown} data
 * @returns {data is { op: string, count?: number }}
 */
export function isCaretMessage(data) {
  if (!data || typeof data !== "object") return false;
  const { op, count } = /** @type {{ op?: unknown, count?: unknown }} */ (data);
  if (typeof op !== "string" || !(Object.hasOwn(MOVES, op) || OPS.has(op))) return false;
  return count === undefined || (Number.isSafeInteger(count) && /** @type {number} */ (count) > 0);
}

/**
 * The first point of text inside the viewport, in document order: where the caret goes when
 * no selection is on screen.
 * @param {Window} win
 * @returns {{ node: Node, offset: number } | null}
 */
function firstTextOnScreen(win) {
  const doc = win.document;
  if (!doc.body) return null;
  const walker = doc.createTreeWalker(doc.body, SHOW_TEXT);
  const range = doc.createRange();
  let node = walker.nextNode();
  for (let i = 0; node && i < SEARCH_LIMIT; i++, node = walker.nextNode()) {
    if (!node.nodeValue?.trim()) continue;
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (!(r.height > 0 && r.bottom > 0 && r.top < win.innerHeight)) continue;
    if (r.top >= 0) return { node, offset: 0 };
    // A paragraph that starts above the viewport: its first character on screen.
    const pos = doc.caretPositionFromPoint(Math.max(r.left, 0) + 1, 1);
    return { node, offset: pos?.offsetNode === node ? pos.offset : 0 };
  }
  return null;
}

/**
 * Whether the selection's first range is at least partly on screen (a collapsed one too).
 * @param {Selection} sel
 * @param {Window} win
 */
function selectionOnScreen(sel, win) {
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return r.height > 0 && r.bottom > 0 && r.top < win.innerHeight;
}

/** One frame's copy mode. */
export class Caret {
  /** Whether copy mode is on in this document. */
  on = false;
  /** Whether motions extend a selection (`v`) or move a bare caret. */
  selecting = false;

  /**
   * Runs a checked message. Replies: `enter` and motions true when done, false when copy mode
   * is not on here (the page navigated since) or there is no text on screen; `yank` the
   * selected text, "" for none; `toggle` and `exit` true.
   * @param {Window} win
   * @param {nsISelectionController} selCon  the frame's
   * @param {{ op: string, count?: number }} msg
   * @returns {boolean | string}
   */
  run(win, selCon, { op, count = 1 }) {
    const sel = win.getSelection();
    if (!sel) return false;
    switch (op) {
      case "enter": {
        // Vim's cursor: at the selection still on screen, else the top of the viewport.
        if (!selectionOnScreen(sel, win)) {
          const at = firstTextOnScreen(win);
          if (!at) return false;
          sel.collapse(at.node, at.offset);
        }
        this.on = true;
        this.selecting = !sel.isCollapsed;
        selCon.setDisplaySelection(Ci.nsISelectionController.SELECTION_ON);
        selCon.setCaretVisibilityDuringSelection(true);
        selCon.setCaretEnabled(true);
        return true;
      }
      case "toggle":
        if (!this.on) return false;
        if (this.selecting && sel.focusNode) sel.collapse(sel.focusNode, sel.focusOffset);
        this.selecting = !this.selecting;
        return true;
      case "yank": {
        const text = this.on ? sel.toString() : "";
        this.exit(sel, selCon);
        return text;
      }
      case "exit":
        this.exit(sel, selCon);
        return true;
    }
    const move = MOVES[op];
    if (!move || !this.on || !sel.rangeCount) return false;
    const [method, forward] = move;
    // A focus change turns the caret off (nsFocusManager::UpdateCaret, pref off): on again.
    selCon.setCaretEnabled(true);
    for (let i = 0; i < Math.min(count, MAX_COUNT); i++) {
      try {
        selCon[method](forward, this.selecting);
      } catch {
        break; // nowhere further to go
      }
    }
    // A move scrolls only its nearest scrollable; the view follows the caret everywhere.
    selCon.scrollSelectionIntoView(
      Ci.nsISelectionController.SELECTION_NORMAL,
      Ci.nsISelectionController.SELECTION_FOCUS_REGION,
      Ci.nsISelectionController.SCROLL_SYNCHRONOUS,
    );
    return true;
  }

  /**
   * Leaves copy mode: the selection collapses to the caret (where a later `v` or `/` starts)
   * and the caret is hidden again.
   * @param {Selection} sel
   * @param {nsISelectionController} selCon
   */
  exit(sel, selCon) {
    if (!this.on) return;
    this.on = false;
    this.selecting = false;
    if (sel.focusNode) sel.collapse(sel.focusNode, sel.focusOffset);
    selCon.setCaretEnabled(false);
  }
}
