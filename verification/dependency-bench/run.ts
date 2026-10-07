/**
 * Dependency-mechanics bench (design §5.2.6) — reproducible runner.
 *
 * Regenerates the bench fixtures in a temporary directory and replays every
 * locally exercisable case, so the conclusions recorded in
 * `distribution/evidence/2026-07-29-dependency-bench.md` can be re-verified
 * from a clean clone (K4 finding CARDS-06: fixtures outside the repository
 * made the evidence a testimony, not a proof).
 *
 * Cases:
 *   1. Bun git-dep over GitHub transport — DEFERRED by construction: bun does
 *      not support `git+file://`, so the SHA-pin over GitHub can only be
 *      confirmed by the first real satellite, before any hub path removal
 *      (design §5.4).
 *   2. Bun `exports.bun` → TS source without dist/lifecycle, type-checked by
 *      the consumer's `tsc --noEmit` (no `.d.ts` emitted).
 *   3. Rust compile-time consumption of a byte-exact vendored copy under a
 *      drift gate, with counter-proof (K4 finding CARDS-04: the TS precedent
 *      of `sync-schemas.ts` does not prove the `include_str!` mechanics used
 *      by the six crates consuming `contracts/`).
 *   4. `[patch.crates-io] aes` re-declared by the consuming workspace,
 *      verified across the real repository graph via `cargo tree -i aes`.
 *   5. cargo-deny `[sources.allow-org]` with counter-proof — requires network
 *      (a real GitHub git-dep): only replayed with `--online`.
 *
 * Usage: bun verification/dependency-bench/run.ts [--online]
 *
 * Manual by design (owner decision 2026-08-18): this is a point-in-time study
 * of dependency mechanics, re-run when one of the five cases above is
 * revisited or a new mechanic is added — not a recurring gate. Its conclusions
 * are evidence committed to `distribution/evidence/`, not a status this
 * repository keeps continuously green.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { $ } from "bun";

const online = process.argv.includes("--online");
const repoRoot = (await $`git rev-parse --show-toplevel`.text()).trim();
const bench = mkdtempSync(join(tmpdir(), "libre-ai-dependency-bench-"));

interface CaseResult {
  readonly id: string;
  readonly title: string;
  readonly outcome: "PASS" | "FAIL" | "SKIP" | "DEFERRED";
  readonly detail: string;
}

const results: CaseResult[] = [];

function record(result: CaseResult): void {
  results.push(result);
  console.log(`[case ${result.id}] ${result.outcome} — ${result.title}`);
  console.log(`  ${result.detail}`);
}

async function write(path: string, content: string): Promise<void> {
  await Bun.write(join(bench, path), content);
}

// --- Case 1: GitHub transport. The positive half is proven by real use:
// contracts/bun.lock pins github:libre-ai/governance#<full sha> WITH an
// integrity hash, re-verified by every `bun install --frozen-lockfile` of
// its CI — stronger than any one-shot fixture (K4 CLOSE33-01). What needs a
// replayable artefact is the COUNTER-PROOF: an unreachable sha must fail
// the install, establishing that the pin is enforced, not silently
// bypassed. Network required — replayed with --online.
async function caseOne(): Promise<void> {
  if (!online) {
    record({
      id: "1",
      title: "Bun git-dep SHA-pin over GitHub transport",
      outcome: "SKIP",
      detail:
        "Positive half proven by real use (contracts/bun.lock pins the full sha with an " +
        "integrity hash, re-verified each CI install). Counter-proof (unreachable sha must " +
        "fail) requires network — replay with --online.",
    });
    return;
  }
  await write(
    "transport-neg/package.json",
    JSON.stringify(
      {
        name: "@libre-ai/bench-transport-negative",
        private: true,
        dependencies: {
          "@libre-ai/governance":
            "github:libre-ai/governance#deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        },
      },
      null,
      2,
    ),
  );
  const install = await $`bun install`.cwd(join(bench, "transport-neg")).quiet().nothrow();
  const failedToResolve =
    install.exitCode !== 0 && install.stderr.toString().includes("failed to resolve");
  record({
    id: "1",
    title: "Bun git-dep SHA-pin over GitHub transport — counter-proof",
    outcome: failedToResolve ? "PASS" : "FAIL",
    detail: failedToResolve
      ? "an unreachable sha fails the install (exit non-zero, « failed to resolve ») — the pin is enforced, never silently bypassed; positive half carried by contracts/bun.lock, re-verified by its real CI"
      : `expected failure, got exit=${install.exitCode}: ${install.stderr.toString().slice(0, 200)}`,
  });
}

// --- Case 2: exports.bun → TS source, no dist, no lifecycle, tsc through it.
async function caseTwo(): Promise<void> {
  await write(
    "satellite/package.json",
    JSON.stringify(
      {
        name: "@libre-ai/bench-satellite",
        version: "0.0.1",
        type: "module",
        exports: { ".": { bun: "./src/index.ts", default: "./src/index.ts" } },
        scripts: { postinstall: 'node -e "process.exit(1)" || echo lifecycle-ran > proof' },
      },
      null,
      2,
    ),
  );
  // Keep the benchmark fixture's interpolation literal without making Biome
  // mistake the fixture source for an interpolation bug in this runner.
  const interpolation = ["$", "{name}"].join("");
  await write(
    "satellite/src/index.ts",
    `export function greet(name: string): string {\n  return \`bonjour ${interpolation}\`;\n}\n`,
  );
  await write(
    "consumer/package.json",
    JSON.stringify(
      {
        name: "@libre-ai/bench-consumer",
        version: "0.0.1",
        type: "module",
        dependencies: { "@libre-ai/bench-satellite": "file:../satellite" },
      },
      null,
      2,
    ),
  );
  await write(
    "consumer/index.ts",
    'import { greet } from "@libre-ai/bench-satellite";\n\nconsole.log(greet("banc"));\n',
  );
  await write(
    "consumer/tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "esnext",
          moduleResolution: "bundler",
          target: "esnext",
        },
        include: ["index.ts"],
      },
      null,
      2,
    ),
  );
  const consumer = join(bench, "consumer");
  const install = await $`bun install`.cwd(consumer).quiet().nothrow();
  const run = await $`bun index.ts`.cwd(consumer).quiet().nothrow();
  const lifecycleProof = await Bun.file(
    join(consumer, "node_modules/@libre-ai/bench-satellite/proof"),
  ).exists();
  const tsc = await $`bunx tsc --noEmit -p tsconfig.json`.cwd(consumer).quiet().nothrow();
  const pass =
    install.exitCode === 0 &&
    run.exitCode === 0 &&
    run.stdout.toString().includes("bonjour banc") &&
    !lifecycleProof &&
    tsc.exitCode === 0;
  record({
    id: "2",
    title: "exports.bun resolves TS source without dist or lifecycle; tsc type-checks through it",
    outcome: pass ? "PASS" : "FAIL",
    detail: pass
      ? "install exit 0, source executed without build, no lifecycle ran (no proof file), tsc --noEmit exit 0 through the dependency source"
      : `install=${install.exitCode} run=${run.exitCode} lifecycle-ran=${lifecycleProof} tsc=${tsc.exitCode}`,
  });
}

// --- Case 3: Rust vendored byte-exact copy under a drift gate (compile-time).
async function caseThree(): Promise<void> {
  const contract = `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:libre-ai:bench:contract:v1",
      type: "object",
      required: ["kind"],
      properties: { kind: { const: "bench" } },
    },
    null,
    2,
  )}\n`;
  // `reference/` stands for the contracts repository at a pinned revision;
  // `vendored/` is the compile-time copy carried by the consuming crate.
  await write("contracts-reference/contract.v1.json", contract);
  await write("consumer-rs/vendored/contract.v1.json", contract);
  await write(
    "consumer-rs/Cargo.toml",
    '[package]\nname = "bench-vendored-consumer"\nversion = "0.0.1"\nedition = "2021"\n\n[workspace]\n',
  );
  await write(
    "consumer-rs/src/lib.rs",
    `//! Compile-time consumption of the vendored contract (I-05 mechanics).
pub const CONTRACT_V1: &str = include_str!("../vendored/contract.v1.json");

#[cfg(test)]
mod tests {
    #[test]
    fn contract_is_embedded_and_carries_its_id() {
        assert!(super::CONTRACT_V1.contains("urn:libre-ai:bench:contract:v1"));
    }
}
`,
  );
  const crate = join(bench, "consumer-rs");
  const build = await $`cargo test --offline`.cwd(crate).quiet().nothrow();

  const referencePath = join(bench, "contracts-reference/contract.v1.json");
  const vendoredPath = join(crate, "vendored/contract.v1.json");
  const driftGate = async (): Promise<boolean> => {
    const [reference, vendored] = await Promise.all([
      Bun.file(referencePath).bytes(),
      Bun.file(vendoredPath).bytes(),
    ]);
    return reference.length === vendored.length && Buffer.compare(reference, vendored) === 0;
  };
  const cleanGate = await driftGate();
  // Counter-proof: a single-byte drift in the vendored copy must turn the gate red.
  await Bun.write(vendoredPath, `${contract} `);
  const driftedGate = await driftGate();
  await Bun.write(vendoredPath, contract);

  const pass = build.exitCode === 0 && cleanGate && !driftedGate;
  record({
    id: "3",
    title: "Rust crate compiles against a vendored copy via include_str!, byte-exact drift gate",
    outcome: pass ? "PASS" : "FAIL",
    detail: pass
      ? "cargo test exit 0 (include_str! embeds the vendored contract), drift gate green on the byte-exact copy, red on a single-byte drift (counter-proof), copy restored"
      : `cargo=${build.exitCode} cleanGate=${cleanGate} driftedGateStillGreen=${driftedGate} — ${build.stderr.toString().slice(0, 400)}`,
  });
}

// --- Case 4: aes patch re-declared, verified across the real repo graph.
async function caseFour(): Promise<void> {
  const tree = await $`cargo tree -i aes --offline`.cwd(repoRoot).quiet().nothrow();
  const output = tree.stdout.toString();
  const patched = tree.exitCode === 0 && output.includes("third_party/rustcrypto-aes");
  record({
    id: "4",
    title: "[patch.crates-io] aes resolves to the audited path across the workspace graph",
    outcome: patched ? "PASS" : "FAIL",
    detail: patched
      ? "cargo tree -i aes resolves aes to third_party/rustcrypto-aes for every dependent in the graph"
      : `exit=${tree.exitCode}; output head: ${output.slice(0, 200)}`,
  });
}

// --- Case 5: cargo-deny allow-org with counter-proof — network required.
async function caseFive(): Promise<void> {
  if (!online) {
    record({
      id: "5",
      title: "cargo-deny [sources.allow-org] with counter-proof",
      outcome: "SKIP",
      detail:
        "Requires network (a real GitHub git-dep) and cargo-deny 0.19.5 — replay with --online. " +
        "Proven 2026-07-29 with counter-proof: `sources ok` exit 0 with the key, " +
        "error[source-not-allowed] exit 8 without.",
    });
    return;
  }
  await write(
    "consumer-deny/Cargo.toml",
    `[package]
name = "bench-deny-consumer"
version = "0.0.1"
edition = "2021"

[dependencies]
libre-ai-artifact = { git = "https://github.com/libre-ai/libre-ai.git", rev = "5c1bf0523b8e81476096bc4a8fe888b1758d72f4" }

[workspace]
`,
  );
  await write("consumer-deny/src/lib.rs", "pub use libre_ai_artifact as artifact;\n");
  await write(
    "consumer-deny/deny.toml",
    '[sources]\nunknown-git = "deny"\n\n[sources.allow-org]\ngithub = ["libre-ai"]\n',
  );
  const crate = join(bench, "consumer-deny");
  const allowed = await $`cargo deny check sources`.cwd(crate).quiet().nothrow();
  await write("consumer-deny/deny.toml", '[sources]\nunknown-git = "deny"\n');
  const denied = await $`cargo deny check sources`.cwd(crate).quiet().nothrow();
  const pass = allowed.exitCode === 0 && denied.exitCode !== 0;
  record({
    id: "5",
    title: "cargo-deny [sources.allow-org] with counter-proof",
    outcome: pass ? "PASS" : "FAIL",
    detail: pass
      ? `sources ok (exit 0) with allow-org; exit ${denied.exitCode} without the key (counter-proof)`
      : `allowed=${allowed.exitCode} denied=${denied.exitCode}`,
  });
}

try {
  await caseOne();
  await caseTwo();
  await caseThree();
  await caseFour();
  await caseFive();
} finally {
  rmSync(bench, { recursive: true, force: true });
}

const failed = results.filter((result) => result.outcome === "FAIL");
console.log(
  `\nBench summary: ${results.filter((r) => r.outcome === "PASS").length} pass, ` +
    `${failed.length} fail, ${results.filter((r) => r.outcome === "SKIP").length} skip, ` +
    `${results.filter((r) => r.outcome === "DEFERRED").length} deferred`,
);
if (failed.length > 0) process.exit(1);
