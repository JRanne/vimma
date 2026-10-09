/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m1-actor-insert-scroll.md

/* global focusContent, recordPageKeys, pageKeys, waitForPageKey -- from head.js */

"use strict";

const { VimmaHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
);

const PAGE =
  getRootDirectory(gTestPath).replace("chrome://mochitests/content", "https://example.com") +
  "file_vimma_insert_scroll.html";

/** Vimma's j/k step (Vimium's scrollStepSize), in CSS pixels. */
const STEP = 60;

/** A bare key with no binding in normal mode: it reaches the page and flushes earlier events. */
const UNBOUND = "z";

/**
 * Opens the fixture in a new tab with content focus, records the page's keydowns and waits
 * for normal mode, then runs `fn`.
 * @param {(browser: XULBrowserElement) => Promise<void>} fn
 */
async function withPage(fn) {
  await SpecialPowers.pushPrefEnv({ set: [["general.smoothScroll", false]] });
  await BrowserTestUtils.withNewTab(PAGE, async (browser) => {
    await recordPageKeys(browser);
    await focusContent(browser);
    await waitForMode(browser, "normal");
    await fn(browser);
  });
}

/** @param {XULBrowserElement} browser */
function pageScrollY(browser) {
  return SpecialPowers.spawn(browser, [], () => content.scrollY);
}

/**
 * @param {XULBrowserElement} browser
 * @param {(y: number) => boolean} predicate
 * @param {string} msg
 */
