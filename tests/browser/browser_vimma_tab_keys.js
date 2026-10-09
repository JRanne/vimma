/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m2-tab-keys.md

"use strict";

const NOTICE_ID = "vimma-notice";
const PAGE = "https://example.com/";

/** Every tab this file opened is closed again, even when a task fails half-way. */
registerCleanupFunction(() => {
  while (gBrowser.tabs.length > 1) gBrowser.removeTab(gBrowser.tabs.at(-1));
});

// Keys sent to a page race two asynchronous things (issues #14, #18): a content listener
// installed later than the key, and content focus arriving later than browser.focus(). So: install
// the recorder and await it, await content focus, press, then poll the page for a sentinel key.

/** Focuses `browser` and resolves once its content process has focus too. */
async function focusPage(browser) {
  await SimpleTest.promiseFocus(browser);
  Assert.equal(document.activeElement, browser, "focus is in the content browser");
  Assert.ok(
    await SpecialPowers.spawn(browser, [], () => content.document.hasFocus()),
    "the page has focus",
  );
}

/** Selects `tab`; BrowserTestUtils.switchTab never resolves for the tab already selected. */
async function select(tab) {
  if (gBrowser.selectedTab !== tab) await BrowserTestUtils.switchTab(gBrowser, tab);
}

/**
 * The next TabOpen. Not BrowserTestUtils.waitForNewTab: it waits for a location other than
 * about:blank, which is what the new-tab page is under the test harness's prefs.
 */
