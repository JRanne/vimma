"""Tests for verify-sha512.py: a tarball's hash against Mozilla's SHA512SUMS. Fixtures only."""

import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "verify-sha512.py"
FIXTURES = HERE / "fixtures" / "sha512"
SUMS = FIXTURES / "SHA512SUMS"
NAME = "source/firefox-158.0.source.tar.xz"


def run(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, text=True, check=False
    )


def verify(actual, name=NAME):
    return run("--sums", str(SUMS), "--name", name, "--actual", str(FIXTURES / actual))


class VerifySha512(unittest.TestCase):
    def test_matching_hash_exits_zero(self):
        r = verify("actual-match.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(NAME, r.stdout)

    def test_mismatch_exits_one_naming_expected_and_actual(self):
        r = verify("actual-mismatch.txt")
        self.assertEqual(r.returncode, 1)
        self.assertIn("b" * 128, r.stderr)  # expected, from SHA512SUMS
        self.assertIn("a" * 128, r.stderr)  # actual, from sha512sum
        self.assertIn("mismatch", r.stderr)

    def test_only_the_exact_name_counts_not_the_asc_next_to_it(self):
        r = verify("actual-match.txt", name="source/firefox-158.0.source.tar")
        self.assertEqual(r.returncode, 2)
        self.assertIn("no entry", r.stderr)

    def test_malformed_actual_hash_exits_two(self):
        r = verify("actual-malformed.txt")
        self.assertEqual(r.returncode, 2)
        self.assertIn("not a SHA-512", r.stderr)

    def test_missing_sums_file_exits_two(self):
        r = run("--sums", str(FIXTURES / "nope"), "--name", NAME, "--actual", str(SUMS))
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
