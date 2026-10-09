/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Herdr tab keys over plain gBrowser (spec: docs/specs/m2-tab-keys.md). Workspaces (M3) will
// narrow `selectableTabs` to the current workspace's tabs; nothing else here should change.

import { tabTarget } from "../core/tabs.mjs";

/** @import { Action } from "../core/dispatcher.mjs" */

/**
 * @typedef {object} TabBrowser  the part of gBrowser these keys use
 * @property {Element[]} visibleTabs
 * @property {Element & { pinned?: boolean }} selectedTab
 * @property {number} pinnedTabCount
 * @property {{ selectedIndex: number }} tabContainer
 * @property {(options?: object) => void} removeCurrentTab
 * @property {{ userTriggeredContext: (source: string) => object,
 *   METRIC_SOURCE: { KEYBOARD: string } }} TabMetrics
 */

/** @param {Window} win */
function gBrowserOf(win) {
  return /** @type {{ gBrowser: TabBrowser }} */ (/** @type {unknown} */ (win)).gBrowser;
}

/**
 * The tabs prefix+n/p and prefix+1..9 count through, in order. Firefox's visible tabs: hidden
 * tabs (an extension's, or another workspace's from M3) are skipped.
 * @param {Window} win
 * @returns {Element[]}
 */
export function selectableTabs(win) {
  return gBrowserOf(win).visibleTabs;
}

/**
 * tab.new: Firefox's own new-tab command (ctrl+t): the new-tab page, the URL bar focused.
 * @param {Window} win
 */
export function newTab(win) {
  /** @type {{ BrowserCommands: { openTab: () => void } }} */ (
    /** @type {unknown} */ (win)
  ).BrowserCommands.openTab();
}

/**
 * tab.close: what Firefox's ctrl+w does (BrowserCommands.closeTabOrWindow with a modifier
 * event, browser-commands.js): on a pinned tab it selects the first unpinned tab instead of
 * closing; otherwise it closes the selected tab, and the last tab closes the window unless
 * `browser.tabs.closeWindowWithLastTab` is false (M3 sets it false). Metrics as for ctrl+w.
 * @param {Window} win
 */
export function closeTab(win) {
  const gBrowser = gBrowserOf(win);
  if (gBrowser.selectedTab.pinned) {
    if (gBrowser.visibleTabs.length > gBrowser.pinnedTabCount) {
      gBrowser.tabContainer.selectedIndex = gBrowser.pinnedTabCount;
    }
    return;
  }
  const { TabMetrics } = gBrowser;
  gBrowser.removeCurrentTab({
    animate: true,
    metricsContext: TabMetrics.userTriggeredContext(TabMetrics.METRIC_SOURCE.KEYBOARD),
  });
}

/**
 * tab.next, tab.previous, tab.goto.
 * @param {Window} win
 * @param {Action} action
 */
export function selectTab(win, action) {
  const gBrowser = gBrowserOf(win);
  const tabs = selectableTabs(win);
  const index = tabTarget(action, tabs.indexOf(gBrowser.selectedTab), tabs.length);
  const tab = index === null ? undefined : tabs[index];
  if (tab && tab !== gBrowser.selectedTab) gBrowser.selectedTab = tab;
}
