/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Split panes in one window (docs/specs/m4-split-panes.md sub-spec 2, ADR-013). Holds the
// window's pane tree (vimma-core panes.mjs) and mirrors it onto ONE Firefox split view:
// planSplit says which tabs join, leave, move, show, hide, (de)activate; layout() gives each
// pane its rectangle. Firefox's wrapper keeps deciding which browsers are live and which tab is
// selected; the tree decides the geometry. Until M3's workspace host owns the tree, the window
// is the workspace. Sub-spec 3's keys call split / close / zoom; nothing here binds a key.

import { mergeWithDefaults } from "../core/config.mjs";
import {
  closePane,
  createPanes,
  layout,
  leaves,
  paneOfTab,
  split,
  splitRefusal,
  toggleZoom,
} from "../core/panes.mjs";
import { planSplit } from "../core/splitplan.mjs";
import {
  applyLayout,
  clearLayout,
  contentArea,
  isHidden,
  loadSheet,
  setHidden,
} from "./layout.mjs";

/** @import { Panes, SplitDirection, SplitRefusal } from "../core/panes.mjs" */
/** @import { SplitPlan } from "../core/splitplan.mjs" */

/**
 * @typedef {Element & { linkedPanel: string, label: string, pinned: boolean, closing?: boolean,
 *   selected: boolean, splitview: Wrapper | null,
 *   linkedBrowser: { docShellIsActive: boolean } }} Tab
 * @typedef {Element & { tabs: Tab[], addTabs: (tabs: Tab[]) => void,
 *   unsplitTabs: () => void }} Wrapper
 * @typedef {{ tabs: Tab[], selectedTab: Tab, tabContainer: Element,
 *   addTabSplitView: (tabs: Tab[], options?: object) => Wrapper,
 *   addTrustedTab: (url: string, options?: object) => Tab, unpinTab: (tab: Tab) => void }} TabBrowser
 * @typedef {{ ok: true } | { ok: false, reason: string }} PaneResult
 */

/** Tabs labelled for a11y by us (the third pane on; Firefox labels the first two). */
const LABEL_ATTR = "vimma-pane-label";

/** @param {Window} win */
function gBrowserOf(win) {
  return /** @type {{ gBrowser: TabBrowser }} */ (/** @type {unknown} */ (win)).gBrowser;
}

export class PaneView {
  /** @type {Window} */
  #win;
  /** @type {Panes | null} null: one pane, the selected tab, no split */
  #panes = null;
  /** @type {number} config `[panes] max`, passed to core */
  #max;
  /** @type {Wrapper | null} the split view this window's panes live in */
  #wrapper = null;
  /** @type {ResizeObserver | null} */
  #resize = null;
  #reconciling = false;
  #scheduled = false;
  /** @type {Set<Tab>} tabs whose panel carries our geometry */
  #laidOut = new Set();

  /**
   * @param {Window} win
   * @param {{ max?: number }} [options]  `max`: config `[panes] max` (default: the config default)
   */
  constructor(win, { max = mergeWithDefaults({}).panes.max } = {}) {
    this.#win = win;
    this.#max = max;
    loadSheet(win);
    // On the window: this runs before gBrowser exists (vimma.js), and tab events bubble to it.
    win.addEventListener("TabClose", this);
    // Firefox re-runs showSplitViewPanels (every member active) whenever the split activates
    // again, e.g. after a TabSelect; reconcile then deactivates the zoomed-away ones again.
    win.addEventListener("TabSplitViewActivate", this);
  }

  destroy() {
    this.#win.removeEventListener("TabClose", this);
    this.#win.removeEventListener("TabSplitViewActivate", this);
    this.#resize?.disconnect();
    this.#resize = null;
  }

