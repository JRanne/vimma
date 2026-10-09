/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The workspace model (spec m3-m4-core-models). Each workspace maps to a Firefox container
 * (`container` is opaque here), owns an ordered list of tab ids and a pane layout. The host applies
 * the result: shows the active workspace's tabs, hides the others, mirrors the layout.
 * Every operation is pure; a no-op returns the input state itself.
 */

import {
  closePane,
  createPanes,
  focusPane,
  leaves,
  paneOfTab,
  setPaneTab,
  split,
} from "./panes.mjs";

/** @import { Panes } from "./panes.mjs" */
/** @import { SplitDirection } from "./panes.mjs" */
/** @import { Leaf } from "./panes.mjs" */
/**
 * @typedef {{ readonly id: string, readonly name: string, readonly container: string,
 *   readonly tabs: readonly string[], readonly activeTab: string | null,
 *   readonly panes: Panes | null }} WorkspaceState
 */
/**
 * `next` mints workspace ids (`w<next>`). A workspace's index is its 1-based position.
 * @typedef {{ readonly workspaces: readonly WorkspaceState[], readonly active: string,
 *   readonly next: number }} Workspaces
 */
/** @typedef {{ id: string } | { index: number } | { name: string }} WorkspaceRef */
/**
 * `id` is optional: the M3 host passes the global id from its definitions file so that ids agree
 * across windows; without one the model mints `w<next>`.
 * @typedef {{ name: string, container: string, id?: string }} WorkspaceDef
 */

/** Longest explicit workspace id, in UTF-16 code units (a `ws-<uuid>` is 39). */
export const MAX_WORKSPACE_ID = 128;

/**
 * A valid workspace id: a string of 1 to MAX_WORKSPACE_ID characters without whitespace or
 * control characters. Minted ids (`w<n>`) are valid ids.
 * @param {unknown} id
 * @returns {id is string}
 */
export function isWorkspaceId(id) {
  return typeof id === "string" && id.length <= MAX_WORKSPACE_ID && /^[^\s\p{Cc}]+$/u.test(id);
}

export class WorkspaceError extends Error {
  /**
   * @param {"unknown-workspace" | "duplicate-name" | "empty-name" | "duplicate-container" |
   *   "empty-container" | "unknown-tab" | "duplicate-tab" | "last-workspace" | "no-tab" |
   *   "bad-id" | "duplicate-id"} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

/**
 * @param {Workspaces} s
 * @param {WorkspaceRef} ref
 * @returns {number} array position, or -1
 */
function indexOf(s, ref) {
  if ("id" in ref) return s.workspaces.findIndex((w) => w.id === ref.id);
  if ("name" in ref) return s.workspaces.findIndex((w) => w.name === ref.name);
  return Number.isInteger(ref.index) && ref.index >= 1 && ref.index <= s.workspaces.length
    ? ref.index - 1
    : -1;
}

/**
 * @param {Workspaces} s
 * @param {WorkspaceRef} ref
 * @returns {number}
 */
function mustIndex(s, ref) {
  const i = indexOf(s, ref);
  if (i < 0) throw new WorkspaceError("unknown-workspace", `no workspace ${JSON.stringify(ref)}`);
  return i;
}

/**
 * @param {Workspaces} s
 * @param {string} tabId
 * @returns {number}
 */
function indexOfTab(s, tabId) {
  const i = s.workspaces.findIndex((w) => w.tabs.includes(tabId));
  if (i < 0) throw new WorkspaceError("unknown-tab", `no tab "${tabId}"`);
  return i;
}

/** @param {Workspaces} s */
function activeIndex(s) {
  return s.workspaces.findIndex((w) => w.id === s.active);
}

/**
 * @param {WorkspaceState} w
 * @param {Partial<WorkspaceState>} changes
 * @returns {WorkspaceState}
 */
function updateWs(w, changes) {
  const next = { ...w, ...changes };
  return Object.freeze({ ...next, tabs: Object.freeze(next.tabs.slice()) });
}

/**
 * @param {Workspaces} s
 * @param {{ workspaces?: WorkspaceState[], active?: string, next?: number }} changes
 * @returns {Workspaces}
 */
function updateState(s, changes) {
  const next = { ...s, ...changes };
  return Object.freeze({ ...next, workspaces: Object.freeze(next.workspaces.slice()) });
}

/**
 * @param {Workspaces} s
 * @param {number} i
 * @param {WorkspaceState} w
 * @param {{ active?: string }} [extra]
 * @returns {Workspaces}
 */
function replaceWs(s, i, w, extra = {}) {
  const workspaces = s.workspaces.slice();
  workspaces[i] = w;
  return updateState(s, { workspaces, ...extra });
}

/**
 * @param {Workspaces} s
 * @param {string} name
 * @param {string | null} self id of the workspace being renamed
 */
function checkName(s, name, self) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new WorkspaceError("empty-name", "workspace name is empty");
  if (s.workspaces.some((w) => w.name === trimmed && w.id !== self)) {
    throw new WorkspaceError("duplicate-name", `workspace "${trimmed}" already exists`);
  }
  return trimmed;
}

