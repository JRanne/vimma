/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/start-page.md

"use strict";

/* global focusContent -- from head.js */
/* global BrowserCommands, OpenBrowserWindow -- browser window globals (browser.js) */

const { VimmaHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
);
const { AboutNewTab } = ChromeUtils.importESModule("resource:///modules/AboutNewTab.sys.mjs");
const { HomePage } = ChromeUtils.importESModule("resource:///modules/HomePage.sys.mjs");

const START = "chrome://browser/content/vimma/start/start.html";
const CMDLINE_ID = "vimma-cmdline";
const HELP_ID = "vimma-help";

registerCleanupFunction(() => {
  while (gBrowser.tabs.length > 1) gBrowser.removeTab(gBrowser.tabs.at(-1));
});

/** Opens a new tab the way ctrl+t does and waits for the start page to load in it. */
async function openStartTab() {
  const loaded = BrowserTestUtils.waitForNewTab(gBrowser, START, true);
  BrowserCommands.openTab();
  return loaded;
}

/** The logo in `browser`'s start page, once it has decoded. */
function logoState(browser) {
  return SpecialPowers.spawn(browser, [], async () => {
    const img = content.document.querySelector("img");
    if (!img) return null;
    await img.decode().catch(() => {});
    return { width: img.naturalWidth, alt: img.alt, hint: content.document.body.textContent };
  });
}

add_task(async function new_tab_is_the_start_page() {
  Assert.equal(AboutNewTab.newTabURL, START, "the new-tab URL is the start page");
  const tab = await openStartTab();
  const browser = tab.linkedBrowser;
  Assert.equal(browser.currentURI.spec, START, "the new tab shows the start page");

  const logo = await logoState(browser);
  Assert.ok(logo, "the page has the logo image");
  Assert.greater(logo.width, 0, "the logo loads (naturalWidth > 0)");
  Assert.equal(logo.alt, "Vimma", "the logo has alt text");
  Assert.stringContains(logo.hint, "f hints", "the key hint is under the logo");

  await TestUtils.waitForCondition(() => gURLBar.focused, "the URL bar is focused");
  Assert.equal(gURLBar.value, "", "the URL bar is empty, the page's URL is not shown");

  const loaded = BrowserTestUtils.browserLoaded(browser, false, "https://example.org/");
  EventUtils.sendString("https://example.org/");
  EventUtils.synthesizeKey("KEY_Enter");
  await loaded;
  Assert.equal(browser.currentURI.spec, "https://example.org/", "typing a URL navigates");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function new_window_home_page_is_the_start_page() {
  Assert.equal(HomePage.getDefault(), START, "the default home page is the start page");
  // The harness profile opens about:blank (browser.startup.page = 0, testing/profiles); new
  // windows open the home page with 1 (Firefox's default) and 3 (M3's session restore) alike
  // (BrowserContentHandler getNewWindowArgs).
  await SpecialPowers.pushPrefEnv({
    set: [["browser.startup.page", 1]],
    clear: [["browser.startup.homepage"]],
  });
  Assert.equal(HomePage.get(), START, "the home page is the start page");

  const opened = BrowserTestUtils.waitForNewWindow({ url: START });
  OpenBrowserWindow();
  const win = await opened;
  Assert.equal(win.gBrowser.selectedBrowser.currentURI.spec, START, "a new window opens it");
  Assert.equal(win.gURLBar.value, "", "and its URL bar is empty");
  await BrowserTestUtils.closeWindow(win);
  await SpecialPowers.popPrefEnv();
});

add_task(async function vimma_keys_work_on_the_start_page() {
  const tab = await openStartTab();
  await focusContent(tab.linkedBrowser);
  Assert.equal(VimmaHost.status(window).mode, "normal", "the start page is in normal mode");

  EventUtils.synthesizeKey(":", { shiftKey: true });
  const cmdline = document.getElementById(CMDLINE_ID);
  Assert.ok(cmdline && !cmdline.hidden, ": opens the command line");
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => cmdline.hidden, "Esc closes the command line");

  await focusContent(tab.linkedBrowser);
  EventUtils.synthesizeKey("b", { ctrlKey: true });
  EventUtils.synthesizeKey("?", { shiftKey: true });
  const help = () => document.getElementById(HELP_ID);
  await TestUtils.waitForCondition(
    () => help() && BrowserTestUtils.isVisible(help()),
    "ctrl+b ? opens the help overlay",
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    () => !help() || !BrowserTestUtils.isVisible(help()),
    "Esc closes it",
  );
  BrowserTestUtils.removeTab(tab);
});
