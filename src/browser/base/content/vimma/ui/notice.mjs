/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A brief chrome-level toast (spec: docs/specs/m2-tab-keys.md), e.g. "Split right: not
// implemented yet". A manual popover in the chrome document: top layer, above remote content and
// the help overlay, and it never takes focus. One per window; a new message replaces the old one.

export const NOTICE_ID = "vimma-notice";
export const NOTICE_MS = 1500;
const STYLESHEET = "chrome://browser/skin/vimma/notice.css";
const HTML_NS = "http://www.w3.org/1999/xhtml";
/** @type {WeakSet<Window>} windows our stylesheet is loaded into */
const styled = new WeakSet();

export class Notice {
  /** @param {Window} win  a browser window */
  constructor(win) {
    this.win = win;
    /** @type {HTMLElement | null} */
    this.el = null;
    /** @type {number | null} */
    this.timer = null;
  }

  /**
   * Shows `text`, except while a page is in DOM fullscreen (a video): the toast would sit over
   * it, and Firefox's own chrome is hidden there too (`inDOMFullscreen` on the root, set by
   * browser-fullScreenAndPointerLock.js).
   * @param {string} text
   */
  show(text) {
    if (this.win.document.documentElement.hasAttribute("inDOMFullscreen")) return;
    const el = this.el ?? this.build();
    el.textContent = text;
    if (!el.matches(":popover-open")) el.showPopover();
    if (this.timer !== null) this.win.clearTimeout(this.timer);
    this.timer = this.win.setTimeout(() => this.hide(), NOTICE_MS);
  }

  hide() {
    if (this.timer !== null) this.win.clearTimeout(this.timer);
    this.timer = null;
    if (this.el?.matches(":popover-open")) this.el.hidePopover();
  }

  /** Hide and remove the element (VimmaHost.uninit). */
  destroy() {
    this.hide();
    this.el?.remove();
    this.el = null;
  }

  /**
   * @private
   * @returns {HTMLElement}
   */
  build() {
    if (!styled.has(this.win)) {
      this.win.windowUtils.loadSheetUsingURIString(STYLESHEET, this.win.windowUtils.AUTHOR_SHEET);
      styled.add(this.win);
    }
    const doc = this.win.document;
    const el = /** @type {HTMLElement} */ (doc.createElementNS(HTML_NS, "div"));
    el.id = NOTICE_ID;
    el.popover = "manual";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    doc.body.append(el);
    this.el = el;
    return el;
  }
}
