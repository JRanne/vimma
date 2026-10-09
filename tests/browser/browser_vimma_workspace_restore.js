/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m3-workspaces.md, sub-spec 3 (m3-workspace-persistence), gate 2: a window's
// workspaces, membership, active workspace, each workspace's selected tab, pane layout, tab
// labels and hidden state are saved into SessionStore (window value `vimma-workspaces`, tab
// values `vimma-tab` / `vimma-workspace`) and come back when SessionStore restores the window;
// the scroll position of a hidden lazy tab comes back when it is first selected. A window value
// written by a newer vimma is never overwritten, and its window still gets a working model.

"use strict";

/* global E10SUtils -- a browser window global */

const { WorkspaceStore } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WorkspaceStore.sys.mjs",
);
const { WindowWorkspaces } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WindowWorkspaces.sys.mjs",
);
const { PaneViews } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/split/PaneView.mjs",
);
const { leaves } = ChromeUtils.importESModule("chrome://browser/content/vimma/core/panes.mjs");
const { getTabLabel, setTabLabel, TAB_LABEL_KEY } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/tab-labels.mjs",
);
const { SessionStore } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
);
const { TabStateFlusher } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs",
);

const ROOT = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com",
);
const LONG = `${ROOT}file_vimma_insert_scroll.html`;
const PAGE = "https://example.com/";
const WINDOW_KEY = "vimma-workspaces";
const TAB_KEY = "vimma-tab";

/** @type {string[]} */
const created = [];
/** @type {Window[]} */
const windows = [];

registerCleanupFunction(async () => {
  for (const w of windows) if (!w.closed) await BrowserTestUtils.closeWindow(w);
  for (const id of created) await WorkspaceStore.deleteWorkspace(id, { confirmed: true });
});

/** @param {string} name */
function workspace(name) {
  const w = WorkspaceStore.addWorkspace({ name, color: "blue", icon: "briefcase" });
  created.push(w.id);
  return w;
}

/** @param {() => boolean} cond @param {string} msg */
function until(cond, msg) {
  return TestUtils.waitForCondition(cond, msg, 50, 200);
}

async function openWindow() {
  const win = await BrowserTestUtils.openNewBrowserWindow();
  windows.push(win);
  await WindowWorkspaces.get(win).ready;
  await until(() => !!WindowWorkspaces.get(win).model, "the new window has its workspaces");
  return win;
}

/** @param {Window} win @param {string} url */
async function openIn(win, url) {
  const tab = await BrowserTestUtils.openNewForegroundTab(win.gBrowser, url);
  return tab;
}

/** The model's workspace holding `tab`, by id. */
function workspaceOf(win, tab) {
  const model = WindowWorkspaces.get(win).model;
  const id = WindowWorkspaces.get(win).idOf(tab);
  return model.workspaces.find((w) => w.tabs.includes(id))?.id ?? null;
}

