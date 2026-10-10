/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m5-omarchy-theme.md

"use strict";

/* global BrowserCommands -- browser window global (browser.js) */
/* global focusContent -- from head.js */

const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");

const START = "chrome://browser/content/vimma/start/start.html";
const POLL_MS = 100;
/** Tokyo Night's dark_background: the built-in status bar colour. */
const TOKYO_STATUSBAR = "#13141c";

/**
 * A colors.toml in Omarchy 4's format (as in tests/contract/theme/), written by hand: keys in
 * Omarchy's order, with `bg` and `darkBg` varied so each theme is told apart by the status bar.
 * @param {{ bg: string, darkBg: string, mode?: string | null }} p  mode null: no mode key
 */
function colorsToml({ bg, darkBg, mode = "dark" }) {
  return `${mode === null ? "" : `mode = "${mode}"\n`}
accent = "#7aa2f7"
selection = "#292e42"
muted = "#414868"

background = "${bg}"
dark_background = "${darkBg}"
darker_background = "#0e0e14"
lighter_background = "#24283b"

foreground = "#a9b1d6"
dark_foreground = "#565f89"
light_foreground = "#b4bee6"
bright_foreground = "#c0caf5"

red = "#f7768e"
yellow = "#e0af68"
orange = "#ff9e64"
green = "#9ece6a"
cyan = "#7dcfff"
blue = "#7aa2f7"
magenta = "#bb9af7"
brown = "#db4b4b"

bright_red = "#ff7a93"
bright_yellow = "#ff9e64"
bright_green = "#b9f27c"
bright_cyan = "#7dcfff"
bright_blue = "#7da6ff"
bright_magenta = "#bb9af7"

hyprland_active_border = "rgba(7aa2f7ee) rgba(bb9af7ee) 45deg"
`;
}

/** Light: Catppuccin Latte surfaces, dark text; no mode key, so light.mode decides. */
function lightToml() {
  return colorsToml({ bg: "#eff1f5", darkBg: "#e6e9ef", mode: null })
    .replace('foreground = "#a9b1d6"', 'foreground = "#4c4f69"')
    .replace('dark_foreground = "#565f89"', 'dark_foreground = "#6c6f85"')
    .replace('selection = "#292e42"', 'selection = "#ccd0da"');
}

/** "#rrggbb" → "rgb(r, g, b)", as getComputedStyle reports it. */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}