function tabOpened() {
  const opened = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen");
  // Bounded, so a key that opens nothing fails an assertion instead of timing out the file.
  return Promise.race([
    opened.then((e) => e.target),
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
}

/** Records every keydown the page sees; resolves once the listener is in place. */
async function recordKeys(browser) {
  await SpecialPowers.spawn(browser, [], () => {
    content.wrappedJSObject.vimmaKeys = [];
    content.addEventListener(
      "keydown",
      (e) => content.wrappedJSObject.vimmaKeys.push(e.defaultPrevented ? `!${e.key}` : e.key),
      true,
    );
  });
}

/**
 * Selects `tab`, presses j (never ours outside help) in its page and returns every key the page
 * saw, ending with "j". Content events arrive in order, so a leaked chord key would be listed
 * before the j. Gives up after 5 s so a swallowed j fails an assertion instead of the file.
 */
async function pageKeysThenJ(tab) {
  await select(tab);
  const browser = tab.linkedBrowser;
  await focusPage(browser);
  EventUtils.synthesizeKey("j");
  return SpecialPowers.spawn(browser, [], async () => {
    const seen = () => [...content.wrappedJSObject.vimmaKeys];
    try {
      await ContentTaskUtils.waitForCondition(() => seen().includes("j"), "page saw j", 50, 100);
    } catch {
      // Fall through: the assertion names what the page saw.
    }
    return seen();
  });
}

/** Opens `n` example.com tabs, each recording its keys, and selects the first of them. */
async function openTabs(n) {
  const tabs = [];
  for (let i = 0; i < n; i++) {
    const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, `${PAGE}?tab=${i}`);
    await recordKeys(tab.linkedBrowser);
    tabs.push(tab);
  }
  await select(tabs[0]);
  await focusPage(tabs[0].linkedBrowser);
  return tabs;
}

function closeTabs(tabs) {
  for (const tab of tabs) if (!tab.closing && tab.isConnected) BrowserTestUtils.removeTab(tab);
}

/** ctrl+b, then `key` with `mods`. */
function prefix(key, mods = {}) {
  EventUtils.synthesizeKey("b", { ctrlKey: true });
  EventUtils.synthesizeKey(key, mods);
}

function visibleIndex(tab = gBrowser.selectedTab) {
  return gBrowser.visibleTabs.indexOf(tab);
}

function notice() {
  return document.getElementById(NOTICE_ID);
}

function noticeShown() {
  const n = notice();
  return !!n && n.matches(":popover-open") && BrowserTestUtils.isVisible(n);
}

add_task(async function prefix_c_opens_a_new_tab() {
  const tabs = await openTabs(1);
  const count = gBrowser.tabs.length;
  const opened = tabOpened();
  prefix("c");
  const tab = await opened;
  Assert.ok(tab, "a tab opened");
  Assert.equal(gBrowser.tabs.length, count + 1, "ctrl+b c adds a tab");
  Assert.equal(gBrowser.selectedTab, tab, "and selects it");
  Assert.deepEqual(await pageKeysThenJ(tabs[0]), ["j"], "the page saw neither ctrl+b nor c");
  closeTabs([...tabs, tab]);
});

add_task(async function prefix_n_and_p_cycle_through_visible_tabs_and_wrap() {
  const tabs = await openTabs(3);
  const n = gBrowser.visibleTabs.length;
  const start = visibleIndex();

  prefix("n");
  Assert.equal(visibleIndex(), (start + 1) % n, "ctrl+b n selects the next tab");
  prefix("p");
  Assert.equal(visibleIndex(), start, "ctrl+b p selects the previous tab");

  await select(gBrowser.visibleTabs.at(-1));
  prefix("n");
  Assert.equal(visibleIndex(), 0, "ctrl+b n on the last tab wraps to the first");
  prefix("p");
  Assert.equal(visibleIndex(), n - 1, "ctrl+b p on the first tab wraps to the last");

  for (const tab of tabs) {
    Assert.deepEqual(await pageKeysThenJ(tab), ["j"], "no page saw a chord key");
  }
  closeTabs(tabs);
});

add_task(async function prefix_n_skips_hidden_tabs() {
  const tabs = await openTabs(3);
  gBrowser.hideTab(tabs[1]);
  Assert.ok(tabs[1].hidden, "sanity: the middle tab is hidden");
  prefix("n");
  Assert.equal(gBrowser.selectedTab, tabs[2], "ctrl+b n skips the hidden tab");
  prefix("p");
  Assert.equal(gBrowser.selectedTab, tabs[0], "ctrl+b p skips it too");
  gBrowser.showTab(tabs[1]);
  closeTabs(tabs);
});

add_task(async function prefix_digit_selects_tab_n() {
  const tabs = await openTabs(3);
  prefix("3");
  Assert.equal(gBrowser.selectedTab, gBrowser.visibleTabs[2], "ctrl+b 3 selects tab 3");
  prefix("1");
  Assert.equal(gBrowser.selectedTab, gBrowser.visibleTabs[0], "ctrl+b 1 selects tab 1");
  prefix("2");
  Assert.equal(gBrowser.selectedTab, gBrowser.visibleTabs[1], "ctrl+b 2 selects tab 2");
  Assert.ok(!noticeShown(), "no notice for a runnable action");
  for (const tab of tabs) {
    Assert.deepEqual(await pageKeysThenJ(tab), ["j"], "no page saw a chord key");
  }
  closeTabs(tabs);
});

add_task(async function prefix_digit_past_the_last_tab_does_nothing() {
  const tabs = await openTabs(1);
  Assert.less(gBrowser.visibleTabs.length, 9, "sanity: fewer than 9 tabs");
  const selected = gBrowser.selectedTab;
  prefix("9");
  Assert.equal(gBrowser.selectedTab, selected, "ctrl+b 9 with fewer tabs keeps the selection");
  Assert.ok(!noticeShown(), "and shows no notice (Herdr: a silent no-op)");
  Assert.deepEqual(await pageKeysThenJ(tabs[0]), ["j"], "the page saw neither key");
  closeTabs(tabs);
});

add_task(async function prefix_shift_x_closes_the_selected_tab() {
  const tabs = await openTabs(2);
  const count = gBrowser.tabs.length;
  const closed = BrowserTestUtils.waitForTabClosing(tabs[0]);
  prefix("X", { shiftKey: true });
  await closed;
  Assert.ok(tabs[0].closing, "ctrl+b shift+x closes the selected tab");
  await TestUtils.waitForCondition(() => !tabs[0].isConnected, "the closed tab is removed");
  Assert.equal(gBrowser.tabs.length, count - 1, "and only that one");
  Assert.deepEqual(await pageKeysThenJ(tabs[1]), ["j"], "the next page saw no stray X");
  closeTabs(tabs);
});

add_task(async function tab_keys_work_from_the_url_bar() {
  const tabs = await openTabs(2);
  gURLBar.focus();
  gURLBar.value = "typed";
  prefix("9");
  Assert.equal(gURLBar.value, "typed", "ctrl+b 9 types nothing into the URL bar");
  Assert.equal(gBrowser.selectedTab, tabs[0], "and changes nothing");
  prefix("n");
  Assert.equal(gBrowser.selectedTab, tabs[1], "ctrl+b n from the URL bar selects the next tab");
  closeTabs(tabs);
});

add_task(async function tab_keys_work_from_about_preferences() {
  const tabs = await openTabs(1);
  const prefs = await BrowserTestUtils.openNewForegroundTab(gBrowser, "about:preferences");
  await SimpleTest.promiseFocus(prefs.linkedBrowser.contentWindow);
  prefix("p");
  Assert.equal(gBrowser.selectedTab, tabs[0], "ctrl+b p from about:preferences");
  await select(prefs);
  await SimpleTest.promiseFocus(prefs.linkedBrowser.contentWindow);
  const opened = tabOpened();
  prefix("c");
  const tab = await opened;
  Assert.ok(tab, "a tab opened");
  Assert.equal(gBrowser.selectedTab, tab, "ctrl+b c from about:preferences");
  await select(prefs);
  await SimpleTest.promiseFocus(prefs.linkedBrowser.contentWindow);
  const closed = BrowserTestUtils.waitForTabClosing(prefs);
  prefix("X", { shiftKey: true });
  await closed;
  Assert.ok(!prefs.isConnected || prefs.closing, "ctrl+b shift+x closes about:preferences");
  closeTabs([...tabs, tab]);
});

add_task(async function unimplemented_prefix_action_shows_a_notice_that_hides() {
  const tabs = await openTabs(1);
  const count = gBrowser.tabs.length;
  prefix("v"); // split_vertical: M4
  Assert.ok(noticeShown(), "ctrl+b v shows a notice");
  Assert.equal(notice().textContent, "Split right: not implemented yet", "naming the action");
  Assert.equal(notice().getAttribute("role"), "status", "announced politely");
  Assert.equal(document.activeElement, tabs[0].linkedBrowser, "the notice takes no focus");
  Assert.equal(gBrowser.tabs.length, count, "and nothing else happens");
  const shownAt = Date.now();
  await TestUtils.waitForCondition(() => !noticeShown(), "the notice hides by itself", 100, 50);
  const shownFor = Date.now() - shownAt;
  Assert.greater(shownFor, 1000, `it stays up long enough to read (${shownFor} ms)`);
  Assert.deepEqual(await pageKeysThenJ(tabs[0]), ["j"], "the page saw neither ctrl+b nor v");
  closeTabs(tabs);
});

add_task(async function passed_through_single_key_shows_no_notice() {
  const tabs = await openTabs(1);
  EventUtils.synthesizeKey("KEY_Escape"); // mode.normal: M1, left to Firefox meanwhile
  Assert.deepEqual(
    await pageKeysThenJ(tabs[0]),
    ["Escape", "j"],
    "Esc reaches the page, not default-prevented",
  );
  Assert.ok(!noticeShown(), "and shows no notice");
  closeTabs(tabs);
});
