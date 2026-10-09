/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m0-app-version.md

"use strict";

const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");

/**
 * The Firefox version Vimma is built on. For a Firefox release the app version (version.txt)
 * and the Gecko version (config/milestone.txt) are the same string, so upstream bumps need no
 * test change.
 */
const FIREFOX_VERSION = Services.appinfo.platformVersion;

add_task(async function app_version_is_firefox_version() {
  Assert.equal(Services.appinfo.version, FIREFOX_VERSION, "Services.appinfo.version");
  Assert.equal(AppConstants.MOZ_APP_VERSION, FIREFOX_VERSION, "AppConstants.MOZ_APP_VERSION");
});

add_task(async function display_version_is_vimma_version() {
  const display = AppConstants.MOZ_APP_VERSION_DISPLAY;
  // surfer.json brands.vimma.release.displayVersion; plan §7: 0.x until M6.
  Assert.ok(/^0\.\d+\.\d+$/.test(display), `MOZ_APP_VERSION_DISPLAY ${display} is 0.x`);
  Assert.notEqual(display, Services.appinfo.version, "display version is not the Firefox version");
});

add_task(async function remote_settings_filters_see_firefox_version() {
  const { ClientEnvironmentBase } = ChromeUtils.importESModule(
    "resource://gre/modules/components-utils/ClientEnvironment.sys.mjs",
  );
  Assert.equal(ClientEnvironmentBase.version, FIREFOX_VERSION, "ClientEnvironment env.version");
});

add_task(async function targeting_sees_firefox_version() {
  const { TargetingContext } = ChromeUtils.importESModule(
    "resource://messaging-system/targeting/Targeting.sys.mjs",
  );
  const { ASRouterTargeting } = ChromeUtils.importESModule(
    "resource:///modules/asrouter/ASRouterTargeting.sys.mjs",
  );
  Assert.equal(
    await new TargetingContext().evalWithDefault("version"),
    FIREFOX_VERSION,
    "targeting version",
  );
  Assert.equal(
    ASRouterTargeting.Environment.firefoxVersion,
    parseInt(FIREFOX_VERSION, 10),
    "ASRouter firefoxVersion",
  );
});

add_task(async function webcompat_interventions_see_firefox_version() {
  await SpecialPowers.pushPrefEnv({ set: [["extensions.background.idle.timeout", 300000]] });
  const policy = WebExtensionPolicy.getByID("webcompat@mozilla.org");
  Assert.ok(policy, "webcompat add-on is installed");
  await policy.extension.promiseBackgroundStarted();
  // interventions.js parses this value to gate min_version / max_version.
  const seen = await SpecialPowers.spawn(policy.extension.backgroundContext.xulBrowser, [], () =>
    content.wrappedJSObject.browser.appConstants.getAppVersion(),
  );
  Assert.equal(seen, FIREFOX_VERSION, "webcompat getAppVersion()");
});

add_task(async function extensions_see_firefox_version() {
  const extension = ExtensionTestUtils.loadExtension({
    async background() {
      const info = await browser.runtime.getBrowserInfo();
      browser.test.sendMessage("info", info);
    },
  });
  await extension.startup();
  const info = await extension.awaitMessage("info");
  await extension.unload();
  Assert.equal(info.version, FIREFOX_VERSION, "runtime.getBrowserInfo().version");
});

add_task(async function about_dialog_shows_vimma_version() {
  const opened = BrowserTestUtils.domWindowOpenedAndLoaded(
    undefined,
    (win) => win.document.documentURI == "chrome://browser/content/aboutDialog.xhtml",
  );
  openAboutDialog();
  const dialog = await opened;
  try {
    const { args } = dialog.document.l10n.getAttributes(dialog.document.getElementById("version"));
    Assert.equal(args?.version, AppConstants.MOZ_APP_VERSION_DISPLAY, "About dialog version");
  } finally {
    await BrowserTestUtils.closeWindow(dialog);
  }
});
