/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m0-tabstrip-hidden.md

"use strict";

const PREF = "vimma.ui.tabstrip.hidden";
const ROOT_ATTR = "vimma-tabstrip-hidden";

const $ = (/** @type {string} */ id) => document.getElementById(id);

/** Non-zero size, like Firefox's isElementVisible (what gTabsPanel.canOpen uses). */
function hasSize(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function stripShown() {
  return hasSize($("TabsToolbar"));
}

async function setPref(value) {
  await SpecialPowers.pushPrefEnv({ set: [[PREF, value]] });
}

async function openTabs(n) {
  const tabs = [];
  for (let i = 0; i < n; i++) {
    tabs.push(await BrowserTestUtils.openNewForegroundTab(gBrowser, "about:blank"));
  }
  return tabs;
}

function closeAllButFirst() {
  while (gBrowser.tabs.length > 1) gBrowser.removeTab(gBrowser.tabs.at(-1));
}

registerCleanupFunction(() => {
  closeAllButFirst();
  // ctrlTab records its first use; not ours to keep.
  Services.prefs.clearUserPref("browser.engagement.ctrlTab.has-used");
  window.gTabsPanel.hideAllTabsPanel();
});

add_task(async function strip_is_hidden_by_default_and_nav_bar_stays() {
  Assert.strictEqual(
    Services.prefs.getDefaultBranch("").getBoolPref(PREF, false),
    true,
    `${PREF} defaults to true`,
  );
  Assert.ok(document.documentElement.hasAttribute(ROOT_ATTR), `root has ${ROOT_ATTR}`);
  Assert.ok(!stripShown(), "#TabsToolbar has no size");
  Assert.ok(!hasSize($("tabbrowser-tabs")), "#tabbrowser-tabs has no size");
  Assert.ok(window.gNavToolbox.hasAttribute("tabs-hidden"), "Firefox knows the strip is hidden");
  Assert.ok(hasSize($("nav-bar")), "#nav-bar is visible");
  Assert.ok(hasSize($("urlbar")), "the URL bar is visible");

  await SimpleTest.promiseFocus(window);
  gBrowser.selectedBrowser.focus();
  EventUtils.synthesizeKey("l", { accelKey: true });
  await TestUtils.waitForCondition(() => gURLBar.focused, "ctrl+l focuses the URL bar");
  EventUtils.synthesizeKey("KEY_Escape");
  EventUtils.synthesizeKey("KEY_Escape");
});

add_task(async function pref_toggles_the_strip_live() {
  await setPref(false);
  await TestUtils.waitForCondition(stripShown, "strip shows when the pref is false");
  Assert.ok(!document.documentElement.hasAttribute(ROOT_ATTR), `root loses ${ROOT_ATTR}`);
  Assert.ok(hasSize($("tabbrowser-tabs")), "the tabs are visible");
  Assert.ok(!window.gNavToolbox.hasAttribute("tabs-hidden"), "toolbox back to Firefox's state");

  await setPref(true);
  await TestUtils.waitForCondition(() => !stripShown(), "strip hides when the pref is true");
  Assert.ok(window.gNavToolbox.hasAttribute("tabs-hidden"), "tabs-hidden is set again");
  await SpecialPowers.popPrefEnv();
  await SpecialPowers.popPrefEnv();
});

add_task(async function ctrl_t_and_ctrl_w_still_work() {
  gBrowser.selectedBrowser.focus();
  const before = gBrowser.tabs.length;
  const opened = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen");
  EventUtils.synthesizeKey("t", { accelKey: true });
  const { target: tab } = await opened;
  await TestUtils.waitForCondition(() => gBrowser.selectedTab === tab, "new tab is selected");
  Assert.equal(gBrowser.tabs.length, before + 1, "ctrl+t opened a tab");
  Assert.ok(!stripShown(), "the strip stays hidden with two tabs");

  EventUtils.synthesizeKey("w", { accelKey: true });
  await TestUtils.waitForCondition(() => gBrowser.tabs.length === before, "ctrl+w closed it");
  Assert.ok(!tab.isConnected, "the new tab is gone");
});

add_task(async function ctrl_tab_pagedown_and_digits_switch_tabs() {
  closeAllButFirst();
  const [, second, third] = [gBrowser.tabs[0], ...(await openTabs(2))];
  const first = gBrowser.tabs[0];
  await BrowserTestUtils.switchTab(gBrowser, first);
  gBrowser.selectedBrowser.focus();

  EventUtils.synthesizeKey("KEY_Tab", { ctrlKey: true });
  await TestUtils.waitForCondition(() => gBrowser.selectedTab === second, "ctrl+tab: next tab");

  EventUtils.synthesizeKey("KEY_PageDown", { ctrlKey: true });
  await TestUtils.waitForCondition(() => gBrowser.selectedTab === third, "ctrl+pagedown: next");

  EventUtils.synthesizeKey("KEY_Tab", { ctrlKey: true, shiftKey: true });
  await TestUtils.waitForCondition(() => gBrowser.selectedTab === second, "ctrl+shift+tab: prev");

  // ctrl+2 on Windows/macOS, alt+2 on Linux (XP_GNOME in browser-sets.inc.xhtml).
  const modifier = $("key_selectTab2").getAttribute("modifiers");
  await BrowserTestUtils.switchTab(gBrowser, first);
  EventUtils.synthesizeKey("2", modifier === "alt" ? { altKey: true } : { accelKey: true });
  await TestUtils.waitForCondition(() => gBrowser.selectedTab === second, `${modifier}+2: 2nd tab`);
  closeAllButFirst();
});

async function expectAllTabsPanel(open, label) {
  window.gTabsPanel.initElements();
  const view = $("allTabsMenu-allTabsView");
  const shown = BrowserTestUtils.waitForEvent(view, "ViewShown");
  open();
  await shown;
  const rows = $("allTabsMenu-allTabsView-tabs").querySelectorAll(
    ".all-tabs-item:not(.all-tabs-group-item)",
  );
  Assert.equal(rows.length, gBrowser.tabs.length, `${label}: the panel lists every tab`);
  const panel = view.closest("panel");
  const hidden = BrowserTestUtils.waitForEvent(panel, "popuphidden");
  window.gTabsPanel.hideAllTabsPanel();
  await hidden;
}

add_task(async function list_all_tabs_opens_with_the_strip_hidden() {
  await openTabs(2);
  Assert.ok(window.gTabsPanel.canOpen, "gTabsPanel.canOpen with the strip hidden");
  await expectAllTabsPanel(() => $("Browser:ShowAllTabs").doCommand(), "Browser:ShowAllTabs");

  await SpecialPowers.pushPrefEnv({ set: [["browser.ctrlTab.sortByRecentlyUsed", true]] });
  gBrowser.selectedBrowser.focus();
  await expectAllTabsPanel(
    () => EventUtils.synthesizeKey("KEY_Tab", { ctrlKey: true, shiftKey: true }),
    "ctrl+shift+tab (sortByRecentlyUsed)",
  );
  await SpecialPowers.popPrefEnv();
  closeAllButFirst();
});

add_task(async function window_controls_move_to_the_nav_bar() {
  const root = document.documentElement;
  const simulated = !root.hasAttribute("customtitlebar");
  if (simulated) {
    // Headless and tiling WMs have no CSD; set what CustomTitlebar sets when the browser draws
    // the titlebar (GNOME/KDE), then let Firefox recompute the toolbars.
    info("no browser-drawn titlebar here: simulating customtitlebar");
    root.setAttribute("customtitlebar", "true");
  }
  try {
    window.TabBarVisibility.update(true);
    const navControls = $("nav-bar").querySelector(".titlebar-buttonbox-container");
    const tabsControls = $("TabsToolbar").querySelector(".titlebar-buttonbox-container");
    Assert.notEqual(getComputedStyle(navControls).display, "none", "nav bar shows the controls");
    Assert.ok(hasSize(navControls), "the nav bar's window controls have a size");
    Assert.ok(!hasSize(tabsControls), "no window controls left in the hidden strip");
    Assert.ok($("nav-bar").classList.contains("browser-titlebar"), "nav bar is a drag region");
  } finally {
    if (simulated) root.removeAttribute("customtitlebar");
    window.TabBarVisibility.update(true);
  }
});

add_task(async function fullscreen_keeps_the_strip_hidden() {
  const entered = BrowserTestUtils.waitForEvent(window, "fullscreen");
  window.fullScreen = true;
  await entered;
  await TestUtils.waitForCondition(
    () => document.documentElement.hasAttribute("inFullscreen"),
    "window is fullscreen",
  );
  Assert.ok(!stripShown(), "strip stays hidden in fullscreen");
  Assert.ok(window.gNavToolbox.contains($("nav-bar")), "nav bar still in the toolbox");
  Assert.ok(window.gNavToolbox.hasAttribute("tabs-hidden"), "tabs-hidden in fullscreen");

  const left = BrowserTestUtils.waitForEvent(window, "fullscreen");
  window.fullScreen = false;
  await left;
  await TestUtils.waitForCondition(
    () => !document.documentElement.hasAttribute("inFullscreen"),
    "window left fullscreen",
  );
  Assert.ok(!stripShown(), "strip still hidden after fullscreen");
});

add_task(async function customize_mode_shows_the_strip() {
  const ready = BrowserTestUtils.waitForEvent(window.gNavToolbox, "customizationready");
  window.gCustomizeMode.enter();
  await ready;
  Assert.ok(stripShown(), "strip is visible while customizing");

  const done = BrowserTestUtils.waitForEvent(window.gNavToolbox, "aftercustomization");
  window.gCustomizeMode.exit();
  await done;
  await TestUtils.waitForCondition(() => !stripShown(), "strip hidden after customize mode");
  Assert.ok(window.gNavToolbox.hasAttribute("tabs-hidden"), "tabs-hidden after customize mode");
});

add_task(async function vertical_tabs_are_hidden_too() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.revamp", true],
      ["sidebar.verticalTabs", true],
    ],
  });
  await TestUtils.waitForCondition(
    () => gBrowser.tabContainer.verticalMode,
    "tabs moved to the vertical strip",
  );
  Assert.ok(!hasSize($("vertical-tabs")), "vertical tab list has no size");
  Assert.ok(!hasSize($("tabbrowser-tabs")), "tabs have no size");
  Assert.ok(hasSize($("urlbar")), "URL bar visible with vertical tabs");

  await setPref(false);
  await TestUtils.waitForCondition(() => hasSize($("tabbrowser-tabs")), "vertical tabs back");
  await SpecialPowers.popPrefEnv();
  await SpecialPowers.popPrefEnv();
  await TestUtils.waitForCondition(
    () => !gBrowser.tabContainer.verticalMode,
    "tabs back in the horizontal strip",
  );
  await TestUtils.waitForCondition(() => !stripShown(), "horizontal strip hidden again");
});

add_task(async function help_overlay_still_opens() {
  await BrowserTestUtils.withNewTab("https://example.com/", async (browser) => {
    browser.focus();
    EventUtils.synthesizeKey("b", { ctrlKey: true });
    EventUtils.synthesizeKey("?", { shiftKey: true });
    const dialog = () => /** @type {HTMLDialogElement | null} */ ($("vimma-help"));
    await TestUtils.waitForCondition(() => !!dialog()?.open, "ctrl+b ? opens the help overlay");
    Assert.ok(BrowserTestUtils.isVisible(dialog()), "overlay is visible");
    EventUtils.synthesizeKey("KEY_Escape");
    await TestUtils.waitForCondition(() => !dialog().open, "Esc closes it");
  });
});
