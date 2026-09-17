#!/usr/bin/env python3
"""Run only the locally validated composition manifest; no caller-supplied commands."""
# SPDX-License-Identifier: EUPL-1.2
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('composition', HERE / 'prepare-composition.py')
composition = importlib.util.module_from_spec(spec)
spec.loader.exec_module(composition)


def load_plan(target, revision):
    composition.revision(revision)
    with (HERE / 'manifest.json').open('rb') as stream:
        raw = stream.read(65537)
    if len(raw) > 65536:
        raise ValueError('Composition manifest exceeds bound')
    manifest = json.loads(raw, object_pairs_hook=composition.unique_object)
    return composition.prepare(manifest, target, revision)


def validate_root(root, phase):
    if not root.is_absolute() or root.resolve() != root or root.is_symlink():
        raise ValueError('Composition root must be absolute and canonical')
    if phase in ('prepare', 'all'):
        if root.exists() and (not root.is_dir() or any(root.iterdir())):
            raise ValueError('Composition root must be new or empty')
    elif not root.is_dir():
        raise ValueError('Prepared composition is missing')


def command(argv, cwd, timeout, capture=False):
    env = dict(os.environ)
    env.update(GIT_TERMINAL_PROMPT='0', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null')
    return subprocess.run(argv, cwd=cwd, env=env, check=True, timeout=timeout,
                          stdout=subprocess.PIPE if capture else None,
                          text=True)


def fingerprint(plan):
    return hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()


def verify_checkouts(plan, root, run):
    for checkout in plan['checkouts']:
        path = root / checkout['path']
        if path.is_symlink() or path.resolve() != path or not path.is_dir():
            raise ValueError('Composition checkout path changed')
        head = run(['git', 'rev-parse', 'HEAD'], path, 15, True).stdout.strip()
        if head != checkout['ref']:
            raise ValueError('Composition checkout revision mismatch')
        status = run(['git', 'status', '--porcelain', '--untracked-files=no'], path, 15, True).stdout
        if status.strip():
            raise ValueError('Composition tracked inputs changed')


def execute(plan, root, phase):
    validate_root(root, phase)
    deadline = time.monotonic() + 3600

    def run(argv, cwd, timeout, capture=False):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Composition deadline exceeded')
        return command(argv, cwd, min(timeout, remaining), capture)

    receipt = root / '.composition-state.json'
    if phase in ('prepare', 'all'):
        root.mkdir(parents=True, exist_ok=True)
        for checkout in plan['checkouts']:
            path = root / checkout['path']
            path.mkdir()
            run(['git', 'init', '--quiet'], path, 15)
            url = 'https://github.com/' + checkout['repository'] + '.git'
            run(['git', '-c', 'core.hooksPath=/dev/null', 'fetch', '--no-tags', '--depth=3', url, checkout['ref']], path, 180)
            run(['git', '-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], path, 30)
        verify_checkouts(plan, root, run)
        receipt.write_text(json.dumps({'planSha256': fingerprint(plan)}) + '\n')
    else:
        if receipt.is_symlink() or receipt.stat().st_size > 256:
            raise ValueError('Invalid prepared composition receipt')
        if json.loads(receipt.read_text()) != {'planSha256': fingerprint(plan)}:
            raise ValueError('Prepared composition belongs to another plan')
        verify_checkouts(plan, root, run)
    if phase in ('check', 'all'):
        for group, timeout in [('install', 300), ('setup', 300), ('checks', 1800)]:
            for step in plan[group]:
                run(step['argv'], root / step['cwd'], timeout)
            verify_checkouts(plan, root, run)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--phase', choices=('prepare', 'check', 'all'), default='all')
    parser.add_argument('--plan', action='store_true')
    args = parser.parse_args()
    try:
        plan = load_plan(args.target, args.revision)
        validate_root(args.root, args.phase)
        if args.plan:
            print(json.dumps(plan, indent=2))
            return 0
        return execute(plan, args.root, args.phase)
    except (OSError, ValueError, TypeError, TimeoutError, subprocess.SubprocessError):
        print('Composition refused or failed; no subsequent step executed.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
