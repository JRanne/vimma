#!/usr/bin/env python3
"""Set the Firefox version that surfer.json pins, changing nothing else in the file.

The edit is textual so that key order, indentation and the trailing newline stay as Surfer wrote
them; the result is re-parsed to prove only version.version changed. Prints "OLD -> NEW".
Used by .github/workflows/upstream.yml (ADR-002). Python stdlib only.
"""

import argparse
import json
import re
import sys
from pathlib import Path

RELEASE = re.compile(r"\d+(?:\.\d+)*")


def bump(text, new):
    """Return (old_version, new_text) for surfer.json text `text` bumped to `new`."""
    if not RELEASE.fullmatch(new):
        raise ValueError(f"not a Firefox release version: {new!r}")
    data = json.loads(text)
    pin = data.get("version") if isinstance(data, dict) else None
    if not isinstance(pin, dict) or pin.get("product") != "firefox":
        raise ValueError('surfer.json must pin {"version": {"product": "firefox", ...}}')
    old = pin.get("version")
    if not isinstance(old, str):
        raise ValueError("surfer.json has no version.version string")
    if old == new:
        return old, text

    pattern = re.compile(r'("version"\s*:\s*)"' + re.escape(old) + '"')
    new_text, count = pattern.subn(lambda m: m.group(1) + json.dumps(new), text)
    if count != 1:
        raise ValueError(f'expected exactly one "version": "{old}" in surfer.json, found {count}')

    pin["version"] = new
    if json.loads(new_text) != data:
        raise ValueError("textual edit changed more than version.version")
    return old, new_text


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("version", help="new Firefox release version, e.g. 158.0")
    parser.add_argument("--file", default="surfer.json", help="path to surfer.json")
    args = parser.parse_args(argv)

    path = Path(args.file)
    try:
        text = path.read_text(encoding="utf-8")
        old, new_text = bump(text, args.version)
    except (OSError, ValueError) as err:
        print(f"bump-surfer-json: {err}", file=sys.stderr)
        return 2
    if new_text != text:
        path.write_text(new_text, encoding="utf-8")
    print(f"{old} -> {args.version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
