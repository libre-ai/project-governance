import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("generation_coherence", HERE / "check-generation-coherence.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

GATE = "tools/quality/check-bun-manifests.ts"
GOVERNANCE_REF = "a" * 40
APP_REF = "b" * 40
RUST_REF = "c" * 40
GATE_RUNS_MANIFEST_GATE = json.dumps({"scripts": {"check:bun": "bun run check:bun:runtime && bun node_modules/@libre-ai/governance/" + GATE}})
VIOLATING = json.dumps({"scripts": {"check:bun": "bun x/" + GATE, "prepublishOnly": "VIOLATION"}})
NO_GATE = json.dumps({"scripts": {"check": "bun test"}})


def manifest(*names):
    refs = {"project-governance": GOVERNANCE_REF, "app": APP_REF, "rust": RUST_REF}
    return {"repositories": {n: {"repository": "libre-ai/" + n, "ref": refs.get(n, "d" * 40)} for n in names}}


def world(**overrides):
    """Repository name → tracked files, a composed governance that carries the gate by default."""
    files = {
        "project-governance": {GATE: "// gate", "package.json": GATE_RUNS_MANIFEST_GATE},
        "app": {"package.json": GATE_RUNS_MANIFEST_GATE},
        "rust": {"Cargo.toml": ""},
    }
    files.update(overrides)
    return files


class FakeRunner:
    """Stands in for git and bun: fetch writes the world's files, the gate fails on a VIOLATION marker."""

    def __init__(self, files, refuse_fetch=(), fail_install=()):
        self.files, self.refuse_fetch, self.fail_install = files, set(refuse_fetch), set(fail_install)
        self.calls, self.refs = [], {}

    def __call__(self, argv, cwd, timeout):
        cwd = Path(cwd)
        self.calls.append((argv, cwd.name))
        if argv[:2] == ["git", "init"] or "checkout" in argv:
            return 0, ""
        if "fetch" in argv:
            name = argv[-2].rsplit("/", 1)[-1]
            if name in self.refuse_fetch:
                return 128, "fatal: couldn't find remote ref\n"
            self.refs[cwd] = argv[-1]
            for path, text in self.files[name].items():
                target = cwd / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text)
            return 0, ""
        if argv[:2] == ["git", "rev-parse"]:
            return 0, self.refs[cwd] + "\n"
        if argv[:2] == ["git", "ls-files"]:
            return 0, "".join(path + "\0" for path in sorted(self.files[cwd.name]))
        if argv[:2] == ["bun", "install"]:
            return (1, "error: lockfile had changes\n") if cwd.name in self.fail_install else (0, "")
        if argv[0] == "bun" and argv[1].endswith(GATE):
            if "VIOLATION" in (cwd / "package.json").read_text():
                return 1, "Bun manifests: package.json: prepublishOnly must enforce the Bun floor first\nBun manifests failed: 1 of 1 assertion(s) did not hold.\n"
            return 0, "Bun manifests verified\n"
        raise AssertionError(f"unexpected command {argv}")


def run_check(files, names=("project-governance", "app", "rust"), **faults):
    runner = FakeRunner(files, **faults)
    with tempfile.TemporaryDirectory() as scratch:
        counts, failures, exempt = module.check(
            manifest(*names), Path(scratch) / "root", runner,
            installs_for=lambda name: name != "rust",
            url_for=lambda repository: "fake://" + repository,
        )
    return counts, failures, exempt, runner


