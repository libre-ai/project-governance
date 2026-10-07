import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, PRIVATE_CROSS_REPOSITORY_NOTE } from "../../ecosystem/build-index";
import { concludeGate, GateReport } from "../quality/gate-report";
import { auditScope, readAudit, selectPublicAdvisoryRepositories } from "./advisories";

// ADR-0021 D1 — the periodic fleet control that owns the state of the world.
//
// The 2026-08-04 incident it descends from: a high advisory covered the
// dependency pin of 30 of the 31 fleet repositories, and exactly one of them
// ran any audit at all. The fleet was warned by the only repository that was
// looking. This control audits every living repository's lockfile on a
// schedule and NOTIFIES — it never blocks a pull request; what a pull request
// introduces is the delta gate's question (D2, check-audit-delta).
//
// Archived repositories are skipped by construction: the archived hub carries
// the vulnerable pin in read-only history and cannot be corrected, and D30
// says no control counts it as an actionable red.
//
// `bun audit` needs package.json AND bun.lock, nothing else — verified
// empirically before this was written: the pair in an empty directory
// reproduces the advisory listing without node_modules or an install, and the
// lockfile alone is refused ("No package.json was found").

function gh(args: string[]): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, stdout: new TextDecoder().decode(result.stdout) };
}

const report = new GateReport();
const inventory = buildIndex(
  await Bun.file(new URL("../../ecosystem/repositories.v1.yaml", import.meta.url)).text(),
);
const repositories = selectPublicAdvisoryRepositories(inventory.repositories).sort();
for (const entry of inventory.repositories.filter(
  (candidate) => candidate.visibility === "private",
)) {
  report.check(entry.repository, true, PRIVATE_CROSS_REPOSITORY_NOTE);
}

for (const repository of repositories) {
  const raw = (path: string) =>
    gh(["api", `repos/${repository}/contents/${path}`, "-H", "Accept: application/vnd.github.raw"]);
  const manifest = raw("package.json");
  if (!manifest.ok) {
    // Asserted, not skipped: "this repository has no JS dependency surface"
    // is a statement about the repository, and it counts as an inspection.
    report.check(repository, true, "no package.json — no JS dependency surface to audit");
    continue;
  }
  const scope = auditScope(manifest.stdout);
  if (scope.kind === "unparseable") {
    report.check(repository, false, `package.json unparseable — ${scope.detail}`);
    continue;
  }
  if (scope.kind === "nothing-to-audit") {
    // A manifest without any dependency field cannot carry a lockfile: Bun
    // deletes an empty one ("No packages! Deleted empty lockfile"). Asking
    // for bun.lock here asked for an artifact that cannot exist (carriere,
    // 2026-09-07). Asserted out loud, never skipped in silence.
    report.check(
      repository,
      true,
      "package.json declares no dependency — nothing to audit (Bun persists no empty lockfile)",
    );
    continue;
  }
  const lockfile = raw("bun.lock");
  if (!lockfile.ok) {
    // A manifest without a lockfile cannot be audited AND breaks the fleet's
    // pinning discipline — red on both counts.
    report.check(repository, false, "package.json without bun.lock — unpinned, unauditable");
    continue;
  }

  const name = repository.split("/").at(-1) ?? "repository";
  const dir = mkdtempSync(join(tmpdir(), `fleet-audit-${name}-`));
  writeFileSync(join(dir, "package.json"), manifest.stdout);
  writeFileSync(join(dir, "bun.lock"), lockfile.stdout);
  const audit = Bun.spawnSync(["bun", "audit"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const output = new TextDecoder().decode(audit.stdout) + new TextDecoder().decode(audit.stderr);
  const reading = readAudit(audit.exitCode, output);

  if (!reading.ran) {
    report.check(repository, false, reading.detail);
  } else if (reading.advisories.length > 0) {
    report.check(repository, false, `lockfile carries ${reading.advisories.join(", ")}`);
  } else {
    report.check(repository, true, "lockfile audited, no advisory");
  }
}

concludeGate("Fleet advisories", report);
