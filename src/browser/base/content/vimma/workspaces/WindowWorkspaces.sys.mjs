/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// One window's workspaces (docs/specs/m3-workspaces.md, sub-specs 2b and 3): the core model of
// which tab is in which workspace, kept in step with Firefox's tab events, and applied to the
// window with gBrowser.hideTab / showTab so that only the active workspace's tabs are visible.
//
// Persistence (sub-spec 3): tab ids are uuids kept in the tab value `vimma-tab` (a lazy tab has
// no linkedPanel until it is first selected), with the tab's workspace in `vimma-workspace`; the
// window value `vimma-workspaces` holds core's snapshot (order, each workspace's selected tab,
// pane trees, tab labels), written at the end of every task that changed something, never over
// a newer schema (canWrite). SessionStore brackets every restore into the window with
// SSWindowStateBusy / SSWindowStateReady: in between nothing is applied or written, and on Ready
// the model is rebuilt from the live tabs and the (maybe restored) window value.

import { planWorkspaceSwitch } from "../core/switchplan.mjs";
import { canWrite, readSnapshot, toSnapshot } from "../core/snapshot.mjs";
import { closePane, leaves } from "../core/panes.mjs";
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
import { LABEL_EVENT, TAB_LABEL_KEY } from "../host/tab-labels.mjs";
import { PaneViews } from "../split/PaneView.mjs";
import { CHANGED_TOPIC, WorkspaceStore } from "./WorkspaceStore.sys.mjs";

/** @import { Workspaces, WorkspaceRef, WorkspaceState } from "../core/workspaces.mjs" */
/** @import { Panes, PaneNode } from "../core/panes.mjs" */
/** @import { TabInfo } from "../core/switchplan.mjs" */
/** @import { TabLabels } from "../core/tablabels.mjs" */

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
});

/** The window value holding core's snapshot. */
export const WINDOW_KEY = "vimma-workspaces";
/** The tab value holding a tab's uuid. */
export const TAB_KEY = "vimma-tab";
/** The tab value holding the id of a tab's workspace. */
export const TAB_WORKSPACE_KEY = "vimma-workspace";

/**
 * @typedef {Element & { linkedPanel: string | null, userContextId: number, pinned: boolean,
 *   hidden: boolean, closing?: boolean, selected: boolean,
 *   splitview: (Element & { splitViewId: number }) | null }} Tab
 * @typedef {{ tabs: Tab[], visibleTabs: Tab[], selectedTab: Tab, hideTab: (t: Tab) => void,
 *   showTab: (t: Tab) => void, addTrustedTab: (url: string, options?: object) => Tab,
 *   insertBrowser: (t: Tab) => void }} TabBrowser
 */

const TAB_EVENTS = ["TabOpen", "TabClose", "TabSelect", "TabPinned", "TabUnpinned", LABEL_EVENT];
const SESSION_EVENTS = ["SSWindowStateBusy", "SSWindowStateReady", "SSWindowClosing"];

/** A new uuid, without braces. */
function newId() {
  return Services.uuid.generateUUID().toString().slice(1, -1);
}

/**
 * A pane tree with every leaf's tab renamed by `fn`; a leaf `fn` maps to undefined is closed.
 * Null when fewer than two panes are left (one pane is no split).
 * @param {Panes} panes
 * @param {(tab: string) => string | undefined} fn
 * @returns {Panes | null}
 */
function mapTree(panes, fn) {
  let tree = panes;
  for (const leaf of leaves(panes)) {
    if (fn(leaf.tab) !== undefined) continue;
    if (leaves(tree).length <= 2) return null;
    tree = closePane(tree, leaf.pane);
  }
  /** @type {(n: PaneNode) => PaneNode} */
  const walk = (n) =>
    n.type === "leaf"
      ? { ...n, tab: /** @type {string} */ (fn(n.tab)) }
      : { ...n, children: n.children.map(walk) };
  return leaves(tree).length >= 2 ? { ...tree, root: walk(tree.root) } : null;
}

