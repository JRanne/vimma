/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The start page's theme tokens (spec: docs/specs/start-page.md): the app's theme host
// (ui/theme-host.mjs, spec m5-omarchy-theme) adds them and rewrites them when the Omarchy
// theme changes, so the page matches the bar. start.css falls back to Tokyo Night until this
// runs, so the first paint already has colours.

const { ThemeHost } = ChromeUtils.importESModule(
  "chrome://browser/content/vimma/ui/theme-host.mjs",
);
ThemeHost.attachDocument(document);
