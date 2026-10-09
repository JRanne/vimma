/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * about:vimma's pure parts (spec docs/specs/m5-about-vimma.md): what a key event did, and the
 * redaction `:bug` applies before the report reaches the clipboard.
 */

/** @import { DispatchResult } from "./dispatcher.mjs" */

/** Any `scheme://…` up to whitespace: web pages, file:///, extensions. */
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S*?(?=[\s,;)\]]|[.,;:!?]?(?:\s|$))/gi;

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The report as `:bug` copies it: every URL becomes `<url>` and every path under `home` starts
 * with `~`. Titles never enter the report, so there is nothing else to strip.
 * @param {string} text
 * @param {string} home  $HOME; "" leaves paths alone
 * @returns {string}
 */
export function redactReport(text, home) {
  let out = text.replace(URL_RE, "<url>");
  const h = home.replace(/\/+$/, "");
  if (h) out = out.replace(new RegExp(`${escapeRe(h)}(?=/|\\b|$)(?![\\w.-])`, "g"), "~");
  return out;
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
