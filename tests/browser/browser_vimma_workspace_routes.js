/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/workspace-routing.md. `[[routes]]` rules send a URL to a workspace's
// container: from the URL bar and `:open`, a link a page opens in a new tab, a link from another
// app (the remote command line, with `-vimma-from <app>` from vimma-open), and a new window's
// first tab. A foreground open switches, a background one says where; same-tab navigation is
// never moved, only hinted; private windows are never routed.

"use strict";

/* global focusContent -- from head.js */

const { WorkspaceStore } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WorkspaceStore.sys.mjs",
);
const { WindowWorkspaces } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WindowWorkspaces.sys.mjs",
);
const { WorkspaceRouter } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WorkspaceRouter.sys.mjs",
);
const { resolveRoutes } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/core/routes.mjs",
);
const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");
const { ConfigHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/config/ConfigHost.sys.mjs",
);

const WORK = "https://example.com/";
const ELSEWHERE = "https://example.org/";
const NOTICE_ID = "vimma-notice";

const def = (/** @type {string} */ name) =>
  WorkspaceStore.definitions.workspaces.find((w) => w.name === name);
const ww = (win = window) => WindowWorkspaces.get(win);
const activeName = (win = window) =>
  ww(win).model.workspaces.find((w) => w.id === ww(win).model.active).name;
const noticeText = (win = window) => win.document.getElementById(NOTICE_ID)?.textContent ?? "";
/** Forgets the last notice's text (a hidden notice keeps it), so a check sees only new ones. */
const clearNotice = (win = window) => {
  const el = win.document.getElementById(NOTICE_ID);
  if (el) el.textContent = "";
};

/** @param {() => boolean} cond @param {string} msg */
const until = (cond, msg) => TestUtils.waitForCondition(cond, msg, 50, 100);

/** Resolves with the next tab opened in `win`. */
const nextTab = (win = window) =>
  BrowserTestUtils.waitForEvent(win.gBrowser.tabContainer, "TabOpen").then((e) => e.target);

/** @param {Record<string, string>[]} rules */
const route = (rules) => WorkspaceRouter.setRoutes(resolveRoutes(rules));

/** Two workspaces, `rt-work` (example.com) and `rt-home` (the rest), `rt-home` shown. */
let work;
let home;

add_task(async function setup() {
  work = WorkspaceStore.addWorkspace({ name: "rt-work", color: "blue", icon: "briefcase" });
  home = WorkspaceStore.addWorkspace({ name: "rt-home", color: "green", icon: "tree" });
  registerCleanupFunction(async () => {
    route([]);
    ww().switchTo({ id: def("main").id });
    for (const w of WorkspaceStore.definitions.workspaces.filter((d) => d.name !== "main")) {
      await WorkspaceStore.deleteWorkspace(w.id, { confirmed: true });
    }
    while (gBrowser.tabs.length > 1) BrowserTestUtils.removeTab(gBrowser.tabs.at(-1));
  });
  route([{ domain: "example.com", workspace: "rt-work" }]);
});

/** Shows rt-home with one page of `url` in it, selected and loaded. */
async function inHome(url = `${ELSEWHERE}?home`) {
  ww().switchTo({ id: home.id });
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);
  Assert.equal(tab.userContextId, home.userContextId, "the page is in rt-home");
  Assert.equal(activeName(), "rt-home", "rt-home is shown");
  clearNotice();
  return tab;
}

/** `:line` Enter, from the selected page in normal mode. */
async function runCommand(line) {
  const browser = gBrowser.selectedBrowser;
  await until(() => !browser.webProgress?.isLoadingDocument, "the selected page has loaded");
  await focusContent(browser);
  EventUtils.synthesizeKey(":", { shiftKey: true });
  EventUtils.sendString(line);
  EventUtils.synthesizeKey("KEY_Enter");
}

/** Closes every tab but the first, back to main. */
function tidy() {
  ww().switchTo({ id: def("main").id });
  while (gBrowser.tabs.length > 1) BrowserTestUtils.removeTab(gBrowser.tabs.at(-1));
}

add_task(async function the_url_bar_routes_to_the_rules_workspace_and_switches() {
  ww().switchTo({ id: home.id });
  let opened = nextTab();
  EventUtils.synthesizeKey("t", { accelKey: true });
  const blank = await opened;
  Assert.equal(blank.userContextId, home.userContextId, "ctrl+t: a new tab in rt-home");
  clearNotice();

  opened = nextTab();
  gURLBar.focus();
  gURLBar.value = `${WORK}?urlbar`;
  EventUtils.synthesizeKey("KEY_Enter");
  const routed = await opened;
  Assert.equal(routed.userContextId, work.userContextId, "the page opens in rt-work's container");
  await until(() => activeName() === "rt-work", "a foreground open switches to rt-work");
  Assert.equal(gBrowser.selectedTab, routed, "and shows the routed tab");
  Assert.ok(!routed.hidden, "never hidden on the way");
  Assert.ok(!noticeText().includes("opened in"), "a foreground open does not say 'opened in'");
  await until(() => !blank.isConnected, "the untouched new tab left behind is closed");
  tidy();
});