function waitForScroll(browser, predicate, msg) {
  return TestUtils.waitForCondition(async () => predicate(await pageScrollY(browser)), msg);
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

/**
 * Presses the unbound key and returns every key the page has seen, which ends with it.
 * @param {XULBrowserElement} browser
 */
async function pageKeysThenUnbound(browser) {
  EventUtils.synthesizeKey(UNBOUND);
  Assert.ok(await waitForPageKey(browser, [UNBOUND]), `the page received ${UNBOUND}`);
  return pageKeys(browser);
}

/**
 * Focuses an element in the page by a selector run in its content process.
 * @param {XULBrowserElement | BrowsingContext} target
 * @param {string} how "id" for getElementById, "open"/"closed" for the shadow inputs
 */
function focusIn(target, how) {
  return SpecialPowers.spawn(target, [how], (h) => {
    const doc = content.document;
    if (h === "open") doc.getElementById("open-host").shadowRoot.getElementById("shadow").focus();
    else if (h === "closed") content.wrappedJSObject.closedRoot.getElementById("closed").focus();
    else doc.getElementById(h).focus();
  });
}

add_task(async function j_and_k_scroll_and_the_page_sees_neither() {
  await withPage(async (browser) => {
    EventUtils.synthesizeKey("j");
    await waitForScroll(browser, (y) => y === STEP, `j scrolls down ${STEP}px`);
    EventUtils.synthesizeKey("j");
    await waitForScroll(browser, (y) => y === 2 * STEP, "j again");
    EventUtils.synthesizeKey("k");
    await waitForScroll(browser, (y) => y === STEP, "k scrolls up");
    EventUtils.synthesizeKey("3");
    EventUtils.synthesizeKey("j");
    await waitForScroll(browser, (y) => y === 4 * STEP, "3j scrolls three steps");
    Assert.deepEqual(await pageKeysThenUnbound(browser), [UNBOUND], "the page saw no j, k or 3");
  });
});

add_task(async function G_goes_to_the_bottom_and_gg_to_the_top() {
  await withPage(async (browser) => {
    const max = await SpecialPowers.spawn(browser, [], () => content.scrollMaxY);
    Assert.greater(max, 10000, "the page is long");
    EventUtils.synthesizeKey("G", { shiftKey: true });
    await waitForScroll(browser, (y) => y === max, "G goes to the bottom");
    EventUtils.synthesizeKey("g");
    EventUtils.synthesizeKey("g");
    await waitForScroll(browser, (y) => y === 0, "gg goes to the top");
    Assert.deepEqual(await pageKeysThenUnbound(browser), [UNBOUND], "the page saw no G or g");
  });
});

add_task(async function d_and_u_scroll_half_a_page() {
  await withPage(async (browser) => {
    const half = await SpecialPowers.spawn(
      browser,
      [],
      () => content.document.scrollingElement.clientHeight / 2,
    );
    EventUtils.synthesizeKey("d");
    await waitForScroll(browser, (y) => Math.abs(y - half) <= 1, "d scrolls half a viewport");
    EventUtils.synthesizeKey("d");
    await waitForScroll(browser, (y) => Math.abs(y - 2 * half) <= 1, "d again");
    EventUtils.synthesizeKey("u");
    await waitForScroll(browser, (y) => Math.abs(y - half) <= 1, "u scrolls half a viewport up");
    Assert.deepEqual(await pageKeysThenUnbound(browser), [UNBOUND], "the page saw no d or u");
  });
});

add_task(async function an_input_enters_insert_and_esc_leaves_it() {
  await withPage(async (browser) => {
    await focusIn(browser, "text");
    await waitForMode(browser, "insert");
    EventUtils.synthesizeKey("j");
    Assert.ok(await waitForPageKey(browser, ["j"]), "the page received j");
    Assert.equal(
      await SpecialPowers.spawn(browser, [], () => content.document.getElementById("text").value),
      "j",
      "j is typed into the input",
    );
    Assert.equal(await pageScrollY(browser), 0, "and does not scroll");

    EventUtils.synthesizeKey("KEY_Escape");
    await waitForMode(browser, "normal");
    Assert.equal(
      await SpecialPowers.spawn(browser, [], () => content.document.activeElement.localName),
      "body",
      "Esc blurs the input",
    );
    EventUtils.synthesizeKey("j");
    await waitForScroll(browser, (y) => y === STEP, "j scrolls again");
    Assert.deepEqual(
      await pageKeysThenUnbound(browser),
      ["j", UNBOUND],
      "the page saw the typed j only, not Esc or the second j",
    );
  });
});

for (const how of ["area", "ce", "aria", "open", "closed"]) {
  add_task(async function editable_enters_insert() {
    info(`editable: ${how}`);
    await withPage(async (browser) => {
      await focusIn(browser, how);
      await waitForMode(browser, "insert");
      EventUtils.synthesizeKey("KEY_Escape");
      await waitForMode(browser, "normal");
      EventUtils.synthesizeKey("j");
      await waitForScroll(browser, (y) => y === STEP, `after ${how}, j scrolls`);
    });
  });
}

add_task(async function an_input_in_a_cross_origin_iframe_enters_insert() {
  await withPage(async (browser) => {
    const frame = browser.browsingContext.children[0];
    Assert.ok(frame, "the iframe has a browsing context");
    await focusIn(frame, "framed");
    await waitForMode(browser, "insert");
    EventUtils.synthesizeKey("j");
    await TestUtils.waitForCondition(
      async () =>
        (await SpecialPowers.spawn(
          frame,
          [],
          () => content.document.getElementById("framed").value,
        )) === "j",
      "j is typed into the framed input",
    );
    EventUtils.synthesizeKey("KEY_Escape");
    await waitForMode(browser, "normal");
    EventUtils.synthesizeKey("j");
    await waitForScroll(browser, (y) => y === STEP, "j scrolls the page after Esc");
  });
});

for (const id of ["check", "button"]) {
  add_task(async function a_control_leaves_insert() {
    info(`control: ${id}`);
    await withPage(async (browser) => {
      await focusIn(browser, "text");
      await waitForMode(browser, "insert");
      await focusIn(browser, id);
      await waitForMode(browser, "normal");
      EventUtils.synthesizeKey("j");
      await waitForScroll(browser, (y) => y === STEP, `with the ${id} focused, j scrolls`);
    });
  });
}

add_task(async function i_focuses_the_first_input_and_enters_insert() {
  await withPage(async (browser) => {
    EventUtils.synthesizeKey("i");
    await waitForMode(browser, "insert");
    Assert.equal(
      await SpecialPowers.spawn(browser, [], () => content.document.activeElement.id),
      "text",
      "i focuses the first text input",
    );
  });
});

add_task(async function insert_mode_is_per_tab() {
  await withPage(async (first) => {
    await focusIn(first, "text");
    await waitForMode(first, "insert");
    await BrowserTestUtils.withNewTab(PAGE, async (second) => {
      await focusContent(second);
      await waitForMode(second, "normal");
      Assert.equal(VimmaHost._browserMode(first), "insert", "the first tab stays in insert");
      EventUtils.synthesizeKey("j");
      await waitForScroll(second, (y) => y === STEP, "j scrolls the second tab");

      await BrowserTestUtils.switchTab(gBrowser, gBrowser.getTabForBrowser(first));
      await focusContent(first);
      await waitForMode(first, "insert");
      EventUtils.synthesizeKey("j");
      await TestUtils.waitForCondition(
        async () =>
          (await SpecialPowers.spawn(
            first,
            [],
            () => content.document.getElementById("text").value,
          )) === "j",
        "back in the first tab, j is typed into its input",
      );
      Assert.equal(await pageScrollY(first), 0, "and the first tab did not scroll");
      Assert.equal(VimmaHost._browserMode(second), "normal", "the second tab stays in normal");
    });
  });
});

add_task(async function the_actor_reaches_settings_and_the_pdf_viewer_but_not_data_urls() {
  const { VimmaActors } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/actors/VimmaActors.sys.mjs",
  );
  await BrowserTestUtils.withNewTab("about:preferences", async (browser) => {
    Assert.ok(VimmaActors.has(browser), "Settings (parent process) has the actor");
    await focusContent(browser);
    // Settings focuses its search box on load.
    await waitForMode(browser, "insert");
    EventUtils.synthesizeKey("KEY_Escape");
    await waitForMode(browser, "normal");
  });
  const pdf = PAGE.replace("file_vimma_insert_scroll.html", "file_vimma_test.pdf");
  await BrowserTestUtils.withNewTab(pdf, async (browser) => {
    Assert.ok(VimmaActors.has(browser), "the PDF viewer has the actor");
    Assert.equal(VimmaHost._browserMode(browser), "normal", "and starts in normal");
  });
  await BrowserTestUtils.withNewTab("data:text/html,<p>hi", async (browser) => {
    Assert.ok(!VimmaActors.has(browser), "a data: page has no actor");
    Assert.equal(VimmaHost._browserMode(browser), "insert", "so it stays in insert");
  });
});
