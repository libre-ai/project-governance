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

SIBLING = 'schemas-and-contracts/crates/sdk-rs'
PACKAGE = 'libre-ai-contract-types'
URL = 'https://github.com/libre-ai/schemas-and-contracts'


def write_crates(root, plan, declaration):
    source = plan['cargoSources'][0]
    crate = root / SIBLING
    (crate / 'src').mkdir(parents=True, exist_ok=True)
    (crate / 'Cargo.toml').write_text(f'[package]\nname = "{PACKAGE}"\nversion = "0.1.0"\n\n[workspace]\n')
    (crate / 'src' / 'lib.rs').write_text('')
    target = root / plan['target']
    target.mkdir(exist_ok=True)
    (target / 'Cargo.toml').write_text(
        '[package]\nname = "consumer"\nversion = "0.1.0"\n\n[dependencies]\n'
        + f'{PACKAGE} = {declaration.format(url=URL, rev=source["rev"])}\n')


class CargoSourceTests(unittest.TestCase):

    def setUp(self):
        spec = importlib.util.spec_from_file_location('runner', P)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        self.plan = self.m.load_plan('execution-sandbox', 'a' * 40)
        self.heads = {row['path']: row['ref'] for row in self.plan['checkouts']}

    def child(self, calls, manifest_path):
        def run(argv, cwd, timeout, capture=False):
            calls.append(argv)
            if argv[:3] == ['git', 'rev-parse', 'HEAD']:
                return subprocess.CompletedProcess(argv, 0, self.heads[cwd.name])
            if argv[:2] == ['cargo', 'metadata']:
                return subprocess.CompletedProcess(argv, 0, json.dumps({'packages': [
                    {'name': 'consumer', 'manifest_path': str(cwd / 'Cargo.toml')},
                    {'name': PACKAGE, 'manifest_path': str(manifest_path(cwd.parent))},
                ]}))
            return subprocess.CompletedProcess(argv, 0, '')
        return run

    def prepared(self, d, declaration):
        root = pathlib.Path(d).resolve() / 'composition'
        calls = []
        with patch.object(self.m, 'command', side_effect=self.child(calls, lambda r: r)):
            self.m.execute(self.plan, root, 'prepare')
        write_crates(root, self.plan, declaration)
        return root

    def test_plan_fingerprint_covers_cargo_sources(self):
        moved = json.loads(json.dumps(self.plan))
        moved['cargoSources'][0]['rev'] = 'b' * 40
        self.assertNotEqual(self.m.fingerprint(self.plan), self.m.fingerprint(moved))

    def test_every_pin_other_than_the_composed_rev_refuses_before_any_install(self):
        declarations = {
            'other revision': '{{ version = "=0.1.0", git = "{url}", rev = "d2767988c7b1a00b304b76c5d5ac92b93898bf30" }}',
            'sibling path': '{{ version = "=0.1.0", path = "../schemas-and-contracts/crates/sdk-rs" }}',
            'path beside git': '{{ git = "{url}", rev = "{rev}", path = "../schemas-and-contracts/crates/sdk-rs" }}',
            'branch': '{{ git = "{url}", branch = "migrate/recover-code" }}',
            'branch beside rev': '{{ git = "{url}", rev = "{rev}", branch = "x" }}',
            'short sha': '{{ git = "{url}", rev = "4f3d53c3" }}',
            'other url': '{{ git = "{url}.git", rev = "{rev}" }}',
            'registry version': '"=0.1.0"',
        }
        for label, declaration in declarations.items():
            with self.subTest(label), tempfile.TemporaryDirectory() as d:
                root = self.prepared(d, declaration)
                calls = []
                with patch.object(self.m, 'command', side_effect=self.child(calls, lambda r: r)), \
                        self.assertRaisesRegex(ValueError, 'Cargo source pin differs from the composed revision'):
                    self.m.execute(self.plan, root, 'check')
                self.assertFalse(any(argv[0] in ('bun', 'cargo') for argv in calls))
                self.assertFalse((root / '.cargo').exists())

    def test_substitution_is_written_outside_checkouts_and_measured(self):
        with tempfile.TemporaryDirectory() as d:
            root = self.prepared(d, '{{ version = "=0.1.0", git = "{url}", rev = "{rev}" }}')
            calls = []
            farm = lambda r: r / '.cargo-sources' / PACKAGE / 'Cargo.toml'
            with patch.object(self.m, 'command', side_effect=self.child(calls, farm)), \
                    patch('sys.stdout') as out:
                self.m.execute(self.plan, root, 'check')
            printed = ''.join(call.args[0] for call in out.write.call_args_list)
            self.assertIn('Cargo sibling substitution verified: 1 package(s) from composed checkout(s)', printed)
            metadata = next(i for i, argv in enumerate(calls) if argv[:2] == ['cargo', 'metadata'])
            self.assertIn('--locked', calls[metadata])
            self.assertLess(metadata, next(i for i, argv in enumerate(calls) if argv[0] == 'bun'))
            config = (root / '.cargo' / 'config.toml').read_text()
            rev = self.plan['cargoSources'][0]['rev']
            self.assertIn(f'[source."composition-{PACKAGE}"]\ngit = "{URL}"\nrev = "{rev}"\nreplace-with = "composition-siblings"', config)
            self.assertIn(f'directory = "{root / ".cargo-sources"}"', config)
            self.assertEqual(json.loads((root / '.cargo-sources' / PACKAGE / '.cargo-checksum.json').read_text()), {'files': {}, 'package': None})
            self.assertEqual((root / '.cargo-sources' / PACKAGE / 'Cargo.toml').resolve(), (root / SIBLING / 'Cargo.toml').resolve())
            for checkout in self.plan['checkouts']:
                self.assertFalse((root / checkout['path'] / '.cargo').exists())

    def test_cargo_resolving_its_own_git_checkout_refuses(self):
        # The silent fallback: a replacement that does not match falls back to
        # the network copy under CARGO_HOME. Only the post-measure catches it.
        with tempfile.TemporaryDirectory() as d:
            root = self.prepared(d, '{{ git = "{url}", rev = "{rev}" }}')
            calls = []
            fetched = lambda r: pathlib.Path.home() / '.cargo' / 'git' / 'checkouts' / 'schemas-and-contracts-0123' / '4f3d53c' / 'crates' / 'sdk-rs' / 'Cargo.toml'
            with patch.object(self.m, 'command', side_effect=self.child(calls, fetched)), \
                    self.assertRaisesRegex(ValueError, 'Cargo resolved a source other than the composed checkout'):
                self.m.execute(self.plan, root, 'check')
            self.assertFalse(any(argv[0] == 'bun' for argv in calls))

    def test_wrong_sibling_package_refuses(self):
        with tempfile.TemporaryDirectory() as d:
            root = self.prepared(d, '{{ git = "{url}", rev = "{rev}" }}')
            (root / SIBLING / 'Cargo.toml').write_text('[package]\nname = "impostor"\nversion = "0.1.0"\n')
            with patch.object(self.m, 'command', side_effect=self.child([], lambda r: r)), \
                    self.assertRaisesRegex(ValueError, 'not the declared package'):
                self.m.execute(self.plan, root, 'check')

    def test_actual_git_sees_no_tracked_change_after_substitution(self):
        git = shutil.which('git')
        if git is None:
            raise RuntimeError('Git is required for composition tests')
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d).resolve()
            write_crates(root, self.plan, '{{ git = "{url}", rev = "{rev}" }}')
            refs = {}
            for path in ('schemas-and-contracts', 'execution-sandbox'):
                env = {'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t'}
                for argv in (['init', '--quiet'], ['add', '.'], ['commit', '--quiet', '-m', 'fixture']):
                    subprocess.run([git, *argv], cwd=root / path, check=True, env={**os.environ, **env})
                refs[path] = subprocess.check_output([git, 'rev-parse', 'HEAD'], cwd=root / path, text=True).strip()
            plan = {**self.plan, 'checkouts': [{'path': p, 'ref': r} for p, r in refs.items()]}

            def run(argv, cwd, timeout, capture=False):
                if argv[0] == 'cargo':
                    return subprocess.CompletedProcess(argv, 0, json.dumps({'packages': [
                        {'name': PACKAGE, 'manifest_path': str(root / '.cargo-sources' / PACKAGE / 'Cargo.toml')}]}))
                return self.m.command(argv, cwd, timeout, capture)
            with patch('sys.stdout'):
                self.assertEqual(self.m.configure_cargo_sources(plan, root, run), 1)
            self.m.verify_checkouts(plan, root, self.m.command)
            for path in refs:
                status = subprocess.check_output([git, 'status', '--porcelain'], cwd=root / path, text=True)
                self.assertEqual(status, '')


if __name__ == '__main__':
    unittest.main()
