/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Workspace operations (docs/specs/m3-workspaces.md, sub-specs 4a, 4b and 5): new, rename, close
// (after a y/N question), moving the current tab (from the picker after a y/N warning) and the
// picker's rows, over the app's WorkspaceStore and the window's WindowWorkspaces. Each operation
// returns the text to show in the notice, or null.

import { workspaceItems } from "../core/picker.mjs";
import { closeWorkspaceQuestion, moveTabQuestion } from "../core/workspacedefs.mjs";
import { findWorkspace, workspaceRefFor } from "../core/workspaces.mjs";
import { WindowWorkspaces } from "../workspaces/WindowWorkspaces.sys.mjs";
import { WorkspaceStore } from "../workspaces/WorkspaceStore.sys.mjs";

/** @import { WorkspaceItem } from "../core/picker.mjs" */
/** @import { WorkspaceRef, Workspaces } from "../core/workspaces.mjs" */

export const NO_WORKSPACES = "no workspaces in this window";

/**
 * What the user typed as a workspace: a workspace of exactly that name first (config.toml
 * accepts names of digits), else a number is its place in workspace order, else a name.
 * @param {string} text
 * @param {Workspaces | null | undefined} model  the window's
 * @returns {WorkspaceRef}
 */
export function workspaceRef(text, model) {
  return workspaceRefFor(model, text);
}

/** @param {unknown} e */
const reason = (e) => /** @type {Error} */ (e).message;

/**
 * The definition of the window's active workspace, or of `text`'s.
 * @param {Window} win
 * @param {string} [text]
 */
function definitionOf(win, text) {
  const model = WindowWorkspaces.get(win)?.model;
  if (!model) return { refused: NO_WORKSPACES };
  const id = !text ? model.active : findWorkspace(model, workspaceRefFor(model, text))?.id;
  const def = WorkspaceStore.definitions.workspaces.find((d) => d.id === id);
  return def ? { def } : { refused: `no workspace "${text}"` };
}

/**
 * `prefix+shift+n` / `:wsnew name`: a runtime workspace with its own container, shown at once.
 * @param {Window} win
 * @param {string} name
 * @returns {string | null}
 */
export function newWorkspace(win, name) {
  const ww = WindowWorkspaces.get(win);
  if (!ww?.model) return NO_WORKSPACES;
  try {
    // The store tells every window (synchronously), so the model has it before the switch.
    const def = WorkspaceStore.newWorkspace(name);
    return ww.switchTo({ id: def.id });
  } catch (e) {
    return `new workspace: ${reason(e)}`;
  }
}

/**
 * The active workspace's name, for `prefix+shift+w` to put on the command line.
 * @param {Window} win
 */
export function activeWorkspaceName(win) {
  return definitionOf(win).def?.name ?? null;
}

/**
 * `:wsrename name`: renames the active workspace (and its container), in every window.
 * @param {Window} win
 * @param {string} name
 * @returns {string | null}
 */
export function renameWorkspace(win, name) {
  const { def, refused } = definitionOf(win);
  if (!def) return refused ?? NO_WORKSPACES;
  try {
    WorkspaceStore.renameWorkspace(def.id, name);
    return null;
  } catch (e) {
    return `rename workspace: ${reason(e)}`;
  }
}

/**
 * `prefix+shift+d` / `:wsdelete [name]`: asks first (decision 7), through `ask(question, yes)`.
 * On yes, the window leaves the workspace if it shows it, then the store closes it: a runtime
 * one with its container and site data, a config one only its tabs (in every window).
 * @param {Window} win
 * @param {string | undefined} text
 * @param {(question: string, yes: () => void) => void} ask
 * @param {(text: string) => void} say  the notice, for a refusal after the answer
 * @returns {string | null}
 */
