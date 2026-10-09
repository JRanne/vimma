/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m5-config-load.md

"use strict";

/* global focusContent -- from head.js */

const { ConfigHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/config/ConfigHost.sys.mjs",
);
const { VimmaHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
);
const { PaneViews } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/split/PaneView.mjs",
);
const { leaves } = ChromeUtils.importESModule("chrome://browser/content/vimma/core/panes.mjs");
const { TOKYO_NIGHT } = ChromeUtils.importESModule("chrome://browser/content/vimma/core/theme.mjs");

const PAGE = "https://example.com/";
const START = "chrome://browser/content/vimma/start/start.html";
const NOTICE_ID = "vimma-notice";
/** Tokyo Night's dark_background: the built-in status bar colour. */
const TOKYO_STATUSBAR = "#13141c";

const dir = PathUtils.join(PathUtils.tempDir, `vimma-config-${Date.now()}`);
const file = PathUtils.join(dir, "config.toml");
const themeDir = PathUtils.join(dir, "omarchy");

function until(cond, msg) {
  return TestUtils.waitForCondition(cond, msg, 50, 100);
}

function segText(id) {
  return (
    document.getElementById("vimma-statusbar")?.querySelector(`[data-segment="${id}"]`)
      ?.textContent ?? null
  );
}

function noticeText() {
  const n = document.getElementById(NOTICE_ID);
  return n?.matches(":popover-open") ? n.textContent : null;
}

/** "#rrggbb" → "rgb(r, g, b)", as getComputedStyle reports it. */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}

const barBackground = () =>
  getComputedStyle(document.getElementById("vimma-statusbar")).backgroundColor;

/**
 * Writes config.toml. Each write gets a size of its own (a trailing comment), so the poll sees a
 * change even when two writes land in the same millisecond.
 */
let writes = 0;
async function writeConfig(text) {
  writes++;
  await IOUtils.writeUTF8(file, `${text}\n${"#".repeat(writes)}\n`);
}

/** ctrl+b, then `key`. */
function prefix(key) {
  EventUtils.synthesizeKey("b", { ctrlKey: true });
  EventUtils.synthesizeKey(key);
}

/** The number of tabs after ctrl+b `key` and a moment for a tab to open. */
async function tabsAfterPrefix(key) {
  const before = gBrowser.tabs.length;
  const opened = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen").then(() => true);
  prefix(key);
  // A key that opens nothing has no event to wait for: a second without a TabOpen means none.
  const timeout = new Promise((r) => setTimeout(() => r(false), 1000));
  const did = await Promise.race([opened, timeout]);
  const after = gBrowser.tabs.length;
  while (gBrowser.tabs.length > before) gBrowser.removeTab(gBrowser.tabs.at(-1));
  return { did, delta: after - before };
}

/** An example.com tab, selected and focused, in normal mode. */
async function openPage(name) {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, `${PAGE}?${name}`);
  await focusContent(tab.linkedBrowser);
  await until(() => VimmaHost.status(window).mode === "normal", "the page is in normal mode");
  return tab;
}

/** Back to the defaults: no config file, nothing reported. */
async function resetConfig() {
  await IOUtils.remove(file, { ignoreAbsent: true });
  await ConfigHost.reload();
  Assert.deepEqual(ConfigHost.errors, [], "no config file: no errors");
}

add_task(async function setup() {
  await IOUtils.makeDirectory(themeDir, { createAncestors: true });
  await SpecialPowers.pushPrefEnv({
    set: [
      ["vimma.config.path", file],
      ["vimma.config.pollMs", 100],
    ],
  });
  registerCleanupFunction(async () => {
    while (gBrowser.tabs.length > 1) gBrowser.removeTab(gBrowser.tabs.at(-1));
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    // Back to the 2 s poll and the hermetic path before the harness looks for left-over timers.
    await SpecialPowers.popPrefEnv();
    await ConfigHost.reload();
  });
  await resetConfig();
});

add_task(async function a_remapped_key_applies_after_the_poll() {
  const tab = await openPage("remap");
  Assert.equal((await tabsAfterPrefix("t")).delta, 0, "sanity: prefix+t is unbound by default");

  await writeConfig(`[keys]\nnew_tab = "prefix+t"`);
  await until(() => ConfigHost.config?.keys.new_tab === "prefix+t", "the poll loads the file");
  await focusContent(tab.linkedBrowser);
  Assert.equal((await tabsAfterPrefix("t")).delta, 1, "ctrl+b t opens a tab");
  await focusContent(tab.linkedBrowser);
  Assert.equal((await tabsAfterPrefix("c")).delta, 0, "ctrl+b c no longer does (list replaced)");

  BrowserTestUtils.removeTab(tab);
  await resetConfig();
});

