/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Child side of the Vimma actor (spec: docs/specs/m1-actor-insert-scroll.md). One per frame,
// including out-of-process iframes: reports focus changes in its own document as an
// EditableDescriptor (vimma-core editable.mjs) and runs scroll, blur and focus-input commands.

import { isEditable } from "../core/editable.mjs";
import { collectTargets } from "./hint-collect.mjs";

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

/**
 * @param {unknown} n
 * @returns {n is number}
 */
const isIndex = (n) => Number.isSafeInteger(n) && /** @type {number} */ (n) >= 0;

export class VimmaChild extends JSWindowActorChild {
  /** @type {WeakRef<Element> | null} the last largest scrollable, reused while it can scroll */
  #largest = null;

  /** The last hint collection (m1-hints): its generation and its elements, by target id. */
  #hints = { gen: -1, els: /** @type {WeakRef<Element>[]} */ ([]) };

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
      case "Vimma:CollectHints":
        return this.#collectHints(msg.data);
      case "Vimma:ActivateHint":
        return this.#activateHint(msg.data);
    }
    return undefined;
  }

  /**
   * The hint targets of this frame (m1-hints). Rects are in this frame's CSS pixels; the parent
   * offsets them by the frame rects the embedding frame's child reports.
   * @param {{ gen: number, linksOnly: boolean }} data
   */
  #collectHints(data) {
    const gen = data?.gen;
    const win = this.contentWindow;
    if (!isIndex(gen) || !win) return null;
    const t0 = ChromeUtils.now();
    const { targets, frames } = collectTargets(win, {
      linksOnly: data.linksOnly === true,
    });
    this.#hints = { gen, els: targets.map((t) => new WeakRef(t.el)) };
    return {
      targets: targets.map((t, id) => ({ id, rect: t.rect, kind: t.kind, href: t.href })),
      frames: frames.map((f) => ({ id: f.bc.id, rect: f.rect })),
      ms: ChromeUtils.now() - t0,
    };
  }

  /**
   * Follows a target of the last collection: a text field gets focus (its focusin report enters
   * insert), anything else a click.
   * @param {{ gen: number, id: number }} data
   */
  #activateHint(data) {
    if (!isIndex(data?.gen) || !isIndex(data?.id) || data.gen !== this.#hints.gen) return false;
    const el = this.#hints.els[data.id]?.deref();
    this.#hints = { gen: -1, els: [] };
    if (!el?.isConnected) return false;
    const html = /** @type {HTMLElement} */ (el);
    if (el.localName !== "a" && isEditable(describe(el)).editable) {
      html.focus();
      return true;
    }
    if (el.localName === "select") {
      html.focus();
      try {
        /** @type {HTMLSelectElement} */ (el).showPicker();
      } catch {
        // Without user activation it throws; the select keeps focus and Alt+Down opens it.
      }
      return true;
    }
    // Events created by privileged code are trusted: mousedown and mouseup for pages that act
    // on them (menus, Google's jsaction), then click(), whose activation behaviour follows links.
    const r = el.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: this.contentWindow,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      button: 0,
    };
    const win = /** @type {any} */ (this.contentWindow);
    for (const type of ["mouseover", "mousedown", "mouseup"]) {
      const buttons = type === "mousedown" ? 1 : 0;
      el.dispatchEvent(new win.MouseEvent(type, { ...init, buttons }));
    }
    if (el.isConnected) html.click();
    return true;
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
