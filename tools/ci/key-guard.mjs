#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Does this pull request change Mozilla's pinned release key? (ADR-021, docs/security.md B1.)
// Every Firefox source tarball is trusted because Mozilla's release key, pinned in
// tools/upstream/mozilla-release-key.asc and by PINNED_FINGERPRINT in verify-sha512.py, signed
// its SHA512SUMS. A pull request that changes either fails this check unless it carries the
// key-rotation-approved label, which only people with triage access or more can add, so a key
// change cannot merge unnoticed inside an unrelated change (docs/runbook.md, "Mozilla's release
// key").
//
//   PR_LABELS='["..."]' node tools/ci/key-guard.mjs --base <sha> --head <sha>
//       exit 0: no key change, or one with the label; 1: a key change without the label;
//       2: the check could not run (bad arguments, labels or git)
//
// key-guard.yml runs this file as the base branch has it (`git show "$BASE:..."`), so a pull
// request cannot weaken the check by editing it. Node built-ins only: the copy runs from outside
// the checkout.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const KEY_PATH = "tools/upstream/mozilla-release-key.asc";
export const VERIFIER_PATH = "tools/upstream/verify-sha512.py";
export const APPROVAL_LABEL = "key-rotation-approved";

/**
 * The names whose lines in the verifier decide which key is trusted: the pinned primary
 * fingerprint and the key file it is read from. Every line that names one counts, not only the
 * assignment, so a second assignment, a changed default argument or a redirected key file is a
 * key change too. A comment that names one counts as well; that costs a label now and then and
 * keeps the rule free of a Python parser.
 */
const PINNED_NAME = /\b(?:PINNED_FINGERPRINT|KEY_FILE)\b/;

/**
 * @param {string | null} verifier  verify-sha512.py's text, or null when the file is missing
 * @returns {string[] | null}
 */
export function pinnedLines(verifier) {
  if (verifier === null) return null;
  return verifier.split("\n").filter((line) => PINNED_NAME.test(line));
}

/**
 * @typedef {{ key: string | null, verifier: string | null }} Side
 *   the two files' text at one commit; null when the file is missing there
 */

/**
 * What the pull request changes in the key material, one line per changed file.
 * @param {Side} before  at the merge base
 * @param {Side} after  at the head
 * @returns {string[]}
 */
export function keyChanges(before, after) {
  /** @type {string[]} */
  const changes = [];
  if (before.key !== after.key) {
    const how = after.key === null ? "deleted" : before.key === null ? "added" : "changed";
    changes.push(`${KEY_PATH} ${how}`);
  }
  const was = pinnedLines(before.verifier);
  const is = pinnedLines(after.verifier);
  if (JSON.stringify(was) !== JSON.stringify(is)) {
    changes.push(
      is === null
        ? `${VERIFIER_PATH} deleted or moved`
        : `${VERIFIER_PATH}: a line that names PINNED_FINGERPRINT or KEY_FILE changed`,
    );
  }
  return changes;
}

/**
 * The pull request's labels, as `toJSON(github.event.pull_request.labels.*.name)` gives them.
 * @param {string | undefined} json
 * @returns {string[]}
 */
export function parseLabels(json) {
  const labels = JSON.parse(json ?? "");
  if (!Array.isArray(labels) || !labels.every((l) => typeof l === "string"))
    throw new Error(`PR_LABELS is not a JSON list of label names: ${JSON.stringify(json)}`);
  return labels;
}

/**
 * @param {readonly string[]} changes  from keyChanges
 * @param {readonly string[]} labels
 * @returns {{ ok: boolean, message: string }}
 */
export function verdict(changes, labels) {
  if (changes.length === 0)
    return { ok: true, message: "The pull request leaves Mozilla's pinned release key alone." };
  const list = changes.map((c) => `  - ${c}`).join("\n");
  if (labels.includes(APPROVAL_LABEL))
    return {
      ok: true,
      message: `The pull request changes Mozilla's pinned release key, approved by the ${APPROVAL_LABEL} label:\n${list}`,
    };
  return {
    ok: false,
    message:
      `The pull request changes Mozilla's pinned release key:\n${list}\n` +
      `A maintainer adds the ${APPROVAL_LABEL} label after checking the change against ` +
      `Mozilla's announcement (docs/runbook.md, "Mozilla's release key"; ADR-021).`,
  };
}

/**
 * A file's text at a commit, or null when the commit does not have it.
 * @param {string} rev
 * @param {string} path
 * @param {string} cwd
 */
function fileAt(rev, path, cwd) {
  try {
    execFileSync("git", ["cat-file", "-e", `${rev}:${path}`], { cwd, stdio: "ignore" });
  } catch {
    return null;
  }
  return execFileSync("git", ["cat-file", "blob", `${rev}:${path}`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * The key material at the merge base of `base` and `head`, and at `head`: the pull request's own
 * changes, so a branch made before an approved rotation landed on main does not fail for it.
 * @param {string} base
 * @param {string} head
 * @param {string} [cwd]
 * @returns {{ before: Side, after: Side }}
 */
export function sides(base, head, cwd = process.cwd()) {
  for (const sha of [base, head])
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a commit hash: ${JSON.stringify(sha)}`);
  const mergeBase = execFileSync("git", ["merge-base", base, head], {
    cwd,
    encoding: "utf8",
  }).trim();
  /** @param {string} rev @returns {Side} */
  const at = (rev) => ({
    key: fileAt(rev, KEY_PATH, cwd),
    verifier: fileAt(rev, VERIFIER_PATH, cwd),
  });
  return { before: at(mergeBase), after: at(head) };
}

/** @param {string[]} argv @returns {number} */
function main(argv) {
  /** @param {string} name */
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? "") : "";
  };
  const labels = parseLabels(process.env.PR_LABELS);
  const { before, after } = sides(arg("--base"), arg("--head"));
  const { ok, message } = verdict(keyChanges(before, after), labels);
  (ok ? console.log : console.error)(message);
  return ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let status;
  try {
    status = main(process.argv.slice(2));
  } catch (err) {
    console.error(`key-guard: ${err instanceof Error ? err.message : err}`);
    status = 2;
  }
  process.exit(status);
}
