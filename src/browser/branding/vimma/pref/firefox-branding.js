/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Vimma branding prefs (spec m0-branding). Replaces the file Surfer's branding patch generates,
// which points the welcome and what's-new pages at zen-browser.app. No update or welcome pages
// until Vimma has its own (M6).

pref("startup.homepage_override_url", "");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");
// The time interval between checks for a new version (in seconds)
pref("app.update.interval", 86400); // 24 hours
// Give the user x seconds to react before showing the big UI. default=24 hours
pref("app.update.promptWaitTime", 86400);
pref("app.update.url.manual", "https://github.com/JRanne/vimma");
pref("app.update.url.details", "https://github.com/JRanne/vimma");
pref("app.releaseNotesURL", "");
pref("app.releaseNotesURL.aboutDialog", "");
pref("app.releaseNotesURL.prompt", "");

// Number of usages of the web console.
// If this is less than 5, then pasting code into the web console is disabled
pref("devtools.selfxss.count", 5);

// Mozilla services (spec m0-mozilla-services). Defaults only, never locked: the user can turn any
// of these back on in about:config or Settings. Remote Settings (CRLite, blocklists), Safe
// Browsing, Sync and add-on installs from AMO keep Firefox's defaults on purpose.

// Studies and experiments: Normandy recipes, Nimbus opt-out studies and rollouts.
pref("app.normandy.enabled", false);
pref("app.normandy.api_url", "");
pref("app.shield.optoutstudies.enabled", false);
pref("nimbus.rollouts.enabled", false);

// Nothing uploads (MOZ_TELEMETRY_REPORTING unset, Glean upload disabled at build time), so the
// data-collection switches say so and the "sends data to Mozilla" notice does not appear.
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.usage.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);

// Crash reports: the reporter is not built (configs/common/mozconfig); opt-in when M6 brings it
// back with our own server.
pref("browser.tabs.crashReporting.sendReport", false);

// Sponsored content on the new tab, and the stories feed the sponsored stories ride in.
// Sponsored address-bar suggestions: vimma/services/MozillaServices.sys.mjs.
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.system.showSponsored", false);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.topsites.contile.enabled", false);

// Remote messaging (what's new, feature and add-on recommendations) and Mozilla product promos.
// The provider is upstream's value with "enabled": false; carry upstream changes on rebase.
// Kept on one line: wrapped, prettier adds a trailing comma that libpref's parser rejects.
// prettier-ignore
pref("browser.newtabpage.activity-stream.asrouter.providers.cfr", "{\"id\":\"cfr\",\"enabled\":false,\"type\":\"remote-settings\",\"collection\":\"cfr\",\"updateCycleInMs\":3600000}");
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);
pref("browser.vpn_promo.enabled", false);
pref("browser.preferences.moreFromMozilla", false);
pref("browser.promo.pin.enabled", false);
pref("browser.promo.relay.enabled", false);
// about:protections: the Firefox mobile app card and the VPN banner.
pref("browser.contentblocking.report.show_mobile_app", false);
pref("browser.contentblocking.report.hide_vpn_banner", true);

// Vimma UI (spec m0-tabstrip-hidden): Firefox's tab strip is hidden until M2 brings Vimma's own
// tab UI; false shows it again, live.
pref("vimma.ui.tabstrip.hidden", true);
