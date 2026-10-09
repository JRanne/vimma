/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m0-help-overlay.md

"use strict";

const { bindingTable, compileKeymap, filterBindings } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/core/index.mjs",
);

const OVERLAY_ID = "vimma-help";
const TEST_ROOT = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com",
);

registerCleanupFunction(() => {
  // If a test fails half-way, do not leave the modal overlay over the next test file.
  overlay()?.close();
  SidebarController.hide();
});

function overlay() {
  return /** @type {HTMLDialogElement | null} */ (document.getElementById(OVERLAY_ID));
}

function isShown() {
  const o = overlay();
  return !!o && o.open && BrowserTestUtils.isVisible(o);
}

function filterInput() {
  return overlay().querySelector("input");
}

/** Action names of the rows a user can see. */
function visibleNames() {
  return [...overlay().querySelectorAll("[data-action]")]
    .filter((row) => BrowserTestUtils.isVisible(row))
    .map((row) => row.dataset.action);
}

function pressPrefixQuestionMark() {
  EventUtils.synthesizeKey("b", { ctrlKey: true });
  EventUtils.synthesizeKey("?", { shiftKey: true });
}

async function openHelp() {
  pressPrefixQuestionMark();
  await TestUtils.waitForCondition(isShown, "help overlay opens on ctrl+b ?");
}

async function closeHelp() {
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !isShown(), "help overlay closes on Esc");
}

/** Like pdfjs/test/head.js waitForPdfJS: resolves once the text layer has rendered. */
function loadPdf(browser, url) {
  const rendered = BrowserTestUtils.waitForContentEvent(
    browser,
    "textlayerrendered",
    false,
    null,
    true,
  );
  BrowserTestUtils.startLoadingURIString(browser, url);
  return rendered;
}

add_task(async function shows_bindings_over_about_preferences() {
  await BrowserTestUtils.withNewTab("about:preferences", async (browser) => {
    await SimpleTest.promiseFocus(browser.contentWindow);
    await openHelp();
    Assert.ok(visibleNames().includes("new_tab"), "overlay lists new_tab");
    Assert.ok(
      overlay().querySelector('[data-action="new_tab"]').textContent.includes("prefix+c"),
      "new_tab row shows its binding",
    );
    await closeHelp();
  });
});

add_task(async function shows_bindings_over_the_pdf_viewer() {
  await BrowserTestUtils.withNewTab("about:blank", async (browser) => {
    await loadPdf(browser, TEST_ROOT + "file_vimma_test.pdf");
    const isPdfJs = await SpecialPowers.spawn(
      browser,
      [],
      () => !!content.document.querySelector("div#viewer"),
    );
    Assert.ok(isPdfJs, "the PDF is open in pdf.js");
    browser.focus();
    await openHelp();
    Assert.ok(visibleNames().includes("new_tab"), "overlay lists new_tab over pdf.js");
    await closeHelp();
  });
});

add_task(async function slash_filters_the_rows() {
  await BrowserTestUtils.withNewTab("https://example.com/", async (browser) => {
    browser.focus();
    await openHelp();
    EventUtils.synthesizeKey("/");
    Assert.equal(document.activeElement, filterInput(), "/ focuses the filter input");
    EventUtils.sendString("rename");
    Assert.equal(filterInput().value, "rename", "typed text lands in the filter, without the /");

    const expected = filterBindings(bindingTable(compileKeymap()), "rename").map((r) => r.name);
    Assert.ok(expected.includes("rename_tab"), "sanity: rename_tab matches rename");
    Assert.deepEqual(visibleNames(), expected, "only rows matching rename are shown");
    Assert.ok(!visibleNames().includes("new_tab"), "new_tab is filtered out");

    await closeHelp();
    Assert.equal(document.activeElement, browser, "Esc from the filter returns focus to content");
  });
});

add_task(async function esc_closes_and_restores_focus() {
  await BrowserTestUtils.withNewTab("about:preferences", async (browser) => {
    await SimpleTest.promiseFocus(browser.contentWindow);
    const searchInput = browser.contentDocument.getElementById("searchInput");
    searchInput.focus();
    const before = Services.focus.focusedElement;
    Assert.ok(
      before && (before === searchInput || searchInput.shadowRoot?.contains(before)),
      `focus starts in the preferences search box (got ${before?.localName})`,
    );

    await openHelp();
    Assert.ok(overlay().contains(Services.focus.focusedElement), "the overlay has focus");

    await closeHelp();
    Assert.equal(Services.focus.focusedElement, before, "focus returns to the search box");
  });
});

add_task(async function help_show_while_open_closes_it() {
  await BrowserTestUtils.withNewTab("https://example.com/", async (browser) => {
    browser.focus();
    await openHelp();
    pressPrefixQuestionMark();
    await TestUtils.waitForCondition(() => !isShown(), "ctrl+b ? toggles the overlay");
    Assert.equal(document.activeElement, browser, "focus returns to content");
  });
});

add_task(async function page_receives_no_keydown_for_the_chord() {
  await BrowserTestUtils.withNewTab("https://example.com/", async (browser) => {
    await SpecialPowers.spawn(browser, [], () => {
      content.wrappedJSObject.vimmaKeys = [];
      content.addEventListener(
        "keydown",
        (e) => content.wrappedJSObject.vimmaKeys.push(e.key),
        true,
      );
    });
    browser.focus();
    await openHelp();
    await closeHelp();

    // A key that is not ours proves the listener works and flushes any in-flight events.
    const sentinel = BrowserTestUtils.waitForContentEvent(browser, "keydown", true, (e) => {
      return e.key === "j";
    });
    EventUtils.synthesizeKey("j");
    await sentinel;
    const keys = await SpecialPowers.spawn(browser, [], () => [
      ...content.wrappedJSObject.vimmaKeys,
    ]);
    Assert.deepEqual(keys, ["j"], "the page saw neither ctrl+b nor ? (nor Esc)");
    Assert.ok(!SidebarController.isOpen, "ctrl+b no longer toggles the bookmarks sidebar");
  });
});
