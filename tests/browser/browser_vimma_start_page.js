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

add_task(async function the_page_shows_the_vimma_and_firefox_versions() {
  const { AppConstants } = ChromeUtils.importESModule(
    "resource://gre/modules/AppConstants.sys.mjs",
  );
  const tab = await openStartTab();
  const state = await SpecialPowers.spawn(tab.linkedBrowser, [], async () => {
    const doc = content.document;
    // start.mjs fills it in; it is a module, so it may run just after the load event.
    await ContentTaskUtils.waitForCondition(
      () => doc.getElementById("vimma-version")?.textContent,
      "start.mjs has filled in the version",
    );
    const footer = doc.querySelector("footer");
    const vimma = doc.getElementById("vimma-version");
    const firefox = doc.getElementById("firefox-version");
    const style = (el) => content.getComputedStyle(el);
    const logo = doc.querySelector("img").getBoundingClientRect();
    const box = footer.getBoundingClientRect();
    return {
      footer: footer.textContent.replace(/\s+/g, " ").trim(),
      vimma: vimma.textContent,
      firefox: firefox.textContent,
      vimmaSize: parseFloat(style(vimma).fontSize),
      firefoxSize: parseFloat(style(firefox).fontSize),
      hintSize: parseFloat(style(doc.querySelector(".hint")).fontSize),
      color: style(doc.querySelector(".version")).color,
      dim: style(doc.querySelector(".hint")).color,
      belowLogo: box.top > logo.bottom,
      inView: box.bottom <= content.innerHeight && box.height > 0,
      scrolls: doc.documentElement.scrollHeight > content.innerHeight,
    };
  });
  const display = AppConstants.MOZ_APP_VERSION_DISPLAY;
  Assert.equal(state.vimma, `Vimma ${display}`, "Vimma's own version, read from the app");
  Assert.equal(
    state.firefox,
    `Firefox ${Services.appinfo.version}`,
    "the Firefox version it is built on",
  );
  Assert.notEqual(display, Services.appinfo.version, "two different versions (m0-app-version)");
  Assert.equal(state.footer, `Vimma ${display} · Firefox ${Services.appinfo.version}`);
  Assert.equal(state.color, state.dim, "in the hint's secondary-text colour");
  Assert.less(state.vimmaSize, state.hintSize, "smaller than the key hint");
  Assert.less(state.firefoxSize, state.vimmaSize, "the Firefox version quieter still");
  Assert.ok(state.belowLogo && state.inView, "at the bottom of the page, in view");
  Assert.ok(!state.scrolls, "the page still has nothing to scroll");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function the_logo_is_transparent_with_a_tile_only_under_a_light_theme() {
  const tab = await openStartTab();
  const state = await SpecialPowers.spawn(tab.linkedBrowser, [], async () => {
    const doc = content.document;
    const img = doc.querySelector("img");
    await img.decode();
    const canvas = doc.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const corner = ctx.getImageData(2, 2, 1, 1).data[3];
    const tile = (scheme) => {
      doc.documentElement.style.setProperty("--vimma-color-scheme", scheme);
      return content.getComputedStyle(img).backgroundColor;
    };
    const dark = tile("dark");
    const light = tile("light");
    doc.documentElement.style.removeProperty("--vimma-color-scheme");
    return { corner, dark, light };
  });
  Assert.equal(state.corner, 0, "the logo's corner is transparent, so no square shows");
  Assert.equal(state.dark, "rgba(0, 0, 0, 0)", "a dark theme shows the page behind the logo");
  Assert.equal(state.light, "rgb(8, 12, 16)", "a light theme gets a dark tile for the wordmark");
  BrowserTestUtils.removeTab(tab);
});
