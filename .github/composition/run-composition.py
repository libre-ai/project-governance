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
import tomllib

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


DEPENDENCY_TABLES = ('dependencies', 'dev-dependencies', 'build-dependencies')
CARGO_SOURCE_REGISTRY = 'composition-siblings'


def tables_of(value):
    return value if isinstance(value, dict) else {}


def dependency_entries(manifest):
    """Yield (name, value) for every dependency table, including target.<cfg>.*."""
    tables = [manifest, *(tables_of(value) for value in tables_of(manifest.get('target')).values())]
    for table in tables:
        for key in DEPENDENCY_TABLES:
            yield from tables_of(table.get(key)).items()
    yield from tables_of(tables_of(manifest.get('workspace')).get('dependencies')).items()


def declared_cargo_source(target_manifest, source):
    """The target's single declaration of `source`, refused unless it pins the composed revision."""
    matches = [value for name, value in dependency_entries(target_manifest)
               if (value.get('package', name) if isinstance(value, dict) else name) == source['package']]
    if len(matches) != 1:
        raise ValueError('Cargo source pin differs from the composed revision')
    value = matches[0]
    # path= would compile a sibling tree without ever naming a revision, and
    # branch=/tag= name a moving ref: none of them is the composed source.
    if (not isinstance(value, dict) or value.get('git') != source['url'] or value.get('rev') != source['rev']
            or any(key in value for key in ('path', 'branch', 'tag'))):
        raise ValueError('Cargo source pin differs from the composed revision')
    return value


def toml_string(value):
    # JSON string escapes are a subset of TOML basic-string escapes.
    return json.dumps(value)


def configure_cargo_sources(plan, root, run):
    """Substitute each composed sibling for the git source the target pins.

    Everything is written beside the checkouts, never inside one: the runner
    refuses any tracked change, and Dependabot reads a committed
    `.cargo/config.toml`, so the substitution must not exist in the target.
    """
    sources = plan.get('cargoSources', [])
    if not sources:
        return 0
    target_dir = root / plan['target']
    with (target_dir / 'Cargo.toml').open('rb') as stream:
        target_manifest = tomllib.load(stream)
    vendor = root / '.cargo-sources'
    config_dir = root / '.cargo'
    if vendor.exists() or config_dir.exists():
        raise ValueError('Cargo source configuration already present')
    lines = []
    expected = {}
    for source in sources:
        declared_cargo_source(target_manifest, source)
        crate = root / source['path']
        if crate.is_symlink() or crate.resolve() != crate or not crate.is_dir():
            raise ValueError('Cargo sibling source path changed')
        with (crate / 'Cargo.toml').open('rb') as stream:
            package = tomllib.load(stream).get('package', {})
        if package.get('name') != source['package']:
            raise ValueError('Cargo sibling source is not the declared package')
        if (crate / '.cargo-checksum.json').exists():
            raise ValueError('Cargo sibling source already carries a checksum file')
        farm = vendor / source['package']
        farm.mkdir(parents=True)
        for entry in sorted(crate.iterdir()):
            (farm / entry.name).symlink_to(entry, target_is_directory=entry.is_dir())
        # `package: null` is what `cargo vendor` writes for a git source: the
        # directory source then trusts the tree instead of a registry checksum.
        (farm / '.cargo-checksum.json').write_text('{"files":{},"package":null}')
        expected[source['package']] = (crate / 'Cargo.toml').resolve()
        lines += [
            '[source.' + toml_string('composition-' + source['package']) + ']',
            'git = ' + toml_string(source['url']),
            'rev = ' + toml_string(source['rev']),
            'replace-with = ' + toml_string(CARGO_SOURCE_REGISTRY),
            '',
        ]
    lines += ['[source.' + CARGO_SOURCE_REGISTRY + ']', 'directory = ' + toml_string(str(vendor)), '']
    config_dir.mkdir()
    (config_dir / 'config.toml').write_text('\n'.join(lines))
    # Post-measure: a replacement whose git/rev does not match the lockfile's
    # source is silently ignored and cargo fetches the network copy instead.
    # Only cargo's own resolution says which tree it will compile.
    metadata = json.loads(run(['cargo', 'metadata', '--locked', '--format-version', '1'], target_dir, 300, True).stdout)
    verified = 0
    for package, manifest_path in expected.items():
        resolved = [Path(row['manifest_path']).resolve() for row in metadata.get('packages', [])
                    if row.get('name') == package]
        if resolved != [manifest_path]:
            raise ValueError('Cargo resolved a source other than the composed checkout')
        verified += 1
    if verified != len(sources):
        raise ValueError('Cargo sibling substitution incomplete')
    print(f'Cargo sibling substitution verified: {verified} package(s) from composed checkout(s)')
    return verified


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
        configure_cargo_sources(plan, root, run)
        verify_checkouts(plan, root, run)
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
