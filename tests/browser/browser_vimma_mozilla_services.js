/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m0-mozilla-services.md

"use strict";

const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");

/**
 * The harness profile gives several of these prefs user values (testing/profiles/*\/user.js), so
 * we read the default branch: that is what Vimma ships.
 */
const defaults = Services.prefs.getDefaultBranch("");
const AS = "browser.newtabpage.activity-stream.";

/** @type {Array<[string, boolean]>} */
const OFF_BOOL_PREFS = [
  ["app.normandy.enabled", false],
  ["app.shield.optoutstudies.enabled", false],
  ["nimbus.rollouts.enabled", false],
  ["datareporting.healthreport.uploadEnabled", false],
  ["datareporting.usage.uploadEnabled", false],
  ["datareporting.policy.dataSubmissionEnabled", false],
  ["browser.tabs.crashReporting.sendReport", false],
  ["browser.crashReports.unsubmittedCheck.enabled", false],
  ["browser.crashReports.unsubmittedCheck.autoSubmit2", false],
  [`${AS}showSponsored`, false],
  [`${AS}system.showSponsored`, false],
  [`${AS}showSponsoredTopSites`, false],
  [`${AS}feeds.section.topstories`, false],
  ["browser.topsites.contile.enabled", false],
  [`${AS}asrouter.userprefs.cfr.addons`, false],
  [`${AS}asrouter.userprefs.cfr.features`, false],
  ["browser.vpn_promo.enabled", false],
  ["browser.preferences.moreFromMozilla", false],
];

/** Security-critical services that must keep Firefox's defaults. */
const KEPT_BOOL_PREFS = [
  "security.remote_settings.crlite_filters.enabled",
  "extensions.blocklist.enabled",
  "browser.safebrowsing.phishing.enabled",
  "browser.safebrowsing.malware.enabled",
  "identity.fxaccounts.enabled",
  "extensions.update.enabled",
];

/**
 * @param {string} name
 * @returns {boolean | undefined}
 */
function defaultBool(name) {
  return Services.prefs.prefHasDefaultValue(name) ? defaults.getBoolPref(name) : undefined;
}

add_task(function test_studies_crash_and_sponsored_defaults_are_off() {
  for (const [name, expected] of OFF_BOOL_PREFS) {
    Assert.strictEqual(defaultBool(name), expected, `default ${name} is ${expected}`);
  }
  Assert.strictEqual(
    defaults.getStringPref("app.normandy.api_url", "unset"),
    "",
    "no Normandy URL",
  );

  const cfr = JSON.parse(defaults.getStringPref(`${AS}asrouter.providers.cfr`, "null"));
  Assert.equal(cfr?.id, "cfr", "the cfr provider is still declared");
  Assert.strictEqual(cfr?.enabled, false, "the remote cfr message provider is disabled");
});

add_task(function test_no_sponsored_address_bar_suggestions() {
  // Firefox Suggest rewrites this pref's default per region at startup (QuickSuggest.sys.mjs), so
  // Vimma sets it on the user branch, once, unless the user already chose.
  const SPONSORED = "browser.urlbar.suggest.quicksuggest.sponsored";
  const hadUserValue = Services.prefs.prefHasUserValue(SPONSORED);
  const userValue = Services.prefs.getBoolPref(SPONSORED);
  registerCleanupFunction(() => {
    if (hadUserValue) {
      Services.prefs.setBoolPref(SPONSORED, userValue);
    } else {
      Services.prefs.clearUserPref(SPONSORED);
    }
  });
  Assert.strictEqual(
    Services.prefs.getBoolPref(SPONSORED),
    false,
    "sponsored Suggest results are off",
  );

  const { MozillaServices } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/services/MozillaServices.sys.mjs",
  );
  Services.prefs.setBoolPref(SPONSORED, true);
  MozillaServices.applyUserDefaults();
  Assert.strictEqual(Services.prefs.getBoolPref(SPONSORED), true, "the user's choice is kept");

  Services.prefs.clearUserPref(SPONSORED);
  MozillaServices.applyUserDefaults();
  Assert.strictEqual(Services.prefs.getBoolPref(SPONSORED), false, "applied again when unset");
});

add_task(async function test_normandy_and_nimbus_do_not_run() {
  const { RecipeRunner } = ChromeUtils.importESModule(
    "resource://normandy/lib/RecipeRunner.sys.mjs",
  );
  // Normandy initialises RecipeRunner after the UI is available; wait for its verdict.
  await TestUtils.waitForCondition(
    () => RecipeRunner.enabled !== null,
    "RecipeRunner has checked its prefs",
  );
  Assert.strictEqual(RecipeRunner.enabled, false, "Normandy's recipe runner is disabled");

  const { ExperimentAPI } = ChromeUtils.importESModule("resource://nimbus/ExperimentAPI.sys.mjs");
  Assert.strictEqual(ExperimentAPI.studiesEnabled, false, "Nimbus studies are disabled");
  Assert.strictEqual(ExperimentAPI.rolloutsEnabled, false, "Nimbus rollouts are disabled");
});

add_task(function test_no_crash_reporter() {
  Assert.strictEqual(AppConstants.MOZ_CRASHREPORTER, false, "built without the crash reporter");
});

add_task(function test_security_services_stay_on() {
  for (const name of KEPT_BOOL_PREFS) {
    Assert.strictEqual(defaultBool(name), true, `default ${name} is still true`);
  }
  Assert.ok(
    !Services.prefs.prefHasDefaultValue("services.settings.server"),
    "no default overrides the Remote Settings server",
  );
  Assert.ok(
    AppConstants.REMOTE_SETTINGS_SERVER_URLS[0].startsWith(
      "https://firefox.settings.services.mozilla.com/",
    ),
    "Remote Settings uses Mozilla's server",
  );
  Assert.ok(
    defaults
      .getStringPref("extensions.getAddons.get.url", "")
      .startsWith("https://services.addons.mozilla.org/"),
    "add-on metadata comes from AMO",
  );
});