add_task(async function open_routes_but_keeps_a_page_that_is_not_blank() {
  const page = await inHome();
  const opened = nextTab();
  await runCommand(`open ${WORK}?open`);
  const routed = await opened;
  Assert.equal(routed.userContextId, work.userContextId, ":open goes to rt-work's container");
  await until(() => activeName() === "rt-work", "and switches to rt-work");
  Assert.ok(page.isConnected, "the page :open was typed on stays");
  Assert.equal(page.linkedBrowser.currentURI.spec, `${ELSEWHERE}?home`, "and was not navigated");
  tidy();
});

add_task(async function no_loop_when_the_rule_names_the_shown_workspace() {
  ww().switchTo({ id: work.id });
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, `${WORK}?first`);
  Assert.equal(tab.userContextId, work.userContextId, "a page in rt-work");
  const count = gBrowser.tabs.length;
  clearNotice();
  const loaded = BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, `${WORK}?again`);
  await runCommand(`open ${WORK}?again`);
  await loaded;
  Assert.equal(gBrowser.tabs.length, count, "no tab opens");
  Assert.equal(gBrowser.selectedTab, tab, "the same tab loads it");
  Assert.equal(activeName(), "rt-work", "the workspace stays");
  Assert.ok(!noticeText().includes("goes to"), "no hint");
  tidy();
});

add_task(async function a_link_opened_in_the_background_goes_there_and_says_so() {
  const page = await inHome();
  const principal = page.linkedBrowser.contentPrincipal;
  const opened = nextTab();
  // What a middle-click does (ClickHandlerParent): the page's principal and container.
  window.openLinkIn(`${WORK}?background`, "tab", {
    inBackground: true,
    triggeringPrincipal: principal,
    userContextId: page.userContextId,
  });
  const routed = await opened;
  Assert.equal(routed.userContextId, work.userContextId, "the link is in rt-work's container");
  await until(() => routed.hidden, "hidden: it is not in the workspace shown");
  Assert.equal(activeName(), "rt-home", "a background open never switches");
  Assert.equal(gBrowser.selectedTab, page, "the page stays selected");
  await until(() => noticeText() === 'opened in "rt-work"', "the notice says where it went");

  // A link to a site no rule names keeps the page's container.
  const plain = nextTab();
  window.openLinkIn(`${ELSEWHERE}?plain`, "tab", {
    inBackground: true,
    triggeringPrincipal: principal,
    userContextId: page.userContextId,
  });
  Assert.equal((await plain).userContextId, home.userContextId, "an unrouted link stays");

  // A container chosen on purpose ("Open in New Container Tab") is the user's choice.
  const chosen = nextTab();
  window.openTrustedLinkIn(`${WORK}?chosen`, "tab", {
    inBackground: true,
    userContextId: home.userContextId,
  });
  Assert.equal((await chosen).userContextId, home.userContextId, "an explicit container stays");
  tidy();
});

add_task(async function same_tab_navigation_is_never_moved_but_hinted() {
  const page = await inHome();
  const count = gBrowser.tabs.length;
  const loaded = BrowserTestUtils.browserLoaded(page.linkedBrowser, false, `${WORK}?nav`);
  await SpecialPowers.spawn(page.linkedBrowser, [`${WORK}?nav`], (url) => {
    content.location.href = url;
  });
  await loaded;
  Assert.equal(gBrowser.tabs.length, count, "no tab opens");
  Assert.equal(page.userContextId, home.userContextId, "the tab stays in rt-home's container");
  Assert.equal(activeName(), "rt-home", "and the workspace stays");
  await until(
    () => noticeText() === 'example.com goes to "rt-work" (route 1): :route move',
    "the status bar hints where the rule would put it",
  );

  const moved = nextTab();
  await runCommand("route move");
  const copy = await moved;
  Assert.equal(copy.userContextId, work.userContextId, ":route move reopens it in rt-work");
  await until(() => !page.isConnected, "and closes the original");
  tidy();
});

/**
 * What nsCommandLine::Run does with a command line from another process (not scriptable):
 * every command-line-handler in the order of its category entry (as browser_vimma_omarchy_hook).
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

/** `vimma <args>` while Vimma runs: the line the D-Bus remote hands over. */
async function remote(args) {
  const opened = nextTab();
  const cmdLine = Cu.createCommandLine(args, null, Ci.nsICommandLine.STATE_REMOTE_AUTO);
  runHandlers(cmdLine);
  const tab = await opened;
  return { tab, cmdLine };
}

