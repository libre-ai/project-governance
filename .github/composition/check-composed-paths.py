#!/usr/bin/env python3
"""Refuse a composition whose tooling reads a path absent from the composed ref of its repository."""
# Generation 769e452d (retired) composed project-governance at da0c3b6f while
# validate-composition.yml already read
# composition/project-governance/toolchains/cargo-deny.json, which da0c3b6f
# does not carry. Project-governance's own CI composes itself at the pull
# request head, so the gap only surfaced in a consumer
# (execution-continuity-evaluator, run 38019824748).
#
# This gate collects every `composition/<repo>/<path>` the composition reads:
#   - literally in .github/workflows/validate-composition.yml;
#   - through prepare-composition.py, for every target: the Cargo sibling
#     source paths and every `--cwd <path>` of an install step;
# and asks git, for each, whether <path> exists in the tree of the ref
# manifest.json composes for <repo> (`git ls-tree <ref> -- <path>`, in a
# blob-less shallow fetch of that exact commit). An absent path fails; a
# repository or commit git cannot fetch fails. Never a zero.
#
# Target-dependent paths (`composition/${{ inputs.target }}/...`) are not read:
# the target is checked out at the revision under test, not at its pin.
#
# stdlib only, like the other composition tools.
import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

HERE = Path(__file__).parent
WORKFLOW_PATH = re.compile(r"composition/([a-z0-9][a-z0-9-]*)/([A-Za-z0-9_.][A-Za-z0-9_./-]*)")


class PresenceError(Exception):
    """git could not answer for this repository or commit."""


def load_prepare():
    spec = importlib.util.spec_from_file_location("prepare_composition", HERE / "prepare-composition.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def workflow_paths(text):
    """(repository name, path) pairs written literally in a workflow, `/`-stripped, deduplicated."""
    found = set()
    for match in WORKFLOW_PATH.finditer(text):
        found.add((match.group(1), match.group(2).rstrip("/.")))
    return found


def prepare_paths(manifest, prepare):
    """(repository name, path) pairs prepare-composition.py makes the composition read, over every target."""
    found = set()
    for target in prepare.ORDER:
        plan = prepare.prepare(manifest, target)
        for source in plan["cargoSources"]:
            name, _, sub = source["path"].partition("/")
            found.add((name, sub))
        for step in plan["install"]:
            argv = step["argv"]
            for index, arg in enumerate(argv[:-1]):
                if arg == "--cwd":
                    found.add((step["cwd"], argv[index + 1]))
    return found


def _git(args):
    return subprocess.run(["git", *args], capture_output=True, text=True, timeout=600)


class GitPresence:
    """`present(repository, ref, paths)` → the subset of `paths` present at `ref`."""

    def __init__(self, url_for=lambda repository: "https://github.com/" + repository):
        self.url_for = url_for

    def __call__(self, repository, ref, paths):
        with tempfile.TemporaryDirectory(prefix="composed-paths-") as scratch:
            git_dir = str(Path(scratch) / "repo.git")
            for args in (
                ["init", "--bare", "--quiet", git_dir],
                ["--git-dir", git_dir, "remote", "add", "origin", self.url_for(repository)],
                ["--git-dir", git_dir, "config", "extensions.partialClone", "origin"],
            ):
                done = _git(args)
                if done.returncode != 0:
                    raise PresenceError(f"scratch repository: {done.stderr.strip()}")
            base = ["--git-dir", git_dir, "fetch", "--quiet", "--no-tags", "--depth=1"]
            # Trees answer presence; blobs are never needed.
            fetched = _git([*base, "--filter=blob:none", "origin", ref])
            if fetched.returncode != 0:
                fetched = _git([*base, "origin", ref])
            if fetched.returncode != 0:
                lines = fetched.stderr.strip().splitlines()
                raise PresenceError(f"cannot fetch {ref[:12]}: {lines[-1] if lines else 'fetch refused'}")
            present = set()
            for path in paths:
                listed = _git(["--git-dir", git_dir, "ls-tree", ref, "--", path])
                if listed.returncode != 0:
                    raise PresenceError(f"ls-tree {ref[:12]} {path}: {listed.stderr.strip()}")
                if listed.stdout.strip():
                    present.add(path)
            return present


def check(manifest, pairs, present_at):
    """Failures and counters; pure given `present_at`."""
    rows = manifest["repositories"]
    by_repository = {}
    for name, path in sorted(pairs):
        by_repository.setdefault(name, set()).add(path)
    counts = {"paths": 0, "repositories": len(by_repository), "present": 0, "absent": 0, "unverifiable": 0}
    failures = []
    for name, paths in sorted(by_repository.items()):
        counts["paths"] += len(paths)
        row = rows.get(name)
        if row is None:
            counts["unverifiable"] += len(paths)
            failures.append(f"{name}: read by the composition ({', '.join(sorted(paths))}) but not composed by manifest.json")
            continue
        try:
            present = present_at(row["repository"], row["ref"], sorted(paths))
        except PresenceError as error:
            counts["unverifiable"] += len(paths)
            failures.append(f"{row['repository']}@{row['ref'][:12]}: cannot verify {len(paths)} path(s): {error}")
            continue
        for path in sorted(paths):
            if path in present:
                counts["present"] += 1
            else:
                counts["absent"] += 1
                failures.append(
                    f"{row['repository']}@{row['ref']}: {path} is read as composition/{name}/{path} "
                    "but is absent from the composed ref — compose a ref that carries it"
                )
    return counts, failures


def volume(counts):
    return (
        f"{counts['paths']} composed path(s) checked across {counts['repositories']} repository(ies): "
        f"{counts['present']} present, {counts['absent']} absent, {counts['unverifiable']} unverifiable"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=HERE / "manifest.json")
    parser.add_argument("--workflow", type=Path, default=HERE.parent / "workflows" / "validate-composition.yml")
    args = parser.parse_args()
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        pairs = workflow_paths(args.workflow.read_text(encoding="utf-8")) | prepare_paths(manifest, load_prepare())
        counts, failures = check(manifest, pairs, GitPresence())
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Composed paths: unreadable input: {error}", file=sys.stderr)
        return 1
    if counts["paths"] == 0:
        print("Composed paths: no composition/<repo>/<path> found to check — the readers moved", file=sys.stderr)
        return 1
    for failure in failures:
        print(f"Composed paths: {failure}", file=sys.stderr)
    if failures:
        print(f"Composed paths failed — {volume(counts)}", file=sys.stderr)
        return 1
    print(f"Composed paths verified — {volume(counts)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
