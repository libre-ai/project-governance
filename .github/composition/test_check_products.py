import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('check-products.py')

class ProductChecks(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'Product check runner must exist')
        self.tmp = tempfile.TemporaryDirectory(prefix='products-runner-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.log = self.root / 'calls.jsonl'
        self.tool = self.root / 'tool'
        self.tool.write_text('#!' + sys.executable + '\nimport os,sys,json,time\nfrom pathlib import Path\nwith Path(os.environ["TEST_LOG"]).open("a") as f: f.write(json.dumps({"args":sys.argv[1:],"cwd":os.getcwd(),"node":os.environ.get("NOTEBOOK_QUALIFICATION_NODE")})+"\\n")\nif os.environ.get("TEST_SLEEP"): time.sleep(10)\nsys.exit(int(os.environ.get("TEST_EXIT","0")))\n')
        self.tool.chmod(0o755)
        self.env = {**os.environ, 'TEST_LOG': str(self.log)}

    def call(self, *args):
        return subprocess.run([sys.executable, '-B', str(SCRIPT), '--root', str(self.root), '--bun', str(self.tool), '--node', str(self.tool), '--cargo', str(self.tool), *args], env=self.env, capture_output=True, text=True, timeout=15)

    def directories(self, target, child=''):
        p = self.root / target / child
        p.mkdir(parents=True, exist_ok=True)
        return p

    def test_plan_is_side_effect_free_and_has_six_roots(self):
        result = self.call('--target', 'all', '--gate', 'root', '--plan')
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        self.assertEqual(len(plan['steps']), 6)
        self.assertEqual(len({x['target'] for x in plan['steps']}), 6)
        self.assertTrue(all(x['argv'][1:] == ['run', 'check'] for x in plan['steps']))
        self.assertFalse(self.log.exists())
        self.assertFalse(plan['executed'])

    def test_unknown_target_and_shell_fragment_are_rejected(self):
        for name in ['../elsewhere', 'project-website;echo unsafe', 'unknown']:
            self.assertNotEqual(self.call('--target', name, '--plan').returncode, 0)
        self.assertFalse(self.log.exists())

    def test_real_subprocess_receives_exact_args_and_cwd(self):
        self.directories('project-website')
        result = self.call('--target', 'project-website', '--gate', 'root')
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [json.loads(x) for x in self.log.read_text().splitlines()]
        self.assertEqual(calls, [{'args':['run','check'],'cwd':str(self.root/'project-website'),'node':str(self.tool)}])
        self.assertTrue(json.loads(result.stdout)['executed'])

    def test_missing_later_directory_prevents_every_child(self):
        self.directories('ai-work-supervision')
        result = self.call('--target', 'all', '--gate', 'root')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.log.exists())

    def test_symlink_repository_is_refused(self):
        other=self.root/'elsewhere';other.mkdir()
        (self.root/'project-website').symlink_to(other, target_is_directory=True)
        self.assertNotEqual(self.call('--target','project-website').returncode,0)
        self.assertFalse(self.log.exists())

    def test_failure_stops_before_second_wasm_command(self):
        self.directories('ai-model-policy')
        self.env['TEST_EXIT']='7'
        result=self.call('--target','ai-model-policy','--gate','wasm')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(len(self.log.read_text().splitlines()),1)

    def test_e2e_plan_preserves_sequential_workers_and_child_cwd(self):
        plan=json.loads(self.call('--target','all','--gate','e2e','--plan').stdout)
        self.assertEqual(
            [(x['target'],x['cwd']) for x in plan['steps']],
            [('ai-work-supervision','ai-work-supervision/packages/auth-web'),('project-website','project-website')],
        )
        self.assertTrue(all(x['argv'][-1]=='--workers=1' for x in plan['steps']))
        self.assertFalse(plan['linuxQualificationClaimed'])

    def test_retired_notebook_browser_gate_is_refused_not_skipped(self):
        # The owner retired the Notebook app and its browser suite on
        # 2026-11-23; the notebook-core-v2 core qualification stays. Asking
        # personal-knowledge-workspace for e2e is a refusal, never an empty
        # success, and its full plan keeps root, native and the core build.
        result=self.call('--target','personal-knowledge-workspace','--gate','e2e','--plan')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('No applicable gate',result.stderr)
        plan=json.loads(self.call('--target','personal-knowledge-workspace','--gate','all','--plan').stdout)
        self.assertEqual([x['gate'] for x in plan['steps']],['root','native','wasm'])
        self.assertEqual(plan['steps'][2]['argv'][1:],['tools/qualification/notebook-core-v2/build.ts'])
        self.assertFalse(any('apps/notebook' in x['cwd'] for x in plan['steps']))

    def test_unsupported_gate_refuses_empty_success(self):
        self.assertNotEqual(self.call('--target','travel-itinerary-planner','--gate','native','--plan').returncode,0)

    def test_action_incremental_default_is_removed_only_for_qualified_builds(self):
        self.directories("ai-model-policy")
        self.directories("personal-knowledge-workspace")
        self.tool.write_text("#!"+sys.executable+"\nimport json,os\nfrom pathlib import Path\nwith Path(os.environ[\"TEST_LOG\"]).open(\"a\") as f: f.write(json.dumps({k:os.environ[k] for k in [\"CARGO_INCREMENTAL\",\"RUSTFLAGS\"] if k in os.environ})+\"\\n\")\n")
        self.env["CARGO_INCREMENTAL"]="0"
        for target,gate in [("ai-model-policy","wasm"),("personal-knowledge-workspace","wasm")]:
            result=self.call("--target",target,"--gate",gate)
            self.assertEqual(result.returncode,0,result.stderr)
        values=[json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertEqual(values,[{}, {}, {}])
        self.assertEqual(self.env["CARGO_INCREMENTAL"],"0")

    def test_unexpected_controls_and_nonbuild_steps_remain_visible(self):
        self.directories("ai-model-policy")
        self.tool.write_text("#!"+sys.executable+"\nimport json,os\nfrom pathlib import Path\nwith Path(os.environ[\"TEST_LOG\"]).open(\"a\") as f: f.write(json.dumps({k:os.environ[k] for k in [\"CARGO_INCREMENTAL\",\"RUSTFLAGS\"] if k in os.environ})+\"\\n\")\n")
        self.env.update({"CARGO_INCREMENTAL":"1","RUSTFLAGS":"unexpected-control"})
        self.assertEqual(self.call("--target","ai-model-policy","--gate","wasm").returncode,0)
        self.env["CARGO_INCREMENTAL"]="0"
        self.assertEqual(self.call("--target","ai-model-policy","--gate","native").returncode,0)
        values=[json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertEqual(values[:2],[{"CARGO_INCREMENTAL":"1","RUSTFLAGS":"unexpected-control"}]*2)
        self.assertEqual(values[2],{"CARGO_INCREMENTAL":"0","RUSTFLAGS":"unexpected-control"})

    def test_timeout_stops_child(self):
        spec=importlib.util.spec_from_file_location('checks',SCRIPT)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        self.env['TEST_SLEEP']='1'
        with self.assertRaises(module.CheckFailure):
            module.run_step({'argv':[str(self.tool)],'cwd':'.','target':'synthetic','gate':'root'}, self.root,self.env, timeout=0.05)


WORKFLOW = Path(__file__).parents[1] / 'workflows' / 'validate-composition.yml'


class WorkflowMatchesRunner(unittest.TestCase):
    """The `if:` of each gate step of validate-composition.yml selects exactly
    the targets for which check-products.py plans that gate.

    A target missing from a step's condition is skipped, and a skipped step
    leaves the job green: without this test, dropping
    personal-knowledge-workspace from the WASM step passed every test.
    A target listed for a gate the runner refuses turns its composition red.
    """

    STEPS = {
        'native': 'Run native product tests',
        'wasm': 'Build and verify current product WASM',
        'e2e': 'Run selected browser suite sequentially',
    }

    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('checks_for_workflow', SCRIPT)
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)
        cls.lines = WORKFLOW.read_text().splitlines()

    def step_targets(self, name):
        # The workflow is read as text: the standard library has no YAML
        # parser, and these steps keep `if:` on the line after `- name:`.
        starts = [i for i, line in enumerate(self.lines) if line.strip() == f'- name: {name}']
        self.assertEqual(len(starts), 1, f'step "{name}" must appear exactly once')
        condition = self.lines[starts[0] + 1].strip()
        self.assertTrue(condition.startswith('if: '), f'step "{name}" has no if: on its next line')
        targets = set(re.findall(r'["\']([a-z][a-z0-9-]*)["\']', condition))
        self.assertTrue(targets, f'no target read in {condition!r}')
        unknown = targets - set(self.module.TARGETS)
        self.assertFalse(unknown, f'step "{name}" names unknown targets {sorted(unknown)}')
        return targets

    def planned(self, gate):
        tools = {'bun': 'bun', 'node': 'node', 'cargo': 'cargo'}
        found = set()
        for target in self.module.TARGETS:
            try:
                self.module.make_plan(target, gate, tools)
            except self.module.CheckFailure:
                continue
            found.add(target)
        return found

    def test_each_gate_step_selects_exactly_the_planned_targets(self):
        for gate, name in self.STEPS.items():
            with self.subTest(gate=gate):
                self.assertEqual(self.step_targets(name), self.planned(gate))

    def test_browser_install_matches_the_suite_and_its_child_directories(self):
        self.assertEqual(
            self.step_targets('Install browsers for the selected product'),
            self.step_targets(self.STEPS['e2e']),
        )
        text = '\n'.join(self.lines)
        children = dict(re.findall(r"^\s+'([a-z][a-z0-9-]*)': '([^']*)',$", text, re.MULTILINE))
        self.assertEqual(children, {target: child for target, (child, _) in self.module.E2E.items()})


if __name__=='__main__': unittest.main()