/**
 * @param {Workspaces} s
 * @param {string} tabId
 * @param {string} [except]
 */
function checkNewTab(s, tabId, except) {
  if (tabId !== except && s.workspaces.some((w) => w.tabs.includes(tabId))) {
    throw new WorkspaceError("duplicate-tab", `tab "${tabId}" is already open`);
  }
}

/**
 * Makes `tabId` (already in `w.tabs`) the active tab: focus its pane, or show it in the focused one.
 * @param {WorkspaceState} w
 * @param {string} tabId
 * @returns {WorkspaceState}
 */
function showTab(w, tabId) {
  const panes = /** @type {Panes} */ (w.panes);
  const shownIn = paneOfTab(panes, tabId);
  const next = shownIn ? focusPane(panes, shownIn) : setPaneTab(panes, panes.focus, tabId);
  return next === panes && w.activeTab === tabId
    ? w
    : updateWs(w, { panes: next, activeTab: tabId });
}

/**
 * Workspaces in `[workspaces]` (ctrl+i) order; the first is active.
 * @param {WorkspaceDef[]} defs
 * @returns {Workspaces}
 */
export function createWorkspaces(defs) {
  if (!defs.length) throw new WorkspaceError("last-workspace", "need at least one workspace");
  /** @type {Workspaces} */
  let s = Object.freeze({ workspaces: Object.freeze([]), active: "", next: 1 });
  defs.forEach((d, i) => {
    s = addWorkspace(s, d, { activate: i === 0 });
  });
  return s;
}

/**
 * @param {Workspaces} s
 * @returns {WorkspaceState}
 */
export function activeWorkspace(s) {
  return /** @type {WorkspaceState} */ (s.workspaces[activeIndex(s)]);
}

/**
 * @param {Workspaces} s
 * @param {WorkspaceRef} ref
 * @returns {WorkspaceState | undefined}
 */
export function findWorkspace(s, ref) {
  return s.workspaces[indexOf(s, ref)];
}

/**
 * @param {Workspaces} s
 * @param {string} tabId
 * @returns {WorkspaceState | undefined}
 */
export function workspaceOfTab(s, tabId) {
  return s.workspaces.find((w) => w.tabs.includes(tabId));
}

/**
 * Appends a workspace, with `def.id` when given (`bad-id`, `duplicate-id`).
 * @param {Workspaces} s
 * @param {WorkspaceDef} def
 * @param {{ activate?: boolean }} [options]
 * @returns {Workspaces}
 */
export function addWorkspace(s, def, { activate = true } = {}) {
  const name = checkName(s, def.name, null);
  if (typeof def.container !== "string" || !def.container) {
    throw new WorkspaceError("empty-container", `workspace "${name}" needs a container`);
  }
  if (s.workspaces.some((w) => w.container === def.container)) {
    throw new WorkspaceError("duplicate-container", `container "${def.container}" is in use`);
  }
  let id = `w${s.next}`;
  let next = s.next + 1;
  if (def.id !== undefined) {
    if (!isWorkspaceId(def.id)) {
      throw new WorkspaceError("bad-id", `bad workspace id ${JSON.stringify(def.id)}`);
    }
    if (s.workspaces.some((w) => w.id === def.id)) {
      throw new WorkspaceError("duplicate-id", `workspace id "${def.id}" is in use`);
    }
    id = def.id;
    // Minted ids must never collide with an explicit one shaped like them (snapshot `next` rule).
    const minted = /^w(\d+)$/.exec(id);
    next = minted ? Math.max(s.next, Number(minted[1]) + 1) : s.next;
  }
  const w = updateWs(
    { id, name, container: def.container, tabs: [], activeTab: null, panes: null },
    {},
  );
  return updateState(s, {
    workspaces: [...s.workspaces, w],
    active: activate ? id : s.active,
    next,
  });
}

