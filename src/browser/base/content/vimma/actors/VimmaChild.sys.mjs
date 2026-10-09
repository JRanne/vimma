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

/**
 * @param {Element} el
 * @param {boolean} vertical
 */
function canScroll(el, vertical) {
  const max = vertical ? el.scrollTopMax : el.scrollLeftMax;
  if (!(max > 0)) return false;
  if (el === el.ownerDocument.scrollingElement) return true;
  const style = el.ownerGlobal.getComputedStyle(el);
  const overflow = vertical ? style?.overflowY : style?.overflowX;
  return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
}

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

export class VimmaChild extends JSWindowActorChild {
  /** @type {WeakRef<Element> | null} the last largest scrollable, reused while it can scroll */
  #largest = null;

  /** @param {Event} event */
  handleEvent(event) {
    const doc = this.document;
    switch (event.type) {
      case "focusin": {
        // Unretargeted: the element itself, also inside an open or closed shadow root.
        const target = /** @type {Element | null} */ (event.originalTarget);
        this.#report(target?.nodeType === 1 ? target : deepActiveElement(doc), "focusin");
        return;
      }
      case "focusout":
        this.#recheck();
        return;
      case "focus":
        // The window regained focus (from a subframe or another window): elements fire focusin.
        if (event.originalTarget === this.contentWindow) this.#recheck();
    }
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
    }
    return undefined;
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
    // App shells and pdf.js scroll an inner element: take the largest visible one.
    const last = this.#largest?.deref();
    if (last?.isConnected && canScroll(last, vertical)) return last;
    let best = null;
    let area = 0;
    for (const el of doc.querySelectorAll("*")) {
      if (!canScroll(el, vertical)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > area) [best, area] = [el, r.width * r.height];
    }
    this.#largest = best ? new WeakRef(best) : null;
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
