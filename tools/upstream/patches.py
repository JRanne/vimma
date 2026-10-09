"""Parse the git-style .patch files we carry under src/ (ADR-003). Python stdlib only.

`surfer export <file>` writes one per upstream file with `git diff --full-index`; `surfer import`
applies every src/**/*.patch with `git apply`. Shared by patch-check.py and patch-audit.py.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


@dataclass
class Hunk:
    header: str
    old_start: int
    old_len: int
    new_start: int
    new_len: int
    body: list = field(default_factory=list)

    @property
    def added(self):
        return sum(1 for line in self.body if line.startswith("+"))

    @property
    def removed(self):
        return sum(1 for line in self.body if line.startswith("-"))

    @property
    def text(self):
        return "\n".join([self.header, *self.body]) + "\n"


@dataclass
class FilePatch:
    old_path: str | None  # None: the patch creates the file (--- /dev/null)
    new_path: str | None  # None: the patch deletes it
    head: list = field(default_factory=list)  # diff --git, index, ---, +++ lines
    hunks: list = field(default_factory=list)

    @property
    def path(self):
        return self.old_path or self.new_path

    def hunk_patch(self, index):
        """This file's header plus one hunk: a patch git apply can check on its own."""
        return "\n".join([*self.head, self.hunks[index].header, *self.hunks[index].body]) + "\n"


def _strip(path, prefix):
    path = path.split("\t", 1)[0].strip()
    if path == "/dev/null":
        return None
    return path[len(prefix) :] if path.startswith(prefix) else path


def safe_relpath(path):
    """True for a relative path that stays inside the tree it is joined to."""
    p = PurePosixPath(path)
    return bool(path) and not p.is_absolute() and ".." not in p.parts


def parse_patch(text):
    """FilePatch list for a unified diff, as git diff (and so surfer export) writes it."""
    files = []
    current = None
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("diff --git "):
            current = FilePatch(None, None, [line])
            files.append(current)
        elif line.startswith("--- ") and i + 1 < len(lines) and lines[i + 1].startswith("+++ "):
            if current is None or current.hunks:
                current = FilePatch(None, None)
                files.append(current)
            current.old_path = _strip(line[4:], "a/")
            current.new_path = _strip(lines[i + 1][4:], "b/")
            current.head += [line, lines[i + 1]]
            i += 1
        elif (m := HUNK.match(line)) and current is not None:
            old_len = int(m.group(2)) if m.group(2) is not None else 1
            new_len = int(m.group(4)) if m.group(4) is not None else 1
            hunk = Hunk(line, int(m.group(1)), old_len, int(m.group(3)), new_len)
            old_left, new_left = old_len, new_len
            while i + 1 < len(lines) and (old_left > 0 or new_left > 0 or lines[i + 1][:1] == "\\"):
                i += 1
                body = lines[i]
                tag = body[:1]
                if tag in (" ", ""):
                    old_left -= 1
                    new_left -= 1
                elif tag == "-":
                    old_left -= 1
                elif tag == "+":
                    new_left -= 1
                elif tag != "\\":
                    raise ValueError(f"unexpected line in hunk {hunk.header!r}: {body!r}")
                hunk.body.append(body)
            current.hunks.append(hunk)
        elif current is not None and not current.hunks:
            current.head.append(line)  # index, mode, rename lines
        i += 1
    if not files:
        raise ValueError("no diff in this file")
    for f in files:
        if any(line.startswith(("rename from ", "copy from ")) for line in f.head):
            raise ValueError(
                f"{f.head[0]!r} is a rename or copy, which we do not support: `surfer export` "
                "writes one plain diff per file. Export a delete and a create instead."
            )
        if f.old_path is None and f.new_path is None:
            raise ValueError(f"{f.head[0]!r} has no ---/+++ lines (a mode-only or binary change?)")
        if not f.hunks:
            raise ValueError(f"no hunks for {f.path}")
        for path in (f.old_path, f.new_path):
            if path is not None and not safe_relpath(path):
                raise ValueError(f"patch path leaves the tree: {path!r}")
    return files


def find_patches(src):
    """Every src/**/*.patch, in a stable order (Surfer globs the same set)."""
    return sorted(Path(src).rglob("*.patch"))
