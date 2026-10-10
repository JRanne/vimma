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


def audit_json(adr, *extra):
    """Run the audit over the fixture patches with `adr` as the register; (result, report)."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "audit.json"
        md = Path(tmp) / "audit.md"
        r = run(
            "--root",
            str(FIXTURES / "patch-check"),
            "--adr",
            str(FIXTURES / "patch-audit" / adr),
            "--today",
            "2026-10-10",
            "--json",
            str(out),
            "--markdown",
            str(md),
            *extra,
        )
        report = json.loads(out.read_text(encoding="utf-8")) if out.exists() else None
        markdown = md.read_text(encoding="utf-8") if md.exists() else ""
        return r, report, markdown


class AuditBudgets(unittest.TestCase):
    """The quarterly audit (patch-audit.yml): budgets and review dates in the register."""

    def test_register_reads_each_patchs_hunk_and_line_budget_and_review_date(self):
        module = load_module()
        budgets = module.read_budgets(
            (FIXTURES / "patch-audit" / "adr-over.md").read_text(encoding="utf-8")
        )
        self.assertEqual(
            budgets["src/browser/clean-txt.patch"],
            {"hunks": 1, "lines": 1, "reviewed": "2026-10-01"},
        )
        self.assertEqual(budgets["src/browser/offset-txt.patch"]["hunks"], None)
        self.assertEqual(budgets["src/toolkit/fuzz-txt.patch"]["reviewed"], None)

    def test_a_patch_over_its_hunk_or_line_budget_fails_the_audit(self):
        r, report, _ = audit_json("adr-over.md")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertEqual(report["unregistered"], [])
        self.assertEqual(report["missing"], [])
        self.assertEqual(
            report["over_budget"],
            [
                {"patch": "src/browser/clean-txt.patch", "what": "lines", "used": 2, "budget": 1},
                {"patch": "src/toolkit/failed-txt.patch", "what": "hunks", "used": 2, "budget": 1},
            ],
        )

    def test_a_register_line_without_a_budget_or_review_date_fails_the_audit(self):
        r, report, _ = audit_json("adr-over.md")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(
            report["unbudgeted"],
            ["src/browser/offset-txt.patch", "src/toolkit/fuzz-txt.patch"],
        )

    def test_within_budget_passes_and_reviews_over_92_days_old_are_due(self):
        r, report, _ = audit_json("adr-budget.md")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(report["over_budget"], [])
        self.assertEqual(report["unbudgeted"], [])
        self.assertEqual(
            report["due"],
            [
                {"patch": "src/browser/offset-txt.patch", "reviewed": "2026-07-09", "age_days": 93},
                {"patch": "src/toolkit/failed-txt.patch", "reviewed": "2026-01-01", "age_days": 282},
            ],
        )
        ages = {p["patch"]: p["age_days"] for p in report["patches"]}
        self.assertEqual(ages["src/browser/missing-txt.patch"], 92)
        self.assertEqual(ages["src/toolkit/fuzz-txt.patch"], 0)

    def test_max_age_days_moves_the_review_deadline(self):
        _, report, _ = audit_json("adr-budget.md", "--max-age-days", "30")
        self.assertEqual(
            [d["patch"] for d in report["due"]],
            [
                "src/browser/applied-txt.patch",
                "src/browser/missing-txt.patch",
                "src/browser/offset-txt.patch",
                "src/toolkit/failed-txt.patch",
            ],
        )

    def test_markdown_report_for_the_tracking_issue(self):
        _, _, md = audit_json("adr-over.md")
        self.assertIn("| Patch | Hunks | Lines | Chars | Reviewed | Age (days) |", md)
        self.assertIn("| `src/toolkit/failed-txt.patch` | 2 / 1 **over** | 4 / 4 |", md)
        self.assertIn("### Over budget", md)
        self.assertIn("- `src/toolkit/failed-txt.patch`: 2 hunks, budget 1", md)
        self.assertIn("### No budget or review date in the register", md)
        _, _, ok = audit_json("adr-budget.md")
        self.assertIn("### Due for review (last reviewed over 92 days ago)", ok)
        self.assertIn("- `src/toolkit/failed-txt.patch`: last reviewed 2026-01-01, 282 days", ok)
        self.assertNotIn("### Over budget", ok)

    def test_a_bad_today_is_a_usage_error(self):
        r, _, _ = audit_json("adr-budget.md", "--today", "yesterday")
        self.assertEqual(r.returncode, 2)


class AuditOfThisRepo(unittest.TestCase):
    def test_every_patch_in_src_is_in_the_adr_003_register_and_vice_versa(self):
        r = run("--root", str(ROOT))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("Register matches", r.stdout)

    def test_every_patch_has_a_budget_and_review_date_and_stays_within_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "audit.json"
            r = run("--root", str(ROOT), "--json", str(out))
            report = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(report["unbudgeted"], [])
        self.assertEqual(report["over_budget"], [])


if __name__ == "__main__":
    unittest.main()
