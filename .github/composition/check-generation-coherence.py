#!/usr/bin/env python3
"""Refuse a composition whose composed targets fail the manifest gates of its composed governance."""
# Generation Q (5ef12472) composed project-governance at d94081cc and
# application-development-toolkit at 9e817e73. d94081cc carries the rule of
# PG#66 (a `prepublishOnly` must start with `bun run check:bun:runtime && `);
# 9e817e73 carries `packages/ui/package.json` with a `prepublishOnly` that does
# not. Project-governance's own CI composes itself at the pull request head, and
# check-composed-paths.py (PG#92) only asks whether a path EXISTS at a composed
# ref, so the declaration merged green and seven consumers failed afterwards.
# The same class as the retired generation 769e452d: a manifest composes two
# refs that were never run against each other.
#
# For every repository the manifest composes, this gate:
#   1. fetches the exact commit of every composed repository into one new root
#      (the layout the composition itself uses: `file:../<repository>` resolves);
#   2. lists the gate roots of the target: every tracked package.json whose
#      `check:bun` script runs check-bun-manifests.ts. They are derived from the
#      tracked tree, not listed here, because a workspace root (the toolkit) has
#      no `check:bun` of its own and its packages are the roots CI runs;
#   3. runs `bun install --frozen-lockfile --ignore-scripts` in the target;
#   4. runs the check-bun-manifests.ts of the COMPOSED project-governance, from
#      each gate root, which is the file the target's own check would execute
#      from node_modules once installed.
#
# What it does not do: build anything (the toolkit's UI build is a product
# gate, not a manifest gate) and replay any gate other than the manifest one.
# Other gates added to MANIFEST_GATES are replayed the same way.
#
# Counters (gate-integrity): targets declared = verified + failed + not
# applicable. A repository fetch, install or gate that cannot run is a failure
# of that target, never a skip. The one declared exemption is a target whose
# composition runs no Bun install at all (prepare-composition.py skips it) and
# which tracks no package.json: it is counted and named.
#
# stdlib only, like the other composition tools. Needs `bun` and `git` on PATH.
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).parent
GATE_NAME = "check-bun-manifests.ts"
MANIFEST_GATES = ("tools/quality/" + GATE_NAME,)
GOVERNANCE = "project-governance"
INSTALL = ("bun", "install", "--frozen-lockfile", "--ignore-scripts")
DEADLINE_SECONDS = 3000
DETAIL_LINES = 6
DETAIL_WIDTH = 300


class Unreadable(Exception):
    """A source the gate needs could not be read; the target fails."""


