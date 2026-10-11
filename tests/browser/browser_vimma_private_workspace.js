/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/private-workspace.md. The private workspace is Firefox's private window,
// presented as one more workspace: ctrl+b shift+p / ctrl+shift+p / :private go there (and back),
// it is never a cycle or alternate target of a normal window, the pickers list it as a last row
// with a count only, a tab may move in (y/N) but never out, vimma-ctl withholds its URLs and
// titles, nothing about it reaches the normal profile, and closing it discards its data.

"use strict";

/* global focusContent -- from head.js */

const { WorkspaceStore } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WorkspaceStore.sys.mjs",
);
const { WindowWorkspaces, WINDOW_KEY } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WindowWorkspaces.sys.mjs",
);
const { VimmaControl } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/ctl/VimmaControl.sys.mjs",
);
const { validateMessage } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/core/index.mjs",
);
const { getTabLabel, setTabLabel } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/tab-labels.mjs",
);
const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
);
const { SessionStore } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
);
const { SessionSaver } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/SessionSaver.sys.mjs",
);
const { SessionFile } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/SessionFile.sys.mjs",
);
const { FormHistory } = ChromeUtils.importESModule("resource://gre/modules/FormHistory.sys.mjs");
const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");

const ROOT = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com",
);
const FORM = `${ROOT}file_vimma_private_form.html`;
const PAGE = "https://example.com/?normal";
const PICKER_ID = "vimma-workspace-picker";
const GOTO_ID = "vimma-picker";
const PANEL_ID = "vimma-panel";
const NOTICE_ID = "vimma-notice";
const PROMPT_ID = "vimma-rename";
const MARK = "vimmaprivate";

/** @type {string[]} */
const created = [];
/** @param {string} name */
function workspace(name) {
  const w = WorkspaceStore.addWorkspace({ name, color: "blue", icon: "briefcase" });
  created.push(w.id);
  return w;
}
const main = () => WorkspaceStore.definitions.workspaces.find((w) => w.name === "main");
const ww = (win = window) => WindowWorkspaces.get(win);

registerCleanupFunction(async () => {
  for (const w of privateWindows()) await BrowserTestUtils.closeWindow(w);
  await SimpleTest.promiseFocus(window);
  ww().switchTo({ id: main().id });
  for (const id of created) await WorkspaceStore.deleteWorkspace(id, { confirmed: true });
  while (gBrowser.tabs.length > 1) BrowserTestUtils.removeTab(gBrowser.tabs.at(-1));
});

/** @param {() => boolean} cond @param {string} msg */
function until(cond, msg) {
  return TestUtils.waitForCondition(cond, msg, 50, 100);
}

/** Every open private browser window (popups excluded). */
function privateWindows() {
  return [...Services.wm.getEnumerator("navigator:browser")].filter(
    (w) => !w.closed && w.toolbar.visible && PrivateBrowsingUtils.isWindowPrivate(w),
  );
}

/** ctrl+b, then `key` with `mods`, in `win`. */
function prefix(key, mods = {}, win = window) {
  EventUtils.synthesizeKey("b", { ctrlKey: true }, win);
  EventUtils.synthesizeKey(key, mods, win);
}

/** @param {Window} win */
const isActive = (win) => Services.focus.activeWindow === win;

/** Presses ctrl+b shift+p in the normal window and returns the private window it opened. */
async function openPrivate() {
  await SimpleTest.promiseFocus(window);
  const opened = BrowserTestUtils.waitForNewWindow();
  prefix("P", { shiftKey: true });
  const priv = await opened;
  await until(() => isActive(priv), "the private window has focus");
  return priv;
}

/** @param {Window} win @param {string} id statusSegments id */
function segText(win, id) {
  return (
    win.document.getElementById("vimma-statusbar")?.querySelector(`[data-segment="${id}"]`)
      ?.textContent ?? null
  );
}

/** @param {Window} win */
const noticeText = (win) => win.document.getElementById(NOTICE_ID)?.textContent ?? "";
/** @param {Window} win */
const promptOpen = (win) => win.document.getElementById(PROMPT_ID)?.hidden === false;
/** @param {Window} win  the prompt's question */
const promptText = (win) =>
  (
    win.document.getElementById(PROMPT_ID)?.querySelector(".vimma-cmdline-prompt")?.textContent ??
    ""
  ).trim();

/**
 * Focuses `win`'s selected page (focusContent is this window's only).
 * @param {Window} win
 */
