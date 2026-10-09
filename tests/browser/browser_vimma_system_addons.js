/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m0-updater.md. System add-on updates do not ask Mozilla's update server
// (aus5.mozilla.org); add-on updates from AMO and OpenH264/Widevine (GMP) stay on. Prefs only,
// so this runs on artifact builds too; the app updater is in browser_vimma_updater.js.
//
// The harness profile turns system add-on updates off and points them at a local server
// (testing/profiles/unittest-required/user.js), so the network task clears those user values
// first: it tests the defaults Vimma ships, not what the harness forces.

"use strict";

/* global AUS_HOST, watchUpdateServer, settle -- from head_vimma_aus.js */
Services.scriptloader.loadSubScript(getRootDirectory(gTestPath) + "head_vimma_aus.js", this);

const { AddonManagerPrivate } = ChromeUtils.importESModule(
  "resource://gre/modules/AddonManager.sys.mjs",
);

const defaults = Services.prefs.getDefaultBranch("");

add_task(function system_addon_updates_are_off() {
  Assert.strictEqual(
    defaults.getBoolPref("extensions.systemAddon.update.enabled"),
    false,
    "extensions.systemAddon.update.enabled default",
  );
  Assert.strictEqual(
    defaults.getStringPref("extensions.systemAddon.update.url"),
    "",
    "extensions.systemAddon.update.url default",
  );
});

add_task(async function system_addon_check_makes_no_request() {
  await SpecialPowers.pushPrefEnv({
    clear: [["extensions.systemAddon.update.enabled"], ["extensions.systemAddon.update.url"]],
  });
  const watch = watchUpdateServer();
  try {
    // The add-on manager's daily check; it updates system add-ons when that is enabled. AMO
    // checks stay off here (the harness sets extensions.update.enabled false).
    await AddonManagerPrivate.backgroundUpdateCheck();
    await settle(1000);
  } finally {
    watch.stop();
    await SpecialPowers.popPrefEnv();
  }
  Assert.deepEqual(watch.seen, [], `no request to ${AUS_HOST}`);
});

add_task(function amo_addon_updates_are_kept() {
  Assert.strictEqual(defaults.getBoolPref("extensions.update.enabled"), true, "add-on updates on");
  Assert.strictEqual(
    defaults.getBoolPref("extensions.update.autoUpdateDefault"),
    true,
    "add-ons update automatically",
  );
  for (const [pref, host] of [
    ["extensions.update.url", "versioncheck.addons.mozilla.org"],
    ["extensions.update.background.url", "versioncheck-bg.addons.mozilla.org"],
  ]) {
    Assert.equal(Services.io.newURI(defaults.getStringPref(pref)).host, host, `${pref} is AMO's`);
  }
});

add_task(function gmp_updates_are_kept() {
  // OpenH264 (WebRTC calls) and Widevine (DRM video) are found through this endpoint; kept on
  // purpose (spec m0-updater, Services).
  const url = Services.io.newURI(defaults.getStringPref("media.gmp-manager.url"));
  Assert.equal(url.host, AUS_HOST, "media.gmp-manager.url is Mozilla's");
  Assert.ok(url.pathQueryRef.startsWith("/update/3/GMP/"), "and only its GMP endpoint");
});
