/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Spec: docs/specs/m0-user-agent.md

"use strict";

/**
 * The UA's compatibility token: Firefox shows only the major Gecko version ("157.0"), the same
 * milestone `uaversion` the engine builds into "rv:" and "Firefox/". Derived from the platform
 * version so upstream bumps do not need a test change.
 */
const FIREFOX_TOKEN = `Firefox/${parseInt(Services.appinfo.platformVersion, 10)}.0`;

/**
 * @param {string} ua
 * @param {string} where
 */
function assertFirefoxUA(ua, where) {
  info(`${where} UA: ${ua}`);
  Assert.ok(ua.includes(FIREFOX_TOKEN), `${where} UA contains ${FIREFOX_TOKEN}`);
  Assert.ok(!ua.includes("Vimma"), `${where} UA has no Vimma token`);
  Assert.ok(ua.endsWith(` ${FIREFOX_TOKEN}`), `${where} UA ends with ${FIREFOX_TOKEN}`);
  Assert.ok(
    ua.includes(`rv:${parseInt(Services.appinfo.platformVersion, 10)}.0)`),
    `${where} UA has the Gecko rv: token`,
  );
}

add_task(async function chrome_user_agent_is_firefox() {
  assertFirefoxUA(navigator.userAgent, "chrome");
});

add_task(async function content_user_agent_is_firefox() {
  await BrowserTestUtils.withNewTab("https://example.com/", async (browser) => {
    const ua = await SpecialPowers.spawn(browser, [], () => content.navigator.userAgent);
    assertFirefoxUA(ua, "content");
  });
});