def load_prepare():
    spec = importlib.util.spec_from_file_location("prepare_composition", HERE / "prepare-composition.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_manifest(raw, prepare):
    if len(raw) > 65536:
        raise ValueError("Composition manifest exceeds its bound")
    manifest = json.loads(raw, object_pairs_hook=prepare.unique_object)
    prepare.validate(manifest)
    return manifest


def read_manifest(path, prepare):
    with path.open("rb") as stream:
        return parse_manifest(stream.read(65537), prepare)


def manifest_at(commit, prepare, repository=HERE.parent.parent):
    """The manifest a governance commit composes: what declaring that commit as a generation declares."""
    if len(commit) != 40 or any(char not in "0123456789abcdef" for char in commit):
        raise ValueError("A generation is a full lowercase commit ID")
    done = subprocess.run(["git", "-C", str(repository), "show", f"{commit}:.github/composition/manifest.json"],
                          capture_output=True, timeout=60)
    if done.returncode != 0:
        raise ValueError(f"cannot read the manifest at {commit[:12]}: {done.stderr.decode('utf-8', 'replace').strip()[-200:]}")
    return parse_manifest(done.stdout[:65537], prepare)


def make_runner(deadline):
    """`runner(argv, cwd, timeout)` → (exit code or None, combined output). Never raises."""
    env = dict(os.environ)
    # A `refs/replace/*` entry would let git answer a committed id with other content.
    env.update(GIT_TERMINAL_PROMPT="0", GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL="/dev/null",
               GIT_NO_REPLACE_OBJECTS="1")

    def runner(argv, cwd, timeout):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None, "deadline exceeded before this step"
        try:
            done = subprocess.run(argv, cwd=cwd, env=env, timeout=min(timeout, remaining),
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        except subprocess.TimeoutExpired:
            return None, f"{' '.join(argv[:2])}: timed out"
        except OSError as error:
            return None, f"{argv[0]}: {error}"
        return done.returncode, done.stdout.decode("utf-8", "replace")

    return runner


def fetch(runner, url, ref, destination):
    """Fetch exactly `ref` into `destination`; raises Unreadable with git's last line."""
    destination.mkdir(parents=True)
    steps = (
        (["git", "init", "--quiet"], 15),
        (["git", "-c", "core.hooksPath=/dev/null", "fetch", "--quiet", "--no-tags", "--depth=1", url, ref], 180),
        (["git", "-c", "core.hooksPath=/dev/null", "checkout", "--quiet", "--detach", "FETCH_HEAD"], 60),
    )
    for argv, timeout in steps:
        code, output = runner(argv, destination, timeout)
        if code != 0:
            lines = output.strip().splitlines()
            raise Unreadable(f"cannot fetch {ref[:12]}: {lines[-1] if lines else 'git refused'}")
    code, output = runner(["git", "rev-parse", "HEAD"], destination, 15)
    if code != 0 or output.strip() != ref:
        raise Unreadable(f"checked out {output.strip()[:12] or 'nothing'} instead of {ref[:12]}")


def gate_roots(runner, checkout):
    """Directories (relative to the checkout) whose package.json `check:bun` runs the Bun manifest gate."""
    code, output = runner(["git", "ls-files", "-z"], checkout, 60)
    if code != 0:
        raise Unreadable(f"git ls-files: {output.strip()[-200:]}")
    roots, manifests = [], 0
    for name in sorted(filter(None, output.split("\0"))):
        if Path(name).name != "package.json":
            continue
        manifests += 1
        path = checkout / name
        if path.is_symlink():
            raise Unreadable(f"{name}: a tracked package.json that is a symlink")
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise Unreadable(f"{name}: unreadable ({error})") from error
        scripts = document.get("scripts") if isinstance(document, dict) else None
        script = scripts.get("check:bun") if isinstance(scripts, dict) else None
        if isinstance(script, str) and GATE_NAME in script:
            roots.append(str(Path(name).parent))
    return roots, manifests


def summarise(output):
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    return " | ".join(line[:DETAIL_WIDTH] for line in lines[:DETAIL_LINES]) or "no output"


def verify_target(name, row, root, governance, runner, installs):
    """('verified'|'failed'|'not-applicable', replayed, passed, failures) for one target."""
    label = f"{row['repository']}@{row['ref']}"
    checkout = root / name
    try:
        roots, manifests = gate_roots(runner, checkout)
    except Unreadable as error:
        return "failed", 0, 0, [f"{label}: {error}"]
    if not installs:
        if manifests == 0:
            return "not-applicable", 0, 0, []
        return "failed", 0, 0, [f"{label}: tracks {manifests} package.json but the composition runs no Bun install for it"]
    if not roots:
        return "failed", 0, 0, [
            f"{label}: no tracked package.json runs {GATE_NAME} from check:bun — "
            "the manifest gate has no root to replay"
        ]
    code, output = runner(list(INSTALL), checkout, 600)
    if code != 0:
        return "failed", 0, 0, [f"{label}: `{' '.join(INSTALL)}` failed: {summarise(output)}"]
    failures, passed = [], 0
    for gate in MANIFEST_GATES:
        script = governance / gate
        for relative in roots:
            code, output = runner(["bun", str(script)], checkout / relative, 300)
            if code == 0:
                passed += 1
            else:
                failures.append(f"{label}: {relative}: {summarise(output)}")
    replayed = len(roots) * len(MANIFEST_GATES)
    return ("failed" if failures else "verified"), replayed, passed, failures


def check(manifest, root, runner, installs_for, url_for=lambda repository: "https://github.com/" + repository):
    """Counters and failures; the manifest is validated by the caller."""
    rows = manifest["repositories"]
    counts = {"declared": len(rows), "verified": 0, "failed": 0, "not_applicable": 0,
              "roots": 0, "passed": 0}
    failures, exempt = [], []
    root.mkdir(parents=True, exist_ok=True)
    fetched = set()
    for name, row in rows.items():
        try:
            fetch(runner, url_for(row["repository"]), row["ref"], root / name)
            fetched.add(name)
        except Unreadable as error:
            counts["failed"] += 1
            failures.append(f"{row['repository']}@{row['ref']}: {error}")
    governance = root / GOVERNANCE
    gate_missing = [gate for gate in MANIFEST_GATES if not (governance / gate).is_file() or (governance / gate).is_symlink()]
    for name, row in rows.items():
        if name not in fetched:
            continue
        label = f"{row['repository']}@{row['ref']}"
        if gate_missing:
            counts["failed"] += 1
            failures.append(
                f"{label}: the composed {rows[GOVERNANCE]['repository']}@{rows[GOVERNANCE]['ref']} "
                f"carries no {', '.join(gate_missing)} to replay"
            )
            continue
        status, replayed, passed, found = verify_target(name, row, root, governance, runner, installs_for(name))
        counts["roots"] += replayed
        counts["passed"] += passed
        failures.extend(found)
        if status == "verified":
            counts["verified"] += 1
        elif status == "failed":
            counts["failed"] += 1
        else:
            counts["not_applicable"] += 1
            exempt.append(name)
    return counts, failures, exempt


def volume(counts, exempt, manifest):
    governance = manifest["repositories"][GOVERNANCE]
    parts = (
        f"{counts['declared']} target(s) declared: {counts['verified']} verified, {counts['failed']} failed, "
        f"{counts['not_applicable']} not applicable"
    )
    if exempt:
        parts += f" ({', '.join(exempt)}: no Bun install in the composition and no tracked package.json)"
    return (
        f"{parts}; {counts['roots']} gate root(s) replayed, {counts['passed']} passed; "
        f"gate from {governance['repository']}@{governance['ref']}"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--manifest", type=Path, default=HERE / "manifest.json")
    source.add_argument("--declaration", metavar="SHA",
                        help="a governance commit: replay the manifest that commit composes (git show)")
    parser.add_argument("--root", type=Path, required=True, help="a new or empty absolute directory")
    args = parser.parse_args()
    try:
        prepare = load_prepare()
        manifest = manifest_at(args.declaration, prepare) if args.declaration else read_manifest(args.manifest, prepare)
        root = args.root
        if not root.is_absolute() or root.resolve() != root or root.is_symlink():
            raise ValueError("Root must be absolute and canonical")
        if root.exists() and (not root.is_dir() or any(root.iterdir())):
            raise ValueError("Root must be new or empty")
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Generation coherence: unreadable input: {error}", file=sys.stderr)
        return 1

    def installs_for(name):
        return any(step["cwd"] == name for step in prepare.prepare(manifest, name)["install"])

    runner = make_runner(time.monotonic() + DEADLINE_SECONDS)
    counts, failures, exempt = check(manifest, root, runner, installs_for)
    summed = counts["verified"] + counts["failed"] + counts["not_applicable"]
    if counts["declared"] == 0 or summed != counts["declared"]:
        failures.append(f"counters do not sum: {counts['declared']} declared, {summed} accounted for")
    if counts["verified"] > 0 and counts["roots"] == 0:
        failures.append("targets verified without replaying a single gate root")
    for failure in failures:
        print(f"Generation coherence: {failure}", file=sys.stderr)
    if failures:
        print(f"Generation coherence failed — {volume(counts, exempt, manifest)}", file=sys.stderr)
        return 1
    print(f"Generation coherence verified — {volume(counts, exempt, manifest)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
