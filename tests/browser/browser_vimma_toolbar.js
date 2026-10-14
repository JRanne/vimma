/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/toolbar-toggle.md. ctrl+b u hides Firefox's navigation toolbar in every
// window; focusing the address bar shows a minimal bar (the URL field and the site's identity
// only) over the page, which keeps its size; Enter and Esc hide it again; a permission prompt
// and the identity panel show the minimal bar, an add-on popup and hover the full toolbar; the
// status bar says `not secure` and `private`; `[ui] toolbar` sets it from config.toml; the
// account panel has no mobile-app row.

"use strict";

/* global requestLongerTimeout -- the browser-chrome harness (browser-test.js) */
requestLongerTimeout(4);

/* global focusContent -- from head.js */
/* global PopupNotifications, gCustomizeMode, gNavToolbox, CustomizableUI, PanelMultiView,
   PanelUI -- browser window globals (browser.js) */

const { VimmaHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
);
const { ConfigHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/config/ConfigHost.sys.mjs",
);
const { PaneViews } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/split/PaneView.mjs",
);
const { PlacesTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/PlacesTestUtils.sys.mjs",
);

const PREF = "vimma.ui.toolbar.hidden";
const HIDDEN = "vimma-toolbar-hidden";
const REVEALED = "vimma-toolbar-revealed";
const MINIMAL = "vimma-toolbar-minimal";
const DIR = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com",
);
const PLAIN = DIR + "file_vimma_plain.html";
/** A bookmarked page that is not the one open (Firefox leaves the current page out). */
const OTHER = PLAIN + "?other";
const HTTP_PLAIN = PLAIN.replace("https://", "http://");
const VISIBLE = { visibilityProperty: true };

const dir = PathUtils.join(PathUtils.tempDir, `vimma-toolbar-${Date.now()}`);
const configFile = PathUtils.join(dir, "config.toml");

/** @param {() => boolean} cond @param {string} msg */
function until(cond, msg, tries = 100) {
  return TestUtils.waitForCondition(cond, msg, 50, tries);
}

/** ctrl+b, then `key`, in `win`. */
function prefix(key, win = window, mods = {}) {
  EventUtils.synthesizeKey("b", { ctrlKey: true }, win);
  EventUtils.synthesizeKey(key, mods, win);
}

const $ = (id, win = window) => win.document.getElementById(id);
const shows = (el) => !!el?.checkVisibility(VISIBLE);
const root = (win = window) => win.document.documentElement;
const barCollapsed = (win = window) => !shows($("nav-bar", win));
const minimal = (win = window) => root(win).hasAttribute(MINIMAL);
const revealedFull = (win = window) =>
  root(win).hasAttribute(REVEALED) && !root(win).hasAttribute(MINIMAL);
const noticeText = (win = window) => $("vimma-notice-live", win)?.textContent ?? "";
const toolbarOf = (win = window) => VimmaHost._state(win).toolbar;
const segText = (id, win = window) =>
  $("vimma-statusbar", win)?.querySelector(`[data-segment="${id}"]`)?.textContent ?? null;

/** Hidden in every window, from the pref. */
async function hide() {
  Services.prefs.setBoolPref(PREF, true);
  await until(() => barCollapsed(), "the toolbar is hidden");
}

async function show() {
  Services.prefs.setBoolPref(PREF, false);
  await until(() => !barCollapsed(), "the toolbar is shown");
}

/** An example.com page, selected, focused, in normal mode. */
async function openPage(url = PLAIN) {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);
  await focusContent(tab.linkedBrowser);
  await until(() => VimmaHost.status(window).mode === "normal", "the page is in normal mode");
  return tab;
}

/** Leaves the URL bar: Esc until the page has focus, as a user would. */
async function escapeUrlbar() {
  for (let i = 0; i < 4 && gURLBar.focused; i++) {
    EventUtils.synthesizeKey("KEY_Escape");
    await new Promise((r) => requestAnimationFrame(r));
  }
  await until(() => !gURLBar.focused, "Esc leaves the URL bar");
}

/**
 * The minimal bar is up: only the URL field and the site's identity (a page has one; Firefox
 * shows none on a new tab).
 */