async function focusPage(win) {
  if (win === window) {
    await focusContent(gBrowser.selectedBrowser);
    return;
  }
  const browser = win.gBrowser.selectedBrowser;
  await SimpleTest.promiseFocus(browser);
  await until(() => win.document.activeElement === browser, "the page has focus");
  await TestUtils.waitForCondition(() =>
    SpecialPowers.spawn(browser, [], () => content.document.hasFocus()),
  );
}

/** `:line` Enter in `win`, from its selected page. */
async function runCommand(line, win = window) {
  await SimpleTest.promiseFocus(win);
  await focusPage(win);
  EventUtils.synthesizeKey(":", { shiftKey: true }, win);
  EventUtils.sendString(line, win);
  EventUtils.synthesizeKey("KEY_Enter", {}, win);
}

/** Answers the open y/N prompt in `win`. */
async function answer(win, key) {
  await until(() => promptOpen(win), "the y/N prompt is open");
  EventUtils.synthesizeKey(key, {}, win);
}

/** The rows of the picker `id` in `win`: [title, right cell]. */
function pickerRows(win, id) {
  return [...(win.document.getElementById(id)?.querySelectorAll(".vimma-picker-row") ?? [])].map(
    (r) => [
      r.querySelector(".vimma-picker-title").textContent,
      r.querySelector(".vimma-picker-host").textContent,
    ],
  );
}

/** Types into the fixture's field and submits its form. @param {XULBrowserElement} browser */
function submitForm(browser) {
  return SpecialPowers.spawn(browser, [], async () => {
    const field = content.document.getElementById("field");
    field.focus();
    field.setUserInput("vimma-secret");
    content.document.getElementById("submit").click();
  });
}

add_task(async function prefix_shift_p_opens_one_private_window_and_toggles_back() {
  Assert.equal(privateWindows().length, 0, "no private window yet");
  const priv = await openPrivate();
  Assert.ok(PrivateBrowsingUtils.isWindowPrivate(priv), "it is a private window");
  Assert.equal(privateWindows().length, 1, "exactly one");

  prefix("P", { shiftKey: true }, priv);
  await until(() => isActive(window), "again in private goes back to the normal window");

  // ctrl+shift+p is Vimma's now: it goes to the one private workspace, no second window.
  EventUtils.synthesizeKey("P", { ctrlKey: true, shiftKey: true });
  await until(() => isActive(priv), "ctrl+shift+p goes to the private workspace");
  Assert.equal(privateWindows().length, 1, "Firefox's New Private Window key did not run");
  EventUtils.synthesizeKey("P", { ctrlKey: true, shiftKey: true }, priv);
  await until(() => isActive(window), "ctrl+shift+p in private goes back");
  Assert.equal(privateWindows().length, 1, "still one private window");

  await runCommand("private");
  await until(() => isActive(priv), ":private goes there too");
  await BrowserTestUtils.openNewForegroundTab(priv.gBrowser, `${FORM}?first`);
  await runCommand("priv", priv);
  await until(() => isActive(window), ":priv in private goes back");
});

add_task(async function cycling_never_enters_private_and_leaves_to_the_ends() {
  const [priv] = privateWindows();
  const A = workspace("pw-a");
  const B = workspace("pw-b");
  const order = () => ww().model.workspaces.map((w) => w.id);
  const first = () => order()[0];
  const last = () => order().at(-1);
  Assert.equal(last(), B.id, "B is the last workspace");

  await SimpleTest.promiseFocus(window);
  ww().switchTo({ id: B.id });
  prefix(")", { shiftKey: true });
  await until(() => ww().model.active === first(), "ctrl+b ) from the last wraps to the first");
  Assert.ok(isActive(window), "and the normal window keeps focus, not private");
  ww().switchTo({ id: first() });
  prefix("(", { shiftKey: true });
  await until(() => ww().model.active === last(), "ctrl+b ( from the first wraps to the last");
  Assert.ok(isActive(window), "still the normal window");

  // In private, ) and ( leave to the first and the last normal workspace.
  ww().switchTo({ id: A.id });
  await SimpleTest.promiseFocus(priv);
  prefix(")", { shiftKey: true }, priv);
  await until(() => isActive(window), "ctrl+b ) in private leaves it");
  Assert.equal(ww().model.active, first(), "for the first workspace");
  await SimpleTest.promiseFocus(priv);
  prefix("(", { shiftKey: true }, priv);
  await until(() => isActive(window), "ctrl+b ( in private leaves it");
  Assert.equal(ww().model.active, last(), "for the last workspace");

  // ctrl+^ from private returns to the workspace left, in the window left.
  ww().switchTo({ id: A.id });
  prefix("P", { shiftKey: true });
  await until(() => isActive(priv), "to private from A");
  ww().switchTo({ id: B.id }); // the normal window moved on meanwhile (a script, a link)
  prefix("^", { shiftKey: true, code: "Digit6" }, priv);
  await until(() => isActive(window), "ctrl+b ^ in private goes back");
  Assert.equal(ww().model.active, A.id, "to A, the workspace left");

  // In the normal window ctrl+^ is the last normal workspace, never private.
  await focusContent(gBrowser.selectedBrowser); // the switch to A has settled
  prefix("^", { shiftKey: true, code: "Digit6" });
  await until(() => ww().model.active === B.id, "ctrl+b ^ toggles between normal workspaces");
  Assert.ok(isActive(window), "and never enters private");
  ww().switchTo({ id: main().id });
});

