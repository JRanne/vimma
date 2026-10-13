/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/vimma-mcp.md decision 30 (user, 2026-10-13): pages in the agent workspace's
// container ask for no permission and open no pop-up. Every nsIContentPermissionPrompt request
// from the agent container is cancelled (Integration.contentPermission); camera, microphone and
// screen are denied by a session DENY on each origin that loads there (WebRTCParent and
// MediaManager read it); every agent tab's browsing context has SANDBOXED_AUXILIARY_NAVIGATION.
// A tab of another workspace still asks and still opens pop-ups.

"use strict";

/* global PopupNotifications -- the browser window's (browser.js) */

const { BrowserWindowTracker } = ChromeUtils.importESModule(
  "resource:///modules/BrowserWindowTracker.sys.mjs",
);
const { WorkspaceStore } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/workspaces/WorkspaceStore.sys.mjs",
);

const DIR = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com",
);
const PAGE = `${DIR}file_vimma_agent_page.html`;
const SANDBOXED_AUXILIARY_NAVIGATION = 0x2;

add_task(async function setup() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["media.navigator.streams.fake", true],
      // Fake devices skip the permission check unless this is set (MediaManager, askPermission).
      ["media.navigator.permission.fake", true],
      // No loopback devices, so only the fakes are there (browser/base/content/test/webrtc).
      ["media.audio_loopback_dev", ""],
      ["media.video_loopback_dev", ""],
      ["media.navigator.permission.disabled", false],
      ["geo.provider.testing", true],
      ["dom.disable_open_during_load", true],
    ],
  });
  registerCleanupFunction(() => Services.perms.removeAll());
});

