/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Child side of the Vimma actor (spec: docs/specs/m1-actor-insert-scroll.md). One per frame,
// including out-of-process iframes: reports focus changes in its own document as an
// EditableDescriptor (vimma-core editable.mjs) and runs scroll, blur and focus-input commands.

import { isEditable } from "../core/editable.mjs";

/** @import { EditableDescriptor } from "../core/editable.mjs" */
/** @import { ScrollKind } from "./VimmaActors.sys.mjs" */

/** j/k/h/l step in CSS pixels (Vimium's scrollStepSize). */
const STEP = 60;

/** Focus on these moves into another document, whose own child reports. */
const FRAMES = new Set(["iframe", "frame", "browser"]);

/** Candidates for `i`; isEditable decides. */
const TEXT_FIELDS = "input, textarea, [contenteditable]";

/**
 * The focused element, through open and closed shadow roots.
 * @param {Document} doc
 * @returns {Element | null}
 */
function deepActiveElement(doc) {
  let el = doc.activeElement;
  while (el?.openOrClosedShadowRoot?.activeElement) el = el.openOrClosedShadowRoot.activeElement;
  return el;
}

/**
 * @param {Element} el
 * @returns {EditableDescriptor}
 */
function describe(el) {
  const doc = el.ownerDocument;
  /** @type {EditableDescriptor} */
  const d = {
    tagName: el.localName,
    disabled: el.matches(":disabled"),
    role: el.getAttribute("role"),
    ariaReadOnly: el.getAttribute("aria-readonly") === "true",
    ariaDisabled: !!el.closest('[aria-disabled="true"]'),
    designMode: doc.designMode === "on",
    classes: [...el.classList],
  };
  const html = /** @type {HTMLInputElement} */ (el);
  if (el.localName === "input") d.type = html.type;
  if (el.localName === "input" || el.localName === "textarea") d.readOnly = html.readOnly;
  if (typeof html.isContentEditable === "boolean") d.isContentEditable = html.isContentEditable;
  return d;
}

/** Overflow values that lock an axis: a site's modal sets one on <html> or <body>. */
const LOCKED = new Set(["hidden", "clip"]);

/**
 * @param {Element} el
 * @param {boolean} vertical
 */
function overflowOf(el, vertical) {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return (vertical ? style?.overflowY : style?.overflowX) ?? "visible";
}

/**
 * Whether the page itself is scroll-locked on this axis. <body>'s overflow applies to the
 * viewport only while <html>'s is `visible` (CSS Overflow 3, § 3.3).
 * @param {Document} doc
 * @param {boolean} vertical
 */
function documentLocked(doc, vertical) {
  const html = doc.documentElement;
  const root = html ? overflowOf(html, vertical) : "visible";
  if (LOCKED.has(root)) return true;
  return root === "visible" && !!doc.body && LOCKED.has(overflowOf(doc.body, vertical));
}

/**
 * @param {Element} el
 * @param {boolean} vertical
 */
function canScroll(el, vertical) {
  const max = vertical ? el.scrollTopMax : el.scrollLeftMax;
  if (!(max > 0)) return false;
  const doc = el.ownerDocument;
  if (el === doc.scrollingElement) return !documentLocked(doc, vertical);
  const overflow = overflowOf(el, vertical);
  return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
}

/** At most this many elements are searched for the largest scrollable. */
const SEARCH_LIMIT = 10000;
/** A search that found nothing is not repeated for this long (holding j). */
const SEARCH_BACKOFF_MS = 1000;

/**
 * The parent element, stepping out of a shadow root to its host.
 * @param {Element} el
 * @returns {Element | null}
 */
function parentOf(el) {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return "host" in root ? /** @type {ShadowRoot} */ (root).host : null;
}

/** A find text no page contains (a noncharacter): resets the find buffer without moving. */
const NO_MATCH = "\uffff";
/** nsITypeAheadFind.FIND_INITIAL: a new search, as typing in the find bar starts. */
const FIND_INITIAL = 0;

/**
 * Whether the selection is a range at least partly inside the viewport.
 * @param {Selection} sel
 * @param {Window} win
 */
