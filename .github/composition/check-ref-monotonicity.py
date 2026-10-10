#!/usr/bin/env python3
"""Refuse a composition manifest whose refs move to a commit that does not descend from the ref they replace."""
# Threat triage 2026-10-09, menace 4 (rollback); owner arbitration 2026-10-10.
#
# manifest.json pins each composed repository to a full commit id. Nothing
# stopped a change from pinning an OLDER commit, or one from a side branch:
# the composition would then validate, and every consumer would build against,
# a tree that silently dropped fixes the previous pin carried. This gate asks,
# for every ref that changed between the previous manifest and this one,
# whether the new commit descends from the old (`git merge-base
# --is-ancestor old new`). A ref that advances passes; a ref that goes back or
# sideways fails unless ref-monotonicity-exemptions.json admits that exact
# target with a reason.
#
# The question is put to git, not to an API (governance gate-integrity §4): no
# quota, no token, and `--is-ancestor` IS containment. A repository or commit
# git cannot fetch is a failure, never a pass.
#
# stdlib only, like the other composition tools.
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

FULL_SHA = re.compile(r"[0-9a-f]{40}")
MANIFEST_PATH = ".github/composition/manifest.json"
EXEMPTIONS_SCHEMA = "libre-ai.ref-monotonicity-exemptions.v1"


class AncestryError(Exception):
    """git could not answer: unreachable repository, unknown commit, broken scratch repository."""


def _git(args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=600)


class GitAncestry:
    """`is_ancestor(repository, old, new)` through a scratch partial clone per repository."""

    def __init__(self, url_for=lambda repository: "https://github.com/" + repository):
        self.url_for = url_for

    def __call__(self, repository, old, new):
        with tempfile.TemporaryDirectory(prefix="ref-monotonicity-") as scratch:
            git_dir = str(Path(scratch) / "repo.git")
            for args in (
                ["init", "--bare", "--quiet", git_dir],
                ["--git-dir", git_dir, "remote", "add", "origin", self.url_for(repository)],
                ["--git-dir", git_dir, "config", "extensions.partialClone", "origin"],
            ):
                done = _git(args)
                if done.returncode != 0:
                    raise AncestryError(f"scratch repository: {done.stderr.strip()}")
            refspecs = [f"{old}:refs/monotonicity/old", f"{new}:refs/monotonicity/new"]
            base = ["--git-dir", git_dir, "fetch", "--quiet", "--no-tags"]
            # Commits only: ancestry needs the commit graph, not the trees.
            fetched = _git([*base, "--filter=tree:0", "origin", *refspecs])
            if fetched.returncode != 0:
                fetched = _git([*base, "origin", *refspecs])
            if fetched.returncode != 0:
                lines = fetched.stderr.strip().splitlines()
                raise AncestryError(f"cannot fetch {old[:12]} and {new[:12]}: {lines[-1] if lines else 'fetch refused'}")
            asked = _git(["--git-dir", git_dir, "merge-base", "--is-ancestor", "refs/monotonicity/old", "refs/monotonicity/new"])
            # Exit 1 is an answer ("not an ancestor"), anything else is not.
            if asked.returncode == 0:
                return True
            if asked.returncode == 1:
                return False
            raise AncestryError(f"merge-base failed: {asked.stderr.strip()}")


def load_exemptions(text):
    document = json.loads(text)
    if not isinstance(document, dict) or document.get("schemaVersion") != EXEMPTIONS_SCHEMA:
        raise ValueError("ref-monotonicity exemptions: unsupported schema")
    entries = document.get("exemptions")
    if not isinstance(entries, list):
        raise ValueError("ref-monotonicity exemptions: `exemptions` must be a list")
    admitted = {}
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict) or set(entry) != {"repository", "to", "because"}:
            raise ValueError(f"exemptions[{index}] must have exactly repository, to and because")
        if not isinstance(entry["to"], str) or FULL_SHA.fullmatch(entry["to"]) is None:
            raise ValueError(f"exemptions[{index}].to must be a full lowercase commit id")
        if not isinstance(entry["because"], str) or not entry["because"].strip():
            raise ValueError(f"exemptions[{index}].because is required")
        admitted[(entry["repository"], entry["to"])] = entry["because"]
    return admitted


