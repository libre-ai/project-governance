#!/usr/bin/env python3
"""Run only the locally validated composition manifest; no caller-supplied commands."""
# SPDX-License-Identifier: EUPL-1.2
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
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
    elif phase == 'verify':
        # Read-only: a missing root is reported checkout by checkout, not refused.
        return
    elif not root.is_dir():
        raise ValueError('Prepared composition is missing')


def command(argv, cwd, timeout, capture=False, stdin=None):
    """`stdin` bytes switch the call to binary: blob contents are bytes, never text."""
    # No inherited GIT_* variable reaches a child: GIT_DIR, GIT_WORK_TREE or
    # GIT_INDEX_FILE would make git answer about another repository, tree or
    # index than the directory it is run in.
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    # GIT_NO_REPLACE_OBJECTS: a `refs/replace/*` entry would let git answer a
    # committed object id with other content.
    env.update(GIT_TERMINAL_PROMPT='0', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null',
               GIT_NO_REPLACE_OBJECTS='1')
    return subprocess.run(argv, cwd=cwd, env=env, check=True, timeout=timeout,
                          stdout=subprocess.PIPE if capture or stdin is not None else None,
                          input=stdin, text=stdin is None)


def fingerprint(plan):
    return hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()


RECEIPT = '.composition-state.json'


def receipt_verdict(plan, root):
    """Verdict of the receipt `prepare` leaves in the root, for this plan; reads, never writes.

    The single reader: `check` admits a root on it and `verify` reports it, so
    `verify` cannot say READY for a root `check` refuses on its receipt.
    """
    receipt = root / RECEIPT
    if not receipt.exists() and not receipt.is_symlink():
        return 'absent'
    try:
        if receipt.is_symlink() or not receipt.is_file() or receipt.stat().st_size > 256:
            return 'unreadable'
        recorded = json.loads(receipt.read_text())
    except (OSError, ValueError):
        return 'unreadable'
    return 'concordant' if recorded == {'planSha256': fingerprint(plan)} else 'mismatch'


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


CHILD_FAILURES = (OSError, subprocess.SubprocessError)
BUN_PIN = ('project-governance', 'toolchains/bun.json')
BUN_GUIDE = 'docs/LOCAL-COMPOSITION.md'


def inspect_checkout(checkout, root, run):
    """(revision read or None, verdict) of one planned checkout; reads, never writes.

    `--git-dir=.git` switches repository discovery off: a directory without
    its own `.git` would otherwise be answered by the repository enclosing it.
    A `.git` that is a file or a link redirects to another repository: it is
    not read, the verdict is about the directory the plan names.
    `--no-optional-locks` keeps `status` from writing its refreshed index.
    """
    path = root / checkout['path']
    if not path.exists() and not path.is_symlink():
        return None, 'absent'
    if path.is_symlink() or path.resolve() != path or not path.is_dir():
        return None, 'unreadable'
    git_dir = path / '.git'
    if git_dir.is_symlink() or not git_dir.is_dir():
        return None, 'unreadable'
    git = ['git', '--no-optional-locks', '--git-dir=.git']
    try:
        head = run([*git, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], path, 15, True).stdout.strip()
        composition.revision(head)
    except (*CHILD_FAILURES, ValueError):
        return None, 'unreadable'
    if head != checkout['ref']:
        return head, 'mismatch'
    try:
        status = run([*git, 'status', '--porcelain', '--untracked-files=no'], path, 15, True).stdout
        # `-v` tags every index entry: `H` is a plain one, `S` is skip-worktree,
        # a lowercase letter is assume-unchanged. `status` does not look at the
        # file behind either flag, so its silence says nothing about that file.
        tags = run([*git, 'ls-files', '-v', '-z'], path, 30, True).stdout
    except CHILD_FAILURES:
        return head, 'unreadable'
    if status.strip():
        return head, 'modified'
    if any(not record.startswith('H ') for record in tags.split('\0') if record):
        return head, 'masked'
    return head, 'concordant'


def report_checkouts(plan, root, run, emit):
    """One line per planned checkout, then the counters. True when every one is concordant."""
    expected = mounted = concordant = 0
    verdicts = {}
    if not root.is_dir():
        emit(f'Composition root is missing: {root}')
    for checkout in plan['checkouts']:
        head, verdict = inspect_checkout(checkout, root, run)
        verdicts[checkout['path']] = verdict
        expected += 1
        mounted += head is not None
        concordant += verdict == 'concordant'
        emit(f"{checkout['path']} mounted={head or '-'} expected={checkout['ref']} {verdict}")
    emit(f"Composition {plan['target']}: {expected} repositories expected, {mounted} mounted, {concordant} concordant")
    # An empty plan examined nothing: it cannot be a ready composition.
    return expected > 0 and concordant == expected, verdicts


