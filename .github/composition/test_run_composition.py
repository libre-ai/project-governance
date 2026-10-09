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

    def test_binary_stdin_returns_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            echoed = self.m.command([sys.executable, '-c', 'import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())'],
                                    pathlib.Path(d), 10, stdin=b'\x00\xff')
            self.assertEqual(echoed.stdout, b'\x00\xff')

    def test_two_phases_validate_heads_before_install_and_stop_on_failure(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d).resolve() / 'composition'
            plan = self.m.load_plan('database-policy-inspector', 'a' * 40)
            calls = []
            heads = {row['path']: row['ref'] for row in plan['checkouts']}

            def child(argv, cwd, timeout, capture=False, stdin=None):
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

            def fail(argv, cwd, timeout, capture=False, stdin=None):
                if argv[0] == 'bun':
                    raise subprocess.CalledProcessError(7, argv)
                return child(argv, cwd, timeout, capture, stdin)
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

            def child(argv, cwd, timeout, capture=False, stdin=None):
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


# --- Cargo sibling substitution, exercised on real git checkouts and, where
# the claim is about what cargo resolves, on real cargo. Every fixture is
# offline: the sibling is a `file://` git repository and neither crate has a
# registry dependency, so cargo reads nothing but the two checkouts.

SIBLING = 'schemas-and-contracts/crates/sdk-rs'
PACKAGE = 'libre-ai-contract-types'
GIT_IDENTITY = {'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't',
                'GIT_COMMITTER_EMAIL': 't@t', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'}
IMPOSTOR = 'pub fn origin() -> &\'static str { "IMPOSTOR" }\n'
INSTALL_MARKER = 'install-ran'


def tool(name):
    found = shutil.which(name)
    if found is None:
        raise RuntimeError(f'{name} is required for composition tests')
    return found


def git(cwd, *argv):
    return subprocess.run([tool('git'), *argv], cwd=cwd, check=True, capture_output=True, text=True,
                          env={**os.environ, **GIT_IDENTITY}).stdout.strip()


def commit_all(path):
    if not (path / '.git').exists():
        git(path, 'init', '--quiet')
    git(path, 'add', '-A')
    git(path, 'commit', '--quiet', '--allow-empty', '-m', 'fixture')
    return git(path, 'rev-parse', 'HEAD')


class Composition:
    """A composition root holding a committed sibling and a committed target.

    `target_files` maps target-relative paths to text (or to `('symlink', to)`)
    written beside the default consumer before the target commits; `manifest`
    is appended to the consumer's Cargo.toml after its literal `{url}` and
    `{rev}` are substituted (not `str.format`: TOML inline tables use braces).
    `lock` generates the target's
    Cargo.lock with real cargo before committing it.
    """

    def __init__(self, base, declaration='{{ git = "{url}", rev = "{rev}" }}', manifest='',
                 target_files=None, sibling_files=None, lock=True):
        self.root = base / 'composition'
        self.cargo_home = base / 'cargo-home'
        sibling = self.root / 'schemas-and-contracts'
        (sibling / 'crates' / 'sdk-rs' / 'src').mkdir(parents=True)
        (sibling / 'README.md').write_text('sibling\n')
        (sibling / 'crates' / 'sdk-rs' / 'Cargo.toml').write_text(
            f'[package]\nname = "{PACKAGE}"\nversion = "0.1.0"\nedition = "2021"\n\n[workspace]\n')
        (sibling / 'crates' / 'sdk-rs' / 'src' / 'lib.rs').write_text(
            'pub fn origin() -> &\'static str { "composed" }\n')
        self.write(sibling, sibling_files or {})
        self.rev = commit_all(sibling)
        self.url = 'file://' + str(sibling)
        target = self.target = self.root / 'execution-sandbox'
        (target / 'src').mkdir(parents=True)
        (target / 'Cargo.toml').write_text(
            '[package]\nname = "consumer"\nversion = "0.1.0"\nedition = "2021"\n\n[workspace]\n\n[dependencies]\n'
            + f'{PACKAGE} = {declaration.format(url=self.url, rev=self.rev)}\n' + manifest.replace('{url}', self.url).replace('{rev}', self.rev))
        (target / 'src' / 'main.rs').write_text(
            'fn main() { println!("{}", libre_ai_contract_types::origin()); }\n')
        self.write(target, target_files or {})
        if lock:
            self.cargo(['generate-lockfile', '-q'])
        target_ref = commit_all(target)
        self.plan = {
            'target': 'execution-sandbox',
            'checkouts': [{'path': 'schemas-and-contracts', 'ref': self.rev},
                          {'path': 'execution-sandbox', 'ref': target_ref}],
            'cargoSources': [{'package': PACKAGE, 'repository': 'libre-ai/schemas-and-contracts',
                              'url': self.url, 'rev': self.rev, 'path': SIBLING}],
            'install': [{'argv': [sys.executable, '-c', f'open({INSTALL_MARKER!r}, "w").close()'],
                         'cwd': 'execution-sandbox'}],
            'setup': [],
            'checks': [],
        }

    @staticmethod
    def write(base, files):
        for name, content in files.items():
            path = base / name
            path.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(content, tuple):
                path.symlink_to(content[1])
            else:
                path.write_text(content)

    def env(self):
        return {'CARGO_HOME': str(self.cargo_home)}

    def cargo(self, argv):
        with patch.dict(os.environ, self.env()):
            return subprocess.run([tool('cargo'), *argv], cwd=self.target, check=True, capture_output=True, text=True)

    def check(self, runner):
        """Run the check phase from a valid receipt, with real git and real cargo."""
        (self.root / '.composition-state.json').write_text(json.dumps({'planSha256': runner.fingerprint(self.plan)}) + '\n')
        with patch.dict(os.environ, self.env()), patch('sys.stdout') as out:
            runner.execute(self.plan, self.root, 'check')
        return ''.join(call.args[0] for call in out.write.call_args_list)

    def install_ran(self):
        return (self.target / INSTALL_MARKER).exists()


class CargoSourceTests(unittest.TestCase):

    def setUp(self):
        spec = importlib.util.spec_from_file_location('runner', P)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        self.base = pathlib.Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()

    def refused(self, composition, message):
        with self.assertRaisesRegex(ValueError, message):
            composition.check(self.m)
        self.assertFalse(composition.install_ran())

    def test_plan_fingerprint_covers_cargo_sources(self):
        plan = self.m.load_plan('execution-sandbox', 'a' * 40)
        moved = json.loads(json.dumps(plan))
        moved['cargoSources'][0]['rev'] = 'b' * 40
        self.assertNotEqual(self.m.fingerprint(plan), self.m.fingerprint(moved))

    def test_real_cargo_compiles_the_committed_sibling_and_says_so(self):
        composition = Composition(self.base)
        printed = composition.check(self.m)
        self.assertIn('Cargo sibling substitution verified: 1 package(s) from composed checkout(s)', printed)
        self.assertTrue(composition.install_ran())
        config = (composition.root / '.cargo' / 'config.toml').read_text()
        self.assertIn(f'[source."composition-{PACKAGE}"]\ngit = "{composition.url}"\nrev = "{composition.rev}"\n'
                      'replace-with = "composition-siblings"', config)
        self.assertIn(f'directory = "{composition.root / ".cargo-sources"}"', config)
        farm = composition.root / '.cargo-sources' / PACKAGE
        self.assertEqual(json.loads((farm / '.cargo-checksum.json').read_text()), {'files': {}, 'package': None})
        written = sorted(p.relative_to(farm).as_posix() for p in farm.rglob('*') if not p.is_dir())
        self.assertEqual(written, ['.cargo-checksum.json', 'Cargo.toml', 'src/lib.rs'])
        self.assertFalse(any(p.is_symlink() for p in farm.rglob('*')))
        for checkout in composition.plan['checkouts']:
            self.assertEqual(git(composition.root / checkout['path'], 'status', '--porcelain'),
                             '?? install-ran' if checkout['path'] == 'execution-sandbox' else '')
        built = composition.cargo(['run', '-q', '--locked'])
        self.assertEqual(built.stdout.strip(), 'composed')

    def test_target_config_with_only_an_alias_is_accepted(self):
        # artifact-verification commits exactly this shape.
        composition = Composition(self.base, target_files={'.cargo/config.toml': '[alias]\ncov = "llvm-cov"\n'})
        self.assertIn('Cargo sibling substitution verified', composition.check(self.m))

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
        for index, (label, declaration) in enumerate(declarations.items()):
            with self.subTest(label):
                composition = Composition(self.base / str(index), declaration=declaration, lock=False)
                self.refused(composition, 'Cargo source pin differs from the composed revision')
                self.assertFalse((composition.root / '.cargo').exists())

    # e_patch: a committed `vendor/fake` whose Cargo.toml is a symlink to the
    # sibling's, beside an impostor src/lib.rs, wired by `[patch.<url>]`.
    PATCH_FAKE = {'vendor/fake/Cargo.toml': ('symlink', '../../../schemas-and-contracts/crates/sdk-rs/Cargo.toml'),
                  'vendor/fake/src/lib.rs': IMPOSTOR}

    def test_patch_onto_a_symlinked_impostor_refuses(self):
        composition = Composition(self.base, manifest='\n[patch."{url}"]\n' + PACKAGE + ' = { path = "vendor/fake" }\n',
                                  target_files=self.PATCH_FAKE)
        self.assertEqual(composition.cargo(['run', '-q', '--locked']).stdout.strip(), 'IMPOSTOR')
        self.refused(composition, 'Cargo target overrides the composed package')

    def test_post_measure_alone_refuses_the_symlinked_impostor(self):
        # The override refusal is disabled to prove the post-measure on its
        # own terms, with cargo's real answer: it compared resolved paths, and
        # the symlink resolved to the sibling's Cargo.toml.
        composition = Composition(self.base, manifest='\n[patch."{url}"]\n' + PACKAGE + ' = { path = "vendor/fake" }\n',
                                  target_files=self.PATCH_FAKE)
        with patch.object(self.m, 'refuse_target_overrides'):
            self.refused(composition, 'Cargo resolved a source other than the composed checkout')

    # e_config: the target's own `.cargo/config.toml` redefines the directory
    # source the runner's configuration names; cargo prefers the deeper file.
    CONFIG_FAKE = {'.cargo/config.toml': '[source.composition-siblings]\ndirectory = "vendor"\n',
                   f'vendor/{PACKAGE}/Cargo.toml': ('symlink', '../../../schemas-and-contracts/crates/sdk-rs/Cargo.toml'),
                   f'vendor/{PACKAGE}/src/lib.rs': IMPOSTOR,
                   f'vendor/{PACKAGE}/.cargo-checksum.json': '{"files":{},"package":null}'}

    def test_target_cargo_config_redirecting_a_source_refuses(self):
        self.refused(Composition(self.base, target_files=self.CONFIG_FAKE),
                     'Target cargo configuration redirects a source')

    def test_post_measure_alone_refuses_a_target_directory_source(self):
        composition = Composition(self.base, target_files=self.CONFIG_FAKE)
        with patch.object(self.m, 'refuse_target_cargo_config'):
            self.refused(composition, 'Cargo resolved a source other than the composed checkout')

    def test_every_source_redirecting_config_key_refuses_at_any_depth(self):
        configs = {
            'patch': ('.cargo/config.toml', '[patch."https://example.invalid/x"]\nx = { path = "x" }\n'),
            'paths': ('.cargo/config', 'paths = ["vendor/x"]\n'),
            'include': ('.cargo/config.toml', 'include = ["other.toml"]\n'),
            'nested source': ('crates/inner/.cargo/config.toml', '[source.x]\ndirectory = "y"\n'),
            'case-folded name': ('.Cargo/Config.toml', '[source.x]\ndirectory = "y"\n'),
        }
        for index, (label, (name, text)) in enumerate(configs.items()):
            with self.subTest(label):
                composition = Composition(self.base / str(index), target_files={name: text}, lock=False)
                self.refused(composition, 'Target cargo configuration redirects a source')

    # e_direct: `[patch]`/`[replace]` naming the package with a path onto the
    # sibling's live working tree.
    def test_patch_onto_the_sibling_working_tree_refuses(self):
        composition = Composition(self.base, manifest='\n[patch."{url}"]\n' + PACKAGE
                                  + ' = { path = "../schemas-and-contracts/crates/sdk-rs" }\n')
        self.refused(composition, 'Cargo target overrides the composed package')

    def test_post_measure_alone_refuses_the_sibling_working_tree(self):
        composition = Composition(self.base, manifest='\n[patch."{url}"]\n' + PACKAGE
                                  + ' = { path = "../schemas-and-contracts/crates/sdk-rs" }\n')
        with patch.object(self.m, 'refuse_target_overrides'):
            self.refused(composition, 'Cargo resolved a source other than the composed checkout')

    def test_every_override_naming_the_package_refuses(self):
        overrides = {
            'patch by name': '\n[patch.crates-io]\n' + PACKAGE + ' = { path = "x" }\n',
            'patch renamed by package': '\n[patch."{url}"]\nalias = { path = "x", package = "' + PACKAGE + '" }\n',
            'replace by spec': '\n[replace]\n"' + PACKAGE + ':0.1.0" = { path = "x" }\n',
            'replace by url spec': '\n[replace]\n"{url}#' + PACKAGE + '@0.1.0" = { git = "{url}", rev = "' + 'b' * 40 + '" }\n',
            'replace renamed by package': '\n[replace]\n"other:0.1.0" = { path = "x", package = "' + PACKAGE + '" }\n',
        }
        for index, (label, manifest) in enumerate(overrides.items()):
            with self.subTest(label):
                composition = Composition(self.base / str(index), manifest=manifest, lock=False)
                self.refused(composition, 'Cargo target overrides the composed package')

    def test_unrelated_patch_is_accepted(self):
        self.m.refuse_target_overrides({'patch': {'crates-io': {'serde': {'path': 'x'}}},
                                        'replace': {'serde:1.0.0': {'path': 'y'}}}, PACKAGE)

    # e_untracked2: an untracked build.rs in the sibling's working tree ran,
    # because the symlink farm linked every entry of the live directory.
    def test_untracked_sibling_files_are_never_compiled(self):
        composition = Composition(self.base)
        marker = self.base / 'MARKER'
        crate = composition.root / SIBLING
        (crate / 'build.rs').write_text(f'fn main() {{ std::fs::write({str(marker)!r}, "ran").unwrap(); }}\n'.replace("'", '"'))
        (crate / 'src' / 'extra.rs').write_text('')
        composition.check(self.m)
        farm = composition.root / '.cargo-sources' / PACKAGE
        self.assertFalse((farm / 'build.rs').exists())
        self.assertFalse((farm / 'src' / 'extra.rs').exists())
        with patch.dict(os.environ, composition.env()):
            subprocess.run([tool('cargo'), 'build', '-q', '--locked'], cwd=composition.target, check=True)
        self.assertFalse(marker.exists())

    def test_post_measure_refuses_a_stale_lockfile(self):
        # Without --locked, `cargo metadata` would resolve afresh and rewrite
        # the committed Cargo.lock, measuring a graph the target never pinned.
        composition = Composition(self.base)
        target = composition.target
        lock = (target / 'Cargo.lock').read_text()
        (target / 'helper' / 'src').mkdir(parents=True)
        (target / 'helper' / 'Cargo.toml').write_text('[package]\nname = "helper"\nversion = "0.1.0"\nedition = "2021"\n')
        (target / 'helper' / 'src' / 'lib.rs').write_text('')
        with (target / 'Cargo.toml').open('a') as stream:
            stream.write('helper = { path = "helper" }\n')
        composition.plan['checkouts'][1]['ref'] = commit_all(target)
        with self.assertRaises(subprocess.CalledProcessError):
            composition.check(self.m)
        self.assertEqual((target / 'Cargo.lock').read_text(), lock)
        self.assertFalse(composition.install_ran())

    def test_a_replace_ref_in_the_sibling_is_not_followed(self):
        # `refs/replace/<blob>` makes git answer the committed blob id with
        # other content; the materialised tree must still be the commit's.
        composition = Composition(self.base)
        crate = composition.root / SIBLING
        committed = git(crate, 'rev-parse', 'HEAD:crates/sdk-rs/src/lib.rs')
        impostor = subprocess.run([tool('git'), 'hash-object', '-w', '--stdin'], cwd=crate, input=IMPOSTOR,
                                  check=True, capture_output=True, text=True).stdout.strip()
        git(crate, 'replace', committed, impostor)
        self.assertIn('IMPOSTOR', git(crate, 'cat-file', '-p', committed))
        composition.check(self.m)
        farm = composition.root / '.cargo-sources' / PACKAGE
        self.assertIn('"composed"', (farm / 'src' / 'lib.rs').read_text())

    def test_committed_symlink_in_the_sibling_refuses(self):
        composition = Composition(self.base, sibling_files={'crates/sdk-rs/src/link.rs': ('symlink', 'lib.rs')})
        self.refused(composition, 'Cargo sibling source holds a symlink or a submodule')

    def test_committed_checksum_file_in_the_sibling_refuses(self):
        composition = Composition(self.base, sibling_files={'crates/sdk-rs/.cargo-checksum.json': '{}'})
        self.refused(composition, 'already carries a checksum file')

    def test_wrong_sibling_package_refuses(self):
        composition = Composition(self.base, lock=False)
        crate = composition.root / SIBLING
        (crate / 'Cargo.toml').write_text('[package]\nname = "impostor"\nversion = "0.1.0"\n')
        git(crate, 'commit', '--quiet', '-am', 'rename')
        composition.plan['checkouts'][0]['ref'] = git(crate, 'rev-parse', 'HEAD')
        self.refused(composition, 'not the declared package')

    def test_configure_dirtying_a_tracked_sibling_file_refuses_before_install(self):
        composition = Composition(self.base)
        original = self.m.configure_cargo_sources

        def dirtying(plan, root, run):
            verified = original(plan, root, run)
            with (root / 'schemas-and-contracts' / 'README.md').open('a') as stream:
                stream.write('changed during configure\n')
            return verified
        with patch.object(self.m, 'configure_cargo_sources', side_effect=dirtying):
            self.refused(composition, 'Composition tracked inputs changed')

    def test_post_measure_judges_rows_as_written(self):
        composition = Composition(self.base, lock=False)
        farm = composition.root / '.cargo-sources' / PACKAGE / 'Cargo.toml'
        good = {'name': PACKAGE, 'manifest_path': str(farm),
                'id': f'git+{composition.url}?rev={composition.rev}#{PACKAGE}@0.1.0'}
        rows = {
            'path id at the farm path': [{**good, 'id': f'path+file://{farm.parent}#{PACKAGE}@0.1.0'}],
            'git id at another rev': [{**good, 'id': f'git+{composition.url}?rev={"b" * 40}#{PACKAGE}@0.1.0'}],
            'two packages of that name': [good, {**good, 'manifest_path': str(composition.target / 'x' / 'Cargo.toml')}],
            'two packages, the composed one last': [{**good, 'manifest_path': str(composition.target / 'x' / 'Cargo.toml')},
                                                    good],
            'absent': [],
            'symlink resolving to the farm': [{**good, 'manifest_path': str(composition.target / 'link' / 'Cargo.toml')}],
        }
        (composition.target / 'link').symlink_to(farm.parent, target_is_directory=True)
        for label, packages in rows.items():
            with self.subTest(label):
                shutil.rmtree(composition.root / '.cargo-sources', ignore_errors=True)
                shutil.rmtree(composition.root / '.cargo', ignore_errors=True)

                def run(argv, cwd, timeout, capture=False, stdin=None):
                    if argv[0] == 'cargo':
                        return subprocess.CompletedProcess(argv, 0, json.dumps({'packages': packages}))
                    return self.m.command(argv, cwd, timeout, capture, stdin)
                with self.assertRaisesRegex(ValueError, 'Cargo resolved a source other than the composed checkout'):
                    self.m.configure_cargo_sources(composition.plan, composition.root, run)


if __name__ == '__main__':
    unittest.main()
