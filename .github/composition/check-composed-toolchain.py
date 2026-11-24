#!/usr/bin/env python3
"""Hold the cargo-deny versions install-toolchains.sh installs to what the composed project-governance declares."""
# validate-composition.yml runs the installer of the tooling generation and
# hands it toolchains/cargo-deny.json of the project-governance manifest.json
# composes. The two are different commits, so the installer names the version
# it installs (CARGO_DENY_VERSION) and, across a bump, the one before it
# (CARGO_DENY_PREVIOUS_VERSION). Nothing else tied those two lines to the
# composed declaration:
#   - a composed declaration of a version the installer refuses fails every
#     consumer at the install step, and this repository's own CI cannot see it
#     (it composes itself at the pull request head);
#   - a previous version kept after the composed ref declares the current one
#     is a tolerance with no reason left: the installer would still install a
#     retired version for any ref that declares it.
#
# This gate reads the two lines of the installer, asks git for
# toolchains/cargo-deny.json at the composed ref (a shallow fetch of that exact
# commit, no API quota) and fails on either case. A file, a line or a commit it
# cannot read fails. Never a zero.
#
# stdlib only, like the other composition tools.
import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile

HERE = Path(__file__).parent
DECLARATION = "toolchains/cargo-deny.json"
CURRENT_LINE = re.compile(r"^CARGO_DENY_VERSION = '(\d+\.\d+\.\d+)'$", re.MULTILINE)
PREVIOUS_LINE = re.compile(r"^CARGO_DENY_PREVIOUS_VERSION = (None|'(\d+\.\d+\.\d+)')$", re.MULTILINE)


class ReadError(Exception):
    """A source of this gate could not be read: a failure, never a pass."""


def load_composed_paths():
    spec = importlib.util.spec_from_file_location("check_composed_paths", HERE / "check-composed-paths.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def installer_versions(text):
    """(current, previous or None) as install-toolchains.sh writes them; each line exactly once."""
    current = CURRENT_LINE.findall(text)
    previous = PREVIOUS_LINE.findall(text)
    if len(current) != 1:
        raise ReadError(f"install-toolchains.sh: {len(current)} line(s) `CARGO_DENY_VERSION = 'x.y.z'`, exactly 1 expected")
    if len(previous) != 1:
        raise ReadError(
            f"install-toolchains.sh: {len(previous)} line(s) `CARGO_DENY_PREVIOUS_VERSION = None | 'x.y.z'`, exactly 1 expected"
        )
    return current[0], previous[0][1] or None


def declared_version(text):
    """The version a toolchains/cargo-deny.json declares."""
    try:
        declaration = json.loads(text)
        version = declaration["version"]
        tool = declaration["tool"]
    except (ValueError, KeyError, TypeError) as error:
        raise ReadError(f"{DECLARATION}: not a cargo-deny declaration ({error})") from error
    if tool != "cargo-deny" or not isinstance(version, str) or re.fullmatch(r"\d+\.\d+\.\d+", version) is None:
        raise ReadError(f"{DECLARATION}: not a cargo-deny declaration with an exact version")
    return version


def judge(current, previous, composed, where):
    """Failures for one composed declaration; pure."""
    failures = []
    if previous == current:
        failures.append(
            f"install-toolchains.sh names {current} as both CARGO_DENY_VERSION and CARGO_DENY_PREVIOUS_VERSION — "
            "set CARGO_DENY_PREVIOUS_VERSION to None"
        )
    installable = [current] if previous is None else [current, previous]
    if composed not in installable:
        failures.append(
            f"{where} declares cargo-deny {composed}, which install-toolchains.sh refuses "
            f"(installable: {', '.join(installable)}) — every consumer of this generation fails at the install step"
        )
    elif previous is not None and composed == current:
        failures.append(
            f"{where} declares cargo-deny {composed}, the current version, while install-toolchains.sh still installs "
            f"{previous} as CARGO_DENY_PREVIOUS_VERSION — the tolerance has no reason left, set it to None"
        )
    return failures


def read_at(repository, ref, path, composed_paths):
    """The text of `path` at `ref` of `repository`, from a shallow fetch of that exact commit."""
    with tempfile.TemporaryDirectory(prefix="composed-toolchain-") as scratch:
        git_dir = str(Path(scratch) / "repo.git")
        for args in (
            ["init", "--bare", "--quiet", git_dir],
            ["--git-dir", git_dir, "remote", "add", "origin", "https://github.com/" + repository],
            ["--git-dir", git_dir, "fetch", "--quiet", "--no-tags", "--depth=1", "origin", ref],
            ["--git-dir", git_dir, "show", f"{ref}:{path}"],
        ):
            done = composed_paths._git(args)
            if done.returncode != 0:
                lines = done.stderr.strip().splitlines()
                raise ReadError(f"{repository}@{ref[:12]}: git {args[2] if args[0] == '--git-dir' else args[0]}: {lines[-1] if lines else 'refused'}")
        return done.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=HERE / "manifest.json")
    parser.add_argument("--installer", type=Path, default=HERE / "install-toolchains.sh")
    args = parser.parse_args()
    try:
        row = json.loads(args.manifest.read_text(encoding="utf-8"))["repositories"]["project-governance"]
        repository, ref = row["repository"], row["ref"]
        current, previous = installer_versions(args.installer.read_text(encoding="utf-8"))
        composed = declared_version(read_at(repository, ref, DECLARATION, load_composed_paths()))
    except (OSError, ValueError, KeyError, TypeError, ReadError) as error:
        print(f"Composed toolchain: unreadable input: {error}", file=sys.stderr)
        return 1
    where = f"{repository}@{ref}"
    failures = judge(current, previous, composed, where)
    for failure in failures:
        print(f"Composed toolchain: {failure}", file=sys.stderr)
    installs = current if previous is None else f"{current} and, as previous version, {previous}"
    if failures:
        print(f"Composed toolchain failed — 1 composed declaration read ({where}: cargo-deny {composed}); installer installs {installs}", file=sys.stderr)
        return 1
    print(f"Composed toolchain verified — 1 composed declaration read ({where}: cargo-deny {composed}); installer installs {installs}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
