#!/usr/bin/env bun
/**
 * Blank-room reproduction loop (positioning L3).
 *
 * The doctrine publishes evidence by default (I-20), but publishing is not
 * appropriability: nothing yet PROVES that a third party without private
 * assistance can take the public repository and verify it green. This loop
 * is that proof, made executable:
 *
 *   fresh temporary directory
 *     -> credential-free environment (see cleanroom.ts for the boundary)
 *     -> anonymous `git clone` of the PUBLIC repository
 *     -> `bun install --frozen-lockfile` (the committed lockfile must
 *        suffice — an adopter has nothing else)
 *     -> the existing reference chain, exactly as its evidence documents it
 *        (`bun verification/harness/reference-chain.ts`, digest compared to
 *        the one published in wp-g2-q01-reference-chain-evidence.md)
 *
 * REPOSITORY_URL was `libre-ai/libre-ai` (the hub) until 2026-08-19. Migration
 * γ (ADR-0020, docs/adr/0020-general-activation-and-hub-dismantling.md) froze
 * that hub read-only and moved `verification/harness/` and `verification/
 * adoption/` themselves to this repository (ecosystem/migration-index.v1.yaml,
 * maintained in the hub during dismantling: both hub_paths -> destination
 * libre-ai/governance, hub_removal_commit ba3761b45901bb2c7f850aaac8c6539e2c
 * 407533; the removal-wave note for this very workflow file reads "governance
 * carries verification/ (adoption, sovereignty) — the recurring proofs
 * re-arm there when scheduled"). Three consecutive weekly runs (2026-08-05,
 * -12, -19) failed with "Module not found" for both
 * verification/harness/reference-chain.ts and
 * tools/quality/check-policy-core-vectors.ts: the loop was still cloning the
 * frozen hub, which no longer carries either path. REPOSITORY_URL now points
 * at the repository that actually carries the reference chain.
 *
 * The pre-γ loop also ran a second step — "one contract validated with the
 * repository's own conformance tooling" (`tools/quality/
 * check-policy-core-vectors.ts`). That module was deliberately deleted from
 * this repository at its 2026-07-29 workspace bootstrap (commit
 * 1f9103618e046374c8179f38f4ff5432743be259: "Contract-vector verifiers
 * removed: they belong to the contracts authority"), consistent with
 * AGENTS.md: "Contract authorities are canonical in the contracts repository
 * — never here." Its functional successor, `tools/quality/check-contracts.ts`
 * (validates policy-core-v1 golden vectors against `contracts/schemas/*`,
 * generalized to every contract kind), lives in and is gated by the
 * `libre-ai/contracts` repository's own CI — it verifies itself, in its own
 * blank-room terms, and does not need re-proving from here. The step is
 * retired from this loop rather than re-pointed at another repository: this
 * loop reproduces ONE public repository per run (REPOSITORY_URL), and
 * contracts' own adoption proof is that repository's own concern.
 *
 * The clone is shallow (`--depth 1`): the loop proves the published HEAD is
 * appropriable; no chain step needs history, and the cloned sha is recorded
 * in the attestation, so depth adds cost without adding proof.
 *
 * Output: a machine attestation (JSON) plus a Markdown rendering under
 * `distribution/evidence/adoption/`. The friction log inside it is the most
 * important product — the objective readability backlog — and is produced
 * even when the run passes.
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AdoptionStep,
  buildAttestation,
  type FrictionEntry,
  renderAttestationMarkdown,
} from "./attestation";
import { parseChainReportFromOutput } from "./chain-report";
import {
  buildCleanroomEnv,
  detectDocumentationFrictions,
  extractExpectedDigest,
  type ToolchainPassthrough,
} from "./cleanroom";

const REPOSITORY_URL = "https://github.com/libre-ai/governance";
const CHAIN_EVIDENCE_PATH = "verification/harness/wp-g2-q01-reference-chain-evidence.md";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pre-installed PUBLIC toolchains are prerequisites, not private assistance:
 * reuse the operator's Rust and Playwright installs when present so the loop
 * stays cheap, without ever weakening the credential boundary (cleanroom.ts).
 * Explicit env vars win; otherwise the conventional per-platform locations
 * are probed relative to the REAL home before it is swapped out.
 */
