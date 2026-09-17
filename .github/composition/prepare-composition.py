#!/usr/bin/env python3
"""Emit the fixed Libre AI source composition; never execute a plan or shell text."""
import argparse
import json
from pathlib import Path
import re
import sys

ORDER = (
    "project-governance", "schemas-and-contracts", "application-development-toolkit",
    "ai-work-supervision", "organization-data-lifecycle", "ai-model-policy",
    "ai-practice-workbench", "learning-session-facilitation", "personal-knowledge-notebook",
    "information-feed-filter", "travel-itinerary-planner", "public-vote-comparison",
    "collaborative-data-sync", "execution-continuity-evaluator", "execution-sandbox",
    "capability-authorization", "database-policy-inspector", "artifact-verification",
    "project-website",
)
BASE = ("project-governance", "schemas-and-contracts")
UI = (*BASE, "application-development-toolkit")
DEPENDENCIES = {
    "project-governance": (),
    "schemas-and-contracts": ("project-governance",),
    "ai-work-supervision": (*UI, "organization-data-lifecycle"),
    "application-development-toolkit": (*BASE, "ai-work-supervision"),
    "organization-data-lifecycle": UI,
    "ai-model-policy": UI,
    "ai-practice-workbench": UI,
    "learning-session-facilitation": (*UI, "organization-data-lifecycle"),
    "personal-knowledge-notebook": UI,
    "information-feed-filter": (*BASE, "ai-model-policy"),
    "travel-itinerary-planner": ("project-governance",),
    "public-vote-comparison": UI,
    "collaborative-data-sync": ("project-governance",),
    "execution-continuity-evaluator": BASE,
    "execution-sandbox": BASE,
    "capability-authorization": BASE,
    "database-policy-inspector": (),
    "artifact-verification": BASE,
    "project-website": UI,
}


# Bun resolves these local override destinations during installation even when
# they are not runtime imports. Preserve that source-resolution closure.
OVERRIDE_SOURCES = (
    "project-governance", "schemas-and-contracts", "ai-work-supervision",
    "application-development-toolkit", "organization-data-lifecycle", "ai-model-policy",
)
for _target in (
    "ai-work-supervision", "ai-model-policy", "ai-practice-workbench",
    "learning-session-facilitation", "personal-knowledge-notebook",
    "information-feed-filter", "travel-itinerary-planner", "public-vote-comparison",
    "project-website",
):
    DEPENDENCIES[_target] = tuple(name for name in OVERRIDE_SOURCES if name != _target)


def checks(target):
    if target == "database-policy-inspector":
        return [
            ["cargo", "fmt", "--all", "--check"],
            ["cargo", "clippy", "--locked", "--all-targets", "--", "-D", "warnings"],
            ["cargo", "test", "--locked"],
        ]
    return [["bun", "run", "check"]]


def exact_keys(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError("Invalid composition object fields")


def revision(value):
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{40}", value) is None:
        raise ValueError("Composition refs must be full lowercase Git commit IDs")
    return value


def validate(manifest):
    exact_keys(manifest, ("schemaVersion", "repositories", "installOrder"))
    if manifest["schemaVersion"] != "libre-ai.ci-composition.v1":
        raise ValueError("Unsupported composition schema")
    exact_keys(manifest["repositories"], ORDER)
    if manifest["installOrder"] != list(ORDER):
        raise ValueError("Installation order differs from the admitted sequence")
    for name, row in manifest["repositories"].items():
        exact_keys(row, ("repository", "ref", "dependencies", "check"))
        if row["repository"] != "libre-ai/" + name:
            raise ValueError("Repository identity does not match its target")
        revision(row["ref"])
        if row["dependencies"] != list(DEPENDENCIES[name]):
            raise ValueError("Missing, unknown or ambiguous source dependency")
        if row["check"] != checks(name):
            raise ValueError("Check is not an admitted argv recipe")


def prepare(manifest, target, target_revision=None):
    validate(manifest)
    if not isinstance(target, str) or target not in DEPENDENCIES:
        raise ValueError("Unknown composition target")
    if target_revision is not None:
        revision(target_revision)
    # Source cycles are expected (auth/toolkit). All checkouts precede installs;
    # installation uses the independently exercised sequence, not a fake DAG.
    selected = {"project-governance"}
    pending = [target]
    while pending:
        name = pending.pop()
        if name in selected and name != "project-governance":
            continue
        selected.add(name)
        pending.extend(dep for dep in DEPENDENCIES[name] if dep not in selected)
    names = [name for name in ORDER if name in selected]
    checkouts = []
    for name in names:
        row = manifest["repositories"][name]
        ref = target_revision if name == target and target_revision is not None else row["ref"]
        checkouts.append({"repository": row["repository"], "ref": ref, "path": name})
    install = []
    for name in names:
        if name == "database-policy-inspector":
            continue
        install.append({"cwd": name, "argv": ["bun", "install", "--frozen-lockfile", "--ignore-scripts"]})
        if name == "application-development-toolkit":
            # File dependencies snapshot the package at install time. Browser
            # exports must exist before consumers copy the UI package.
            install.append({"cwd": name, "argv": ["bun", "run", "--cwd", "packages/ui", "build"]})
    setup = []
    return {
        "target": target,
        "checkouts": checkouts,
        "install": install,
        "setup": setup,
        "checks": [{"cwd": target, "argv": argv} for argv in checks(target)],
    }


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate composition key")
        result[key] = value
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path(__file__).with_name("manifest.json"))
    parser.add_argument("--target", required=True, choices=ORDER)
    parser.add_argument("--revision")
    args = parser.parse_args()
    try:
        with args.manifest.open("rb") as stream:
            raw = stream.read(65537)
        if len(raw) > 65536:
            raise ValueError("Composition manifest exceeds its bound")
        manifest = json.loads(raw, object_pairs_hook=unique_object)
        print(json.dumps(prepare(manifest, args.target, args.revision), indent=2))
    except (OSError, ValueError, TypeError):
        print("Composition rejected", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