const token = (/** @type {string} */ name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const barBackground = () =>
  getComputedStyle(document.getElementById("vimma-statusbar")).backgroundColor;

/** Waits until the status bar shows `hex` as its background. */
function waitForBar(hex, msg) {
  return TestUtils.waitForCondition(() => barBackground() === rgb(hex), msg, 50, 100);
}

/**
 * Opens each overlay and prompt in turn (ctrl+b ?, ctrl+b g, `:`, ctrl+b T) and checks that its
 * surface and text are the current theme's tokens: --vimma-bg-dark and --vimma-fg.
 * @param {string} label  which theme, for the messages
 */
async function assertSurfacesFollowTheTheme(label) {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, "https://example.org/");
  await focusContent(tab.linkedBrowser);
  const surface = rgb(token("--vimma-bg-dark"));
  const text = rgb(token("--vimma-fg"));
  const $ = (/** @type {string} */ id) => document.getElementById(id);
  const shown = (/** @type {Element | null | undefined} */ el) =>
    !!el && BrowserTestUtils.isVisible(el);
  const surfaces = [
    {
      what: "the ctrl+b ? help overlay",
      prefix: true,
      open: () => EventUtils.synthesizeKey("?", { shiftKey: true }),
      el: () => $("vimma-help"),
    },
    {
      what: "the ctrl+b g picker",
      prefix: true,
      open: () => EventUtils.synthesizeKey("g"),
      el: () => $("vimma-picker"),
    },
    {
      what: "the : command line",
      prefix: false,
      open: () => EventUtils.synthesizeKey(":", { shiftKey: true }),
      el: () => $("vimma-cmdline")?.querySelector(".vimma-cmdline-panel"),
    },
    {
      what: "the ctrl+b T rename prompt",
      prefix: true,
      open: () => EventUtils.synthesizeKey("T", { shiftKey: true }),
      el: () => $("vimma-rename")?.querySelector(".vimma-cmdline-panel"),
    },
  ];
  for (const s of surfaces) {
    if (s.prefix) EventUtils.synthesizeKey("b", { ctrlKey: true });
    s.open();
    await TestUtils.waitForCondition(() => shown(s.el()), `${label}: ${s.what} opens`);
    const style = getComputedStyle(/** @type {Element} */ (s.el()));
    Assert.equal(style.backgroundColor, surface, `${label}: ${s.what} is on --vimma-bg-dark`);
    Assert.equal(style.color, text, `${label}: ${s.what} text is --vimma-fg`);
    if (s.el()?.id === "vimma-help") {
      const help = /** @type {Element} */ (s.el());
      const part = (/** @type {string} */ sel) =>
        getComputedStyle(/** @type {Element} */ (help.querySelector(sel)));
      Assert.equal(part("header").backgroundColor, surface, `${label}: the help header too`);
      Assert.equal(part("input").color, text, `${label}: the help filter's text is --vimma-fg`);
    }
    EventUtils.synthesizeKey("KEY_Escape");
    await TestUtils.waitForCondition(() => !shown(s.el()), `${label}: ${s.what} closes`);
  }
  BrowserTestUtils.removeTab(tab);
}

async function ln(target, link) {
  const command = await Subprocess.pathSearch("ln");
  const proc = await Subprocess.call({ command, arguments: ["-sfn", target, link] });
  const { exitCode } = await proc.wait();
  Assert.equal(exitCode, 0, `ln -sfn ${target} ${link}`);
}

const root = PathUtils.join(PathUtils.tempDir, `vimma-theme-${Date.now()}`);
const dir = (/** @type {string} */ name) => PathUtils.join(root, "themes", name);
const current = PathUtils.join(root, "current");
const currentTheme = PathUtils.join(current, "theme");

add_task(async function setup() {
  await IOUtils.makeDirectory(dir("one"), { createAncestors: true });
  await IOUtils.writeUTF8(
    PathUtils.join(dir("one"), "colors.toml"),
    colorsToml({ bg: "#202020", darkBg: "#101820" }),
  );
  await IOUtils.makeDirectory(dir("two"), { createAncestors: true });
  await IOUtils.writeUTF8(
    PathUtils.join(dir("two"), "colors.toml"),
    colorsToml({ bg: "#2a1a2a", darkBg: "#301030" }),
  );
  await IOUtils.makeDirectory(dir("light"), { createAncestors: true });
  await IOUtils.writeUTF8(PathUtils.join(dir("light"), "colors.toml"), lightToml());
  await IOUtils.writeUTF8(PathUtils.join(dir("light"), "light.mode"), "");
  await IOUtils.makeDirectory(current, { createAncestors: true });
  await ln(dir("one"), currentTheme);

  // browser.toml pins vimma.theme.source=builtin for every other test; this one opts in.
  await SpecialPowers.pushPrefEnv({
    set: [
      ["vimma.theme.pollMs", POLL_MS],
      ["vimma.theme.omarchyPath", currentTheme],
      ["vimma.theme.source", "omarchy"],
    ],
  });
  registerCleanupFunction(async () => {
    while (gBrowser.tabs.length > 1) gBrowser.removeTab(gBrowser.tabs.at(-1));
    await SpecialPowers.popPrefEnv();
    await IOUtils.remove(root, { recursive: true });
  });
});

