/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Loaded by browser.xhtml (browser-xhtml.patch) right after browser-main.js.

{
  const { MozillaServices } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/services/MozillaServices.sys.mjs",
  );
  MozillaServices.init();

  // Once per process, before the host dispatches page keys (m1-actor-insert-scroll).
  const { VimmaActors } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/actors/VimmaActors.sys.mjs",
  );
  VimmaActors.register();

  const { VimmaHost } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
  );
  VimmaHost.init(window);

  // One control server per app (spec m0-control-server); off unless vimma.control.enabled.
  const { VimmaControl } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/ctl/VimmaControl.sys.mjs",
  );
  VimmaControl.init(window);
  window.addEventListener("unload", () => VimmaHost.uninit(window), { once: true });
}