/** A tab in `userContextId`, loaded with `url`. */
async function tabIn(userContextId, url = PAGE) {
  const tab = gBrowser.addTab(url, {
    userContextId,
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, url);
  return tab;
}

/** What a page gets when it asks for each permission, without a user answering. */
function ask(browser) {
  return SpecialPowers.spawn(browser, [], async () => {
    const settle = (/** @type {Promise<string>} */ p) =>
      Promise.race([p, new Promise((r) => content.setTimeout(() => r("pending"), 1500))]);
    const geo = await settle(
      new Promise((resolve) =>
        content.navigator.geolocation.getCurrentPosition(
          () => resolve("allowed"),
          (e) => resolve(e.code === e.PERMISSION_DENIED ? "denied" : `error ${e.code}`),
        ),
      ),
    );
    // From the page's own script: SpecialPowers' sandbox is privileged, and MediaManager does
    // not ask a privileged caller.
    const fromPage = (/** @type {string} */ constraints) =>
      settle(
        new Promise((resolve) => {
          const key = `gum${Math.random()}`.replace(".", "");
          const script = content.document.createElement("script");
          script.textContent =
            `navigator.mediaDevices.getUserMedia(${constraints}).then(` +
            `() => (document.body.dataset.${key} = "allowed"),` +
            `(e) => (document.body.dataset.${key} = e.name === "NotAllowedError" ? "denied" : e.name));`;
          content.document.body.append(script);
          const poll = () => {
            const v = content.document.body.dataset[key];
            if (v) resolve(v);
            else content.setTimeout(poll, 50);
          };
          poll();
        }),
      );
    const camera = await fromPage("{ video: true }");
    const microphone = await fromPage("{ audio: true }");
    content.document.notifyUserGestureActivation();
    // A cancelled request leaves the permission at "default": nothing granted, no prompt.
    const notification = await settle(content.Notification.requestPermission());
    const storage = await settle(
      content.navigator.storage.persist().then((ok) => (ok ? "allowed" : "denied")),
    );
    return { geo, camera, microphone, notification, storage };
  });
}

add_task(async function test_the_agent_container_asks_for_nothing() {
  const agent = /** @type {any} */ (WorkspaceStore.agent);
  const tab = await tabIn(agent.userContextId);
  const shown = [];
  const onShown = (/** @type {Event} */ e) => shown.push(/** @type {any} */ (e.target).id);
  PopupNotifications.panel.addEventListener("popupshowing", onShown);
  const got = await ask(tab.linkedBrowser);
  PopupNotifications.panel.removeEventListener("popupshowing", onShown);
  Assert.deepEqual(
    got,
    {
      geo: "denied",
      camera: "denied",
      microphone: "denied",
      notification: "default",
      storage: "denied",
    },
    "every permission an agent page asks for is refused",
  );
  for (const id of [
    "geolocation",
    "webRTC-shareDevices",
    "web-notifications",
    "persistent-storage",
  ]) {
    Assert.equal(
      PopupNotifications.getNotification(id, tab.linkedBrowser),
      null,
      `no ${id} prompt waits on the agent tab`,
    );
  }
  Assert.deepEqual(shown, [], "and no prompt was shown");
  const principal = tab.linkedBrowser.contentPrincipal;
  Assert.equal(
    Services.perms.getForBrowser(principal, "camera", tab.linkedBrowser.browserId)?.capability,
    Services.perms.DENY_ACTION,
    "camera is denied for the agent tab",
  );
  for (const type of ["camera", "geo", "desktop-notification"]) {
    Assert.equal(
      Services.perms.testExactPermissionFromPrincipal(principal, type),
      Services.perms.UNKNOWN_ACTION,
      `no ${type} permission for the origin itself: permissions are shared across containers`,
    );
  }
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_another_workspace_still_asks() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE);
  const prompt = BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
  SpecialPowers.spawn(tab.linkedBrowser, [], () => {
    content.navigator.geolocation.getCurrentPosition(
      () => {},
      () => {},
    );
  });
  await prompt;
  Assert.ok(
    PopupNotifications.getNotification("geolocation", tab.linkedBrowser),
    "a main tab's geolocation request shows Firefox's prompt",
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_agent_tabs_open_no_popups() {
  const agent = /** @type {any} */ (WorkspaceStore.agent);
  const tab = await tabIn(agent.userContextId);
  Assert.ok(
    tab.linkedBrowser.browsingContext.sandboxFlags & SANDBOXED_AUXILIARY_NAVIGATION,
    "the agent tab's browsing context is sandboxed against new windows",
  );
  const before = gBrowser.tabs.length;
  const windows = BrowserWindowTracker.windowCount;
  const opened = await SpecialPowers.spawn(tab.linkedBrowser, [], () => {
    content.document.notifyUserGestureActivation();
    // A sandboxed context's window.open throws InvalidAccessError, or gives null.
    let w = null;
    try {
      w = content.open("https://example.com/", "_blank");
    } catch (e) {
      if (e.name !== "InvalidAccessError") throw e;
    }
    const a = content.document.createElement("a");
    a.href = "https://example.org/";
    a.target = "_blank";
    content.document.body.append(a);
    a.click();
    return w !== null;
  });
  await new Promise((r) => setTimeout(r, 500));
  Assert.ok(!opened, "window.open gives nothing, even after a click");
  Assert.equal(gBrowser.tabs.length, before, "no tab opened");
  Assert.equal(BrowserWindowTracker.windowCount, windows, "no window opened");

  // Its browsing context keeps the flag across a navigation to another site.
  const other = "https://example.org/browser/";
  BrowserTestUtils.startLoadingURIString(tab.linkedBrowser, other);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  Assert.ok(
    tab.linkedBrowser.browsingContext.sandboxFlags & SANDBOXED_AUXILIARY_NAVIGATION,
    "after a cross-site navigation too",
  );
  BrowserTestUtils.removeTab(tab);

  const mine = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE);
  Assert.ok(
    !(mine.linkedBrowser.browsingContext.sandboxFlags & SANDBOXED_AUXILIARY_NAVIGATION),
    "a main tab is not sandboxed",
  );
  const newTab = BrowserTestUtils.waitForNewTab(gBrowser, "https://example.com/");
  await SpecialPowers.spawn(mine.linkedBrowser, [], () => {
    content.document.notifyUserGestureActivation();
    content.open("https://example.com/", "_blank");
  });
  BrowserTestUtils.removeTab(await newTab);
  BrowserTestUtils.removeTab(mine);
});

// Review of #177 (M1), user decision 2026-10-13: "Per workspace". Site permissions are kept per
// container (permissions.isolateBy.userContext), so an ALLOW given in the default container or
// in `work` never reaches the agent workspace, and `work`'s own ALLOW still works in `work`.
add_task(async function test_site_permissions_are_per_workspace() {
  Assert.equal(
    Services.prefs.getDefaultBranch("").getBoolPref("permissions.isolateBy.userContext", false),
    true,
    "Vimma's default: permissions are isolated by container",
  );
  const { ContextualIdentityService } = ChromeUtils.importESModule(
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs",
  );
  const work = ContextualIdentityService.create("vimma-test-work", "briefcase", "blue");
  registerCleanupFunction(() => ContextualIdentityService.remove(work.userContextId));
  const uri = Services.io.newURI(PAGE);
  for (const userContextId of [0, work.userContextId]) {
    const principal = Services.scriptSecurityManager.createContentPrincipal(uri, { userContextId });
    for (const type of ["geo", "camera"]) {
      Services.perms.addFromPrincipal(principal, type, Services.perms.ALLOW_ACTION);
    }
  }
  const agent = /** @type {any} */ (WorkspaceStore.agent);
  const agentTab = await tabIn(agent.userContextId);
  const there = await ask(agentTab.linkedBrowser);
  Assert.equal(there.geo, "denied", "the default and work ALLOWs do not reach an agent tab");
  Assert.equal(there.camera, "denied", "nor its camera");
  BrowserTestUtils.removeTab(agentTab);

  // work's own ALLOW stays work's: read with each container's principal.
  const of = (/** @type {number} */ userContextId) =>
    Services.perms.testPermissionFromPrincipal(
      Services.scriptSecurityManager.createContentPrincipal(uri, { userContextId }),
      "geo",
    );
  Assert.equal(of(work.userContextId), Services.perms.ALLOW_ACTION, "work keeps its ALLOW");
  Assert.equal(of(0), Services.perms.ALLOW_ACTION, "so does the default container");
  Assert.equal(of(agent.userContextId), Services.perms.UNKNOWN_ACTION, "the agent has none");
  Services.perms.removeAll();
});

// Review of #177 (L1): a document a service worker serves has no HTTP response, so the camera
// deny is set when its window global is created, whatever served it.
add_task(async function test_a_page_from_a_service_worker_is_denied_too() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["dom.serviceWorkers.enabled", true],
      ["dom.serviceWorkers.testing.enabled", true],
    ],
  });
  const agent = /** @type {any} */ (WorkspaceStore.agent);
  const tab = await tabIn(agent.userContextId, `${DIR}file_vimma_agent_sw.html`);
  await TestUtils.waitForCondition(
    () => tab.linkedBrowser.contentTitle === "sw ready",
    "the worker is ready",
  );
  const browserId = tab.linkedBrowser.browserId;
  const principal = tab.linkedBrowser.contentPrincipal;
  for (const type of ["camera", "microphone", "screen", "speaker"]) {
    Services.perms.removeFromPrincipalForBrowser(principal, type, browserId);
  }
  Assert.equal(
    Services.perms.getForBrowser(principal, "camera", browserId),
    null,
    "sanity: no deny before the worker's page",
  );
  const page = `${DIR}file_vimma_agent_sw_page.html`;
  BrowserTestUtils.startLoadingURIString(tab.linkedBrowser, page);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, page);
  Assert.equal(tab.linkedBrowser.contentTitle, "from the worker", "the worker served it");
  Assert.equal(
    Services.perms.getForBrowser(principal, "camera", browserId)?.capability,
    Services.perms.DENY_ACTION,
    "the worker's page is denied the camera",
  );
  const got = await ask(tab.linkedBrowser);
  Assert.equal(got.camera, "denied", "and its getUserMedia is refused");
  await SpecialPowers.spawn(tab.linkedBrowser, [], async () => {
    for (const r of await content.navigator.serviceWorker.getRegistrations()) await r.unregister();
  });
  BrowserTestUtils.removeTab(tab);
});

