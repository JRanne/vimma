#!/usr/bin/env python3
"""Patch-size audit: every src/**/*.patch with its files, hunks and changed lines, against the
ADR-003 patch register.

Plan §4 (the Sunday maintenance run): review patch sizes and move code out of .patch files.
Flags a patch missing from the register (ADR-003: every .patch needs a line there) and a
register line whose patch no longer exists. `large` marks a patch at or over 8000 characters,
the size at which `surfer export` warns. Exit status: 0 the register matches, 1 it does not,
2 the files could not be read. Python stdlib only; docs/rebase.md, "Patch-size audit".
"""

import argparse
import json
import re
import sys
from pathlib import Path

from patches import find_patches, parse_patch

ROOT = Path(__file__).resolve().parent.parent.parent
ADR = Path("docs/adr/003-own-files-minimal-patches.md")
REGISTER_HEADING = re.compile(r"^#+\s+Patch register\s*$")
PATCH_CELL = re.compile(r"^\|\s*`(src/[^`]+\.patch)`")
SURFER_WARN_CHARS = 8000  # surfer export: "Exported patch is over 8000 characters"


def read_register(text):
    """Patch paths in the first column of the table under the "Patch register" heading."""
    paths = []
    inside = False
    for line in text.splitlines():
        if REGISTER_HEADING.match(line):
            inside = True
        elif inside and line.startswith("#"):
            break
        elif inside and (m := PATCH_CELL.match(line)):
            paths.append(m.group(1))
    return paths


def audit(root, src, adr):
    root = Path(root)
    register = read_register(Path(adr).read_text(encoding="utf-8"))
    rows = []
    for path in find_patches(src):
        text = path.read_text(encoding="utf-8")
        files = parse_patch(text)
        hunks = [h for f in files for h in f.hunks]
        rel = path.resolve().relative_to(root.resolve()).as_posix()
        rows.append(
            {
                "patch": rel,
                "files": len(files),
                "hunks": len(hunks),
                "added": sum(h.added for h in hunks),
                "removed": sum(h.removed for h in hunks),
                "chars": len(text),
                "large": len(text) >= SURFER_WARN_CHARS,
                "registered": rel in register,
            }
        )
    present = {r["patch"] for r in rows}
    return {
        "adr": str(adr),
        "patches": rows,
        "totals": {
            "patches": len(rows),
            "hunks": sum(r["hunks"] for r in rows),
            "added": sum(r["added"] for r in rows),
            "removed": sum(r["removed"] for r in rows),
        },
        "unregistered": sorted(r["patch"] for r in rows if not r["registered"]),
        "missing": [p for p in register if p not in present],
    }


def render(report):
    head = ("Patch", "Files", "Hunks", "+", "-", "Chars", "Register")
    rows = [
        (
            r["patch"],
            str(r["files"]),
            str(r["hunks"]),
            str(r["added"]),
            str(r["removed"]),
            str(r["chars"]) + (" large" if r["large"] else ""),
            "yes" if r["registered"] else "NO",
        )
        for r in report["patches"]
    ]
    widths = [max(len(row[i]) for row in [head, *rows]) for i in range(len(head))]

    def fmt(row):
        cells = [row[0].ljust(widths[0])] + [c.rjust(w) for c, w in zip(row[1:-1], widths[1:-1])]
        return "  ".join([*cells, row[-1]]).rstrip()

    t = report["totals"]
    out = [fmt(head), *map(fmt, rows)]
    out.append(f"Total: {t['patches']} patches, {t['hunks']} hunks, +{t['added']} -{t['removed']}")
    if report["unregistered"]:
        out.append(f"Not in the ADR-003 register ({report['adr']}):")
        out += [f"  {p}" for p in report["unregistered"]]
    if report["missing"]:
        out.append("In the ADR-003 register but no such file:")
        out += [f"  {p}" for p in report["missing"]]
    if not report["unregistered"] and not report["missing"]:
        out.append(f"Register matches src/ ({t['patches']} patches).")
    large = [r["patch"] for r in report["patches"] if r["large"]]
    if large:
        out.append(f"Over {SURFER_WARN_CHARS} characters (surfer export warns): {', '.join(large)}")
    return "\n".join(out) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default=str(ROOT), help="repository root (default: this repo)")
    parser.add_argument("--src", help="directory of .patch files (default: ROOT/src)")
    parser.add_argument("--adr", help=f"the register (default: ROOT/{ADR})")
    parser.add_argument("--json", help="write the report as JSON here")
    args = parser.parse_args(argv)
    root = Path(args.root)
    try:
        report = audit(root, Path(args.src or root / "src"), Path(args.adr or root / ADR))
    except (OSError, ValueError) as err:
        print(f"patch-audit: {err}", file=sys.stderr)
        return 2
    sys.stdout.write(render(report))
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 1 if report["unregistered"] or report["missing"] else 0


if __name__ == "__main__":
    sys.exit(main())
