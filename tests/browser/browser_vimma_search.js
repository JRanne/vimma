/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/search-engines.md

"use strict";

/* global focusContent -- from head.js */

const { ConfigHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/config/ConfigHost.sys.mjs",
);
const { VimmaHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
);
const { SearchHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/search/SearchHost.sys.mjs",
);
const { AboutVimma } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/about/AboutVimma.sys.mjs",
);
const { SearchService } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/search/SearchService.sys.mjs",
);
const { SearchTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/SearchTestUtils.sys.mjs",
);
const { UrlbarTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/UrlbarTestUtils.sys.mjs",
);
SearchTestUtils.init(this);
UrlbarTestUtils.init(this);

const PAGE = "https://example.org/";
const BLOCKED = "blocked: javascript: and data: URLs can't be opened from the command line";
const STATE_PREF = "vimma.search.applied";
/** Stands in for an engine the profile has installed (Settings > Search). */
const INSTALLED = "Vimma Installed";
const INSTALLED_URL = "https://example.com/?installed={searchTerms}";
/** Its alias before Vimma touches it. */
const INSTALLED_ALIAS = "vi";
const TEMPLATE = "https://example.com/?t=%s";

const dir = PathUtils.join(PathUtils.tempDir, `vimma-search-${Date.now()}`);
const file = PathUtils.join(dir, "config.toml");

function until(cond, msg) {
  return TestUtils.waitForCondition(cond, msg, 50, 100);
}

let writes = 0;
/** Writes config.toml with a size of its own, so the poll always sees the change. */
async function writeConfig(...lines) {
  writes++;
  await IOUtils.writeUTF8(file, `schema = 2\n${lines.join("\n")}\n${"#".repeat(writes)}\n`);
}

/** The state Vimma recorded, once the apply after a write has run. */
const applied = () => JSON.parse(Services.prefs.getStringPref(STATE_PREF, "null"));

const engineByAlias = (alias) => SearchService.getEngineByAlias(alias);

const input = (win = window) => win.document.getElementById("vimma-cmdline-input");

/** `:line` Enter, typed key by key. */
function runCommand(line, win = window) {
  EventUtils.synthesizeKey(":", { shiftKey: true }, win);
  EventUtils.sendString(line, win);
  EventUtils.synthesizeKey("KEY_Enter", {}, win);
}

function noticeText(win = window) {
  const n = win.document.getElementById("vimma-notice");
  return n?.matches(":popover-open") ? n.textContent : null;
}

function errorSegment() {
  return (
    document.getElementById("vimma-statusbar")?.querySelector('[data-segment="error"]')
      ?.textContent ?? null
  );
}

/** A page tab, focused, in normal mode. */
async function openPage() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE);
  await focusContent(tab.linkedBrowser);
  await until(() => VimmaHost.status(window).mode === "normal", "the page is in normal mode");
  return tab;
}

/** `:line` in `tab`, and the URL its browser then loads. */
async function openFrom(tab, line, url) {
  const loaded = BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, url);
  runCommand(line);
  await loaded;
  Assert.equal(tab.linkedBrowser.currentURI.spec, url, `:${line} loads ${url}`);
  await focusContent(tab.linkedBrowser);
}

let installed;
let originalDefault;

add_task(async function setup() {
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  await SearchService.init();
  installed = await SearchService.addUserEngine({
    name: INSTALLED,
    url: INSTALLED_URL,
    alias: INSTALLED_ALIAS,
  });
  // An engine with a defined `@` alias, as Firefox's own `@google` is; the default, so that no
  // search in this file can leave for the network.
  await SearchTestUtils.installSearchExtension(
    {
      name: "Vimma Extension",
      keyword: "@vext",
      search_url: "https://example.com/",
      search_url_get_params: "ext={searchTerms}",
    },
    { setAsDefault: true },
  );
  originalDefault = SearchService.defaultEngine;
  await SpecialPowers.pushPrefEnv({
    set: [
      ["vimma.config.path", file],
      ["vimma.config.pollMs", 100],
    ],
  });
  registerCleanupFunction(async () => {
    while (gBrowser.tabs.length > 1) gBrowser.removeTab(gBrowser.tabs.at(-1));
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    await ConfigHost.reload();
    await until(() => applied() === null, "removing the file undoes everything Vimma did");
    await SpecialPowers.popPrefEnv();
    await ConfigHost.reload();
    if (SearchService.getEngineByName(INSTALLED)) {
      await SearchService.removeEngine(installed, SearchService.CHANGE_REASON.UNKNOWN);
    }
    Services.prefs.clearUserPref(STATE_PREF);
  });
});