  /** @param {Event} e */
  handleEvent(e) {
    if (e.type === "TabClose") this.#onTabClose(/** @type {Tab} */ (e.target));
    // TabSplitViewDeactivate is not listened to: the old wrapper's arrives late after a rebuild
    // and lists the kept members too (sub-spec 1), so it carries nothing to act on.
    else if (e.type === "TabSplitViewActivate" && !this.#reconciling) this.#schedule();
  }

  /** The window's pane tree, null with a single pane (for tests and sub-spec 3). */
  get panes() {
    return this.#panes;
  }

  /** @param {number} max  config `[panes] max` */
  set max(max) {
    this.#max = max;
  }

  get max() {
    return this.#max;
  }

  /**
   * Splits the focused pane: `vertical` puts the new pane right of it, `horizontal` below. The
   * new pane shows `tab` (default: a new tab on the new-tab page) and gets focus. Refused, with
   * core's reason, past `[panes] max` or with no space; a refused split opens no tab.
   * @param {SplitDirection} direction
   * @param {{ tab?: Tab }} [options]
   * @returns {PaneResult}
   */
  split(direction, { tab } = {}) {
    const gBrowser = gBrowserOf(this.#win);
    const current = this.#panes ?? createPanes(gBrowser.selectedTab.linkedPanel);
    const refusal = /** @type {SplitRefusal | null} */ (
      splitRefusal(current, current.focus, direction, { max: this.#max })
    );
    if (refusal) return { ok: false, reason: refusal.message };
    const fresh =
      tab ??
      gBrowser.addTrustedTab(/** @type {any} */ (this.#win).BROWSER_NEW_TAB_URL, {
        inBackground: true,
      });
    this.#set(split(current, current.focus, direction, fresh.linkedPanel, { max: this.#max }));
    return { ok: true };
  }

  /**
   * Closes the focused pane; its tab stays open (not shown). The last pane cannot close.
   * @returns {PaneResult}
   */
  close() {
    if (!this.#panes) return { ok: false, reason: "cannot close the last pane" };
    this.#set(closePane(this.#panes, this.#panes.focus));
    return { ok: true };
  }

  /**
   * Zooms the focused pane to the whole content area, or unzooms.
   * @returns {PaneResult}
   */
  zoom() {
    if (!this.#panes) return { ok: false, reason: "only one pane" };
    this.#set(toggleZoom(this.#panes));
    return { ok: true };
  }

  /**
   * Replaces the tree and mirrors it. One leaf is no split.
   * @param {Panes | null} panes
   */
  #set(panes) {
    this.#panes = panes && leaves(panes).length >= 2 ? panes : null;
    this.reconcile();
  }

  /** @param {Tab} tab */
  #onTabClose(tab) {
    const panes = this.#panes;
    const pane = panes && paneOfTab(panes, tab.linkedPanel);
    if (!panes || !pane) return;
    this.#panes = leaves(panes).length > 2 ? closePane(panes, pane) : null;
    // Not while Firefox is removing the tab: once it is gone, in a later task.
    this.#schedule();
  }

  #schedule() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    this.#win.setTimeout(() => {
      this.#scheduled = false;
      this.reconcile();
    }, 0);
  }

  /** @param {string} id */
  #tab(id) {
    return gBrowserOf(this.#win).tabs.find((t) => t.linkedPanel === id && !t.closing);
  }

  /** The wrapper's tabs in panel (DOM) order; [] without one. */
  #members() {
    const wrapper = this.#currentWrapper();
    if (!wrapper) return [];
    const panels = this.#win.document.getElementById("tabbrowser-tabpanels");
    const order = new Map([...(panels?.children ?? [])].map((p, i) => [p.id, i]));
    return wrapper.tabs
      .filter((t) => !t.closing)
      .sort((a, b) => (order.get(a.linkedPanel) ?? 0) - (order.get(b.linkedPanel) ?? 0));
  }

