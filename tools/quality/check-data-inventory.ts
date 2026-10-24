import { touchesGatedPaths } from "./check-review-evidence";
import { concludeGate, GateReport } from "./gate-report";
import { readGit } from "./git-diff";

/**
 * Data-file inventory (#153): the closed world behind the guarded surface of
 * check-review-evidence.
 *
 * A data file can loosen a gate: an allowlist, an exemption, a waiver, a
 * threshold, the scope a gate reads. Guarding the ones found by a search is
 * not enough. A name heuristic or a key heuristic misses the next one, as a
 * separate review of #159 measured: 20 of 25 constructed loosening files went
 * past the first version of this check (an `[allowlist]` table in a TOML file
 * of another directory, a minified `"exemptions"`, `.gitleaksignore`,
 * `paths-ignore:` in a CodeQL configuration, a file one directory deeper).
 *
 * So the question is turned around. The universe is every tracked file that
 * is neither source code nor Markdown, whatever its name or its content. Each
 * file of the universe falls in exactly one of three places:
 *
 * - gated: `touchesGatedPaths` of check-review-evidence matches it, so a pull
 *   request that changes it needs review evidence;
 * - declared: an entry of `NOT_GATED` below covers it, with the reason it is
 *   not gated, either by its exact path or by a directory;
 * - undeclared: neither, and this gate fails on it.
 *
 * A gated file wins over a declaration, so the three counts are a partition
 * that sums to the universe. A declaration that covers a gated file, covers
 * nothing, or covers a file another declaration covers too is a defect of the
 * list, and fails as well: it is a standing excuse ready for another file.
 *
 * LIMIT, not decided here (#152, ADR-0060 proposed in #158). Source code is
 * outside the universe, and that includes the code that draws the surface:
 * check-review-evidence.ts, this file, their tests and check-empty-allowances.ts.
 * A pull request that removes a gated pattern and declares the file here
 * passes every gate with no review evidence. Guarding these files is an owner
 * decision.
 *
 * Reads `git ls-files`, so only what is committed counts: stage a new file
 * before running it (AGENTS.md).
 */

/** Source code and prose: the extensions outside the universe. */
export const OUTSIDE_THE_UNIVERSE = /\.(md|ts|tsx|mts|cts|js|jsx|mjs|cjs|py|rs|sh|jq)$/;

export interface NotGated {
  /** An exact repository-relative path, or a directory ending with `/`. */
  readonly path: string;
  readonly because: string;
  /** Set when the file loosens a gate and guarding it waits for the owner. */
  readonly awaitingOwnerArbitration?: true;
}

const AWAITING =
  "guarding it would require an owner ready on every change of this configuration, and that decision is the owner's";

