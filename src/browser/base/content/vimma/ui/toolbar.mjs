/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Hides Firefox's navigation toolbar (spec: docs/specs/toolbar-toggle.md). The pref
// vimma.ui.toolbar.hidden is one state for every window; toolbar.css collapses the bar, keyed on
// a root attribute that follows it live. While the bar is hidden, each window keeps a set of
// reasons to reveal it, each asking for the minimal bar (the URL field) or the full one: the
// URL bar about to take focus, focus inside the bar, a doorhanger or a panel anchored in it,
// the pointer at the top edge, an add-on popup. The largest size asked for wins; with none the
// bar collapses again. Every reveal that focus or a popup needs happens before it, from
// Firefox's own events (`beforefocus`, `beforeselect`, `PopupNotificationsBeforeAnchor`,
// `popupshowing`), so nothing is focused in, or anchored to, a collapsed element.

export const TOOLBAR_PREF = "vimma.ui.toolbar.hidden";
export const HIDDEN_ATTR = "vimma-toolbar-hidden";
export const REVEALED_ATTR = "vimma-toolbar-revealed";
export const MINIMAL_ATTR = "vimma-toolbar-minimal";
export const EDGE_ID = "vimma-toolbar-edge";
export const REVEAL_FAILED = "toolbar shown: the address bar could not be revealed";
const STYLESHEET = "chrome://browser/skin/vimma/toolbar.css";
/** The pointer rests at the edge this long before the bar shows, and leaves it this long. */
const HOVER_SHOW_MS = 150;
const HOVER_HIDE_MS = 600;
/** F6 moves focus later than its keydown (after a remote page's reply): this long at most. */
const F6_MS = 1000;
/** A reveal held for a popup that has not opened after this long ends. */
const AWAIT_POPUP_MS = 5000;
/** Where Firefox's own toolbox rules apply instead of ours (toolbar.css). */
const FIREFOX_OWNS =
  "[customizing], [popup-window], [taskbartab], [inFullscreen], [inDOMFullscreen]";
const HOVER_ZONE = `#navigator-toolbox, #${EDGE_ID}`;
const VISIBLE = { visibilityProperty: true };
const HTML_NS = "http://www.w3.org/1999/xhtml";
const WINDOW_EVENTS = [
  "keydown",
  "beforefocus",
  "beforeselect",
  "focusin",
  "focusout",
  "popupshowing",
  "popuphidden",
  "PopupNotificationsBeforeAnchor",
  "mouseover",
  "mouseout",
  "mousedown",
  "mouseup",
];

/** @typedef {"minimal" | "full"} Size */

/**
 * @typedef {Window & {
 *   gURLBar: HTMLElement & { focused: boolean, view: { isOpen: boolean } },
 *   gBrowser: { selectedBrowser: HTMLElement },
 *   PopupNotifications?: { panel: Element & { state: string } },
 *   UpdatePopupNotificationsVisibility?: () => void,
 * }} BrowserWindow
 */

/**
 * @typedef {object} ToolbarHost  what the toolbar needs from VimmaHost
 * @property {(text: string) => void} say  the notice
 * @property {(text: string) => void} log  about:vimma's key log
 * @property {() => void} changed  the status bar may say something else now
 */

/** @type {WeakMap<Window, Toolbar>} */
const instances = new WeakMap();
/** @type {WeakSet<Window>} windows our stylesheet is loaded into (loading it twice throws) */
const styled = new WeakSet();

export class Toolbar {
  /** @param {Window} win */
  static get(win) {
    return instances.get(win) ?? null;
  }

  /** Whether the toolbar is hidden, in every window. */
  static get hidden() {
    return Services.prefs.getBoolPref(TOOLBAR_PREF, false);
  }

  /** @param {boolean} hidden */
  static setHidden(hidden) {
    Services.prefs.setBoolPref(TOOLBAR_PREF, hidden);
  }

