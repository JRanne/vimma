/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The update host for browser_vimma_update_check.js (docs/specs/m6a-updater.md): POST ?set
// stores the manifest to serve (an empty body answers 404); GET ?log returns every manifest
// request so far (its query and whether it carried a Cookie header); GET ?reset clears both.

const BinaryInputStream = Components.Constructor(
  "@mozilla.org/binaryinputstream;1",
  "nsIBinaryInputStream",
  "setInputStream",
);

const MANIFEST = "vimma-update-manifest";
const LOG = "vimma-update-log";

function handleRequest(request, response) {
  const query = request.queryString;
  response.setHeader("Cache-Control", "no-cache", false);
  if (query === "set") {
    const stream = new BinaryInputStream(request.bodyInputStream);
    const body = stream.available() ? stream.readBytes(stream.available()) : "";
    setSharedState(MANIFEST, body);
    response.write("ok");
    return;
  }
  if (query === "log") {
    response.setHeader("Content-Type", "application/json", false);
    response.write(getSharedState(LOG) || "[]");
    return;
  }
  if (query === "reset") {
    setSharedState(MANIFEST, "");
    setSharedState(LOG, "[]");
    response.write("ok");
    return;
  }
  const log = JSON.parse(getSharedState(LOG) || "[]");
  log.push({
    query,
    cookie: request.hasHeader("Cookie"),
    referer: request.hasHeader("Referer"),
  });
  setSharedState(LOG, JSON.stringify(log));
  const body = getSharedState(MANIFEST);
  if (!body) {
    response.setStatusLine(request.httpVersion, 404, "Not Found");
    return;
  }
  response.setHeader("Content-Type", "text/xml", false);
  response.write(body);
}
