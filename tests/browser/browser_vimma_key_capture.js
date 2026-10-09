/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m0-key-capture.md

"use strict";

const { VimmaHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
);

registerCleanupFunction(() => {
  // ctrl+b still reaches Firefox in this spec and toggles the bookmarks sidebar.
  SidebarController.hide();
});

function clearChords() {
  VimmaHost._lastChords.length = 0;
}

/**
 * Resolves false if `promise` has not settled within `ms`, so a swallowed key fails as an
 * assertion instead of a harness timeout.
 */
function within(promise, ms) {
  return Promise.race([
    promise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

add_task(async function records_ctrl_b_in_about_preferences() {
  await BrowserTestUtils.withNewTab("about:preferences", async (browser) => {
    await SimpleTest.promiseFocus(browser.contentWindow);
    Assert.equal(
      Services.focus.focusedWindow,
      browser.contentWindow,
      "focus is inside about:preferences",
    );
    clearChords();
    EventUtils.synthesizeKey("b", { ctrlKey: true });
    Assert.deepEqual(VimmaHost._lastChords, ["ctrl+b"], "host recorded ctrl+b");
  });
});

add_task(async function records_j_in_content_and_page_still_receives_it() {
  await BrowserTestUtils.withNewTab("https://example.com/", async (browser) => {
    browser.focus();
    Assert.equal(document.activeElement, browser, "focus is in the content browser");
    clearChords();
    const received = BrowserTestUtils.waitForContentEvent(
      browser,
      "keydown",
      true,
      (e) => e.key === "j" && !e.defaultPrevented,
    );
    EventUtils.synthesizeKey("j");
    Assert.ok(await within(received, 5000), "page received j, not default-prevented");
    Assert.deepEqual(VimmaHost._lastChords, ["j"], "host recorded j");
  });
});

add_task(async function records_ctrl_b_in_url_bar() {
  gURLBar.focus();
  Assert.ok(gURLBar.focused, "URL bar is focused");
  clearChords();
  EventUtils.synthesizeKey("b", { ctrlKey: true });
  Assert.deepEqual(VimmaHost._lastChords, ["ctrl+b"], "host recorded ctrl+b");
});
