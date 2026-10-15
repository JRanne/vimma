/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/insert-focus.md

/* global focusContent, recordPageKeys, pageKeys, waitForPageKey -- from head.js */

"use strict";

const { VimmaHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
);

const ROOT = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com",
);
const PAGE = ROOT + "file_vimma_insert_focus.html";
const LOGIN = ROOT + "file_vimma_insert_autofocus.html";

/** Vimma's j step, in CSS pixels. */
const STEP = 60;

/**
 * Opens `url` in a new tab with content focus and records the page's keydowns, then runs `fn`.
 * @param {(browser: XULBrowserElement) => Promise<void>} fn
 * @param {string} [url]
 * @param {"normal" | "insert"} [mode] the mode the page opens in
 */
async function withPage(fn, url = PAGE, mode = "normal") {
  await SpecialPowers.pushPrefEnv({ set: [["general.smoothScroll", false]] });
  await BrowserTestUtils.withNewTab(url, async (browser) => {
    await recordPageKeys(browser);
    await focusContent(browser);
    await waitForMode(browser, mode);
    await fn(browser);
  });
}

/**
 * @param {XULBrowserElement} browser
 * @param {"normal" | "insert"} mode
 */
function waitForMode(browser, mode) {
  return TestUtils.waitForCondition(
    () => VimmaHost._browserMode(browser) === mode,
    `the tab is in ${mode} mode`,
  );
}

/** @param {XULBrowserElement | BrowsingContext} target */
function activeId(target) {
  return SpecialPowers.spawn(target, [], () => content.document.activeElement?.id ?? "");
}

/**
 * @param {XULBrowserElement | BrowsingContext} target
 * @param {string} id
 */
function waitForActive(target, id) {
  return TestUtils.waitForCondition(async () => (await activeId(target)) === id, `#${id} focused`);
}

/**
 * Focuses `#id` from the page's own script, with no user input.
 * @param {XULBrowserElement | BrowsingContext} target
 * @param {string} id
 */
function pageFocuses(target, id) {
  return SpecialPowers.spawn(target, [id], (i) => content.document.getElementById(i).focus());
}

/** @param {XULBrowserElement} browser */
function pageScrollY(browser) {
  return SpecialPowers.spawn(browser, [], () => content.scrollY);
}

/**
 * Leaves insert with Esc and waits for normal mode with nothing focused in the page.
 * @param {XULBrowserElement} browser
 */
async function leaveInsert(browser) {
  EventUtils.synthesizeKey("KEY_Escape");
  await waitForMode(browser, "normal");
}

// Behaviour 1: a page that moves focus off the field after `i` or `gi` does not end insert.
add_task(async function after_i_the_page_moving_focus_off_the_field_keeps_insert() {
  await withPage(async (browser) => {
    const tabs = gBrowser.tabs.length;
    EventUtils.synthesizeKey("i");
    await waitForMode(browser, "insert");
    await waitForActive(browser, "first");
    // The page's script answers "go" by focusing its result list, a file finder's pattern.
    EventUtils.sendString("go");
    await waitForActive(browser, "results");
    EventUtils.synthesizeKey("t");
    EventUtils.synthesizeKey("j");
    Assert.ok(await waitForPageKey(browser, ["j"]), "the page received j");
    Assert.equal(VimmaHost._browserMode(browser), "insert", "the tab is still in insert");
    Assert.deepEqual(await pageKeys(browser), ["g", "o", "t", "j"], "the page got every key");
    Assert.equal(gBrowser.tabs.length, tabs, "t opened no tab");
    Assert.equal(await pageScrollY(browser), 0, "j did not scroll");

    await leaveInsert(browser);
    EventUtils.synthesizeKey("j");
    await TestUtils.waitForCondition(
      async () => (await pageScrollY(browser)) === STEP,
      "j scrolls",
    );
  });
});

add_task(async function after_i_the_page_blurring_the_field_keeps_insert() {
  await withPage(async (browser) => {
    EventUtils.synthesizeKey("i");
    await waitForMode(browser, "insert");
    await waitForActive(browser, "first");
    await SpecialPowers.spawn(browser, [], () => content.document.activeElement.blur());
    EventUtils.synthesizeKey("j");
    Assert.ok(await waitForPageKey(browser, ["j"]), "j reached the page");
    Assert.equal(VimmaHost._browserMode(browser), "insert", "the tab is still in insert");
  });
});

