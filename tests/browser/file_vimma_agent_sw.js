/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Fixture for browser_vimma_mcp_agent_pages.js: answers file_vimma_agent_sw_page.html from the
// worker, so the document has no HTTP response (no http-on-examine-response).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.url.includes("file_vimma_agent_sw_page.html")) {
    e.respondWith(
      new Response("<!doctype html><title>from the worker</title><body>worker page</body>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
  }
});
