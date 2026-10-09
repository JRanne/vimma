/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m0-mozilla-services.md. Skipped on artifact builds (browser.toml, ADR-010):
// they run Mozilla's libxul, which has the crash reporter. Full builds run it: locally for now,
// and in nightly.yml once its runner is live.

"use strict";

const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");

add_task(function test_no_crash_reporter() {
  Assert.strictEqual(AppConstants.MOZ_CRASHREPORTER, false, "built without the crash reporter");
});