function assertMinimal(what, { page = true } = {}) {
  Assert.ok(gURLBar.focused, `${what}: the URL bar has focus`);
  Assert.ok(shows(gURLBar), `${what}: the URL bar is visible`);
  Assert.ok(minimal(), `${what}: the bar is minimal`);
  if (page) Assert.ok(shows($("identity-box")), `${what}: the identity box shows`);
  Assert.ok(shows($("urlbar-container")), `${what}: the URL field shows`);
  for (const id of [
    "back-button",
    "stop-reload-button",
    "unified-extensions-button",
    "PanelUI-button",
    "PersonalToolbar",
  ]) {
    Assert.ok(!shows($(id)), `${what}: #${id} does not show`);
  }
  for (const el of $("nav-bar").querySelectorAll(".titlebar-buttonbox-container")) {
    Assert.ok(!shows(el), `${what}: the window controls do not show`);
  }
}

add_task(async function setup() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.toolbars.bookmarks.visibility", "always"],
      ["browser.urlbar.suggest.searches", false],
      // The status bar's `not secure` needs a page that stays on http:.
      ["dom.security.https_first", false],
      ["dom.security.https_first_schemeless", false],
      ["browser.urlbar.suggest.history", true],
      ["browser.urlbar.suggest.bookmark", true],
      ["browser.urlbar.suggest.quicksuggest.sponsored", false],
      ["browser.urlbar.suggest.quicksuggest.nonsponsored", false],
    ],
  });
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  registerCleanupFunction(async () => {
    Services.prefs.clearUserPref(PREF);
    const view = PaneViews.get(window);
    while (view?.panes) view.close();
    while (gBrowser.tabs.length > 1) gBrowser.removeTab(gBrowser.tabs.at(-1));
    await PlacesUtils.history.clear();
    await PlacesUtils.bookmarks.eraseEverything();
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  });
  Assert.equal(
    Services.prefs.getDefaultBranch("").getBoolPref(PREF, true),
    false,
    `${PREF} defaults to false: the toolbar is shown`,
  );
  Assert.ok(!barCollapsed(), "the toolbar shows by default");
});

// 1, 13: every window; the notice, spoken; the notification bars stay; no accessible.
add_task(async function ctrl_b_u_hides_the_toolbar_in_every_window() {
  const win2 = await BrowserTestUtils.openNewBrowserWindow();
  await SimpleTest.promiseFocus(window);
  const tab = await openPage();

  prefix("u");
  await until(() => barCollapsed() && barCollapsed(win2), "hidden in both windows");
  Assert.ok(Services.prefs.getBoolPref(PREF), "the pref says hidden");
  for (const w of [window, win2]) {
    Assert.ok(root(w).hasAttribute(HIDDEN), "the root says hidden");
    Assert.ok(!shows($("PersonalToolbar", w)), "the bookmarks toolbar hides too");
    Assert.ok(!shows(w.gURLBar), "the URL bar is not visible");
  }
  await until(() => noticeText() === "toolbar hidden", "the polite region says toolbar hidden");
  Assert.ok(
    $("notifications-toolbar").checkVisibility(VISIBLE),
    "#notifications-toolbar is not hidden",
  );
  const acc = Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService);
  Assert.equal(
    acc.getAccessibleFor(gURLBar.inputField),
    null,
    "the hidden URL bar has no accessible",
  );

  await focusContent(tab.linkedBrowser);
  prefix("u");
  await until(() => !barCollapsed() && !barCollapsed(win2), "shown again in both windows");
  await until(() => noticeText() === "toolbar shown", "the notice says toolbar shown");
  Assert.ok(shows($("PersonalToolbar")), "the bookmarks toolbar is back");

  await BrowserTestUtils.closeWindow(win2);
  gBrowser.removeTab(tab);
});

