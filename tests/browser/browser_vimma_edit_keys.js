/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/key-handling-batch.md § 2. In text fields ctrl+w deletes the word before the
// caret, ctrl+u everything before it on the line, ctrl+h one character, with the editor's own
// commands so ctrl+z undoes them: in a page's input, textarea, contenteditable and frame, in the
// URL bar and on the `:` line. A page that takes the key keeps it; [modal] insert_editing =
// false turns them off (Firefox's own ctrl+w stays off). Normal mode keeps ctrl+u and ctrl+w.

"use strict";

/* global focusContent, recordPageKeys, waitForPageKey -- from head.js */

const { VimmaHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
);

const ROOT = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com",
);
const PAGE = ROOT + "file_vimma_insert_scroll.html";

/**
 * Sets a text field's value with the caret at its end, focused, in insert mode.
 * @param {XULBrowserElement | BrowsingContext} target
 * @param {string} id
 * @param {string} text
 */
function fill(target, id, text) {
  return SpecialPowers.spawn(target, [id, text], (i, t) => {
    const el = content.document.getElementById(i);
    el.focus();
    if ("value" in el && el.localName !== "div") {
      el.value = t;
      el.setSelectionRange(t.length, t.length);
    } else {
      el.textContent = t;
      const sel = content.getSelection();
      sel.collapse(el.firstChild, t.length);
    }
  });
}

/**
 * A field's text; a contenteditable's trailing space, which its editor keeps as a no-break
 * space, as a space.
 * @param {XULBrowserElement | BrowsingContext} target
 * @param {string} id
 */
function fieldText(target, id) {
  return SpecialPowers.spawn(target, [id], (i) => {
    const el = content.document.getElementById(i);
    return "value" in el && el.localName !== "div"
      ? el.value
      : el.textContent.replace(/\u00a0/g, " ");
  });
}

/**
 * @param {XULBrowserElement | BrowsingContext} target
 * @param {string} id
 * @param {string} want
 * @param {string} msg
 */
function waitForValue(target, id, want, msg) {
  return TestUtils.waitForCondition(async () => (await fieldText(target, id)) === want, msg);
}

/** ctrl+z, undo, as Firefox binds it. */
const undo = () => EventUtils.synthesizeKey("z", { accelKey: true });

/** @param {(browser: XULBrowserElement) => Promise<void>} fn */
async function withPage(fn) {
  await BrowserTestUtils.withNewTab(PAGE, async (browser) => {
    await recordPageKeys(browser);
    await focusContent(browser);
    await TestUtils.waitForCondition(() => VimmaHost._browserMode(browser) === "normal", "normal");
    await fn(browser);
  });
}

for (const id of ["text", "area", "ce"]) {
  add_task(async function ctrl_w_u_h_edit_and_undo_in_a_page_field() {
    await withPage(async (browser) => {
      await fill(browser, id, "foo bar baz");
      await TestUtils.waitForCondition(() => VimmaHost._browserMode(browser) === "insert", "i");
      EventUtils.synthesizeKey("w", { ctrlKey: true });
      await waitForValue(browser, id, "foo bar ", `#${id}: ctrl+w deletes the last word`);
      undo();
      await waitForValue(browser, id, "foo bar baz", `#${id}: ctrl+z brings it back`);
      EventUtils.synthesizeKey("u", { ctrlKey: true });
      await waitForValue(browser, id, "", `#${id}: ctrl+u deletes to the line's start`);
      undo();
      await waitForValue(browser, id, "foo bar baz", `#${id}: ctrl+z undoes ctrl+u`);
      EventUtils.synthesizeKey("h", { ctrlKey: true });
      await waitForValue(browser, id, "foo bar ba", `#${id}: ctrl+h deletes a character`);
      Assert.equal(VimmaHost._browserMode(browser), "insert", "still in insert mode");
      Assert.ok(gBrowser.selectedBrowser === browser, "and the tab is still open");
    });
  });
}

add_task(async function ctrl_w_in_a_cross_origin_frame() {
  await withPage(async (browser) => {
    const frame = browser.browsingContext.children[0];
    await SpecialPowers.spawn(frame, [], async () => {
      await ContentTaskUtils.waitForCondition(() => content.document.getElementById("framed"));
    });
    await fill(frame, "framed", "one two");
    await TestUtils.waitForCondition(() => VimmaHost._browserMode(browser) === "insert", "i");
    EventUtils.synthesizeKey("w", { ctrlKey: true });
    await waitForValue(frame, "framed", "one ", "ctrl+w deletes the word in the frame's input");
  });
});

