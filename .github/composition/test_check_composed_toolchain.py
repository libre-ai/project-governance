import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("composed_toolchain", HERE / "check-composed-toolchain.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

WHERE = "libre-ai/project-governance@" + "a" * 40


def installer(current, previous):
    return "\n".join([
        "LIMIT = 1",
        f"CARGO_DENY_VERSION = '{current}'",
        "# a comment naming CARGO_DENY_PREVIOUS_VERSION = '9.9.9' is not the line",
        f"CARGO_DENY_PREVIOUS_VERSION = {previous}",
        "CARGO_DENY_TRIPLE = 'x86_64-unknown-linux-musl'",
    ])


class JudgeTests(unittest.TestCase):
    def test_a_composed_ref_on_the_previous_version_passes_while_the_tolerance_is_declared(self):
        self.assertEqual(module.judge("0.22.0", "0.19.5", "0.19.5", WHERE), [])

    def test_a_composed_ref_on_the_current_version_passes_once_the_tolerance_is_gone(self):
        self.assertEqual(module.judge("0.22.0", None, "0.22.0", WHERE), [])

    def test_the_tolerance_fails_once_the_composed_ref_declares_the_current_version(self):
        failures = module.judge("0.22.0", "0.19.5", "0.22.0", WHERE)
        self.assertEqual(len(failures), 1)
        self.assertIn("the tolerance has no reason left", failures[0])
        self.assertIn("0.19.5 as CARGO_DENY_PREVIOUS_VERSION", failures[0])
        self.assertIn(WHERE, failures[0])

    def test_a_composed_declaration_the_installer_refuses_fails(self):
        for current, previous, composed in [
            ("0.22.0", None, "0.19.5"),
            ("0.22.0", "0.19.5", "0.21.0"),
            ("0.22.0", "0.19.5", "0.23.0"),
        ]:
            failures = module.judge(current, previous, composed, WHERE)
            self.assertEqual(len(failures), 1, (current, previous, composed))
            self.assertIn(f"declares cargo-deny {composed}, which install-toolchains.sh refuses", failures[0])

    def test_a_previous_version_equal_to_the_current_one_fails(self):
        failures = module.judge("0.22.0", "0.22.0", "0.22.0", WHERE)
        self.assertTrue(any("as both" in failure for failure in failures), failures)


class ReadingTests(unittest.TestCase):
    def test_the_two_lines_of_the_installer_are_read(self):
        self.assertEqual(module.installer_versions(installer("0.22.0", "'0.19.5'")), ("0.22.0", "0.19.5"))
        self.assertEqual(module.installer_versions(installer("0.22.0", "None")), ("0.22.0", None))

    def test_the_live_installer_is_readable_and_agrees_with_what_it_installs(self):
        text = (HERE / "install-toolchains.sh").read_text(encoding="utf-8")
        current, previous = module.installer_versions(text)
        code = text.split("<<'PYTHON'\n", 1)[1].rsplit("\nPYTHON", 1)[0]
        namespace = {"__name__": "fixture"}
        exec(compile(code, "install-toolchains.sh", "exec"), namespace)
        self.assertEqual(namespace["CARGO_DENY_VERSION"], current)
        self.assertEqual(namespace["CARGO_DENY_PREVIOUS_VERSION"], previous)
        expected = [current] if previous is None else [current, previous]
        self.assertEqual(sorted(namespace["CARGO_DENY_INSTALLABLE_VERSIONS"]), sorted(expected))

    def test_a_missing_or_repeated_or_reshaped_line_is_unreadable_never_a_pass(self):
        for text in [
            "CARGO_DENY_VERSION = '0.22.0'",
            "CARGO_DENY_PREVIOUS_VERSION = None",
            installer("0.22.0", "None") + "\nCARGO_DENY_VERSION = '0.22.0'",
            # The previous-version line written twice: the second one would be the one Python keeps.
            installer("0.22.0", "'0.19.5'") + "\nCARGO_DENY_PREVIOUS_VERSION = '0.19.5'",
            installer("0.22.0", "None") + "\nCARGO_DENY_PREVIOUS_VERSION = '0.19.5'",
            installer("0.22.0", "PREVIOUS"),
            installer("0.22", "None"),
            installer("0.22.0", "('0.19.5', '0.19.9')"),
        ]:
            with self.assertRaises(module.ReadError, msg=text):
                module.installer_versions(text)

    def test_the_declared_version_is_read_and_anything_else_is_unreadable(self):
        self.assertEqual(module.declared_version(json.dumps({"tool": "cargo-deny", "version": "0.19.5"})), "0.19.5")
        for text in ["", "[]", "{}", json.dumps({"tool": "cargo-deny"}), json.dumps({"tool": "osv-scanner", "version": "0.19.5"}),
                     json.dumps({"tool": "cargo-deny", "version": "latest"}), json.dumps({"tool": "cargo-deny", "version": 22})]:
            with self.assertRaises(module.ReadError, msg=text):
                module.declared_version(text)

    def test_the_local_declaration_is_one_the_installer_installs(self):
        # This repository composes itself at the pull request head: its own declaration is the current version.
        current, _ = module.installer_versions((HERE / "install-toolchains.sh").read_text(encoding="utf-8"))
        local = module.declared_version((HERE.parents[1] / "toolchains" / "cargo-deny.json").read_text(encoding="utf-8"))
        self.assertEqual(local, current)


class Completed:
    def __init__(self, returncode, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


class ReadAtTests(unittest.TestCase):
    REF = "b" * 40

    def run_with(self, failing_step):
        calls = []

        def git(args):
            calls.append(args)
            step = len(calls)
            if step == failing_step:
                return Completed(128, "", "warning: noise\nfatal: step refused\n")
            return Completed(0, '{"tool": "cargo-deny", "version": "0.19.5"}' if step == 4 else "")

        return calls, git

    def test_the_declaration_is_shown_from_a_shallow_fetch_of_the_exact_commit(self):
        calls, git = self.run_with(failing_step=0)
        text = module.read_at("libre-ai/project-governance", self.REF, module.DECLARATION, git)
        self.assertEqual(module.declared_version(text), "0.19.5")
        self.assertEqual(len(calls), 4)
        git_dir = calls[0][-1]
        self.assertEqual(calls[0][:3], ["init", "--bare", "--quiet"])
        self.assertEqual(calls[1], ["--git-dir", git_dir, "remote", "add", "origin", "https://github.com/libre-ai/project-governance"])
        self.assertEqual(calls[2], ["--git-dir", git_dir, "fetch", "--quiet", "--no-tags", "--depth=1", "origin", self.REF])
        self.assertEqual(calls[3], ["--git-dir", git_dir, "show", self.REF + ":toolchains/cargo-deny.json"])

    def test_a_git_step_that_fails_is_unreadable_and_nothing_runs_after_it(self):
        for failing_step, name in [(1, "init"), (2, "remote"), (3, "fetch"), (4, "show")]:
            calls, git = self.run_with(failing_step)
            with self.assertRaises(module.ReadError) as raised:
                module.read_at("libre-ai/project-governance", self.REF, module.DECLARATION, git)
            self.assertEqual(len(calls), failing_step, name)
            self.assertIn(f"git {name}: fatal: step refused", str(raised.exception))
            self.assertIn("libre-ai/project-governance@" + self.REF[:12], str(raised.exception))


class MainTests(unittest.TestCase):
    REF = "c" * 40
    OTHER = "d" * 40

    def run_main(self, read, current="0.22.0", previous="'0.19.5'", manifest=None, installer_text=None):
        if manifest is None:
            # Two rows, so that reading another repository's ref is visible.
            manifest = {"repositories": {
                "project-website": {"repository": "libre-ai/project-website", "ref": self.OTHER},
                "project-governance": {"repository": "libre-ai/project-governance", "ref": self.REF},
            }}
        with tempfile.TemporaryDirectory() as scratch:
            manifest_path = Path(scratch) / "manifest.json"
            installer_path = Path(scratch) / "install-toolchains.sh"
            manifest_path.write_text(manifest if isinstance(manifest, str) else json.dumps(manifest), encoding="utf-8")
            installer_path.write_text(installer(current, previous) if installer_text is None else installer_text, encoding="utf-8")
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = module.main(["--manifest", str(manifest_path), "--installer", str(installer_path)], read=read)
        return code, out.getvalue(), err.getvalue()

    def declaring(self, version, asked=None):
        def read(repository, ref, path):
            if asked is not None:
                asked.append((repository, ref, path))
            return json.dumps({"tool": "cargo-deny", "version": version})
        return read

    def test_the_composed_project_governance_row_is_the_one_read(self):
        asked = []
        code, out, err = self.run_main(self.declaring("0.19.5", asked))
        self.assertEqual(asked, [("libre-ai/project-governance", self.REF, "toolchains/cargo-deny.json")])
        self.assertEqual((code, err), (0, ""))
        self.assertIn(
            f"Composed toolchain verified — 1 composed declaration read (libre-ai/project-governance@{self.REF}: "
            "cargo-deny 0.19.5); installer installs 0.22.0 and, as previous version, 0.19.5", out)

    def test_a_failure_exits_1_and_says_so_on_stderr_never_verified(self):
        for current, previous, composed, needle in [
            ("0.22.0", "'0.19.5'", "0.22.0", "the tolerance has no reason left"),
            ("0.22.0", "None", "0.19.5", "which install-toolchains.sh refuses"),
        ]:
            code, out, err = self.run_main(self.declaring(composed), current, previous)
            self.assertEqual(code, 1, (current, previous, composed))
            self.assertIn(needle, err)
            self.assertIn("Composed toolchain failed — 1 composed declaration read", err)
            self.assertNotIn("verified", out + err)

    def test_the_tolerance_ended_passes_on_a_composed_ref_that_declares_the_current_version(self):
        code, out, _ = self.run_main(self.declaring("0.22.0"), "0.22.0", "None")
        self.assertEqual(code, 0)
        self.assertIn("installer installs 0.22.0\n", out)

    def test_an_unreadable_commit_exits_1(self):
        def read(repository, ref, path):
            raise module.ReadError(f"{repository}@{ref[:12]}: git fetch: fatal: refused")
        code, out, err = self.run_main(read)
        self.assertEqual((code, out), (1, ""))
        self.assertIn("Composed toolchain: unreadable input: libre-ai/project-governance@" + self.REF[:12], err)

    def test_every_other_unreadable_input_exits_1(self):
        only_website = {"repositories": {"project-website": {"repository": "libre-ai/project-website", "ref": self.OTHER}}}
        cases = [
            ("no project-governance row", {"manifest": only_website}),
            ("a row without a ref", {"manifest": {"repositories": {"project-governance": {"repository": "libre-ai/project-governance"}}}}),
            ("a manifest that is not JSON", {"manifest": "{"}),
            ("an installer without its version lines", {"installer_text": "LIMIT = 1\n"}),
        ]
        for label, arguments in cases:
            code, out, err = self.run_main(self.declaring("0.19.5"), **arguments)
            self.assertEqual((code, out), (1, ""), label)
            self.assertIn("Composed toolchain: unreadable input:", err, label)
        for label, text in [("an empty declaration", ""), ("another tool's declaration", json.dumps({"tool": "osv-scanner", "version": "0.19.5"}))]:
            code, out, err = self.run_main(lambda repository, ref, path, text=text: text)
            self.assertEqual((code, out), (1, ""), label)
            self.assertIn("Composed toolchain: unreadable input:", err, label)

    def test_a_missing_file_exits_1(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = module.main(["--manifest", "/nonexistent/manifest.json"], read=self.declaring("0.19.5"))
        self.assertEqual((code, out.getvalue()), (1, ""))
        self.assertIn("unreadable input", err.getvalue())


if __name__ == "__main__":
    unittest.main()