add_task(async function a_broken_line_keeps_the_old_config_and_shows_file_and_line() {
  const tab = await openPage("broken");
  await writeConfig(`[keys]\nnew_tab = "prefix+t"`);
  await until(() => ConfigHost.config?.keys.new_tab === "prefix+t", "the valid file loads");

  await writeConfig(`[keys]\nnew_tab = "prefix+y"\nnew_tabb = "prefix+u"`);
  await until(() => ConfigHost.errors.length > 0, "the broken file is rejected");
  await until(
    () => segText("error")?.startsWith("config.toml:3:"),
    "the status bar shows config.toml:3:",
  );
  Assert.ok(segText("error").includes('did you mean "new_tab"'), "with the suggestion");
  Assert.equal(ConfigHost.config.keys.new_tab, "prefix+t", "the old config stays active");
  await focusContent(tab.linkedBrowser);
  Assert.equal((await tabsAfterPrefix("t")).delta, 1, "the old mapping still opens a tab");
  await focusContent(tab.linkedBrowser);
  Assert.equal((await tabsAfterPrefix("y")).delta, 0, "the broken file's mapping does not");

  await writeConfig(`[keys]\nnew_tab = "prefix+y"`);
  await until(() => segText("error") === null, "fixing the file clears the error");
  Assert.equal(ConfigHost.config.keys.new_tab, "prefix+y", "and the fixed file is active");

  BrowserTestUtils.removeTab(tab);
  await resetConfig();
});

add_task(async function colon_source_reloads_at_once() {
  await SpecialPowers.pushPrefEnv({ set: [["vimma.config.pollMs", 600000]] });
  const tab = await openPage("source");
  await writeConfig(`[keys]\nnew_tab = "prefix+t"`);
  Assert.equal(ConfigHost.config?.keys.new_tab, undefined, "not loaded before :source");
  EventUtils.synthesizeKey(":", { shiftKey: true });
  EventUtils.sendString("source");
  EventUtils.synthesizeKey("KEY_Enter");
  await until(() => ConfigHost.config?.keys.new_tab === "prefix+t", ":source loads the file");
  BrowserTestUtils.removeTab(tab);
  await SpecialPowers.popPrefEnv();
  await resetConfig();
});

add_task(async function panes_max_refuses_a_third_split() {
  const tab = await openPage("panes");
  await writeConfig(`schema = 2\n[panes]\nmax = 2`);
  await until(() => PaneViews.get(window).max === 2, "[panes] max reaches the pane view");

  prefix("v");
  await until(
    () =>
      gBrowser.selectedTab !== tab &&
      gBrowser.selectedTab.linkedBrowser.currentURI.spec === START &&
      gBrowser.selectedTab.linkedBrowser.contentDocument?.readyState === "complete",
    "the second pane's start page has loaded",
  );
  const view = PaneViews.get(window);
  Assert.equal(leaves(view.panes).length, 2, "two panes");
  const tabs = gBrowser.tabs.length;
  prefix("v");
  await until(() => noticeText()?.includes("at most 2 panes"), "the third split is refused");
  Assert.equal(leaves(view.panes).length, 2, "still two panes");
  Assert.equal(gBrowser.tabs.length, tabs, "and no tab was opened");

  while (view.panes) view.close();
  while (gBrowser.tabs.length > 1) gBrowser.removeTab(gBrowser.tabs.at(-1));
  document.getElementById(NOTICE_ID)?.hidePopover?.();
  await resetConfig();
  Assert.equal(PaneViews.get(window).max, 4, "the default comes back without the file");
});

add_task(async function theme_source_and_colors_feed_the_theme() {
  // An Omarchy theme with its own status bar colour, followed as by default.
  const palette = { ...TOKYO_NIGHT, dark_background: "#405060" };
  const omarchy = Object.entries(palette)
    .map(([k, v]) => `${k} = "${v}"`)
    .join("\n");
  await IOUtils.writeUTF8(PathUtils.join(themeDir, "colors.toml"), omarchy);
  await SpecialPowers.pushPrefEnv({
    set: [
      ["vimma.theme.source", "omarchy"],
      ["vimma.theme.omarchyPath", themeDir],
      ["vimma.theme.pollMs", 100],
    ],
  });
  await until(() => barBackground() === rgb("#405060"), "the Omarchy theme is followed");

  await writeConfig(`[theme]\nsource = "file"`);
  await until(() => barBackground() === rgb(TOKYO_STATUSBAR), '"file": Tokyo Night');

  await writeConfig(`[theme]\nsource = "file"\n[theme.colors]\ndark_background = "#203040"`);
  await until(() => barBackground() === rgb("#203040"), "[theme.colors] overrides it");

  await resetConfig();
  await until(() => barBackground() === rgb("#405060"), "no config: Omarchy again");
  await SpecialPowers.popPrefEnv();
});

add_task(async function workspaces_from_the_file_apply_live() {
  const { WorkspaceStore } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/workspaces/WorkspaceStore.sys.mjs",
  );
  const { WindowWorkspaces } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/workspaces/WindowWorkspaces.sys.mjs",
  );
  const def = () => WorkspaceStore.definitions.workspaces.find((w) => w.name === "cfgws");
  await writeConfig(`[workspaces.cfgws]\ncolor = "green"\nicon = "tree"`);
  await until(() => def()?.source === "config", "[workspaces] reaches the store");
  Assert.equal(def().color, "green", "with its colour");
  Assert.ok(def().userContextId > 0, "and a container of its own");
  await until(
    () => WindowWorkspaces.get(window).model.workspaces.some((w) => w.id === def().id),
    "the window has the new workspace",
  );

  await resetConfig();
  await until(() => def()?.source === "runtime", "out of the file it becomes runtime");
  await WorkspaceStore.deleteWorkspace(def().id, { confirmed: true });
});
