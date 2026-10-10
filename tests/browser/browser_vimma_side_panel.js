/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m3-workspaces.md, sub-spec 6 (m3-side-panel): `<leader>n` / `prefix+b` /
// `:sidebar` open a panel on the left headed by the current workspace and its ctrl+u / ctrl+i
// neighbours, listing its tabs as numbered rows. In `panel` mode j/k move, Enter or a digit
// selects a tab and closes, Esc / `<leader>n` / `prefix+b` close; ctrl+i re-renders it.

"use strict";

/* global focusContent, recordPageKeys, pageKeys -- from head.js */

const { WorkspaceStore } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WorkspaceStore.sys.mjs",
);
const { WindowWorkspaces } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WindowWorkspaces.sys.mjs",
);
const { VimmaHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
);

const PAGE = "https://example.com/";
const PANEL_ID = "vimma-panel";
const NOTICE_ID = "vimma-notice";

const def = (/** @type {string} */ name) =>
  WorkspaceStore.definitions.workspaces.find((w) => w.name === name);
const ww = () => WindowWorkspaces.get(window);
const active = () => ww().model.active;
const tabsIn = (/** @type {string} */ name) =>
  ww().model.workspaces.find((w) => w.id === def(name).id).tabs;

const panel = () => document.getElementById(PANEL_ID);
const isOpen = () => !!panel() && !panel().hidden && BrowserTestUtils.isVisible(panel());
const rows = () => [...(panel()?.querySelectorAll("[role=option]") ?? [])];
const text = (el, name) => el.querySelector(`.vimma-panel-${name}`)?.textContent ?? "";
const titles = () => rows().map((r) => text(r, "title"));
const selected = () => panel().querySelector("[role=option][aria-selected=true]");
const header = () => panel().querySelector(".vimma-panel-header");
const noticeText = () => document.getElementById(NOTICE_ID)?.textContent ?? "";

registerCleanupFunction(async () => {
  if (isOpen()) EventUtils.synthesizeKey("KEY_Escape");
  ww().switchTo({ id: def("main").id });
  for (const w of WorkspaceStore.definitions.workspaces.filter((d) => d.name !== "main")) {
    await WorkspaceStore.deleteWorkspace(w.id, { confirmed: true });
  }
  while (gBrowser.tabs.length > 1) BrowserTestUtils.removeTab(gBrowser.tabs.at(-1));
});

/** @param {() => boolean} cond @param {string} msg */
function until(cond, msg) {
  return TestUtils.waitForCondition(cond, msg, 50, 100);
}

/** ctrl+b, then `key`. */
function prefix(key, mods = {}) {
  EventUtils.synthesizeKey("b", { ctrlKey: true });
  EventUtils.synthesizeKey(key, mods);
}

/** `<leader>n`: space, n. */
function leaderN() {
  EventUtils.synthesizeKey(" ");
  EventUtils.synthesizeKey("n");
}

/** Focuses the selected page, once it has loaded, so keys reach it in normal mode. */
async function focusPage() {
  const browser = gBrowser.selectedBrowser;
  await until(() => !browser.webProgress?.isLoadingDocument, "the selected page has loaded");
  await focusContent(browser);
}

/** `<leader>n` from the selected page, waiting for the panel. */
async function openPanel() {
  await focusPage();
  leaderN();
  await until(isOpen, "<leader>n opens the side panel");
}

/** Opens `${PAGE}?<query>` in the shown workspace, selected, titled `query`. */
async function openPage(query) {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, `${PAGE}?${query}`);
  await SpecialPowers.spawn(tab.linkedBrowser, [query], (t) => {
    content.document.title = t;
  });
  await until(() => tab.linkedBrowser.contentTitle === query, "the page has its title");
  return tab;
}

/** Every visible child of #browser, left to right. */
function browserBoxOrder() {
  return [...document.getElementById("browser").children]
    .filter((el) => BrowserTestUtils.isVisible(el) && el.getBoundingClientRect().width > 0)
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
}