function selectionOnScreen(sel, win) {
  if (!sel.rangeCount || sel.isCollapsed) return false;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return r.bottom > 0 && r.top < win.innerHeight;
}

export class VimmaChild extends JSWindowActorChild {
  /** @type {WeakRef<Element> | null} the last largest scrollable, reused while it can scroll */
  #largest = null;
  /** When a search for the largest scrollable last found nothing (0: not since focus moved). */
  #emptySearchAt = 0;

  /** @param {Event} event */
  handleEvent(event) {
    const doc = this.document;
    switch (event.type) {
      case "focusin": {
        this.#emptySearchAt = 0;
        // Unretargeted: the element itself, also inside an open or closed shadow root.
        const target = /** @type {Element | null} */ (event.originalTarget);
        this.#report(target?.nodeType === 1 ? target : deepActiveElement(doc), "focusin");
        return;
      }
      case "focusout":
        // Focus moving to another element of this document reports its own focusin; checking
        // in between would flicker insert → normal → insert.
        if (/** @type {FocusEvent} */ (event).relatedTarget) return;
        this.#recheck();
        return;
      case "focus": {
        // The window gained focus (a click into this frame, back from a subframe or another
        // tab): the user is back on its focused element, which counts as a focusin. An editable
        // document root (designMode, contenteditable <body>) gets only this event.
        if (event.originalTarget !== this.contentWindow) return;
        this.#emptySearchAt = 0;
        this.#report(deepActiveElement(doc) ?? doc.body, "focusin");
        return;
      }
      case "mousedown": {
        // A click into an editable root whose window already has focus fires no focus event.
        const root = this.#editableRoot();
        if (root) this.#report(root, "focusin");
      }
    }
  }