// 2: every way to the URL bar shows the minimal bar, over the page, without moving the field.
add_task(async function focusing_the_url_bar_shows_the_minimal_bar() {
  const tab = await openPage();
  const container = $("urlbar-container").getBoundingClientRect();
  await hide();
  const browser = tab.linkedBrowser;
  const height = browser.getBoundingClientRect().height;
  // Hiding the bar gives the page its rows once; then nothing else may resize it.
  await TestUtils.waitForCondition(
    async () =>
      (await SpecialPowers.spawn(browser, [], () => content.innerHeight)) === Math.round(height),
    "the page has the toolbar's rows",
  );
  const inner = await SpecialPowers.spawn(browser, [], async () => {
    // The resize event of that change comes at a later refresh: let it pass first.
    for (let i = 0; i < 3; i++) await new Promise((r) => content.requestAnimationFrame(r));
    content.wrappedJSObject.vimmaResized = 0;
    content.addEventListener("resize", () => content.wrappedJSObject.vimmaResized++);
    return content.innerHeight;
  });

  /** @type {Array<[string, () => void]>} */
  const ways = [
    ["I", () => EventUtils.synthesizeKey("I", { shiftKey: true })],
    ["ctrl+l", () => EventUtils.synthesizeKey("l", { ctrlKey: true })],
    ["F6", () => EventUtils.synthesizeKey("KEY_F6")],
  ];
  for (const [what, press] of ways) {
    await focusContent(browser);
    Assert.ok(barCollapsed(), `${what}: hidden before`);
    press();
    await until(() => gURLBar.focused, `${what} focuses the URL bar`);
    assertMinimal(what);
    const now = $("urlbar-container").getBoundingClientRect();
    for (const k of ["x", "y", "width", "height"]) {
      Assert.equal(now[k], container[k], `${what}: the URL field's ${k} is as with the toolbar`);
    }
    Assert.equal(
      browser.getBoundingClientRect().height,
      height,
      `${what}: the page keeps its height`,
    );
    await escapeUrlbar();
    await until(() => barCollapsed(), `${what}: leaving the URL bar hides it`);
  }
  const after = await SpecialPowers.spawn(browser, [], () => [
    content.innerHeight,
    content.wrappedJSObject.vimmaResized,
  ]);
  Assert.deepEqual(after, [inner, 0], "the page saw no resize");

  for (const [what, keys] of [
    ["t", () => EventUtils.synthesizeKey("t")],
    ["ctrl+b c", () => prefix("c")],
  ]) {
    await focusContent(browser);
    const opened = BrowserTestUtils.waitForNewTab(gBrowser);
    keys();
    const fresh = await opened;
    await until(() => gURLBar.focused, `${what}: the new tab's URL bar has focus`);
    assertMinimal(what, { page: false });
    gBrowser.removeTab(fresh);
    await until(() => !gURLBar.focused || gBrowser.selectedTab === tab, "back to the page");
  }

  await focusContent(browser);
  prefix("v");
  await until(() => !!PaneViews.get(window)?.panes && gURLBar.focused, "ctrl+b v: a pane");
  assertMinimal("ctrl+b v", { page: false });
  PaneViews.get(window).close();
  await until(() => !PaneViews.get(window)?.panes, "the split is closed");

  // Typing, and Firefox's suggestions below the field, where they open with the toolbar shown.
  await PlacesUtils.bookmarks.insert({
    parentGuid: PlacesUtils.bookmarks.unfiledGuid,
    url: OTHER,
    title: "Vimma plain page",
  });
  await PlacesTestUtils.addVisits({ uri: OTHER, title: "Vimma plain page" });
  await Cc["@mozilla.org/places/frecency-recalculator;1"]
    .getService(Ci.nsIObserver)
    .wrappedJSObject.recalculateAnyOutdatedFrecencies();
  const typeAndMeasure = async () => {
    await focusContent(browser);
    EventUtils.synthesizeKey("I", { shiftKey: true });
    await until(() => gURLBar.focused, "I again");
    EventUtils.sendString("vimma plain");
    await until(() => gURLBar.value === "vimma plain", "the typed text is in the field");
    await until(
      () => gURLBar.view.isOpen && gURLBar.querySelectorAll(".urlbarView-row").length > 1,
      "the bookmark is a suggestion",
    );
    const view = gURLBar.querySelector(".urlbarView");
    Assert.ok(view.matches(":popover-open"), "the view is an open popover");
    return view.getBoundingClientRect().top;
  };
  await show();
  const shownTop = await typeAndMeasure();
  await escapeUrlbar();
  await hide();
  const hiddenTop = await typeAndMeasure();
  Assert.equal(hiddenTop, shownTop, "the suggestions open where they do with the toolbar shown");
  Assert.greater(hiddenTop, gURLBar.inputField.getBoundingClientRect().top, "below the field");
  const loaded = BrowserTestUtils.browserLoaded(browser, false, OTHER);
  EventUtils.synthesizeKey("KEY_ArrowDown");
  EventUtils.synthesizeKey("KEY_Enter");
  await loaded;
  await until(() => barCollapsed(), "Enter on a row loads it and hides the bar");

  await show();
  gBrowser.removeTab(tab);
});

