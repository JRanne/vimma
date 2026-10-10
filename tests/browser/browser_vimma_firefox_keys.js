/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/key-handling-batch.md § 1. Firefox's own shortcuts on Vimma's keys are off:
// ctrl+w, ctrl+u, ctrl+h, ctrl+d, ctrl+o, ctrl+i, ctrl+k, ctrl+b never run Firefox's action,
// in any mode. ctrl+t, ctrl+l and ctrl+tab stay Firefox's. [firefox] disable / enable in
// config.toml change the set; about:vimma lists it.

"use strict";

/* global focusContent, recordPageKeys, waitForPageKey -- from head.js */

const { VimmaHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
);
const { ConfigHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/config/ConfigHost.sys.mjs",
);
const { AboutVimma } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/about/AboutVimma.sys.mjs",
);

const ROOT = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com",
);
const PLAIN = ROOT + "file_vimma_plain.html";

/** The overlapping Firefox shortcuts on Linux (Firefox 157), by chord: `<key>` id. */
const OVERLAP = {
  w: "key_close",
  u: "key_viewSource",
  h: "key_gotoHistory",
  d: "addBookmarkAsKb",
  o: "openFileKb",
  i: "key_viewInfo",
  k: "key_search",
  b: "viewBookmarksSidebarKb",
};

const dir = PathUtils.join(PathUtils.tempDir, `vimma-firefox-keys-${Date.now()}`);
const file = PathUtils.join(dir, "config.toml");
let writes = 0;
/** Writes config.toml and reads it at once (`:source`). */
async function useConfig(text) {
  writes++;
  await IOUtils.writeUTF8(file, `schema = 2\n${text}\n${"#".repeat(writes)}\n`);
  await ConfigHost.reload();
  Assert.deepEqual(ConfigHost.errors, [], "config.toml applies");
}

/**
 * Counts the commands a `<key>` runs: a `command` event on the key, or on its <command>.
 * @param {string} id
 */
function spyKey(id) {
  const key = document.getElementById(id);
  Assert.ok(key, `#${id} exists`);
  const targets = [key, document.getElementById(key.getAttribute("command") ?? "")].filter(Boolean);
  const spy = { count: 0 };
  const listener = () => spy.count++;
  for (const t of targets) t.addEventListener("command", listener, true);
  registerCleanupFunction(() => {
    for (const t of targets) t.removeEventListener("command", listener, true);
  });
  return spy;
}

/** A plain page, focused, with its keys recorded, in insert mode (`i`: no text field). */
async function insertModePage() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PLAIN);
  const browser = tab.linkedBrowser;
  await recordPageKeys(browser);
  await focusContent(browser);
  await TestUtils.waitForCondition(() => VimmaHost._browserMode(browser) === "normal", "normal");
  EventUtils.synthesizeKey("i");
  await TestUtils.waitForCondition(() => VimmaHost._browserMode(browser) === "insert", "insert");
  return tab;
}

add_task(async function setup() {
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  await SpecialPowers.pushPrefEnv({ set: [["vimma.config.path", file]] });
  registerCleanupFunction(async () => {
    while (gBrowser.tabs.length > 1) gBrowser.removeTab(gBrowser.tabs.at(-1));
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    await SpecialPowers.popPrefEnv();
    await ConfigHost.reload();
  });
  await ConfigHost.reload();
});

add_task(async function the_overlapping_keys_are_disabled_and_ctrl_q_is_not() {
  for (const id of Object.values(OVERLAP)) {
    Assert.equal(document.getElementById(id).getAttribute("disabled"), "true", `#${id} is off`);
  }
  for (const id of ["key_newNavigatorTab", "focusURLBar", "key_quitApplication", "key_find"]) {
    Assert.ok(!document.getElementById(id).hasAttribute("disabled"), `#${id} stays on`);
  }
});

