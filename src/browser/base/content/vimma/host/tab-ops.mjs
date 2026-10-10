/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Herdr tab keys over plain gBrowser (spec: docs/specs/m2-tab-keys.md). Other workspaces'
// tabs are hidden (m3-workspaces 2b), so `selectableTabs`, Firefox's visible tabs, is the
// current workspace's (and pinned tabs, which every workspace shows).

import { refusedScheme } from "../core/pageurl.mjs";
import { tabTarget } from "../core/tabs.mjs";

/** @import { Action } from "../core/dispatcher.mjs" */

/**
 * @typedef {object} TabBrowser  the part of gBrowser these keys use
 * @property {Element[]} visibleTabs
 * @property {Element & { pinned?: boolean }} selectedTab
 * @property {number} pinnedTabCount
 * @property {{ selectedIndex: number }} tabContainer
 * @property {(options?: object) => void} removeCurrentTab
 * @property {(tab: object, options?: object) => void} removeTab
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
 * `x` in the side panel (docs/specs/key-handling-batch.md § 4): closes `tab` as the tab
 * strip's close button would, selected or not. A pinned tab stays (core refuses it first).
 * @param {Window} win
 * @param {any} tab
 */
export function closeTabById(win, tab) {
  if (tab.pinned) return;
  const gBrowser = gBrowserOf(win);
  const { TabMetrics } = gBrowser;
  gBrowser.removeTab(tab, {
    animate: true,
    metricsContext: TabMetrics.userTriggeredContext(TabMetrics.METRIC_SOURCE.KEYBOARD),
  });
}

/**
 * `tab.restore` (ctrl+shift+t in the side panel): Firefox's own command for its ctrl+shift+t,
 * which reopens the last closed tab (or window, or the last session).
 * @param {Window} win
 */
export function restoreTab(win) {
  /** @type {any} */ (
    win.document.getElementById("History:RestoreLastClosedTabOrWindowOrSession")
  )?.doCommand();
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

/**
 * page.open (`:open text`) and `:tabnew text`: load what was typed as the URL bar would, through
 * URIFixup with keyword lookup (`allowThirdPartyFixup`: `example.com` gets a scheme, words go to
 * the default search engine; spec m1-cmdline, Settled). Every Vimma open that loads with the
 * system principal comes through here, so `refusedScheme` (`p`'s check) refuses `javascript:`
 * and `data:` first: Gecko lets a system-principal load put a `data:` page top-level (issue #98).
 * @param {Window} win
 * @param {string} text
 * @param {"current" | "tab"} where
 * @returns {boolean} false when refused (a `javascript:` or `data:` URL); nothing is loaded
 */
export function openUrl(win, text, where) {
  if (refusedScheme(text)) return false;
  /** @type {{ openTrustedLinkIn: (url: string, where: string, params: object) => void }} */ (
    /** @type {unknown} */ (win)
  ).openTrustedLinkIn(text, where, { allowThirdPartyFixup: true, inBackground: false });
  return true;
}

export const BLOCKED_URL_TEXT =
  "blocked: javascript: and data: URLs can't be opened from the command line";
