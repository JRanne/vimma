/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Shared by browser_vimma_updater.js and browser_vimma_system_addons.js (spec m0-updater).
// Loaded with Services.scriptloader.loadSubScript into the test's scope.

/* exported AUS_HOST, watchUpdateServer, settle */

"use strict";

const AUS_HOST = "aus5.mozilla.org";

/**
 * Records, and cancels before it connects, every request to Mozilla's update server, so a
 * regression fails the test instead of reaching the network (which the harness forbids).
 */
function watchUpdateServer() {
  /** @type {string[]} */
  const seen = [];
  const observer = {
    /** @param {nsISupports} subject */
    observe(subject) {
      const channel = subject.QueryInterface(Ci.nsIHttpChannel);
      if (channel.URI.host == AUS_HOST) {
        seen.push(channel.URI.spec);
        channel.cancel(Cr.NS_BINDING_ABORTED);
      }
    },
  };
  Services.obs.addObserver(observer, "http-on-opening-request");
  return {
    seen,
    stop: () => Services.obs.removeObserver(observer, "http-on-opening-request"),
  };
}

/** @param {number} ms */
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
