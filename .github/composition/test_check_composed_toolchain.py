import importlib.util
import json
from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()