export function closeWorkspace(win, text, ask, say) {
  const { def, refused } = definitionOf(win, text);
  if (!def) return refused ?? NO_WORKSPACES;
  if (WorkspaceStore.definitions.workspaces.length === 1) return "cannot close the last workspace";
  const tabs = def.userContextId === null ? 0 : countTabs(def.userContextId);
  if (def.source === "config" && tabs === 0) {
    return `"${def.name}" has no tabs, and stays: it is in config.toml`;
  }
  // The yes stands for the workspace as asked about, not as it may be by the time of the `y`.
  const asked = { source: def.source, name: def.name, userContextId: def.userContextId };
  ask(closeWorkspaceQuestion(def, tabs), () => {
    const now = WorkspaceStore.definitions.workspaces.find((d) => d.id === def.id);
    if (
      now?.source !== asked.source ||
      now.name !== asked.name ||
      now.userContextId !== asked.userContextId
    ) {
      say(`close workspace: "${asked.name}" changed since you were asked; nothing was closed`);
      return;
    }
    const ww = WindowWorkspaces.get(win);
    if (ww?.model?.active === def.id) ww.previous();
    WorkspaceStore.closeWorkspace(def.id, { confirmed: true, asked }).then(
      ({ cleared }) => {
        if (asked.source === "runtime" && !cleared) {
          say(
            `closed "${asked.name}"; its container is no longer vimma's (renamed in Settings?), ` +
              "so its tabs and site data were kept",
          );
        }
      },
      (e) => say(`close workspace: ${reason(e)}`),
    );
  });
  return null;
}

/**
 * Tabs in container `userContextId`, in every browser window.
 * @param {number} userContextId
 */
function countTabs(userContextId) {
  let n = 0;
  for (const w of /** @type {any} */ (Services.wm).getEnumerator("navigator:browser")) {
    const tabs = /** @type {{ userContextId: number, closing?: boolean }[]} */ (
      /** @type {any} */ (w).gBrowser?.tabs ?? []
    );
    n += tabs.filter((t) => t.userContextId === userContextId && !t.closing).length;
  }
  return n;
}

/**
 * `:wsmove name|number`: the selected tab to that workspace (decision 6), reopened there.
 * @param {Window} win
 * @param {string} text
 * @returns {string} what happened, or why not
 */
export function moveTabToWorkspace(win, text) {
  const ww = WindowWorkspaces.get(win);
  if (!ww?.model) return NO_WORKSPACES;
  const ref = workspaceRef(text, ww.model);
  const to = findWorkspace(ww.model, ref)?.name;
  const tab = /** @type {any} */ (win).gBrowser.selectedTab;
  const refused = ww.moveTab(tab, ref);
  if (refused) return refused;
  return `moved to "${to}": reopened there, without its back/forward history`;
}

/**
 * The window's workspace names in workspace order, for Tab after `:ws`, `:wd` and `:wsmove`.
 * @param {Window} win
 * @returns {string[]}
 */
export function workspaceNames(win) {
  return WindowWorkspaces.get(win)?.model?.workspaces.map((w) => w.name) ?? [];
}

/**
 * The `prefix+w` picker's rows: the window's workspaces, with their tab counts.
 * @param {Window} win
 * @returns {WorkspaceItem[]}
 */
export function workspacePickerItems(win) {
  const ww = WindowWorkspaces.get(win);
  const model = ww?.model;
  if (!ww || !model) return [];
  return workspaceItems(model, (id) => {
    const tab = ww.tabOf(id);
    return !!tab && ww.isForeign(tab);
  });
}

/**
 * `m` in the workspace picker: moves the selected tab to workspace `id` once the user has
 * answered y to the warning that its history stays behind (decision 6). The yes stands for this
 * tab and the workspace as asked about: a tab no longer selected, or a workspace renamed or gone
 * by the time of the `y`, moves nothing.
 * @param {Window} win
 * @param {string} id
 * @param {(question: string, yes: () => void) => void} ask
 * @param {(text: string) => void} say  the notice, after the answer
 * @returns {string | null} why not, before asking
 */
export function moveTabFromPicker(win, id, ask, say) {
  const ww = WindowWorkspaces.get(win);
  const model = ww?.model;
  if (!ww || !model) return NO_WORKSPACES;
  const target = model.workspaces.find((w) => w.id === id);
  if (!target) return "that workspace is gone";
  const gBrowser = /** @type {any} */ (win).gBrowser;
  const tab = gBrowser.selectedTab;
  if (target.tabs.includes(ww.idOf(tab)) && !ww.isForeign(tab)) {
    return `already in "${target.name}"`;
  }
  const name = target.name;
  ask(moveTabQuestion(name), () => {
    const now = ww.model?.workspaces.find((w) => w.id === id);
    if (now?.name !== name || !tab.isConnected || gBrowser.selectedTab !== tab) {
      say(`move: the tab or "${name}" changed since you were asked; nothing was moved`);
      return;
    }
    say(ww.moveTab(tab, { id }) ?? `moved to "${name}": reopened there, without its history`);
  });
  return null;
}