// 3, 4: Enter loads and hides; Esc reverts first, then leaves.
add_task(async function enter_and_esc_hide_the_minimal_bar() {
  const tab = await openPage();
  await hide();
  const browser = tab.linkedBrowser;

  EventUtils.synthesizeKey("I", { shiftKey: true });
  await until(() => gURLBar.focused, "I");
  EventUtils.sendString(HTTP_PLAIN.replace("http://", "https://") + "?typed");
  const loaded = BrowserTestUtils.browserLoaded(browser, false, (u) => u.endsWith("?typed"));
  EventUtils.synthesizeKey("KEY_Enter");
  await loaded;
  await until(() => !gURLBar.focused && barCollapsed(), "Enter loads, and the bar hides");
  await until(() => document.activeElement === browser, "focus is in the page");

  await focusContent(browser);
  EventUtils.synthesizeKey("I", { shiftKey: true });
  await until(() => gURLBar.focused, "I");
  EventUtils.sendString("something else");
  for (let i = 0; i < 3 && gURLBar.value === "something else"; i++) {
    EventUtils.synthesizeKey("KEY_Escape");
    await new Promise((r) => requestAnimationFrame(r));
  }
  Assert.notEqual(gURLBar.value, "something else", "Esc reverts the typed text");
  Assert.ok(gURLBar.focused && minimal(), "and the minimal bar stays, focused");
  EventUtils.synthesizeKey("KEY_Escape");
  await until(() => document.activeElement === browser, "the next Esc focuses the page");
  await until(() => barCollapsed(), "and the bar hides");

  await show();
  gBrowser.removeTab(tab);
});

// 5: a permission prompt shows the minimal bar and hangs from its own icon.
add_task(async function a_permission_prompt_shows_the_minimal_bar() {
  const tab = await openPage();
  await hide();
  let removed = false;
  const shown = BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popupshown");
  await SpecialPowers.spawn(tab.linkedBrowser, [], () => {
    content.navigator.geolocation.getCurrentPosition(
      () => {},
      () => {},
    );
  });
  await shown;
  const notification = PopupNotifications.getNotification("geolocation");
  Assert.ok(notification, "the geolocation prompt is up");
  const origRemove = notification.remove.bind(notification);
  notification.remove = () => {
    removed = true;
    origRemove();
  };
  Assert.ok(minimal(), "the bar is minimal, not full");
  const anchor = PopupNotifications.panel.anchorNode;
  Assert.equal(anchor?.id, "geo-notification-icon", "the prompt anchors to its own icon");
  Assert.ok(shows(anchor), "which is visible");
  // The site's identity: Firefox's lock (the trust icon) or its identity icon, whichever this
  // page shows.
  Assert.ok(
    [$("identity-icon"), $("trust-icon-container")].some(shows),
    "next to the site's identity",
  );
  await new Promise((r) => setTimeout(r, 700));
  Assert.equal(PopupNotifications.panel.state, "open", "the bar stays while the prompt is open");
  Assert.ok(!notification.dismissed && !removed, "the reveal dismissed nothing");

  const hidden = BrowserTestUtils.waitForEvent(PopupNotifications.panel, "popuphidden");
  PopupNotifications.panel.firstElementChild.secondaryButton.click();
  await hidden;
  await until(() => barCollapsed(), "after Block the bar hides");
  gBrowser.removeTab(tab);
  await show();
});