def _rows(manifest):
    repositories = manifest.get("repositories") if isinstance(manifest, dict) else None
    if not isinstance(repositories, dict):
        raise ValueError("manifest carries no `repositories` object")
    return repositories


def compare(previous, current, is_ancestor, exemptions):
    """Every verdict and the counters; pure given `is_ancestor`."""
    counts = {"examined": 0, "unchanged": 0, "new": 0, "advanced": 0, "exempt": 0, "failing": 0}
    failures = []
    before = _rows(previous)
    for name, row in _rows(current).items():
        counts["examined"] += 1
        repository, new = row["repository"], row["ref"]
        old_row = before.get(name)
        if old_row is None:
            counts["new"] += 1
            continue
        old = old_row["ref"]
        if old == new:
            counts["unchanged"] += 1
            continue
        reason = exemptions.get((repository, new))
        if reason is not None:
            counts["exempt"] += 1
            continue
        try:
            advances = is_ancestor(repository, old, new)
        except AncestryError as error:
            counts["failing"] += 1
            failures.append(f"{repository}: cannot verify {old[:12]} -> {new[:12]}: {error}")
            continue
        if advances:
            counts["advanced"] += 1
        else:
            counts["failing"] += 1
            failures.append(
                f"{repository}: {new} does not descend from the previously declared {old} — "
                "a composed ref may only move forward; admit an intended rollback in "
                ".github/composition/ref-monotonicity-exemptions.json with its reason"
            )
    return counts, failures


def volume(counts):
    return (
        f"{counts['examined']} composed ref(s) examined: {counts['unchanged']} unchanged, "
        f"{counts['new']} new, {counts['advanced']} advanced (ancestry verified), "
        f"{counts['exempt']} exempt, {counts['failing']} failing"
    )


def read_previous(revision):
    """The manifest at `revision` in the current repository; an absent file is an empty composition."""
    if FULL_SHA.fullmatch(revision) is None:
        raise ValueError("--previous-ref must be a full lowercase commit id")
    exists = _git(["cat-file", "-e", f"{revision}^{{commit}}"])
    if exists.returncode != 0:
        raise ValueError(f"previous revision {revision} is not in this checkout (fetch-depth 0 required)")
    shown = _git(["show", f"{revision}:{MANIFEST_PATH}"])
    if shown.returncode != 0:
        listed = _git(["ls-tree", "--name-only", revision, MANIFEST_PATH])
        if listed.returncode == 0 and listed.stdout.strip() == "":
            return {"repositories": {}}
        raise ValueError(f"cannot read {MANIFEST_PATH} at {revision}: {shown.stderr.strip()}")
    return json.loads(shown.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    here = Path(__file__).parent
    parser.add_argument("--manifest", type=Path, default=here / "manifest.json")
    parser.add_argument("--exemptions", type=Path, default=here / "ref-monotonicity-exemptions.json")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--previous", type=Path, help="previous manifest file")
    source.add_argument("--previous-ref", help="commit whose manifest.json is the previous declaration")
    args = parser.parse_args()
    try:
        if args.previous_ref is not None and (args.previous_ref == "" or set(args.previous_ref) == {"0"}):
            # A push that creates the branch, or an event that hands no base:
            # there is no previous declaration, and saying so is the verdict.
            print("Composition ref monotonicity: no previous declaration handed by the event — nothing to compare")
            return 0
        previous = (
            json.loads(args.previous.read_text(encoding="utf-8"))
            if args.previous is not None
            else read_previous(args.previous_ref)
        )
        current = json.loads(args.manifest.read_text(encoding="utf-8"))
        exemptions = load_exemptions(args.exemptions.read_text(encoding="utf-8"))
        counts, failures = compare(previous, current, GitAncestry(), exemptions)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Composition ref monotonicity: unreadable input: {error}", file=sys.stderr)
        return 1
    if counts["examined"] == 0:
        print("Composition ref monotonicity: the manifest declares no repository", file=sys.stderr)
        return 1
    for failure in failures:
        print(f"Composition ref monotonicity: {failure}", file=sys.stderr)
    if failures:
        print(f"Composition ref monotonicity failed — {volume(counts)}", file=sys.stderr)
        return 1
    print(f"Composition ref monotonicity verified — {volume(counts)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