  /**
   * @param {Window} win  a browser window, from its first script (before the body exists)
   * @param {ToolbarHost} host
   */
  constructor(win, host) {
    this.win = /** @type {BrowserWindow} */ (win);
    this.host = host;
    /** @type {Map<unknown, Size>} why the bar is revealed, and how much each reason asks for */
    this.reasons = new Map();
    /** @type {Set<unknown>} reasons that end once a popup anchored in the bar shows */
    this.awaiting = new Set();
    /** what the root attributes said last: "", "minimal" or "full" */
    this.shown = "";
    /** inside a PopupNotificationsBeforeAnchor: Firefox is anchoring right now */
    this.anchoring = false;
    this.hoverIn = 0;
    this.hoverOut = 0;
    /** a mouse button went down on the bar and is not up yet (or only just) */
    this.pressing = false;
    this.onPref = () => this.apply();
    this.onEvent = (/** @type {Event} */ e) => this.handleEvent(e);
    this.start = () => this.addEdge();
  }

  init() {
    const win = this.win;
    if (!styled.has(win)) {
      win.windowUtils.loadSheetUsingURIString(STYLESHEET, win.windowUtils.AUTHOR_SHEET);
      styled.add(win);
    }
    instances.set(win, this);
    Services.prefs.addObserver(TOOLBAR_PREF, this.onPref);
    for (const type of WINDOW_EVENTS) win.addEventListener(type, this.onEvent, true);
    win.document.documentElement.toggleAttribute(HIDDEN_ATTR, Toolbar.hidden);
    if (win.document.readyState === "loading") {
      win.addEventListener("DOMContentLoaded", this.start, { once: true });
    } else {
      this.addEdge();
    }
  }

  uninit() {
    const win = this.win;
    Services.prefs.removeObserver(TOOLBAR_PREF, this.onPref);
    for (const type of WINDOW_EVENTS) win.removeEventListener(type, this.onEvent, true);
    win.removeEventListener("DOMContentLoaded", this.start);
    win.clearTimeout(this.hoverIn);
    win.clearTimeout(this.hoverOut);
    win.document.getElementById(EDGE_ID)?.remove();
    for (const attr of [HIDDEN_ATTR, REVEALED_ATTR, MINIMAL_ATTR]) {
      win.document.documentElement.removeAttribute(attr);
    }
    instances.delete(win);
  }

  /** Hidden, and in a state where our rules apply (toolbar.css), not Firefox's own. */
  get applies() {
    const root = this.win.document.documentElement;
    return root.hasAttribute(HIDDEN_ATTR) && !root.matches(FIREFOX_OWNS);
  }

  /**
   * Adds a reason to reveal the bar.
   * @param {unknown} key
   * @param {Size} size
   */
  hold(key, size) {
    if (this.reasons.get(key) === size) return;
    this.reasons.set(key, size);
    this.update();
  }

  /** @param {unknown} key */
  release(key) {
    this.awaiting.delete(key);
    if (this.reasons.delete(key)) this.update();
  }

  /**
   * A reason that holds until a popup anchored in the bar shows (that popup's own reason then
   * holds the bar), or AWAIT_POPUP_MS if none does: an add-on popup about to open.
   * @param {unknown} key
   * @param {Size} size
   */
  holdForPopup(key, size) {
    this.awaiting.add(key);
    this.hold(key, size);
    this.win.setTimeout(() => {
      if (this.awaiting.has(key)) this.release(key);
    }, AWAIT_POPUP_MS);
  }

  /** The pref changed: before hiding, move focus out of the bar (decision 14). */
  apply() {
    const hidden = Toolbar.hidden;
    const doc = this.win.document;
    if (hidden && this.focusInBar()) {
      this.win.gBrowser.selectedBrowser.focus();
      this.reasons.delete("urlbar");
      this.reasons.delete("focus");
    }
    if (!hidden) this.reasons.delete("hover");
    doc.documentElement.toggleAttribute(HIDDEN_ATTR, hidden);
    this.update();
    // The status bar carries the hidden toolbar's cues (decision 12).
    this.host.changed();
  }

  /** @private */
  update() {
    let size = /** @type {"" | Size} */ ("");
    for (const s of this.reasons.values()) if (s === "full" || !size) size = s;
    const shown = this.win.document.documentElement.hasAttribute(HIDDEN_ATTR) ? size : "";
    this.reveal(shown);
    if (shown === this.shown) return;
    this.shown = shown;
    // Doorhanger anchors may have come or gone; Firefox re-anchors (not while it anchors).
    if (!this.anchoring) {
      try {
        this.win.UpdatePopupNotificationsVisibility?.();
      } catch (e) {
        console.error("vimma: toolbar", e);
      }
    }
    this.host.changed();
  }