add_task(async function an_external_link_routes_by_the_app_that_opened_it() {
  route([
    { app: "testapp", workspace: "rt-home" },
    { domain: "example.com", workspace: "rt-work" },
  ]);
  ww().switchTo({ id: def("main").id });

  // vimma-open: `vimma -vimma-from <app> <url>`; the app rule comes first in the file.
  const { tab: fromApp, cmdLine } = await remote(["-vimma-from", "TestApp", `${WORK}?app`]);
  Assert.equal(cmdLine.findFlag("vimma-from", false), -1, "the flag is consumed");
  Assert.equal(fromApp.userContextId, home.userContextId, "the app rule wins: rt-home");
  await until(() => activeName() === "rt-home", "a foreground external open switches");
  Assert.equal(WorkspaceRouter.app, null, "the app hint ends with the command line");

  // Without the flag (a terminal's `vimma <url>`): the domain rule.
  const { tab: plain } = await remote([`${WORK}?noapp`]);
  Assert.equal(plain.userContextId, work.userContextId, "the domain rule: rt-work");

  // A hint that is not a simple name is ignored: no app rule, and no domain rule for .org.
  ww().switchTo({ id: def("main").id });
  const { tab: bad } = await remote(["-vimma-from", "../../testapp", `${ELSEWHERE}?bad`]);
  Assert.equal(bad.userContextId, def("main").userContextId, "the workspace default");

  route([{ domain: "example.com", workspace: "rt-work" }]);
  tidy();
});

add_task(async function a_new_windows_first_tab_is_routed_with_the_startup_app() {
  route([
    { app: "coldapp", workspace: "rt-home" },
    { domain: "example.com", workspace: "rt-work" },
  ]);
  /** A window opened with one URL, as a cold start or an external window open does. */
  const openWindow = async (url) => {
    const opened = BrowserTestUtils.waitForNewWindow({ url });
    window.openDialog(AppConstants.BROWSER_CHROME_URL, "_blank", "chrome,all,dialog=no", url);
    return opened;
  };

  Services.env.set("VIMMA_FROM", "coldapp");
  WorkspaceRouter.resetStartupAppForTesting();
  const cold = await openWindow(`${ELSEWHERE}?cold`);
  Assert.equal(
    cold.gBrowser.selectedTab.userContextId,
    home.userContextId,
    "a cold start from the app: its rule (VIMMA_FROM)",
  );
  Assert.equal(cold.gBrowser.tabs.length, 1, "in the first tab, no second one");
  Assert.equal(Services.env.get("VIMMA_FROM"), "", "the variable is read once and cleared");
  await BrowserTestUtils.closeWindow(cold);

  const byDomain = await openWindow(`${WORK}?window`);
  Assert.equal(
    byDomain.gBrowser.selectedTab.userContextId,
    work.userContextId,
    "a window opened on a routed URL starts in that workspace",
  );
  await BrowserTestUtils.closeWindow(byDomain);
  route([{ domain: "example.com", workspace: "rt-work" }]);
});

add_task(async function private_windows_are_never_routed() {
  const priv = await BrowserTestUtils.openNewBrowserWindow({ private: true });
  const tabs = gBrowser.tabs.length;
  const opened = nextTab(priv);
  priv.openTrustedLinkIn(`${WORK}?private`, "tab");
  const tab = await opened;
  Assert.equal(tab.userContextId, 0, "the private tab has no container");
  Assert.equal(tab.ownerDocument.defaultView, priv, "and stays in the private window");
  Assert.equal(gBrowser.tabs.length, tabs, "nothing opens in the normal window");
  await BrowserTestUtils.closeWindow(priv);
});

add_task(async function route_add_writes_a_rule_and_route_lists_them() {
  const dir = await IOUtils.createUniqueDirectory(PathUtils.tempDir, "vimma-routes");
  const file = PathUtils.join(dir, "config.toml");
  await IOUtils.writeUTF8(file, "schema = 2\n");
  await SpecialPowers.pushPrefEnv({ set: [["vimma.config.path", file]] });
  await ConfigHost.reload();
  Assert.deepEqual(WorkspaceRouter.routes, [], "the file has no rules");

  await inHome(`${ELSEWHERE}?add`);
  await runCommand("route add rt-work");
  await until(() => WorkspaceRouter.routes.length === 1, "the rule is read at once");
  Assert.equal(
    await IOUtils.readUTF8(file),
    'schema = 2\n\n[[routes]]\ndomain = "example.org"\nworkspace = "rt-work"\n',
    "appended to config.toml",
  );
  await until(() => noticeText().includes("example.org"), "the notice says what was added");

  await runCommand("route add rt-home");
  await until(
    () => noticeText().includes('route 1 already sends example.org to "rt-work"'),
    "a host an earlier rule routes is refused, naming the rule",
  );

  const opened = nextTab();
  await runCommand("route");
  const about = await opened;
  await until(
    () => about.linkedBrowser.contentDocument?.documentElement.dataset.ready === "true",
    "about:vimma rendered",
  );
  const doc = about.linkedBrowser.contentDocument;
  Assert.ok(about.linkedBrowser.currentURI.spec.startsWith("about:vimma?tab="), "about:vimma");
  Assert.equal(doc.querySelectorAll("#routes tbody tr").length, 1, "one rule listed");
  Assert.ok(
    doc.getElementById("route-tab").textContent.includes("route 1"),
    "and which rule matches the tab :route was typed in",
  );

  await SpecialPowers.popPrefEnv();
  await ConfigHost.reload();
  await IOUtils.remove(dir, { recursive: true });
  route([{ domain: "example.com", workspace: "rt-work" }]);
  tidy();
});
