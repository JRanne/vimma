/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cross-cutting rules of docs/security.md that no feature's own test file covers. Each task is
// linked from that page by name (tools/security/check-doc-links.mjs keeps the links honest).

"use strict";

/* global focusContent -- from head.js */

const { VimmaControl } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/ctl/VimmaControl.sys.mjs",
);
const { VimmaHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
);
const { ConfigHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/config/ConfigHost.sys.mjs",
);

const PAGE = "https://example.org/";
const HOSTILE_TITLE = '<img src=x onerror="document.title=1"><b>bold</b>';

/** @param {() => boolean} cond @param {string} msg */
function until(cond, msg) {
  return TestUtils.waitForCondition(cond, msg, 50, 100);
}

/** What the window looks like, for "nothing changed". */
function snapshot() {
  return JSON.stringify({
    tabs: gBrowser.tabs.map((t) => [t.linkedBrowser.currentURI.spec, t.pinned, t.hidden]),
    selected: gBrowser.tabs.indexOf(gBrowser.selectedTab),
    mode: VimmaHost.status(window).mode,
    workspace: VimmaHost.status(window).workspace?.name ?? null,
  });
}

add_task(async function control_state_is_read_only() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, `${PAGE}?state`);
  await BrowserTestUtils.openNewForegroundTab(gBrowser, `${PAGE}?other`);
  await BrowserTestUtils.switchTab(gBrowser, tab);
  await focusContent(tab.linkedBrowser);
  const before = snapshot();
  const first = VimmaControl._commands.state();
  const second = VimmaControl._commands.state();
  Assert.equal(snapshot(), before, "state changes no tab, selection, mode or workspace");
  Assert.deepEqual(second, first, "and asking twice gives the same answer");
  Assert.ok(
    first.tabs.some((/** @type {any} */ t) => t.selected && t.url === `${PAGE}?state`),
    "sanity: it reports the window",
  );
  while (gBrowser.tabs.length > 1) BrowserTestUtils.removeTab(gBrowser.tabs.at(-1));
});

add_task(async function page_titles_with_html_stay_text() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, `${PAGE}?title`);
  const browser = tab.linkedBrowser;
  await SpecialPowers.spawn(browser, [HOSTILE_TITLE], (t) => {
    content.document.title = t;
  });
  await until(() => browser.contentTitle === HOSTILE_TITLE, "the page set its title");

  const bar = document.getElementById("vimma-statusbar");
  const title = () => bar.querySelector('[data-segment="title"]');
  await until(() => !!title()?.textContent.includes("<img"), "the status bar shows the title");
  Assert.equal(bar.querySelector("img, b"), null, "the status bar parsed no markup");

  await focusContent(browser);
  EventUtils.synthesizeKey(":", { shiftKey: true });
  EventUtils.sendString("ls");
  EventUtils.synthesizeKey("KEY_Enter");
  const picker = () => document.getElementById("vimma-picker");
  await until(() => !!picker()?.open, ":ls opens the tab picker");
  const rowTitles = [...picker().querySelectorAll(".vimma-picker-title")].map((e) => e.textContent);
  Assert.ok(rowTitles.includes(HOSTILE_TITLE), "the picker shows the title as written");
  Assert.equal(picker().querySelector("img, b"), null, "the picker parsed no markup");
  EventUtils.synthesizeKey("KEY_Escape");
  await until(() => !picker()?.open, "closed");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function route_add_creates_a_private_config_toml() {
  const dir = await IOUtils.createUniqueDirectory(PathUtils.tempDir, "vimma-security");
  const file = PathUtils.join(dir, "vimma", "config.toml");
  await SpecialPowers.pushPrefEnv({ set: [["vimma.config.path", file]] });
  await ConfigHost.reload();

  const why = await ConfigHost.addRoute({ domain: "example.org", workspace: 'x" [keys] y = "z' });
  Assert.equal(why, null, "the rule is written");
  Assert.equal((await IOUtils.stat(file)).permissions, 0o600, "a new config.toml is 0600");
  Assert.equal((await IOUtils.stat(PathUtils.parent(file))).permissions, 0o700, "its folder 0700");
  const text = await IOUtils.readUTF8(file);
  Assert.ok(
    text.endsWith('[[routes]]\ndomain = "example.org"\nworkspace = "x\\" [keys] y = \\"z"\n'),
    "the workspace name is one escaped TOML string, never a new table",
  );

  await SpecialPowers.popPrefEnv();
  await ConfigHost.reload();
  await IOUtils.remove(dir, { recursive: true });
});
