# SPDX-License-Identifier: EUPL-1.2
"""The readiness report of a mounted composition, exercised on real git checkouts.

Every expected value below is written by the fixture (the revision a checkout
is committed at, the revision the plan pins), never copied from the report.
"""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
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
    env = {key: value for key, value in os.environ.items() if key != 'GIT_NO_REPLACE_OBJECTS'}
    return subprocess.run([found, *argv], cwd=cwd, check=True, capture_output=True, text=True,
                          env={**env, **GIT_IDENTITY}).stdout.strip()


def commit(path, message):
    git(path, 'add', '-A')
    git(path, 'commit', '--quiet', '--allow-empty', '-m', message)
    return git(path, 'rev-parse', 'HEAD')


class Mounted:
    """Three committed checkouts and the plan that pins each at its own head."""

    def __init__(self, base, bun_step=True):
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
                if revision is None:
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
        self.assertEqual([line.rsplit(' ', 1)[1] for line in lines[:3]], ['absent'] * 3)
        self.assertIn('Composition execution-sandbox: 3 repositories expected, 0 mounted, 0 concordant', lines)

    def test_verify_phase_writes_nothing(self):
        mounted = Mounted(self.base)
        before = sorted(str(path) for path in mounted.root.rglob('*') if '.git' not in path.parts)
        self.cli(mounted, '--phase', 'verify')
        self.assertEqual(sorted(str(path) for path in mounted.root.rglob('*') if '.git' not in path.parts), before)

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

    def test_sources_off_their_pin_are_not_mounted_when_the_toolchain_is_not_judged(self):
        mounted = Mounted(self.base)
        commit(mounted.root / 'schemas-and-contracts', 'the sibling head moved past its pin')
        ready, lines = self.report(mounted, toolchain=False, bun=None)
        self.assertFalse(ready)
        self.assertTrue(lines[-1].startswith('Sources of execution-sandbox: NOT MOUNTED'))


if __name__ == '__main__':
    unittest.main()
