# Spec: wake-lock

Status: done · Milestone: fix (after M5) · Area: `services/WakeLock.sys.mjs` (new), `vimma.js`,
`jar.mn`. No upstream patch.

## Problem

On Omarchy, the screensaver starts while a video is playing in Vimma. A playing video must keep
the screen awake.

## Diagnosis (Omarchy 4 on Hyprland, 2026-10-11)

- Omarchy's idle service (Quickshell `IdleMonitor`, `respectInhibitors: true`) starts the
  screensaver after `idle.screensaver` seconds unless a client holds a Wayland idle inhibitor
  (`zwp_idle_inhibitor_v1`). It does not listen on D-Bus; nothing owns
  `org.freedesktop.ScreenSaver` or `org.freedesktop.PowerManagement` in that session.
- Firefox picks its Linux wake lock in `widget/gtk/WakeLockListener.cpp` by trying, in order,
  FreeDesktopScreensaver, FreeDesktopPower, FreeDesktopPortal, GNOME, XScreenSaver,
  WaylandIdleInhibit, moving on only after a fatal D-Bus error. With `MOZ_LOG=LinuxWakeLock:5`,
  playing a video logged: both D-Bus services `ServiceUnknown`, then
  `InhibitFreeDesktopPortal(): inhibited, objpath to unihibit: …`.
- The portal routes Inhibit to xdg-desktop-portal-gtk, which inhibits through
  `org.freedesktop.ScreenSaver`, absent here. It still returns a request path, and Firefox takes
  the path as success without waiting for the request's `Response`. So Firefox believes it holds
  the lock and never reaches WaylandIdleInhibit.
- `hyprctl clients` showed `inhibitingIdle=false` for Vimma while the video played;
  with `MOZ_WAKE_LOCK_TYPE=WaylandIdleInhibit` it showed `true`.

## Decision

Vimma sets `MOZ_WAKE_LOCK_TYPE=WaylandIdleInhibit` in the parent process from `vimma.js`, before
any page plays, on Linux only and only when the user has not exported a value. This is Firefox's
own override, read when the first foreground wake lock is taken:

- a type the display does not offer (X11, or a compositor without idle-inhibit) falls back to
  Firefox's auto-detection, so nothing changes there;
- background wake locks (audio with the window hidden) ignore the variable and keep the D-Bus
  path, which Wayland's surface-bound inhibitor cannot serve;
- the inhibitor is tied to the focused window's surface, so the compositor honours it while that
  window is visible: a video on a hidden workspace no longer keeps the screen on.

No C++ patch: it would need a full build, artifact builds would not carry it (ADR-010), and the
upstream switch already exists.

## Tests

`tests/browser/browser_vimma_wake_lock.js`: the window's startup set the variable on Linux; a
user's own value wins; other platforms are left alone. The inhibitor itself needs a Wayland
compositor, which the Xvfb harness lacks; checked by hand with `hyprctl -j clients`
(`inhibitingIdle`) on a full build.