  /**
   * Sets the root attributes toolbar.css reveals the bar from.
   * @param {"" | Size} size
   */
  reveal(size) {
    const root = this.win.document.documentElement;
    root.toggleAttribute(REVEALED_ATTR, !!size);
    root.toggleAttribute(MINIMAL_ATTR, size === "minimal");
  }

  /** @param {Event} e */
  handleEvent(e) {
    switch (e.type) {
      case "keydown":
        this.keyDown(/** @type {KeyboardEvent} */ (e));
        break;
      case "beforefocus":
      case "beforeselect":
        this.beforeUrlbarFocus(/** @type {Element} */ (e.target));
        break;
      case "focusin":
        this.focusChanged();
        this.release("f6");
        break;
      case "focusout":
        // Focus is still on its way: look once it has landed.
        if (this.inBar(e.target)) this.win.setTimeout(() => this.focusChanged(), 0);
        break;
      case "popupshowing":
        this.popupShowing(/** @type {any} */ (e.target));
        break;
      case "popuphidden":
        this.popupHidden(/** @type {any} */ (e.target));
        break;
      case "PopupNotificationsBeforeAnchor":
        this.beforeAnchor(/** @type {Element} */ (e.target));
        break;
      case "mousedown":
        if (this.inBar(e.target)) this.pressing = true;
        break;
      case "mouseup":
        if (this.pressing) this.win.setTimeout(() => (this.pressing = false), 0);
        break;
      case "mouseover":
        if (this.inHoverZone(e.target)) this.hoverEnter();
        break;
      case "mouseout":
        if (
          this.inHoverZone(e.target) &&
          !this.inHoverZone(/** @type {MouseEvent} */ (e).relatedTarget)
        ) {
          this.hoverLeave();
        }
        break;
    }
  }

  /**
   * Reason a: the URL bar is about to take focus. Revealed now, before `focus()` runs, so focus
   * lands on a laid-out field. If it is still not visible, the toolbar comes back (decision 13).
   * @private
   * @param {Element} target
   */
  beforeUrlbarFocus(target) {
    const urlbar = this.win.gURLBar;
    if (!target?.closest?.("#urlbar") || !this.inBar(target)) return;
    this.hold("urlbar", "minimal");
    // Focus can fail or not happen at all: drop the reason once things settle.
    this.win.setTimeout(() => this.focusChanged(), 0);
    if (!this.applies || urlbar.checkVisibility(VISIBLE)) return;
    this.host.log(REVEAL_FAILED);
    console.error(`vimma: ${REVEAL_FAILED}`);
    Toolbar.setHidden(false);
    this.host.say(REVEAL_FAILED);
  }

  /**
   * F6 and shift+F6 move focus between the page and the URL bar through the focus manager
   * (EventStateManager), which skips a collapsed bar and fires no `beforefocus`: reveal the
   * minimal bar first, as F11's toolbox does on F6 (FullScreen._keyToggleCallback).
   * @private
   * @param {KeyboardEvent} e
   */
  keyDown(e) {
    if (e.key !== "F6" || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!this.applies || this.win.gURLBar?.focused) return;
    this.hold("f6", "minimal");
    this.win.setTimeout(() => this.release("f6"), F6_MS);
  }

  /**
   * Reasons a and b: the URL bar (focused, or its results open) asks for minimal; focus on an
   * item of the bar for the size it is in: the site's identity and the permission icons are in
   * the minimal bar, the buttons only in the full one.
   * @private
   */
  focusChanged() {
    const urlbar = this.win.gURLBar;
    if (urlbar?.focused || urlbar?.view?.isOpen) this.hold("urlbar", "minimal");
    else if (this.reasons.has("urlbar") && this.pointerOnBar()) {
      // A click on the bar's own icons (the site's identity, a permission) takes focus from
      // the field on mousedown: the bar stays under the pointer, or the click would land on
      // the page (decision 9: the bar stays while the pointer is over it).
      this.hold("pointer", this.reasons.get("urlbar") ?? "minimal");
      this.release("urlbar");
      this.hoverLeave();
    } else this.release("urlbar");
    const focused = this.focusedElement();
    if (focused && this.inBar(focused)) {
      this.hold("focus", focused.closest("#urlbar") ? "minimal" : "full");
    } else this.release("focus");
  }

