/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Loaded by browser.xhtml (browser-xhtml.patch) right after browser-main.js.

{
  const { MozillaServices } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/services/MozillaServices.sys.mjs",
  );
  MozillaServices.applyUserDefaults();

  const { VimmaHost } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
  );
  VimmaHost.init(window);
  window.addEventListener("unload", () => VimmaHost.uninit(window), { once: true });
}
