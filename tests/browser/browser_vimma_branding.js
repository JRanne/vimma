/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m0-branding.md

"use strict";

const BRAND = "Vimma";

/**
 * Formats Fluent terms from the branding bundle through throw-away test messages.
 *
 * @param {string[]} terms term ids without the leading "-"
 * @returns {Record<string, string>}
 */
function formatBrandTerms(terms) {
  const bundles = L10nRegistry.getInstance().generateBundlesSync(["en-US"], ["branding/brand.ftl"]);
  const bundle = bundles.next().value;
  Assert.ok(bundle, "branding/brand.ftl is registered");
  const source = terms.map((t) => `vimma-test-${t} = { -${t} }`).join("\n");
  bundle.addResource(new FluentResource(source));
  /** @type {Record<string, string>} */
  const out = {};
  for (const t of terms) {
    const msg = bundle.getMessage(`vimma-test-${t}`);
    // Strip Unicode isolation marks Fluent wraps placeables in.
    out[t] = bundle.formatPattern(msg.value).replace(/[⁨⁩]/g, "");
  }
  return out;
}

add_task(async function app_name_and_vendor_are_vimma() {
  Assert.equal(Services.appinfo.name, BRAND, "Services.appinfo.name");
  Assert.equal(Services.appinfo.vendor, BRAND, "Services.appinfo.vendor");
});

add_task(async function brand_strings_are_vimma() {
  const terms = formatBrandTerms([
    "brand-shorter-name",
    "brand-short-name",
    "brand-full-name",
    "brand-product-name",
    "vendor-short-name",
  ]);
  for (const [term, value] of Object.entries(terms)) {
    Assert.equal(value, BRAND, `-${term} in branding/brand.ftl`);
  }

  const props = Services.strings.createBundle("chrome://branding/locale/brand.properties");
  Assert.equal(props.GetStringFromName("brandShortName"), BRAND, "brand.properties brandShortName");
});

add_task(async function window_title_names_vimma() {
  const defaultTitle = await document.l10n.formatValue("browser-main-window-default-title");
  Assert.equal(defaultTitle, BRAND, "default window title");

  await BrowserTestUtils.withNewTab("data:text/html,<title>vimma-page</title>", async () => {
    await TestUtils.waitForCondition(
      () => document.title.includes("vimma-page"),
      "window title follows the page",
    );
    Assert.ok(document.title.endsWith(BRAND), `window title "${document.title}" ends with Vimma`);
    Assert.ok(!/Nightly|Firefox/.test(document.title), "window title has no Nightly/Firefox");
  });
});

add_task(async function about_logo_is_ours() {
  const res = await fetch("chrome://branding/content/about-logo.svg");
  const text = await res.text();
  Assert.ok(text.includes("vimma-placeholder"), "about-logo.svg is the Vimma placeholder");
});

add_task(async function default_bookmarks_import_succeeds() {
  const { PlacesBrowserStartup } = ChromeUtils.importESModule(
    "moz-src:///browser/components/places/PlacesBrowserStartup.sys.mjs",
  );
  /** @type {string[]} */
  const seen = [];
  const observer = (/** @type {unknown} */ _s, /** @type {string} */ topic) => seen.push(topic);
  const topics = ["bookmarks-restore-success", "bookmarks-restore-failed"];
  topics.forEach((t) => Services.obs.addObserver(observer, t));
  registerCleanupFunction(() => {
    topics.forEach((t) => Services.obs.removeObserver(observer, t));
    Services.prefs.clearUserPref("browser.bookmarks.restore_default_bookmarks");
  });

  // Same route as upstream's browser_bookmarks_checkDefaultBookmarks.js: a fresh profile's import.
  await PlacesUtils.bookmarks.eraseEverything();
  Services.prefs.setBoolPref("browser.bookmarks.restore_default_bookmarks", true);
  PlacesBrowserStartup._placesInitialized = false;
  const done = TestUtils.topicObserved("places-browser-init-complete");
  PlacesBrowserStartup.initPlaces();
  await done;

  Assert.deepEqual(seen, ["bookmarks-restore-success"], "default bookmarks imported without error");
  const menu = await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.menuGuid);
  Assert.ok(menu.children?.length, "bookmarks menu is not empty");
});