add_task(async function status_bar_takes_the_omarchy_background() {
  await waitForBar("#101820", "the status bar's background is the fixture's dark_background");
  Assert.equal(token("--vimma-bg"), "#202020", "--vimma-bg is the fixture's background");
  Assert.equal(token("--vimma-color-scheme"), "dark", "a dark theme");
});

add_task(async function start_page_takes_the_theme_and_follows_it() {
  const loaded = BrowserTestUtils.waitForNewTab(gBrowser, START, true);
  BrowserCommands.openTab();
  const tab = await loaded;
  const pageBg = () =>
    SpecialPowers.spawn(
      tab.linkedBrowser,
      [],
      () => content.getComputedStyle(content.document.documentElement).backgroundColor,
    );
  await TestUtils.waitForCondition(
    async () => (await pageBg()) === rgb("#202020"),
    "the start page's background is the fixture's background",
  );
  await IOUtils.writeUTF8(
    PathUtils.join(dir("one"), "colors.toml"),
    colorsToml({ bg: "#283028", darkBg: "#101820" }),
  );
  await TestUtils.waitForCondition(
    async () => (await pageBg()) === rgb("#283028"),
    "an open start page follows the change",
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function rewriting_the_file_updates_within_the_poll() {
  await IOUtils.writeUTF8(
    PathUtils.join(dir("one"), "colors.toml"),
    colorsToml({ bg: "#303030", darkBg: "#183018" }),
  );
  const started = Date.now();
  await waitForBar("#183018", "the rewritten file's colours");
  Assert.less(Date.now() - started, 20 * POLL_MS, "within a few poll intervals");
});

add_task(async function broken_file_keeps_the_previous_colours() {
  const failed = TestUtils.topicObserved("vimma-theme-error");
  await IOUtils.writeUTF8(
    PathUtils.join(dir("one"), "colors.toml"),
    colorsToml({ bg: "#303030", darkBg: "not a colour" }),
  );
  await failed;
  Assert.equal(barBackground(), rgb("#183018"), "the last good theme stays");
  // A further poll of the same broken file neither re-reports nor changes anything.
  await new Promise((r) => setTimeout(r, 3 * POLL_MS));
  Assert.equal(barBackground(), rgb("#183018"), "still the last good theme");
});

add_task(async function swapping_the_symlink_follows_the_new_theme() {
  await ln(dir("two"), currentTheme);
  await waitForBar("#301030", "omarchy-theme-set's swap: theme two");
  Assert.equal(token("--vimma-bg"), "#2a1a2a", "and its background token");
});

add_task(async function overlays_and_prompts_follow_a_dark_theme() {
  Assert.equal(token("--vimma-bg-dark"), "#301030", "theme two is current");
  await assertSurfacesFollowTheTheme("dark");
});

add_task(async function light_mode_file_switches_to_light_tokens() {
  await ln(dir("light"), currentTheme);
  await waitForBar("#e6e9ef", "the light theme");
  Assert.equal(token("--vimma-color-scheme"), "light", "light.mode makes the tokens light");
});

add_task(async function overlays_and_prompts_follow_a_light_theme() {
  Assert.equal(token("--vimma-fg"), "#4c4f69", "the light theme's dark text is current");
  await assertSurfacesFollowTheTheme("light");
});

add_task(async function no_omarchy_dir_means_tokyo_night() {
  await SpecialPowers.pushPrefEnv({
    set: [["vimma.theme.omarchyPath", PathUtils.join(root, "nowhere", "theme")]],
  });
  await waitForBar(TOKYO_STATUSBAR, "no Omarchy theme: the built-in Tokyo Night");
  await SpecialPowers.popPrefEnv();
  await waitForBar("#e6e9ef", "the Omarchy theme again");
});

add_task(async function builtin_source_ignores_omarchy() {
  await SpecialPowers.pushPrefEnv({ set: [["vimma.theme.source", "builtin"]] });
  await waitForBar(TOKYO_STATUSBAR, "vimma.theme.source=builtin forces Tokyo Night");
  await SpecialPowers.popPrefEnv();
});