// Review of #177 (L2): a document keeps the sandbox flags it loaded with. When the agent
// workspace changes (a sweep), an agent tab that loaded without the flag is reloaded, so the
// flag applies to the page in it, not only to its next navigation.
add_task(async function test_a_sweep_reloads_agent_tabs_that_loaded_unsandboxed() {
  const agent = /** @type {any} */ (WorkspaceStore.agent);
  const tab = await tabIn(agent.userContextId);
  const bc = tab.linkedBrowser.browsingContext;
  bc.sandboxFlags &= ~SANDBOXED_AUXILIARY_NAVIGATION;
  BrowserTestUtils.reloadTab(tab);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  // The document's own flags (Document.sandboxFlagsAsString lists what it may still do; null
  // for none): whether the page in the tab may open windows.
  const opens = () =>
    SpecialPowers.spawn(tab.linkedBrowser, [], () => {
      const flags = content.document.sandboxFlagsAsString;
      return flags === null || flags.split(" ").includes("allow-popups");
    });
  Assert.ok(await opens(), "sanity: a page loaded without the flag may open windows");

  const reloaded = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  Services.obs.notifyObservers(null, "vimma-mcp-changed");
  await reloaded;
  Assert.ok(
    tab.linkedBrowser.browsingContext.sandboxFlags & SANDBOXED_AUXILIARY_NAVIGATION,
    "the sweep set the flag",
  );
  Assert.ok(!(await opens()), "and reloaded the page, which now opens none");
  BrowserTestUtils.removeTab(tab);
});

