/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A download for browser_vimma_mcp_agent_pages.js: a small attachment.
function handleRequest(request, response) {
  response.setHeader("Content-Type", "application/octet-stream", false);
  response.setHeader("Content-Disposition", 'attachment; filename="vimma-agent-test.bin"', false);
  response.write("not for agents yet");
}