  /**
   * The focused document root when it is editable as a whole (designMode, or a contenteditable
   * <body>/<html>), else null.
   * @returns {Element | null}
   */
  #editableRoot() {
    const doc = this.document;
    const el = deepActiveElement(doc) ?? doc.body;
    if (!el || (el !== doc.body && el !== doc.documentElement)) return null;
    const editable = doc.designMode === "on" || /** @type {HTMLElement} */ (el).isContentEditable;
    return editable ? el : null;
  }

  #recheck() {
    // A document that lost focus does not speak for the tab: the one that gained it does.
    if (!this.document.hasFocus()) return;
    this.#report(deepActiveElement(this.document) ?? this.document.body, "recheck");
  }

  /**
   * @param {Element | null} el
   * @param {"focusin" | "recheck"} trigger
   */
  #report(el, trigger) {
    if (!el || FRAMES.has(el.localName)) return;
    this.sendAsyncMessage("Vimma:Focus", { descriptor: describe(el), trigger });
  }

  /** @param {{ name: string, data: any }} msg */
  receiveMessage(msg) {
    switch (msg.name) {
      case "Vimma:Scroll":
        return this.#scroll(msg.data.kind, msg.data.count);
      case "Vimma:Blur": {
        const el = deepActiveElement(this.document);
        if (el && el !== this.document.body) /** @type {HTMLElement} */ (el).blur();
        return undefined;
      }
      case "Vimma:FocusInput":
        return this.#focusInput();
      case "Vimma:ScrollPosition": {
        const win = this.contentWindow;
        return win ? { x: win.scrollX, y: win.scrollY } : null;
      }
      case "Vimma:FindAnchor":
        return this.#findAnchor();
      case "Vimma:ScrollTo": {
        const x = Number(msg.data?.x);
        const y = Number(msg.data?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          this.contentWindow?.scrollTo({ left: x, top: y, behavior: "instant" });
        }
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Where a find starts (spec m1-find): Vim searches from the cursor, so a selection or caret
   * still on screen stays where it is; otherwise the caret goes to the top of the viewport (left
   * alone when an element has focus: Firefox starts there; and in pdf.js, which finds itself).
   * Then the find's typed-text buffer is reset with a search that cannot match: nsITypeAheadFind
   * starts its first search at the first rendered match from the document start (its viewport
   * clip is ignored), and a search that extends the previous text continues from the previous
   * search's start; a non-empty, unrelated buffer makes it start at the caret.
   */
  #findAnchor() {
    const win = this.contentWindow;
    const doc = this.document;
    if (!win || doc.contentType === "application/pdf") return;
    const sel = win.getSelection();
    const active = deepActiveElement(doc);
    const focused = active && active !== doc.body && active !== doc.documentElement;
    if (sel && !focused && !selectionOnScreen(sel, win)) {
      try {
        const pos = win.scrollY || win.scrollX ? doc.caretPositionFromPoint(1, 1) : null;
        if (pos?.offsetNode) sel.collapse(pos.offsetNode, pos.offset);
        else sel.removeAllRanges();
      } catch {
        // a position that cannot hold the caret (inside a text control): leave the selection
      }
    }
    try {
      // FinderChild's Finder (toolkit/actors/FinderChild.sys.mjs) owns this frame's
      // nsITypeAheadFind; Firefox has no API to start a find at a point.
      const typeahead = this.manager.getActor("Finder")?.finder?._fastFind;
      typeahead?.find(NO_MATCH, false, FIND_INITIAL, true);
    } catch (e) {
      console.error("vimma: find start", e);
    }
  }

  #focusInput() {
    for (const el of this.document.querySelectorAll(TEXT_FIELDS)) {
      if (el.localName === "select" || !isEditable(describe(el)).editable) continue;
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      /** @type {HTMLElement} */ (el).focus();
      return true;
    }
    return false;
  }

  /**
   * @param {boolean} vertical
   * @returns {Element | null}
   */
  #scrollTarget(vertical) {
    const doc = this.document;
    const root = doc.scrollingElement;
    for (let el = deepActiveElement(doc); el && el !== root && el !== doc.body;) {
      if (canScroll(el, vertical)) return el;
      el = parentOf(el);
    }
    if (root && canScroll(root, vertical)) return root;
    // App shells, pdf.js and a locked page's modal scroll an inner element: take the largest
    // visible one. Cached; a search is bounded, and one that found nothing is not repeated
    // until focus moves or a second has passed.
    const last = this.#largest?.deref();
    if (last?.isConnected && canScroll(last, vertical)) return last;
    const now = Date.now();
    if (this.#emptySearchAt && now - this.#emptySearchAt < SEARCH_BACKOFF_MS) return null;
    let best = null;
    let area = 0;
    const all = doc.getElementsByTagName("*");
    for (let i = 0; i < Math.min(all.length, SEARCH_LIMIT); i++) {
      const el = /** @type {Element} */ (all[i]);
      if (!canScroll(el, vertical)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > area) [best, area] = [el, r.width * r.height];
    }
    this.#largest = best ? new WeakRef(best) : null;
    this.#emptySearchAt = best ? 0 : now;
    return best;
  }

  /**
   * @param {ScrollKind} kind
   * @param {number} count
   * @returns {boolean} whether this frame had something to scroll
   */
  #scroll(kind, count) {
    const vertical = kind !== "left" && kind !== "right";
    const el = this.#scrollTarget(vertical);
    if (!el) return false;
    const behavior = Services.prefs.getBoolPref("general.smoothScroll", true)
      ? "smooth"
      : "instant";
    const n = Math.max(1, Number(count) || 1);
    // Whole pixels, so d then u returns to the same place.
    const half = Math.round(el.clientHeight / 2) * n;
    /** @type {Record<ScrollKind, () => void>} */
    const run = {
      down: () => el.scrollBy({ top: STEP * n, behavior }),
      up: () => el.scrollBy({ top: -STEP * n, behavior }),
      right: () => el.scrollBy({ left: STEP * n, behavior }),
      left: () => el.scrollBy({ left: -STEP * n, behavior }),
      half_down: () => el.scrollBy({ top: half, behavior }),
      half_up: () => el.scrollBy({ top: -half, behavior }),
      top: () => el.scrollTo({ top: 0, behavior }),
      bottom: () => el.scrollTo({ top: el.scrollHeight, behavior }),
    };
    run[kind]();
    return true;
  }
}