def pinned_bun(root, verdicts):
    """The Bun revision the composed governance pins, or None when it cannot be trusted or read.

    The same file the workflow hands to install-toolchains.sh. A governance
    checkout off its pin is not a source: its file may declare another Bun.
    """
    if verdicts.get(BUN_PIN[0]) != 'concordant':
        return None
    try:
        with (root / BUN_PIN[0] / BUN_PIN[1]).open('rb') as stream:
            raw = stream.read(65537)
        if len(raw) > 65536:
            return None
        revision = json.loads(raw, object_pairs_hook=composition.unique_object).get('revision')
    except (OSError, ValueError, AttributeError):
        return None
    if not isinstance(revision, str) or not revision.isprintable() or not 0 < len(revision) <= 64 or ' ' in revision:
        return None
    return revision


def report_bun(plan, root, run, verdicts, emit):
    """The Bun on PATH against the pinned one. True when the plan runs no bun step or they match."""
    steps = [step for group in ('install', 'setup', 'checks') for step in plan[group]]
    if not any(step['argv'][0] == 'bun' for step in steps):
        emit('Toolchain: 0 expected, 0 concordant (no step of this plan runs bun)')
        return True
    expected = pinned_bun(root, verdicts)
    try:
        # Without a root, the caller's own directory: a working directory that
        # does not exist fails the call and would report an installed Bun as absent.
        found = run(['bun', '--revision'], root if root.is_dir() else None, 15, True).stdout.strip() or None
    except CHILD_FAILURES:
        found = None
    if expected is None:
        verdict = 'unreadable'
    elif found is None:
        verdict = 'absent'
    else:
        verdict = 'concordant' if found == expected else 'mismatch'
    emit(f"bun found={found or '-'} expected={expected or '-'} {verdict}")
    emit(f"Toolchain: 1 expected, {int(verdict == 'concordant')} concordant")
    if verdict in ('absent', 'mismatch'):
        emit(f'Bun {expected} is the pinned toolchain ({"/".join(BUN_PIN)} of the composition): install it as '
             f'{BUN_GUIDE} section 2.2 describes and put it first on PATH, then run this phase again.')
    return verdict == 'concordant'


def report_receipt(plan, root, emit):
    """The receipt `--phase check` demands. True when it is the one of this plan."""
    verdict = receipt_verdict(plan, root)
    emit(f'receipt {RECEIPT} expected={fingerprint(plan)} {verdict}')
    if verdict != 'concordant':
        emit('--phase check refuses this root: only --phase prepare, on a new root and for this target and '
             'revision, writes the receipt it demands.')
    return verdict == 'concordant'


def report(plan, root, run, toolchain, emit=print):
    """Say whether the mounted composition is the planned one.

    READY is only ever said with the receipt and the toolchain judged
    (`--phase verify`): without them the sources are mounted, which is not yet
    a composition a check can run in.
    """
    ready, verdicts = report_checkouts(plan, root, run, emit)
    if not toolchain:
        emit(f"Sources of {plan['target']}: {'MOUNTED' if ready else 'NOT MOUNTED'}"
             ' (toolchain not judged by this phase: --phase verify does)')
        return ready
    ready = report_receipt(plan, root, emit) and ready
    ready = report_bun(plan, root, run, verdicts, emit) and ready
    emit(f"Composition {plan['target']}: {'READY' if ready else 'NOT READY'}")
    return ready


DEPENDENCY_TABLES = ('dependencies', 'dev-dependencies', 'build-dependencies')
CARGO_SOURCE_REGISTRY = 'composition-siblings'
# Keys of a cargo configuration file that change where a dependency's source is
# read from. `include` pulls another file in, which could carry any of them.
CARGO_CONFIG_SOURCE_KEYS = ('source', 'patch', 'paths', 'include')
CARGO_CONFIG_NAMES = ('config', 'config.toml')
REGULAR_BLOB_MODES = {'100644': 0o644, '100755': 0o755}


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


