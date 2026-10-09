/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What the goto picker lists (spec: docs/specs/m2-picker-rename.md): core pickerItems over the
// window's tabs. Tab ids are `tab.linkedPanel`.

import { pickerItems } from "../core/picker.mjs";
import { getTabLabel } from "./tab-labels.mjs";
import { selectableTabs } from "./tab-ops.mjs";

/** @import { PickerItem } from "../core/picker.mjs" */
/** @import { Workspaces } from "../core/workspaces.mjs" */

/**
 * @typedef {Element & { linkedPanel: string, label: string,
 *   linkedBrowser: { contentTitle: string, currentURI: { spec: string } } }} Tab
 * @typedef {{ selectedTab: Tab, tabs: Tab[] }} TabBrowser
 */

/** @param {Window} win */
function gBrowserOf(win) {
  return /** @type {{ gBrowser: TabBrowser }} */ (/** @type {unknown} */ (win)).gBrowser;
}

/**
 * The workspace model the picker lists. M3 seam: until workspaces exist this is one workspace
 * holding the window's selectable tabs; M3 returns its own model (every workspace's tabs).
 * @param {Window} win
 * @returns {Workspaces}
 */
export function pickerWorkspaces(win) {
  const tabs = /** @type {Tab[]} */ (selectableTabs(win));
  const workspace = {
    id: "window",
    name: "",
    container: "",
    tabs: tabs.map((t) => t.linkedPanel),
    activeTab: gBrowserOf(win).selectedTab.linkedPanel,
    panes: null,
  };
  return { workspaces: [workspace], active: workspace.id, next: 1 };
}

/**
 * @param {Window} win
 * @param {string} tabId
 * @returns {Tab | undefined}
 */
export function tabById(win, tabId) {
  return gBrowserOf(win).tabs.find((t) => t.linkedPanel === tabId);
}

/**
 * Every tab the picker lists, with its title, URL and rename.
 * @param {Window} win
 * @returns {PickerItem[]}
 */
export function gotoItems(win) {
  const model = pickerWorkspaces(win);
  /** @type {Record<string, string>} */
  const labels = {};
  for (const id of model.workspaces.flatMap((w) => w.tabs)) {
    const tab = tabById(win, id);
    const label = tab && getTabLabel(tab);
    if (label) labels[id] = label;
  }
  return pickerItems(
    model,
    (id) => {
      const tab = tabById(win, id);
      if (!tab) return undefined;
      const browser = tab.linkedBrowser;
      return { title: browser.contentTitle || tab.label, url: browser.currentURI?.spec ?? "" };
    },
    labels,
  );
}