add_task(async function the_status_bar_and_side_panel_show_private() {
  const [priv] = privateWindows();
  await SimpleTest.promiseFocus(priv);
  await until(() => segText(priv, "workspace") === "◆ private", "the bar says ◆ private");
  const tab = await BrowserTestUtils.openNewForegroundTab(priv.gBrowser, `${FORM}?panel`);
  prefix("b", {}, priv);
  const panel = priv.document.getElementById(PANEL_ID);
  await until(() => panel && !panel.hidden, "ctrl+b b opens the side panel in private");
  Assert.equal(
    panel.querySelector(".vimma-panel-name").textContent,
    "private",
    "under a private head",
  );
  Assert.ok(
    panel.querySelector(`.vimma-panel-row[data-tab-id="${tab.linkedPanel}"]`),
    "listing the private window's tabs",
  );
  Assert.ok(
    panel.querySelector(".vimma-panel-neighbours").textContent ===
      `ctrl+b ( ${ww().model.workspaces.at(-1).name} · ctrl+b ) ${ww().model.workspaces[0].name}`,
    "its neighbours are the last and the first normal workspace",
  );
  EventUtils.synthesizeKey("KEY_Escape", {}, priv);
  await until(() => panel.hidden, "Esc closes it");
});

add_task(async function a_normal_window_never_shows_a_private_title_or_url() {
  const [priv] = privateWindows();
  const tabs = () => priv.gBrowser.tabs.length;
  await SimpleTest.promiseFocus(window);
  prefix("w");
  await until(() => pickerRows(window, PICKER_ID).length, "the workspace picker is open");
  const rows = pickerRows(window, PICKER_ID);
  Assert.deepEqual(
    rows.at(-1),
    ["◆ private", `${tabs()} tabs`],
    "its last row is the private workspace with a count",
  );
  EventUtils.synthesizeKey("KEY_Escape");

  prefix("g");
  await until(() => window.document.getElementById(GOTO_ID)?.open, "the goto picker is open");
  const goto = window.document.getElementById(GOTO_ID).textContent;
  Assert.ok(!goto.includes("vimma private page"), "the goto picker shows no private title");
  Assert.ok(!goto.includes("file_vimma_private_form"), "nor a private URL");
  EventUtils.synthesizeKey("KEY_Escape");

  prefix("b");
  const panel = document.getElementById(PANEL_ID);
  await until(() => panel && !panel.hidden, "the side panel is open");
  Assert.ok(!panel.textContent.includes("vimma private page"), "the side panel neither");
  EventUtils.synthesizeKey("KEY_Escape");
  await until(() => panel.hidden, "closed");

  // Enter on the private row goes there.
  prefix("w");
  await until(() => pickerRows(window, PICKER_ID).length, "the workspace picker is open");
  for (let i = 0; i < pickerRows(window, PICKER_ID).length; i++) EventUtils.synthesizeKey("j");
  EventUtils.synthesizeKey("KEY_Enter");
  await until(() => isActive(priv), "Enter on the private row goes to the private workspace");
});

