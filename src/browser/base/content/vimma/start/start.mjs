/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The start page's theme tokens (spec: docs/specs/start-page.md): the status bar's built-in
// theme (ui/statusbar.mjs), so the page matches the bar. start.css falls back to the same
// values until this runs, so the first paint already has them.

import { resolveTheme, tokensToCss } from "../core/theme.mjs";

const { tokens } = resolveTheme({ theme: { source: "file", font: "monospace", colors: {} } });
const style = document.createElement("style");
style.textContent = tokensToCss(tokens, ":root");
document.head.append(style);