/**
 * @param {Workspaces} s
 * @param {WorkspaceRef} ref
 * @param {string} name
 * @returns {Workspaces}
 */
export function renameWorkspace(s, ref, name) {
  const i = mustIndex(s, ref);
  const w = /** @type {WorkspaceState} */ (s.workspaces[i]);
  const trimmed = checkName(s, name, w.id);
  return trimmed === w.name ? s : replaceWs(s, i, updateWs(w, { name: trimmed }));
}

/**
 * Deletes a workspace; its tabs are returned for the host to close (Herdr `close_workspace`).
 * The previous workspace (the next, if it was first) becomes active if this one was.
 * @param {Workspaces} s
 * @param {WorkspaceRef} ref
 * @returns {{ state: Workspaces, closedTabs: string[] }}
 */
export function deleteWorkspace(s, ref) {
  const i = mustIndex(s, ref);
  if (s.workspaces.length === 1) {
    throw new WorkspaceError("last-workspace", "cannot delete the last workspace");
  }
  const w = /** @type {WorkspaceState} */ (s.workspaces[i]);
  const workspaces = s.workspaces.filter((_, k) => k !== i);
  const active =
    s.active === w.id
      ? /** @type {WorkspaceState} */ (workspaces[Math.max(0, i - 1)]).id
      : s.active;
  return { state: updateState(s, { workspaces, active }), closedTabs: w.tabs.slice() };
}

/**
 * @param {Workspaces} s
 * @param {WorkspaceRef} ref
 * @returns {Workspaces}
 */
export function switchWorkspace(s, ref) {
  const w = /** @type {WorkspaceState} */ (s.workspaces[mustIndex(s, ref)]);
  return w.id === s.active ? s : updateState(s, { active: w.id });
}

/**
 * @param {Workspaces} s
 * @param {number} step
 */
function cycle(s, step) {
  const n = s.workspaces.length;
  return switchWorkspace(s, { index: ((activeIndex(s) + step + n) % n) + 1 });
}

/**
 * `ctrl+i`; wraps around.
 * @param {Workspaces} s
 * @returns {Workspaces}
 */
export function nextWorkspace(s) {
  return cycle(s, 1);
}

/**
 * `ctrl+u`; wraps around.
 * @param {Workspaces} s
 * @returns {Workspaces}
 */
export function previousWorkspace(s) {
  return cycle(s, -1);
}

/**
 * Opens a tab into a workspace (default: the active one), after `after` or at the end. `activate`
 * makes it that workspace's active tab, shown in its focused pane; it never switches workspace.
 * The first tab of an empty workspace is always active.
 * @param {Workspaces} s
 * @param {string} tabId
 * @param {{ workspace?: WorkspaceRef, after?: string, activate?: boolean }} [options]
 * @returns {Workspaces}
 */
export function openTab(s, tabId, { workspace, after, activate = true } = {}) {
  checkNewTab(s, tabId);
  const i = workspace ? mustIndex(s, workspace) : activeIndex(s);
  const w = /** @type {WorkspaceState} */ (s.workspaces[i]);
  const tabs = w.tabs.slice();
  if (after === undefined) tabs.push(tabId);
  else {
    const k = tabs.indexOf(after);
    if (k < 0) throw new WorkspaceError("unknown-tab", `no tab "${after}" in "${w.name}"`);
    tabs.splice(k + 1, 0, tabId);
  }
  let next = updateWs(w, { tabs });
  if (!w.panes) next = updateWs(next, { panes: createPanes(tabId), activeTab: tabId });
  else if (activate) next = showTab(next, tabId);
  return replaceWs(s, i, next);
}

/**
 * Closes a tab. The active tab passes to its right neighbour, else its left (Firefox). A pane that
 * showed the tab shows the new active tab (focused pane) or a hidden tab, else it is closed.
 * @param {Workspaces} s
 * @param {string} tabId
 * @returns {Workspaces}
 */
