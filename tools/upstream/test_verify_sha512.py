"""Tests for verify-sha512.py: Mozilla's signature on SHA512SUMS, then a tarball's hash in it.

Fixtures only, no network (fixtures/sums/): Mozilla's own SHA512SUMS and SHA512SUMS.asc of
157.0.1 (signed by the current subkey) and 153.0 (signed by the subkey revoked as compromised on
2026-08-06), and synthetic signatures from make-synthetic.sh. The command line always checks
against the pinned key; the synthetic expired-subkey case calls check_signature with its own key.
"""

import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "verify-sha512.py"
SUMS = HERE / "fixtures" / "sums"
CURRENT = SUMS / "157.0.1"
REVOKED = SUMS / "153.0"
SYNTHETIC = SUMS / "synthetic"
NAME = "source/firefox-157.0.1.source.tar.xz"
# Line 821 of 157.0.1's SHA512SUMS; equal to sha512sum of the tarball (spec m0-rebase-playbook).
HASH = (
    "c019202b2f87d25b3605bbf7266f3bb4d59745e48536f297d3f00cc3524a1cd2"
    "eba416a5a3cd0ecee6b0762d0f35bf3c5fcce286ebc7bc741263bebd0f102858"
)
MOZILLA = "14F26682D0916CDD81E37B6D61B7B526D98F0353"
CURRENT_SUBKEY = "827E658608679618CD349F93678E455D76767AA3"
COMPROMISED_SUBKEY = "09BEED63F3462A2DFFAB3B875ECB6497C1A20256"


