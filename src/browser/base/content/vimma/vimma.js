/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Loaded by browser.xhtml (browser-xhtml.patch) right after browser-main.js.

{
  const { MozillaServices } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/services/MozillaServices.sys.mjs",
  );
  MozillaServices.init();

  // The start page as the new-tab page, before this window opens its first tab (start-page).
  const { StartPage } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/start/StartPage.sys.mjs",
  );
  StartPage.init(window);

  // Once per process, before the host dispatches page keys (m1-actor-insert-scroll).
  const { VimmaActors } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/actors/VimmaActors.sys.mjs",
  );
  VimmaActors.register();

  // The theme tokens, before any UI uses them (m5-omarchy-theme): Tokyo Night now, the Omarchy
  // theme once read, then whatever omarchy-theme-set switches to.
  const { ThemeHost } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/ui/theme-host.mjs",
  );
  ThemeHost.init(window);

  const { VimmaHost } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/host/VimmaHost.sys.mjs",
  );
  VimmaHost.init(window);

  // The workspace definitions, once per app (m3-workspaces, sub-spec 2a): Tabbrowser-sys-mjs.patch
  // asks the store for the container of a tab or window opened without one. Not awaited: until
  // it is loaded, the store reads its file synchronously on the first such question.
  const { WorkspaceStore } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/workspaces/WorkspaceStore.sys.mjs",
  );
  WorkspaceStore.init().catch((e) => console.error("vimma: workspaces not loaded", e));

  // Split panes (spec m4-split-panes): the window's pane tree; sub-spec 3's keys drive it.
  const { PaneViews } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/split/PaneView.mjs",
  );
  PaneViews.init(window);

  // config.toml (spec m5-config-load), once its users exist: the keymap, [panes] max, hints,
  // [sites] and [theme]. Read asynchronously; until then the built-in defaults apply.
  const { ConfigHost } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/config/ConfigHost.sys.mjs",
  );
  ConfigHost.init(window);

  // One control server per app (spec m0-control-server); off unless vimma.control.enabled.
  const { VimmaControl } = ChromeUtils.importESModule(
    "chrome://browser/content/vimma/ctl/VimmaControl.sys.mjs",
  );
  VimmaControl.init(window);
  window.addEventListener("unload", () => VimmaHost.uninit(window), { once: true });
}
