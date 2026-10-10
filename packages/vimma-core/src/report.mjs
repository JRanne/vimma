/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * about:vimma's pure parts (spec docs/specs/m5-about-vimma.md): what a key event did, and the
 * redaction `:bug` applies before the report reaches the clipboard.
 */

import { trimTrailing } from "./strings.mjs";

/** @import { DispatchResult } from "./dispatcher.mjs" */

/** Any `scheme://…` up to whitespace: web pages, file:///, extensions. */
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S*?(?=[\s,;)\]]|[.,;:!?]?(?:\s|$))/gi;

/** A character `\w` matches. @param {string | undefined} c */
const isWordChar = (c) => c !== undefined && /\w/.test(c);

/**
 * Whether `home`, found at `at` in `text`, ends a whole path component there: what follows is
 * the end, a `/`, or a character that cannot continue a file name (`/home/alice` is not the home
 * in `/home/alicebob` or `/home/alice.bak`).
 * @param {string} text
 * @param {number} at
 * @param {string} home
 */
function homeEndsAt(text, at, home) {
  const next = text[at + home.length];
  if (next === undefined || next === "/") return true;
  if (isWordChar(next) || next === "." || next === "-") return false;
  return isWordChar(home.at(-1)); // the word boundary a `\b` would want
}

/**
 * The report as `:bug` copies it: every URL becomes `<url>` and every path under `home` starts
 * with `~`. Titles never enter the report, so there is nothing else to strip.
 * @param {string} text
 * @param {string} home  $HOME; "" leaves paths alone
 * @returns {string}
 */
export function redactReport(text, home) {
  const out = text.replace(URL_RE, "<url>");
  // Linear scans rather than a regular expression built from $HOME (CodeQL js/polynomial-redos).
  const h = trimTrailing(home, "/");
  if (!h) return out;
  let redacted = "";
  let from = 0;
  for (let at = out.indexOf(h); at !== -1; at = out.indexOf(h, at + 1)) {
    if (at < from || !homeEndsAt(out, at, h)) continue;
    redacted += `${out.slice(from, at)}~`;
    from = at + h.length;
  }
  return redacted + out.slice(from);
}

/**
 * What the dispatcher made of a key, for about:vimma's key log: the action id, or pass, cancel,
 * or `…` while a sequence is pending.
 * @param {Pick<DispatchResult, "kind"> & { action?: { id: string } }} result
 * @returns {string}
 */
export function describeOutcome(result) {
  if (result.kind === "action" && result.action) return result.action.id;
  if (result.kind === "pending") return "…";
  return result.kind;
}
