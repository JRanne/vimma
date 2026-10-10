/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The side panel (docs/specs/m3-workspaces.md, sub-spec 6): what it lists and what its keys do,
 * as pure functions over the workspace model. The host renders it (ui/side-panel.mjs).
 */
import { activeWorkspace } from "./workspaces.mjs";
import { displayLabel } from "./tablabels.mjs";

/** @import { Workspaces } from "./workspaces.mjs" */

/**
 * What the host knows of a tab; undefined for one it no longer has.
 * @typedef {{ title?: string, url?: string, label?: string | null, foreign?: boolean,
 *   playing?: boolean }} PanelTabInfo
 */
/**
 * @typedef {{ readonly tabId: string, readonly number: number, readonly display: string,
 *   readonly host: string, readonly active: boolean, readonly foreign: boolean,
 *   readonly playing: boolean }} PanelRow
 */
/**
 * `previous` / `next`: the workspaces ctrl+u / ctrl+i go to, null with one workspace.
 * @typedef {{ readonly workspace: { id: string, name: string, index: number, color?: string },
 *   readonly previous: string | null, readonly next: string | null,
 *   readonly rows: readonly PanelRow[], readonly selected: number }} PanelState
 */
/**
 * @typedef {{ type: "select", id: string } | { type: "close" }
 *   | { type: "refuse", text: string }} PanelEffect
 */

/**
 * The host of a URL, or the URL itself when it has none (about:, data:).
 * @param {string} url
 */
function hostOf(url) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * The panel for the model's active workspace: its tabs in the model's order (the host passes
 * them in window order), the highlight on `selectedId` when listed, else on the active tab.
 * @param {Workspaces} model
 * @param {(tabId: string) => PanelTabInfo | undefined} info
 * @param {{ color?: string, selectedId?: string | null }} [options]
 * @returns {PanelState}
 */
export function openPanel(model, info, { color, selectedId = null } = {}) {
  const w = activeWorkspace(model);
  const at = model.workspaces.indexOf(w);
  const n = model.workspaces.length;
  const neighbour = (/** @type {number} */ step) =>
    n > 1 ? /** @type {{ name: string }} */ (model.workspaces[(at + step + n) % n]).name : null;
  const rows = w.tabs.map((tabId, i) => {
    const t = info(tabId) ?? {};
    return Object.freeze({
      tabId,
      number: i + 1,
      display: displayLabel(t),
      host: t.url ? hostOf(t.url) : "",
      active: tabId === w.activeTab,
      foreign: !!t.foreign,
      playing: !!t.playing,
    });
  });
  const find = (/** @type {string | null} */ id) => rows.findIndex((r) => r.tabId === id);
  const selected = find(selectedId) >= 0 ? find(selectedId) : Math.max(0, find(w.activeTab));
  return Object.freeze({
    workspace: Object.freeze({
      id: w.id,
      name: w.name,
      index: at + 1,
      ...(color ? { color } : {}),
    }),
    previous: neighbour(-1),
    next: neighbour(1),
    rows: Object.freeze(rows),
    selected,
  });
}

/**
 * The panel again after the model changed (a tab opened or closed, ctrl+i): the highlight stays
 * on its tab while that is listed in the same workspace.
 * @param {PanelState} state
 * @param {Workspaces} model
 * @param {(tabId: string) => PanelTabInfo | undefined} info
 * @param {{ color?: string }} [options]
 * @returns {PanelState}
 */
export function refreshPanel(state, model, info, { color } = {}) {
  const same = activeWorkspace(model).id === state.workspace.id;
  const selectedId = same ? (state.rows[state.selected]?.tabId ?? null) : null;
  return openPanel(model, info, { color, selectedId });
}

/**
 * One panel action (defaults.mjs `[modal.panel]`).
 * @param {PanelState} state
 * @param {{ id: string, arg?: number }} action
 * @returns {{ state: PanelState, effect: PanelEffect | null }}
 */
export function panelKey(state, action) {
  const last = state.rows.length - 1;
  /** @param {number} selected */
  const move = (selected) =>
    Object.freeze({ state: Object.freeze({ ...state, selected }), effect: null });
  /** @param {PanelRow | undefined} row */
  const select = (row) => ({
    state,
    effect: row ? /** @type {PanelEffect} */ ({ type: "select", id: row.tabId }) : null,
  });
  switch (action.id) {
    case "panel.down":
      return move(Math.max(0, Math.min(last, state.selected + 1)));
    case "panel.up":
      return move(Math.max(0, state.selected - 1));
    case "panel.open":
      return select(state.rows[state.selected]);
    case "panel.select": {
      const n = action.arg ?? 0;
      const row = state.rows[n - 1];
      if (row) return select(row);
      return { state, effect: { type: "refuse", text: `no tab ${n} in ${state.workspace.name}` } };
    }
    case "panel.close":
      return { state, effect: { type: "close" } };
    default:
      return { state, effect: null };
  }
}