// 6: the site's identity panel (Firefox's trust panel, or the identity panel where that is
// off), from the minimal bar, keeps it up while open.
add_task(async function the_identity_panel_keeps_the_minimal_bar() {
  const tab = await openPage();
  await hide();
  EventUtils.synthesizeKey("I", { shiftKey: true });
  await until(() => gURLBar.focused, "I");
  // Firefox's results open after the focus and close every other popup: let them, then close
  // them, as a user would before opening the panel.
  await until(() => gURLBar.view.isOpen, "the results open");
  EventUtils.synthesizeKey("KEY_Escape");
  await until(() => !gURLBar.view.isOpen && gURLBar.focused, "Esc closes them");
  const button = [$("trust-icon-container"), $("identity-icon-box")].find(shows);
  Assert.ok(button, "the site's identity button shows in the minimal bar");
  const shown = BrowserTestUtils.waitForEvent(document, "popupshown", false, (e) =>
    e.target.anchorNode?.closest?.("#urlbar"),
  );
  // What a click on it runs (navigator-toolbox.js); a click with the mouse also hovers the
  // bar, which then shows in full (decision 9).
  if (button.id === "trust-icon-container") window.gTrustPanelHandler.showPopup({ reason: "test" });
  else window.gIdentityHandler.handleIdentityButtonEvent(new MouseEvent("click", { button: 0 }));
  const popup = (await shown).target;
  Assert.ok(button.contains(popup.anchorNode) || popup.anchorNode === button, "anchored to it");
  Assert.ok(minimal(), "the bar is minimal while the panel is open");
  await new Promise((r) => setTimeout(r, 300));
  Assert.equal(popup.state, "open", "the panel stays open");
  Assert.ok(!barCollapsed(), "and so does the bar");
  PanelMultiView.hidePopup(popup);
  await until(() => popup.state === "closed", "the panel closes");
  gBrowser.selectedBrowser.focus();
  await until(() => barCollapsed(), "focus back in the page: the bar hides");
  gBrowser.removeTab(tab);
  await show();
});

// 7: add-on popups show the full toolbar and hang from their button.
add_task(async function an_add_on_popup_shows_the_full_toolbar() {
  const ext = ExtensionTestUtils.loadExtension({
    useAddonManager: "temporary",
    manifest: {
      name: "Toolbar popup",
      browser_specific_settings: { gecko: { id: "toolbar-popup@vimma.test" } },
      browser_action: { default_popup: "popup.html", default_area: "navbar" },
      // MV2's name for `_execute_action`.
      commands: { _execute_browser_action: { suggested_key: { default: "Alt+Shift+U" } } },
    },
    files: {
      "popup.html": `<!doctype html><meta charset=utf-8><p>popup<script src=popup.js></script>`,
      "popup.js": `browser.test.sendMessage("popup-ready");`,
    },
  });
  await ext.startup();
  const widgetId = "toolbar-popup_vimma_test-browser-action";
  const tab = await openPage();
  await hide();

  /** Opens the popup with `open`, checks its anchor and the full bar, closes it with Esc. */
  async function check(what, open, anchorId) {
    await focusContent(tab.linkedBrowser);
    await open();
    await ext.awaitMessage("popup-ready");
    const panel = document.getElementById("customizationui-widget-panel");
    await until(() => panel?.state === "open", `${what}: the popup is open`);
    Assert.ok(revealedFull(), `${what}: the full toolbar shows`);
    Assert.ok(shows($("back-button")), `${what}: with its buttons`);
    const anchor = panel.anchorNode?.closest(`#${anchorId}`) ?? panel.anchorNode;
    Assert.equal(anchor?.id, anchorId, `${what}: anchored to #${anchorId}`);
    Assert.ok(shows(panel.anchorNode), `${what}: the anchor is visible`);
    await new Promise((r) => setTimeout(r, 700));
    Assert.equal(panel.state, "open", `${what}: the bar stays while it is open`);
    EventUtils.synthesizeKey("KEY_Escape");
    await until(() => panel.state === "closed", `${what}: Esc closes it`);
    await until(() => barCollapsed(), `${what}: the bar hides again`);
  }

  const ID = "toolbar-popup@vimma.test";
  const pick = async () => {
    prefix("e");
    await until(() => $("vimma-addon-picker")?.open, "the add-on picker");
    const picker = $("vimma-addon-picker");
    EventUtils.synthesizeKey("/");
    EventUtils.sendString("toolbar popup");
    EventUtils.synthesizeKey("KEY_Escape");
    await until(
      () => picker.querySelector("[role=option][aria-selected=true]")?.dataset.id === ID,
      "the add-on is selected",
    );
    EventUtils.synthesizeKey("KEY_Enter");
  };
  // The add-on's own shortcut: Firefox's key runs it (ExtensionShortcuts → triggerAction), a
  // path Vimma takes no part in (decision 7d).
  await check(
    "pinned, its own shortcut",
    () => EventUtils.synthesizeKey("U", { altKey: true, shiftKey: true }),
    widgetId,
  );

  await check("pinned, ctrl+b e", () => pick(), widgetId);
  CustomizableUI.addWidgetToArea(widgetId, CustomizableUI.AREA_ADDONS);
  await check("in the extensions menu", () => pick(), "unified-extensions-button");

  await ext.unload();
  gBrowser.removeTab(tab);
  await show();
});