add_task(async function a_tab_moves_in_after_y_and_never_out() {
  const [priv] = privateWindows();
  await runCommand("wsmove 1", priv);
  await until(
    () => noticeText(priv) === "a private tab cannot leave the private workspace",
    ":wsmove in private is refused",
  );
  prefix("w", {}, priv);
  await until(() => pickerRows(priv, PICKER_ID).length, "the picker opens in private");
  Assert.deepEqual(pickerRows(priv, PICKER_ID).at(-1)[0], "◆ private", "with the private row");
  EventUtils.synthesizeKey("k", {}, priv); // a normal row
  EventUtils.synthesizeKey("m", {}, priv);
  await until(
    () => noticeText(priv) === "a private tab cannot leave the private workspace",
    "m on a normal row from private is refused",
  );

  await SimpleTest.promiseFocus(window);
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, `${PAGE}&move`);
  const before = priv.gBrowser.tabs.length;
  prefix("w");
  await until(() => pickerRows(window, PICKER_ID).length, "the workspace picker is open");
  for (let i = 0; i < pickerRows(window, PICKER_ID).length; i++) EventUtils.synthesizeKey("j");
  EventUtils.synthesizeKey("m");
  await answer(window, "y");
  await until(() => priv.gBrowser.tabs.length === before + 1, "the tab reopens in private");
  await until(
    () => priv.gBrowser.selectedBrowser.currentURI.spec === `${PAGE}&move`,
    "with its URL, selected",
  );
  await until(() => !tab.isConnected, "and leaves the normal window");
});

add_task(async function vimma_ctl_state_withholds_private_urls_and_titles() {
  const [priv] = privateWindows();
  await SimpleTest.promiseFocus(priv);
  const result = VimmaControl._commands.state();
  Assert.equal(result.private, true, "private: true");
  Assert.equal(result.workspace, "private", "workspace: private");
  Assert.ok(result.tabs.length, "the tabs are listed");
  for (const tab of result.tabs) {
    Assert.strictEqual(tab.url, null, "no url");
    Assert.strictEqual(tab.title, null, "no title");
    Assert.equal(typeof tab.id, "string", "ids are kept");
  }
  const v = validateMessage(
    { type: "response", id: 1, ok: true, result },
    { kind: "response", command: "state" },
  );
  Assert.ok(v.valid, `the state follows the protocol: ${v.errors.join("; ")}`);
  await SimpleTest.promiseFocus(window);
  const normal = VimmaControl._commands.state();
  Assert.ok(!("private" in normal) || normal.private === false, "a normal window is not private");
  Assert.ok(
    normal.tabs.every((t) => typeof t.url === "string"),
    "and keeps its urls",
  );
});

add_task(async function nothing_private_reaches_the_normal_profile() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.download.always_ask_before_handling_new_types", false],
      ["browser.download.useDownloadDir", true],
      ["browser.download.folderList", 2],
      ["browser.download.dir", PathUtils.tempDir],
      ["browser.download.alwaysOpenPanel", false],
    ],
  });
  const [priv] = privateWindows();
  const normalValue = SessionStore.getCustomWindowValue(window, WINDOW_KEY);
  const definitions = JSON.stringify(WorkspaceStore.definitions);
  const publicDownloads = (await (await Downloads.getList(Downloads.PUBLIC)).getAll()).length;

  await SimpleTest.promiseFocus(priv);
  const tab = await BrowserTestUtils.openNewForegroundTab(priv.gBrowser, `${FORM}?leak`);
  const browser = tab.linkedBrowser;
  await SpecialPowers.spawn(browser, [], async () => {
    Assert.ok(content.document.cookie.includes("vimmaprivate=1"), "the page set its cookie");
    Assert.equal(content.localStorage.getItem("vimmaprivate"), "1", "and its storage");
  });
  // A form typed into and submitted.
  const submitted = BrowserTestUtils.browserLoaded(browser, false, (url) =>
    url.includes("vimmaprivatefield"),
  );
  await submitForm(browser);
  await submitted;
  // A download.
  const privateList = await Downloads.getList(Downloads.PRIVATE);
  const added = new Promise((resolve) => {
    const view = {
      onDownloadAdded(d) {
        privateList.removeView(view);
        resolve(d);
      },
    };
    privateList.addView(view);
  });
  await SpecialPowers.spawn(browser, [], () => content.document.getElementById("download").click());
  const download = await added;
  await download.whenSucceeded().catch(() => {});
  // A tab label.
  setTabLabel(tab, "vimma-private-label");
  Assert.equal(getTabLabel(tab), "vimma-private-label", "the label is set");

  Assert.ok(
    !(await PlacesUtils.history.hasVisits(`${FORM}?leak`)),
    "the private page is not in history",
  );
  Assert.equal(
    await FormHistory.count({ fieldname: "vimmaprivatefield" }),
    0,
    "no form history entry",
  );
  Assert.equal(
    (await (await Downloads.getList(Downloads.PUBLIC)).getAll()).length,
    publicDownloads,
    "the public downloads list is unchanged",
  );
  await SessionSaver.run();
  const saved = await IOUtils.readJSON(SessionFile.Paths.recovery, { decompress: true });
  Assert.ok(
    saved.windows.every((w) => !w.isPrivate),
    "the session file written by SessionSaver holds no private window",
  );
  Assert.ok(!JSON.stringify(saved).includes(MARK), "nor any private page");
  Assert.equal(
    SessionStore.getCustomWindowValue(window, WINDOW_KEY),
    normalValue,
    "the normal window's vimma-workspaces value is unchanged",
  );
  Assert.ok(!normalValue.includes("private"), "and does not name the private workspace");
  Assert.equal(
    JSON.stringify(WorkspaceStore.definitions),
    definitions,
    "vimma-workspaces.json's definitions are unchanged",
  );
  Assert.ok(!definitions.includes("private"), "and do not name it");
  await IOUtils.remove(download.target.path, { ignoreAbsent: true });

  // The control: the same steps in the normal window do reach history and form history, so
  // the checks above can fail.
  await SimpleTest.promiseFocus(window);
  const control = await BrowserTestUtils.openNewForegroundTab(gBrowser, `${FORM}?control`);
  const sent = BrowserTestUtils.browserLoaded(control.linkedBrowser, false, (url) =>
    url.includes("vimmaprivatefield"),
  );
  await submitForm(control.linkedBrowser);
  await sent;
  await until(
    async () => await PlacesUtils.history.hasVisits(`${FORM}?control`),
    "a normal page is in history",
  );
  await TestUtils.waitForCondition(
    async () => (await FormHistory.count({ fieldname: "vimmaprivatefield" })) > 0,
    "a normal form is in form history",
  );
  await FormHistory.update({ op: "remove", fieldname: "vimmaprivatefield" });
  await PlacesUtils.history.remove(`${FORM}?control`);
  BrowserTestUtils.removeTab(control);
  await SpecialPowers.popPrefEnv();
});

