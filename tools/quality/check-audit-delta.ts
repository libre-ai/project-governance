import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffAdvisories, readAudit } from "../security/advisories";
import { concludeGate, GateReport } from "./gate-report";

// ADR-0021 D2 — the pull-request gate judges only what the pull request
// introduces into the lockfile.
//
// A bare `bun audit` in CI turned the state of the world into a verdict on a
// change: on 2026-08-04, four green pull requests went red overnight — two of
// them documentation-only — because an advisory was published, not because
// anything in them changed. An advisory already present on the base belongs to
// the fleet control (D1, check-fleet-advisories); an advisory that appears
// because THIS change moved the lockfile is the one thing this gate blocks.
//
// Both sides are audited the same way, from the lockfile alone. An audit that
// cannot answer — network down, registry unreachable — fails loudly on either
// side: "found nothing" and "could not look" are never conflated.

function sh(argv: string[], cwd?: string): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function audit(cwd: string) {
  const result = sh(["bun", "audit"], cwd);
  return readAudit(result.exitCode, result.stdout + result.stderr);
}

const report = new GateReport();

// FETCH_HEAD rather than origin/main: an actions/checkout clone is shallow and
// single-ref, where origin/main may not exist but a targeted fetch always
// resolves. Locally the two are the same commit.
const fetched = sh(["git", "fetch", "--quiet", "--depth=1", "origin", "main"]);
if (fetched.exitCode !== 0) {
  report.check("base lockfile", false, `could not fetch the base: ${fetched.stderr.trim()}`);
  concludeGate("Audit delta", report);
}

// `bun audit` needs the manifest AND the lockfile (verified: the lockfile
// alone is refused with "No package.json was found").
const baseLock = sh(["git", "show", "FETCH_HEAD:bun.lock"]);
const baseManifest = sh(["git", "show", "FETCH_HEAD:package.json"]);
let baseAdvisories: string[] = [];
if (baseLock.exitCode === 0 && baseManifest.exitCode === 0) {
  const dir = mkdtempSync(join(tmpdir(), "audit-delta-base-"));
  writeFileSync(join(dir, "package.json"), baseManifest.stdout);
  writeFileSync(join(dir, "bun.lock"), baseLock.stdout);
  const baseReading = audit(dir);
  if (!baseReading.ran) {
    report.check("bun audit (base)", false, baseReading.detail);
    concludeGate("Audit delta", report);
  }
  baseAdvisories = baseReading.advisories;
}
// A base without a lockfile audits as empty: everything on head is introduced.

const headReading = audit(".");
if (!headReading.ran) {
  report.check("bun audit (head)", false, headReading.detail);
  concludeGate("Audit delta", report);
}

const delta = diffAdvisories(baseAdvisories, headReading.advisories);
for (const id of delta.introduced) {
  report.check(id, false, "introduced by this change — fix the dependency before merging");
}
for (const id of delta.preExisting) {
  report.check(
    id,
    true,
    "pre-existing on the base — the fleet control owns it (ADR-0021 D1), this change is not judged on it",
  );
}
if (headReading.advisories.length === 0) {
  report.check(
    "bun.lock",
    true,
    baseAdvisories.length === 0
      ? "no advisory on head, none on base"
      : `no advisory on head — this change clears ${baseAdvisories.length} base advisory(ies)`,
  );
}

concludeGate("Audit delta", report);