export const NOT_GATED: readonly NotGated[] = [
  // Configuration that delimits a gate. Each one loosens a gate when it is
  // edited; each one waits for the owner.
  {
    path: "biome.json",
    because: `its files.includes negations delimit what \`biome ci .\` lints and formats; ${AWAITING}`,
    awaitingOwnerArbitration: true,
  },
  {
    path: "tsconfig.json",
    because: `its include and exclude delimit what \`typecheck\` reads, and its compiler options set how strict it is; ${AWAITING}`,
    awaitingOwnerArbitration: true,
  },
  {
    path: "package.json",
    because: `its scripts.check is the list of steps \`bun run check\` runs; removing one removes a gate from the aggregate; ${AWAITING}`,
    awaitingOwnerArbitration: true,
  },
  {
    path: "REUSE.toml",
    because: `its annotations declare the licence of the paths they match, which is what \`reuse lint\` checks; ${AWAITING}`,
    awaitingOwnerArbitration: true,
  },
  // Gate definitions: the gates themselves, on the far side of the LIMIT above.
  {
    path: ".github/workflows/",
    because:
      "CI definitions are the gates, not their data: their triggers, `paths-ignore` and steps decide what runs; they are code on the far side of the limit written in the header (#152)",
  },
  // Registers and inventories whose changes another gate already confronts.
  {
    path: ".github/composition/manifest.json",
    because:
      "the composition pins: check-ref-monotonicity.py refuses any ref that does not descend from the one it replaces, and its exemptions file is gated",
  },
  {
    path: ".github/dependabot.yml",
    because:
      "update configuration of the Dependabot service; it relaxes no gate of this repository",
  },
  {
    path: "ecosystem/fleet-pins.v1.yaml",
    because:
      "the register of governance generations: each sha it admits is a governance commit, and generation-coherence.yml replays every generation added",
  },
  {
    path: "ecosystem/repositories.v1.yaml",
    because:
      "the fleet inventory: inventory-drift reconciles it with the GitHub organization in both directions, so a repository dropped from it fails the same day",
  },
  {
    path: "ecosystem/LEGACY-MANIFEST.yaml",
    because: "the register of legacy repositories, audited weekly by truth-drift against GitHub",
  },
  {
    path: "ecosystem/migration-index.v1.yaml",
    because: "the record of what migrated where; no gate reads it as an exemption",
  },
  {
    path: "ecosystem/portfolio.v1.json",
    because: "the portfolio as published; no gate reads it as an exemption",
  },
  {
    path: "ecosystem/portfolio.v1.yaml",
    because: "the portfolio source; no gate reads it as an exemption",
  },
  {
    path: "ecosystem/cards/",
    because:
      "project cards, validated against ecosystem/schemas/project.v1.schema.json, which is gated",
  },
  {
    path: "ecosystem/objects/",
    because:
      "knowledge objects, validated against ecosystem/schemas/knowledge-object.schema.json, which is gated",
  },
  {
    path: "project.v1.yaml",
    because: "the project card of this repository, validated against the gated schema",
  },
  // Generated outputs, recomputed and compared by a gate.
  {
    path: "brand/projections/",
    because:
      "generated by brand/build-public-projection.ts; check:brand regenerates and compares it",
  },
  {
    path: "ecosystem/projections/",
    because: "generated projections; check:projection and check-projection-digest recompute them",
  },
  {
    path: "distribution/index/",
    because: "generated by ecosystem/build-index.ts; inventory-drift regenerates and compares it",
  },
  {
    path: "distribution/feeds/",
    because: "generated evidence feeds; Feeds freshness regenerates and fails on drift",
  },
  // Manifests, lockfiles and pins: the dependency gates judge them.
  {
    path: "Cargo.toml",
    because:
      "the workspace manifest; check:dependency-policy and check:dead-code judge what it declares",
  },
  {
    path: "Cargo.lock",
    because: "the lockfile; cargo-deny judges it against deny.toml, which is gated",
  },
  {
    path: "bun.lock",
    because: "the lockfile; check-audit-delta judges what a change introduces into it",
  },
  {
    path: "crates/ecosystem-engine/Cargo.toml",
    because: "the crate manifest; cargo-deny and clippy judge it",
  },
  {
    path: "packages/classification/package.json",
    because: "the package manifest of the classification kernel; it declares no gate",
  },
  {
    path: "rust-toolchain.toml",
    because: "the pinned Rust toolchain; a version, not an exemption",
  },
  {
    path: "tools/licensing/requirements.txt",
    because: "the pinned dependencies of `reuse lint`; versions, not exemptions",
  },
  {
    path: "toolchains/",
    because:
      "tool versions with their archive and executable digests, verified by install-toolchains.sh before use, and the notices that come with them",
  },
  {
    path: "crates/ecosystem-engine/contracts-authority.pin.json",
    because: "the pin of the contract authority; check:vendored compares the vendored copy to it",
  },
  {
    path: "crates/ecosystem-engine/vendored/",
    because:
      "the vendored copy of the contract authority, compared to the pinned authority by check:vendored; it is reviewed in its own repository",
  },
  // Evidence, records and documentation data: read by no gate as a policy.
  {
    path: "distribution/evidence/",
    because:
      "published measurements (coverage, adoption, sovereignty); the evidence feeds cite them, no gate reads them as a threshold",
  },
  {
    path: "distribution/templates/dependabot/",
    because:
      "Dependabot templates the fleet copies; check-dependabot-conformance compares consumers to them",
  },
  {
    path: "docs/reviews/",
    because: "frozen evidence of past reviews, under the commit each one reviewed",
  },
  {
    path: "docs/consolidation/",
    because: "records of the consolidation; no gate reads them",
  },
  {
    path: "docs/migration/",
    because:
      "records of the migration and the original licence texts; no gate reads them as a policy",
  },
  {
    path: "docs/security/notebook-core-v2-review/",
    because: "the material of a security review (schemas and golden output under review)",
  },
  {
    path: "docs/portfolio-material.json",
    because: "documentation data of the portfolio; no gate reads it",
  },
  {
    path: "docs/transformation/work-packages.v1.json",
    because:
      "a transformation record; check-objectives requires its presence and reads nothing in it",
  },
  {
    path: "llms.txt",
    because: "the public index for language models; no gate reads it",
  },
  {
    path: ".claude-plugin/marketplace.json",
    because:
      "the plugin manifest of the skill collection; check:skills reads the skills, not this file",
  },
  {
    path: "skills/",
    because: "evaluation cases of the skills; they relax no gate",
  },
  {
    path: "LICENSE",
    because: "the licence text",
  },
  {
    path: "LICENSES/",
    because: "the licence texts REUSE requires",
  },
  {
    path: ".gitignore",
    because:
      "what git leaves untracked; every gate here reads the committed tree, which it does not change",
  },
  {
    path: ".github/.gitignore",
    because: "what git leaves untracked under .github; same reason as the root .gitignore",
  },
  // Fixtures of the test suites.
  {
    path: "crates/ecosystem-engine/tests/fixtures/",
    because: "fixtures of the Rust tests",
  },
  {
    path: "distribution/fixtures/",
    because: "fixtures of the evidence-feed tests",
  },
  {
    path: "ecosystem/fixtures/",
    because: "fixtures of the ecosystem tests",
  },
  {
    path: "tools/attestation/fixtures/",
    because: "fixtures of the attestation tests",
  },
  {
    path: "tools/fleet/fixtures/",
    because: "before and after trees of the fleet-bump tests",
  },
  {
    path: "verification/",
    because: "golden reports and questionnaires of the verification harnesses",
  },
];

