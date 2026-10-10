/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The side panel (spec: docs/specs/m3-workspaces.md, "Side panel" and sub-spec 6): our own box,
// the first child of #browser, not a SidebarController panel (decision 4). It lists the current
// workspace's tabs; keys reach it only through VimmaHost (`action`) in `panel` mode. The logic
// is core sidepanel.mjs, this only renders it.

import { WORKSPACE_COLOR_TOKENS } from "../core/statusbar.mjs";
import { openPanel, panelKey, refreshPanel } from "../core/sidepanel.mjs";

/** @import { PanelState, PanelTabInfo } from "../core/sidepanel.mjs" */
/** @import { Workspaces } from "../core/workspaces.mjs" */

export const PANEL_ID = "vimma-panel";
const STYLESHEET = "chrome://browser/skin/vimma/side-panel.css";
const HTML_NS = "http://www.w3.org/1999/xhtml";
/** @type {WeakSet<Window>} windows our stylesheet is loaded into (once: a second load throws) */
const styled = new WeakSet();
/** Tab events that change a row: re-render while open. */
const TAB_EVENTS = ["TabOpen", "TabClose", "TabSelect", "TabAttrModified", "TabMove"];

/**
 * @typedef {object} SidePanelHost
 * @property {() => Workspaces | null} model  the window's workspaces, tabs in window order
 * @property {(tabId: string) => PanelTabInfo | undefined} info
 * @property {() => string | undefined} color  the active workspace's colour name
 * @property {(tabId: string) => void} select  a row was picked; the panel closes right after
 * @property {(text: string) => void} say  a refusal for the notice
 * @property {(tabId: string) => void} closeTab  `x`: close that tab; the panel stays open
 */

export class SidePanel {
  /**
   * @param {Window} win  a browser window
   * @param {SidePanelHost} host
   */
  constructor(win, host) {
    this.win = win;
    this.host = host;
    /** @type {HTMLElement | null} */
    this.box = null;
    /** @type {HTMLElement | null} */
    this.list = null;
    /** @type {PanelState | null} */
    this.state = null;
    this.onTabEvent = () => this.refresh();
    // Firefox moves focus to the page at the end of every tab switch (Tabbrowser.sys.mjs
    // _adjustFocusBeforeTabSwitch blurs chrome, AsyncTabSwitcher then focuses the browser), so a
    // switch made from the panel (ctrl+b ), prefix+c) would leave it without focus.
    this.onSwitchDone = () => {
      const el = this.win.document.activeElement;
      if (this.isOpen && el?.localName === "browser") this.box?.focus();
    };
  }

  get isOpen() {
    return !!this.state;
  }

  /** @returns {boolean} whether it opened (a window without workspaces has nothing to list) */
  open() {
    if (this.isOpen) return true;
    const model = this.host.model();
    if (!model) return false;
    const box = this.box ?? this.build();
    this.state = openPanel(model, this.host.info, { color: this.host.color() });
    this.render();
    box.hidden = false;
    const tabs = this.#tabContainer();
    for (const type of TAB_EVENTS) tabs?.addEventListener(type, this.onTabEvent);
    this.win.addEventListener("TabSwitchDone", this.onSwitchDone);
    box.focus();
    return true;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /**
   * Closes it; focus goes to the selected page when it was in the panel, or nowhere (a tab
   * switch just blurred the panel: Tabbrowser's _adjustFocusBeforeTabSwitch).
   */
  close() {
    if (!this.isOpen) return;
    this.state = null;
    const tabs = this.#tabContainer();
    for (const type of TAB_EVENTS) tabs?.removeEventListener(type, this.onTabEvent);
    this.win.removeEventListener("TabSwitchDone", this.onSwitchDone);
    const box = /** @type {HTMLElement} */ (this.box);
    const doc = this.win.document;
    const el = doc.activeElement;
    const hadFocus = !el || el === doc.body || box.contains(el);
    box.hidden = true;
    if (hadFocus) {
      /** @type {{ gBrowser?: { selectedBrowser: HTMLElement } }} */ (
        /** @type {unknown} */ (this.win)
      ).gBrowser?.selectedBrowser.focus();
    }
  }

  /**
   * One `[modal.panel]` action (panel.down, panel.up, panel.open, panel.select, panel.close,
   * panel.close_tab).
   * @param {{ id: string, arg?: number }} action
   */
  action(action) {
    if (!this.state) return;
    const { state, effect } = panelKey(this.state, action);
    if (state !== this.state) {
      this.state = state;
      this.render();
    }
    if (effect?.type === "close") this.close();
    if (effect?.type === "refuse") this.host.say(effect.text);
    // The highlight is on the next row already: the TabClose refresh keeps it there.
    if (effect?.type === "closeTab") this.host.closeTab(effect.id);
    // Select first, so closing focuses the new page, not the one being left.
    if (effect?.type === "select") {
      this.host.select(effect.id);
      this.close();
    }
  }

  /** The model or a tab changed (ctrl+b ), a new tab, a title): list it again. */
  refresh() {
    if (!this.state) return;
    const model = this.host.model();
    if (!model) {
      this.close();
      return;
    }
    this.state = refreshPanel(this.state, model, this.host.info, { color: this.host.color() });
    this.render();
  }

  /** Close and remove the box (VimmaHost.uninit). */
  destroy() {
    this.close();
    this.box?.remove();
    this.box = this.list = null;
  }

  #tabContainer() {
    return /** @type {{ gBrowser?: { tabContainer: EventTarget } }} */ (
      /** @type {unknown} */ (this.win)
    ).gBrowser?.tabContainer;
  }

