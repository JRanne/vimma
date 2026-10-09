"""Tests for check-release.py. Fixtures only; no network."""

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "check-release.py"
FIXTURES = HERE / "fixtures"
SURFER = FIXTURES / "surfer-in.json"  # pins Firefox 157.0.1


def run(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, text=True, check=False
    )


def load_module():
    spec = importlib.util.spec_from_file_location("check_release", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CheckReleaseCli(unittest.TestCase):
    def test_newer_version_is_printed(self):
        r = run("--source", str(FIXTURES / "versions-newer.json"), "--surfer-json", str(SURFER))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, "157.0.2\n")

    def test_same_version_prints_nothing(self):
        r = run("--source", str(FIXTURES / "versions-same.json"), "--surfer-json", str(SURFER))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, "")

    def test_older_version_prints_nothing(self):
        r = run("--source", str(FIXTURES / "versions-older.json"), "--surfer-json", str(SURFER))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, "")

    def test_current_flag_overrides_surfer_json(self):
        r = run("--source", str(FIXTURES / "versions-same.json"), "--current", "156.0")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, "157.0.1\n")

    def test_malformed_json_exits_non_zero(self):
        r = run("--source", str(FIXTURES / "versions-malformed.json"), "--surfer-json", str(SURFER))
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")
        self.assertIn("malformed", r.stderr)

    def test_missing_key_exits_non_zero(self):
        r = run(
            "--source", str(FIXTURES / "versions-missing-key.json"), "--surfer-json", str(SURFER)
        )
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")
        self.assertIn("LATEST_FIREFOX_VERSION", r.stderr)


class VersionKey(unittest.TestCase):
    def test_orders_dot_releases_numerically(self):
        key = load_module().version_key
        self.assertLess(key("157.0.1"), key("157.0.2"))
        self.assertLess(key("157.0.2"), key("157.0.10"))
        self.assertLess(key("157.0"), key("157.0.1"))
        self.assertLess(key("99.0"), key("157.0"))
        self.assertEqual(key("158"), key("158.0"))

    def test_rejects_non_release_versions(self):
        key = load_module().version_key
        for bad in ("159.0a1", "158.0b9", "140.15.0esr", "", "x"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                key(bad)


if __name__ == "__main__":
    unittest.main()
