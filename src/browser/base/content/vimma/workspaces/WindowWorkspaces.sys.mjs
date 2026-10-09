/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// One window's workspaces (docs/specs/m3-workspaces.md, sub-spec 2b): the core model of which
// tab is in which workspace, kept in step with Firefox's tab events, and applied to the window
// with gBrowser.hideTab / showTab so that only the active workspace's tabs are visible. Tab ids
// are `tab.linkedPanel` (as the picker and PaneView use); persistence (sub-spec 3) adds uuids.

import { planWorkspaceSwitch } from "../core/switchplan.mjs";
import {
  activeWorkspace,
  addWorkspace,
  closeTab,
  createWorkspaces,
  deleteWorkspace,
  findWorkspace,
  nextWorkspace,
  openTab,
  previousWorkspace,
  renameWorkspace,
  selectTab,
  switchWorkspace,
  workspaceOfTab,
} from "../core/workspaces.mjs";
import { PaneViews } from "../split/PaneView.mjs";
import { CHANGED_TOPIC, WorkspaceStore } from "./WorkspaceStore.sys.mjs";

/** @import { Workspaces, WorkspaceRef } from "../core/workspaces.mjs" */
/** @import { TabInfo } from "../core/switchplan.mjs" */

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

/**
 * @typedef {Element & { linkedPanel: string, userContextId: number, pinned: boolean,
 *   hidden: boolean, closing?: boolean, selected: boolean,
 *   splitview: (Element & { splitViewId: number }) | null }} Tab
 * @typedef {{ tabs: Tab[], visibleTabs: Tab[], selectedTab: Tab, hideTab: (t: Tab) => void,
 *   showTab: (t: Tab) => void, addTrustedTab: (url: string, options?: object) => Tab }} TabBrowser
 */

const TAB_EVENTS = ["TabOpen", "TabClose", "TabSelect", "TabPinned", "TabUnpinned"];

export class WindowWorkspacesImpl {
  /** @type {Window & { gBrowser: TabBrowser }} */
  #win;
  /** @type {Workspaces | null} null until built, and for windows without workspaces */
  #model = null;
  /** Tabs of a container no workspace owns, adopted by the active workspace (decision 1). */
  /** @type {Set<string>} */
  #foreign = new Set();
  #switching = false;
  #onChange;
  /** Resolves once the model is built (or the window has none). */
  ready;