/** Whether a declaration covers a path: equal to it, or a directory above it. */
export function covers(declaration: NotGated, path: string): boolean {
  return declaration.path.endsWith("/")
    ? path.startsWith(declaration.path)
    : path === declaration.path;
}

export interface InventoryAudit {
  /** Tracked files that are neither source code nor Markdown. */
  readonly universe: readonly string[];
  /** Tracked files outside the universe: source code and Markdown. */
  readonly outside: number;
  /** The partition of the universe. gated + declared + undeclared = universe. */
  readonly gated: readonly string[];
  readonly declared: readonly string[];
  readonly undeclared: readonly string[];
  /** Declared files waiting for the owner, a subset of `declared`. */
  readonly awaiting: readonly string[];
  /** Defects of the list. */
  readonly contradictory: readonly string[];
  readonly stale: readonly string[];
  readonly overlapping: readonly string[];
  readonly malformed: readonly string[];
}

export function auditInventory(
  tracked: readonly string[],
  declarations: readonly NotGated[] = NOT_GATED,
): InventoryAudit {
  const universe = tracked.filter((path) => !OUTSIDE_THE_UNIVERSE.test(path));
  const gatedSet = new Set(touchesGatedPaths(universe));
  const gated: string[] = [];
  const declared: string[] = [];
  const undeclared: string[] = [];
  const awaiting: string[] = [];
  const overlapping: string[] = [];
  for (const path of universe) {
    const covering = declarations.filter((declaration) => covers(declaration, path));
    if (covering.length > 1) {
      overlapping.push(`${path} (${covering.map((declaration) => declaration.path).join(", ")})`);
    }
    if (gatedSet.has(path)) gated.push(path);
    else if (covering.length > 0) {
      declared.push(path);
      if (covering.some((declaration) => declaration.awaitingOwnerArbitration === true)) {
        awaiting.push(path);
      }
    } else undeclared.push(path);
  }
  const contradictory: string[] = [];
  const stale: string[] = [];
  const malformed: string[] = [];
  for (const declaration of declarations) {
    const covered = universe.filter((path) => covers(declaration, path));
    if (covered.length === 0) stale.push(declaration.path);
    const gatedCovered = covered.filter((path) => gatedSet.has(path));
    if (gatedCovered.length > 0) {
      contradictory.push(declaration.path);
    }
    if (
      declaration.path.length === 0 ||
      declaration.path.startsWith("/") ||
      declaration.because.trim().length === 0
    ) {
      malformed.push(declaration.path);
    }
  }
  return {
    universe,
    outside: tracked.length - universe.length,
    gated,
    declared,
    undeclared,
    awaiting,
    contradictory,
    stale,
    overlapping,
    malformed,
  };
}