add_task(async function after_i_on_a_page_with_no_field_a_page_focus_keeps_insert() {
  await withPage(async (browser) => {
    await SpecialPowers.spawn(browser, [], () => {
      for (const el of content.document.querySelectorAll("input, [contenteditable], iframe")) {
        el.remove();
      }
    });
    EventUtils.synthesizeKey("i");
    await waitForMode(browser, "insert");
    await pageFocuses(browser, "button");
    EventUtils.synthesizeKey("j");
    Assert.ok(await waitForPageKey(browser, ["j"]), "j reached the page");
    Assert.equal(VimmaHost._browserMode(browser), "insert", "the tab is still in insert");
  });
});

add_task(async function after_gi_the_page_moving_focus_off_the_field_keeps_insert() {
  await withPage(async (browser) => {
    EventUtils.synthesizeKey("2");
    EventUtils.synthesizeKey("g");
    EventUtils.synthesizeKey("i");
    await waitForMode(browser, "insert");
    await waitForActive(browser, "second");
    await pageFocuses(browser, "results");
    EventUtils.synthesizeKey("j");
    Assert.ok(await waitForPageKey(browser, ["j"]), "j reached the page");
    Assert.equal(VimmaHost._browserMode(browser), "insert", "the tab is still in insert");
  });
});

// Behaviour 3: `i` goes back to the field the user was last in.
add_task(async function i_focuses_the_field_last_used() {
  await withPage(async (browser) => {
    await pageFocuses(browser, "second");
    await waitForMode(browser, "insert");
    await leaveInsert(browser);
    EventUtils.synthesizeKey("i");
    await waitForMode(browser, "insert");
    await waitForActive(browser, "second");
  });
});

add_task(async function i_focuses_the_editor_last_used() {
  await withPage(async (browser) => {
    await pageFocuses(browser, "editor");
    await waitForMode(browser, "insert");
    await leaveInsert(browser);
    EventUtils.synthesizeKey("i");
    await waitForMode(browser, "insert");
    await waitForActive(browser, "editor");
  });
});

add_task(async function i_focuses_the_field_last_used_in_a_cross_origin_frame() {
  await withPage(async (browser) => {
    const frame = browser.browsingContext.children[0];
    await pageFocuses(frame, "framed");
    await waitForMode(browser, "insert");
    await leaveInsert(browser);
    EventUtils.synthesizeKey("i");
    await waitForMode(browser, "insert");
    await TestUtils.waitForCondition(
      () => Services.focus.focusedContentBrowsingContext === frame,
      "the frame has focus",
    );
    await waitForActive(frame, "framed");
    EventUtils.synthesizeKey("j");
    await TestUtils.waitForCondition(
      () => SpecialPowers.spawn(frame, [], () => content.document.activeElement.value === "j"),
      "j is typed into the frame's field",
    );
  });
});

add_task(async function i_falls_back_to_the_first_field_when_the_last_is_gone() {
  await withPage(async (browser) => {
    await pageFocuses(browser, "second");
    await waitForMode(browser, "insert");
    await leaveInsert(browser);
    await SpecialPowers.spawn(browser, [], () =>
      content.document.getElementById("second").remove(),
    );
    EventUtils.synthesizeKey("i");
    await waitForMode(browser, "insert");
    await waitForActive(browser, "first");
  });
});

// Behaviour 4: insert entered by focusing a field follows the focus.
add_task(async function an_autofocused_login_form_opens_in_insert_and_enter_keeps_it() {
  await withPage(
    async (browser) => {
      await waitForActive(browser, "user");
      EventUtils.synthesizeKey("KEY_Enter");
      await waitForActive(browser, "pass");
      EventUtils.synthesizeKey("j");
      await TestUtils.waitForCondition(
        () => SpecialPowers.spawn(browser, [], () => content.document.activeElement.value === "j"),
        "j is typed into the password field",
      );
      Assert.equal(VimmaHost._browserMode(browser), "insert", "the tab is in insert");
    },
    LOGIN,
    "insert",
  );
});

add_task(async function a_page_moving_focus_from_a_field_to_a_button_leaves_insert() {
  await withPage(
    async (browser) => {
      await pageFocuses(browser, "submit");
      await waitForMode(browser, "normal");
    },
    LOGIN,
    "insert",
  );
});

// Behaviour 2: explicit insert belongs to the page it was entered on.
add_task(async function explicit_insert_ends_with_the_page() {
  await withPage(async (browser) => {
    EventUtils.synthesizeKey("i");
    await waitForMode(browser, "insert");
    await waitForActive(browser, "first");
    const loaded = BrowserTestUtils.browserLoaded(browser, false, LOGIN);
    BrowserTestUtils.startLoadingURIString(browser, LOGIN);
    await loaded;
    await pageFocuses(browser, "submit");
    await waitForMode(browser, "normal");
  });
});
