/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Keep the screen awake for video on Wayland (spec: docs/specs/wake-lock.md).

/**
 * Read by widget/gtk/WakeLockListener.cpp when the parent takes its first foreground wake lock;
 * a type the display lacks falls back to auto-detection there, so X11 is unaffected.
 */
const ENV = "MOZ_WAKE_LOCK_TYPE";

/**
 * Auto-detection tries D-Bus first and stops at the xdg portal, which answers Inhibit with a
 * request path even when its backend inhibits nothing (xdg-desktop-portal-gtk without an
 * org.freedesktop.ScreenSaver, as on Hyprland). The compositor's own idle-inhibit protocol is
 * what Hyprland and the idle daemons on it honour.
 */
const WAYLAND_IDLE_INHIBIT = "WaylandIdleInhibit";

export const WakeLock = {
  /**
   * Once per process, before any page plays video. A value the user exported wins.
   *
   * @param {{ platform?: string, env?: { get(name: string): string, set(name: string, value: string): void } }} [deps]
   */
  init({ platform, env = Services.env } = {}) {
    platform ??= ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs")
      .AppConstants.platform;
    if (platform !== "linux" || env.get(ENV)) {
      return;
    }
    env.set(ENV, WAYLAND_IDLE_INHIBIT);
  },
};