def refuse_target_overrides(target_manifest, package):
    """Refuse a `[patch.*]` or `[replace]` entry of the target that names the composed package.

    Either one substitutes the package a second time, after the substitution
    written here: a `path =` patch onto the sibling's live working tree, or a
    git replace at another revision. A `[replace]` spec is matched on the
    package name appearing anywhere in it, which is wider than cargo's own
    package-id parse: a refusal is visible and recoverable, a second
    substitution is neither.
    """
    for table in tables_of(target_manifest.get('patch')).values():
        for name, value in tables_of(table).items():
            if name == package or tables_of(value).get('package') == package:
                raise ValueError('Cargo target overrides the composed package')
    for spec, value in tables_of(target_manifest.get('replace')).items():
        if package in spec or tables_of(value).get('package') == package:
            raise ValueError('Cargo target overrides the composed package')


def refuse_target_cargo_config(run, target_dir):
    """Refuse a committed cargo configuration that can redirect a source.

    Cargo merges every `.cargo/config(.toml)` from its working directory up and
    the deeper file wins: a target's own `[source.composition-siblings]` would
    repoint the substitution written beside the checkouts to a tree the target
    chose. Every tracked one is read, at any depth, since a check step may run
    cargo from a subdirectory. A configuration without those keys (an
    `[alias]` table, build flags) is accepted.
    """
    tracked = run(['git', 'ls-files', '-z'], target_dir, 30, True).stdout
    for name in tracked.split('\0'):
        parts = PurePosixPath(name).parts
        # Lowercased: a case-insensitive filesystem serves `.Cargo/Config.toml` too.
        if len(parts) < 2 or parts[-2].lower() != '.cargo' or parts[-1].lower() not in CARGO_CONFIG_NAMES:
            continue
        with (target_dir / name).open('rb') as stream:
            config = tomllib.load(stream)
        if any(key in config for key in CARGO_CONFIG_SOURCE_KEYS):
            raise ValueError('Target cargo configuration redirects a source')


