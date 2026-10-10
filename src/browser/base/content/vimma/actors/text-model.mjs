/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The text around the caret as one string, for copy mode's Vim motions (core motions.mjs; spec:
// docs/specs/m1-copy-mode.md § Settled). Each rendered text node is copied in document order with
// its length kept, so a string index maps back to a node and offset; a block boundary adds BLOCK
// and a <br> "\n" between nodes. Collapsible white space (not `pre`) has its line breaks and tabs
// turned into spaces, as layout shows them.

import { BLOCK } from "../core/motions.mjs";

/** NodeFilter values (a system module has no NodeFilter global). */
const SHOW_ELEMENT = 0x1;
const SHOW_TEXT = 0x4;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;

/** Subtrees whose text is never the page's visible text. */
const SKIP = new Set(["script", "style", "noscript", "template", "select", "textarea", "head"]);

/** @typedef {{ node: Text, start: number, end: number }} Segment */
/** @typedef {{ node: Node, offset: number }} Point */

/**
 * The flattened text and the way back to the DOM.
 * @typedef {object} TextModel
 * @property {string} text
 * @property {number} at  the caret's index in `text`
 * @property {(i: number, after?: boolean) => Point | null} pointAt  a string index as a DOM
 *   point; `after` prefers the end of the node before it over the start of the one after */

/**
 * The text node a caret at (node, offset) sits in or just before, and the offset in it.
 * @param {Document} doc
 * @param {Node} node
 * @param {number} offset
 * @returns {{ text: Text, offset: number } | null}
 */
function textPoint(doc, node, offset) {
  if (node.nodeType === 3) return { text: /** @type {Text} */ (node), offset };
  const walker = doc.createTreeWalker(doc.documentElement, SHOW_TEXT);
  const child = node.childNodes[offset];
  if (child) {
    // The first text node at or after the child, else the last one before it.
    walker.currentNode = child;
    const at = child.nodeType === 3 ? child : walker.nextNode();
    if (at) return { text: /** @type {Text} */ (at), offset: 0 };
    walker.currentNode = child;
  } else {
    // After the last child: the node's last text, else the last one before it.
    let last = node;
    while (last.lastChild) last = last.lastChild;
    walker.currentNode = last;
    if (last.nodeType === 3) {
      const t = /** @type {Text} */ (last);
      return { text: t, offset: t.length };
    }
  }
  const before = walker.previousNode();
  return before
    ? { text: /** @type {Text} */ (before), offset: before.nodeValue?.length ?? 0 }
    : null;
}

/**
 * Builds the model around the caret: about `reach` characters each way.
 * @param {Window} win
 * @param {Node} node  the caret's node
 * @param {number} offset
 * @param {number} reach
 * @returns {TextModel | null}
 */
export function textAround(win, node, offset, reach) {
  const doc = win.document;
  const root = doc.body ?? doc.documentElement;
  if (!root) return null;
  const start = textPoint(doc, node, offset);
  if (!start) return null;
  /** @type {Map<Element, boolean>} */
  const blocky = new Map();
  /** @type {(el: Element) => boolean} */
  const isBlock = (el) => {
    let b = blocky.get(el);
    if (b === undefined) {
      const display = win.getComputedStyle(el)?.display ?? "inline";
      b = !(display === "inline" || display === "contents" || display.startsWith("ruby"));
      blocky.set(el, b);
    }
    return b;
  };
  /** @type {(t: Text) => Element | null} */
  const blockOf = (t) => {
    for (let el = t.parentElement; el; el = el.parentElement) if (isBlock(el)) return el;
    return null;
  };
  const filter = {
    /** @param {Node} n */
    acceptNode(n) {
      if (n.nodeType !== 1) return FILTER_ACCEPT;
      const el = /** @type {Element} */ (n);
      if (SKIP.has(el.localName)) return FILTER_REJECT;
      return el.checkVisibility() ? FILTER_ACCEPT : FILTER_REJECT;
    },
  };
  /** @type {(Text | "br")[]} */
  const after = [];
  /** @type {(Text | "br")[]} */
  const before = [];
  const walker = doc.createTreeWalker(root, SHOW_TEXT | SHOW_ELEMENT, filter);
  const collect = (/** @type {(Text | "br")[]} */ into, /** @type {boolean} */ forward) => {
    walker.currentNode = start.text;
    let chars = 0;
    for (let n = forward ? walker.nextNode() : walker.previousNode(); n && chars < reach;) {
      if (n.nodeType === 3) {
        into.push(/** @type {Text} */ (n));
        chars += n.nodeValue?.length ?? 0;
      } else if (/** @type {Element} */ (n).localName === "br") into.push("br");
      n = forward ? walker.nextNode() : walker.previousNode();
    }
  };
  collect(after, true);
  collect(before, false);
  const items = [...before.reverse(), start.text, ...after];

  let text = "";
  /** @type {Segment[]} */
  const segments = [];
  /** @type {Element | null | undefined} */
  let block;
  let pendingBreak = false;
  for (const item of items) {
    if (item === "br") {
      pendingBreak = true;
      continue;
    }
    const b = blockOf(item);
    if (block !== undefined && b !== block) text += BLOCK;
    else if (pendingBreak) text += "\n";
    pendingBreak = false;
    block = b;
    const parent = item.parentElement;
    const collapse = parent ? win.getComputedStyle(parent)?.whiteSpaceCollapse : "collapse";
    let value = item.nodeValue ?? "";
    if (collapse === "collapse" || collapse === undefined) value = value.replace(/[\n\r\t]/g, " ");
    else if (collapse === "preserve-breaks") value = value.replace(/\t/g, " ");
    segments.push({ node: item, start: text.length, end: text.length + value.length });
    text += value;
  }
  const own = /** @type {Segment} */ (segments.find((s) => s.node === start.text));
  return {
    text,
    at: own.start + Math.min(start.offset, own.end - own.start),
    pointAt(i, preferAfter = false) {
      /** @type {Segment | undefined} */
      let hit;
      for (const s of segments) {
        if (preferAfter ? s.start < i && i <= s.end : s.start <= i && i < s.end) {
          hit = s;
          break;
        }
      }
      // A position between nodes (at a block boundary): the next node's start, else the end.
      hit ??= segments.find((s) => s.start >= i) ?? segments.at(-1);
      if (!hit) return null;
      return { node: hit.node, offset: Math.max(0, Math.min(i, hit.end) - hit.start) };
    },
  };
}
