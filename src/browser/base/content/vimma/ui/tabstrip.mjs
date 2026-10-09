/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Hides Firefox's tab strip (spec: docs/specs/m0-tabstrip-hidden.md). Our CSS hides it, keyed on
// a root attribute that follows the pref live; this module also tells Firefox the strip is
// hidden, so its own titlebar handling moves the window controls to the nav bar, and keeps the
// "List all tabs" panel openable without the strip's button.

export const TABSTRIP_PREF = "vimma.ui.tabstrip.hidden";
export const TABSTRIP_ATTR = "vimma-tabstrip-hidden";
const STYLESHEET = "chrome://browser/skin/vimma/tabstrip.css";
const TOOLBOX_EVENTS = ["customizationstarting", "aftercustomization"];
/** @type {WeakSet<Window>} windows our stylesheet is loaded into (loading it twice throws) */
const styled = new WeakSet();

/**
 * The window globals we touch: browser/components/tabbrowser/content/tab-bar-visibility.js,
 * browser-allTabsMenu.js, browser/base/content/browser-customtitlebar.js.
 * @typedef {object} TabsPanel
 * @property {Element | null} allTabsButton
 * @property {boolean} canOpen
 * @property {() => void} initElements
 * @property {(...args: unknown[]) => unknown} showAllTabsPanel
 *
 * @typedef {Window & {
 *   TabBarVisibility: { update: (force?: boolean) => void },
 *   gTabsPanel: TabsPanel,
 *   gNavToolbox: Element,
 *   CustomTitlebar: { enabled: boolean },
 * }} BrowserWindow
 */

/** @param {Element | null | undefined} el */
function hasSize(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export class TabStrip {
  /** @param {Window} win  a browser window, from its first script (before the body exists) */
  constructor(win) {
    this.win = /** @type {BrowserWindow} */ (win);
    this.onPref = () => this.apply();
    /** @param {Event} e */
    this.onToolbox = (e) => {
      // Customize mode shows the strip (tabstrip.css); let Firefox lay it out, then re-hide.
      if (e.target === this.win.gNavToolbox) this.win.TabBarVisibility.update(true);
    };
    /** @type {(() => void)[]} */
    this.restore = [];
  }

  /** Whether the strip is hidden by us right now (pref on, outside customize mode). */
  get hidden() {
    const root = this.win.document.documentElement;
    return root.hasAttribute(TABSTRIP_ATTR) && !root.hasAttribute("customizing");
  }

  init() {
    const win = this.win;
    if (!styled.has(win)) {
      win.windowUtils.loadSheetUsingURIString(STYLESHEET, win.windowUtils.AUTHOR_SHEET);
      styled.add(win);
    }
    this.setAttribute();
    this.wrapTabBarVisibility();
    this.wrapTabsPanel();
    Services.prefs.addObserver(TABSTRIP_PREF, this.onPref);
    for (const type of TOOLBOX_EVENTS) win.addEventListener(type, this.onToolbox, true);
  }

  uninit() {
    Services.prefs.removeObserver(TABSTRIP_PREF, this.onPref);
    for (const type of TOOLBOX_EVENTS) this.win.removeEventListener(type, this.onToolbox, true);
    for (const undo of this.restore.splice(0).reverse()) undo();
    // Not TabBarVisibility.update(): this also runs on unload. The next update clears the rest.
    this.win.document.documentElement.removeAttribute(TABSTRIP_ATTR);
  }

  /** The pref changed: update the root attribute, then let Firefox recompute its toolbars. */
  apply() {
    this.setAttribute();
    this.win.TabBarVisibility.update(true);
  }

  /** @private */
  setAttribute() {
    const hidden = Services.prefs.getBoolPref(TABSTRIP_PREF, true);
    this.win.document.documentElement.toggleAttribute(TABSTRIP_ATTR, hidden);
  }

  /**
   * TabBarVisibility.update() recomputes `tabs-hidden` and the nav bar's titlebar class on every
   * tab open/close, titlebar change and customize mode; re-assert them after it while hidden.
   * @private
   */
  wrapTabBarVisibility() {
    const tbv = this.win.TabBarVisibility;
    const original = tbv.update;
    const strip = this;
    tbv.update = function (force) {
      original.call(this, force);
      strip.markToolboxHidden();
    };
    this.restore.push(() => (tbv.update = original));
  }

  /**
   * What tab-bar-visibility.js does when it hides the strip itself (popups, vertical tabs), minus
   * collapsing it (tabstrip.css does that) and the File menu changes (tabs still exist).
   * @private
   */
  markToolboxHidden() {
    const win = this.win;
    if (!this.hidden || !win.toolbar.visible) return;
    win.gNavToolbox.toggleAttribute("tabs-hidden", true);
    const titlebarIds = Services.prefs.getBoolPref("browser.nova.enabled", false)
      ? ["nav-bar", "PersonalToolbar"]
      : ["nav-bar"];
    for (const id of titlebarIds) {
      win.document
        .getElementById(id)
        ?.classList.toggle("browser-titlebar", win.CustomTitlebar.enabled);
    }
  }

  /**
   * gTabsPanel opens "List all tabs" only when #alltabs-button has a size, and anchors the panel
   * to it. While the strip (and so the button) is hidden, anchor to the app menu button instead.
   * @private
   */
  wrapTabsPanel() {
    const panel = this.win.gTabsPanel;
    const canOpen = /** @type {PropertyDescriptor} */ (
      Object.getOwnPropertyDescriptor(panel, "canOpen")
    );
    const showAllTabsPanel = panel.showAllTabsPanel;
    const strip = this;
    Object.defineProperty(panel, "canOpen", {
      ...canOpen,
      get() {
        return canOpen.get?.call(this) || !!strip.fallbackAnchor();
      },
    });
    panel.showAllTabsPanel = function (...args) {
      const anchor = strip.fallbackAnchor();
      if (!anchor) return showAllTabsPanel.apply(this, args);
      const button = this.allTabsButton;
      this.allTabsButton = anchor;
      try {
        return showAllTabsPanel.apply(this, args);
      } finally {
        this.allTabsButton = button;
      }
    };
    this.restore.push(() => {
      Object.defineProperty(panel, "canOpen", canOpen);
      panel.showAllTabsPanel = showAllTabsPanel;
    });
  }

  /**
   * @private
   * @returns {Element | null} the app menu button, when the all-tabs button is hidden by us
   */
  fallbackAnchor() {
    if (!this.hidden) return null;
    const panel = this.win.gTabsPanel;
    panel.initElements();
    if (hasSize(panel.allTabsButton)) return null;
    const menuButton = this.win.document.getElementById("PanelUI-menu-button");
    return hasSize(menuButton) ? menuButton : null;
  }
}
