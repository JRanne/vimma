/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/vimma-mcp.md, decision 42 (docs/security.md M24). A tab you did not open
// inside the agent workspace never takes its container: a link from another app (the remote
// command line, BrowserDOMWindow's external open, Firefox's container guess), a URL from the
// control socket, a new window's first tab, and the container cached for the next start. Such
// a link opens in the last workspace you used that is not the agent's, and a foreground open
// switches to it. What you open yourself inside the agent workspace (ctrl+t) stays there.

"use strict";

const { WorkspaceStore } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WorkspaceStore.sys.mjs",
);
const { WindowWorkspaces } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WindowWorkspaces.sys.mjs",
);
const { VimmaControl } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/ctl/VimmaControl.sys.mjs",
);
const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");

const LOGIN = "https://example.com/?login-token=secret";
const STARTUP_PREF = "vimma.workspaces.startupUserContextId";

const def = (/** @type {string} */ name) =>
  WorkspaceStore.definitions.workspaces.find((w) => w.name === name);
const agent = () => /** @type {any} */ (WorkspaceStore.agent);
const ww = (win = window) => WindowWorkspaces.get(win);
const activeName = (win = window) =>
  ww(win).model.workspaces.find((w) => w.id === ww(win).model.active).name;

/** @param {() => boolean} cond @param {string} msg */
const until = (cond, msg) => TestUtils.waitForCondition(cond, msg, 50, 100);

/** Resolves with the next tab opened in `win`. */
const nextTab = (win = window) =>
  BrowserTestUtils.waitForEvent(win.gBrowser.tabContainer, "TabOpen").then((e) => e.target);

/** The workspace used before the agent's: `oo-home`. */
let home;

add_task(async function setup() {
  home = WorkspaceStore.addWorkspace({ name: "oo-home", color: "green", icon: "tree" });
  registerCleanupFunction(async () => {
    ww().switchTo({ id: def("main").id });
    while (gBrowser.tabs.length > 1) BrowserTestUtils.removeTab(gBrowser.tabs.at(-1));
    await WorkspaceStore.deleteWorkspace(home.id, { confirmed: true });
  });
  Assert.ok(agent()?.userContextId > 0, "the agent workspace has its container");
});

/** Shows oo-home, then the agent workspace with one agent tab selected. */
async function inAgentAfterHome() {
  ww().switchTo({ id: home.id });
  await until(() => activeName() === "oo-home", "oo-home is shown");
  ww().switchTo({ id: agent().id });
  await until(() => activeName() === agent().name, "the agent workspace is shown");
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, "https://example.org/?agent");
  Assert.equal(tab.userContextId, agent().userContextId, "ctrl+t-like opens there stay there");
  return tab;
}

/** Closes every tab but the first, back to main. */
function tidy() {
  ww().switchTo({ id: def("main").id });
  while (gBrowser.tabs.length > 1) BrowserTestUtils.removeTab(gBrowser.tabs.at(-1));
}

/**
 * What nsCommandLine::Run does with a command line from another process: every
 * command-line-handler in the order of its category entry (as browser_vimma_workspace_routes).
 * @param {nsICommandLine} cmdLine
 */
function runHandlers(cmdLine) {
  const entries = [...Services.catMan.enumerateCategory("command-line-handler")].sort((a, b) =>
    a.entry < b.entry ? -1 : 1,
  );
  for (const { value } of entries) {
    try {
      Cc[value].getService(Ci.nsICommandLineHandler).handle(cmdLine);
    } catch (e) {
      if (e.result === Cr.NS_ERROR_ABORT) throw e;
    }
  }
}

add_task(async function an_external_link_opens_in_the_last_normal_workspace_and_switches() {
  await inAgentAfterHome();
  const opened = nextTab();
  const cmdLine = Cu.createCommandLine([LOGIN], null, Ci.nsICommandLine.STATE_REMOTE_AUTO);
  runHandlers(cmdLine);
  const tab = await opened;
  Assert.notEqual(tab.userContextId, agent().userContextId, "never the agent container");
  Assert.equal(tab.userContextId, home.userContextId, "the last workspace used: oo-home");
  await until(() => activeName() === "oo-home", "the foreground open switches to oo-home");
  Assert.equal(gBrowser.selectedTab, tab, "and shows the link");
  tidy();
});

