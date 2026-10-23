import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// End-to-end: `check:cards` as the CI runs it, over a repository holding one
// card. The gate scans `ecosystem/cards/*.project.v1.yaml` from its working
// directory, so each case builds that directory from nothing and runs the
// entry point there, with an environment that inherits nothing.

const GATE = join(import.meta.dir, "validate-cards.ts");
const roots: string[] = [];

const CARD = `schema_version: libre-ai.project.v1
project: envelope
repository: libre-ai/envelope
kind: satellite
layer: couche-3
statement:
  for: les constructeurs d'applications de la constellation
  who_faces: du contenu non fiable injecté dans les prompts de leurs agents
  enables: marquer et vérifier l'intégrité de tout contenu non fiable
  producing:
    - une enveloppe signée vérifiable hors ligne
  without_depending_on:
    - aucun service tiers
summary: Enveloppe d'intégrité du contenu non fiable (noyau K3).
current_situation: Contrat envelope-v1 verrouillé, consommé par le fan-out de revue.
scope:
  - escape des délimiteurs
non_goals:
  - le chiffrement du contenu
dependencies: []
maturity: usable
confidence: high
exposure: usable-verifiable
freshness:
  last_verified_on: "2026-07-29"
scope_stability: stable
phases:
  - id: extraction
    title: Extraction en repo satellite
    exit_criteria:
      - id: gates-green
        text: Le gabarit CI de governance est vert sur le contenu migré.
        weight: 7
        status: pending
`;

function repositoryWith(card: string): string {
  const root = mkdtempSync(join(tmpdir(), "validate-cards-"));
  roots.push(root);
  mkdirSync(join(root, "ecosystem", "cards"), { recursive: true });
  writeFileSync(join(root, "ecosystem", "cards", "envelope.project.v1.yaml"), card);
  return root;
}

function run(root: string) {
  const result = Bun.spawnSync([process.execPath, GATE], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: "" },
  });
  return {
    exitCode: result.exitCode,
    output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("check:cards — desktop shell ceiling (ADR-0057 §4)", () => {
  test("a card without a shell passes and the volume says no shell was declared", () => {
    const { exitCode, output } = run(repositoryWith(CARD));
    expect(exitCode).toBe(0);
    expect(output).toContain("1 card(s) read");
    expect(output).toContain("0 declare a desktop shell");
  });

  test("a Tauri shell with its ceiling passes and is counted", () => {
    const shell = `desktop_shell:
  framework: tauri-2
  memory_ceiling_mib: 512
  ceiling_fixed_on: "2026-10-23"
`;
    const { exitCode, output } = run(repositoryWith(CARD + shell));
    expect(exitCode).toBe(0);
    expect(output).toContain("1 declare a desktop shell");
    expect(output).toContain("1 with a fixed ceiling");
    expect(output).toContain("0 without");
  });

  test("a Tauri shell without a ceiling is a drift: exit 1, the card and the rule named", () => {
    const shell = `desktop_shell:
  framework: tauri-2
`;
    const { exitCode, output } = run(repositoryWith(CARD + shell));
    expect(exitCode).toBe(1);
    // The violation line names the card, the missing field and the rule
    // together: the volume line also cites ADR-0057 §4, so a bare substring
    // check on the rule would pass without the violation naming it.
    const violation = output.split("\n").find((line) => line.includes("memory_ceiling_mib"));
    expect(violation).toContain("envelope.project.v1.yaml");
    expect(violation).toContain("ADR-0057 §4");
    // The counters are printed on a red run too, not only on a green one.
    expect(output).toContain("1 declare a desktop shell");
    expect(output).toContain("0 with a fixed ceiling, 1 without");
  });
});