def load_module():
    spec = importlib.util.spec_from_file_location("verify_sha512", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(*args, env=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, text=True, check=False, env=env
    )


class Verify(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="verify-sha512-"))
        self.addCleanup(shutil.rmtree, self.tmp)

    def actual(self, text):
        path = self.tmp / "tarball.sha512"
        path.write_text(text, encoding="utf-8")
        return path

    def verify(self, sums=CURRENT / "SHA512SUMS", sig=CURRENT / "SHA512SUMS.asc", name=NAME,
               actual=None, env=None):
        actual = actual or self.actual(f"{HASH}  -\n")
        return run("--sums", str(sums), "--signature", str(sig), "--name", name,
                   "--actual", str(actual), env=env)

    def test_good_signature_from_mozillas_current_subkey_passes(self):
        r = self.verify()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(NAME, r.stdout)
        self.assertIn(CURRENT_SUBKEY, r.stdout)

    def test_signature_by_the_revoked_compromised_subkey_fails(self):
        # gpgv prints "Good signature" and exits 0 here (spec build-supply-chain, R2); only the
        # status line says REVKEYSIG. The hash is genuine, so only the signature can fail it.
        name = "source/firefox-153.0.source.tar.xz"
        line = next(l for l in (REVOKED / "SHA512SUMS").read_text().splitlines()
                    if l.endswith("  " + name))
        r = self.verify(sums=REVOKED / "SHA512SUMS", sig=REVOKED / "SHA512SUMS.asc", name=name,
                        actual=self.actual(line.split()[0] + "  -\n"))
        self.assertEqual(r.returncode, 1)
        self.assertIn("REVKEYSIG", r.stderr)
        self.assertNotIn("matches", r.stdout)

    def test_signature_by_another_key_fails(self):
        r = self.verify(sig=SYNTHETIC / "other.asc")
        self.assertEqual(r.returncode, 1)
        self.assertIn("not signed by Mozilla's release key", r.stderr)
        self.assertIn("NO_PUBKEY", r.stderr)

    def test_a_second_signature_beside_mozillas_fails(self):
        # Two armoured blocks in one file are refused before gpgv runs.
        r = self.verify(sig=SYNTHETIC / "two-signatures.asc")
        self.assertEqual(r.returncode, 1)
        self.assertIn("not signed by Mozilla's release key", r.stderr)
        self.assertIn("not exactly one armoured signature block", r.stderr)
        # The same two signatures as one binary file get to gpgv, which sees two.
        module = load_module()
        mozilla = (CURRENT / "SHA512SUMS.asc").read_text()
        other = (SYNTHETIC / "other.asc").read_text()
        binary = self.tmp / "two-signatures.sig"
        binary.write_bytes(module.dearmor(mozilla, "SIGNATURE") + module.dearmor(other, "SIGNATURE"))
        r = self.verify(sig=binary)
        self.assertEqual(r.returncode, 1)
        self.assertIn("NO_PUBKEY", r.stderr)

    def test_signature_by_an_expired_subkey_fails(self):
        module = load_module()
        expired = SYNTHETIC / "expired"
        fingerprint = (expired / "fingerprint").read_text().strip()
        with self.assertRaises(module.Untrusted) as caught:
            module.check_signature((expired / "SHA512SUMS").read_bytes(),
                                   expired / "SHA512SUMS.asc", expired / "key.asc", fingerprint)
        self.assertIn("EXPKEYSIG", str(caught.exception))

    def test_the_status_must_name_the_pinned_primary_key(self):
        module = load_module()
        good = (
            "[GNUPG:] NEWSIG\n[GNUPG:] GOODSIG 678E455D76767AA3 Mozilla\n"
            f"[GNUPG:] VALIDSIG {CURRENT_SUBKEY} 2026-10-05 1791230126 0 4 0 1 10 00 {{}}\n"
        )
        self.assertEqual(module.signature_verdict(good.format(MOZILLA), MOZILLA), CURRENT_SUBKEY)
        with self.assertRaises(module.Untrusted):
            module.signature_verdict(good.format("0" * 40), MOZILLA)
        with self.assertRaises(module.Untrusted):
            module.signature_verdict(good.replace("GOODSIG", "EXPSIG").format(MOZILLA), MOZILLA)
        with self.assertRaises(module.Untrusted):
            module.signature_verdict("", MOZILLA)
        # gpgv saw signed data inside the .asc itself: never a detached signature.
        with self.assertRaises(module.Untrusted):
            module.signature_verdict(
                good.format(MOZILLA) + "[GNUPG:] PLAINTEXT 62 0 SHA512SUMS\n", MOZILLA
            )

    def packet_case(self, asc):
        module = load_module()
        packets = SYNTHETIC / "packets"
        return module, lambda: module.check_signature(
            (packets / "SHA512SUMS").read_bytes(), packets / asc, packets / "key.asc",
            (packets / "fingerprint").read_text().strip(),
        )

    def test_a_detached_signature_by_the_given_key_passes(self):
        _, check = self.packet_case("detached.asc")
        self.assertRegex(check(), r"^[0-9A-F]{40}$")

    def test_a_signed_message_in_place_of_a_detached_signature_fails(self):
        # Its own literal data, not SHA512SUMS, is what it signs; the .asc must hold signature
        # packets only, whatever a gpgv version does with it.
        for asc in ("opaque.asc", "clearsign.asc"):
            module, check = self.packet_case(asc)
            with self.subTest(asc), self.assertRaises(module.Untrusted) as caught:
                check()
            self.assertIn("not a detached signature", str(caught.exception))

    def test_one_changed_byte_in_sha512sums_fails_the_signature(self):
        data = bytearray((CURRENT / "SHA512SUMS").read_bytes())
        data[100] ^= 0x01
        sums = self.tmp / "SHA512SUMS"
        sums.write_bytes(bytes(data))
        r = self.verify(sums=sums)
        self.assertEqual(r.returncode, 1)
        self.assertIn("BADSIG", r.stderr)

    def test_good_signature_but_a_different_hash_fails_naming_expected_and_actual(self):
        r = self.verify(actual=self.actual("a" * 128 + "  -\n"))
        self.assertEqual(r.returncode, 1)
        self.assertIn(HASH, r.stderr)  # expected, from the signed SHA512SUMS
        self.assertIn("a" * 128, r.stderr)  # actual, from sha512sum
        self.assertIn("mismatch", r.stderr)

    def test_missing_signature_or_gpgv_cannot_check_and_exits_two(self):
        r = self.verify(sig=self.tmp / "SHA512SUMS.asc")
        self.assertEqual(r.returncode, 2)
        # A PATH with python but without gpgv.
        bindir = self.tmp / "bin"
        bindir.mkdir()
        (bindir / "python3").symlink_to(sys.executable)
        r = self.verify(env={**os.environ, "PATH": str(bindir)})
        self.assertEqual(r.returncode, 2)
        self.assertIn("gpgv", r.stderr)

    def test_signature_argument_is_required(self):
        r = run("--sums", str(CURRENT / "SHA512SUMS"), "--name", NAME,
                "--actual", str(self.actual(f"{HASH}  -\n")))
        self.assertEqual(r.returncode, 2)
        self.assertIn("--signature", r.stderr)

    def test_pinned_key_is_mozillas_primary_with_the_compromised_subkey_revoked(self):
        module = load_module()
        self.assertEqual(module.PINNED_FINGERPRINT, MOZILLA)
        home = self.tmp / "gnupg"
        home.mkdir(mode=0o700)
        shown = subprocess.run(
            ["gpg", "--homedir", str(home), "--batch", "--with-colons",
             "--with-subkey-fingerprints", "--show-keys", str(module.KEY_FILE)],
            capture_output=True, text=True, check=True,
        ).stdout.splitlines()
        records = [l.split(":") for l in shown]
        self.assertEqual([r[0] for r in records].count("pub"), 1)
        fingerprints = [r[9] for r in records if r[0] == "fpr"]
        self.assertEqual(fingerprints[0], MOZILLA)
        # Each subkey's validity is the field of the `sub` record before its `fpr` record.
        validity = {records[i + 1][9]: r[1] for i, r in enumerate(records) if r[0] == "sub"}
        self.assertEqual(validity[COMPROMISED_SUBKEY], "r")
        self.assertNotIn(validity[CURRENT_SUBKEY], ("r", "e"))

    def test_only_the_exact_name_counts_not_the_asc_next_to_it(self):
        r = self.verify(name="source/firefox-157.0.1.source.tar")
        self.assertEqual(r.returncode, 2)
        self.assertIn("no entry", r.stderr)

    def test_malformed_actual_hash_exits_two(self):
        r = self.verify(actual=self.actual("not a hash\n"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("not a SHA-512", r.stderr)

    def test_missing_sums_file_exits_two(self):
        r = self.verify(sums=self.tmp / "nope")
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