add_task(async function closing_discards_the_private_data() {
  const [priv] = privateWindows();
  Assert.equal(
    Services.cookies.getCookiesFromHost("example.com", { privateBrowsingId: 1 }).length > 0,
    true,
    "the private cookie is there",
  );
  const exited = TestUtils.topicObserved("last-pb-context-exited");
  const closed = BrowserTestUtils.domWindowClosed(priv);
  await SimpleTest.promiseFocus(priv);
  prefix("D", { shiftKey: true }, priv);
  await until(() => promptOpen(priv), "ctrl+b shift+d asks first");
  Assert.ok(
    /^Close the private workspace \(\d+ tabs?\)\? Its history, cookies and site data are discarded\. y\/N$/.test(
      promptText(priv),
    ),
    `it asks to close the private workspace and says what is discarded: ${promptText(priv)}`,
  );
  EventUtils.synthesizeKey("y", {}, priv);
  await closed;
  await exited;
  Assert.equal(privateWindows().length, 0, "every private window is closed");
  Assert.equal(
    Services.cookies.getCookiesFromHost("example.com", { privateBrowsingId: 1 }).length,
    0,
    "the private cookie is gone",
  );
  await SimpleTest.promiseFocus(window);
  await runCommand("private close");
  await until(
    () => noticeText(window) === "no private workspace is open",
    ":private close with none open says so",
  );
});

add_task(async function permanent_private_browsing_and_the_policy_refuse() {
  await SpecialPowers.pushPrefEnv({ set: [["browser.privatebrowsing.autostart", true]] });
  await SimpleTest.promiseFocus(window);
  prefix("P", { shiftKey: true });
  await until(
    () => noticeText(window) === "every window is private (permanent private browsing)",
    "permanent private browsing says so",
  );
  await SpecialPowers.popPrefEnv();
  Assert.equal(privateWindows().length, 0, "and opened nothing");

  const { EnterprisePolicyTesting } = ChromeUtils.importESModule(
    "resource://testing-common/EnterprisePolicyTesting.sys.mjs",
  );
  await EnterprisePolicyTesting.setupPolicyEngineWithJson({
    policies: { DisablePrivateBrowsing: true },
  });
  try {
    prefix("P", { shiftKey: true });
    await until(
      () => noticeText(window) === "private browsing is turned off by policy",
      "the policy says so",
    );
    Assert.equal(privateWindows().length, 0, "and opened nothing");
  } finally {
    await EnterprisePolicyTesting.setupPolicyEngineWithJson("");
    Services.prefs.unlockPref("browser.privatebrowsing.autostart");
    Services.prefs.clearUserPref("browser.privatebrowsing.autostart");
  }
});