// 8: hiding with focus in the URL bar moves focus to the page first.
add_task(async function hiding_with_focus_in_the_url_bar_moves_focus_to_the_page() {
  const tab = await openPage();
  gURLBar.focus();
  await until(() => gURLBar.focused, "the URL bar has focus");
  prefix("u");
  await until(() => barCollapsed(), "ctrl+b u hides");
  Assert.equal(document.activeElement, tab.linkedBrowser, "focus moved to the page");
  Assert.ok(!gURLBar.focused, "not left in a collapsed field");
  await show();
  gBrowser.removeTab(tab);
});

// 9: the safety net: a URL bar that cannot be revealed brings the toolbar back.
add_task(async function a_failed_reveal_shows_the_toolbar() {
  const tab = await openPage();
  await hide();
  const t = toolbarOf();
  const reveal = t.reveal;
  t.reveal = () => {};
  try {
    EventUtils.synthesizeKey("I", { shiftKey: true });
    await until(() => gURLBar.focused, "the URL bar is focused anyway");
    Assert.ok(!Services.prefs.getBoolPref(PREF), "the pref is back to shown");
    Assert.ok(!barCollapsed(), "the toolbar shows");
    await until(
      () => noticeText().startsWith("toolbar shown: the address bar could not be revealed"),
      "the notice says why",
    );
  } finally {
    t.reveal = reveal;
  }
  await escapeUrlbar();
  gBrowser.removeTab(tab);
});

// 10: popups keep their URL bar; customize mode and fullscreen are Firefox's.
add_task(async function exclusions() {
  const tab = await openPage();
  await hide();

  const popupOpened = BrowserTestUtils.waitForNewWindow();
  await SpecialPowers.spawn(tab.linkedBrowser, [], () => {
    content.open(content.location.href, "_blank", "popup,width=400,height=300");
  });
  const popup = await popupOpened;
  Assert.ok(popup.document.documentElement.hasAttribute("popup-window"), "a popup window");
  Assert.ok(!barCollapsed(popup), "it keeps its read-only URL bar");
  await BrowserTestUtils.closeWindow(popup);

  const ready = BrowserTestUtils.waitForEvent(gNavToolbox, "customizationready");
  gCustomizeMode.enter();
  await ready;
  Assert.ok(!barCollapsed(), "customize mode shows the toolbar");
  const done = BrowserTestUtils.waitForEvent(gNavToolbox, "aftercustomization");
  gCustomizeMode.exit();
  await done;
  await until(() => barCollapsed(), "hidden again after customize mode");

  const full = BrowserTestUtils.waitForEvent(window, "fullscreen");
  window.fullScreen = true;
  await full;
  await until(() => root().hasAttribute("inFullscreen"), "F11 fullscreen");
  Assert.ok(
    $("nav-bar").checkVisibility(VISIBLE),
    "in F11 fullscreen Firefox's own toolbox owns the bar",
  );
  const back = BrowserTestUtils.waitForEvent(window, "fullscreen");
  window.fullScreen = false;
  await back;
  await until(() => !root().hasAttribute("inFullscreen") && barCollapsed(), "and back");

  gBrowser.removeTab(tab);
  await show();
});

// 11: the status bar carries the security and private-browsing cues while hidden.
add_task(async function the_status_bar_says_not_secure_and_private() {
  const tab = await openPage(HTTP_PLAIN);
  Assert.equal(segText("security"), null, "shown: no security segment");
  await hide();
  Assert.equal(tab.linkedBrowser.currentURI.scheme, "http", "the page stayed on http:");
  await until(
    () => segText("security") === "not secure",
    `an http: page is not secure (identity box: ${$("identity-box").className}; bar: ${$("vimma-statusbar").textContent}; root hidden: ${root().hasAttribute(HIDDEN)})`,
  );
  await until(() => segText("url")?.startsWith("http://"), "and its URL keeps http://");
  BrowserTestUtils.startLoadingURIString(tab.linkedBrowser, PLAIN);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, PLAIN);
  await until(() => segText("security") === null, "an https: page says nothing");
  BrowserTestUtils.startLoadingURIString(tab.linkedBrowser, "about:blank");
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, "about:blank");
  await new Promise((r) => setTimeout(r, 300));
  Assert.equal(segText("security"), null, "nor a blank page");

  const priv = await BrowserTestUtils.openNewBrowserWindow({ private: true });
  await until(
    () => ($("vimma-statusbar", priv)?.textContent ?? "").includes("private"),
    "a private window says private",
  );
  await show();
  await BrowserTestUtils.closeWindow(priv);
  gBrowser.removeTab(tab);
});