async function resolveToolchain(realHome: string | undefined): Promise<ToolchainPassthrough> {
  const passthrough: {
    cargoHome?: string;
    rustupHome?: string;
    playwrightBrowsersPath?: string;
  } = {};
  const candidates: ReadonlyArray<{
    key: keyof typeof passthrough;
    fromEnv: string | undefined;
    fallback: string | undefined;
  }> = [
    { key: "cargoHome", fromEnv: process.env.CARGO_HOME, fallback: homePath(realHome, ".cargo") },
    {
      key: "rustupHome",
      fromEnv: process.env.RUSTUP_HOME,
      fallback: homePath(realHome, ".rustup"),
    },
    {
      key: "playwrightBrowsersPath",
      fromEnv: process.env.PLAYWRIGHT_BROWSERS_PATH,
      fallback: homePath(
        realHome,
        process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright",
      ),
    },
  ];
  for (const candidate of candidates) {
    const resolved = candidate.fromEnv ?? candidate.fallback;
    if (resolved !== undefined && (await pathExists(resolved))) {
      passthrough[candidate.key] = resolved;
    }
  }
  return passthrough;
}

function homePath(realHome: string | undefined, relative: string): string | undefined {
  return realHome === undefined ? undefined : join(realHome, relative);
}

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly durationMs: number;
}

