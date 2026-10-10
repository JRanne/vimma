#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Prefs our branding file copies from upstream, checked against the imported engine (docs/
 * rebase.md, step 6; spec m7-upstream-autopilot). A stale copy silently shadows upstream's:
 * - the cfr provider (spec m0-mozilla-services): upstream's JSON with "enabled":false;
 * - the google4/google5 Safe Browsing lists (spec m0-safebrowsing-key): upstream's lists minus
 *   the two that only Mozilla's key may fetch.
 *
 *   node tools/upstream/upstream-prefs.mjs [--engine engine] [--ours FILE]
 *
 * Exit status: 0 up to date, 1 stale or missing (each with the line to paste), 2 unreadable.
 * e2e.yml runs it after `npm run import`, so the upstream autopilot's suites catch a stale copy.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const CFR = "browser.newtabpage.activity-stream.asrouter.providers.cfr";
export const SB_LISTS = [
  "browser.safebrowsing.provider.google4.lists",
  "browser.safebrowsing.provider.google5.lists",
];
/** Lists only Mozilla's own Safe Browsing key may fetch; one refused list fails every update. */
export const MOZILLA_KEY_LISTS = ["goog-badbinurl-proto", "goog-downloadwhite-proto"];
const OURS = "src/browser/branding/vimma/pref/firefox-branding.js";

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The string value of `pref("name", "…")` in a prefs file, or null when there is none.
 * @param {string} text
 * @param {string} name
 */
export function readPref(text, name) {
  const m = new RegExp(`^\\s*pref\\("${escapeRe(name)}",\\s*("(?:[^"\\\\]|\\\\.)*")\\);`, "m").exec(
    text,
  );
  return m?.[1] ? JSON.parse(m[1]) : null;
}

/**
 * @param {string} name
 * @param {string} value
 * @returns {string} a prefs-file line setting it
 */
export function prefLine(name, value) {
  return `pref("${name}", ${JSON.stringify(value)});`;
}

/**
 * @typedef {{ pref: string, ours: string | null, want: string | null,
 *   missing?: "upstream" | "ours" }} Problem
 */

/**
 * @param {{ firefoxJs: string, allJs: string, ours: string }} files
 * @returns {Problem[]} empty when every copy is current
 */
export function checkPrefs({ firefoxJs, allJs, ours }) {
  /** @type {Problem[]} */
  const problems = [];
  /**
   * @param {string} pref
   * @param {string | null} upstream
   * @param {(v: string) => string} derive
   * @param {(a: string, b: string) => boolean} same
   */
  const check = (pref, upstream, derive, same) => {
    const mine = readPref(ours, pref);
    if (upstream === null) {
      problems.push({ pref, ours: mine, want: null, missing: "upstream" });
      return;
    }
    const want = derive(upstream);
    if (mine === null) problems.push({ pref, ours: null, want, missing: "ours" });
    else if (!same(mine, want)) problems.push({ pref, ours: mine, want });
  };
  check(
    CFR,
    readPref(firefoxJs, CFR),
    (v) => JSON.stringify({ ...JSON.parse(v), enabled: false }),
    (a, b) => JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b)),
  );
  for (const pref of SB_LISTS) {
    check(
      pref,
      readPref(allJs, pref),
      (v) =>
        v
          .split(",")
          .filter((l) => !MOZILLA_KEY_LISTS.includes(l))
          .join(","),
      (a, b) => a === b,
    );
  }
  return problems;
}

function main() {
  const { values } = parseArgs({
    options: { engine: { type: "string", default: "engine" }, ours: { type: "string" } },
  });
  const engine = values.engine ?? "engine";
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const problems = checkPrefs({
    firefoxJs: readFileSync(join(engine, "browser/app/profile/firefox.js"), "utf8"),
    allJs: readFileSync(join(engine, "modules/libpref/init/all.js"), "utf8"),
    ours: readFileSync(values.ours ?? join(root, OURS), "utf8"),
  });
  if (problems.length === 0) {
    console.log("upstream-prefs: cfr provider and Safe Browsing lists up to date");
    return 0;
  }
  for (const p of problems) {
    if (p.missing === "upstream") {
      console.log(
        `upstream-prefs: ${p.pref} is gone upstream (renamed or removed): read the engine's ` +
          "prefs and the spec before changing ours (docs/rebase.md, step 6)",
      );
    } else {
      console.log(`upstream-prefs: ${p.pref} is ${p.missing ? "missing" : "stale"} in ${OURS}.`);
      console.log(`  Replace its line with (keep the // prettier-ignore above it):`);
      console.log(`  ${prefLine(p.pref, p.want ?? "")}`);
    }
  }
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`upstream-prefs: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
  }
}