  /**
   * @param {Window} win
   * @param {{ onChange?: () => void }} [options]  told after the model or visibility changed
   */
  constructor(win, { onChange = () => {} } = {}) {
    this.#win = /** @type {any} */ (win);
    this.#onChange = onChange;
    for (const type of TAB_EVENTS) win.addEventListener(type, this);
    Services.obs.addObserver(this.#observer, CHANGED_TOPIC);
    this.ready = this.#start().catch((e) => console.error("vimma: no workspaces", e));
  }

  destroy() {
    for (const type of TAB_EVENTS) this.#win.removeEventListener(type, this);
    Services.obs.removeObserver(this.#observer, CHANGED_TOPIC);
    this.#model = null;
  }

  async #start() {
    const win = this.#win;
    if (lazy.PrivateBrowsingUtils.isWindowPrivate(win) || win.toolbar?.visible === false) return;
    await WorkspaceStore.init();
    if (win.document.readyState === "loading") {
      await new Promise((r) => win.addEventListener("DOMContentLoaded", r, { once: true }));
    }
    if (win.closed || WorkspaceStore.disabled) return;
    this.#build();
  }

  /** The window's model, or null without workspaces. */
  get model() {
    return this.#model;
  }

  /** @param {Tab} tab */
  isForeign(tab) {
    return this.#foreign.has(tab.linkedPanel);
  }

  /** The status bar's workspace segment: the active workspace's name, place and colour. */
  status() {
    const model = this.#model;
    if (!model) return null;
    const w = activeWorkspace(model);
    const def = WorkspaceStore.definitions.workspaces.find((d) => d.id === w.id);
    return {
      name: w.name,
      index: model.workspaces.indexOf(w) + 1,
      ...(def ? { color: def.color } : {}),
    };
  }

  /**
   * Shows workspace `ref`. Returns why not, or null.
   * @param {WorkspaceRef} ref
   * @returns {string | null}
   */
  switchTo(ref) {
    const model = this.#model;
    if (!model) return "no workspaces in this window";
    if (!findWorkspace(model, ref)) {
      const name = "name" in ref ? ref.name : "index" in ref ? String(ref.index) : ref.id;
      return `no workspace "${name}"`;
    }
    this.#show(model, switchWorkspace(model, ref));
    return null;
  }

  /** ctrl+i; wraps. */
  next() {
    if (!this.#model) return "no workspaces in this window";
    this.#show(this.#model, nextWorkspace(this.#model));
    return null;
  }

  /** ctrl+u; wraps. */
  previous() {
    if (!this.#model) return "no workspaces in this window";
    this.#show(this.#model, previousWorkspace(this.#model));
    return null;
  }

  /** @param {Event} e */
  handleEvent(e) {
    if (!this.#model || this.#win.closed) return;
    const tab = /** @type {Tab} */ (e.target);
    switch (e.type) {
      case "TabOpen":
      case "TabUnpinned":
        this.#onOpen(tab);
        break;
      case "TabClose":
      case "TabPinned":
        this.#onClose(tab);
        break;
      case "TabSelect":
        this.#onSelect(tab);
    }
  }

  /** Observer: the store's definitions changed (a workspace added, renamed or deleted). */
  #observer = () => {
    if (this.#model && !this.#win.closed) this.#sync();
  };

  get #gBrowser() {
    return this.#win.gBrowser;
  }

  /** @param {string} id */
  #tab(id) {
    return this.#gBrowser.tabs.find((t) => t.linkedPanel === id && !t.closing);
  }

  /** Workspace definitions with a container, in ctrl+i order. */
  #defs() {
    return WorkspaceStore.definitions.workspaces.filter((d) => d.userContextId !== null);
  }

  /**
   * The workspace that owns a container (decision 1), or undefined.
   * @param {number} userContextId
   */
  #owner(userContextId) {
    const model = /** @type {Workspaces} */ (this.#model);
    return model.workspaces.find((w) => w.container === String(userContextId));
  }

  #build() {
    const defs = this.#defs();
    if (!defs.length) return;
    let model = createWorkspaces(
      defs.map((d) => ({ id: d.id, name: d.name, container: String(d.userContextId) })),
    );
    this.#model = model;
    const routed = WorkspaceStore.defaultUserContextId(this.#win);
    const start = routed === null ? undefined : this.#owner(routed);
    if (start) model = switchWorkspace(model, { id: start.id });
    this.#model = model;
    for (const tab of this.#gBrowser.tabs) if (!tab.closing && !tab.pinned) this.#adopt(tab);
    const selected = this.#gBrowser.selectedTab;
    let built = /** @type {Workspaces} */ (this.#model);
    if (workspaceOfTab(built, selected.linkedPanel)) built = selectTab(built, selected.linkedPanel);
    this.#show(model, built);
    // New tabs of this window route to its workspace from now on (decision 3).
    WorkspaceStore.setActive(this.#win, /** @type {Workspaces} */ (this.#model).active);
  }

  /**
   * Puts a tab in the model: in the workspace owning its container, else the active one, marked
   * foreign. A tab joining a workspace that is not shown is hidden (decision 12: no switch).
   * @param {Tab} tab
   */
  #adopt(tab) {
    const model = /** @type {Workspaces} */ (this.#model);
    const id = tab.linkedPanel;
    if (workspaceOfTab(model, id)) return;
    const owner = this.#owner(tab.userContextId);
    const ws = owner ?? activeWorkspace(model);
    if (!owner) this.#foreign.add(id);
    this.#model = openTab(model, id, { workspace: { id: ws.id }, activate: false });
    if (ws.id === model.active || tab.selected) return;
    // Firefox's replacement for a closing last tab must stay visible: it is about to be
    // selected, and with it hidden the close would find no tab to select. Its selection then
    // switches to its workspace.
    const others = this.#gBrowser.visibleTabs.filter((t) => t !== tab && !t.closing);
    if (others.length) this.#gBrowser.hideTab(tab);
  }

  /** @param {Tab} tab */
  #onOpen(tab) {
    if (tab.pinned) return;
    this.#adopt(tab);
    this.#onChange();
  }

  /** @param {Tab} tab */
  #onClose(tab) {
    const model = /** @type {Workspaces} */ (this.#model);
    const id = tab.linkedPanel;
    this.#foreign.delete(id);
    if (!workspaceOfTab(model, id)) return;
    this.#model = closeTab(model, id);
    // Pinned tabs are out of the model and never hidden (decision 11).
    if (tab.pinned && tab.hidden) this.#gBrowser.showTab(tab);
    this.#onChange();
  }

  /**
   * A tab of another workspace selected (the goto picker, URL-bar switch-to-tab, undo close)
   * switches to that workspace (mapping table, `selectTab`).
   * @param {Tab} tab
   */
  #onSelect(tab) {
    const model = /** @type {Workspaces} */ (this.#model);
    if (this.#switching || tab.pinned || !workspaceOfTab(model, tab.linkedPanel)) return;
    const next = selectTab(model, tab.linkedPanel);
    if (next.active === model.active) {
      this.#model = next;
      return;
    }
    // Not inside Firefox's own selection (a removeTab picking the next tab, a restore): hiding
    // and selecting from there confuses its tab switcher. Once it is done, if still current.
    this.#win.queueMicrotask(() => {
      const now = this.#model;
      if (!now || this.#win.closed || tab.closing || !tab.selected) return;
      if (!workspaceOfTab(now, tab.linkedPanel)) return;
      const after = selectTab(now, tab.linkedPanel);
      if (after.active !== now.active) this.#show(now, after);
      else this.#model = after;
    });
  }

  /** Brings the model in line with the store: new workspaces, renames, deletions. */
  #sync() {
    const before = /** @type {Workspaces} */ (this.#model);
    let model = before;
    const defs = this.#defs();
    /** @type {string[]} */
    let orphans = [];
    for (const w of model.workspaces) {
      if (defs.some((d) => d.id === w.id) || model.workspaces.length === 1) continue;
      const { state, closedTabs } = deleteWorkspace(model, { id: w.id });
      model = state;
      orphans = [...orphans, ...closedTabs];
    }
    for (const d of defs) {
      const w = findWorkspace(model, { id: d.id });
      if (!w) {
        model = addWorkspace(
          model,
          { id: d.id, name: d.name, container: String(d.userContextId) },
          { activate: false },
        );
      } else if (w.name !== d.name) {
        model = renameWorkspace(model, { id: d.id }, d.name);
      }
    }
    this.#model = model;
    // Never close a live tab because its workspace went (Zen's zombies): the active one takes it.
    for (const id of orphans) {
      const tab = this.#tab(id);
      if (tab) this.#adopt(tab);
    }
    if (/** @type {Workspaces} */ (this.#model).active !== before.active) {
      this.#show(before, /** @type {Workspaces} */ (this.#model));
    } else {
      this.#onChange();
    }
  }

  /** Firefox's tabs as the switch planner reads them. */
  #tabsState() {
    const gBrowser = this.#gBrowser;
    /** @type {TabInfo[]} */
    const tabs = gBrowser.tabs
      .filter((t) => !t.closing)
      .map((t) => ({
        id: t.linkedPanel,
        hidden: t.hidden,
        pinned: t.pinned,
        group: t.splitview ? String(t.splitview.splitViewId) : null,
      }));
    return { tabs, selected: gBrowser.selectedTab.linkedPanel };
  }

  /**
   * Applies `next` (from `prev`): the target's tab selected first (Firefox will not hide the
   * selected tab), its tabs shown, every other workspace's hidden, splits as a whole; an empty
   * target gets a start-page tab (or its `home`) in its container.
   * @param {Workspaces} prev
   * @param {Workspaces} next
   */
  #show(prev, next) {
    const gBrowser = this.#gBrowser;
    const view = PaneViews.get(this.#win);
    this.#model = next;
    this.#switching = true;
    try {
      view?.swap(prev.active, next.active);
      const target = activeWorkspace(next);
      if (!target.activeTab) this.#openHome(target.id, Number(target.container));
      const model = /** @type {Workspaces} */ (this.#model);
      const plan = planWorkspaceSwitch(model, undefined, this.#tabsState());
      const select = plan.select ? this.#tab(plan.select) : undefined;
      if (select && gBrowser.selectedTab !== select) gBrowser.selectedTab = select;
      for (const id of plan.show) {
        const t = this.#tab(id);
        if (t) gBrowser.showTab(t);
      }
      for (const id of plan.hide) {
        const t = this.#tab(id);
        if (t) gBrowser.hideTab(t);
      }
      // Decision 14 broken outside Vimma; adopting such splits is M4 sub-spec 6.
      if (plan.unsplit.length) console.warn("vimma: a split spans workspaces", plan.unsplit);
      view?.reconcile();
    } finally {
      this.#switching = false;
    }
    const active = /** @type {Workspaces} */ (this.#model).active;
    if (active !== prev.active) WorkspaceStore.setActive(this.#win, active);
    this.#onChange();
  }

  /**
   * @param {string} id
   * @param {number} userContextId
   */
  #openHome(id, userContextId) {
    const def = WorkspaceStore.definitions.workspaces.find((d) => d.id === id);
    const url = def?.home ?? /** @type {any} */ (this.#win).BROWSER_NEW_TAB_URL;
    // TabOpen puts it in the model (its container's workspace, active by now).
    this.#gBrowser.addTrustedTab(url, { userContextId, skipAnimation: true });
  }
}

/** @type {WeakMap<Window, WindowWorkspacesImpl>} */
const windows = new WeakMap();

/** One WindowWorkspaces per browser window; VimmaHost starts and stops them. */
export const WindowWorkspaces = Object.freeze({
  /**
   * @param {Window} win
   * @param {{ onChange?: () => void }} [options]
   */
  init(win, options) {
    if (!windows.has(win)) windows.set(win, new WindowWorkspacesImpl(win, options));
    return /** @type {WindowWorkspacesImpl} */ (windows.get(win));
  },

  /** @param {Window} win */
  uninit(win) {
    windows.get(win)?.destroy();
    windows.delete(win);
  },

  /** @param {Window} win */
  get(win) {
    return windows.get(win);
  },
});
