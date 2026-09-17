#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Libre AI contributors
# SPDX-License-Identifier: EUPL-1.2
"""Run fixed local product gates sequentially; planning grants no execution authority."""

import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys

TARGETS = (
    "ai-work-supervision",
    "ai-model-policy",
    "ai-practice-workbench",
    "learning-session-facilitation",
    "personal-knowledge-notebook",
    "information-feed-filter",
    "travel-itinerary-planner",
    "public-vote-comparison",
    "project-website",
)
GATES = ("root", "native", "wasm", "e2e")
E2E = {
    "ai-work-supervision": ("packages/auth-web", "e2e"),
    "ai-practice-workbench": ("apps/practices", "test:e2e"),
    "personal-knowledge-notebook": ("apps/notebook", "test:e2e"),
    "public-vote-comparison": ("apps/boussole", "test:e2e"),
    "project-website": ("", "test:e2e"),
}


class CheckFailure(Exception):
    """A precondition or a selected gate failed; no automatic retry is permitted."""


def make_plan(target: str, gate: str, tools: dict[str, str]) -> dict:
    if target not in (*TARGETS, "all") or gate not in (*GATES, "all"):
        raise CheckFailure("Unknown target or gate")
    targets = TARGETS if target == "all" else (target,)
    gates = GATES if gate == "all" else (gate,)
    steps = []

    def add(name: str, kind: str, executable: str, arguments: list[str], child: str = ""):
        steps.append({
            "target": name,
            "gate": kind,
            "cwd": str(Path(name) / child),
            "argv": [tools[executable], *arguments],
        })

    for name in targets:
        for kind in gates:
            if kind == "root":
                add(name, kind, "bun", ["run", "check"])
            elif kind == "native" and name in ("ai-model-policy", "personal-knowledge-notebook"):
                add(name, kind, "cargo", ["test", "--locked", "--offline"])
            elif kind == "wasm" and name == "ai-model-policy":
                add(name, kind, "node", ["tools/quality/build-policy-core-wasm.ts"])
                add(name, kind, "bun", ["tools/quality/policy-core-wasm-conformance.ts"])
            elif kind == "wasm" and name == "personal-knowledge-notebook":
                add(name, kind, "node", ["tools/qualification/notebook-core-v2/build.ts"])
            elif kind == "e2e" and name in E2E:
                child, script = E2E[name]
                add(name, kind, "bun", ["run", script, "--workers=1"], child)
    if not steps:
        raise CheckFailure("No applicable gate for this target")
    return {
        "schemaVersion": "libre-ai.product-check-plan.v1",
        "executed": False,
        "linuxQualificationClaimed": False,
        "steps": steps,
        "prerequisites": [
            "Sibling repository composition installed with frozen lockfiles",
            "UI dist built; data/contracts/web-platform packages installed",
            "Bun canary 57f349f63, Rust 1.97.0 and wasm32-unknown-unknown target",
            "Cargo dependencies preloaded for offline native tests",
            "Node 26.5.0 matching the Notebook platform executable pin",
            "Playwright 1.61.1 browsers installed before E2E",
        ],
        "limits": [
            "Inherited root checks are not exhaustive native/WASM/E2E aggregates",
            "Existing macOS evidence does not qualify a future Linux execution",
            "This runner is not a sandbox and does not install or publish anything",
        ],
    }


def executable_path(value: str) -> str:
    found = value if Path(value).is_absolute() else shutil.which(value)
    if not found or not Path(found).is_file() or not os.access(found, os.X_OK):
        raise CheckFailure("Required executable is unavailable")
    # Preserve rustup proxy basename; resolving its symlink would invoke rustup instead of cargo.
    return str(Path(found).absolute())


def preflight(plan: dict, root: Path) -> None:
    if not root.is_dir():
        raise CheckFailure("Composition root is unavailable")
    for step in plan["steps"]:
        current = root
        for part in Path(step["cwd"]).parts:
            current = current / part
            if current.is_symlink() or not current.is_dir():
                raise CheckFailure("Selected repository or child directory is unavailable")
        executable_path(step["argv"][0])


def run_step(step: dict, root: Path, environment: dict[str, str], timeout: float = 1800) -> None:
    # Inherit output streams instead of accumulating arbitrary test output in memory.
    child = subprocess.Popen(
        step["argv"], cwd=root / step["cwd"], env=environment,
        stdin=subprocess.DEVNULL, stdout=sys.stderr, stderr=sys.stderr,
        start_new_session=True, shell=False,
    )
    try:
        code = child.wait(timeout=timeout)
    except (subprocess.TimeoutExpired, KeyboardInterrupt):
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
        raise CheckFailure("Selected gate interrupted or timed out") from None
    if code != 0:
        raise CheckFailure(f"Selected gate failed: {step['target']} / {step['gate']} (exit {code})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--target", required=True, choices=(*TARGETS, "all"))
    parser.add_argument("--gate", default="root", choices=(*GATES, "all"))
    parser.add_argument("--bun", default="bun")
    parser.add_argument("--cargo", default="cargo")
    parser.add_argument("--node", default="node")
    parser.add_argument("--plan", action="store_true")
    args = parser.parse_args()
    try:
        supplied = {name: getattr(args, name) for name in ("bun", "cargo", "node")}
        plan = make_plan(args.target, args.gate, supplied)
        if args.plan:
            print(json.dumps(plan, indent=2))
            return 0
        # Resolve all supplied tools before any child, including tools invoked by nested scripts.
        tools = {name: executable_path(value) for name, value in supplied.items()}
        plan = make_plan(args.target, args.gate, tools)
        root = args.root.absolute()
        preflight(plan, root)
        directories = list(dict.fromkeys(str(Path(value).parent) for value in tools.values()))
        environment = {
            **os.environ,
            "PATH": os.pathsep.join([*directories, os.environ.get("PATH", "")]),
            "NOTEBOOK_QUALIFICATION_NODE": tools["node"],
        }
        for step in plan["steps"]:
            run_step(step, root, environment)
        print(json.dumps({**plan, "executed": True, "exitCode": 0}, indent=2))
        return 0
    except (CheckFailure, OSError) as error:
        # Report controlled errors without serializing the environment or raw subprocess output.
        print(str(error) if isinstance(error, CheckFailure) else "Local process unavailable", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
