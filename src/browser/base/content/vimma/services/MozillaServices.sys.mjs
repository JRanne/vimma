/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Defaults for Mozilla services that a prefs file cannot set (spec:
// docs/specs/m0-mozilla-services.md). Everything else lives in the branding prefs file.

/**
 * Firefox Suggest rewrites this pref's default-branch value per home region on every startup
 * (QuickSuggest.sys.mjs, `intendedDefaultPrefs`), so a default in a prefs file loses. The pref is
 * sticky: a user value survives even when it equals the default, and Settings writes one when
 * the user ticks "Suggestions from sponsors".
 */
const SPONSORED_SUGGESTIONS = "browser.urlbar.suggest.quicksuggest.sponsored";

/**
 * Suggest's pref migrations run at browser-idle-startup, after our first window, and can clear
 * the user value (migration 5, for DE/FR/IT with an English locale). They end by writing this
 * pref, so a change to it means "re-apply".
 */
const SUGGEST_MIGRATION_VERSION = "browser.urlbar.quicksuggest.migrationVersion";

let started = false;

export const MozillaServices = {
  /** Apply now, and again after Suggest has initialised or migrated. Once per process. */
  init() {
    this.applyUserDefaults();
    if (started) {
      return;
    }
    started = true;
    Services.prefs.addObserver(SUGGEST_MIGRATION_VERSION, () => this.applyUserDefaults());
    const { QuickSuggest } = ChromeUtils.importESModule(
      "moz-src:///browser/components/urlbar/QuickSuggest.sys.mjs",
    );
    QuickSuggest.initPromise.then(() => this.applyUserDefaults());
  },

  /**
   * Turn sponsored address-bar suggestions off unless the user has chosen. Idempotent.
   */
  applyUserDefaults() {
    if (!Services.prefs.prefHasUserValue(SPONSORED_SUGGESTIONS)) {
      Services.prefs.setBoolPref(SPONSORED_SUGGESTIONS, false);
    }
  },
};
