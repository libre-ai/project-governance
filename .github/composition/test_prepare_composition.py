import importlib.util
import json
from pathlib import Path
import unittest
import subprocess
import sys
import tempfile

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("composition", HERE / "prepare-composition.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CompositionTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((HERE / "manifest.json").read_text())

    def test_source_cycle_is_closed_before_ordered_installs(self):
        plan = module.prepare(self.manifest, "application-development-toolkit")
        names = [row["path"] for row in plan["checkouts"]]
        self.assertIn("ai-work-supervision", names)
        self.assertIn("organization-data-lifecycle", names)
        self.assertEqual(set(names), {"project-governance", "schemas-and-contracts", "ai-work-supervision", "application-development-toolkit", "organization-data-lifecycle", "ai-model-policy"})
        self.assertEqual(len(names), len(set(names)))
        installs = [step["cwd"] for step in plan["install"]]
        self.assertLess(installs.index("project-governance"), installs.index("schemas-and-contracts"))
        self.assertLess(installs.index("ai-work-supervision"), installs.index("application-development-toolkit"))
        self.assertTrue(all(step["argv"][-2:] == ["--frozen-lockfile", "--ignore-scripts"] for step in plan["install"]))

    def test_target_revision_changes_only_target(self):
        before = module.prepare(self.manifest, "execution-sandbox")
        after = module.prepare(self.manifest, "execution-sandbox", "a" * 40)
        differences = [new["path"] for old, new in zip(before["checkouts"], after["checkouts"]) if old != new]
        self.assertEqual(differences, ["execution-sandbox"])

    def test_rejects_unknown_target_branch_ref_and_injected_command(self):
        for target, revision in [("../secret", None), ("unknown", None), ("project-governance", "main"), ("project-governance", "$(touch bad)")]:
            with self.assertRaises(ValueError):
                module.prepare(self.manifest, target, revision)
        self.manifest["repositories"]["project-governance"]["check"] = [["sh", "-c", "anything"]]
        with self.assertRaises(ValueError):
            module.prepare(self.manifest, "project-governance")

    def test_rejects_missing_extra_or_ambiguous_dependency(self):
        for mutation in [lambda m: m["repositories"].pop("schemas-and-contracts"), lambda m: m["repositories"]["execution-sandbox"]["dependencies"].append("../outside"), lambda m: m["repositories"]["execution-sandbox"].update(ref="main")]:
            value = json.loads(json.dumps(self.manifest))
            mutation(value)
            with self.assertRaises(ValueError):
                module.prepare(value, "execution-sandbox")

    def test_all_targets_have_bounded_plans_and_no_recovery_paths(self):
        for target in self.manifest["repositories"]:
            plan = module.prepare(self.manifest, target)
            self.assertLessEqual(len(plan["checkouts"]), 19)
            self.assertEqual(plan["target"], target)
            self.assertNotIn("recovery", json.dumps(plan))
            self.assertTrue(plan["checks"])

    def test_every_product_plan_keeps_local_override_source_closure(self):
        required = {"project-governance", "schemas-and-contracts", "ai-work-supervision", "application-development-toolkit", "organization-data-lifecycle", "ai-model-policy"}
        for target in ("ai-work-supervision", "ai-model-policy", "ai-practice-workbench", "learning-session-facilitation", "personal-knowledge-notebook", "information-feed-filter", "travel-itinerary-planner", "public-vote-comparison", "project-website"):
            names = {row["path"] for row in module.prepare(self.manifest, target)["checkouts"]}
            self.assertEqual(names, required | {target})

    def test_cli_emits_argv_only_and_rejects_duplicate_json(self):
        result = subprocess.run([sys.executable, str(HERE / "prepare-composition.py"), "--target", "database-policy-inspector"], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        self.assertEqual(plan["checks"][-1]["argv"], ["cargo", "test", "--locked"])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text('{"schemaVersion":"a","schemaVersion":"b"}')
            result = subprocess.run([sys.executable, str(HERE / "prepare-composition.py"), "--target", "project-governance", "--manifest", str(path)], capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertEqual(result.stderr.strip(), "Composition rejected")


if __name__ == "__main__":
    unittest.main()
