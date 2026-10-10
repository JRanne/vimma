#!/bin/bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Omarchy theme-set hook: a running Vimma takes the new theme at once instead of at its next
# 2-second poll (spec docs/specs/m5-omarchy-theme.md, "Instant reload").
#
# Vimma installs this file into ~/.config/omarchy/hooks/theme-set.d/ by itself when it finds
# Omarchy, and keeps it up to date while you leave it unchanged. To opt out, set the pref
# vimma.theme.omarchyHook to false (Vimma then removes its own unchanged copy). An edited copy
# is yours: Vimma never touches it again.
#
# omarchy-theme-set runs it (through omarchy-hook, as `bash <file> <theme-name>`) after the new
# theme is in ~/.local/state/omarchy/current/theme. It sends `-vimma-reload-theme` to every
# running Vimma through Firefox's own command-line remoting (the D-Bus OpenURL call a second
# `vimma <args>` makes), straight to the instances that are running, so it never starts one.
# Without D-Bus it falls back to `vimma-ctl reload-theme` (VIMMA_CTL or PATH; needs the control
# socket on). With no Vimma running it does nothing and says nothing.

reload_flag=-vimma-reload-theme

# The command line as nsUnixRemoteServer::HandleCommandLine reads it, as busctl `ay` arguments:
# [argc][offset of each argv]<working dir>\0<argv[0]>\0..., integers little-endian 32-bit.
remote_command_line() {
  local dir=/ argv=(vimma "$@") i strings
  local argc=${#argv[@]}
  local offset=$(((argc + 1) * 4 + ${#dir} + 1))
  local -a out=()
  le32() { out+=($(($1 & 255)) $((($1 >> 8) & 255)) $((($1 >> 16) & 255)) $((($1 >> 24) & 255))); }
  le32 "$argc"
  for ((i = 0; i < argc; i++)); do
    le32 "$offset"
    offset=$((offset + ${#argv[i]} + 1))
  done
  read -ra strings <<<"$(printf '%s\0' "$dir" "${argv[@]}" | od -An -v -tu1 | tr '\n' ' ')"
  out+=("${strings[@]}")
  echo "${#out[@]} ${out[*]}"
}

sent=0
busctl=$(command -v busctl)
if [[ -n $busctl ]]; then
  names=$("$busctl" --user --no-legend --no-pager list 2>/dev/null |
    awk '$1 ~ /^org\.mozilla\.vimma\./ { print $1 }')
  if [[ -n $names ]]; then
    read -ra bytes <<<"$(remote_command_line "$reload_flag")"
    for name in $names; do
      "$busctl" --user --timeout=2 call "$name" /org/mozilla/vimma/Remote org.mozilla.vimma \
        OpenURL ay "${bytes[@]}" >/dev/null 2>&1 && sent=1
    done
  fi
fi

if ((!sent)); then
  ctl=${VIMMA_CTL:-$(command -v vimma-ctl)}
  [[ -n $ctl && -x $ctl ]] && "$ctl" --timeout 2 reload-theme >/dev/null 2>&1
fi
exit 0
