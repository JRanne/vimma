/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Live grep's matching, off the page's thread (docs/specs/live-grep.md decision 14). A
// ChromeWorker per frame that has been searched: VimmaChild sends it the frame's text once per
// text model, then queries. A regular expression that backtracks without end cannot freeze the
// page: VimmaChild terminates this worker when its time budget runs out or a newer query comes.

import { GREP_CAPS, grepText, parseQuery } from "../core/grep.mjs";

const scope = /** @type {any} */ (globalThis);
let text = "";

/** @param {MessageEvent} event */
scope.onmessage = (event) => {
  const data = event.data;
  if (data?.type === "text" && typeof data.text === "string") {
    text = data.text;
    return;
  }
  if (data?.type !== "query" || typeof data.query !== "string") return;
  const query = parseQuery(data.query);
  const caps = data.all ? { ...GREP_CAPS, listed: GREP_CAPS.counted } : GREP_CAPS;
  const reply = query ? grepText(text, query, caps) : { count: 0, matches: [] };
  scope.postMessage({ id: data.id, reply });
};