/** The panel rectangle of `tab`, rounded. */
function rect(win, tab) {
  const r = win.document.getElementById(tab.linkedPanel).getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** Restores `winState` into `win`, overwriting its tabs, and waits for SessionStore to finish. */
async function restoreInto(win, winState) {
  const restored = BrowserTestUtils.waitForEvent(win, "SSWindowRestored");
  SessionStore.setWindowState(win, JSON.stringify({ windows: [winState] }), true);
  await restored;
  await TestUtils.waitForTick();
}

add_task(async function gate_2_workspaces_tabs_panes_labels_and_scroll_come_back() {
  const A = workspace("rs-a");
  const B = workspace("rs-b");
  const w1 = await openWindow();
  const ww1 = WindowWorkspaces.get(w1);

  // A: the start tab, a long page scrolled to 1200, and a renamed tab, selected.
  ww1.switchTo({ id: A.id });
  const a1 = await openIn(w1, LONG);
  await SpecialPowers.spawn(a1.linkedBrowser, [], () => {
    content.scrollTo(0, 1200);
  });
  const a2 = await openIn(w1, `${PAGE}?a2`);
  setTabLabel(a2, "notes");

  // B: the start tab and a page, side by side; B active, the right pane focused.
  ww1.switchTo({ id: B.id });
  await until(() => w1.gBrowser.selectedTab.userContextId === B.userContextId, "B's start tab");
  const b0 = w1.gBrowser.selectedTab;
  const b1 = BrowserTestUtils.addTab(w1.gBrowser, `${PAGE}?b1`);
  await BrowserTestUtils.browserLoaded(b1.linkedBrowser);
  const view1 = PaneViews.get(w1);
  Assert.ok(view1.split("vertical", { tab: b1 }).ok, "B is split");
  await until(() => rect(w1, b0).width > 100 && rect(w1, b1).width > 100, "B is laid out");
  const before = { b0: rect(w1, b0), b1: rect(w1, b1) };
  Assert.equal(w1.gBrowser.selectedTab, b1, "the right pane is focused");
  Assert.equal(workspaceOf(w1, a1), A.id, "the long page is in A");
  Assert.equal(workspaceOf(w1, b1), B.id, "b1 is in B");

  const uuid = (/** @type {Element} */ t) => SessionStore.getCustomTabValue(t, TAB_KEY);
  const uuids = new Map([a1, a2, b0, b1].map((t) => [t, uuid(t)]));
  Assert.ok(
    [...uuids.values()].every((u) => /^[0-9a-f-]{36}$/.test(u)),
    "every tab has a uuid in its vimma-tab value",
  );
  Assert.equal(SessionStore.getCustomTabValue(a1, "vimma-workspace"), A.id, "and its workspace");

  await TabStateFlusher.flushWindow(w1);
  await TestUtils.waitForTick();
  const state = JSON.parse(SessionStore.getBrowserState());
  const winState = state.windows.find((w) =>
    w.tabs.some((t) => t.entries.some((e) => e.url === `${PAGE}?b1`)),
  );
  Assert.ok(winState, "the window is in the browser state");
  const snapshot = JSON.parse(winState.extData?.[WINDOW_KEY] ?? "null");
  Assert.equal(snapshot?.schema, 1, "with a schema-1 snapshot in its window value");
  // The label comes back from the snapshot, not only from the tab value (rename seam).
  for (const t of winState.tabs) delete t.extData?.[TAB_LABEL_KEY];
  await BrowserTestUtils.closeWindow(w1);

  const w2 = await openWindow();
  await restoreInto(w2, winState);
  const ww2 = WindowWorkspaces.get(w2);
  const model = ww2.model;
  const ids = (/** @type {string} */ id) =>
    model.workspaces.find((w) => w.id === id).tabs.map((p) => uuid(ww2.tabOf(p)));
  Assert.equal(ids(A.id).length, 3, "A has its three tabs");
  Assert.deepEqual(
    ids(A.id).slice(1),
    [uuids.get(a1), uuids.get(a2)],
    "A's tabs come back, in order, with their uuids",
  );
  Assert.deepEqual(ids(B.id), [uuids.get(b0), uuids.get(b1)], "B's tabs come back");
  Assert.equal(model.active, B.id, "B is the active workspace");

  const byUuid = (/** @type {string} */ u) => w2.gBrowser.tabs.find((t) => uuid(t) === u);
  const [r1, r2, rb0, rb1] = [a1, a2, b0, b1].map((t) => byUuid(uuids.get(t)));
  Assert.equal(w2.gBrowser.selectedTab, rb1, "B's selected tab is selected");
  Assert.equal(
    model.workspaces.find((w) => w.id === A.id).activeTab,
    uuids.get(a2),
    "A's selected tab is remembered",
  );
  Assert.ok(r1.hidden && r2.hidden, "A's tabs are hidden");
  Assert.ok(!rb0.hidden && !rb1.hidden, "B's tabs are shown");
  Assert.equal(getTabLabel(r2), "notes", "the renamed tab keeps its label");

  const view2 = PaneViews.get(w2);
  Assert.deepEqual(
    leaves(view2.panes ?? { root: { type: "leaf", pane: "p0", tab: "" } }).map((l) => l.tab),
    [rb0.linkedPanel, rb1.linkedPanel],
    "B's pane tree comes back",
  );
  await until(() => {
    const now = { b0: rect(w2, rb0), b1: rect(w2, rb1) };
    return ["b0", "b1"].every((k) =>
      ["left", "top", "width", "height"].every((p) => Math.abs(now[k][p] - before[k][p]) <= 1),
    );
  }, "B's panes have their rectangles (±1 px)");

  Assert.ok(r1.hasAttribute("pending"), "the hidden long page is lazy");
  w2.gBrowser.selectedTab = r1;
  await until(() => ww2.model.active === A.id, "selecting it switches to A");
  await until(() => !r1.hasAttribute("pending"), "it restores");
  const scrollY = () => SpecialPowers.spawn(r1.linkedBrowser, [], () => content.scrollY);
  await TestUtils.waitForCondition(async () => (await scrollY()) === 1200, "scroll restores");
  Assert.equal(await scrollY(), 1200, "scrollY is 1200 again");

  await BrowserTestUtils.closeWindow(w2);
});

add_task(async function a_newer_window_value_is_left_untouched() {
  for (const id of created.splice(0)) await WorkspaceStore.deleteWorkspace(id, { confirmed: true });
  const main = WorkspaceStore.definitions.workspaces.find((d) => d.name === "main");
  const newer = JSON.stringify({ schema: 99, active: "x", workspaces: [] });
  const tab = (/** @type {string} */ url) => ({
    entries: [{ url, triggeringPrincipal_base64: E10SUtils.SERIALIZED_SYSTEMPRINCIPAL }],
    userContextId: main.userContextId,
  });
  const win = await openWindow();
  await restoreInto(win, {
    tabs: [tab(`${PAGE}?n1`), tab(`${PAGE}?n2`)],
    selected: 2,
    extData: { [WINDOW_KEY]: newer },
  });
  const ww = WindowWorkspaces.get(win);
  Assert.ok(ww.model, "the window has a model");
  Assert.equal(ww.model.workspaces.length, 1, "with one workspace");
  Assert.equal(ww.model.workspaces[0].tabs.length, win.gBrowser.tabs.length, "holding every tab");
  const added = await openIn(win, `${PAGE}?n3`);
  Assert.equal(workspaceOf(win, added), main.id, "a new tab joins it");
  await TestUtils.waitForTick();
  await TestUtils.waitForTick();
  Assert.equal(
    SessionStore.getCustomWindowValue(win, WINDOW_KEY),
    newer,
    "the newer snapshot is left byte for byte",
  );
  await BrowserTestUtils.closeWindow(win);
});

add_task(function restart_restores_the_session_and_sync_leaves_it_alone() {
  const defaults = Services.prefs.getDefaultBranch("");
  Assert.equal(defaults.getIntPref("browser.startup.page"), 3, "startup resumes the session");
  Assert.equal(
    defaults.getBoolPref("services.sync.prefs.sync.browser.startup.page"),
    false,
    "Sync does not change it",
  );
  Assert.equal(
    defaults.getBoolPref("services.sync.prefs.sync.privacy.userContext.enabled"),
    false,
    "nor turns containers off",
  );
});
