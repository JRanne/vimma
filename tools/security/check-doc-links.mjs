#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// docs/security.md names the test behind each rule as a link whose text is a code span, the
// test's name, and whose target is the test file: [`test_handshake`](../tests/browser/x.js).
// This check (CI, lint/test job) fails when a linked file is gone or no longer has a test of
// that name, so the page cannot silently rot. Plain links must resolve to a file too.
//
//   node tools/security/check-doc-links.mjs [file.md ...]   (default: docs/security.md)

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The test names a file defines: mochitest `add_task(function name`, Vitest
 * `test("name"` / `it("name"` / `describe("name"` (and `test.each([...])("name"`), Rust
 * `#[test] fn name`.
 * @param {string} text  the file's source
 * @param {string} path  for the language
 * @returns {Set<string>}
 */
export function testNames(text, path) {
  const names = new Set();
  /** @param {RegExp} re */
  const collect = (re) => {
    for (const m of text.matchAll(re)) names.add(/** @type {string} */ (m.at(-1)));
  };
  if (path.endsWith(".rs")) {
    collect(/#\[test\]\s*(?:#\[[^\]]*\]\s*)*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g);
  } else if (path.endsWith(".py")) {
    collect(/^\s*def\s+(test\w*)\s*\(/gm);
  } else {
    collect(/\badd_task\(\s*(?:async\s+)?function\s*\*?\s*(\w+)/g);
    collect(/(?:\b(?:test|it|describe)|\]\))\(\s*"((?:[^"\\\n]|\\.)*)"/g);
    collect(/(?:\b(?:test|it|describe)|\]\))\(\s*'((?:[^'\\\n]|\\.)*)'/g);
    collect(/(?:\b(?:test|it|describe)|\]\))\(\s*`([^`$\\]*)`/g);
  }
  return names;
}

/**
 * Markdown links outside fenced code: `[text](target)`, with their line.
 * @param {string} md
 * @returns {{ text: string, target: string, line: number }[]}
 */
export function markdownLinks(md) {
  const links = [];
  let fenced = false;
  for (const [i, line] of md.split("\n").entries()) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const m of line.matchAll(/\[((?:`[^`]*`|[^\]])*)\]\(([^)\s]+)\)/g)) {
      links.push({
        text: /** @type {string} */ (m[1]),
        target: /** @type {string} */ (m[2]),
        line: i + 1,
      });
    }
  }
  return links;
}

/**
 * Problems with the links of `mdPath`, as "file:line: message"; and how many test links
 * were checked.
 * @param {string} mdPath  absolute
 * @returns {{ problems: string[], tests: number }}
 */
export function checkFile(mdPath) {
  const md = readFileSync(mdPath, "utf8");
  const problems = [];
  let tests = 0;
  const where = (/** @type {number} */ line) => `${relative(ROOT, mdPath)}:${line}`;
  for (const { text, target, line } of markdownLinks(md)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue; // URL, anchor
    const file = resolve(dirname(mdPath), target.replace(/#.*$/, ""));
    if (!existsSync(file)) {
      problems.push(`${where(line)}: ${target} does not exist`);
      continue;
    }
    const code = /^`([^`]+)`$/.exec(text);
    if (!code) continue;
    tests++;
    if (!statSync(file).isFile()) {
      problems.push(`${where(line)}: ${target} is not a file, so it has no test ${text}`);
      continue;
    }
    const name = /** @type {string} */ (code[1]);
    if (!testNames(readFileSync(file, "utf8"), file).has(name)) {
      problems.push(`${where(line)}: ${target} has no test named "${name}"`);
    }
  }
  return { problems, tests };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  const paths = (files.length ? files : ["docs/security.md"]).map((f) => resolve(ROOT, f));
  let failed = false;
  for (const path of paths) {
    const { problems, tests } = checkFile(path);
    for (const p of problems) console.error(p);
    if (tests === 0) {
      console.error(`${relative(ROOT, path)}: no test links found; the check would be vacuous`);
      failed = true;
    }
    if (problems.length) failed = true;
    else console.log(`${relative(ROOT, path)}: ${tests} test links resolve`);
  }
  process.exit(failed ? 1 : 0);
}
