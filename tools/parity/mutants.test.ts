import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The red cases of check-parity-audit.test.ts are replayed against mutants
// described in tools/parity/mutants.v1.json, each with the trace of the case it
// must turn red:
//
//   bun tools/quality/mutant.ts run --catalogue tools/parity/mutants.v1.json
//
// That full run copies the repository and is not a step of any check chain.
// This test keeps the catalogue honest between runs: every site must still be
// found exactly once and differ from its anchor (the launcher's --validate), so
// an edit of the gate that moves a decisive line turns this test red instead of
// leaving a catalogue that proves nothing.

const repository = join(import.meta.dir, "..", "..");
const catalogue = join(import.meta.dir, "mutants.v1.json");

test("every mutant site of the parity gate is valid", () => {
  const entries = (JSON.parse(readFileSync(catalogue, "utf8")) as { mutants: unknown[] }).mutants;
  expect(entries.length).toBeGreaterThan(0);
  const result = Bun.spawnSync(
    [
      process.execPath,
      join(repository, "tools", "quality", "mutant.ts"),
      "run",
      "--validate",
      "--catalogue",
      catalogue,
    ],
    { cwd: repository, env: { PATH: process.env.PATH ?? "" } },
  );
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  expect(output).toContain(`sites=${entries.length} valid=${entries.length} invalid=0`);
  expect(result.exitCode).toBe(0);
});
