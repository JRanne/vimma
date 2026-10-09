"""Tests for patch-audit.py: patch sizes against the ADR-003 register. Fixtures, plus the repo."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SCRIPT = HERE / "patch-audit.py"
FIXTURES = HERE / "fixtures"
SRC = FIXTURES / "patch-check" / "src"
ADR = FIXTURES / "patch-audit" / "adr.md"


def run(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, text=True, check=False
    )


def load_module():
    spec = importlib.util.spec_from_file_location("patch_audit", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AuditFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        out = Path(cls.tmp.name) / "audit.json"
        # --root makes the src/ paths match the register's `src/...` spelling.
        cls.result = run(
            "--root", str(FIXTURES / "patch-check"), "--adr", str(ADR), "--json", str(out)
        )
        cls.report = json.loads(out.read_text(encoding="utf-8"))
        cls.rows = {Path(p["patch"]).name: p for p in cls.report["patches"]}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_register_parses_only_the_patch_register_table(self):
        module = load_module()
        self.assertEqual(
            module.read_register(ADR.read_text(encoding="utf-8")),
            [
                "src/browser/clean-txt.patch",
                "src/toolkit/failed-txt.patch",
                "src/browser/gone.patch",
            ],
        )

    def test_exit_one_when_register_and_patches_differ(self):
        self.assertEqual(self.result.returncode, 1, self.result.stderr)

    def test_patch_missing_from_register_is_flagged(self):
        self.assertEqual(
            self.report["unregistered"],
            [
                "src/browser/applied-txt.patch",
                "src/browser/missing-txt.patch",
                "src/browser/offset-txt.patch",
                "src/toolkit/fuzz-txt.patch",
            ],
        )
        self.assertFalse(self.rows["offset-txt.patch"]["registered"])
        self.assertTrue(self.rows["clean-txt.patch"]["registered"])

    def test_registered_patch_without_a_file_is_flagged(self):
        self.assertEqual(self.report["missing"], ["src/browser/gone.patch"])

    def test_hunks_and_changed_lines_per_patch(self):
        failed = self.rows["failed-txt.patch"]
        self.assertEqual(
            (failed["files"], failed["hunks"], failed["added"], failed["removed"]), (1, 2, 2, 2)
        )
        clean = self.rows["clean-txt.patch"]
        self.assertEqual((clean["hunks"], clean["added"], clean["removed"]), (1, 1, 1))
        self.assertEqual(self.report["totals"]["patches"], 6)
        self.assertEqual(self.report["totals"]["hunks"], 7)

    def test_text_report_lists_patches_and_both_kinds_of_mismatch(self):
        r = run("--root", str(FIXTURES / "patch-check"), "--adr", str(ADR))
        self.assertIn("src/toolkit/failed-txt.patch", r.stdout)
        self.assertIn("Not in the ADR-003 register", r.stdout)
        self.assertIn("src/browser/gone.patch", r.stdout)


class AuditOfThisRepo(unittest.TestCase):
    def test_every_patch_in_src_is_in_the_adr_003_register_and_vice_versa(self):
        r = run("--root", str(ROOT))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("Register matches", r.stdout)


if __name__ == "__main__":
    unittest.main()
