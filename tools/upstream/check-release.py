#!/usr/bin/env python3
"""Print the latest Firefox release if it is newer than the one surfer.json pins.

Reads LATEST_FIREFOX_VERSION from Mozilla's product-details feed (or a local file) and prints it
followed by a newline when it is newer than the current version; prints nothing otherwise.
Exits non-zero, printing nothing on stdout, when the feed is unreachable or malformed.
Used by .github/workflows/upstream.yml (ADR-002). Python stdlib only.
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

FEED_URL = "https://product-details.mozilla.org/1.0/firefox_versions.json"
KEY = "LATEST_FIREFOX_VERSION"
RELEASE = re.compile(r"\d+(?:\.\d+)*")


def version_key(version):
    """Comparable key for a Firefox release version ("157.0.1"); ValueError for beta/esr/etc."""
    if not isinstance(version, str) or not RELEASE.fullmatch(version):
        raise ValueError(f"not a Firefox release version: {version!r}")
    parts = [int(p) for p in version.split(".")]
    while len(parts) > 1 and parts[-1] == 0:
        parts.pop()
    return tuple(parts)


def read_source(source):
    if re.match(r"https?://", source):
        with urllib.request.urlopen(source, timeout=30) as response:
            return response.read().decode("utf-8")
    return Path(source).read_text(encoding="utf-8")


def latest_release(text):
    try:
        data = json.loads(text)
    except json.JSONDecodeError as err:
        raise ValueError(f"malformed JSON from the versions feed: {err}") from err
    if not isinstance(data, dict) or KEY not in data:
        raise ValueError(f"versions feed has no {KEY}")
    version = data[KEY]
    version_key(version)
    return version


def current_version(surfer_json):
    data = json.loads(Path(surfer_json).read_text(encoding="utf-8"))
    return data["version"]["version"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", default=FEED_URL, help="feed URL or local JSON file")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--current", help="current Firefox version (default: from surfer.json)")
    group.add_argument("--surfer-json", default="surfer.json", help="path to surfer.json")
    args = parser.parse_args(argv)

    try:
        current = args.current or current_version(args.surfer_json)
        latest = latest_release(read_source(args.source))
        newer = version_key(latest) > version_key(current)
    except (OSError, ValueError, KeyError, TypeError) as err:
        print(f"check-release: {err}", file=sys.stderr)
        return 2
    if newer:
        print(latest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
