# SPDX-License-Identifier: EUPL-1.2
import importlib.util, pathlib, tempfile, unittest, subprocess, sys, json, os, shutil
from unittest.mock import patch
P = pathlib.Path(__file__).with_name('run-composition.py').resolve()

class RunnerTests(unittest.TestCase):

    def setUp(self):
        spec = importlib.util.spec_from_file_location('runner', P)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)

    def test_invalid_input_has_no_effect(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d).resolve() / 'new'
            with self.assertRaises(ValueError):
                self.m.load_plan('unknown', 'a' * 40)
            self.assertFalse(root.exists())

    def test_root_rejects_nonempty_and_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d).resolve()
            (root / 'keep').write_text('keep')
            with self.assertRaises(ValueError):
                self.m.validate_root(root, 'prepare')
            link = root / 'link'
            link.symlink_to(root, target_is_directory=True)
            with self.assertRaises(ValueError):
                self.m.validate_root(link, 'prepare')
            self.assertEqual((root / 'keep').read_text(), 'keep')

    def test_plan_is_bound_to_fixed_manifest_and_exact_revision(self):
        plan = self.m.load_plan('database-policy-inspector', 'a' * 40)
        self.assertEqual(plan['checkouts'][-1]['ref'], 'a' * 40)
        self.assertTrue(all((x['repository'].startswith('libre-ai/') for x in plan['checkouts'])))

    def test_real_child_failure_and_timeout_refuse(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(subprocess.CalledProcessError):
                self.m.command([sys.executable, '-c', 'raise SystemExit(7)'], pathlib.Path(d), 10)
            with self.assertRaises(subprocess.TimeoutExpired):
                self.m.command([sys.executable, '-c', 'import time;time.sleep(5)'], pathlib.Path(d), 0.01)

    def test_two_phases_validate_heads_before_install_and_stop_on_failure(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d).resolve() / 'composition'
            plan = self.m.load_plan('database-policy-inspector', 'a' * 40)
            calls = []
            heads = {row['path']: row['ref'] for row in plan['checkouts']}

            def child(argv, cwd, timeout, capture=False):
                calls.append(argv)
                if argv[:3] == ['git', 'rev-parse', 'HEAD']:
                    return subprocess.CompletedProcess(argv, 0, heads[cwd.name])
                return subprocess.CompletedProcess(argv, 0, '')
            with patch.object(self.m, 'command', side_effect=child):
                self.m.execute(plan, root, 'prepare')
            self.assertTrue((root / '.composition-state.json').is_file())
            self.assertTrue(any(('fetch' in argv and argv[-1] == 'a' * 40 for argv in calls)))
            calls.clear()
            heads['database-policy-inspector'] = 'b' * 40
            with patch.object(self.m, 'command', side_effect=child), self.assertRaises(ValueError):
                self.m.execute(plan, root, 'check')
            self.assertFalse(any((argv[0] in ['bun', 'cargo'] for argv in calls)))
            heads['database-policy-inspector'] = 'a' * 40
            calls.clear()

            def fail(argv, cwd, timeout, capture=False):
                if argv[0] == 'bun':
                    raise subprocess.CalledProcessError(7, argv)
                return child(argv, cwd, timeout, capture)
            with patch.object(self.m, 'command', side_effect=fail), self.assertRaises(subprocess.CalledProcessError):
                self.m.execute(plan, root, 'check')
            self.assertFalse(any((argv[0] == 'cargo' for argv in calls)))

    def test_cli_plan_has_no_filesystem_effect(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d).resolve() / 'new'
            result = subprocess.run([sys.executable, str(P), '--target', 'database-policy-inspector', '--revision', 'a' * 40, '--root', str(root), '--plan'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout)['target'], 'database-policy-inspector')
            self.assertFalse(root.exists())

    def test_tracked_mutation_during_check_refuses_success(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d).resolve() / 'composition'
            plan = self.m.load_plan('database-policy-inspector', 'a' * 40)
            mutated = False
            heads = {row['path']: row['ref'] for row in plan['checkouts']}

            def child(argv, cwd, timeout, capture=False):
                nonlocal mutated
                if argv[:3] == ['git', 'rev-parse', 'HEAD']:
                    return subprocess.CompletedProcess(argv, 0, heads[cwd.name])
                if argv[:2] == ['git', 'status']:
                    return subprocess.CompletedProcess(argv, 0, ' M source.rs\n' if mutated else '')
                if argv[0] == 'cargo':
                    mutated = True
                return subprocess.CompletedProcess(argv, 0, '')
            with patch.object(self.m, 'command', side_effect=child):
                self.m.execute(plan, root, 'prepare')
            with patch.object(self.m, 'command', side_effect=child), self.assertRaises(ValueError):
                self.m.execute(plan, root, 'check')

    def test_actual_git_allows_generated_files_but_refuses_tracked_drift(self):
        git = shutil.which('git')
        if git is None:
            raise RuntimeError('Git is required for composition tests')
        source = P.parents[2]
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d).resolve()
            checkout = root / 'project-governance'
            subprocess.run([git, 'clone', '--quiet', '--no-hardlinks', '--no-local', str(source), str(checkout)], check=True)
            head = subprocess.check_output([git, 'rev-parse', 'HEAD'], cwd=checkout, text=True).strip()
            plan = {'checkouts': [{'path': 'project-governance', 'ref': head}]}
            with patch.dict(os.environ, {'PATH': str(pathlib.Path(git).parent) + os.pathsep + os.environ['PATH']}):
                (checkout / 'generated-untracked.txt').write_text('generated')
                self.m.verify_checkouts(plan, root, self.m.command)
                with (checkout / 'README.md').open('a') as stream:
                    stream.write('tracked mutation')
                with self.assertRaises(ValueError):
                    self.m.verify_checkouts(plan, root, self.m.command)
if __name__ == '__main__':
    unittest.main()
