import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("monotonicity", HERE / "check-ref-monotonicity.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

A, B, C, D = ("a" * 40, "b" * 40, "c" * 40, "d" * 40)


def manifest(**refs):
    return {"repositories": {name: {"repository": "libre-ai/" + name, "ref": ref} for name, ref in refs.items()}}


def oracle(edges):
    """`is_ancestor` over an explicit set of (old, new) pairs that advance."""
    def is_ancestor(repository, old, new):
        if old == D or new == D:
            raise module.AncestryError("commit not served")
        return (old, new) in edges
    return is_ancestor


class CompareTests(unittest.TestCase):
    def test_a_ref_that_advances_passes(self):
        counts, failures = module.compare(manifest(x=A), manifest(x=B), oracle({(A, B)}), {})
        self.assertEqual(failures, [])
        self.assertEqual(counts["advanced"], 1)

    def test_a_ref_that_goes_back_fails(self):
        counts, failures = module.compare(manifest(x=B), manifest(x=A), oracle({(A, B)}), {})
        self.assertEqual(counts["failing"], 1)
        self.assertIn("does not descend from the previously declared", failures[0])

    def test_a_ref_that_moves_sideways_fails(self):
        _, failures = module.compare(manifest(x=B), manifest(x=C), oracle({(A, B), (A, C)}), {})
        self.assertEqual(len(failures), 1)

    def test_an_exempted_target_passes_and_is_counted(self):
        counts, failures = module.compare(
            manifest(x=B), manifest(x=A), oracle(set()), {("libre-ai/x", A): "intended rollback"}
        )
        self.assertEqual((failures, counts["exempt"]), ([], 1))

    def test_an_unreachable_commit_fails_never_passes(self):
        counts, failures = module.compare(manifest(x=A), manifest(x=D), oracle(set()), {})
        self.assertEqual(counts["failing"], 1)
        self.assertIn("cannot verify", failures[0])

    def test_unchanged_and_new_refs_ask_nothing_and_the_counters_sum(self):
        def never(*_):
            raise AssertionError("no ancestry question for an unchanged or new ref")
        counts, failures = module.compare(manifest(x=A), manifest(x=A, y=B), never, {})
        self.assertEqual(failures, [])
        self.assertEqual(counts, {"examined": 2, "unchanged": 1, "new": 1, "advanced": 0, "exempt": 0, "failing": 0})
        self.assertEqual(
            module.volume(counts),
            "2 composed ref(s) examined: 1 unchanged, 1 new, 0 advanced (ancestry verified), 0 exempt, 0 failing",
        )

    def test_a_manifest_without_repositories_is_unreadable(self):
        with self.assertRaises(ValueError):
            module.compare({}, manifest(x=A), oracle(set()), {})

    def test_the_committed_manifest_against_itself_is_unchanged(self):
        current = json.loads((HERE / "manifest.json").read_text())
        counts, failures = module.compare(current, current, oracle(set()), {})
        self.assertEqual(failures, [])
        self.assertEqual(counts["unchanged"], counts["examined"])
        self.assertGreater(counts["examined"], 0)


class ExemptionTests(unittest.TestCase):
    def test_the_committed_register_parses(self):
        module.load_exemptions((HERE / "ref-monotonicity-exemptions.json").read_text())

    def test_an_entry_without_a_reason_or_a_full_sha_is_refused(self):
        document = {"schemaVersion": module.EXEMPTIONS_SCHEMA, "exemptions": [{"repository": "r", "to": A, "because": " "}]}
        with self.assertRaises(ValueError):
            module.load_exemptions(json.dumps(document))
        document["exemptions"][0] = {"repository": "r", "to": "abc", "because": "why"}
        with self.assertRaises(ValueError):
            module.load_exemptions(json.dumps(document))


def git(cwd, *args):
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", *args],
        cwd=cwd, check=True, capture_output=True, text=True,
    ).stdout.strip()


class GitAncestryTests(unittest.TestCase):
    """The real oracle, against a local repository: no network."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        repo = cls.tmp.name
        git(repo, "init", "--quiet", "-b", "trunk")
        git(repo, "commit", "--quiet", "--allow-empty", "-m", "a")
        cls.a = git(repo, "rev-parse", "HEAD")
        git(repo, "commit", "--quiet", "--allow-empty", "-m", "b")
        cls.b = git(repo, "rev-parse", "HEAD")
        git(repo, "switch", "--quiet", "-c", "side", cls.a)
        git(repo, "commit", "--quiet", "--allow-empty", "-m", "c")
        cls.c = git(repo, "rev-parse", "HEAD")
        git(repo, "config", "uploadpack.allowAnySHA1InWant", "true")
        cls.ancestry = module.GitAncestry(url_for=lambda _repository: "file://" + repo)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_forward_is_an_ancestor(self):
        self.assertTrue(self.ancestry("r", self.a, self.b))

    def test_backward_and_sideways_are_not(self):
        self.assertFalse(self.ancestry("r", self.b, self.a))
        self.assertFalse(self.ancestry("r", self.b, self.c))

    def test_an_unknown_commit_is_an_error(self):
        with self.assertRaises(module.AncestryError):
            self.ancestry("r", self.a, "e" * 40)


class CommandLineTests(unittest.TestCase):
    def run_cli(self, previous, current):
        with tempfile.TemporaryDirectory() as scratch:
            before, after = Path(scratch, "before.json"), Path(scratch, "after.json")
            before.write_text(previous)
            after.write_text(current)
            return subprocess.run(
                [sys.executable, "-B", str(HERE / "check-ref-monotonicity.py"), "--previous", str(before), "--manifest", str(after)],
                capture_output=True, text=True,
            )

    def test_green_prints_the_volume(self):
        done = self.run_cli(json.dumps(manifest(x=A)), json.dumps(manifest(x=A)))
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("1 composed ref(s) examined: 1 unchanged", done.stdout)

    def test_an_unreadable_previous_manifest_fails(self):
        done = self.run_cli("{not json", json.dumps(manifest(x=A)))
        self.assertEqual(done.returncode, 1)
        self.assertIn("unreadable input", done.stderr)

    def test_an_empty_manifest_fails(self):
        done = self.run_cli(json.dumps(manifest(x=A)), json.dumps({"repositories": {}}))
        self.assertEqual(done.returncode, 1)


if __name__ == "__main__":
    unittest.main()