add_task(async function setup_two_workspaces() {
  await ww().ready;
  if (!def("alpha")) WorkspaceStore.newWorkspace("alpha");
  await until(() => ww().model.workspaces.length === 2, "main and alpha");
  ww().switchTo({ id: def("alpha").id });
  await openPage("alpha-one");
  ww().switchTo({ id: def("main").id });
  await until(() => active() === def("main").id, "back in main");
  await openPage("main-two");
  await openPage("main-three");
});

add_task(async function hidden_by_default_and_leader_n_opens_it_on_the_left() {
  Assert.ok(!isOpen(), "the panel is closed at start");
  await openPanel();
  Assert.equal(browserBoxOrder()[0], panel(), "it is the leftmost box of the window");
  Assert.ok(
    panel().getBoundingClientRect().right <=
      document.getElementById("tabbrowser-tabbox").getBoundingClientRect().left,
    "the pages sit to its right",
  );
  Assert.stringContains(text(header(), "name"), "1:main", "headed by the current workspace");
  Assert.stringContains(text(header(), "neighbours"), "alpha", "and its ctrl+i neighbour");
  const n = tabsIn("main").length;
  Assert.deepEqual(
    titles().slice(-2),
    ["main-two", "main-three"],
    "the workspace's tabs, in order",
  );
  Assert.equal(rows().length, n, "only main's tabs, not alpha's");
  Assert.ok(!titles().includes("alpha-one"), "alpha's tab is not listed");
  Assert.deepEqual(
    rows().map((r) => text(r, "number")),
    Array.from({ length: n }, (_, i) => String(i + 1)),
    "numbered rows",
  );
  Assert.equal(text(rows().at(-1), "host"), "example.com", "with the host");
  Assert.equal(text(selected(), "title"), "main-three", "the highlight starts on the active tab");
  Assert.ok(selected().classList.contains("vimma-panel-active"), "which is marked active");
  Assert.ok(panel().contains(document.activeElement), "focus is in the panel");
  Assert.equal(VimmaHost.status(window).mode, "panel", "the window is in panel mode");

  // Theme tokens, as the pickers: the panel takes --vimma-bg-dark.
  const bg = getComputedStyle(panel()).backgroundColor;
  document.documentElement.style.setProperty("--vimma-bg-dark", "rgb(1, 2, 3)");
  await until(() => getComputedStyle(panel()).backgroundColor === "rgb(1, 2, 3)", "themed");
  document.documentElement.style.removeProperty("--vimma-bg-dark");
  await until(() => getComputedStyle(panel()).backgroundColor === bg, "and back");

  leaderN();
  await until(() => !isOpen(), "<leader>n closes it again");
  Assert.equal(document.activeElement, gBrowser.selectedBrowser, "focus returns to the page");
});

add_task(async function j_k_and_enter_select_a_tab_and_close() {
  const main = [...ww().model.workspaces[0].tabs];
  await openPanel();
  const n = rows().length;
  EventUtils.synthesizeKey("j");
  Assert.equal(selected(), rows()[n - 1], "j stops at the last row");
  for (let i = 0; i <= n; i++) EventUtils.synthesizeKey("k");
  Assert.equal(selected(), rows()[0], "k moves up and stops at the first row");
  for (let i = 0; i < n - 2; i++) EventUtils.synthesizeKey("j");
  Assert.equal(text(selected(), "title"), "main-two", "j moves down");
  EventUtils.synthesizeKey("KEY_Enter");
  await until(() => !isOpen(), "Enter closes the panel");
  Assert.equal(gBrowser.selectedTab.label, "main-two", "and selects the highlighted tab");
  Assert.equal(document.activeElement, gBrowser.selectedBrowser, "focus is on its page");
  Assert.deepEqual(ww().model.workspaces[0].tabs, main, "no tab moved or closed");
});

