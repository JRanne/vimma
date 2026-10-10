/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m3-workspaces.md, sub-specs 4a (m3-workspace-lifecycle) and 4b
// (m3-workspace-move): prefix+shift+n / shift+w / shift+d and :wsnew / :wsrename / :wsdelete
// create, rename and close workspaces (closing asks y/N; a runtime workspace takes its container
// and site data with it, a config one only its tabs; the last one stays), and :wsmove reopens
// the tab in another workspace's container, keeping its label and mute, out of its split first.

"use strict";

/* global focusContent -- from head.js */

const { WorkspaceStore } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WorkspaceStore.sys.mjs",
);
const { WindowWorkspaces, WINDOW_KEY, TAB_WORKSPACE_KEY } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WindowWorkspaces.sys.mjs",
);
const { PaneViews } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/split/PaneView.mjs",
);
const { getTabLabel, setTabLabel } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/tab-labels.mjs",
);
const { SessionStore } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
);
const { ContextualIdentityService } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs",
);

const PAGE = "https://example.com/";
const NOTICE_ID = "vimma-notice";
const PROMPT_ID = "vimma-rename";
const CMDLINE_INPUT_ID = "vimma-cmdline-input";

const def = (/** @type {string} */ name) =>
  WorkspaceStore.definitions.workspaces.find((w) => w.name === name);
const main = () => def("main");
const ww = () => WindowWorkspaces.get(window);
const active = () => ww().model.active;
const identity = (/** @type {number} */ id) =>
  ContextualIdentityService.getPublicIdentityFromId(id);

