/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The harness loads this into every browser_*.js in this directory before the test runs.
//
// Keys sent to a page: set up first, then press (issues #14, #18). Two things are asynchronous
// relative to EventUtils.synthesizeKey and race it on a loaded runner:
// - BrowserTestUtils.waitForContentEvent installs its listener through sharedData.flush(), which
//   the content process picks up later, so the key can arrive before the listener exists.
// - browser.focus() moves chrome focus only; the content process takes focus later, and a key
//   sent before that never reaches the page.
// So: `await recordPageKeys(browser)` and `await focusContent(browser)`, then press, then
// `await waitForPageKey(...)` or `await pageKeys(browser)`.

/* exported focusContent, recordPageKeys, pageKeys, waitForPageKey, bindUnbuiltPrefixKey */

"use strict";

/**
 * Focuses `browser` and resolves once its content process has focus too, so a key synthesized
 * next reaches the page.
 * @param {XULBrowserElement} browser
 */
async function focusContent(browser) {
  await SimpleTest.promiseFocus(browser);
  Assert.equal(document.activeElement, browser, "focus is in the content browser");
  Assert.ok(
    await SpecialPowers.spawn(browser, [], () => content.document.hasFocus()),
    "the page has focus",
  );
}

/**
 * Records every keydown the page sees, in the capture phase on its window, as `key`, or `!key` if
 * something upstream prevented it. Resolves once the listener is in place in the content process.
 * @param {XULBrowserElement} browser
 */
async function recordPageKeys(browser) {
  await SpecialPowers.spawn(browser, [], () => {
    content.wrappedJSObject.vimmaKeys = [];
    content.addEventListener(
      "keydown",
      (e) => content.wrappedJSObject.vimmaKeys.push(e.defaultPrevented ? `!${e.key}` : e.key),
      true,
    );
  });
}

/**
 * The keys recordPageKeys has seen so far.
 * @param {XULBrowserElement} browser
 * @returns {Promise<string[]>}
 */
function pageKeys(browser) {
  return SpecialPowers.spawn(browser, [], () => [...content.wrappedJSObject.vimmaKeys]);
}

/**
 * Resolves true once recordPageKeys has seen one of `entries` (e.g. ["j"] for an unprevented j,
 * ["j", "!j"] for either), or false after `ms`, so a swallowed key fails an assertion instead of
 * timing out the whole file.
 * @param {XULBrowserElement} browser
 * @param {string[]} entries
 * @param {number} [ms]
 * @returns {Promise<boolean>}
 */
function waitForPageKey(browser, entries, ms = 5000) {
  return SpecialPowers.spawn(browser, [entries, ms], async (wanted, timeout) => {
    const interval = 50;
    try {
      await ContentTaskUtils.waitForCondition(
        () => [...content.wrappedJSObject.vimmaKeys].some((k) => wanted.includes(k)),
        `page saw one of ${wanted}`,
        interval,
        Math.ceil(timeout / interval),
      );
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Every default binding under ctrl+b runs since the side panel (m3-workspaces 6), so the tests
 * of the "not implemented yet" notice bind one the host has not built: `ctrl+b o` to
 * history_back ("Go back"), for the rest of the test file. Returns the notice text it gives.
 * @returns {string}
 */
function bindUnbuiltPrefixKey() {
  const { VimmaHost } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
  );
  const { compileKeymap } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/core/keymap.mjs",
  );
  VimmaHost.configure({ keymap: compileKeymap({ keys: { history_back: ["prefix+o"] } }) });
  registerCleanupFunction(() => VimmaHost.configure({ keymap: compileKeymap() }));
  return "Go back: not implemented yet";
}
