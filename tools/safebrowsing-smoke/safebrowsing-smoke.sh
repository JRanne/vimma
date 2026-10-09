#!/usr/bin/env bash
# Spec docs/specs/m0-safebrowsing-key.md: does our Google Safe Browsing key actually fetch lists?
# Launches the real build headless on a temp profile and waits for Google's tables to land in the
# profile's safebrowsing/ directory. Needs the network; not part of CI.
#
#   tools/safebrowsing-smoke/safebrowsing-smoke.sh [path/to/vimma] [timeout-seconds]
#
# Prints only table file names and sizes, never the key or a URL: the browser's own output goes
# to a file in the temp dir, which is deleted. Exit 0 when every Google list we fetch has data.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
bin=${1:-$root/engine/obj-x86_64-pc-linux-gnu/dist/bin/vimma}
wait_s=${2:-180}
[ -x "$bin" ] || { echo "safebrowsing-smoke: no browser at $bin" >&2; exit 1; }

tmp=$(mktemp -d)
pid=
cleanup() {
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT
mkdir "$tmp/profile"

"$bin" --headless --no-remote --profile "$tmp/profile" about:blank >"$tmp/browser.log" 2>&1 &
pid=$!

# The first update runs 3 s plus up to 60 s after SafeBrowsing.init
# (UrlClassifierListManager.sys.mjs), so allow a few minutes. Every list our key can fetch must
# arrive (unofficial builds name the phishing list googpub-; the files sit under google4/ even
# when google5 fetched them).
want="googpub-phish-proto goog-malware-proto goog-unwanted-proto"
tables() {
  # The directory appears only with the first update.
  { find "$tmp/profile/safebrowsing" -type f -size +0 \
    \( -name 'goog-*' -o -name 'googpub-*' \) -printf '%P %s\n' 2>/dev/null || true; } | sort
}
complete() {
  local t
  for t in $want; do
    find "$tmp/profile/safebrowsing" -type f -size +0 -name "$t.vlpset" 2>/dev/null | grep -q . ||
      return 1
  done
}
start=$(date +%s)
while :; do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "safebrowsing-smoke: the browser exited early" >&2
    pid=
    exit 1
  fi
  if complete; then
    sleep 5 # let the update finish writing
    echo "Google Safe Browsing tables after $(($(date +%s) - start)) s (file, bytes):"
    tables | sed 's/^/  /'
    exit 0
  fi
  if [ $(($(date +%s) - start)) -ge "$wait_s" ]; then
    echo "safebrowsing-smoke: not all of ($want) after ${wait_s} s. Keyless build, revoked key," >&2
    echo "  Safe Browsing API not enabled for the key, or no network. Other tables present:" >&2
    { find "$tmp/profile/safebrowsing" -type f -size +0 -printf '  %P %s\n' 2>/dev/null ||
      true; } | sort >&2
    exit 1
  fi
  sleep 5
done
