#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# vimma-open: the desktop entry's launcher (spec docs/specs/workspace-routing.md, decision 6).
# Another app opens a link by running the browser's desktop entry (`vimma-open %u`); the running
# Vimma gets the command line over D-Bus with nothing about who sent it. This walks the parent
# processes in /proc, past openers, wrappers and shells, to the first other process (slack,
# discord, alacritty, nvim), and runs `vimma -vimma-from <app> <url>` with VIMMA_FROM=<app> (read
# by a Vimma that this call starts) so `[[routes]] app = "..."` rules can apply. The name is a
# hint: only a lower-case token is passed, and Vimma checks it again. When no app is known (a
# Flatpak app behind the portal, an app systemd started, a parent already gone), or the arguments
# are not exactly one URL, it runs `vimma "$@"` unchanged.
#
# VIMMA_BIN (the browser), VIMMA_OPEN_PROC and VIMMA_OPEN_PPID (a fake /proc, for tests) override.

proc=${VIMMA_OPEN_PROC:-/proc}

# The browser: VIMMA_BIN, else the vimma next to this script (the packages install both in one
# directory), else vimma on PATH.
bin=${VIMMA_BIN:-}
if [ -z "$bin" ]; then
  here=$(dirname "$(readlink -f "$0")")
  if [ -x "$here/vimma" ]; then bin="$here/vimma"; else bin=vimma; fi
fi

# Openers, wrappers and shells between the app and us (comm, at most 15 bytes).
skip() {
  case "$1" in
    xdg-open | gio | gio-launch-desk* | gtk-launch | kde-open | kde-open5 | kde-open6) return 0 ;;
    kioclient* | exo-open | exo-helper-* | gnome-open | gvfs-open | wslview) return 0 ;;
    sensible-browse* | x-www-browser | www-browser | vimma | vimma-open) return 0 ;;
    sh | bash | dash | zsh | fish | ksh | mksh | busybox | env | nohup | setsid | timeout) return 0 ;;
  esac
  return 1
}

# Where the trail ends with no app: init, systemd, the document portal.
stop() {
  case "$1" in
    systemd | init | xdg-desktop-por* | flatpak-portal | flatpak-session*) return 0 ;;
  esac
  return 1
}

app=""
pid=${VIMMA_OPEN_PPID:-$PPID}
steps=0
while [ "$steps" -lt 16 ] && [ "$pid" -gt 1 ] 2>/dev/null; do
  steps=$((steps + 1))
  stat=$(cat "$proc/$pid/stat" 2>/dev/null) || break
  # "pid (comm) state ppid ...": comm may hold spaces and parentheses, so cut at the last ")".
  rest=${stat##*) }
  ppid=${rest#* }
  ppid=${ppid%% *}
  comm=$(LC_ALL=C tr 'A-Z' 'a-z' <"$proc/$pid/comm" 2>/dev/null) || break
  # The AppImage runtime that started our AppRun: its exe is the .AppImage file.
  if [ -n "${APPIMAGE:-}" ] && [ "$(readlink "$proc/$pid/exe" 2>/dev/null)" = "$APPIMAGE" ]; then
    :
  elif stop "$comm"; then
    break
  elif ! skip "$comm"; then
    app=$comm
    break
  fi
  [ "$ppid" = "$pid" ] && break
  pid=$ppid
done

# Only a token: never a path, never anything a shell or Vimma would read as more than a name.
# A case pattern, not grep: grep -x would pass a name with a newline line by line.
case $app in
  *[!a-z0-9._+-]* | [!a-z0-9]* | '') app= ;;
esac
[ "${#app}" -gt 32 ] && app=

# The desktop entry passes the link as one argument (%u). One that starts with "-" would reach
# vimma as a flag (-profile, -remote-debugging-port...): refuse it.
if [ "$#" -eq 1 ]; then
  case "$1" in
    -*)
      echo "vimma-open: refusing a single argument that is a flag: $1" >&2
      exit 64
      ;;
  esac
  if [ -n "$app" ]; then
    VIMMA_FROM=$app exec "$bin" -vimma-from "$app" "$1"
  fi
fi
# Never a VIMMA_FROM this launcher did not set (one inherited from the caller's environment).
unset VIMMA_FROM
exec "$bin" "$@"