/** Stdout is captured (the chain report travels on it); stderr streams live. */
async function runCommand(
  command: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<CommandResult> {
  const started = Bun.nanoseconds();
  const proc = Bun.spawn([...command], { cwd, env, stdout: "pipe", stderr: "inherit" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return {
    exitCode,
    stdout,
    durationMs: Math.round((Bun.nanoseconds() - started) / 1_000_000),
  };
}

function stepOutcome(
  id: string,
  label: string,
  result: CommandResult,
  succeeded: boolean,
): AdoptionStep {
  return {
    id,
    label,
    status: succeeded && result.exitCode === 0 ? "passed" : "failed",
    durationMs: result.durationMs,
  };
}

function parseOutDir(argv: readonly string[], defaultDir: string): string {
  const flagIndex = argv.indexOf("--out");
  if (flagIndex === -1) {
    return defaultDir;
  }
  const value = argv[flagIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--out requires a directory argument");
  }
  return value;
}

async function main(): Promise<void> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(moduleDir, "..", "..");
  const outDir = parseOutDir(
    process.argv.slice(2),
    join(repoRoot, "distribution", "evidence", "adoption"),
  );

  const workRoot = await mkdtemp(join(tmpdir(), "libre-ai-adoption-"));
  const freshHome = join(workRoot, "home");
  const cloneDir = join(workRoot, "clone");
  await mkdir(freshHome, { recursive: true });

  const toolchain = await resolveToolchain(process.env.HOME);
  const env = buildCleanroomEnv(process.env, { freshHome, toolchain });

  const steps: AdoptionStep[] = [];
  const frictionLog: FrictionEntry[] = [];
  let clonedSha = "0".repeat(40);
  let expectedDigest: string | null = null;
  let obtainedDigest: string | null = null;

  try {
    console.error("=== adoption: clone — anonymous shallow clone of the public repository ===");
    const clone = await runCommand(
      ["git", "clone", "--depth", "1", REPOSITORY_URL, cloneDir],
      workRoot,
      env,
    );
    let cloneOk = clone.exitCode === 0;
    if (cloneOk) {
      const revParse = await runCommand(["git", "rev-parse", "HEAD"], cloneDir, env);
      const sha = revParse.stdout.trim();
      if (revParse.exitCode === 0 && /^[a-f0-9]{40}$/.test(sha)) {
        clonedSha = sha;
      } else {
        cloneOk = false;
      }
    }
    steps.push(stepOutcome("clone", "Anonymous shallow clone (public HTTPS)", clone, cloneOk));

    if (cloneOk) {
      // The friction probes need the public docs; read them from the clone so
      // the attestation always reflects what an adopter actually saw.
      const [readme, contributing] = await Promise.all([
        readFile(join(cloneDir, "README.md"), "utf8").catch(() => ""),
        readFile(join(cloneDir, "CONTRIBUTING.md"), "utf8").catch(() => ""),
      ]);
      frictionLog.push(...detectDocumentationFrictions({ readme, contributing }));

      const evidence = await readFile(join(cloneDir, CHAIN_EVIDENCE_PATH), "utf8").catch(() => "");
      expectedDigest = extractExpectedDigest(evidence);
      if (expectedDigest === null) {
        frictionLog.push({
          step: "reference-chain",
          kind: "ambiguous-output",
          description: `No documented reproducible digest found in ${CHAIN_EVIDENCE_PATH}; the chain result cannot be compared to a published expectation.`,
        });
      }

      console.error("=== adoption: install — bun install --frozen-lockfile ===");
      const install = await runCommand(["bun", "install", "--frozen-lockfile"], cloneDir, env);
      steps.push(
        stepOutcome("install", "Dependency install from the committed lockfile", install, true),
      );

      if (install.exitCode === 0) {
        console.error("=== adoption: reference-chain — as documented by its evidence ===");
        const chain = await runCommand(
          ["bun", "verification/harness/reference-chain.ts"],
          cloneDir,
          env,
        );
        const report = parseChainReportFromOutput(chain.stdout);
        if (report === null) {
          frictionLog.push({
            step: "reference-chain",
            kind: "ambiguous-output",
            description:
              "The reference chain emitted no parseable report on stdout; its outcome had to be treated as unknown.",
          });
        } else {
          obtainedDigest = report.digest;
          if (report.skipped.length > 0) {
            frictionLog.push({
              step: "reference-chain",
              kind: "environment-gap",
              description: `The chain skipped gated steps in this environment: ${report.skipped.join(", ")}. The reproduction did not exercise them.`,
            });
          }
        }
        const chainOk = chain.exitCode === 0 && report !== null && report.status !== "failed";
        steps.push(
          stepOutcome("reference-chain", "Foundation reference chain (WP-G2-Q01)", chain, chainOk),
        );
        // No separate "contract-conformance" step here: tools/quality/
        // check-policy-core-vectors.ts was deliberately removed from this
        // repository (2026-07-29, commit 1f9103618e046374c8179f38f4ff5432743
        // be259 — "Contract-vector verifiers removed: they belong to the
        // contracts authority"). Its successor, tools/quality/
        // check-contracts.ts, lives in and is gated by libre-ai/contracts'
        // own CI (see the module doc above). This loop reproduces ONE public
        // repository per run; that repository's own adoption proof is its
        // own concern.
      }
    }

    if (expectedDigest !== null && obtainedDigest !== null && expectedDigest !== obtainedDigest) {
      frictionLog.push({
        step: "reference-chain",
        kind: "ambiguous-output",
        description:
          "The obtained chain digest differs from the documented one: either the documentation lags the chain, or the chain is not reproducible from a clean checkout.",
      });
    }

    const attestation = buildAttestation({
      generatedAt: new Date().toISOString(),
      repository: REPOSITORY_URL,
      clonedSha,
      environment: { bunVersion: Bun.version, os: process.platform, arch: process.arch },
      steps,
      referenceChain: { expectedDigest, obtainedDigest },
      frictionLog,
    });

    await mkdir(outDir, { recursive: true });
    const json = `${JSON.stringify(attestation, null, 2)}\n`;
    await writeFile(join(outDir, `${attestation.runId}.json`), json);
    await writeFile(
      join(outDir, `${attestation.runId}.md`),
      renderAttestationMarkdown(attestation),
    );
    // latest.json is regenerated on every run: consumers that only want "the
    // current adoption verdict" read one stable path.
    await writeFile(join(outDir, "latest.json"), json);

    console.error(
      `Adoption reproduction ${attestation.verdict.toUpperCase()} — run ${attestation.runId}, ${frictionLog.length} friction entr${frictionLog.length === 1 ? "y" : "ies"} recorded.`,
    );
    if (attestation.verdict === "fail") {
      process.exitCode = 1;
    }
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await main();
}