class CheckTests(unittest.TestCase):
    def test_a_coherent_generation_passes_and_every_target_is_accounted_for(self):
        counts, failures, exempt, _ = run_check(world())
        self.assertEqual(failures, [])
        self.assertEqual(exempt, ["rust"])
        self.assertEqual(counts["declared"], counts["verified"] + counts["failed"] + counts["not_applicable"])
        self.assertEqual((counts["verified"], counts["failed"], counts["not_applicable"]), (2, 0, 1))
        self.assertEqual((counts["roots"], counts["passed"]), (2, 2))

    def test_a_violating_manifest_at_a_composed_ref_fails_and_names_the_ref_and_the_rule(self):
        # The Q shape: the composed governance carries the rule, the composed
        # target carries a manifest the rule refuses.
        counts, failures, _, _ = run_check(world(app={"package.json": VIOLATING}))
        self.assertEqual(counts["failed"], 1)
        self.assertEqual(len(failures), 1)
        self.assertIn("libre-ai/app@" + APP_REF, failures[0])
        self.assertIn("prepublishOnly must enforce the Bun floor first", failures[0])

    def test_the_gate_replayed_is_the_one_of_the_composed_governance(self):
        _, _, _, runner = run_check(world())
        gates = [argv for argv, _ in runner.calls if argv[0] == "bun" and argv[1].endswith(GATE)]
        self.assertTrue(gates)
        for argv in gates:
            self.assertIn("/project-governance/" + GATE, argv[1])

    def test_gate_roots_are_derived_from_the_tracked_tree_not_from_the_root_manifest(self):
        # A workspace root with no check:bun of its own: its packages are the roots.
        app = {"package.json": NO_GATE, "packages/ui/package.json": VIOLATING, "packages/lib/package.json": GATE_RUNS_MANIFEST_GATE}
        counts, failures, _, _ = run_check(world(app=app))
        self.assertEqual((counts["roots"], counts["passed"]), (3, 2))
        self.assertEqual(len(failures), 1)
        self.assertIn("packages/ui:", failures[0])

    def test_an_installed_target_with_no_gate_root_fails_instead_of_passing_empty(self):
        counts, failures, _, _ = run_check(world(app={"package.json": NO_GATE}))
        self.assertEqual(counts["failed"], 1)
        self.assertIn("no tracked package.json runs check-bun-manifests.ts", failures[0])

    def test_a_failed_install_fails_the_target(self):
        counts, failures, _, _ = run_check(world(), fail_install={"app"})
        self.assertEqual(counts["failed"], 1)
        self.assertIn("lockfile had changes", failures[0])

    def test_a_ref_git_cannot_fetch_is_a_failure_never_a_zero(self):
        counts, failures, _, _ = run_check(world(), refuse_fetch={"app"})
        self.assertEqual(counts["failed"], 1)
        self.assertIn("cannot fetch " + APP_REF[:12], failures[0])
        self.assertEqual(counts["declared"], counts["verified"] + counts["failed"] + counts["not_applicable"])

    def test_a_governance_that_cannot_be_fetched_fails_every_other_target(self):
        counts, failures, _, _ = run_check(world(), refuse_fetch={"project-governance"})
        self.assertEqual(counts["verified"], 0)
        self.assertEqual(counts["failed"], 3)
        self.assertEqual(len(failures), 3)

    def test_a_governance_without_the_gate_has_nothing_to_replay_and_fails(self):
        counts, failures, _, _ = run_check(world(**{"project-governance": {"package.json": GATE_RUNS_MANIFEST_GATE}}))
        self.assertEqual(counts["verified"], 0)
        self.assertTrue(all("carries no tools/quality/check-bun-manifests.ts" in failure for failure in failures))

    def test_a_target_without_a_bun_install_but_with_a_manifest_fails(self):
        counts, failures, exempt, _ = run_check(world(rust={"package.json": GATE_RUNS_MANIFEST_GATE}))
        self.assertEqual(exempt, [])
        self.assertEqual(counts["not_applicable"], 0)
        self.assertIn("runs no Bun install for it", failures[0])

    def test_an_unreadable_manifest_fails_the_target(self):
        counts, failures, _, _ = run_check(world(app={"package.json": "{not json"}))
        self.assertEqual(counts["failed"], 1)
        self.assertIn("package.json: unreadable", failures[0])


class VolumeTests(unittest.TestCase):
    def test_the_volume_prints_the_counters_and_the_exempt_target(self):
        counts, _, exempt, _ = run_check(world())
        text = module.volume(counts, exempt, manifest("project-governance", "app", "rust"))
        self.assertIn("3 target(s) declared: 2 verified, 0 failed, 1 not applicable (rust:", text)
        self.assertIn("2 gate root(s) replayed, 2 passed", text)
        self.assertIn("libre-ai/project-governance@" + GOVERNANCE_REF, text)


class CommittedManifestTests(unittest.TestCase):
    def test_only_the_rust_inspector_composes_without_a_bun_install(self):
        prepare = module.load_prepare()
        current = module.read_manifest(HERE / "manifest.json", prepare)
        without = sorted(
            name for name in current["repositories"]
            if not any(step["cwd"] == name for step in prepare.prepare(current, name)["install"])
        )
        self.assertEqual(without, ["database-policy-inspector"])

    def test_the_committed_manifest_reads_and_names_the_governance_it_replays_from(self):
        prepare = module.load_prepare()
        current = module.read_manifest(HERE / "manifest.json", prepare)
        self.assertIn(module.GOVERNANCE, current["repositories"])


class DeclarationTests(unittest.TestCase):
    """`--declaration <sha>` reads the manifest a governance commit composes, from git."""

    def test_the_manifest_is_read_at_the_declared_commit_not_at_the_working_tree(self):
        committed = (HERE / "manifest.json").read_text()
        with tempfile.TemporaryDirectory() as scratch:
            def git(*args):
                return subprocess.run(
                    ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", *args],
                    cwd=scratch, check=True, capture_output=True, text=True,
                ).stdout.strip()
            git("init", "--quiet", "-b", "trunk")
            target = Path(scratch) / ".github" / "composition" / "manifest.json"
            target.parent.mkdir(parents=True)
            target.write_text(committed)
            git("add", ".")
            git("commit", "--quiet", "-m", "declared")
            declared = git("rev-parse", "HEAD")
            target.write_text("{}")  # the working tree no longer matches the declaration
            prepare = module.load_prepare()
            read = module.manifest_at(declared, prepare, repository=scratch)
            self.assertEqual(read, json.loads(committed))

    def test_an_unknown_commit_or_a_non_sha_is_refused_never_read_as_empty(self):
        prepare = module.load_prepare()
        with self.assertRaises(ValueError):
            module.manifest_at("f" * 40, prepare, repository=HERE)
        with self.assertRaises(ValueError):
            module.manifest_at("main", prepare)


if __name__ == "__main__":
    unittest.main()