add_task(async function browser_dom_window_external_opens_skip_the_agent_container() {
  const agentTab = await inAgentAfterHome();
  const system = Services.scriptSecurityManager.getSystemPrincipal();
  const { OPEN_NEWTAB, OPEN_CURRENTWINDOW, OPEN_EXTERNAL } = Ci.nsIBrowserDOMWindow;

  // Firefox's guess picks the container with the most tabs on the host: the agent's here.
  let opened = nextTab();
  window.browserDOMWindow.openURI(
    Services.io.newURI("https://example.org/?guessed"),
    null,
    OPEN_NEWTAB,
    OPEN_EXTERNAL,
    system,
  );
  let tab = await opened;
  Assert.notEqual(tab.userContextId, agent().userContextId, "a guess never picks the agent's");
  Assert.equal(tab.userContextId, home.userContextId, "it falls back to oo-home");

  // "Open links from other apps in the current tab": never into the selected agent tab.
  ww().switchTo({ id: agent().id });
  await until(() => gBrowser.selectedTab === agentTab, "the agent tab is selected again");
  opened = nextTab();
  window.browserDOMWindow.openURI(
    Services.io.newURI(LOGIN),
    null,
    OPEN_CURRENTWINDOW,
    OPEN_EXTERNAL,
    system,
  );
  tab = await opened;
  Assert.equal(tab.userContextId, home.userContextId, "a new tab in oo-home instead");
  Assert.equal(
    agentTab.linkedBrowser.currentURI.spec,
    "https://example.org/?agent",
    "the agent tab is left as it was",
  );
  tidy();
});

add_task(async function tabs_loaded_from_outside_skip_the_agent_container() {
  await inAgentAfterHome();
  // `vimma <url1> <url2>` starting a window: browser-init's loadTabs, marked fromExternal.
  const tabs = gBrowser.loadTabs(["https://example.com/?one", "https://example.net/?two"], {
    inBackground: true,
    fromExternal: true,
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  Assert.equal(tabs.length, 2, "two tabs");
  for (const tab of tabs) {
    Assert.equal(tab.userContextId, home.userContextId, "each in oo-home, never the agent's");
  }
  tidy();
});

add_task(async function a_control_socket_open_skips_the_agent_container() {
  const agentTab = await inAgentAfterHome();
  let opened = nextTab();
  VimmaControl._commands.open({ url: LOGIN });
  let tab = await opened;
  Assert.equal(tab.userContextId, home.userContextId, "`open`: a new tab in oo-home");

  ww().switchTo({ id: agent().id });
  await until(() => gBrowser.selectedTab === agentTab, "the agent tab is selected again");
  opened = nextTab();
  VimmaControl._commands.open({ url: LOGIN, where: "current" });
  tab = await opened;
  Assert.equal(tab.userContextId, home.userContextId, "`open` current: a new tab in oo-home");
  Assert.equal(
    agentTab.linkedBrowser.currentURI.spec,
    "https://example.org/?agent",
    "the agent tab is left as it was",
  );
  tidy();
});

add_task(async function a_new_windows_first_tab_and_the_startup_cache_skip_the_agent() {
  await inAgentAfterHome();
  Assert.notEqual(
    Services.prefs.getIntPref(STARTUP_PREF, 0),
    agent().userContextId,
    "the container cached for the next start is never the agent's",
  );
  const url = "https://example.net/?window";
  const opened = BrowserTestUtils.waitForNewWindow({ url });
  window.openDialog(AppConstants.BROWSER_CHROME_URL, "_blank", "chrome,all,dialog=no", url);
  const win = await opened;
  Assert.equal(
    win.gBrowser.selectedTab.userContextId,
    home.userContextId,
    "a window opened from the agent workspace starts in oo-home",
  );
  await BrowserTestUtils.closeWindow(win);
  tidy();
});

add_task(async function with_no_normal_workspace_used_yet_the_first_one_is_taken() {
  ww().switchTo({ id: agent().id });
  await until(() => activeName() === agent().name, "the agent workspace is shown");
  WorkspaceStore._forgetLastUserWorkspaceForTesting();
  Services.prefs.clearUserPref(STARTUP_PREF);
  const opened = nextTab();
  window.browserDOMWindow.openURI(
    Services.io.newURI(LOGIN),
    null,
    Ci.nsIBrowserDOMWindow.OPEN_NEWTAB,
    Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL,
    Services.scriptSecurityManager.getSystemPrincipal(),
  );
  const tab = await opened;
  Assert.equal(
    tab.userContextId,
    WorkspaceStore.definitions.workspaces[0].userContextId,
    "the first workspace in order",
  );
  Assert.notEqual(tab.userContextId, agent().userContextId, "never the agent's");
  tidy();
});
