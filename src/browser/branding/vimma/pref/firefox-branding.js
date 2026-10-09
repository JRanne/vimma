/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Vimma branding prefs (spec m0-branding). Replaces the file Surfer's branding patch generates,
// which points the welcome and what's-new pages at zen-browser.app. No update or welcome pages
// until Vimma has its own (M6).

pref("startup.homepage_override_url", "");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");

// The Vimma start page (spec start-page): the home page (new windows; startup, while
// browser.startup.page is 1) and, while vimma.startpage.newtab is true, the new-tab page
// (vimma/start/StartPage.sys.mjs). Settings > Home changes the home page; the new tab goes back
// to Firefox's with vimma.startpage.newtab = false.
pref("browser.startup.homepage", "chrome://browser/content/vimma/start/start.html");
pref("vimma.startpage.newtab", true);

// The time interval between checks for a new version (in seconds)
pref("app.update.interval", 86400); // 24 hours
// Give the user x seconds to react before showing the big UI. default=24 hours
pref("app.update.promptWaitTime", 86400);
pref("app.update.url.manual", "https://github.com/JRanne/vimma");
pref("app.update.url.details", "https://github.com/JRanne/vimma");
pref("app.releaseNotesURL", "");
pref("app.releaseNotesURL.aboutDialog", "");
pref("app.releaseNotesURL.prompt", "");

// Every stock brand defines these two, and Firefox reads them with no fallback: without the first,
// BrowserGlue's old-build check throws at the first window and skips the rest of its first-window
// work, about:home and about:newtab included (tools/branding/test/branding-prefs.test.mjs).
// Values as upstream's unofficial brand.
// The number of days a binary is permitted to be old without checking for an update.
pref("app.update.checkInstallTime.days", 2);
// Give the user x seconds to reboot before showing a badge on the hamburger button.
pref("app.update.badgeWaitTime", 0);

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

// Google Safe Browsing (spec m0-safebrowsing-key). Google serves the download lists
// goog-badbinurl-proto and goog-downloadwhite-proto, and the remote download check, only to
// Mozilla's key: ours gets 404/403, and one refused list fails the whole update, so no list would
// arrive. The provider lists are upstream's (all.js) without those two; carry upstream changes
// on rebase. Phishing and malware stay on; keyless builds turn them off (MozillaServices.sys.mjs).
// One line each: wrapped, prettier adds a trailing comma that libpref's parser rejects.
// prettier-ignore
pref("browser.safebrowsing.provider.google4.lists", "goog-phish-proto,googpub-phish-proto,goog-malware-proto,goog-unwanted-proto,goog-harmful-proto");
// prettier-ignore
pref("browser.safebrowsing.provider.google5.lists", "goog-phish-proto,googpub-phish-proto,goog-malware-proto,goog-unwanted-proto,goog-harmful-proto,goog-globalcache-proto");
pref("browser.safebrowsing.downloads.remote.enabled", false);

// System add-on updates (spec m0-updater): Mozilla's update server (aus5) is asked with our
// version, build, OS and locale, and answers nothing for 157; webcompat fixes come through Remote
// Settings instead. App updates are off at build time (configs/common/mozconfig). Add-on updates
// from AMO (extensions.update.*) and OpenH264/Widevine (media.gmp-manager.url) stay on.
pref("extensions.systemAddon.update.enabled", false);
pref("extensions.systemAddon.update.url", "");

// Vimma UI (spec m0-tabstrip-hidden): Firefox's tab strip is hidden until M2 brings Vimma's own
// tab UI; false shows it again, live.
pref("vimma.ui.tabstrip.hidden", true);

// Control socket (spec m0-control-server, ADR-007): off in every build. When on, Vimma listens on
// 127.0.0.1 and writes <profile>/vimma-control.json (0600) for vimma-ctl; live on change.
pref("vimma.control.enabled", false);

// Find (spec m1-find): Vim's smartcase for `/` and Firefox's own find bar alike. 2 is the find
// bar's "auto" mode: a query with a capital letter matches case, an all lower-case one does not.
pref("accessibility.typeaheadfind.casesensitive", 2);

// Workspaces (spec m3-workspaces, decision 13): every tab is in a workspace's container, and
// Firefox only uses a preloaded about:newtab for tabs in no container, so it would never be used.
pref("browser.newtab.preload", false);

// Workspaces (spec m3-workspaces, decision 9): closing the last visible tab must not close a
// window whose other workspaces' tabs are hidden; Firefox opens a new tab in the workspace instead.
pref("browser.tabs.closeWindowWithLastTab", false);

// Split panes (spec m4-split-panes, ADR-013): Vimma's keys are the only way into a split. This
// hides Firefox's tab and link context-menu items and alt-click; the split-view API keeps
// working. split.css hides the URL bar button.
pref("browser.tabs.splitView.enabled", false);
