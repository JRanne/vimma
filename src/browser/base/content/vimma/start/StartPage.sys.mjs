/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The start page (spec: docs/specs/start-page.md). The home page is a default pref
// (browser.startup.homepage, in firefox-branding.js); the new-tab URL lives only in memory
// (AboutNewTab.newTabURL), so it is set here, once per app, while vimma.startpage.newtab is on.
// Firefox treats a chrome:// page as a blank new tab the same way it treats its own
// chrome://browser/content/blanktab.html (AboutNewTabRedirector): it loads in the parent
// process, and the URL bar stays empty because it is BROWSER_NEW_TAB_URL (isInitialPage,
// isBlankPageURL).

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
});

export const START_PAGE_URL = "chrome://browser/content/vimma/start/start.html";
const NEWTAB_PREF = "vimma.startpage.newtab";
const NEWTAB_TOPIC = "newtab-url-changed";

let started = false;

/** Sets or resets the new-tab URL from the pref; never replaces an extension's own page. */
function apply() {
  const newTab = lazy.AboutNewTab;
  const ours = newTab.newTabURL === START_PAGE_URL;
  if (Services.prefs.getBoolPref(NEWTAB_PREF, true)) {
    // Overridden by someone else (an extension's chrome_url_overrides.newtab): theirs wins.
    if (!ours && !newTab.newTabURLOverridden) newTab.newTabURL = START_PAGE_URL;
  } else if (ours) {
    newTab.resetNewTabURL();
  }
}

export const StartPage = {
  /**
   * Once per window (vimma.js); the new-tab URL once per app.
   * @param {Window & { gInitialPages?: string[] }} win  a browser window
   */
  init(win) {
    // The home page alone is not the new-tab URL when vimma.startpage.newtab is off: its URL
    // bar should still be empty.
    if (Array.isArray(win.gInitialPages) && !win.gInitialPages.includes(START_PAGE_URL)) {
      win.gInitialPages.push(START_PAGE_URL);
    }
    if (started) return;
    started = true;
    apply();
    Services.prefs.addObserver(NEWTAB_PREF, apply);
    // An extension that overrode the new tab resets it when it goes: apply makes it ours again.
    Services.obs.addObserver(apply, NEWTAB_TOPIC);
  },
};