export class WindowWorkspacesImpl {
  /** @type {Window & { gBrowser: TabBrowser, delayedStartupPromise?: Promise<void> }} */
  #win;
  /** @type {Workspaces | null} null until built, and for windows without workspaces */
  #model = null;
  /** Tabs of a container no workspace owns, adopted by the active workspace (decision 1). */
  /** @type {Set<string>} */
  #foreign = new Set();
  /** Each tab's uuid, and back. */
  /** @type {WeakMap<Tab, string>} */
  #ids = new WeakMap();
  /** @type {Map<string, Tab>} */
  #byId = new Map();
  #switching = false;
  /** Between SSWindowStateBusy and SSWindowStateReady: a restore is under way. */
  #pending = false;
  /** #start got as far as building (a Ready before that builds nothing). */
  #started = false;
  #saveQueued = false;
  /** The window value as last written, to tell our own value from a restored one. */
  #written = "";
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
    for (const type of [...TAB_EVENTS, ...SESSION_EVENTS]) win.addEventListener(type, this);
    Services.obs.addObserver(this.#observer, CHANGED_TOPIC);
    this.ready = this.#start().catch((e) => console.error("vimma: no workspaces", e));
  }

  destroy() {
    for (const type of [...TAB_EVENTS, ...SESSION_EVENTS]) {
      this.#win.removeEventListener(type, this);
    }
    Services.obs.removeObserver(this.#observer, CHANGED_TOPIC);
    const view = PaneViews.get(this.#win);
    if (view) view.onChange = null;
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
    this.#started = true;
    const view = PaneViews.get(win);
    if (view) view.onChange = () => this.#scheduleSave();
    // A restore under way builds on its SSWindowStateReady, from the restored values.
    if (!this.#pending) this.#reconcile();
  }

  /** The window's model, or null without workspaces. */
  get model() {
    return this.#model;
  }

  /**
   * The model's id of `tab`: its uuid.
   * @param {Tab} tab
   */
  idOf(tab) {
    return this.#idOf(tab);
  }

  /**
   * The open tab with model id `id`, or undefined.
   * @param {string} id
   */
  tabOf(id) {
    return this.#tab(id);
  }

  /** @param {Tab} tab */
  isForeign(tab) {
    return this.#foreign.has(this.#idOf(tab));
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
    if (this.#win.closed) return;
    switch (e.type) {
      case "SSWindowStateBusy":
        // Our value as it is now, before the restore replaces it (it may not carry ours).
        this.#save();
        this.#pending = true;
        return;
      case "SSWindowStateReady":
        this.#pending = false;
        if (this.#started) this.#reconcile();
        return;
      case "SSWindowClosing":
        this.#save();
        return;
    }
    // Tab events inside a restore are not applied: the Ready reconcile reads the live tabs.
    if (!this.#model || this.#pending) return;
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
        break;
      case LABEL_EVENT:
        this.#scheduleSave();
    }
  }

  /** Observer: the store's definitions changed (a workspace added, renamed or deleted). */
  #observer = () => {
    if (this.#model && !this.#win.closed && !this.#pending) this.#sync();
  };

  get #gBrowser() {
    return this.#win.gBrowser;
  }

  /** @param {Tab} tab */
  #live(tab) {
    return tab.isConnected && !tab.closing;
  }

  /** @param {string} id */
  #tab(id) {
    const tab = this.#byId.get(id);
    return tab && this.#live(tab) ? tab : undefined;
  }

  /**
   * A tab's uuid: the one it has, else its `vimma-tab` value unless another open tab holds it
   * (a duplicated tab copies its values), else a new one. Writes nothing; #save does.
   * @param {Tab} tab
   */
  #idOf(tab) {
    const known = this.#ids.get(tab);
    if (known) return known;
    const value = this.#tabValue(tab, TAB_KEY);
    const id = value && !this.#tab(value) ? value : newId();
    this.#ids.set(tab, id);
    this.#byId.set(id, tab);
    return id;
  }

  /**
   * Re-reads every open tab's uuid after a restore: its tab value wins (SessionStore has just
   * set it), the one we knew comes next, a new one last; a second holder of a uuid gets another.
   */
  #rereadIds() {
    const old = this.#ids;
    this.#ids = new WeakMap();
    this.#byId = new Map();
    const tabs = this.#gBrowser.tabs.filter((t) => this.#live(t));
    /** @param {Tab} tab @param {string} id */
    const take = (tab, id) => {
      this.#ids.set(tab, id);
      this.#byId.set(id, tab);
    };
    for (const t of tabs) {
      const before = old.get(t);
      if (before && before === this.#tabValue(t, TAB_KEY)) take(t, before);
    }
    for (const t of tabs) {
      if (this.#ids.has(t)) continue;
      const value = this.#tabValue(t, TAB_KEY);
      const before = old.get(t);
      if (value && !this.#byId.has(value)) take(t, value);
      else if (before && !this.#byId.has(before)) take(t, before);
      else take(t, newId());
    }
  }

  /** @param {Tab} tab @param {string} key */
  #tabValue(tab, key) {
    try {
      return lazy.SessionStore.getCustomTabValue(tab, key) || "";
    } catch {
      return "";
    }
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

  /** The window value; "" when there is none or SessionStore does not track the window yet. */
  #windowValue() {
    try {
      return lazy.SessionStore.getCustomWindowValue(this.#win, WINDOW_KEY) || "";
    } catch {
      return "";
    }
  }

  /**
   * Builds the model from the open tabs, which are the truth, and the window value, which
   * supplies each workspace's selected tab, the pane trees and the labels (Reconcile in the
   * spec). Runs at init and after every restore into the window; idempotent.
   */
  #reconcile() {
    const defs = this.#defs();
    if (!defs.length) return;
    const gBrowser = this.#gBrowser;
    this.#rereadIds();
    const raw = this.#windowValue();
    const restored = raw !== "" && raw !== this.#written;
    /** @type {{ state: Workspaces, tabLabels: TabLabels } | null} */
    let snapshot = null;
    if (restored && canWrite(raw)) {
      try {
        snapshot = readSnapshot(raw);
      } catch (e) {
        console.warn("vimma: the window's workspaces could not be read", e);
      }
    } else if (restored) {
      console.warn("vimma: this window's workspaces were saved by a newer vimma; left alone");
    }
    const base = snapshot?.state ?? this.#model;
    const known = (/** @type {string | undefined} */ id) =>
      id && defs.some((d) => d.id === id) ? id : undefined;

    const prev = this.#model;
    let model = createWorkspaces(
      defs.map((d) => ({ id: d.id, name: d.name, container: String(d.userContextId) })),
    );
    this.#model = model;
    const routed = WorkspaceStore.defaultUserContextId(this.#win);
    const fallback =
      known(base?.active) ??
      (routed === null ? undefined : this.#owner(routed)?.id) ??
      model.active;
    this.#foreign = new Set();
    for (const tab of gBrowser.tabs) {
      if (!this.#live(tab) || tab.pinned) continue;
      const id = this.#idOf(tab);
      const owner = this.#owner(tab.userContextId)?.id;
      if (!owner) this.#foreign.add(id);
      const ws =
        owner ??
        known(base ? workspaceOfTab(base, id)?.id : undefined) ??
        known(this.#tabValue(tab, TAB_WORKSPACE_KEY)) ??
        fallback;
      model = openTab(model, id, { workspace: { id: ws }, activate: false });
    }
    // Each workspace's selected tab, then the active workspace: the selected tab's.
    for (const w of base?.workspaces ?? []) {
      const into = w.activeTab ? workspaceOfTab(model, w.activeTab) : undefined;
      if (w.activeTab && into?.id === w.id) model = selectTab(model, w.activeTab);
    }
    const selected = gBrowser.selectedTab;
    const selectedId = selected.pinned ? undefined : this.#ids.get(selected);
    if (selectedId && workspaceOfTab(model, selectedId)) model = selectTab(model, selectedId);
    else model = switchWorkspace(model, { id: fallback });

    let from = prev ?? model;
    if (snapshot) {
      this.#restoreLabels(snapshot.tabLabels);
      if (this.#restorePanes(snapshot.state, model)) from = model;
    }
    this.#model = from;
    this.#show(from, model);
    WorkspaceStore.setActive(this.#win, /** @type {Workspaces} */ (this.#model).active);
  }

  /**
   * A label the snapshot has for a tab that came back without its `vimma.tabLabel` value.
   * @param {TabLabels} labels
   */
  #restoreLabels(labels) {
    for (const [id, label] of Object.entries(labels)) {
      const tab = this.#tab(id);
      if (tab && !this.#tabValue(tab, TAB_LABEL_KEY)) {
        lazy.SessionStore.setCustomTabValue(tab, TAB_LABEL_KEY, label);
      }
    }
  }

  /**
   * Hands the snapshot's pane trees to the window's PaneView, with the panel ids PaneView uses;
   * a lazy member gets its browser (not loaded), as Firefox's split view gives it on
   * activation. Returns whether it did.
   * @param {Workspaces} saved
   * @param {Workspaces} model  the rebuilt model
   */
  #restorePanes(saved, model) {
    const view = PaneViews.get(this.#win);
    if (!view) return false;
    /** @type {Map<string, Panes>} */
    const trees = new Map();
    for (const w of saved.workspaces) {
      const ours = findWorkspace(model, { id: w.id });
      if (!w.panes || !ours) continue;
      const tree = mapTree(w.panes, (id) => {
        const tab = this.#tab(id);
        if (!tab || !ours.tabs.includes(id)) return undefined;
        if (!tab.linkedPanel) this.#gBrowser.insertBrowser(tab);
        return tab.linkedPanel ?? undefined;
      });
      if (tree) trees.set(w.id, tree);
    }
    view.restore(trees, model.active);
    return true;
  }

  /**
   * Puts a tab in the model: in the workspace owning its container, else the active one, marked
   * foreign. A tab joining a workspace that is not shown is hidden (decision 12: no switch).
   * @param {Tab} tab
   */
  #adopt(tab) {
    const model = /** @type {Workspaces} */ (this.#model);
    const id = this.#idOf(tab);
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
    this.#changed();
  }

  /** @param {Tab} tab */
  #onClose(tab) {
    const model = /** @type {Workspaces} */ (this.#model);
    const id = this.#idOf(tab);
    this.#foreign.delete(id);
    if (!workspaceOfTab(model, id)) return;
    this.#model = closeTab(model, id);
    // Pinned tabs are out of the model and never hidden (decision 11).
    if (tab.pinned && tab.hidden) this.#gBrowser.showTab(tab);
    this.#changed();
  }

  /**
   * A tab of another workspace selected (the goto picker, URL-bar switch-to-tab, undo close)
   * switches to that workspace (mapping table, `selectTab`).
   * @param {Tab} tab
   */
  #onSelect(tab) {
    const model = /** @type {Workspaces} */ (this.#model);
    const id = this.#idOf(tab);
    if (this.#switching || tab.pinned || !workspaceOfTab(model, id)) return;
    const next = selectTab(model, id);
    if (next.active === model.active) {
      this.#model = next;
      this.#scheduleSave();
      return;
    }
    // Not inside Firefox's own selection (a removeTab picking the next tab, a restore): hiding
    // and selecting from there confuses its tab switcher. Once it is done, if still current.
    this.#win.queueMicrotask(() => {
      const now = this.#model;
      if (!now || this.#win.closed || this.#pending || tab.closing || !tab.selected) return;
      if (!workspaceOfTab(now, id)) return;
      const after = selectTab(now, id);
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
      this.#changed();
    }
  }

  /** Firefox's tabs as the switch planner reads them. */
  #tabsState() {
    const gBrowser = this.#gBrowser;
    /** @type {TabInfo[]} */
    const tabs = gBrowser.tabs
      .filter((t) => !t.closing)
      .map((t) => ({
        id: this.#idOf(t),
        hidden: t.hidden,
        pinned: t.pinned,
        group: t.splitview ? String(t.splitview.splitViewId) : null,
      }));
    return { tabs, selected: this.#idOf(gBrowser.selectedTab) };
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
    this.#changed();
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

  /** The model or the visibility changed: tell the host; save at the end of the task. */
  #changed() {
    this.#onChange();
    this.#scheduleSave();
  }

  #scheduleSave() {
    if (this.#saveQueued) return;
    this.#saveQueued = true;
    this.#win.queueMicrotask(() => {
      this.#saveQueued = false;
      this.#save();
    });
  }

  /**
   * The model with PaneView's trees (the shown one and the parked ones) in uuids, each
   * workspace's selected tab being its focused pane's, as core's snapshot requires.
   * @param {Workspaces} model
   * @returns {Workspaces}
   */
  #withPanes(model) {
    const view = PaneViews.get(this.#win);
    if (!view) return model;
    const uuid = (/** @type {string} */ panel) => {
      const tab = this.#gBrowser.tabs.find((t) => t.linkedPanel === panel && this.#live(t));
      return tab ? this.#idOf(tab) : undefined;
    };
    /** @type {WorkspaceState[]} */
    const workspaces = model.workspaces.map((w) => {
      const panes = w.id === model.active ? view.panes : view.parked(w.id);
      const tree =
        panes &&
        mapTree(panes, (p) => {
          const id = uuid(p);
          return id && w.tabs.includes(id) ? id : undefined;
        });
      if (!tree) return w;
      const focus = leaves(tree).find((l) => l.pane === tree.focus)?.tab;
      return focus ? { ...w, panes: tree, activeTab: focus } : w;
    });
    return { ...model, workspaces };
  }

  /**
   * Writes the tab values and the window value, unless a restore is under way or the window
   * value was written by a newer vimma (canWrite).
   */
  #save() {
    const model = this.#model;
    if (!model || this.#pending || this.#win.closed) return;
    const SessionStore = lazy.SessionStore;
    /** @type {Record<string, string>} */
    const labels = {};
    for (const w of model.workspaces) {
      for (const id of w.tabs) {
        const tab = this.#tab(id);
        if (!tab) continue;
        if (this.#tabValue(tab, TAB_KEY) !== id) SessionStore.setCustomTabValue(tab, TAB_KEY, id);
        if (this.#tabValue(tab, TAB_WORKSPACE_KEY) !== w.id) {
          SessionStore.setCustomTabValue(tab, TAB_WORKSPACE_KEY, w.id);
        }
        const label = this.#tabValue(tab, TAB_LABEL_KEY);
        if (label) labels[id] = label;
      }
    }
    let existing;
    try {
      existing = SessionStore.getCustomWindowValue(this.#win, WINDOW_KEY);
    } catch {
      // Not tracked by SessionStore yet (before delayed startup): once it is.
      this.#win.delayedStartupPromise?.then(() => this.#scheduleSave());
      return;
    }
    if (!canWrite(existing)) return;
    let snapshot;
    try {
      snapshot = JSON.stringify(toSnapshot(this.#withPanes(model), { tabLabels: labels }));
      readSnapshot(snapshot);
    } catch (e) {
      console.warn("vimma: pane trees left out of the window's snapshot", e);
      snapshot = JSON.stringify(toSnapshot(model, { tabLabels: labels }));
    }
    if (snapshot === existing) return;
    this.#written = snapshot;
    SessionStore.setCustomWindowValue(this.#win, WINDOW_KEY, snapshot);
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
