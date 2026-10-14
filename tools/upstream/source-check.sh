#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Checks a Firefox source tarball from archive.mozilla.org against Vimma's patches, for the
# upstream autopilot (upstream.yml, a release) and the Beta canary (a Beta), so the two checks
# cannot drift apart (spec upstream-beta-canary).
#
#   tools/upstream/source-check.sh VERSION      e.g. 158.0, 157.0.1, 159.0b1
#
# Streams the tarball once: tee feeds sha512sum (through a FIFO) and patch-check.py, which
# extracts only the patched files and, with --drain, reads to the end so the hash is whole. Then
# it verifies the hash against the version's SHA512SUMS, runs the patch-size audit and, when every
# patch applies, the artifact preflight. Writes patch-check.json, patch-check.md and
# patch-audit.txt in the current directory, and to $GITHUB_OUTPUT (when set) result=ok|fail|norun
# and, after the preflight, artifacts and artifacts-note. $GITHUB_STEP_SUMMARY gets the summary.
#
# Exit status: 0 the check ran or reported that it could not (result says which), 1 the SHA-512
# does not match Mozilla's SHA512SUMS (never report on a tarball Mozilla did not publish), 2 usage.
# MOZILLA_RELEASES overrides the archive's releases/ URL (tests use a file:// directory).
set -euo pipefail

version=${1:-}
# The version reaches a URL and file names: only digits, dots and a Beta's bN.
if ! [[ $version =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ || $version =~ ^[0-9]+\.0b[0-9]+$ ]]; then
  echo "source-check: not a Firefox release or beta version: '$version'" >&2
  exit 2
fi
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
base="${MOZILLA_RELEASES:-https://archive.mozilla.org/pub/firefox/releases}/$version"
name="source/firefox-$version.source.tar.xz"
output=${GITHUB_OUTPUT:-/dev/null}
summary=${GITHUB_STEP_SUMMARY:-/dev/null}

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkfifo "$scratch/tarball.fifo"
sha512sum < "$scratch/tarball.fifo" > "$scratch/tarball.sha512" &
hasher=$!
# patch-check's status is the verdict: 0 all apply, 1 some do not, 2 did not run.
set +e
curl -fsSL --retry 3 "$base/$name" | tee "$scratch/tarball.fifo" |
  python3 "$here/patch-check.py" --tarball - --drain \
    --json patch-check.json --markdown patch-check.md
status=${PIPESTATUS[2]}
wait "$hasher"
set -e

case "$status" in
  0 | 1)
    # Hard failure on a mismatch: never report on a tarball Mozilla did not publish.
    curl -fsSL --retry 3 "$base/SHA512SUMS" -o "$scratch/SHA512SUMS"
    python3 "$here/verify-sha512.py" --sums "$scratch/SHA512SUMS" --name "$name" \
      --actual "$scratch/tarball.sha512" || {
      echo "::error::SHA-512 of $name does not match $base/SHA512SUMS"
      exit 1
    }
    if [ "$status" -eq 0 ]; then result=ok; else result=fail; fi
    ;;
  *)
    result=norun
    # patch-check writes its own "did not run" file; a crash before that may not.
    [ -s patch-check.md ] || printf '### Patch check did not run\n\nExit %s; %s.\n' \
      "$status" "see the run log" > patch-check.md
    ;;
esac
case "$result" in
  ok) ;;
  fail) echo "::warning::some patches do not apply to Firefox $version (summary)" ;;
  norun) echo "::warning::the patch check did not run for Firefox $version (no verdict)" ;;
esac
echo "result=$result" >> "$output"
cat patch-check.md >> "$summary"

# Patch-size audit (ADR-003 register): informational, never fails the check.
python3 "$here/patch-audit.py" > patch-audit.txt || true

# Are Mozilla's artifacts for this revision indexed (in the tree sourcestamp.txt names)?
if [ "$result" = ok ]; then
  node "$here/artifact-preflight.mjs" patch-check.json --github-output "$output"
fi