export function closeTab(s, tabId) {
  const i = indexOfTab(s, tabId);
  const w = /** @type {WorkspaceState} */ (s.workspaces[i]);
  const at = w.tabs.indexOf(tabId);
  const tabs = w.tabs.filter((t) => t !== tabId);
  if (!tabs.length) return replaceWs(s, i, updateWs(w, { tabs, activeTab: null, panes: null }));
  let panes = /** @type {Panes} */ (w.panes);
  let activeTab = /** @type {string} */ (w.activeTab);
  const pane = paneOfTab(panes, tabId);
  if (activeTab === tabId) {
    activeTab = /** @type {string} */ (tabs[at] ?? tabs[at - 1]);
    const shownIn = paneOfTab(panes, activeTab);
    panes = shownIn
      ? focusPane(closePane(panes, panes.focus), shownIn)
      : setPaneTab(panes, panes.focus, activeTab);
  } else if (pane) {
    const shown = new Set(leaves(panes).map((l) => l.tab));
    const order = [...tabs.slice(at), ...tabs.slice(0, at).reverse()];
    const hidden = order.find((t) => !shown.has(t));
    panes = hidden ? setPaneTab(panes, pane, hidden) : closePane(panes, pane);
  }
  return replaceWs(s, i, updateWs(w, { tabs, activeTab, panes }));
}

/**
 * Activates a tab anywhere: switches to its workspace, focuses its pane or shows it in the
 * focused one (goto picker, side panel, `prefix+1..9`).
 * @param {Workspaces} s
 * @param {string} tabId
 * @returns {Workspaces}
 */
export function selectTab(s, tabId) {
  const i = indexOfTab(s, tabId);
  const w = /** @type {WorkspaceState} */ (s.workspaces[i]);
  const next = showTab(w, tabId);
  if (next === w && w.id === s.active) return s;
  return replaceWs(s, i, next, { active: w.id });
}

/**
 * Moves a tab to the end of another workspace, not activated. The host reopens the page in the
 * target container and passes the new tab's id (default: the same id). If the host's TabOpen
 * handler already registered the new tab in the target, it stays where it is and only the old
 * tab is removed, so the order of the two host events does not matter.
 * @param {Workspaces} s
 * @param {string} tabId
 * @param {WorkspaceRef} ref
 * @param {{ newTabId?: string }} [options]
 * @returns {Workspaces}
 */
export function moveTab(s, tabId, ref, { newTabId = tabId } = {}) {
  const from = indexOfTab(s, tabId);
  const to = mustIndex(s, ref);
  if (from === to) return s;
  const target = /** @type {WorkspaceState} */ (s.workspaces[to]);
  if (newTabId !== tabId && target.tabs.includes(newTabId)) return closeTab(s, tabId);
  checkNewTab(s, newTabId, tabId);
  return openTab(closeTab(s, tabId), newTabId, { workspace: { id: target.id }, activate: false });
}

/**
 * `prefix+v` / `prefix+-`: opens `newTabId` after the active tab and splits the focused pane with
 * it. In an empty workspace the tab simply becomes its only pane.
 * @param {Workspaces} s
 * @param {SplitDirection} direction
 * @param {string} newTabId
 * @returns {Workspaces}
 */
export function splitPane(s, direction, newTabId) {
  const w = activeWorkspace(s);
  if (!w.panes) return openTab(s, newTabId);
  checkNewTab(s, newTabId);
  const tabs = w.tabs.slice();
  tabs.splice(tabs.indexOf(/** @type {string} */ (w.activeTab)) + 1, 0, newTabId);
  const panes = split(w.panes, w.panes.focus, direction, newTabId);
  return replaceWs(s, activeIndex(s), updateWs(w, { tabs, panes, activeTab: newTabId }));
}

/**
 * Applies a pane operation to the active workspace's layout; the focused pane's tab becomes the
 * active tab.
 * @param {Workspaces} s
 * @param {(panes: Panes) => Panes} fn
 * @returns {Workspaces}
 */
export function withPanes(s, fn) {
  const w = activeWorkspace(s);
  if (!w.panes) throw new WorkspaceError("no-tab", `workspace "${w.name}" has no tabs`);
  const panes = fn(w.panes);
  if (panes === w.panes) return s;
  const shown = leaves(panes);
  for (const l of shown) {
    if (!w.tabs.includes(l.tab)) {
      throw new WorkspaceError("unknown-tab", `pane shows "${l.tab}", not a tab of "${w.name}"`);
    }
  }
  const activeTab = /** @type {string} */ (paneTab(shown, panes.focus));
  return replaceWs(s, activeIndex(s), updateWs(w, { panes, activeTab }));
}

/**
 * @param {Leaf[]} shown
 * @param {string} pane
 */
function paneTab(shown, pane) {
  return shown.find((l) => l.pane === pane)?.tab;
}