add_task(async function a_digit_selects_that_row_and_a_missing_one_says_so() {
  await openPanel();
  EventUtils.synthesizeKey("9");
  await until(() => noticeText() === "no tab 9 in main", "a row that is not there is refused");
  Assert.ok(isOpen(), "and the panel stays open");
  EventUtils.synthesizeKey(String(rows().length));
  await until(() => !isOpen(), "a digit closes the panel");
  Assert.equal(gBrowser.selectedTab.label, "main-three", "and selects that row's tab");
  document.getElementById(NOTICE_ID)?.hidePopover();
});

add_task(async function esc_and_prefix_b_close_and_keys_never_reach_the_page() {
  const browser = gBrowser.selectedBrowser;
  const count = gBrowser.tabs.length;
  await recordPageKeys(browser);
  await openPanel();
  EventUtils.synthesizeKey("x"); // unbound in panel mode: the panel's, not the page's
  EventUtils.synthesizeKey("KEY_Escape");
  await until(() => !isOpen(), "Esc closes the panel");
  await focusPage();
  prefix("b");
  await until(isOpen, "prefix+b opens it");
  prefix("b");
  await until(() => !isOpen(), "prefix+b closes it");
  await focusPage();
  EventUtils.synthesizeKey("z");
  await until(async () => (await pageKeys(browser)).includes("z"), "z reaches the page");
  Assert.deepEqual(await pageKeys(browser), ["z"], "the page saw none of the panel's keys");
  Assert.equal(gBrowser.tabs.length, count, "x closed no tab");
});

add_task(async function ctrl_i_re_renders_the_panel_for_the_next_workspace() {
  await openPanel();
  EventUtils.synthesizeKey("i", { ctrlKey: true });
  await until(() => active() === def("alpha").id, "ctrl+i switches to alpha");
  await until(() => text(header(), "name").includes("2:alpha"), "the header follows");
  Assert.ok(isOpen(), "the panel stays open");
  await until(() => titles().includes("alpha-one"), "and lists alpha's tabs");
  Assert.equal(rows().length, tabsIn("alpha").length, "only alpha's");
  Assert.stringContains(text(header(), "neighbours"), "main", "its neighbour is main");
  EventUtils.synthesizeKey("u", { ctrlKey: true });
  await until(() => active() === def("main").id, "ctrl+u goes back");
  await until(() => titles().includes("main-two"), "and main's rows come back");
  await until(() => panel().contains(document.activeElement), "focus stays in the panel");
  EventUtils.synthesizeKey("KEY_Escape");
  await until(() => !isOpen(), "Esc closes it");
});

add_task(async function a_tab_opened_while_open_gets_a_row() {
  await openPanel();
  const n = rows().length;
  prefix("c");
  await until(() => rows().length === n + 1, "a new tab shows up as a row");
  Assert.ok(isOpen(), "the panel stays open");
  Assert.ok(rows()[n].classList.contains("vimma-panel-active"), "the new tab is the active one");
  EventUtils.synthesizeKey("KEY_Escape");
  await until(() => !isOpen(), "closed");
  BrowserTestUtils.removeTab(gBrowser.selectedTab);
});

add_task(async function it_stays_leftmost_when_firefox_moves_its_sidebar_right() {
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.position_start", false]] });
  await openPanel();
  Assert.equal(browserBoxOrder()[0], panel(), "still the leftmost box");
  EventUtils.synthesizeKey("KEY_Escape");
  await until(() => !isOpen(), "closed");
  await SpecialPowers.popPrefEnv();
});

add_task(async function sidebar_command_opens_it() {
  await focusPage();
  EventUtils.synthesizeKey(":", { shiftKey: true });
  EventUtils.sendString("sidebar");
  EventUtils.synthesizeKey("KEY_Enter");
  await until(isOpen, ":sidebar opens the panel");
  EventUtils.synthesizeKey("KEY_Escape");
  await until(() => !isOpen(), "closed");
});