  /** @private */
  render() {
    const state = /** @type {PanelState} */ (this.state);
    const doc = this.win.document;
    /**
     * @param {string} tag
     * @param {string} className
     * @param {string} [text]
     */
    const el = (tag, className, text = "") => {
      const node = /** @type {HTMLElement} */ (doc.createElementNS(HTML_NS, tag));
      node.className = className;
      node.textContent = text;
      return node;
    };
    const box = /** @type {HTMLElement} */ (this.box);
    const header = /** @type {HTMLElement} */ (box.querySelector(".vimma-panel-header"));
    const { workspace: w } = state;
    const tokens = /** @type {Record<string, string>} */ (WORKSPACE_COLOR_TOKENS);
    const dot = el("span", "vimma-panel-dot", "●");
    dot.style.color = `var(${(w.color && tokens[w.color]) || "--vimma-accent"})`;
    const neighbours =
      state.previous === null
        ? ""
        : `ctrl+b ( ${state.previous} · ctrl+b ) ${/** @type {string} */ (state.next)}`;
    header.replaceChildren(
      dot,
      el("span", "vimma-panel-name", `${w.index}:${w.name}`),
      el("span", "vimma-panel-neighbours", neighbours),
    );

    const list = /** @type {HTMLElement} */ (this.list);
    list.setAttribute("aria-label", `Tabs in ${w.name}`);
    list.replaceChildren(
      ...state.rows.map((r, i) => {
        const row = el("li", "vimma-panel-row");
        row.id = `${PANEL_ID}-${i}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(i === state.selected));
        row.dataset.tabId = r.tabId;
        if (r.active) row.classList.add("vimma-panel-active");
        const marks = [r.playing ? "♪" : "", r.foreign ? "foreign" : ""].filter(Boolean);
        row.append(
          el("span", "vimma-panel-number", String(r.number)),
          el("span", "vimma-panel-title", r.display),
          el("span", "vimma-panel-host", r.host),
        );
        if (marks.length) row.append(el("span", "vimma-panel-marks", marks.join(" ")));
        return row;
      }),
    );
    if (!state.rows.length) list.append(el("li", "vimma-panel-empty", "no tabs"));
    const current = list.children[state.selected];
    if (current && state.rows.length) {
      list.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView({ block: "nearest" });
    } else {
      list.removeAttribute("aria-activedescendant");
    }
  }

  /**
   * @private
   * @returns {HTMLElement}
   */
  build() {
    const { box, list } = buildPanelBox(this.win, {
      id: PANEL_ID,
      label: "Side panel",
      hint: "j/k move · 1-9 or Enter go · x close tab · Esc close",
    });
    this.box = box;
    this.list = list;
    return box;
  }
}

/**
 * An element in the XHTML namespace with a class and text (never HTML).
 * @param {Document} doc
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 */
export function panelElement(doc, tag, className, text = "") {
  const node = /** @type {HTMLElement} */ (doc.createElementNS(HTML_NS, tag));
  node.className = className;
  node.textContent = text;
  return node;
}

/**
 * A hidden panel box in the left slot (the first child of #browser), styled by side-panel.css:
 * a header, a listbox and a key hint. The side panel and the bookmarks panel
 * (docs/specs/bookmarks.md) are each one.
 * @param {Window} win
 * @param {{ id: string, label: string, hint: string }} options
 */
export function buildPanelBox(win, { id, label, hint }) {
  const doc = win.document;
  if (!styled.has(win)) {
    win.windowUtils.loadSheetUsingURIString(STYLESHEET, win.windowUtils.AUTHOR_SHEET);
    styled.add(win);
  }
  // A XUL vbox, as Firefox's own children of the #browser hbox (browser-box.inc.xhtml).
  const box = /** @type {HTMLElement} */ (
    /** @type {{ createXULElement: (tag: string) => Element }} */ (
      /** @type {unknown} */ (doc)
    ).createXULElement("vbox")
  );
  box.id = id;
  box.className = "vimma-side-panel";
  box.hidden = true;
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", label);
  box.tabIndex = -1;
  const header = panelElement(doc, "header", "vimma-panel-header");
  const list = panelElement(doc, "ul", "");
  list.setAttribute("role", "listbox");
  const footer = panelElement(doc, "footer", "vimma-panel-hint", hint);
  box.append(header, list, footer);
  /** @type {Element} */ (doc.getElementById("browser")).prepend(box);
  return { box, header, list };
}