// Review of #177 (L3): an agent page cannot launch another app through an external protocol
// (zoommtg:, mailto: …; Firefox's "always open" choice is shared across containers), and until
// sub-PR 2c every download from the agent container is blocked.
add_task(async function test_agent_pages_launch_no_app_and_download_nothing() {
  const { AgentPages } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/ctl/AgentPages.sys.mjs",
  );
  /** @type {string[]} */
  const launched = [];
  AgentPages._chooserForTests = {
    QueryInterface: ChromeUtils.generateQI(["nsIContentDispatchChooser"]),
    handleURI(_handler, uri) {
      launched.push(uri.spec);
    },
  };
  registerCleanupFunction(() => (AgentPages._chooserForTests = null));
  // A known protocol (a web handler for vimmatest:), so a load of it reaches the chooser.
  const handlerSvc = Cc["@mozilla.org/uriloader/handler-service;1"].getService(
    Ci.nsIHandlerService,
  );
  const info = Cc["@mozilla.org/uriloader/external-protocol-service;1"]
    .getService(Ci.nsIExternalProtocolService)
    .getProtocolHandlerInfo("vimmatest");
  const web = Cc["@mozilla.org/uriloader/web-handler-app;1"].createInstance(Ci.nsIWebHandlerApp);
  web.name = "vimma test";
  web.uriTemplate = "https://example.com/vimmatest/%s";
  info.possibleApplicationHandlers.appendElement(web);
  handlerSvc.store(info);
  registerCleanupFunction(() => handlerSvc.remove(info));
  const agent = /** @type {any} */ (WorkspaceStore.agent);
  const agentTab = await tabIn(agent.userContextId);
  await SpecialPowers.spawn(agentTab.linkedBrowser, [], () => {
    content.document.notifyUserGestureActivation();
    content.location.href = "vimmatest:from-agent";
  });
  const mine = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE);
  await SpecialPowers.spawn(mine.linkedBrowser, [], () => {
    content.document.notifyUserGestureActivation();
    content.location.href = "vimmatest:from-main";
  });
  await TestUtils.waitForCondition(() => launched.length > 0, "main's launch reached Firefox");
  await new Promise((r) => setTimeout(r, 300));
  Assert.deepEqual(launched, ["vimmatest:from-main"], "the agent page launched nothing");
  BrowserTestUtils.removeTab(mine);

  const dir = await IOUtils.createUniqueDirectory(PathUtils.tempDir, "vimma-dl");
  registerCleanupFunction(() => IOUtils.remove(dir, { recursive: true }));
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.download.always_ask_before_handling_new_types", false],
      ["browser.download.useDownloadDir", true],
      ["browser.download.folderList", 2],
      ["browser.download.dir", dir],
      ["browser.download.start_downloads_in_tmp_dir", false],
    ],
  });
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const list = await Downloads.getList(Downloads.ALL);
  const added = new Promise((resolve) => {
    const view = {
      onDownloadAdded(d) {
        list.removeView(view);
        resolve(d);
      },
    };
    list.addView(view);
  });
  BrowserTestUtils.startLoadingURIString(
    agentTab.linkedBrowser,
    `${DIR}file_vimma_agent_download.sjs`,
  );
  // Forbidden before it starts (the sandbox), or failing as blocked (the integration hook):
  // either way it never succeeds and leaves no file.
  const download = await Promise.race([added, new Promise((r) => setTimeout(r, 3000))]);
  if (download) {
    await TestUtils.waitForCondition(() => download.stopped, "the download stopped");
    Assert.ok(!download.succeeded, "a download from the agent container does not succeed");
  }
  Assert.deepEqual(await IOUtils.getChildren(dir), [], "and nothing is written");
  // A download made another way (not a page's navigation) is blocked by Firefox's own hook.
  const { Integration } = ChromeUtils.importESModule("resource://gre/modules/Integration.sys.mjs");
  const { DownloadIntegration } = ChromeUtils.importESModule(
    "resource://gre/modules/DownloadIntegration.sys.mjs",
  );
  const combined = Integration.downloads.getCombined(DownloadIntegration);
  Assert.ok(
    await combined.shouldBlockForParentalControls({
      source: { userContextId: agent.userContextId },
    }),
    "any download from the agent container is blocked",
  );
  await list.removeFinished();
  BrowserTestUtils.removeTab(agentTab);
});
