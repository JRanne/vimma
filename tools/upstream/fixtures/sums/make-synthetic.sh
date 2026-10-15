#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Regenerates the synthetic signature fixtures for test_verify_sha512.py (spec
# build-supply-chain, Tests). The Mozilla fixtures beside them (157.0.1/, 153.0/) are
# Mozilla's own files, byte for byte, from https://archive.mozilla.org/pub/firefox/releases/.
#
#   tools/upstream/fixtures/sums/make-synthetic.sh      from anywhere; writes into synthetic/
#
# Throwaway keys are made in a temporary GNUPGHOME that is deleted afterwards; only public keys
# and signatures are kept, so no secret key is ever committed:
#   other.asc                 a signature over 157.0.1/SHA512SUMS by an unrelated key
#   two-signatures.asc        Mozilla's signature over 157.0.1/SHA512SUMS followed by other.asc
#   expired/SHA512SUMS        a small sums file, signed (expired/SHA512SUMS.asc) in 2020 by a
#                             signing subkey that expired one day after it was made
#   expired/key.asc           that key's public part; expired/fingerprint its primary fingerprint
#   packets/SHA512SUMS        a small sums file and, by one valid key (packets/key.asc,
#                             packets/fingerprint), a detached signature over it (detached.asc),
#                             the same file as an opaque signed message (opaque.asc) and as a
#                             cleartext-signed message (clearsign.asc): only the first is a
#                             detached signature
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
out="$here/synthetic"
GNUPGHOME=$(mktemp -d)
export GNUPGHOME
trap 'gpgconf --kill all; rm -rf "$GNUPGHOME"' EXIT
gpg=(gpg --batch --quiet --pinentry-mode loopback --passphrase '')

rm -rf "$out"
mkdir -p "$out/expired" "$out/packets"

"${gpg[@]}" --quick-gen-key 'Unrelated Test Key <other@example.invalid>' ed25519 sign never
"${gpg[@]}" --armor --local-user other@example.invalid --detach-sign \
  --output "$out/other.asc" "$here/157.0.1/SHA512SUMS"
cat "$here/157.0.1/SHA512SUMS.asc" "$out/other.asc" > "$out/two-signatures.asc"

then='20200101T000000'
"${gpg[@]}" --faked-system-time "$then" --quick-gen-key \
  'Expired Subkey Test Key <expired@example.invalid>' ed25519 cert never
primary=$("${gpg[@]}" --with-colons --list-keys expired@example.invalid | awk -F: '/^fpr/ {print $10; exit}')
"${gpg[@]}" --faked-system-time "$then" --quick-add-key "$primary" ed25519 sign 1d
printf '%0128d  source/firefox-158.0.source.tar.xz\n' 0 > "$out/expired/SHA512SUMS"
"${gpg[@]}" --faked-system-time 20200101T120000 --armor --local-user expired@example.invalid \
  --detach-sign --output "$out/expired/SHA512SUMS.asc" "$out/expired/SHA512SUMS"
"${gpg[@]}" --armor --export "$primary" > "$out/expired/key.asc"
echo "$primary" > "$out/expired/fingerprint"
"${gpg[@]}" --quick-gen-key 'Packet Test Key <packets@example.invalid>' ed25519 sign never
packets=$("${gpg[@]}" --with-colons --list-keys packets@example.invalid | awk -F: '/^fpr/ {print $10; exit}')
printf '%0128d  source/firefox-158.0.source.tar.xz\n' 1 > "$out/packets/SHA512SUMS"
signer=(--armor --local-user packets@example.invalid)
"${gpg[@]}" "${signer[@]}" --detach-sign --output "$out/packets/detached.asc" "$out/packets/SHA512SUMS"
"${gpg[@]}" "${signer[@]}" --sign --output "$out/packets/opaque.asc" "$out/packets/SHA512SUMS"
"${gpg[@]}" "${signer[@]}" --clearsign --output "$out/packets/clearsign.asc" "$out/packets/SHA512SUMS"
"${gpg[@]}" --armor --export "$packets" > "$out/packets/key.asc"
echo "$packets" > "$out/packets/fingerprint"
echo "make-synthetic: wrote $out"