add_task(async function no_overlapping_shortcut_fires_and_the_page_gets_the_key() {
  const tab = await insertModePage();
  const browser = tab.linkedBrowser;
  const tabs = gBrowser.tabs.length;
  for (const [letter, id] of Object.entries(OVERLAP)) {
    const spy = spyKey(id);
    EventUtils.synthesizeKey(letter, { ctrlKey: true });
    if (letter === "b") {
      // Vimma's prefix in every mode: it waits for the next key, which Esc cancels.
      EventUtils.synthesizeKey("KEY_Escape");
      EventUtils.synthesizeKey("z");
      Assert.ok(await waitForPageKey(browser, ["z"]), "the key after ctrl+b Esc reached the page");
    } else {
      Assert.ok(
        await waitForPageKey(browser, [letter, `!${letter}`]),
        `the page got ctrl+${letter}`,
      );
    }
    Assert.equal(spy.count, 0, `ctrl+${letter} did not run #${id}`);
  }
  Assert.equal(gBrowser.tabs.length, tabs, "no tab opened or closed (ctrl+w, ctrl+u)");
  Assert.equal(gBrowser.selectedTab, tab, "the page's tab is still selected");
  Assert.ok(!SidebarController.isOpen, "no sidebar opened (ctrl+h, ctrl+b)");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function ctrl_w_in_normal_mode_with_one_pane_closes_nothing() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PLAIN);
  const browser = tab.linkedBrowser;
  await recordPageKeys(browser);
  await focusContent(browser);
  await TestUtils.waitForCondition(() => VimmaHost._browserMode(browser) === "normal", "normal");
  EventUtils.synthesizeKey("w", { ctrlKey: true });
  // <C-w> pane keys need two panes: with one, ctrl+w is the page's, never Firefox's close.
  Assert.ok(await waitForPageKey(browser, ["w", "!w"]), "the page got ctrl+w");
  Assert.ok(tab.isConnected, "the tab is still open");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function ctrl_t_ctrl_l_and_ctrl_tab_stay_firefoxs() {
  const first = gBrowser.selectedTab;
  const tab = await insertModePage();
  const opened = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen");
  EventUtils.synthesizeKey("t", { ctrlKey: true });
  const { target: fresh } = await opened;
  Assert.ok(fresh, "ctrl+t opened a tab");
  BrowserTestUtils.removeTab(fresh);
  await TestUtils.waitForCondition(() => gBrowser.selectedTab === tab, "back on the page");
  await focusContent(tab.linkedBrowser);

  EventUtils.synthesizeKey("l", { ctrlKey: true });
  await TestUtils.waitForCondition(() => gURLBar.focused, "ctrl+l focuses the URL bar");

  gBrowser.selectedBrowser.focus();
  const selected = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabSelect");
  EventUtils.synthesizeKey("KEY_Tab", { ctrlKey: true });
  await selected;
  Assert.notEqual(gBrowser.selectedTab, tab, "ctrl+tab switched tabs");
  gBrowser.selectedTab = first;
  BrowserTestUtils.removeTab(tab);
});

add_task(async function about_vimma_lists_what_is_off() {
  const data = await AboutVimma.collect(window);
  const off = Object.fromEntries(data.firefoxKeys.off.map((k) => [k.chord, k.id]));
  for (const [letter, id] of Object.entries(OVERLAP)) {
    Assert.equal(off[`ctrl+${letter}`], id, `about:vimma lists ctrl+${letter} (#${id})`);
  }
  Assert.deepEqual(data.firefoxKeys.unmatched, ["ctrl+e", "ctrl+y"], "no Firefox key on these");
  Assert.stringContains(AboutVimma.report(data), "Firefox shortcuts off: ", "the report says so");
});

add_task(async function disable_all_keeps_only_ctrl_q_and_what_enable_lists() {
  await useConfig(`[firefox]\ndisable = "all"\nenable = ["ctrl+t"]`);
  Assert.equal(document.getElementById("focusURLBar").getAttribute("disabled"), "true");
  Assert.equal(document.getElementById("key_find").getAttribute("disabled"), "true");
  Assert.ok(!document.getElementById("key_quitApplication").hasAttribute("disabled"), "ctrl+q");
  Assert.ok(!document.getElementById("key_newNavigatorTab").hasAttribute("disabled"), "enabled");

  const tab = await insertModePage();
  const spy = spyKey("focusURLBar");
  EventUtils.synthesizeKey("l", { ctrlKey: true });
  Assert.ok(await waitForPageKey(tab.linkedBrowser, ["l", "!l"]), "the page got ctrl+l");
  Assert.equal(spy.count, 0, "ctrl+l no longer focuses the URL bar");
  Assert.ok(!gURLBar.focused, "the URL bar has no focus");
  const opened = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen");
  EventUtils.synthesizeKey("t", { ctrlKey: true });
  const { target: fresh } = await opened;
  BrowserTestUtils.removeTab(fresh);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function enable_gives_one_back_and_a_list_replaces_the_default() {
  await useConfig(`[firefox]\ndisable = ["ctrl+u"]\nenable = []`);
  Assert.ok(!document.getElementById("focusURLBar").hasAttribute("disabled"), "all is undone");
  Assert.ok(!document.getElementById("key_close").hasAttribute("disabled"), "ctrl+w is back");
  Assert.equal(document.getElementById("key_viewSource").getAttribute("disabled"), "true");

  await useConfig(`[firefox]\nenable = ["ctrl+w"]`);
  Assert.ok(!document.getElementById("key_close").hasAttribute("disabled"), "ctrl+w enabled");
  Assert.equal(document.getElementById("key_gotoHistory").getAttribute("disabled"), "true");
  const tab = await insertModePage();
  const closing = BrowserTestUtils.waitForTabClosing(tab);
  EventUtils.synthesizeKey("w", { ctrlKey: true });
  await closing;
  await TestUtils.waitForCondition(() => !tab.isConnected, "an enabled ctrl+w closes the tab");

  await IOUtils.remove(file);
  await ConfigHost.reload();
  Assert.equal(document.getElementById("key_close").getAttribute("disabled"), "true", "default");
});

add_task(async function a_key_firefox_re_enables_is_turned_off_again() {
  const key = document.getElementById("key_viewSource");
  key.removeAttribute("disabled");
  await TestUtils.waitForCondition(
    () => key.getAttribute("disabled") === "true",
    "the observer disables it again",
  );
});