  /** @returns {Wrapper | null} */
  #currentWrapper() {
    if (this.#wrapper?.isConnected && this.#wrapper.tabs.length) return this.#wrapper;
    const ids = this.#panes ? leaves(this.#panes).map((l) => l.tab) : [];
    const found = ids.map((id) => this.#tab(id)?.splitview).find(Boolean) ?? null;
    this.#wrapper = found;
    return found;
  }

  /**
   * Makes Firefox match the tree: membership, panel order, visual hiding, docshells, selection,
   * then geometry. Idempotent: with nothing to change it changes nothing.
   */
  reconcile() {
    if (this.#reconciling) return;
    this.#reconciling = true;
    try {
      this.#reconcile();
    } finally {
      this.#reconciling = false;
    }
  }

  #reconcile() {
    const win = this.#win;
    const gBrowser = gBrowserOf(win);
    // A tree whose tabs are gone (closed outside a TabClose we saw) shrinks first.
    let panes = this.#panes;
    for (const leaf of panes ? leaves(panes) : []) {
      if (!panes || this.#tab(leaf.tab)) continue;
      panes = leaves(panes).length > 2 ? closePane(panes, leaf.pane) : null;
    }
    this.#panes = panes;

    const members = this.#members();
    const managed = new Set([...members, ...this.#laidOut]);
    for (const leaf of panes ? leaves(panes) : []) {
      const t = this.#tab(leaf.tab);
      if (t) managed.add(t);
    }
    const ids = (/** @type {Tab[]} */ tabs) => tabs.map((t) => t.linkedPanel);
    const plan = planSplit(
      { tabs: ids(gBrowser.tabs.filter((t) => !t.closing)), panes },
      {
        members: ids(members),
        active: ids([...managed].filter((t) => t.linkedBrowser?.docShellIsActive)),
        hidden: ids([...managed].filter((t) => isHidden(win, t))),
      },
    );
    const focusTab =
      panes && this.#tab(leaves(panes).find((l) => l.pane === panes.focus)?.tab ?? "");
    // Select the focused pane's tab before membership changes when it is already a member, so
    // the split never suspends to show a tab that is about to leave; else after joining.
    const memberIds = new Set(ids(members));
    if (focusTab && memberIds.has(focusTab.linkedPanel)) this.#select(focusTab);
    this.#membership(plan, members);
    this.#order(plan);
    if (focusTab) this.#select(focusTab);
    this.#apply(plan);
    this.#geometry();
    this.#label();
  }

  /** @param {Tab} tab */
  #select(tab) {
    const gBrowser = gBrowserOf(this.#win);
    if (gBrowser.selectedTab !== tab) gBrowser.selectedTab = tab;
  }

  /**
   * @param {SplitPlan} plan
   * @param {Tab[]} members
   */
  #membership(plan, members) {
    const gBrowser = gBrowserOf(this.#win);
    const tabs = (/** @type {string[]} */ list) =>
      /** @type {Tab[]} */ (list.map((id) => this.#tab(id)).filter(Boolean));
    const join = tabs(plan.join);
    for (const t of join) if (t.pinned) gBrowser.unpinTab(t);
    if (plan.leave.length) {
      // A rebuild (ADR-013): the wrapper's private #tabs is not updated when one tab leaves a
      // wrapper of three or more. Synchronous, in one task: no paint sees the gap.
      const leaving = new Set(plan.leave);
      const kept = members.filter((t) => !leaving.has(t.linkedPanel));
      this.#currentWrapper()?.unsplitTabs();
      this.#wrapper = null;
      const all = [...kept, ...join];
      if (all.length >= 2) {
        this.#wrapper = gBrowser.addTabSplitView(all, { insertBefore: all[0] });
      }
    } else if (join.length) {
      const wrapper = this.#currentWrapper();
      if (wrapper) wrapper.addTabs(join);
      else {
        const all = [...members, ...join];
        this.#wrapper = gBrowser.addTabSplitView(all, { insertBefore: all[0] });
      }
    }
  }

  /**
   * Puts the panels in reading order (Tab-key order; Firefox orders only panels 0 and 1).
   * @param {SplitPlan} plan
   */
  #order(plan) {
    const doc = this.#win.document;
    const parent = doc.getElementById("tabbrowser-tabpanels");
    if (!parent) return;
    const members = this.#members();
    for (const { tab, before } of plan.order) {
      const panel = doc.getElementById(tab);
      if (!panel) continue;
      const ref = before
        ? doc.getElementById(before)
        : /** @type {Element | null} */ (
            doc.getElementById(members.at(-1)?.linkedPanel ?? "")?.nextElementSibling ?? null
          );
      if (ref === panel || panel.nextElementSibling === ref) continue;
      /** @type {any} */ (parent).moveBefore(panel, ref);
    }
  }

  /** @param {SplitPlan} plan */
  #apply(plan) {
    const win = this.#win;
    for (const id of plan.showVisually) {
      const t = this.#tab(id);
      if (t) setHidden(win, t, false);
    }
    for (const id of plan.hideVisually) {
      const t = this.#tab(id);
      if (t) setHidden(win, t, true);
    }
    for (const id of plan.activate) {
      const t = this.#tab(id);
      if (t?.linkedBrowser) t.linkedBrowser.docShellIsActive = true;
    }
    // Firefox leaves a tab that left a split, or a zoomed-away one, active (sub-spec 1).
    for (const id of plan.deactivate) {
      const t = this.#tab(id);
      if (t?.linkedBrowser && !t.selected) t.linkedBrowser.docShellIsActive = false;
    }
  }

  /** Writes each pane's rectangle; also the ResizeObserver's callback. */
  #geometry() {
    const win = this.#win;
    const panes = this.#panes;
    const tabpanels = win.document.getElementById("tabbrowser-tabpanels");
    if (!panes || !tabpanels) {
      // Only what we laid out: a split made outside Vimma is not ours (adopted in sub-spec 6).
      if (this.#laidOut.size) clearLayout(win, [...this.#laidOut]);
      this.#laidOut.clear();
      this.#resize?.disconnect();
      this.#resize = null;
      return;
    }
    const area = contentArea(win);
    /** @type {Map<Tab, import("./layout.mjs").Rect>} */
    const rects = new Map();
    for (const r of layout(panes, area)) {
      const t = this.#tab(r.tab);
      if (t) rects.set(t, r.rect);
    }
    const shown = new Set(leaves(panes).map((l) => l.tab));
    const gone = [...this.#laidOut].filter((t) => !shown.has(t.linkedPanel));
    clearLayout(win, gone, { all: false });
    for (const t of gone) this.#laidOut.delete(t);
    applyLayout(win, rects, area);
    for (const t of rects.keys()) this.#laidOut.add(t);
    if (!this.#resize) {
      const RO = /** @type {typeof ResizeObserver} */ (/** @type {any} */ (win).ResizeObserver);
      const observer = new RO(() => {
        if (this.#panes) this.#geometry();
      });
      observer.observe(tabpanels);
      this.#resize = observer;
    }
  }

  /**
   * Accessible names for the third pane on: Firefox's updateSplitViewAriaLabel names only the
   * first two ("left", "right").
   */
  #label() {
    const order = this.#panes ? leaves(this.#panes) : [];
    const labelled = new Set();
    order.forEach((leaf, i) => {
      const t = this.#tab(leaf.tab);
      if (!t || i < 2) return;
      t.setAttribute("aria-label", `${t.label}, pane ${i + 1} of ${order.length}`);
      t.setAttribute(LABEL_ATTR, "true");
      labelled.add(t);
    });
    for (const t of gBrowserOf(this.#win).tabs) {
      if (t.hasAttribute(LABEL_ATTR) && !labelled.has(t)) {
        t.removeAttribute(LABEL_ATTR);
        t.removeAttribute("aria-label");
      }
    }
  }
}

/** @type {WeakMap<Window, PaneView>} */
const views = new WeakMap();

/**
 * The host API (sub-spec 3's keys call it): one PaneView per browser window.
 */
export const PaneViews = Object.freeze({
  /** @param {Window} win */
  init(win) {
    if (views.has(win)) return;
    views.set(win, new PaneView(win));
    win.addEventListener("unload", () => PaneViews.uninit(win), { once: true });
  },

  /** @param {Window} win */
  uninit(win) {
    views.get(win)?.destroy();
    views.delete(win);
  },

  /**
   * @param {Window} win
   * @returns {PaneView | undefined}
   */
  get(win) {
    return views.get(win);
  },
});
