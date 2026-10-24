# SPDX-License-Identifier: EUPL-1.2
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
POLICY = HERE.parents[1] / "toolchains" / "osv-scanner.json"
spec = importlib.util.spec_from_file_location("downloader", HERE / "download-advisory-database.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

TARGET = "execution-continuity-evaluator"
REVISION = "a" * 40
LOCK = "tools/review/bun.lock"
DATABASE = "osv-scalibr/npm/all.zip"


def scanner_script(code=0, write="printf data > \"$db\"", stamp=""):
    # The fake records what the real scanner would have seen: whether the
    # database file was still there when it started, its arguments, its
    # working directory and its cache directory.
    return f"""#!/bin/sh
here=$(dirname "$0")
db="$OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY/{DATABASE}"
if [ -e "$db" ]; then echo present > "$here/db-at-start"; else echo absent > "$here/db-at-start"; fi
echo "$*" > "$here/argv"
echo "$OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY" > "$here/cache"
pwd -P > "$here/cwd"
mkdir -p "$(dirname "$db")"
{write}
{stamp}
exit {code}
"""


class DownloaderTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.base = Path(self._tmp.name).resolve()
        self.root = self.base / "composition"
        self.target_root = self.root / TARGET
        (self.target_root / "tools" / "review").mkdir(parents=True)
        (self.target_root / LOCK).write_text("{}\n")
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.database = self.target_root / ".cache" / "osv-advisory-db" / DATABASE

    def scanner(self, **kwargs):
        path = self.bin / "osv-scanner"
        path.write_text(scanner_script(**kwargs))
        path.chmod(0o755)
        return path

    def run_download(self, scanner, target=TARGET, policy=POLICY):
        return module.download(target, REVISION, self.root, policy, scanner)

    def recorded(self, name):
        return (self.bin / name).read_text().strip()

    def test_target_that_does_not_require_the_database_runs_nothing(self):
        scanner = self.scanner()
        self.assertIsNone(self.run_download(scanner, target="project-governance"))
        self.assertIsNone(self.run_download(None, target="schemas-and-contracts"))
        self.assertFalse((self.bin / "argv").exists())

    def test_downloads_into_the_path_the_consumer_gate_reads(self):
        scanner = self.scanner()
        result = self.run_download(scanner)
        cache = self.target_root / ".cache" / "osv-advisory-db"
        self.assertEqual(self.recorded("cache"), str(cache))
        self.assertEqual(self.recorded("cwd"), str(self.target_root))
        self.assertEqual(
            self.recorded("argv"),
            f"scan source --offline --download-offline-databases -L {self.target_root / LOCK}",
        )
        self.assertEqual(self.database.read_text(), "data")
        self.assertEqual(result["file"], str(self.database))
        self.assertEqual(result["bytes"], 4)

    def test_stale_file_is_deleted_before_the_download(self):
        # A second --download-offline-databases leaves an existing file and its
        # date untouched, so a stale file would pass for a fresh one.
        self.database.parent.mkdir(parents=True)
        self.database.write_text("stale")
        os.utime(self.database, (946684800, 946684800))
        self.run_download(self.scanner())
        self.assertEqual(self.recorded("db-at-start"), "absent")
        self.assertEqual(self.database.read_text(), "data")
        self.assertGreater(self.database.stat().st_mtime, time.time() - 60)

    def test_advisories_found_in_the_lock_do_not_block_the_provision(self):
        # Exit 1 means "scanned, advisories found": judging them is the
        # consumer gate's work, not this step's.
        self.assertEqual(self.run_download(self.scanner(code=1))["bytes"], 4)

    def test_scanner_failure_fails_closed(self):
        with self.assertRaises(ValueError):
            self.run_download(self.scanner(code=2))

    def test_scanner_that_writes_nothing_is_not_a_green_even_with_a_stale_file(self):
        self.database.parent.mkdir(parents=True)
        self.database.write_text("stale")
        with self.assertRaises(ValueError):
            self.run_download(self.scanner(write=":"))
        self.assertFalse(self.database.exists())

    def test_empty_database_file_is_refused(self):
        with self.assertRaises(ValueError):
            self.run_download(self.scanner(write=': > "$db"'))

    def test_file_not_written_by_this_run_is_refused(self):
        scanner = self.scanner(stamp='touch -t 200001010000 "$db"')
        with self.assertRaises(ValueError):
            self.run_download(scanner)

    def test_scanner_must_be_an_absolute_executable_file(self):
        scanner = self.scanner()
        for bad in (None, "osv-scanner", self.bin / "missing", self.bin):
            with self.assertRaises(ValueError, msg=str(bad)):
                self.run_download(bad)
        scanner.chmod(0o644)
        with self.assertRaises(ValueError):
            self.run_download(scanner)
        self.assertFalse((self.bin / "argv").exists())

    def test_missing_or_linked_lock_is_refused_before_any_download(self):
        scanner = self.scanner()
        (self.target_root / LOCK).unlink()
        with self.assertRaises(ValueError):
            self.run_download(scanner)
        (self.target_root / LOCK).symlink_to(self.base / "elsewhere")
        with self.assertRaises(ValueError):
            self.run_download(scanner)
        self.assertFalse((self.bin / "argv").exists())

    def test_cache_directory_cannot_leave_the_target_checkout(self):
        scanner = self.scanner()
        outside = self.base / "outside"
        outside.mkdir()
        (self.target_root / ".cache").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.run_download(scanner)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertFalse((self.bin / "argv").exists())

    def test_database_layout_comes_from_the_scanner_policy(self):
        policy = json.loads(POLICY.read_text())
        self.assertEqual(module.database_file(policy), DATABASE)
        for bad in ("../all.zip", "/all.zip", "a//b", "", None, 3):
            altered = json.loads(json.dumps(policy))
            altered["offlineDatabase"]["file"] = bad
            with self.assertRaises(ValueError, msg=str(bad)):
                module.database_file(altered)
        with self.assertRaises(ValueError):
            module.database_file({})

    def test_main_reports_a_refusal_and_never_a_silent_zero(self):
        scanner = self.scanner(write=":")
        argv = ["--target", TARGET, "--revision", REVISION, "--root", str(self.root), "--policy", str(POLICY)]
        env = {"LIBRE_AI_OSV_SCANNER": str(scanner)}
        err = io.StringIO()
        with patch.dict(os.environ, env), contextlib.redirect_stderr(err):
            self.assertEqual(module.main(argv), 1)
        self.assertIn("advisory database", err.getvalue())
        out = io.StringIO()
        self.scanner()
        with patch.dict(os.environ, env), contextlib.redirect_stdout(out):
            self.assertEqual(module.main(argv), 0)
        self.assertIn(str(self.database), out.getvalue())
        self.assertIn("4 bytes", out.getvalue())

    def test_main_states_when_no_database_is_required(self):
        argv = ["--target", "project-governance", "--revision", REVISION, "--root", str(self.root), "--policy", str(POLICY)]
        out = io.StringIO()
        with patch.dict(os.environ, {}, clear=False), contextlib.redirect_stdout(out):
            self.assertEqual(module.main(argv), 0)
        self.assertIn("not required", out.getvalue())


if __name__ == "__main__":
    unittest.main()
