import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("composed_paths", HERE / "check-composed-paths.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

REF = "a" * 40


def manifest(*names):
    return {"repositories": {name: {"repository": "libre-ai/" + name, "ref": REF} for name in names}}


class WorkflowPathTests(unittest.TestCase):
    def test_literal_paths_are_read_and_target_paths_are_not(self):
        text = "\n".join([
            '  "$GITHUB_WORKSPACE/composition/project-governance/toolchains/cargo-deny.json"',
            "  working-directory: composition/application-development-toolkit/packages/ui",
            "  root: composition/${{ inputs.target }}/**/test-results/**",
            "  # (toolchains/cargo-deny.json, Y47) is a comment without the composition/ prefix",
        ])
        self.assertEqual(module.workflow_paths(text), {
            ("project-governance", "toolchains/cargo-deny.json"),
            ("application-development-toolkit", "packages/ui"),
        })

    def test_the_committed_workflow_reads_the_three_toolchain_declarations(self):
        found = module.workflow_paths((HERE.parent / "workflows" / "validate-composition.yml").read_text())
        for name in ("bun.json", "notebook-qualification.json", "cargo-deny.json"):
            self.assertIn(("project-governance", "toolchains/" + name), found)


class PreparePathTests(unittest.TestCase):
    def test_cargo_sources_and_install_cwds_of_the_committed_manifest(self):
        current = json.loads((HERE / "manifest.json").read_text())
        found = module.prepare_paths(current, module.load_prepare())
        self.assertIn(("schemas-and-contracts", "crates/sdk-rs"), found)
        self.assertIn(("application-development-toolkit", "packages/ui"), found)


class CheckTests(unittest.TestCase):
    pairs = {("project-governance", "toolchains/bun.json"), ("project-governance", "toolchains/cargo-deny.json")}

    def test_every_path_present_passes_and_is_counted(self):
        counts, failures = module.check(manifest("project-governance"), self.pairs, lambda r, ref, paths: set(paths))
        self.assertEqual(failures, [])
        self.assertEqual(module.volume(counts), "2 composed path(s) checked across 1 repository(ies): 2 present, 0 absent, 0 unverifiable")

    def test_an_absent_path_fails_the_769e452d_shape(self):
        counts, failures = module.check(
            manifest("project-governance"), self.pairs, lambda r, ref, paths: {"toolchains/bun.json"}
        )
        self.assertEqual(counts["absent"], 1)
        self.assertIn("toolchains/cargo-deny.json is read as composition/project-governance/", failures[0])

    def test_an_unfetchable_ref_fails_never_zero(self):
        def refuse(*_):
            raise module.PresenceError("fetch refused")
        counts, failures = module.check(manifest("project-governance"), self.pairs, refuse)
        self.assertEqual((counts["unverifiable"], len(failures)), (2, 1))

    def test_a_repository_the_manifest_does_not_compose_fails(self):
        counts, failures = module.check(manifest(), self.pairs, lambda r, ref, paths: set(paths))
        self.assertEqual(counts["unverifiable"], 2)
        self.assertIn("not composed by manifest.json", failures[0])


def git(cwd, *args):
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", *args],
        cwd=cwd, check=True, capture_output=True, text=True,
    ).stdout.strip()


class GitPresenceTests(unittest.TestCase):
    """The real oracle against a local repository: no network."""

    def test_present_file_and_directory_absent_path_unknown_commit(self):
        with tempfile.TemporaryDirectory() as repo:
            Path(repo, "toolchains").mkdir()
            Path(repo, "toolchains", "bun.json").write_text("{}\n")
            git(repo, "init", "--quiet", "-b", "trunk")
            git(repo, "add", "-A")
            git(repo, "commit", "--quiet", "-m", "a")
            git(repo, "config", "uploadpack.allowAnySHA1InWant", "true")
            git(repo, "config", "uploadpack.allowFilter", "true")
            ref = git(repo, "rev-parse", "HEAD")
            presence = module.GitPresence(url_for=lambda _r: "file://" + repo)
            self.assertEqual(
                presence("r", ref, ["toolchains/bun.json", "toolchains", "toolchains/cargo-deny.json"]),
                {"toolchains/bun.json", "toolchains"},
            )
            with self.assertRaises(module.PresenceError):
                presence("r", "e" * 40, ["toolchains/bun.json"])


if __name__ == "__main__":
    unittest.main()
