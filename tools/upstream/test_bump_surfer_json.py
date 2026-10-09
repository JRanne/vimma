"""Tests for bump-surfer-json.py. Fixture surfer.json in, expected surfer.json out."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "bump-surfer-json.py"
FIXTURES = HERE / "fixtures"


def run(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, text=True, check=False
    )


class BumpSurferJson(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.target = self.tmp / "surfer.json"
        shutil.copyfile(FIXTURES / "surfer-in.json", self.target)

    def test_rewrites_only_the_firefox_version(self):
        r = run("158.0", "--file", str(self.target))
        self.assertEqual(r.returncode, 0, r.stderr)
        expected = (FIXTURES / "surfer-out-158.0.json").read_bytes()
        self.assertEqual(self.target.read_bytes(), expected)

    def test_reports_old_and_new_version(self):
        r = run("158.0", "--file", str(self.target))
        self.assertEqual(r.stdout, "157.0.1 -> 158.0\n")

    def test_same_version_is_a_no_op(self):
        before = self.target.read_bytes()
        r = run("157.0.1", "--file", str(self.target))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.target.read_bytes(), before)

    def test_rejects_a_non_release_version(self):
        before = self.target.read_bytes()
        r = run("159.0a1", "--file", str(self.target))
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.target.read_bytes(), before)

    def test_rejects_a_non_firefox_product(self):
        self.target.write_text('{"version": {"product": "thunderbird", "version": "157.0.1"}}')
        r = run("158.0", "--file", str(self.target))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("firefox", r.stderr)

    def test_malformed_surfer_json_exits_non_zero(self):
        self.target.write_text('{"version": ')
        r = run("158.0", "--file", str(self.target))
        self.assertNotEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