add_task(async function a_page_that_takes_ctrl_w_keeps_it() {
  await withPage(async (browser) => {
    await SpecialPowers.spawn(browser, [], () => {
      content.document.getElementById("text").addEventListener("keydown", (e) => {
        if (e.ctrlKey) e.preventDefault();
      });
    });
    await fill(browser, "text", "foo bar");
    await TestUtils.waitForCondition(() => VimmaHost._browserMode(browser) === "insert", "i");
    EventUtils.synthesizeKey("w", { ctrlKey: true });
    EventUtils.synthesizeKey("x");
    await waitForValue(browser, "text", "foo barx", "the page's ctrl+w deleted nothing");
  });
});

add_task(async function normal_mode_keeps_ctrl_u_and_does_not_edit() {
  await withPage(async (browser) => {
    await fill(browser, "text", "foo bar");
    await TestUtils.waitForCondition(() => VimmaHost._browserMode(browser) === "insert", "i");
    EventUtils.synthesizeKey("KEY_Escape");
    await TestUtils.waitForCondition(() => VimmaHost._browserMode(browser) === "normal", "Esc");
    await SpecialPowers.spawn(browser, [], () => content.scrollTo(0, 3000));
    EventUtils.synthesizeKey("u", { ctrlKey: true });
    await TestUtils.waitForCondition(
      async () => (await SpecialPowers.spawn(browser, [], () => content.scrollY)) < 3000,
      "ctrl+u scrolls up half a page in normal mode",
    );
    Assert.equal(await fieldText(browser, "text"), "foo bar", "and edits nothing");
  });
});

add_task(async function the_url_bar() {
  await withPage(async () => {
    gURLBar.focus();
    gURLBar.value = "foo bar";
    gURLBar.inputField.setSelectionRange(7, 7);
    EventUtils.synthesizeKey("w", { ctrlKey: true });
    Assert.equal(gURLBar.value, "foo ", "ctrl+w deletes the word in the URL bar");
    undo();
    Assert.equal(gURLBar.value, "foo bar", "ctrl+z undoes it");
    EventUtils.synthesizeKey("h", { ctrlKey: true });
    Assert.equal(gURLBar.value, "foo ba", "ctrl+h is a backspace");
    EventUtils.synthesizeKey("u", { ctrlKey: true });
    Assert.equal(gURLBar.value, "", "ctrl+u clears to the start");
    gURLBar.handleRevert();
    EventUtils.synthesizeKey("KEY_Escape");
  });
});

add_task(async function the_command_line() {
  await withPage(async () => {
    EventUtils.synthesizeKey(":");
    const input = await TestUtils.waitForCondition(
      () => document.getElementById("vimma-cmdline-input"),
      "the : line opens",
    );
    await TestUtils.waitForCondition(() => document.activeElement === input, "and has focus");
    EventUtils.sendString("open foo bar");
    EventUtils.synthesizeKey("w", { ctrlKey: true });
    Assert.equal(input.value, "open foo ", "ctrl+w deletes a word on the : line");
    undo();
    Assert.equal(input.value, "open foo bar", "ctrl+z undoes it");
    EventUtils.synthesizeKey("h", { ctrlKey: true });
    Assert.equal(input.value, "open foo ba", "ctrl+h");
    EventUtils.synthesizeKey("u", { ctrlKey: true });
    Assert.equal(input.value, "", "ctrl+u");
    EventUtils.synthesizeKey("KEY_Escape");
  });
});

add_task(async function insert_editing_false_turns_them_off() {
  VimmaHost.configure({ insertEditing: false });
  registerCleanupFunction(() => VimmaHost.configure({ insertEditing: true }));
  await withPage(async (browser) => {
    await fill(browser, "text", "foo bar");
    await TestUtils.waitForCondition(() => VimmaHost._browserMode(browser) === "insert", "i");
    EventUtils.synthesizeKey("w", { ctrlKey: true });
    Assert.ok(await waitForPageKey(browser, ["w"]), "the page got ctrl+w");
    EventUtils.synthesizeKey("x");
    await waitForValue(browser, "text", "foo barx", "ctrl+w deleted nothing");
    Assert.ok(gBrowser.selectedBrowser === browser, "and Firefox's close tab stayed off");

    gURLBar.focus();
    gURLBar.value = "foo bar";
    EventUtils.synthesizeKey("w", { ctrlKey: true });
    Assert.equal(gURLBar.value, "foo bar", "nor in the URL bar");
    gURLBar.handleRevert();
  });
  VimmaHost.configure({ insertEditing: true });
});