def materialise_committed_tree(run, checkout, ref, subpath, destination):
    """Write the blobs `ref` commits under `subpath` as regular files in `destination`.

    The working tree is never read. A symlink farm over it compiled whatever
    it held at configure time: untracked files (a `build.rs` that ran), and a
    manifest the post-measure could only judge by resolving links. Returns the
    set of relative paths written.
    """
    listing = run(['git', 'ls-tree', '-r', '-z', ref + ':' + subpath], checkout, 30, True).stdout
    entries = []
    for record in listing.split('\0'):
        if not record:
            continue
        meta, _, name = record.partition('\t')
        mode, kind, oid = meta.split(' ')
        if mode not in REGULAR_BLOB_MODES or kind != 'blob':
            raise ValueError('Cargo sibling source holds a symlink or a submodule')
        relative = PurePosixPath(name)
        if relative.is_absolute() or any(part in ('', '.', '..') for part in relative.parts):
            raise ValueError('Cargo sibling source holds an unsafe path')
        entries.append((mode, oid, relative))
    if not entries:
        raise ValueError('Cargo sibling source is empty')
    request = ''.join(oid + '\n' for _, oid, _ in entries).encode()
    stream = run(['git', 'cat-file', '--batch'], checkout, 120, stdin=request).stdout
    offset = 0
    for mode, oid, relative in entries:
        end = stream.index(b'\n', offset)
        header = stream[offset:end].decode().split(' ')
        if len(header) != 3 or header[0] != oid or header[1] != 'blob':
            raise ValueError('Cargo sibling source blob mismatch')
        size = int(header[2])
        content = stream[end + 1:end + 1 + size]
        if len(content) != size or stream[end + 1 + size:end + 2 + size] != b'\n':
            raise ValueError('Cargo sibling source blob mismatch')
        offset = end + 2 + size
        path = destination.joinpath(*relative.parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as output:
            output.write(content)
        path.chmod(REGULAR_BLOB_MODES[mode])
    if offset != len(stream):
        raise ValueError('Cargo sibling source blob mismatch')
    return {relative.as_posix() for _, _, relative in entries}


def toml_string(value):
    # JSON string escapes are a subset of TOML basic-string escapes.
    return json.dumps(value)


def configure_cargo_sources(plan, root, run):
    """Substitute each composed sibling for the git source the target pins.

    Everything is written beside the checkouts, never inside one: the runner
    refuses any tracked change, and Dependabot reads a committed
    `.cargo/config.toml`, so the substitution must not exist in the target.
    The sibling is materialised from its committed tree at the composed ref.

    What the post-measure proves, and what it does not: it is cargo's own
    resolution, from the target directory, under the configuration written
    here, before any target step runs. The target's check steps are target
    code; `bun run check` can call cargo with `--config`, `CARGO_*`
    environment overrides or another manifest path, and nothing here bounds
    those calls. Configuration above the composition root (the runner's
    CARGO_HOME) belongs to the environment and is not read.
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
    refuse_target_cargo_config(run, target_dir)
    refs = {checkout['path']: checkout['ref'] for checkout in plan['checkouts']}
    lines = []
    expected = {}
    for source in sources:
        declared_cargo_source(target_manifest, source)
        refuse_target_overrides(target_manifest, source['package'])
        repository, _, subpath = source['path'].partition('/')
        if repository not in refs or not subpath:
            raise ValueError('Cargo sibling source is not a composed checkout')
        farm = vendor / source['package']
        farm.mkdir(parents=True)
        files = materialise_committed_tree(run, root / repository, refs[repository], subpath, farm)
        if '.cargo-checksum.json' in files:
            raise ValueError('Cargo sibling source already carries a checksum file')
        if 'Cargo.toml' not in files:
            raise ValueError('Cargo sibling source is not the declared package')
        with (farm / 'Cargo.toml').open('rb') as stream:
            package = tomllib.load(stream).get('package', {})
        if package.get('name') != source['package']:
            raise ValueError('Cargo sibling source is not the declared package')
        # `package: null` is what `cargo vendor` writes for a git source: the
        # directory source then trusts the tree instead of a registry checksum.
        (farm / '.cargo-checksum.json').write_text('{"files":{},"package":null}')
        expected[source['package']] = (os.path.join(str(farm), 'Cargo.toml'),
                                       'git+' + source['url'] + '?rev=' + source['rev'] + '#')
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
    rows = metadata.get('packages', [])
    for package, (manifest_path, source_id) in expected.items():
        # Compared as written, never resolved: resolving followed a symlink a
        # target committed back to the sibling's Cargo.toml and certified the
        # impostor sources beside it. The id prefix names the git source cargo
        # replaced; a `path+` id is a path the target chose.
        found = [(os.path.normpath(str(row.get('manifest_path'))), str(row.get('id')))
                 for row in rows if row.get('name') == package]
        if len(found) != 1 or found[0][0] != manifest_path or not found[0][1].startswith(source_id):
            raise ValueError('Cargo resolved a source other than the composed checkout')
        verified += 1
    if verified != len(sources):
        raise ValueError('Cargo sibling substitution incomplete')
    print(f'Cargo sibling substitution verified: {verified} package(s) from composed checkout(s)')
    return verified


def execute(plan, root, phase):
    validate_root(root, phase)
    deadline = time.monotonic() + 3600

    def run(argv, cwd, timeout, capture=False, stdin=None):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Composition deadline exceeded')
        return command(argv, cwd, min(timeout, remaining), capture, stdin)

    receipt = root / RECEIPT
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
        verdict = receipt_verdict(plan, root)
        if verdict != 'concordant':
            raise ValueError(f'Prepared composition receipt is {verdict}')
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
    parser.add_argument('--phase', choices=('prepare', 'check', 'all', 'verify'), default='all')
    parser.add_argument('--plan', action='store_true')
    args = parser.parse_args()
    failures = (OSError, ValueError, TypeError, TimeoutError, subprocess.SubprocessError)
    try:
        plan = load_plan(args.target, args.revision)
        validate_root(args.root, args.phase)
        if args.plan:
            print(json.dumps(plan, indent=2))
            return 0
        if args.phase == 'verify':
            # Mounts nothing, installs nothing, writes nothing: the plan against
            # what is on disk, the receipt `check` demands, and the Bun on PATH
            # against the one the composed governance pins.
            return 0 if report(plan, args.root, command, toolchain=True) else 1
    except failures:
        print('Composition refused or failed; no subsequent step executed.', file=sys.stderr)
        return 1
    try:
        status = execute(plan, args.root, args.phase)
        if args.phase == 'prepare':
            # Bun is installed after this phase, from the composition it mounts:
            # only `verify` judges the toolchain.
            return status if report(plan, args.root, command, toolchain=False) else 1
        return status
    except failures:
        print('Composition refused or failed; no subsequent step executed.', file=sys.stderr)
        if args.phase == 'prepare':
            # A fetch that failed halfway leaves some checkouts: say which.
            try:
                report(plan, args.root, command, toolchain=False)
            except failures:
                pass
        return 1


if __name__ == '__main__':
    sys.exit(main())
