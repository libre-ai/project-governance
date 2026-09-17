import importlib.util
import json
import os
from pathlib import Path
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

    def test_plan_is_side_effect_free_and_has_nine_roots(self):
        result = self.call('--target', 'all', '--gate', 'root', '--plan')
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        self.assertEqual(len(plan['steps']), 9)
        self.assertEqual(len({x['target'] for x in plan['steps']}), 9)
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

    def test_e2e_plan_preserves_sequential_worker_and_notebook_cwd(self):
        plan=json.loads(self.call('--target','all','--gate','e2e','--plan').stdout)
        self.assertEqual(len(plan['steps']),5)
        self.assertTrue(all(x['argv'][-1]=='--workers=1' for x in plan['steps']))
        notebook=next(x for x in plan['steps'] if x['target']=='personal-knowledge-notebook')
        self.assertEqual(notebook['cwd'],'personal-knowledge-notebook/apps/notebook')
        self.assertFalse(plan['linuxQualificationClaimed'])

    def test_unsupported_gate_refuses_empty_success(self):
        self.assertNotEqual(self.call('--target','travel-itinerary-planner','--gate','native','--plan').returncode,0)

    def test_timeout_stops_child(self):
        spec=importlib.util.spec_from_file_location('checks',SCRIPT)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        self.env['TEST_SLEEP']='1'
        with self.assertRaises(module.CheckFailure):
            module.run_step({'argv':[str(self.tool)],'cwd':'.','target':'synthetic','gate':'root'}, self.root,self.env, timeout=0.05)

if __name__=='__main__': unittest.main()
