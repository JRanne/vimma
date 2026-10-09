/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Page navigation keys in normal mode: H back, L forward (with counts), r reload (plan §2, M1).

"use strict";

/* global focusContent -- from head.js */

const url = (/** @type {string} */ name) => `https://example.com/?page=${name}`;

registerCleanupFunction(() => {
  while (gBrowser.tabs.length > 1) gBrowser.removeTab(gBrowser.tabs.at(-1));
});

/**
 * Records the page's keydowns into sessionStorage, which outlives the document across these
 * same-origin navigations, so a key that leaked to a page that is gone is still seen. Installed
 * once per document (a page back from the bfcache keeps its listener).
 * @param {XULBrowserElement} browser
 */
async function recordKeys(browser) {
  await SpecialPowers.spawn(browser, [], async () => {
    await ContentTaskUtils.waitForCondition(() => content.document.readyState === "complete");
    if (content.wrappedJSObject.vimmaRecording) return;
    content.wrappedJSObject.vimmaRecording = true;
    content.addEventListener(
      "keydown",
      (e) => {
        const keys = JSON.parse(content.sessionStorage.getItem("vimmaKeys") ?? "[]");
        keys.push(e.defaultPrevented ? `!${e.key}` : e.key);
        content.sessionStorage.setItem("vimmaKeys", JSON.stringify(keys));
      },
      true,
    );
  });
}

/** @param {XULBrowserElement} browser */
function recordedKeys(browser) {
  return SpecialPowers.spawn(browser, [], () =>
    JSON.parse(content.sessionStorage.getItem("vimmaKeys") ?? "[]"),
  );
}

/** Loads `name` in the selected tab as a new history entry. */
async function load(name) {
  const browser = gBrowser.selectedBrowser;
  const loaded = BrowserTestUtils.browserLoaded(browser, false, url(name));
  BrowserTestUtils.startLoadingURIString(browser, url(name));
  await loaded;
  await recordKeys(browser);
}

/**
 * Presses `keys` in the page and resolves with the location it lands on, or null if it does not
 * change within 5 s (a key that does nothing fails an assertion instead of timing out the file).
 * @param {string[]} keys
 */
async function navigateWith(keys) {
  const browser = gBrowser.selectedBrowser;
  await focusContent(browser);
  const before = browser.currentURI.spec;
  for (const key of keys) EventUtils.synthesizeKey(key);
  try {
    await TestUtils.waitForCondition(() => browser.currentURI.spec !== before, "location changed");
  } catch {
    return null;
  }
  await recordKeys(browser);
  return browser.currentURI.spec;
}

add_task(async function h_and_l_walk_history_with_counts() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url("a"));
  await recordKeys(tab.linkedBrowser);
  await load("b");
  await load("c");

  Assert.equal(await navigateWith(["H"]), url("b"), "H goes back one page");
  Assert.equal(await navigateWith(["2", "H"]), url("a"), "2H goes back two (clamped to the first)");
  Assert.equal(await navigateWith(["L"]), url("b"), "L goes forward one page");
  Assert.equal(await navigateWith(["5", "L"]), url("c"), "5L stops at the last page");
  Assert.equal(await navigateWith(["2", "H"]), url("a"), "2H from the last page skips one");

  Assert.deepEqual(await recordedKeys(tab.linkedBrowser), [], "no page saw H, L or a count");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function r_reloads_the_page() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url("r"));
  const browser = tab.linkedBrowser;
  await recordKeys(browser);
  await SpecialPowers.spawn(browser, [], () => {
    content.wrappedJSObject.vimmaMarker = true;
  });
  await focusContent(browser);
  // Bounded, so a key that reloads nothing fails an assertion instead of timing out the file.
  const reloaded = Promise.race([
    BrowserTestUtils.browserLoaded(browser, false, url("r")).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  EventUtils.synthesizeKey("r");
  Assert.ok(await reloaded, "r loaded the page again");
  await recordKeys(browser);
  Assert.ok(
    !(await SpecialPowers.spawn(browser, [], () => content.wrappedJSObject.vimmaMarker)),
    "r loaded a fresh document",
  );
  Assert.deepEqual(await recordedKeys(browser), [], "the page did not see r");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function sanity_an_unbound_key_reaches_the_recorder() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url("z"));
  await recordKeys(tab.linkedBrowser);
  await focusContent(tab.linkedBrowser);
  EventUtils.synthesizeKey("z");
  await TestUtils.waitForCondition(async () => (await recordedKeys(tab.linkedBrowser)).length);
  Assert.deepEqual(await recordedKeys(tab.linkedBrowser), ["z"], "the recorder sees page keys");
  BrowserTestUtils.removeTab(tab);
});