// 12: [ui] toolbar from config.toml; a toggle lasts until that line changes.
add_task(async function config_sets_the_toolbar() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["vimma.config.path", configFile],
      ["vimma.config.pollMs", 100],
    ],
  });
  let n = 0;
  const write = (text) =>
    IOUtils.writeUTF8(configFile, `schema = 2\n${text}\n${"#".repeat(++n)}\n`);

  await show();
  await write(`[ui]\ntoolbar = "hidden"`);
  await until(() => ConfigHost.config?.ui.toolbar === "hidden", "the poll reads the file");
  await until(() => Services.prefs.getBoolPref(PREF, false), "and hides the toolbar");
  await until(() => barCollapsed(), "hidden");

  const tab = await openPage();
  prefix("u");
  await until(() => !barCollapsed(), "ctrl+b u shows it");
  await write(`[ui]\ntoolbar = "hidden"\n# another line`);
  await new Promise((r) => setTimeout(r, 600));
  Assert.ok(!Services.prefs.getBoolPref(PREF), "an edit elsewhere keeps the toggle");
  await write(`[ui]\ntoolbar = "shown"`);
  await new Promise((r) => setTimeout(r, 600));
  Assert.ok(!Services.prefs.getBoolPref(PREF), "shown, as it was");
  await write(`[ui]\ntoolbar = "hidden"`);
  await until(() => Services.prefs.getBoolPref(PREF, false), "changing the line applies it");

  await IOUtils.remove(configFile);
  await SpecialPowers.popPrefEnv();
  await ConfigHost.reload();
  await until(() => !Services.prefs.getBoolPref(PREF, false), "no config: shown");
  gBrowser.removeTab(tab);
});

// 14: hover at the top edge shows the full toolbar; leaving hides it; typing survives it.
add_task(async function hover_shows_the_full_toolbar() {
  const tab = await openPage();
  await hide();
  const edge = $("vimma-toolbar-edge");
  Assert.ok(edge && shows(edge), "the edge strip is there while hidden");
  EventUtils.synthesizeMouse(edge, 20, 1, { type: "mousemove" });
  await until(() => revealedFull(), "hovering the edge shows the full toolbar");
  Assert.ok(shows($("back-button")) && shows($("PanelUI-button")), "with its buttons");
  EventUtils.synthesizeMouseAtCenter(tab.linkedBrowser, { type: "mousemove" });
  await until(() => barCollapsed(), "leaving hides it");

  await focusContent(tab.linkedBrowser);
  EventUtils.synthesizeKey("I", { shiftKey: true });
  await until(() => gURLBar.focused, "I");
  EventUtils.sendString("abc");
  await until(() => gURLBar.value === "abc", "typed");
  const before = $("urlbar-container").getBoundingClientRect();
  EventUtils.synthesizeMouse($("nav-bar"), 3, 3, { type: "mousemove" });
  await until(() => revealedFull(), "hovering the minimal bar shows the full one");
  const after = $("urlbar-container").getBoundingClientRect();
  Assert.deepEqual([after.x, after.y, after.width], [before.x, before.y, before.width], "no jump");
  Assert.ok(gURLBar.focused && gURLBar.value === "abc", "focus and text kept");
  EventUtils.synthesizeMouseAtCenter(tab.linkedBrowser, { type: "mousemove" });
  await until(() => minimal(), "leaving: back to the minimal bar");
  await escapeUrlbar();
  await until(() => barCollapsed(), "hidden");
  gBrowser.removeTab(tab);
  await show();
});