add_task(async function default_sets_and_removing_it_restores_the_previous_one() {
  await writeConfig("[search]", `default = "${INSTALLED}"`);
  await until(() => SearchService.defaultEngine.name === INSTALLED, "the default is set");
  Assert.equal(applied().default.previous, originalDefault.id, "the previous one is recorded");

  const tab = await openPage();
  await openFrom(tab, "open plain words", "https://example.com/?installed=plain+words");

  await writeConfig("[search]");
  await until(
    () => SearchService.defaultEngine.id === originalDefault.id,
    "the previous default is back",
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function a_default_chosen_in_settings_since_is_kept() {
  await writeConfig("[search]", `default = "${INSTALLED}"`);
  await until(() => SearchService.defaultEngine.name === INSTALLED, "the default is set");
  const other = (await SearchService.getVisibleEngines()).find(
    (e) => e.name !== INSTALLED && e.id !== originalDefault.id,
  );
  // Settings changes it once Vimma is done: a reconcile still due (engines added in setup)
  // would set the file's default again, as it should.
  await SearchHost.settled();
  await SearchService.setDefault(other, SearchService.CHANGE_REASON.USER);

  await writeConfig("[search]");
  await until(() => applied()?.default === null, "the apply without default ran");
  Assert.equal(SearchService.defaultEngine.id, other.id, "the choice made in Settings stands");
  await SearchService.setDefault(originalDefault, SearchService.CHANGE_REASON.UNKNOWN);
});

add_task(async function aliases_make_an_engine_and_alias_an_installed_one() {
  await writeConfig("[search.aliases]", `t = "${TEMPLATE}"`, `w = "${INSTALLED}"`);
  await until(() => engineByAlias("@t"), "the template's engine is made");
  const t = await engineByAlias("@t");
  Assert.equal(t.name, "example.com", "named after its host");
  Assert.ok(!t.supportsResponseType("application/x-suggestions+json"), "it has no suggestion URL");
  await until(() => installed.alias === "@w", "the installed engine gets @w");

  await writeConfig("[search]");
  await until(async () => !(await engineByAlias("@t")), "the template's engine is removed");
  await until(() => installed.alias === INSTALLED_ALIAS, "the installed engine's alias is back");
});

add_task(async function a_post_engine_gets_its_body() {
  const sjs = `${getRootDirectory(gTestPath).replace(
    "chrome://mochitests/content",
    "https://example.com",
  )}file_vimma_search_post.sjs`;
  await SearchTestUtils.installSearchExtension({
    name: "Vimma Post",
    keyword: "@vpost",
    search_url: sjs,
    search_url_post_params: "q={searchTerms}",
  });
  const tab = await openPage();
  const loaded = BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, sjs);
  runCommand("open @vpost owls");
  await loaded;
  const text = await SpecialPowers.spawn(tab.linkedBrowser, [], () =>
    content.document.body.textContent.trim(),
  );
  Assert.equal(text, "POST q=owls", "the engine receives the words as its POST body");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function open_and_tabnew_resolve_aliases() {
  await writeConfig(
    "[search]",
    `default = "${INSTALLED}"`,
    "[search.aliases]",
    `t = "${TEMPLATE}"`,
  );
  await until(() => engineByAlias("@t"), "the template's engine is made");
  await until(() => SearchService.defaultEngine.name === INSTALLED, "the default is set");
  const tab = await openPage();

  await openFrom(tab, "open @t cats", "https://example.com/?t=cats");
  await openFrom(tab, "open @vext cats", "https://example.com/?ext=cats");
  await openFrom(tab, "open ? @t cats", "https://example.com/?installed=%40t+cats");

  const opened = BrowserTestUtils.waitForNewTab(gBrowser, "https://example.com/?t=dogs", true);
  runCommand("tabnew @t dogs");
  const newTab = await opened;
  Assert.equal(gBrowser.selectedTab, newTab, ":tabnew @t dogs in a new tab");
  BrowserTestUtils.removeTab(newTab);

  // Completion: the aliases with their engines; the candidate ends in a space.
  await focusContent(tab.linkedBrowser);
  EventUtils.synthesizeKey(":", { shiftKey: true });
  EventUtils.sendString("open @t");
  await until(() => {
    EventUtils.synthesizeKey("KEY_Tab");
    return input().value === "open @t ";
  }, "Tab completes @t");
  EventUtils.synthesizeKey("KEY_Escape");

  BrowserTestUtils.removeTab(tab);
  await writeConfig("[search]");
  await until(async () => !(await engineByAlias("@t")), "the template's engine is removed");
});

add_task(async function the_url_bar_knows_the_alias() {
  await writeConfig("[search.aliases]", `t = "${TEMPLATE}"`);
  await until(() => engineByAlias("@t"), "the template's engine is made");
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE);
  const loaded = BrowserTestUtils.browserLoaded(
    tab.linkedBrowser,
    false,
    "https://example.com/?t=birds",
  );
  await UrlbarTestUtils.promiseAutocompleteResultPopup({ window, value: "@t birds" });
  EventUtils.synthesizeKey("KEY_Enter");
  await loaded;
  BrowserTestUtils.removeTab(tab);
  await writeConfig("[search]");
  await until(async () => !(await engineByAlias("@t")), "the template's engine is removed");
});

add_task(async function bookmark_keywords_work_and_bookmarklets_are_refused() {
  const bookmarks = [
    await PlacesUtils.bookmarks.insert({
      parentGuid: PlacesUtils.bookmarks.unfiledGuid,
      url: "https://example.com/?k=%s",
    }),
    await PlacesUtils.bookmarks.insert({
      parentGuid: PlacesUtils.bookmarks.unfiledGuid,
      url: "javascript:void(%s)",
    }),
  ];
  await PlacesUtils.keywords.insert({ keyword: "vk", url: "https://example.com/?k=%s" });
  await PlacesUtils.keywords.insert({ keyword: "vj", url: "javascript:void(%s)" });
  registerCleanupFunction(async () => {
    await PlacesUtils.keywords.remove("vk");
    await PlacesUtils.keywords.remove("vj");
    for (const b of bookmarks) await PlacesUtils.bookmarks.remove(b);
  });

  const tab = await openPage();
  await openFrom(tab, "open vk fish", "https://example.com/?k=fish");
  runCommand("open vj 1");
  await until(() => noticeText() === BLOCKED, "the bookmarklet is refused with the notice");
  Assert.equal(tab.linkedBrowser.currentURI.spec, "https://example.com/?k=fish", "nothing ran");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function an_unknown_engine_is_a_config_error_and_the_rest_applies() {
  await writeConfig("[search]", 'default = "Vimma Instaled"', "[keys]", 'new_tab = "prefix+t"');
  await until(() => ConfigHost.config?.keys.new_tab === "prefix+t", "the rest of the file applies");
  await until(() => errorSegment()?.includes("search.default"), "the status bar shows it");
  Assert.equal(
    errorSegment(),
    `config.toml:3: search.default: no search engine named "Vimma Instaled" (did you mean "${INSTALLED}"?)`,
    "with its line and a suggestion",
  );
  const data = await AboutVimma.collect(window);
  Assert.ok(
    data.search.errors.some((e) =>
      e.endsWith(
        `config.toml:3: search.default: no search engine named "Vimma Instaled" (did you mean "${INSTALLED}"?)`,
      ),
    ),
    "about:vimma lists it under Search",
  );
  Assert.notEqual(SearchService.defaultEngine.name, INSTALLED, "the default is left alone");

  await writeConfig("[search]", `default = "${INSTALLED}"`);
  await until(() => SearchService.defaultEngine.name === INSTALLED, "fixed, it applies");
  await until(() => errorSegment() === null, "and the error clears");
  await writeConfig("[search]");
  await until(
    () => SearchService.defaultEngine.id === originalDefault.id,
    "the previous default is back",
  );
});

add_task(async function a_private_window_opens_aliases_too() {
  await writeConfig("[search.aliases]", `t = "${TEMPLATE}"`);
  await until(() => engineByAlias("@t"), "the template's engine is made");
  const win = await BrowserTestUtils.openNewBrowserWindow({ private: true });
  const browser = win.gBrowser.selectedBrowser;
  BrowserTestUtils.startLoadingURIString(browser, PAGE);
  await BrowserTestUtils.browserLoaded(browser, false, PAGE);
  await SimpleTest.promiseFocus(win);
  await SimpleTest.promiseFocus(browser);
  const loaded = BrowserTestUtils.browserLoaded(browser, false, "https://example.com/?t=owls");
  runCommand("open @t owls", win);
  await loaded;
  await BrowserTestUtils.closeWindow(win);
  await writeConfig("[search]");
  await until(async () => !(await engineByAlias("@t")), "the template's engine is removed");
});