registerCleanupFunction(async () => {
  if (document.getElementById(PROMPT_ID)?.hidden === false) EventUtils.synthesizeKey("KEY_Escape");
  await WorkspaceStore.setConfig([]);
  ww().switchTo({ id: main().id });
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

/** `:line` Enter, from the selected page in normal mode. */
async function runCommand(line) {
  await focusContent(gBrowser.selectedBrowser);
  EventUtils.synthesizeKey(":", { shiftKey: true });
  EventUtils.sendString(line);
  EventUtils.synthesizeKey("KEY_Enter");
}

const noticeText = () => document.getElementById(NOTICE_ID)?.textContent ?? "";
const promptOpen = () => document.getElementById(PROMPT_ID)?.hidden === false;
/** The prompt's question, without the space before the input. */
const promptText = () =>
  (
    document.getElementById(PROMPT_ID)?.querySelector(".vimma-cmdline-prompt")?.textContent ?? ""
  ).trim();

/** Waits for a tab of container `ucid` to have loaded `url`, and returns it. */
async function reopened(ucid, url) {
  await until(
    () => tabsOf(ucid).some((t) => t.linkedBrowser.currentURI.spec === url),
    `${url} reopens in container ${ucid}`,
  );
  return tabsOf(ucid).find((t) => t.linkedBrowser.currentURI.spec === url);
}

/** The status bar's workspace segment. */
const wsSegment = () =>
  document.getElementById("vimma-statusbar")?.querySelector('[data-segment="workspace"]')
    ?.textContent ?? null;

/** The window's saved snapshot (SessionStore window value). */
const snapshot = () => JSON.parse(SessionStore.getCustomWindowValue(window, WINDOW_KEY) || "{}");

/** Tabs (in every window) of container `ucid`. */
const tabsOf = (/** @type {number} */ ucid) =>
  gBrowser.tabs.filter((t) => t.userContextId === ucid && !t.closing);

const cookieCount = (/** @type {number} */ userContextId) =>
  Services.cookies.getCookiesWithOriginAttributes(JSON.stringify({ userContextId }), "example.com")
    .length;

function setCookie(/** @type {number} */ userContextId) {
  Services.cookies.add(
    "example.com",
    "/",
    "session",
    "ops",
    true,
    false,
    false,
    Date.now() + 86400000,
    { userContextId },
    Ci.nsICookie.SAMESITE_NONE,
    Ci.nsICookie.SCHEME_HTTPS,
  );
}

/** :wsnew `name`, waiting for the window to show it. */
async function create(name) {
  await runCommand(`wsnew ${name}`);
  await until(() => def(name) && active() === def(name).id, `created and switched to ${name}`);
  return def(name);
}

add_task(async function the_last_workspace_cannot_be_closed() {
  Assert.equal(WorkspaceStore.definitions.workspaces.length, 1, "only main to begin with");
  await runCommand("wsdelete");
  await until(() => /last workspace/.test(noticeText()), "the notice says why");
  Assert.ok(!promptOpen(), "nothing to confirm");
  Assert.ok(main(), "main stays");
});

add_task(async function new_workspace_appears_in_cycling_the_bar_and_the_snapshot() {
  await focusContent(gBrowser.selectedBrowser);
  prefix("N", { shiftKey: true });
  const input = document.getElementById(CMDLINE_INPUT_ID);
  await until(() => input?.value === "wsnew ", "prefix+shift+n asks on the command line");
  EventUtils.sendString("shop");
  EventUtils.synthesizeKey("KEY_Enter");
  await until(() => def("shop") && active() === def("shop").id, "shop is created and shown");
  const shop = def("shop");
  Assert.equal(shop.source, "runtime", "a runtime workspace");
  Assert.ok(identity(shop.userContextId), "with a container of its own");
  await until(() => wsSegment() === "● 2:shop", "the bar shows it");
  await until(
    () => snapshot().workspaces?.some((w) => w.id === shop.id),
    "the window's snapshot has it",
  );
  Assert.equal(gBrowser.selectedTab.userContextId, shop.userContextId, "its home tab is in it");

  EventUtils.synthesizeKey("i", { ctrlKey: true });
  await until(() => active() === main().id, "ctrl+i wraps to main");
  EventUtils.synthesizeKey("i", { ctrlKey: true });
  await until(() => active() === shop.id, "and ctrl+i comes back to shop");

  await runCommand("wsnew shop");
  await until(() => /exists/.test(noticeText()), "a taken name is refused");
  Assert.equal(
    WorkspaceStore.definitions.workspaces.filter((w) => w.name === "shop").length,
    1,
    "no second shop",
  );
});

add_task(async function rename_shows_in_the_bar_and_renames_the_container() {
  const shop = def("shop");
  ww().switchTo({ id: shop.id });
  await focusContent(gBrowser.selectedBrowser);
  prefix("W", { shiftKey: true });
  const input = document.getElementById(CMDLINE_INPUT_ID);
  await until(() => input?.value === "wsrename shop", "prefix+shift+w offers the name to edit");
  EventUtils.synthesizeKey("KEY_Escape");

  await runCommand("wsrename market");
  await until(() => wsSegment() === "● 2:market", "the bar shows the new name");
  Assert.equal(def("market")?.id, shop.id, "same workspace, new name");
  Assert.equal(identity(shop.userContextId)?.name, "market", "the container is renamed too");
  await until(
    () => snapshot().workspaces?.find((w) => w.id === shop.id)?.name === "market",
    "and the snapshot",
  );
});

add_task(async function closing_asks_n_keeps_y_deletes_the_container_and_its_cookies() {
  const market = def("market");
  ww().switchTo({ id: market.id });
  await BrowserTestUtils.openNewForegroundTab(gBrowser, `${PAGE}?market`);
  setCookie(market.userContextId);
  setCookie(main().userContextId);
  Assert.equal(cookieCount(market.userContextId), 1, "market has a cookie");

  await focusContent(gBrowser.selectedBrowser);
  prefix("D", { shiftKey: true });
  await until(promptOpen, "prefix+shift+d asks");
  Assert.equal(
    promptText(),
    'Close "market" (2 tabs) and delete its cookies and site data? y/N',
    "the question says what goes",
  );
  EventUtils.synthesizeKey("n");
  await until(() => !promptOpen(), "n closes the prompt");
  Assert.ok(def("market"), "n keeps the workspace");
  Assert.equal(tabsOf(market.userContextId).length, 2, "and its tabs");

  await runCommand("wsdelete");
  await until(promptOpen, ":wsdelete asks too");
  const cleared = TestUtils.topicObserved(
    "clear-origin-attributes-data",
    (_s, data) => JSON.parse(data).userContextId === market.userContextId,
  );
  EventUtils.synthesizeKey("y");
  await cleared;
  await until(() => !def("market"), "y deletes the workspace");
  await until(() => cookieCount(market.userContextId) === 0, "its cookie is gone");
  Assert.ok(!identity(market.userContextId), "and its container");
  Assert.equal(tabsOf(market.userContextId).length, 0, "and its tabs");
  Assert.equal(cookieCount(main().userContextId), 1, "main's cookie stays");
  Assert.equal(active(), main().id, "the window shows main");
  Assert.ok(!ww().model.workspaces.some((w) => w.id === market.id), "the model has no market");
  Services.cookies.removeAll();
});

add_task(async function closing_a_config_workspace_closes_its_tabs_only() {
  await WorkspaceStore.setConfig([
    { name: "job", color: "red", icon: "briefcase", autofill: true },
  ]);
  await until(() => def("job") && ww().model.workspaces.some((w) => w.id === def("job").id), "job");
  const job = def("job");
  ww().switchTo({ id: job.id });
  await BrowserTestUtils.openNewForegroundTab(gBrowser, `${PAGE}?job`);

  await runCommand("wsrename work");
  await until(() => /config\.toml/.test(noticeText()), "a config workspace is renamed there");
  Assert.equal(def("job")?.id, job.id, "the name stays");

  await runCommand("wsdelete");
  await until(promptOpen, "it asks");
  Assert.equal(
    promptText(),
    'Close the 2 tabs of "job"? It stays, as it is in config.toml. y/N',
    "the question says the workspace stays",
  );
  EventUtils.synthesizeKey("y");
  await until(() => tabsOf(job.userContextId).length === 0, "its tabs close");
  Assert.ok(def("job"), "the workspace stays");
  Assert.ok(identity(job.userContextId), "and its container");
  Assert.equal(active(), main().id, "the window shows main");
});

add_task(async function moving_a_tab_reopens_it_in_the_target_container() {
  const a = await create("alpha");
  const b = await create("beta");
  ww().switchTo({ id: a.id });
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, `${PAGE}?moved`);
  setTabLabel(tab, "my label");
  tab.toggleMuteAudio();
  const oldId = ww().idOf(tab);

  await runCommand("wsmove beta");
  await until(() => !tab.isConnected, "the original tab closes");
  const moved = await reopened(b.userContextId, `${PAGE}?moved`);
  Assert.ok(moved, "the URL reopens in beta's container");
  Assert.equal(getTabLabel(moved), "my label", "the label is kept");
  Assert.ok(moved.muted, "and the mute");
  const model = ww().model;
  const inA = model.workspaces.find((w) => w.id === a.id).tabs;
  const inB = model.workspaces.find((w) => w.id === b.id).tabs;
  Assert.ok(!inA.includes(oldId), "alpha no longer has it");
  Assert.ok(inB.includes(ww().idOf(moved)), "beta has it");
  Assert.equal(active(), a.id, "the window stays in alpha");
  Assert.ok(moved.hidden, "the moved tab is hidden with beta");
  await until(
    () => SessionStore.getCustomTabValue(moved, TAB_WORKSPACE_KEY) === b.id,
    "its saved workspace is beta",
  );

  await runCommand("wsmove nowhere");
  await until(() => /no workspace "nowhere"/.test(noticeText()), "an unknown target is refused");
});

add_task(async function a_split_member_leaves_its_split_before_it_moves() {
  const a = def("alpha");
  const b = def("beta");
  ww().switchTo({ id: a.id });
  const left = await BrowserTestUtils.openNewForegroundTab(gBrowser, `${PAGE}?left`);
  const view = PaneViews.get(window);
  Assert.ok(view.split("vertical").ok, "a split");
  const right = gBrowser.selectedTab;
  await until(() => right.splitview && left.splitview, "laid out on Firefox's split view");
  BrowserTestUtils.startLoadingURIString(right.linkedBrowser, `${PAGE}?right`);
  await BrowserTestUtils.browserLoaded(right.linkedBrowser);

  const number = WorkspaceStore.definitions.workspaces.findIndex((w) => w.id === b.id) + 1;
  await runCommand(`wsmove ${number}`);
  await until(() => !right.isConnected, "the split member moves");
  Assert.equal(view.panes, null, "the split is gone: one pane left");
  await until(() => !left.splitview, "and so is Firefox's wrapper");
  const moved = await reopened(b.userContextId, `${PAGE}?right`);
  Assert.ok(moved, "it reopens in beta, by number");
  Assert.ok(!moved.splitview, "outside any split");
  Assert.ok(!left.hidden && left.isConnected, "the other member stays in alpha");
  Services.prefs.clearUserPref("browser.tabs.splitview.hasUsed");
});
