/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m2-statusbar-whichkey.md

"use strict";

const { getAction } = ChromeUtils.importESModule("chrome://browser/content/vimma/core/index.mjs");
const { VimmaHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
);

const $ = (/** @type {string} */ id) => document.getElementById(id);

function strip() {
  return $("vimma-whichkey");
}

function shown() {
  const s = strip();
  if (!s || s.hidden) return false;
  const r = s.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** @param {string} key formatKey text */
function entry(key) {
  return strip()?.querySelector(`[data-key="${CSS.escape(key)}"]`) ?? null;
}

function entries() {
  return [...(strip()?.querySelectorAll("[data-key]") ?? [])];
}

/** @param {() => boolean} cond @param {string} msg */
function until(cond, msg) {
  return TestUtils.waitForCondition(cond, msg, 50, 100);
}

function pendingText() {
  return $("vimma-statusbar")?.querySelector('[data-segment="pending"]')?.textContent ?? null;
}

registerCleanupFunction(() => {
  // Leave nothing pending for the next file.
  if (shown()) EventUtils.synthesizeKey("KEY_Escape");
  const help = $("vimma-help");
  if (help?.open) help.close();
});

add_task(async function nothing_pending_no_strip() {
  await until(() => !shown(), "no strip while nothing is pending");
});

add_task(async function prefix_shows_the_strip() {
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    EventUtils.synthesizeKey("b", { ctrlKey: true });
    await until(shown, "strip shown after ctrl+b");
    await until(() => pendingText() === "prefix", "the bar shows the pending prefix");
    const c = entry("c");
    Assert.ok(c, "lists c");
    Assert.ok(
      c.textContent.includes(getAction("new_tab").description),
      "with new_tab's description",
    );
    Assert.ok(entry("?"), "lists ?");
    const strip_ = strip().getBoundingClientRect();
    const barTop = $("vimma-statusbar").getBoundingClientRect().top;
    Assert.lessOrEqual(Math.abs(strip_.bottom - barTop), 1, "sits right above the status bar");
    EventUtils.synthesizeKey("KEY_Escape");
    await until(() => !shown(), "Esc hides the strip");
    await until(() => pendingText() === null, "and clears the pending segment");
  });
});

add_task(async function unbuilt_actions_are_greyed() {
  const runnable = VimmaHost.runnable();
  Assert.ok(runnable.has("help.show"), "help.show is runnable");
  EventUtils.synthesizeKey("b", { ctrlKey: true });
  await until(shown, "strip shown");
  Assert.ok(entries().length > 5, "several entries");
  Assert.equal(entry("?").getAttribute("aria-disabled"), null, "? is not greyed");
  let greyed = 0;
  for (const e of entries()) {
    const id = e.dataset.actionId;
    if (!id) continue; // a group entry: core decides from the actions below it
    const expected = !runnable.has(id);
    Assert.equal(
      e.getAttribute("aria-disabled") === "true",
      expected,
      `${e.dataset.key} (${id}) greyed iff the host cannot run it`,
    );
    if (expected) greyed++;
  }
  Assert.greater(greyed, 0, "unbuilt actions (panes, workspaces) are greyed");
  const dim = getComputedStyle(entries().find((e) => e.getAttribute("aria-disabled"))).color;
  Assert.notEqual(dim, getComputedStyle(entry("?")).color, "greyed entries look different");
  EventUtils.synthesizeKey("KEY_Escape");
  await until(() => !shown(), "hidden again");
});

add_task(async function second_key_hides_the_strip() {
  EventUtils.synthesizeKey("b", { ctrlKey: true });
  await until(shown, "strip shown");
  EventUtils.synthesizeKey("?", { shiftKey: true });
  await until(() => !shown(), "the second key hides the strip");
  await until(() => $("vimma-help")?.open, "and runs its action");
  EventUtils.synthesizeKey("KEY_Escape");
  await until(() => !$("vimma-help")?.open, "help closed");
});