/** The verdict and the volume, as the gate prints them. Pure, so the wording is testable. */
export function reportInventory(
  tracked: readonly string[],
  audit: InventoryAudit,
  declarations: readonly NotGated[] = NOT_GATED,
): GateReport {
  const report = new GateReport();
  report.volume(
    `${tracked.length} tracked file(s): ${audit.outside} source or Markdown outside the universe, ` +
      `${audit.universe.length} data file(s) = ${audit.gated.length} gated + ${audit.declared.length} declared ` +
      `(${audit.awaiting.length} awaiting owner arbitration: ${audit.awaiting.join(", ") || "none"}) + ` +
      `${audit.undeclared.length} undeclared; ${declarations.length} declaration(s)`,
  );
  // One assertion per declaration in force, with what it covers: the count of
  // assertions is then the size of the list a reviewer reads.
  const defective = new Set([...audit.stale, ...audit.malformed, ...audit.contradictory]);
  for (const declaration of declarations) {
    if (defective.has(declaration.path)) continue;
    const count = audit.declared.filter((path) => covers(declaration, path)).length;
    report.check(
      declaration.path,
      true,
      `declared not gated, ${count} file(s): ${declaration.because}`,
    );
  }
  for (const path of audit.undeclared) {
    report.check(
      path,
      false,
      "a data file neither gated by check-review-evidence nor declared in NOT_GATED of check-data-inventory.ts: gate it, or declare it with the reason it relaxes no gate",
    );
  }
  for (const entry of audit.contradictory) {
    report.check(
      entry,
      false,
      "a declaration covers a gated file: the list says not gated of a file that is",
    );
  }
  for (const path of audit.stale) {
    report.check(path, false, "a declaration covers no tracked data file: remove it");
  }
  for (const entry of audit.overlapping) {
    report.check(entry, false, "a data file is covered by more than one declaration");
  }
  for (const path of audit.malformed) {
    report.check(
      path || "(empty path)",
      false,
      "a declaration needs a repository-relative path and a reason",
    );
  }
  return report;
}

if (import.meta.main) {
  const listed = readGit(["ls-files", "-z"], "list the tracked files");
  if (!listed.ok) {
    console.error(`check-data-inventory: ${listed.reason}`);
    process.exit(1);
  }
  const tracked = listed.stdout.split("\0").filter((path) => path.length > 0);
  if (tracked.length === 0) {
    console.error(
      "check-data-inventory: git ls-files listed no file; an empty tree is not an empty inventory",
    );
    process.exit(1);
  }
  concludeGate("Data-file inventory", reportInventory(tracked, auditInventory(tracked)));
}
