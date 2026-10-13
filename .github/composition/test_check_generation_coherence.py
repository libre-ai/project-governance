import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

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

    def __init__(self, files, refuse_fetch=(), fail_install=(), wrong_ref=()):
        self.files, self.refuse_fetch, self.fail_install = files, set(refuse_fetch), set(fail_install)
        self.wrong_ref = set(wrong_ref)
        self.calls, self.refs, self.config_files = [], {}, []

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
            # A server that answers FETCH_HEAD with another commit than the one asked for.
            return 0, ("e" * 40 if cwd.name in self.wrong_ref else self.refs[cwd]) + "\n"
        if argv[:2] == ["git", "ls-files"]:
            return 0, "".join(path + "\0" for path in sorted(self.files[cwd.name]))
        if argv[0] == "bun":
            # Every bun call must name a config file that is empty and outside the target.
            config = [arg for arg in argv if arg.startswith("--config=")]
            assert len(config) == 1, f"bun call without --config: {argv}"
            path = Path(config[0][len("--config="):])
            assert path.is_file() and path.read_text() == "" and cwd not in path.parents, argv
            self.config_files.append(path)
        if argv[0] == "bun" and "install" in argv:
            return (1, "error: lockfile had changes\n") if cwd.name in self.fail_install else (0, "")
        if argv[0] == "bun" and argv[-1].endswith(GATE):
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
        gates = [argv for argv, _ in runner.calls if argv[0] == "bun" and argv[-1].endswith(GATE)]
        self.assertTrue(gates)
        for argv in gates:
            self.assertIn("/project-governance/" + GATE, argv[-1])

    def test_install_and_gate_both_run_under_an_empty_bun_config_outside_the_target(self):
        # A `preload` in the target's bunfig.toml executes the target's code in
        # the gate's process. The runner asserts the --config on every bun call;
        # this counts that the install and the gate were both seen.
        _, _, _, runner = run_check(world())
        bun_calls = [argv for argv, _ in runner.calls if argv[0] == "bun"]
        self.assertEqual(sum("install" in argv for argv in bun_calls), 2)
        self.assertEqual(sum(argv[-1].endswith(GATE) for argv in bun_calls), 2)
        self.assertEqual(len(runner.config_files), len(bun_calls))

    def test_a_checkout_that_is_not_the_composed_ref_fails_the_target(self):
        counts, failures, _, _ = run_check(world(), wrong_ref={"app"})
        self.assertEqual(counts["failed"], 1)
        self.assertIn("checked out eeeeeeeeeeee instead of " + APP_REF[:12], failures[0])
        self.assertEqual(counts["declared"], counts["verified"] + counts["failed"] + counts["not_applicable"])

    def test_manifests_split_into_roots_covered_and_not_examined_and_the_unexamined_are_named(self):
        app = {"package.json": NO_GATE, "packages/ui/package.json": GATE_RUNS_MANIFEST_GATE,
               "packages/ui/sub/package.json": NO_GATE, "tools/x/package.json": NO_GATE}
        counts, failures, _, _ = run_check(world(app=app))
        self.assertEqual(failures, [])
        # project-governance: 1 root. app: 1 root, 1 covered, 2 not examined.
        self.assertEqual((counts["tracked"], counts["rooted"], counts["covered"], counts["unexamined"]), (5, 2, 1, 2))
        self.assertEqual(sorted(counts["unexamined_names"]), ["app:package.json", "app:tools/x/package.json"])
        text = module.volume(counts, [], manifest("project-governance", "app", "rust"))
        self.assertIn("5 tracked package.json = 2 gate root(s) + 1 covered by a root + 2 not examined (", text)
        self.assertIn("app:tools/x/package.json", text)

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


class RunnerEnvironmentTests(unittest.TestCase):
    def test_the_processes_the_guard_starts_never_see_the_callers_secrets(self):
        with mock.patch.dict(os.environ, {"GH_TOKEN": "secret", "FLEET_BUMP_TOKEN": "secret", "BUMP_TOKEN": "secret"}):
            runner = module.make_runner(time.monotonic() + 60)
        code, output = runner([sys.executable, "-c", "import os; print(sorted(os.environ))"], HERE, 30)
        self.assertEqual(code, 0)
        for name in ("GH_TOKEN", "FLEET_BUMP_TOKEN", "BUMP_TOKEN"):
            self.assertNotIn(name, output)
        self.assertIn("GIT_TERMINAL_PROMPT", output)


class GateDriftTests(unittest.TestCase):
    """`--declaration X` replays the COMPOSED gate: it must be the gate X ships."""

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.repository = Path(self.scratch.name) / "declared"
        self.governance = Path(self.scratch.name) / "composed"
        for base in (self.repository, self.governance):
            for relative in module.GATE_CLOSURE:
                (base / relative).parent.mkdir(parents=True, exist_ok=True)
                (base / relative).write_text("// " + relative)
        self.git("init", "--quiet", "-b", "trunk")
        self.git("add", ".")
        self.git("commit", "--quiet", "-m", "declared")
        self.commit = self.git("rev-parse", "HEAD")

    def git(self, *args):
        return subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", *args],
            cwd=self.repository, check=True, capture_output=True, text=True,
        ).stdout.strip()

    def test_identical_gate_files_do_not_drift(self):
        self.assertEqual(module.declared_gate_drift(self.commit, self.governance, self.repository), [])

    def test_a_gate_file_that_differs_is_named(self):
        (self.governance / "tools/quality/bun-script-floor.ts").write_text("// an older rule")
        drift = module.declared_gate_drift(self.commit, self.governance, self.repository)
        self.assertEqual(len(drift), 1)
        self.assertIn("bun-script-floor.ts: differs", drift[0])

    def test_a_gate_file_absent_from_the_composed_governance_is_named(self):
        (self.governance / "tools/quality/gate-report.ts").unlink()
        drift = module.declared_gate_drift(self.commit, self.governance, self.repository)
        self.assertEqual(len(drift), 1)
        self.assertIn("gate-report.ts: absent from the composed governance", drift[0])

    def test_an_unknown_declared_commit_is_drift_never_a_pass(self):
        drift = module.declared_gate_drift("f" * 40, self.governance, self.repository)
        self.assertEqual(len(drift), len(module.GATE_CLOSURE))


if __name__ == "__main__":
    unittest.main()
