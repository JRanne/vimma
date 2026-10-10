#!/bin/bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Omarchy theme-set hook: a running Vimma takes the new theme at once instead of at its next
# 2-second poll (spec docs/specs/m5-omarchy-theme.md, "Instant reload").
#
# Install (by hand; nothing installs it for you):
#   install -Dm644 tools/omarchy/vimma-theme-reload.sh \
#     ~/.config/omarchy/hooks/theme-set.d/vimma-theme-reload.sh
# Uninstall:
#   rm ~/.config/omarchy/hooks/theme-set.d/vimma-theme-reload.sh
#
# omarchy-theme-set runs it (through omarchy-hook, as `bash <file> <theme-name>`) after the new
# theme is in ~/.local/state/omarchy/current/theme. It needs vimma-ctl on PATH (or VIMMA_CTL)
# and the control socket on (vimma.control.enabled). Without either, or with Vimma not running,
# it does nothing and says nothing: the poll still picks the theme up.

ctl=${VIMMA_CTL:-$(command -v vimma-ctl)}
[[ -n $ctl && -x $ctl ]] || exit 0
"$ctl" --timeout 2 reload-theme >/dev/null 2>&1
exit 0
