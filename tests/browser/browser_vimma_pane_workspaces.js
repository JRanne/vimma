/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Panes per workspace and restore (docs/specs/m4-split-panes.md, sub-spec 6): each workspace keeps
// its own pane layout and focused pane across ctrl+b ) / ctrl+b (, and a switch leaves the other
// workspace's layout alone; a session restore brings back every workspace's layout (the shown
// one and the parked ones) and focus; a tab selected from outside the split while split shows in
// the focused pane (core's setPaneTab), and the split stays.

"use strict";

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
const { SessionStore } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
);
const { TabStateFlusher } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs",
);

const PAGE = "https://example.com/";

/** @type {string[]} */
const created = [];
/** @type {Window[]} */
const windows = [];

registerCleanupFunction(async () => {
  for (const w of windows) if (!w.closed) await BrowserTestUtils.closeWindow(w);
  for (const id of created) await WorkspaceStore.deleteWorkspace(id, { confirmed: true });
  Services.prefs.clearUserPref("browser.tabs.splitview.hasUsed");
  Services.prefs.clearUserPref("sidebar.verticalTabs.dragToPinPromo.dismissed");
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

/** Switches `win` to workspace `to` with ctrl+b ) or ctrl+b (, and waits for it. */
async function press(win, key, to) {
  EventUtils.synthesizeKey("b", { ctrlKey: true }, win);
  EventUtils.synthesizeKey(key, { shiftKey: true }, win);
  const shown = () => WindowWorkspaces.get(win).model.active === to.id;
  await until(shown, `ctrl+b ${key} shows ${to.name}`);
}

/** A loaded background tab of the active workspace. */
async function page(win, query) {
  const tab = BrowserTestUtils.addTab(win.gBrowser, `${PAGE}?${query}`);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  return tab;
}

/** The window's selected tab once it is in workspace `ws`'s container (a fresh start tab). */
async function startTab(win, ws) {
  await until(() => win.gBrowser.selectedTab.userContextId === ws.userContextId, "a start tab");
  return win.gBrowser.selectedTab;
}

/** The panel rectangle of `tab`. */
function rect(win, tab) {
  const r = win.document.getElementById(tab.linkedPanel).getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** @param {Window} win @param {Element[]} tabs */
function rects(win, tabs) {
  return tabs.map((t) => rect(win, t));
}

/** Whether `now` matches `before`, each edge within 1 px. */
function near(now, before) {
  return now.every((r, i) =>
    ["left", "top", "width", "height"].every((p) => Math.abs(r[p] - before[i][p]) <= 1),
  );
}

/** The shown tree's tabs in reading order, and the focused pane's tab. */
function shown(win) {
  const panes = PaneViews.get(win).panes;
  if (!panes) return { tabs: [], focus: null };
  const order = leaves(panes);
  const byPanel = (/** @type {string} */ id) => win.gBrowser.tabs.find((t) => t.linkedPanel === id);
  return {
    tabs: order.map((l) => byPanel(l.tab)),
    focus: byPanel(order.find((l) => l.pane === panes.focus)?.tab ?? ""),
  };
}

/** Labels for messages: the tabs' URLs' queries. */
function names(tabs) {
  return tabs.map((t) => t?.linkedBrowser.currentURI.spec.split("?")[1] ?? "start").join(",");
}

/**
 * A: an L shape, start | (a1 / a2), with the left pane focused; B: b0 / b1, the lower pane
 * focused. Built in `win`, which ends showing `end`.
 */
async function twoLayouts(win, A, B) {
  const view = PaneViews.get(win);
  WindowWorkspaces.get(win).switchTo({ id: A.id });
  const a0 = await startTab(win, A);
  const a1 = await page(win, "a1");
  const a2 = await page(win, "a2");
  Assert.ok(view.split("vertical", { tab: a1 }).ok, "A: start | a1");
  Assert.ok(view.split("horizontal", { tab: a2 }).ok, "A: a1 / a2");
  view.focus("left");
  Assert.equal(win.gBrowser.selectedTab, a0, "A: the left pane is focused");
  a0.linkedBrowser.focus();
  await until(() => win.document.activeElement === a0.linkedBrowser, "A: its page has focus");

  WindowWorkspaces.get(win).switchTo({ id: B.id });
  const b0 = await startTab(win, B);
  const b1 = await page(win, "b1");
  Assert.ok(view.split("horizontal", { tab: b1 }).ok, "B: b0 / b1");
  Assert.equal(win.gBrowser.selectedTab, b1, "B: the lower pane is focused");
  return { a: [a0, a1, a2], b: [b0, b1] };
}

/** Every tab of `tabs` is in one wrapper, active, and laid out (non-empty rects). */
async function assertLive(win, tabs, what) {
  const wrapper = tabs[0].splitview;
  Assert.ok(wrapper, `${what}: in a split view`);
  Assert.ok(
    tabs.every((t) => t.splitview === wrapper),
    `${what}: one wrapper holds ${names(tabs)}`,
  );
  Assert.equal(wrapper.tabs.length, tabs.length, `${what}: and nothing else`);
  Assert.ok(!wrapper.hidden, `${what}: the wrapper shows`);
  await until(
    () => tabs.every((t) => t.linkedBrowser.docShellIsActive),
    `${what}: every pane's docshell is active`,
  );
}

add_task(async function each_workspace_keeps_its_panes_and_focus_across_switches() {
  const A = workspace("pw-a");
  const B = workspace("pw-b");
  const win = await openWindow();
  const { a, b } = await twoLayouts(win, A, B);
  const [a0] = a;
  const [, b1] = b;
  await until(() => b.every((t) => rect(win, t).width > 100), "B is laid out");
  const bRects = rects(win, b);

  await press(win, "(", A);
  Assert.deepEqual(names(shown(win).tabs), names(a), "A's three panes come back, in order");
  Assert.equal(shown(win).focus, a0, "with A's focused pane");
  Assert.equal(win.gBrowser.selectedTab, a0, "whose tab is selected");
  await assertLive(win, a, "A");
  Assert.ok(b.every((t) => t.hidden) && b[0].splitview.hidden, "B's split hides as a whole");
  await until(() => win.document.activeElement === a0.linkedBrowser, "A's focused page has focus");
  await until(() => a.every((t) => rect(win, t).width > 100), "A is laid out");
  const aRects = rects(win, a);
  Assert.ok(
    aRects[0].height > aRects[1].height + 100 && Math.abs(aRects[1].left - aRects[2].left) <= 1,
    "A is an L shape: the start page full height, a1 over a2",
  );

  await press(win, ")", B);
  Assert.deepEqual(names(shown(win).tabs), names(b), "B's two panes are unaffected");
  Assert.equal(shown(win).focus, b1, "and keep their focus");
  Assert.equal(win.gBrowser.selectedTab, b1, "B's focused tab is selected");
  await until(() => win.document.activeElement === b1.linkedBrowser, "B's focused page has focus");
  await assertLive(win, b, "B");
  Assert.ok(
    a.every((t) => t.hidden),
    "A's tabs hide",
  );
  await until(() => near(rects(win, b), bRects), "B's rectangles are back (±1 px)");

  await press(win, "(", A);
  await until(() => near(rects(win, a), aRects), "A's rectangles are back too (±1 px)");
  Assert.equal(win.gBrowser.selectedTab, a0, "and A's focus");

  await BrowserTestUtils.closeWindow(win);
});

add_task(async function a_session_restore_brings_back_every_workspaces_layout_and_focus() {
  const A = workspace("pw-ra");
  const B = workspace("pw-rb");
  const w1 = await openWindow();
  const { a, b } = await twoLayouts(w1, A, B);
  WindowWorkspaces.get(w1).switchTo({ id: A.id });
  await until(() => w1.gBrowser.selectedTab === a[0], "A shows, its left pane focused");
  await until(() => a.every((t) => rect(w1, t).width > 100), "A is laid out");
  const aRects = rects(w1, a);
  WindowWorkspaces.get(w1).switchTo({ id: B.id });
  await until(() => b.every((t) => rect(w1, t).width > 100), "B is laid out");
  const bRects = rects(w1, b);
  WindowWorkspaces.get(w1).switchTo({ id: A.id });
  await until(() => w1.gBrowser.selectedTab === a[0], "A shows again; B is parked");

  const uuid = (/** @type {Element} */ t) => SessionStore.getCustomTabValue(t, "vimma-tab");
  const aIds = a.map(uuid);
  const bIds = b.map(uuid);
  await TabStateFlusher.flushWindow(w1);
  await TestUtils.waitForTick();
  const state = JSON.parse(SessionStore.getBrowserState());
  const winState = state.windows.find((w) =>
    w.tabs.some((t) => t.entries.some((e) => e.url === `${PAGE}?b1`)),
  );
  Assert.ok(winState, "the window is in the browser state");
  await BrowserTestUtils.closeWindow(w1);

  const w2 = await openWindow();
  const restored = BrowserTestUtils.waitForEvent(w2, "SSWindowRestored");
  SessionStore.setWindowState(w2, JSON.stringify({ windows: [winState] }), true);
  await restored;
  await TestUtils.waitForTick();
  const byUuid = (/** @type {string} */ u) => w2.gBrowser.tabs.find((t) => uuid(t) === u);
  const ra = aIds.map(byUuid);
  const rb = bIds.map(byUuid);

  Assert.equal(WindowWorkspaces.get(w2).model.active, A.id, "A is the shown workspace");
  Assert.deepEqual(names(shown(w2).tabs), names(ra), "A's L shape is adopted");
  Assert.equal(shown(w2).focus, ra[0], "with its left pane focused");
  Assert.equal(w2.gBrowser.selectedTab, ra[0], "and selected");
  await assertLive(w2, ra, "restored A");
  await until(() => near(rects(w2, ra), aRects), "A's rectangles (±1 px)");

  await press(w2, ")", B);
  Assert.deepEqual(names(shown(w2).tabs), names(rb), "B's parked layout is adopted too");
  Assert.equal(shown(w2).focus, rb[1], "with its lower pane focused");
  Assert.equal(w2.gBrowser.selectedTab, rb[1], "and selected");
  await assertLive(w2, rb, "restored B");
  await until(() => near(rects(w2, rb), bRects), "B's rectangles (±1 px)");
  Assert.ok(
    ra.every((t) => t.hidden),
    "A's split is hidden",
  );

  await BrowserTestUtils.closeWindow(w2);
});

add_task(async function a_tab_selected_from_outside_the_split_shows_in_the_focused_pane() {
  const A = workspace("pw-sa");
  const B = workspace("pw-sb");
  const win = await openWindow();
  const view = PaneViews.get(win);
  const gB = win.gBrowser;
  WindowWorkspaces.get(win).switchTo({ id: B.id });
  const b0 = await startTab(win, B);
  WindowWorkspaces.get(win).switchTo({ id: A.id });
  const a0 = await startTab(win, A);
  const a1 = await page(win, "a1");
  const a2 = await page(win, "a2");
  Assert.ok(view.split("vertical", { tab: a1 }).ok, "A: start | a1, a1 focused");
  await assertLive(win, [a0, a1], "the split");
  await until(() => rect(win, a1).width > 100, "laid out");
  const before = rects(win, [a0, a1]);

  // As the picker, ctrl+tab or switch-to-tab would: a tab of A that no pane shows.
  gB.selectedTab = a2;
  Assert.deepEqual(names(shown(win).tabs), names([a0, a2]), "a2 replaces a1 in the focused pane");
  Assert.equal(shown(win).focus, a2, "which keeps focus");
  Assert.ok(a2.splitview && a2.splitview === a0.splitview, "the split stays, a2 in it");
  Assert.ok(!a1.splitview, "a1 left the split");
  Assert.equal(gB.selectedTab, a2, "a2 is selected");
  Assert.ok(!a1.hidden, "a1 stays a tab of A");
  await assertLive(win, [a0, a2], "after the replace");
  await until(() => !a1.linkedBrowser.docShellIsActive, "a1's docshell goes inactive");
  await until(() => near(rects(win, [a0, a2]), before), "a2 takes a1's rectangle (±1 px)");

  // Back to a1 the same way: it replaces a2 in the focused pane again.
  gB.selectedTab = a1;
  Assert.deepEqual(names(shown(win).tabs), names([a0, a1]), "a1 is back in the focused pane");

  // Another workspace's tab switches workspaces (m3 2b); A's tree is left as it was.
  gB.selectedTab = b0;
  await until(() => WindowWorkspaces.get(win).model.active === B.id, "selecting b0 switches to B");
  Assert.equal(view.panes, null, "B shows one pane");
  Assert.ok(!b0.splitview, "b0 joined no split");
  await press(win, "(", A);
  Assert.deepEqual(names(shown(win).tabs), names([a0, a1]), "A's panes are untouched");

  // A pinned tab is in every workspace and cannot join a split: the tree stays.
  const pinned = await page(win, "pinned");
  gB.pinTab(pinned);
  gB.selectedTab = pinned;
  Assert.ok(pinned.pinned && !pinned.splitview, "the pinned tab stays pinned, out of the split");
  Assert.deepEqual(names(shown(win).tabs), names([a0, a1]), "and the panes are unchanged");
  gB.selectedTab = a1;
  await assertLive(win, [a0, a1], "selecting a pane again");

  await BrowserTestUtils.closeWindow(win);
});