// 15: revealing never moves buttons into or out of the overflow menu.
add_task(async function revealing_keeps_the_overflow_menu() {
  const tab = await openPage();
  const added = [
    "home-button",
    "library-button",
    "sidebar-button",
    "print-button",
    "save-page-button",
    "new-window-button",
    "fullscreen-button",
    "zoom-controls",
    "edit-controls",
    "email-link-button",
    "find-button",
    "open-file-button",
    "developer-button",
    "preferences-button",
    "history-panelmenu",
    "characterencoding-button",
  ];
  for (const id of added) CustomizableUI.addWidgetToArea(id, CustomizableUI.AREA_NAVBAR);
  const width = window.outerWidth;
  window.resizeTo(560, window.outerHeight);
  await until(() => $("nav-bar").hasAttribute("overflowing"), "the nav bar overflows");
  const overflowed = () =>
    [...document.querySelectorAll("[overflowedItem]")]
      .map((c) => c.id)
      .sort()
      .join(",");
  await new Promise((r) => setTimeout(r, 300));
  const before = overflowed();

  Assert.ok(before.length, "some buttons are in the overflow menu");

  await hide();
  window.dispatchEvent(new Event("resize"));
  await new Promise((r) => setTimeout(r, 300));
  Assert.equal(overflowed(), before, "hidden, after a resize: the same overflowed items");
  EventUtils.synthesizeKey("I", { shiftKey: true });
  await until(() => gURLBar.focused && minimal(), "minimal");
  window.dispatchEvent(new Event("resize"));
  await new Promise((r) => setTimeout(r, 300));
  Assert.equal(overflowed(), before, "minimal: the same overflowed items");
  toolbarOf().hold("test", "full");
  await until(() => revealedFull(), "full");
  window.dispatchEvent(new Event("resize"));
  await new Promise((r) => setTimeout(r, 300));
  Assert.equal(overflowed(), before, "full: the same overflowed items");
  toolbarOf().release("test");
  await escapeUrlbar();

  await show();
  CustomizableUI.reset();
  window.resizeTo(width, window.outerHeight);
  gBrowser.removeTab(tab);
});

// 16: a minimal and a full reason together show full; the full one ending leaves minimal.
add_task(async function mixed_sizes() {
  const tab = await openPage();
  await hide();
  EventUtils.synthesizeKey("I", { shiftKey: true });
  await until(() => gURLBar.focused && minimal(), "minimal");
  const panel = $("downloadsPanel") ?? null;
  const t = toolbarOf();
  t.hold("downloads-test", "full");
  await until(() => revealedFull(), "a full reason as well: full");
  t.release("downloads-test");
  await until(() => minimal(), "it ended: back to minimal, not hidden");
  Assert.ok(!barCollapsed(), "still shown");
  Assert.ok(panel === null || panel.state === "closed", "no panel left open");
  await escapeUrlbar();
  await until(() => barCollapsed(), "hidden");
  gBrowser.removeTab(tab);
  await show();
});

// 17: the account panel has no "Get Vimma for Android or iOS" row, shown or hidden.
add_task(async function the_account_panel_has_no_mobile_promo() {
  const node = (id) => PanelMultiView.getViewNode(document, id);
  for (const hidden of [false, true]) {
    Services.prefs.setBoolPref(PREF, hidden);
    const what = hidden ? "toolbar hidden" : "toolbar shown";
    const view = node("PanelUI-fxa");
    const shown = BrowserTestUtils.waitForEvent(view, "ViewShown");
    PanelUI.showSubView("PanelUI-fxa", $("PanelUI-menu-button"));
    await shown;
    // What browser-sync.js unhides for a signed-in user, mobile row included.
    const unhidden = [
      "PanelUI-signedin-panel",
      "PanelUI-fxa-menu-sync-status-button",
      "PanelUI-fxa-menu-get-firefox-mobile",
    ].map(node);
    const was = unhidden.map((el) => el.hidden);
    for (const el of unhidden) el.hidden = false;
    Assert.ok(
      !node("PanelUI-fxa-menu-get-firefox-mobile").checkVisibility(),
      `${what}: no mobile-app row`,
    );
    Assert.ok(
      node("PanelUI-fxa-menu-sync-status-button").checkVisibility(),
      `${what}: the Sync row stays`,
    );
    unhidden.forEach((el, i) => (el.hidden = was[i]));
    const panel = view.closest("panel");
    const closed = BrowserTestUtils.waitForEvent(panel, "popuphidden");
    panel.hidePopup();
    await closed;
  }
  await show();
});