  /** Reason c: a doorhanger is about to anchor in the bar. @private @param {Element} anchor */
  beforeAnchor(anchor) {
    if (!this.inBar(anchor)) return;
    this.anchoring = true;
    try {
      this.hold("doorhanger", anchor.closest("#urlbar") ? "minimal" : "full");
    } finally {
      this.anchoring = false;
    }
    // A prompt that never opens (its notifications filtered out) leaves no popuphidden.
    this.win.setTimeout(() => this.doorhangerClosed(), AWAIT_POPUP_MS);
  }

  /** @private */
  doorhangerClosed() {
    if ((this.win.PopupNotifications?.panel.state ?? "closed") === "closed") {
      this.release("doorhanger");
    }
  }

  /**
   * Reason d: a panel or menu anchored in the bar holds it at the size its anchor needs, until
   * it closes, as F11's toolbox does (FullScreen._setPopupOpen).
   * @private
   * @param {any} popup
   */
  popupShowing(popup) {
    if (popup?.localName === "tooltip") return;
    const anchor = popup?.anchorNode ?? popup?.triggerNode;
    if (!this.inBar(anchor)) return;
    this.hold(popup, anchor.closest("#urlbar") ? "minimal" : "full");
    for (const key of [...this.awaiting]) {
      this.awaiting.delete(key);
      this.reasons.delete(key);
    }
    this.update();
  }

  /** @private @param {any} popup */
  popupHidden(popup) {
    this.release(popup);
    // A doorhanger that moves to another anchor hides and opens again: look after that.
    if (popup === this.win.PopupNotifications?.panel) {
      this.win.setTimeout(() => this.doorhangerClosed(), 0);
    }
  }

  /** Reason e: the pointer at the top edge or over the revealed bar. @private */
  hoverEnter() {
    this.win.clearTimeout(this.hoverOut);
    this.hoverOut = 0;
    if (this.reasons.has("hover") || this.hoverIn || !this.applies) return;
    this.hoverIn = this.win.setTimeout(() => {
      this.hoverIn = 0;
      this.hold("hover", "full");
    }, HOVER_SHOW_MS);
  }

  /** @private */
  hoverLeave() {
    this.win.clearTimeout(this.hoverIn);
    this.hoverIn = 0;
    if (!this.reasons.has("hover") && !this.reasons.has("pointer")) return;
    this.win.clearTimeout(this.hoverOut);
    this.hoverOut = this.win.setTimeout(() => {
      this.hoverOut = 0;
      const doc = this.win.document;
      const still = doc.querySelectorAll(HOVER_ZONE);
      if ([...still].some((el) => el.matches(":hover"))) return;
      this.reasons.delete("pointer");
      this.release("hover");
      this.update();
    }, HOVER_HIDE_MS);
  }

  /** @private */
  addEdge() {
    const doc = this.win.document;
    if (doc.getElementById(EDGE_ID) || !doc.body) return;
    const edge = doc.createElementNS(HTML_NS, "div");
    edge.id = EDGE_ID;
    edge.setAttribute("aria-hidden", "true");
    doc.body.append(edge);
  }

  /** @private */
  pointerOnBar() {
    return this.pressing || !!this.win.document.getElementById("nav-bar")?.matches(":hover");
  }

  /** @private */
  focusInBar() {
    const focused = this.focusedElement();
    return !!focused && this.inBar(focused);
  }

  /** @private @returns {Element | null} */
  focusedElement() {
    return /** @type {any} */ (this.win.document).commandDispatcher?.focusedElement ?? null;
  }

  /** @private @param {any} node */
  inBar(node) {
    return !!node?.closest?.("#nav-bar");
  }

  /** @private @param {any} node */
  inHoverZone(node) {
    return !!node?.closest?.(HOVER_ZONE);
  }
}
