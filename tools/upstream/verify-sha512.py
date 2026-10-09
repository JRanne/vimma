#!/usr/bin/env python3
"""Compare a file's SHA-512 (sha512sum output) with its line in Mozilla's SHA512SUMS.

upstream.yml hashes the Firefox source tarball with `tee | sha512sum` while patch-check reads it,
then checks the hash against https://archive.mozilla.org/pub/firefox/releases/X.Y/SHA512SUMS,
whose line for the tarball is `<hash>  source/firefox-X.Y.source.tar.xz`. The SHA512SUMS file
is fetched over HTTPS from the same archive and its GPG signature is not checked (spec
m0-rebase-playbook). Exit status: 0 match, 1 mismatch (both hashes printed), 2 cannot compare.
Python stdlib only.
"""

import argparse
import re
import sys
from pathlib import Path

HASH = re.compile(r"[0-9a-f]{128}")


def expected_hash(sums_text, name):
    """The hash SHA512SUMS lists for exactly `name`, or None."""
    for line in sums_text.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[1].lstrip("*").strip() == name:
            return parts[0].lower()
    return None


def actual_hash(sha512sum_text):
    """The hash from sha512sum's output (`<hash>  -` or `<hash>  file`)."""
    first = sha512sum_text.split(None, 1)[0].lower() if sha512sum_text.strip() else ""
    if not HASH.fullmatch(first):
        raise ValueError(f"not a SHA-512 hash: {sha512sum_text.strip()[:80]!r}")
    return first


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sums", required=True, help="Mozilla's SHA512SUMS file")
    parser.add_argument("--name", required=True, help="e.g. source/firefox-158.0.source.tar.xz")
    parser.add_argument("--actual", required=True, help="file holding sha512sum's output")
    args = parser.parse_args(argv)
    try:
        expected = expected_hash(Path(args.sums).read_text(encoding="utf-8"), args.name)
        actual = actual_hash(Path(args.actual).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        print(f"verify-sha512: {err}", file=sys.stderr)
        return 2
    if expected is None:
        print(f"verify-sha512: no entry for {args.name} in {args.sums}", file=sys.stderr)
        return 2
    if expected != actual:
        print(
            f"verify-sha512: SHA-512 mismatch for {args.name}\n"
            f"  expected (SHA512SUMS): {expected}\n  actual (downloaded):   {actual}",
            file=sys.stderr,
        )
        return 1
    print(f"verify-sha512: {args.name} matches SHA512SUMS ({actual[:16]}…)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
