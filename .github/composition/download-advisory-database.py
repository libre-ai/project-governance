#!/usr/bin/env python3
"""Download the offline OSV advisory database for the targets that require it; fail closed."""
# SPDX-License-Identifier: EUPL-1.2
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('runner', HERE / 'run-composition.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

# The database is ~200 MB: the consumer measured about 3 minutes.
DOWNLOAD_TIMEOUT = 900
# File timestamps are coarser than time.time(); a file this run wrote cannot be older than its start by more.
CLOCK_SLACK_SECONDS = 5


def read_policy(path):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path or not path.is_file() or path.stat().st_size > 65536:
        raise ValueError('Policy must be a bounded canonical regular file')
    return json.loads(path.read_text())


def relative_parts(value):
    if not isinstance(value, str) or re.fullmatch(r'[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*', value) is None:
        raise ValueError('Invalid relative path')
    parts = value.split('/')
    if any(part in ('.', '..') for part in parts):
        raise ValueError('Invalid relative path')
    return parts


def database_file(policy):
    """Where the scanner keeps the npm database under its cache directory (toolchains/osv-scanner.json)."""
    try:
        value = policy['offlineDatabase']['file']
    except (KeyError, TypeError) as error:
        raise ValueError('Incomplete osv-scanner policy') from error
    relative_parts(value)
    return value


def inside(base, relative, name):
    """`relative` below `base`, crossing no symbolic link that already exists."""
    path = base
    for part in relative_parts(relative):
        path = path / part
        if path.is_symlink():
            raise ValueError(name + ' crosses a symbolic link')
    return path


def executable(scanner):
    if not isinstance(scanner, (str, Path)) or not Path(scanner).is_absolute():
        raise ValueError('The osv-scanner path must be absolute (LIBRE_AI_OSV_SCANNER)')
    path = Path(scanner)
    if path.is_symlink() or not path.is_file() or not os.access(path, os.X_OK):
        raise ValueError('The osv-scanner path is not an executable regular file')
    return path


def download(target, revision, root, policy_path, scanner):
    """Return the downloaded file's description, or None when the target does not require a database."""
    wanted = runner.load_plan(target, revision)['advisoryDatabase']
    if wanted is None:
        return None
    file_name = database_file(read_policy(policy_path))
    scanner = executable(scanner)
    root = Path(root)
    if not root.is_absolute() or root.resolve() != root:
        raise ValueError('Composition root must be absolute and canonical')
    target_root = root / target
    if target_root.is_symlink() or not target_root.is_dir():
        raise ValueError('The target checkout is missing')
    lock = inside(target_root, wanted['lock'], 'The lockfile path')
    if not lock.is_file() or lock.is_symlink():
        raise ValueError('The lockfile is not a regular file of the target checkout')
    cache = inside(target_root, wanted['cacheDirectory'], 'The cache directory')
    database = inside(cache, file_name, 'The database path')
    # A second --download-offline-databases leaves an existing file, and its
    # date, untouched: a stale file would be read as a fresh one.
    if database.exists():
        if not database.is_file():
            raise ValueError('The database path is not a regular file')
        database.unlink()
    started = time.time()
    environment = dict(os.environ, OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=str(cache))
    # Exit 1 means "scanned, advisories found": judging them is the consumer
    # gate's work. Anything else means the scanner did not do its job.
    run = subprocess.run(
        [str(scanner), 'scan', 'source', '--offline', '--download-offline-databases', '-L', str(lock)],
        cwd=target_root, env=environment, stdout=subprocess.DEVNULL, check=False, timeout=DOWNLOAD_TIMEOUT,
    )
    if run.returncode not in (0, 1):
        raise ValueError('osv-scanner exited ' + str(run.returncode) + ' while downloading the advisory database')
    # The downloaded file, not the exit code, is the evidence.
    if database.is_symlink() or not database.is_file():
        raise ValueError('advisory database absent after the download: ' + str(database))
    info = database.stat()
    if info.st_size == 0:
        raise ValueError('advisory database is empty after the download: ' + str(database))
    if info.st_mtime < started - CLOCK_SLACK_SECONDS:
        raise ValueError('advisory database was not written by this download: ' + str(database))
    return {
        'file': str(database),
        'bytes': info.st_size,
        'modified': datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat(),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--policy', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = download(args.target, args.revision, args.root, args.policy, os.environ.get('LIBRE_AI_OSV_SCANNER'))
    except (OSError, ValueError, TypeError, subprocess.SubprocessError) as error:
        print('Offline advisory database refused: ' + str(error), file=sys.stderr)
        return 1
    if result is None:
        print('Offline advisory database not required for ' + args.target + '.')
    else:
        print('Offline advisory database for ' + args.target + ': ' + result['file'] + ', '
              + str(result['bytes']) + ' bytes, modified ' + result['modified']
              + ' (the date its gate reads).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
