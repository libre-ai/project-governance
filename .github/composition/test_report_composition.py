# SPDX-License-Identifier: EUPL-1.2
"""The readiness report of a mounted composition, exercised on real git checkouts.

Every expected value below is written by the fixture (the revision a checkout
is committed at, the revision the plan pins), never copied from the report.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

P = pathlib.Path(__file__).with_name('run-composition.py').resolve()
GIT_IDENTITY = {'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't',
                'GIT_COMMITTER_EMAIL': 't@t', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'}
PINNED_BUN = '9.9.9-canary.1+abcdef012'
NAMES = ('project-governance', 'schemas-and-contracts', 'execution-sandbox')


def git(cwd, *argv):
    found = shutil.which('git')
    if found is None:
        raise RuntimeError('git is required for composition tests')
    # As the runner's own `command`: an inherited GIT_DIR, GIT_WORK_TREE or
    # GIT_INDEX_FILE would make the fixtures write into another repository.
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    return subprocess.run([found, *argv], cwd=cwd, check=True, capture_output=True, text=True,
                          env={**env, **GIT_IDENTITY}).stdout.strip()


def commit(path, message):
    git(path, 'add', '-A')
    git(path, 'commit', '--quiet', '--allow-empty', '-m', message)
    return git(path, 'rev-parse', 'HEAD')


RECEIPT = '.composition-state.json'


def snapshot(root):
    """Every entry under `root`, `.git` included, with the bytes it holds."""
    entries = {}
    for path in sorted(root.rglob('*')):
        name = str(path.relative_to(root))
        if path.is_symlink():
            entries[name] = 'link ' + os.readlink(path)
        elif path.is_file():
            entries[name] = 'file ' + hashlib.sha256(path.read_bytes()).hexdigest()
        else:
            entries[name] = 'directory'
    return entries


class Mounted:
    """Three committed checkouts, the plan that pins each at its own head, and the receipt of its mount.

    The receipt is what `--phase prepare` leaves and `--phase check` demands:
    the SHA-256 of the plan serialised with sorted keys, computed here.
    """

    def __init__(self, base, bun_step=True, receipt=True):
        self.root = base / 'composition'
        self.refs = {}
        for name in NAMES:
            path = self.root / name
            path.mkdir(parents=True)
            git(path, 'init', '--quiet')
            (path / 'README.md').write_text(name + '\n')
            if name == 'project-governance':
                (path / 'toolchains').mkdir()
                (path / 'toolchains' / 'bun.json').write_text(json.dumps({'revision': PINNED_BUN}) + '\n')
            self.refs[name] = commit(path, 'fixture')
        argv = ['bun', 'run', 'check'] if bun_step else ['cargo', 'test', '--locked']
        self.plan = {
            'target': 'execution-sandbox',
            'checkouts': [{'repository': 'libre-ai/' + name, 'ref': self.refs[name], 'path': name} for name in NAMES],
            'install': [], 'setup': [],
            'checks': [{'cwd': 'execution-sandbox', 'argv': argv}],
        }
        self.fingerprint = hashlib.sha256(json.dumps(self.plan, sort_keys=True).encode()).hexdigest()
        if receipt:
            (self.root / RECEIPT).write_text(json.dumps({'planSha256': self.fingerprint}) + '\n')


class ReportTests(unittest.TestCase):

    def setUp(self):
        spec = importlib.util.spec_from_file_location('runner', P)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = pathlib.Path(self.directory.name).resolve()

    def run_with_bun(self, revision):
        """The real runner for git; `bun --revision` answers `revision` (None: no bun installed)."""
        real = self.m.command  # bound now: `cli` patches the attribute with this very function

        def run(argv, cwd, timeout, capture=False, stdin=None):
            if argv[0] == 'bun':
                # As subprocess does: a working directory that does not exist fails the call.
                if revision is None or (cwd is not None and not pathlib.Path(cwd).is_dir()):
                    raise FileNotFoundError('bun')
                return subprocess.CompletedProcess(argv, 0, revision + '\n')
            return real(argv, cwd, timeout, capture, stdin)
        return run

    def report(self, mounted, toolchain=True, bun=PINNED_BUN):
        lines = []
        ready = self.m.report(mounted.plan, mounted.root, self.run_with_bun(bun), toolchain, lines.append)
        return ready, lines

    def test_concordant_composition_prints_one_line_per_repository_and_its_counters(self):
        mounted = Mounted(self.base)
        ready, lines = self.report(mounted)
        self.assertTrue(ready)
        self.assertEqual(lines[:3], [
            f'{name} mounted={mounted.refs[name]} expected={mounted.refs[name]} concordant' for name in NAMES])
        self.assertEqual(lines[3], 'Composition execution-sandbox: 3 repositories expected, 3 mounted, 3 concordant')
        self.assertEqual(lines[-1], 'Composition execution-sandbox: READY')

    def test_sibling_at_another_revision_than_the_pinned_one_is_not_ready(self):
        mounted = Mounted(self.base)
        sibling = mounted.root / 'schemas-and-contracts'
        moved = commit(sibling, 'the sibling head moved past its pin')
        self.assertNotEqual(moved, mounted.refs['schemas-and-contracts'])
        ready, lines = self.report(mounted)
        self.assertFalse(ready)
        self.assertIn(
            f"schemas-and-contracts mounted={moved} expected={mounted.refs['schemas-and-contracts']} mismatch", lines)
        self.assertIn('Composition execution-sandbox: 3 repositories expected, 3 mounted, 2 concordant', lines)
        self.assertEqual(lines[-1], 'Composition execution-sandbox: NOT READY')

    def test_absent_expected_repository_is_not_ready(self):
        mounted = Mounted(self.base)
        shutil.rmtree(mounted.root / 'schemas-and-contracts')
        ready, lines = self.report(mounted)
        self.assertFalse(ready)
        self.assertIn(f"schemas-and-contracts mounted=- expected={mounted.refs['schemas-and-contracts']} absent", lines)
        self.assertIn('Composition execution-sandbox: 3 repositories expected, 2 mounted, 2 concordant', lines)
        self.assertEqual(lines[-1], 'Composition execution-sandbox: NOT READY')

    def test_unreadable_repository_is_not_ready(self):
        cases = {
            'a directory that is not a checkout': lambda path: shutil.rmtree(path / '.git'),
            'a checkout without any commit': lambda path: (shutil.rmtree(path / '.git'), git(path, 'init', '--quiet')),
        }
        for label, damage in cases.items():
            with self.subTest(label), tempfile.TemporaryDirectory() as d:
                mounted = Mounted(pathlib.Path(d).resolve())
                damage(mounted.root / 'schemas-and-contracts')
                ready, lines = self.report(mounted)
                self.assertFalse(ready)
                self.assertIn(
                    f"schemas-and-contracts mounted=- expected={mounted.refs['schemas-and-contracts']} unreadable",
                    lines)
                self.assertIn('Composition execution-sandbox: 3 repositories expected, 2 mounted, 2 concordant', lines)

    def test_directory_inside_another_checkout_is_not_read_as_that_checkout(self):
        # Without its own `.git`, git would climb to the enclosing repository
        # and answer with that head: here the pinned one, a false concordance.
        mounted = Mounted(self.base)
        outer = mounted.root / 'project-governance'
        inner = outer / 'schemas-and-contracts'
        inner.mkdir()
        plan = {**mounted.plan, 'checkouts': [
            {'repository': 'libre-ai/schemas-and-contracts', 'ref': mounted.refs['project-governance'],
             'path': 'schemas-and-contracts'}]}
        lines = []
        ready = self.m.report(plan, outer, self.run_with_bun(PINNED_BUN), False, lines.append)
        self.assertFalse(ready)
        self.assertEqual(
            lines[0], f"schemas-and-contracts mounted=- expected={mounted.refs['project-governance']} unreadable")

    def test_tracked_change_in_a_checkout_at_the_pinned_revision_is_not_ready(self):
        mounted = Mounted(self.base)
        with (mounted.root / 'schemas-and-contracts' / 'README.md').open('a') as stream:
            stream.write('edited after the mount\n')
        ready, lines = self.report(mounted)
        self.assertFalse(ready)
        ref = mounted.refs['schemas-and-contracts']
        self.assertIn(f'schemas-and-contracts mounted={ref} expected={ref} modified', lines)
        self.assertIn('Composition execution-sandbox: 3 repositories expected, 3 mounted, 2 concordant', lines)

    def test_empty_plan_is_not_ready(self):
        mounted = Mounted(self.base)
        mounted.plan['checkouts'] = []
        ready, lines = self.report(mounted)
        self.assertFalse(ready)
        self.assertIn('Composition execution-sandbox: 0 repositories expected, 0 mounted, 0 concordant', lines)

    def test_pinned_bun_is_reported_concordant(self):
        mounted = Mounted(self.base)
        ready, lines = self.report(mounted, toolchain=True)
        self.assertTrue(ready)
        self.assertIn(f'bun found={PINNED_BUN} expected={PINNED_BUN} concordant', lines)
        self.assertIn('Toolchain: 1 expected, 1 concordant', lines)

    def test_another_bun_than_the_pinned_one_is_not_ready_and_says_which_is_expected(self):
        mounted = Mounted(self.base)
        ready, lines = self.report(mounted, toolchain=True, bun='1.0.0+000000000')
        self.assertFalse(ready)
        self.assertIn(f'bun found=1.0.0+000000000 expected={PINNED_BUN} mismatch', lines)
        self.assertIn('Toolchain: 1 expected, 0 concordant', lines)
        self.assertTrue(any(PINNED_BUN in line and 'docs/LOCAL-COMPOSITION.md' in line for line in lines[-3:]))
        self.assertEqual(lines[-1], 'Composition execution-sandbox: NOT READY')

    def test_missing_bun_is_not_ready(self):
        mounted = Mounted(self.base)
        ready, lines = self.report(mounted, toolchain=True, bun=None)
        self.assertFalse(ready)
        self.assertIn(f'bun found=- expected={PINNED_BUN} absent', lines)

    def test_unreadable_bun_pin_is_not_ready(self):
        cases = {
            'pin file absent': lambda path: (path.unlink(), commit(path.parents[1], 'drop the pin')),
            'pin file is not JSON': lambda path: (path.write_text('{'), commit(path.parents[1], 'break the pin')),
            'pin without a revision': lambda path: (path.write_text('{}'), commit(path.parents[1], 'empty the pin')),
        }
        for label, damage in cases.items():
            with self.subTest(label), tempfile.TemporaryDirectory() as d:
                mounted = Mounted(pathlib.Path(d).resolve())
                governance = mounted.root / 'project-governance'
                damage(governance / 'toolchains' / 'bun.json')
                mounted.plan['checkouts'][0]['ref'] = git(governance, 'rev-parse', 'HEAD')
                ready, lines = self.report(mounted, toolchain=True)
                self.assertFalse(ready)
                self.assertIn(f'bun found={PINNED_BUN} expected=- unreadable', lines)
                self.assertIn('Toolchain: 1 expected, 0 concordant', lines)

    def test_bun_pin_is_not_read_from_a_governance_checkout_off_its_pin(self):
        mounted = Mounted(self.base)
        commit(mounted.root / 'project-governance', 'governance moved past its pin')
        ready, lines = self.report(mounted, toolchain=True)
        self.assertFalse(ready)
        self.assertIn(f'bun found={PINNED_BUN} expected=- unreadable', lines)

    def test_plan_without_a_bun_step_expects_no_bun(self):
        mounted = Mounted(self.base, bun_step=False)
        ready, lines = self.report(mounted, toolchain=True, bun=None)
        self.assertTrue(ready)
        self.assertIn('Toolchain: 0 expected, 0 concordant (no step of this plan runs bun)', lines)

    def cli(self, mounted, *argv):
        stdout = io.StringIO()
        arguments = [str(P), '--target', 'execution-sandbox', '--revision', mounted.refs['execution-sandbox'],
                     '--root', str(mounted.root), *argv]
        with patch.object(self.m, 'load_plan', return_value=mounted.plan), patch.object(sys, 'argv', arguments), \
                patch.object(self.m, 'command', side_effect=self.run_with_bun(PINNED_BUN)), \
                contextlib.redirect_stdout(stdout):
            status = self.m.main()
        return status, stdout.getvalue().splitlines()

    def test_verify_phase_exits_zero_only_on_a_ready_composition(self):
        mounted = Mounted(self.base)
        status, lines = self.cli(mounted, '--phase', 'verify')
        self.assertEqual(status, 0)
        self.assertIn('Composition execution-sandbox: 3 repositories expected, 3 mounted, 3 concordant', lines)
        self.assertIn('Toolchain: 1 expected, 1 concordant', lines)
        commit(mounted.root / 'schemas-and-contracts', 'the sibling head moved past its pin')
        status, lines = self.cli(mounted, '--phase', 'verify')
        self.assertEqual(status, 1)
        self.assertEqual(lines[-1], 'Composition execution-sandbox: NOT READY')

    def test_verify_phase_reports_every_repository_absent_when_nothing_is_mounted(self):
        mounted = Mounted(self.base)
        shutil.rmtree(mounted.root)
        status, lines = self.cli(mounted, '--phase', 'verify')
        self.assertEqual(status, 1)
        self.assertEqual([line.rsplit(' ', 1)[1] for line in lines[1:4]], ['absent'] * 3)
        self.assertIn('Composition execution-sandbox: 3 repositories expected, 0 mounted, 0 concordant', lines)

    def test_missing_root_is_named_and_bun_is_not_reported_missing_for_it(self):
        # Neither the root nor its parent exists; a Bun is installed.
        mounted = Mounted(self.base)
        mounted.root = self.base / 'never' / 'mounted'
        status, lines = self.cli(mounted, '--phase', 'verify')
        self.assertEqual(status, 1)
        self.assertEqual(lines[0], f'Composition root is missing: {mounted.root}')
        self.assertIn(f'bun found={PINNED_BUN} expected=- unreadable', lines)
        self.assertFalse((self.base / 'never').exists())

    def test_verify_phase_writes_nothing(self):
        mounted = Mounted(self.base)
        # A tracked file whose timestamps moved: `git status` then wants to
        # refresh the index on disk, which this phase must not let it do.
        for name in NAMES:
            os.utime(mounted.root / name / 'README.md', (1, 1))
        before = snapshot(mounted.root)
        self.assertEqual(len([name for name in before if name.endswith('.git/index')]), len(NAMES))
        status, lines = self.cli(mounted, '--phase', 'verify')
        self.assertEqual(status, 0, lines)
        self.assertEqual(snapshot(mounted.root), before)

    def test_verify_without_the_receipt_of_prepare_is_not_ready(self):
        mounted = Mounted(self.base, receipt=False)
        ready, lines = self.report(mounted)
        self.assertFalse(ready)
        self.assertIn('Composition execution-sandbox: 3 repositories expected, 3 mounted, 3 concordant', lines)
        self.assertIn(f'receipt {RECEIPT} expected={mounted.fingerprint} absent', lines)
        self.assertEqual(lines[-1], 'Composition execution-sandbox: NOT READY')

    def damaged_receipts(self):
        return {
            'absent': lambda path: path.unlink(),
            'mismatch': lambda path: path.write_text(json.dumps({'planSha256': 'f' * 64}) + '\n'),
            'unreadable': lambda path: path.write_text('{'),
            'unreadable (larger than a receipt)': lambda path: path.write_text(
                json.dumps({'planSha256': path.read_text() * 8})),
            'unreadable (a link)': lambda path: (path.rename(path.with_name('kept')), path.symlink_to('kept')),
        }

    def test_verify_says_ready_only_for_a_composition_the_check_phase_admits(self):
        # The document chains the two: READY, then `--phase check`. Both must
        # read the same receipt, or the first promises what the second refuses.
        cases = {'concordant': lambda path: None, **self.damaged_receipts()}
        for label, damage in cases.items():
            with self.subTest(label), tempfile.TemporaryDirectory() as d:
                mounted = Mounted(pathlib.Path(d).resolve())
                damage(mounted.root / RECEIPT)
                status, lines = self.cli(mounted, '--phase', 'verify')
                self.assertIn(f"receipt {RECEIPT} expected={mounted.fingerprint} {label.split(' (')[0]}", lines)
                self.assertEqual(status == 0, label == 'concordant')
                self.assertEqual(lines[-1].endswith(': READY'), label == 'concordant')
                steps = []

                def run(argv, cwd, timeout, capture=False, stdin=None, real=self.m.command):
                    if argv[0] == 'bun':
                        steps.append(argv)
                        return subprocess.CompletedProcess(argv, 0, '')
                    return real(argv, cwd, timeout, capture, stdin)
                with patch.object(self.m, 'command', side_effect=run):
                    try:
                        self.m.execute(mounted.plan, mounted.root, 'check')
                        admitted = True
                    except (OSError, ValueError):
                        admitted = False
                self.assertEqual(admitted, label == 'concordant')
                self.assertEqual(steps, [['bun', 'run', 'check']] if label == 'concordant' else [])

    def test_checkout_whose_git_directory_is_a_redirection_is_not_read(self):
        # `.git` as a file sends git to another repository: the verdict would
        # be about that one, not about the directory the plan names.
        mounted = Mounted(self.base)
        sibling = mounted.root / 'schemas-and-contracts'
        elsewhere = self.base / 'elsewhere.git'
        (sibling / '.git').rename(elsewhere)
        (sibling / '.git').write_text(f'gitdir: {elsewhere}\n')
        self.assertEqual(git(sibling, 'rev-parse', 'HEAD'), mounted.refs['schemas-and-contracts'])
        ready, lines = self.report(mounted)
        self.assertFalse(ready)
        self.assertIn(f"schemas-and-contracts mounted=- expected={mounted.refs['schemas-and-contracts']} unreadable",
                      lines)

    def test_inherited_git_variables_do_not_move_the_verdict_to_another_tree(self):
        mounted = Mounted(self.base)
        sibling = mounted.root / 'schemas-and-contracts'
        pristine = self.base / 'pristine'
        shutil.copytree(sibling, pristine)
        with (sibling / 'README.md').open('a') as stream:
            stream.write('edited after the mount\n')
        with patch.dict(os.environ, {'GIT_WORK_TREE': str(pristine)}):
            status, lines = self.cli(mounted, '--phase', 'verify')
        self.assertEqual(status, 1)
        self.assertEqual([line.rsplit(' ', 1)[1] for line in lines[:3]], ['concordant', 'modified', 'concordant'])

    def test_children_inherit_no_git_variable(self):
        probe = 'import json, os; print(json.dumps(sorted(k for k in os.environ if k.startswith("GIT_"))))'
        inherited = {'GIT_DIR': '/nowhere', 'GIT_WORK_TREE': '/nowhere', 'GIT_INDEX_FILE': '/nowhere',
                     'GIT_OBJECT_DIRECTORY': '/nowhere', 'GIT_CONFIG_COUNT': '0'}
        with patch.dict(os.environ, inherited):
            seen = json.loads(self.m.command([sys.executable, '-c', probe], self.base, 30, True).stdout)
        self.assertEqual(seen, ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_NO_REPLACE_OBJECTS',
                                'GIT_TERMINAL_PROMPT'])

    def test_tracked_file_hidden_from_status_by_an_index_flag_is_not_concordant(self):
        for flag in ('--skip-worktree', '--assume-unchanged'):
            with self.subTest(flag), tempfile.TemporaryDirectory() as d:
                mounted = Mounted(pathlib.Path(d).resolve())
                governance = mounted.root / 'project-governance'
                git(governance, 'update-index', flag, 'toolchains/bun.json')
                (governance / 'toolchains' / 'bun.json').write_text(json.dumps({'revision': '0.0.0+local'}) + '\n')
                self.assertEqual(git(governance, 'status', '--porcelain'), '')
                ready, lines = self.report(mounted, bun='0.0.0+local')
                self.assertFalse(ready)
                ref = mounted.refs['project-governance']
                self.assertEqual(lines[0], f'project-governance mounted={ref} expected={ref} masked')
                self.assertIn('Composition execution-sandbox: 3 repositories expected, 3 mounted, 2 concordant', lines)
                # The edited pin is not a source: the Bun it names is not the expected one.
                self.assertIn('bun found=0.0.0+local expected=- unreadable', lines)
                self.assertEqual(lines[-1], 'Composition execution-sandbox: NOT READY')

    def test_real_cli_verify_on_an_unmounted_root_exits_one_with_its_counters(self):
        # The fixed manifest, no patch: `database-policy-inspector` composes two repositories.
        root = self.base / 'never-mounted'
        result = subprocess.run([sys.executable, '-B', str(P), '--target', 'database-policy-inspector',
                                 '--revision', 'a' * 40, '--root', str(root), '--phase', 'verify'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn(f"database-policy-inspector mounted=- expected={'a' * 40} absent", result.stdout.splitlines())
        self.assertIn('Composition database-policy-inspector: 2 repositories expected, 0 mounted, 0 concordant',
                      result.stdout.splitlines())
        self.assertFalse(root.exists())

    def test_prepare_phase_prints_the_report_of_what_it_mounted(self):
        mounted = Mounted(self.base)
        origins = self.base / 'origins'
        mounted.root.rename(origins)

        real = self.m.command

        def run(argv, cwd, timeout, capture=False, stdin=None):
            # The fetch is served from the fixture instead of the network; everything else is real git.
            if argv[0] == 'git' and 'fetch' in argv:
                argv = [*argv[:-2], str(origins / cwd.name), argv[-1]]
            return real(argv, cwd, timeout, capture, stdin)
        stdout = io.StringIO()
        arguments = [str(P), '--target', 'execution-sandbox', '--revision', mounted.refs['execution-sandbox'],
                     '--root', str(mounted.root), '--phase', 'prepare']
        with patch.object(self.m, 'load_plan', return_value=mounted.plan), patch.object(sys, 'argv', arguments), \
                patch.object(self.m, 'command', side_effect=run), contextlib.redirect_stdout(stdout):
            status = self.m.main()
        lines = stdout.getvalue().splitlines()
        self.assertEqual(status, 0)
        self.assertEqual(lines[:3], [
            f'{name} mounted={mounted.refs[name]} expected={mounted.refs[name]} concordant' for name in NAMES])
        self.assertIn('Composition execution-sandbox: 3 repositories expected, 3 mounted, 3 concordant', lines)
        # Bun is installed after the mount: this phase must not say READY for it.
        self.assertFalse(any(line.startswith('bun ') or line.endswith('READY') for line in lines))
        self.assertTrue(lines[-1].startswith('Sources of execution-sandbox: MOUNTED'))

    def test_failed_prepare_phase_reports_what_it_left_mounted(self):
        mounted = Mounted(self.base, receipt=False)
        origins = self.base / 'origins'
        mounted.root.rename(origins)
        real = self.m.command

        def run(argv, cwd, timeout, capture=False, stdin=None):
            # The first fetch is served from the fixture, the second one fails.
            if argv[0] == 'git' and 'fetch' in argv:
                if cwd.name != NAMES[0]:
                    raise subprocess.CalledProcessError(128, argv)
                argv = [*argv[:-2], str(origins / cwd.name), argv[-1]]
            return real(argv, cwd, timeout, capture, stdin)
        stdout, stderr = io.StringIO(), io.StringIO()
        arguments = [str(P), '--target', 'execution-sandbox', '--revision', mounted.refs['execution-sandbox'],
                     '--root', str(mounted.root), '--phase', 'prepare']
        with patch.object(self.m, 'load_plan', return_value=mounted.plan), patch.object(sys, 'argv', arguments), \
                patch.object(self.m, 'command', side_effect=run), contextlib.redirect_stdout(stdout), \
                contextlib.redirect_stderr(stderr):
            status = self.m.main()
        lines = stdout.getvalue().splitlines()
        self.assertEqual(status, 1)
        self.assertEqual(stderr.getvalue(), 'Composition refused or failed; no subsequent step executed.\n')
        self.assertEqual(lines[:4], [
            f'{NAMES[0]} mounted={mounted.refs[NAMES[0]]} expected={mounted.refs[NAMES[0]]} concordant',
            f'{NAMES[1]} mounted=- expected={mounted.refs[NAMES[1]]} unreadable',
            f'{NAMES[2]} mounted=- expected={mounted.refs[NAMES[2]]} absent',
            'Composition execution-sandbox: 3 repositories expected, 1 mounted, 1 concordant'])
        self.assertTrue(lines[-1].startswith('Sources of execution-sandbox: NOT MOUNTED'))
        self.assertFalse((mounted.root / RECEIPT).exists())

    def test_sources_off_their_pin_are_not_mounted_when_the_toolchain_is_not_judged(self):
        mounted = Mounted(self.base)
        commit(mounted.root / 'schemas-and-contracts', 'the sibling head moved past its pin')
        ready, lines = self.report(mounted, toolchain=False, bun=None)
        self.assertFalse(ready)
        self.assertTrue(lines[-1].startswith('Sources of execution-sandbox: NOT MOUNTED'))

    def test_root_that_cannot_be_read_is_unreadable_never_absent(self):
        # Python 3.13+ `Path.exists()` answers False on any OSError: a root the
        # caller may not read would be reported as never mounted, and the
        # advice would send them to `prepare`, which refuses a non-empty root.
        mounted = Mounted(self.base)
        mounted.root.chmod(0)
        self.addCleanup(mounted.root.chmod, 0o755)
        try:
            os.listdir(mounted.root)
            self.skipTest('this user reads a directory of mode 000 (superuser): the case cannot be built')
        except PermissionError:
            pass
        status, lines = self.cli(mounted, '--phase', 'verify')
        self.assertEqual(status, 1)
        self.assertTrue(lines[0].startswith(f'Composition root is unreadable: {mounted.root}'), lines)
        self.assertEqual([line.rsplit(' ', 1)[1] for line in lines[1:4]], ['unreadable'] * 3)
        self.assertIn(f'receipt {RECEIPT} expected={mounted.fingerprint} unreadable', lines)
        self.assertFalse(any('writes the receipt it demands' in line for line in lines), lines)
        self.assertEqual(lines[-1], 'Composition execution-sandbox: NOT READY')

    def test_root_that_is_a_regular_file_is_named_not_a_directory(self):
        mounted = Mounted(self.base)
        shutil.rmtree(mounted.root)
        mounted.root.write_text('not a composition\n')
        ready, lines = self.report(mounted)
        self.assertFalse(ready)
        self.assertEqual(lines[0], f'Composition root is not a directory: {mounted.root}')
        self.assertEqual(lines[-1], 'Composition execution-sandbox: NOT READY')

    def test_checkout_that_is_a_link_to_another_clone_is_not_concordant(self):
        # The clone sits at the pinned revision: only the refusal of a link
        # keeps the verdict about the directory the plan names.
        mounted = Mounted(self.base)
        sibling = mounted.root / 'schemas-and-contracts'
        elsewhere = self.base / 'elsewhere'
        git(self.base, 'clone', '--quiet', str(sibling), str(elsewhere))
        self.assertEqual(git(elsewhere, 'rev-parse', 'HEAD'), mounted.refs['schemas-and-contracts'])
        shutil.rmtree(sibling)
        sibling.symlink_to(elsewhere)
        ready, lines = self.report(mounted)
        self.assertFalse(ready)
        self.assertIn(f"schemas-and-contracts mounted=- expected={mounted.refs['schemas-and-contracts']} unreadable",
                      lines)

    def test_fsmonitor_of_a_checkout_is_never_run(self):
        # `core.fsmonitor` in a checkout's own config names a program that
        # `git status` runs: reading a composition must not execute it.
        mounted = Mounted(self.base)
        witness = self.base / 'fsmonitor-ran'
        hook = self.base / 'fsmonitor.sh'
        hook.write_text(f'#!/bin/sh\ntouch {shlex.quote(str(witness))}\n')
        hook.chmod(0o755)
        for name in NAMES:
            git(mounted.root / name, 'config', 'core.fsmonitor', str(hook))
        with self.subTest('report'):
            self.report(mounted)
            self.assertFalse(witness.exists())
        with self.subTest('verify_checkouts'):
            witness.unlink(missing_ok=True)  # each reader is judged on its own calls
            self.m.verify_checkouts(mounted.plan, mounted.root, self.m.command)
            self.assertFalse(witness.exists())

    def mounted_with_pin(self, content):
        mounted = Mounted(self.base)
        governance = mounted.root / 'project-governance'
        (governance / 'toolchains' / 'bun.json').write_bytes(content)
        mounted.plan['checkouts'][0]['ref'] = commit(governance, 'rewrite the pin')
        return mounted

    def test_bun_pin_larger_than_its_bound_is_unreadable(self):
        # Valid JSON of 65537 bytes: read whole by the bounded read, so only
        # the size guard refuses it.
        body = json.dumps({'revision': PINNED_BUN}).encode()
        mounted = self.mounted_with_pin(body + b' ' * (65537 - len(body)))
        self.assertEqual((mounted.root / 'project-governance' / 'toolchains' / 'bun.json').stat().st_size, 65537)
        ready, lines = self.report(mounted)
        self.assertFalse(ready)
        self.assertIn(f'bun found={PINNED_BUN} expected=- unreadable', lines)

    def test_bun_pin_revision_with_a_line_break_is_unreadable(self):
        # A newline in the revision would also split the report line it is printed in.
        mounted = self.mounted_with_pin(json.dumps({'revision': PINNED_BUN + '\n'}).encode())
        ready, lines = self.report(mounted)
        self.assertFalse(ready)
        self.assertIn(f'bun found={PINNED_BUN} expected=- unreadable', lines)

    def test_fixture_helper_ignores_an_inherited_git_dir(self):
        # An inherited GIT_DIR would send the fixtures' init and commits to
        # whichever repository it names.
        decoy = self.base / 'decoy'
        decoy.mkdir()
        git(decoy, 'init', '--quiet')
        fixture = self.base / 'fixture'
        fixture.mkdir()
        with patch.dict(os.environ, {'GIT_DIR': str(decoy / '.git')}):
            git(fixture, 'init', '--quiet')
            (fixture / 'README.md').write_text('fixture\n')
            commit(fixture, 'fixture')
        self.assertEqual(git(decoy, 'rev-list', '--all', '--count'), '0')
        self.assertEqual(git(fixture, 'rev-list', '--all', '--count'), '1')


if __name__ == '__main__':
    unittest.main()
