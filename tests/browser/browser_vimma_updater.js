/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m0-updater.md. Vimma has no app updater until M6 brings its own manifest, so
// nothing asks Mozilla's update server (aus5.mozilla.org) for a Firefox build, and the About
// dialog and Settings show no update UI (no button, no error). Skipped on artifact builds
// (browser.toml, ADR-010): they run Mozilla's libxul, which has the updater. System add-ons:
// browser_vimma_system_addons.js.
//
// The harness profile turns app updates off for tests (app.update.disabledForTesting,
// app.update.checkInstallTime in testing/profiles/*/user.js), so the tasks undo that first: they
// test what Vimma ships, not what the harness forces.

"use strict";

/* global AUS_HOST, watchUpdateServer, settle -- from head_vimma_aus.js */
Services.scriptloader.loadSubScript(getRootDirectory(gTestPath) + "head_vimma_aus.js", this);

const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");

add_task(function updater_is_not_built() {
  Assert.strictEqual(AppConstants.MOZ_UPDATER, false, "built without the app updater");
  Assert.strictEqual(Services.appinfo.updateURL, "", "application.ini has no [AppUpdate] URL");
});

/**
 * The URL the app update service would ask, or null when it has none or does not exist. A
 * check itself cannot be driven here: it first waits for any other running instance of the app
 * (waitForOtherInstances), which a developer's own browser makes nondeterministic.
 */
async function appUpdateURL() {
  if (!Ci.nsIUpdateChecker || !("@mozilla.org/updates/update-checker;1" in Cc)) {
    return null;
  }
  try {
    const checker = Cc["@mozilla.org/updates/update-checker;1"].getService(Ci.nsIUpdateChecker);
    return await checker.getUpdateURL(Ci.nsIUpdateChecker.BACKGROUND_CHECK);
  } catch (e) {
    info(`update checker unavailable: ${e}`);
    return null;
  }
}

add_task(async function app_update_service_has_no_url() {
  await SpecialPowers.pushPrefEnv({ set: [["app.update.disabledForTesting", false]] });
  try {
    Assert.equal(await appUpdateURL(), null, "the update service has no URL to check");
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function old_build_check_makes_no_request() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["app.update.disabledForTesting", false],
      ["app.update.checkInstallTime", true],
      ["app.update.checkInstallTime.days", 0],
    ],
  });
  const watch = watchUpdateServer();
  try {
    // BrowserGlue's old-build check (a background update check when the build is older than
    // app.update.checkInstallTime.days).
    Cc["@mozilla.org/browser/browserglue;1"]
      .getService()
      .wrappedJSObject._checkForOldBuildUpdates();

    // Let a background check started above reach the network (it may first wait for another
    // running instance; app_update_service_has_no_url is the deterministic check).
    await settle(1000);
  } finally {
    watch.stop();
    await SpecialPowers.popPrefEnv();
  }
  Assert.deepEqual(watch.seen, [], `no request to ${AUS_HOST}`);
});

const ERROR_PANELS = [
  "checkingFailed",
  "downloadFailed",
  "internalError",
  "policyDisabled",
  "unsupportedSystem",
];

add_task(async function about_dialog_shows_no_update_ui() {
  await SpecialPowers.pushPrefEnv({ set: [["app.update.disabledForTesting", false]] });
  const watch = watchUpdateServer();
  const opened = BrowserTestUtils.domWindowOpenedAndLoaded(
    undefined,
    (win) => win.document.documentURI == "chrome://browser/content/aboutDialog.xhtml",
  );
  openAboutDialog();
  const dialog = await opened;
  try {
    const doc = dialog.document;
    const deck = doc.getElementById("updateDeck");
    Assert.equal(deck, null, `no update panel (shown: ${deck?.selectedPanel?.id})`);
    Assert.equal(doc.getElementById("checkForUpdatesButton"), null, "no check-for-updates button");
    for (const id of ERROR_PANELS) {
      const panel = doc.getElementById(id);
      Assert.ok(!panel || !BrowserTestUtils.isVisible(panel), `no ${id} message`);
    }
    Assert.ok(BrowserTestUtils.isVisible(doc.getElementById("version")), "version shown");
  } finally {
    await BrowserTestUtils.closeWindow(dialog);
    watch.stop();
    await SpecialPowers.popPrefEnv();
  }
  Assert.deepEqual(watch.seen, [], `About dialog made no request to ${AUS_HOST}`);
});

add_task(async function settings_show_no_update_ui() {
  await SpecialPowers.pushPrefEnv({ set: [["app.update.disabledForTesting", false]] });
  const watch = watchUpdateServer();
  try {
    await BrowserTestUtils.withNewTab("about:preferences#general", async (browser) => {
      const doc = browser.contentDocument;
      const group = await TestUtils.waitForCondition(
        () => doc.querySelector('setting-group[groupid="updates"]'),
        "updates group rendered",
      );
      // Wait for the group's controls, whichever of the two branches it shows. A setting whose
      // `visible` callback is false renders as a hidden setting-control.
      const shown = (id) => {
        const el = doc.getElementById(`setting-control-${id}`);
        return !!el && !el.hidden;
      };
      await TestUtils.waitForCondition(
        () => shown("updatesManagedByOS") || shown("updateApp"),
        "updates group populated",
      );
      Assert.ok(group, "updates group present");
      Assert.ok(!shown("updateApp"), "no update status or check-for-updates button");
      Assert.ok(!shown("installationFieldset"), "no automatic-update choice");
    });
  } finally {
    watch.stop();
    await SpecialPowers.popPrefEnv();
  }
  Assert.deepEqual(watch.seen, [], `Settings made no request to ${AUS_HOST}`);
});
