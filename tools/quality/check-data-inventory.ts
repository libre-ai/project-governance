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
 *   not gated: by its exact path, or by a directory AND one of the extensions
 *   that directory is declared to hold;
 * - undeclared: neither, and this gate fails on it.
 *
 * A gated file wins over a declaration, so the three counts are a partition
 * that sums to the universe. A gated file under a declared directory is not a
 * defect (a fixture tree may hold a `bunfig.toml`, which is gated at every
 * depth); an EXACT declaration of a gated file is, because the list then says
 * "not gated" of a file that is. A declaration that declares no file, a
 * declared extension no file carries, a file covered by two declarations, or
 * a declaration without its reason fails as well: each is a standing excuse
 * ready for another file.
 *
 * A gated path tracked as a symbolic link (mode 120000) fails. The gate that
 * reads the file would follow the link to its target, and the target is not
 * on the surface: the commit that turns the path into a link would be the
 * last one to need evidence, and every later edit of the target would pass.
 *
 * LIMITS, not decided here (#152, ADR-0060 proposed in #158). They are the
 * text the owner arbitrates on.
 *
 * 1. Source code and Markdown are outside the universe, so the code that
 *    draws the surface is outside it: check-review-evidence.ts, this file and
 *    their tests. A pull request that removes a gated pattern and declares the
 *    file here passes every gate with no review evidence.
 * 2. Allowlists kept in the code of gates are outside it too. They are found
 *    with this command, case-insensitive so that a camelCase binding counts,
 *    and with `const` optional so that a Python module-level binding counts:
 *
 *      git grep -niE '^(export )?(const )?[a-z0-9_]*(ALLOW|EXEMPT|EXCEPT|WAIV|IGNORE|SKIP|RESIDUAL|PERMIT|TRUST|NOT_CALLER|EXCLU|BENIGN|TOLERAT)[a-z0-9_]*[ :=]' -- '*.ts' '*.py' ':!*.test.ts' ':!*[/]test_*.py'
 *
 *    It reads top-level bindings of TypeScript and Python only. The bindings
 *    indented in a function body, read one by one on 2026-10-26, were locals
 *    built from a data file, a flag or a count. On 2026-10-26 the command gives
 *    40 hits in 24 files. 13 of them are not allowlists (paths without a
 *    directory are under tools/quality/):
 *    - they name a data file: ALLOWLIST_PATH of
 *      ecosystem/check-web-headers.ts, EXEMPTIONS_PATH of check-refusals.ts,
 *      isToolchainAllowList of tools/fleet/bump-plan.ts, EXEMPTIONS_SCHEMA of
 *      .github/composition/check-ref-monotonicity.py;
 *    - they parse a format or name a marker: exemptionLine of
 *      tools/attestation/neutralise-check.ts, ALLOWED_PATTERN of
 *      tools/fleet/bump-plan.ts, EXEMPT_CLASS and EXEMPT_TRAILER of
 *      tools/fleet/bump-generation.ts, IGNORE_FLAG of advisory-waivers.ts,
 *      EXEMPT_VALUE of check-work-package-link.ts, ALLOWANCE_MARKER of
 *      check-resolved-refs.ts, LINE_EXEMPTION_MARKER of check-secret-scan.ts;
 *    - it matches by accident: SHALLOW_REFUSAL of work-package-ports.ts.
 *    The other 27, in 16 files, are the allowlists:
 *    - ecosystem/check-context-conformance.ts: ORG_PROFILE_EXEMPTION;
 *    - ecosystem/check-hub-orphans.ts: ARCHIVE_RESIDUALS, RESIDUAL_PREFIXES;
 *    - ecosystem/check-toolchain-source.ts: ARCHIVED_EXCLUSIONS;
 *    - ecosystem/check-truth-drift.ts: PRIVATE_SKIP (empty today);
 *    - ecosystem/check-web-headers.ts: IGNORED_SEGMENT;
 *    - check-empty-allowances.ts: DECLARED_ALLOWANCES, SUBJECT_NOT_CALLER;
 *    - check-js-licenses.ts: allowed, the inbound licences it accepts;
 *    - check-kernel-status-authority.ts: EXEMPT_DIRECTORY_PREFIXES,
 *      IGNORED_PATH_PREFIXES, DECLARED_FILE_ALLOWANCES;
 *    - check-no-clever-production.ts: IGNORED_PREFIXES, IGNORED_SUBSTRINGS;
 *    - check-no-transmission.ts: ALLOWLISTED_PATHS;
 *    - check-personal-data-boundary.ts: ALLOWLISTED_ADDRESSES,
 *      ALLOWLISTED_DOMAINS;
 *    - check-resolved-refs.ts: SKIPPED_DIRECTORIES;
 *    - check-retired-repository-names.ts: HISTORICAL_ALLOWLIST;
 *    - check-secret-scan.ts: IGNORED_PREFIXES, IGNORED_SEGMENTS,
 *      IGNORED_SUBSTRINGS, IGNORED_FILES, LINE_EXEMPTION_FILES;
 *    - check-source-policy.ts: ignoredPrefixes;
 *    - tools/skills/lint-skill.ts: ALLOWED_STATUS, ALLOWED_TOP_LEVEL_KEYS.
 *    The command finds only the bindings named with one of its stems, so the
 *    list is a floor, not a census. A second read on 2026-10-26, of every
 *    top-level array, Set or Map literal by name (fourth review of #159),
 *    found 6 more allowlists in 4 files, named otherwise:
 *    - check-js-licenses.ts: firstPartyLicences;
 *    - check-personal-data-boundary.ts: FIXTURE_BEARING_PATHS,
 *      IDENTIFIER_OUT_OF_SCOPE_PREFIXES, IDENTIFIER_OUT_OF_SCOPE_SUFFIXES;
 *    - check-pr-door.ts: IMPLICIT_TWO_WAY_AUTHORS;
 *    - public-source-scanner.ts: exactRfc2606ExampleDomains.
 * 3. The CI definitions under `.github/workflows/` are declared, not gated:
 *    their triggers, `paths-ignore` and steps decide what runs.
 * 4. Markdown read as data: `docs/prd.md` and `docs/cahier-des-charges.md`,
 *    which check-work-package-link.ts (PRD_PATH, REQUIREMENTS_PATH) reads in
 *    the repository it judges, are prose to this inventory, and the `docs-only`
 *    exempt class of work-package-policy.v1.yaml covers them.
 * 5. The files declared below as awaiting owner arbitration each delimit a
 *    gate; guarding them would need an owner ready on every change.
 * 6. A new file under a declared directory, with an extension that directory
 *    already holds, is covered by the declaration without being named. Only a
 *    new directory or a new extension is a decision the list has to record.
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
  /**
   * For a directory only, and required there: the extensions of the files it
   * holds (`.json`; `""` for a file with no extension). A data file of any
   * other extension under the directory is not covered.
   */
  readonly extensions?: readonly string[];
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
  {
    path: "Cargo.toml",
    because: `its [workspace.lints] table sets the level of every rustc and clippy lint: \`all = "allow"\` there makes \`cargo clippy -- -D warnings\` pass on code it refuses today; ${AWAITING}`,
    awaitingOwnerArbitration: true,
  },
  {
    path: "crates/ecosystem-engine/Cargo.toml",
    because: `a [lints] table here, or \`[lints] workspace = true\` with the workspace table, sets the lint levels clippy applies to the crate; ${AWAITING}`,
    awaitingOwnerArbitration: true,
  },
  // Gate definitions: the gates themselves, LIMIT 3 of the header.
  {
    path: ".github/workflows/",
    extensions: [".yml"],
    because:
      "CI definitions are the gates, not their data: their triggers, `paths-ignore` and steps decide what runs; limit 3 of the header (#152)",
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
      "update configuration of the Dependabot service; check-dependabot-conformance compares it to the templates, which are gated",
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
    extensions: [".yaml"],
    because:
      "project cards, validated against ecosystem/schemas/project.v1.schema.json, which is gated",
  },
  {
    path: "ecosystem/objects/",
    extensions: [".json"],
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
    extensions: [".json"],
    because:
      "generated by brand/build-public-projection.ts; check:brand regenerates and compares it",
  },
  {
    path: "ecosystem/projections/",
    extensions: [".json"],
    because: "generated projections; check:projection and check-projection-digest recompute them",
  },
  {
    path: "distribution/index/",
    extensions: [".json"],
    because: "generated by ecosystem/build-index.ts; inventory-drift regenerates and compares it",
  },
  {
    path: "distribution/feeds/",
    extensions: [".json", ".xml"],
    because: "generated evidence feeds; Feeds freshness regenerates and fails on drift",
  },
  {
    path: ".claude-plugin/marketplace.json",
    because:
      "generated by tools/skills/build-skills-manifest.ts; check:skills-manifest regenerates and compares it",
  },
  // Manifests, lockfiles and pins: the dependency gates judge them.
  {
    path: "Cargo.lock",
    because: "the lockfile; cargo-deny judges it against deny.toml, which is gated",
  },
  {
    path: "bun.lock",
    because: "the lockfile; check-audit-delta judges what a change introduces into it",
  },
  {
    path: "packages/classification/package.json",
    because:
      "the manifest of the classification kernel. Its scripts.check (`bun test src`) is run by no gate: the root `bun test` runs the same tests itself; its dependencies are judged by check-js-licenses and check:dead-code",
  },
  {
    path: "rust-toolchain.toml",
    because:
      "the pinned Rust toolchain: it chooses which clippy version judges, not which lints apply or which code is read; its components only install tools, and a missing one makes the gate fail, not pass",
  },
  {
    path: "tools/licensing/requirements.txt",
    because: "the pinned dependencies of `reuse lint`; versions, not exemptions",
  },
  {
    path: "toolchains/bun.json",
    because:
      "the Bun version with its archive and executable digests, verified by install-toolchains.sh before use",
  },
  {
    path: "toolchains/cargo-deny.json",
    because:
      "the cargo-deny version with its digests, verified by install-toolchains.sh before use",
  },
  {
    path: "toolchains/osv-scanner.json",
    because:
      "the osv-scanner version with its digests, verified by install-toolchains.sh before use",
  },
  {
    path: "toolchains/notebook-qualification.json",
    because:
      "the Node and Playwright versions of the notebook qualification, with their digests, verified by install-toolchains.sh before use",
  },
  {
    path: "toolchains/notebook-resource-classes.json",
    because:
      "the qualification policy of the notebook product (resource classes, minimum candidate class, storage quota); no gate of this repository reads it (`git grep -l notebook-resource-classes` finds records only)",
  },
  {
    path: "toolchains/notices/",
    extensions: [""],
    because: "the checksum notices published with a pinned toolchain",
  },
  {
    path: "crates/ecosystem-engine/contracts-authority.pin.json",
    because: "the pin of the contract authority; check:vendored compares the vendored copy to it",
  },
  {
    path: "crates/ecosystem-engine/vendored/",
    extensions: [".datalog", ".wit"],
    because:
      "the vendored copy of the contract authority, compared to the pinned authority by check:vendored; it is reviewed in its own repository",
  },
  // Evidence, records and documentation data: read by no gate as a policy.
  {
    path: "distribution/evidence/",
    extensions: [".json", ".yaml"],
    because:
      "published measurements (coverage, adoption, sovereignty); the evidence feeds cite them, no gate reads them as a threshold",
  },
  {
    path: "docs/reviews/",
    extensions: [".json", ".txt"],
    because: "frozen evidence of past reviews, under the commit each one reviewed",
  },
  {
    path: "docs/consolidation/",
    extensions: [".json"],
    because: "records of the consolidation; no gate reads them",
  },
  {
    path: "docs/migration/",
    extensions: [".json", ".txt"],
    because:
      "records of the migration and the original licence texts; no gate reads them as a policy",
  },
  {
    path: "docs/security/notebook-core-v2-review/",
    extensions: [".json", ".wit"],
    because: "the material of a security review (schemas and golden output under review)",
  },
  {
    path: "docs/portfolio-material.json",
    because:
      "authored portfolio material; check-retired-repository-names sweeps it as a subject, and its HISTORICAL_ALLOWLIST entry for it lives in code (limit 2)",
  },
  {
    path: "docs/transformation/work-packages.v1.json",
    because:
      "a transformation record; check-objectives requires its presence and reads nothing in it",
  },
  {
    path: "llms.txt",
    because:
      "the public index for language models; check-retired-repository-names sweeps it as a subject, it configures no gate",
  },
  {
    path: "skills/",
    extensions: [".json"],
    because: "evaluation cases of the skills; they relax no gate",
  },
  {
    path: "LICENSE",
    because: "the licence text",
  },
  {
    path: "LICENSES/",
    extensions: [".txt"],
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
    extensions: [".toml"],
    because: "fixtures of the Rust tests",
  },
  {
    path: "distribution/fixtures/",
    extensions: [".json", ".xml"],
    because: "fixtures of the evidence-feed tests",
  },
  {
    path: "ecosystem/fixtures/",
    extensions: [".json", ".toml", ".yaml", ".yml"],
    because: "fixtures of the ecosystem tests",
  },
  {
    path: "tools/attestation/fixtures/",
    extensions: [".json"],
    because: "fixtures of the attestation tests",
  },
  {
    path: "tools/fleet/fixtures/",
    extensions: [".fixture"],
    because: "before and after trees of the fleet-bump tests",
  },
  {
    path: "verification/",
    extensions: [".json"],
    because: "golden reports and questionnaires of the verification harnesses",
  },
];

/** The last extension of the file name: `.json` for `a/b.v1.json`, `""` for `a/LICENSE` and `a/.gitignore`. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

function isDirectory(declaration: NotGated): boolean {
  return declaration.path.endsWith("/");
}

/**
 * Whether a declaration covers a path: equal to it, or under a declared
 * directory with one of the extensions that directory is declared to hold.
 */
export function covers(declaration: NotGated, path: string): boolean {
  if (!isDirectory(declaration)) return path === declaration.path;
  return (
    path.startsWith(declaration.path) && (declaration.extensions ?? []).includes(extensionOf(path))
  );
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
  /** `<directory> <extension>` pairs no declared file carries. */
  readonly staleExtensions: readonly string[];
  /** Gated paths tracked as symbolic links. */
  readonly gatedSymlinks: readonly string[];
}

export function auditInventory(
  tracked: readonly string[],
  declarations: readonly NotGated[] = NOT_GATED,
  symlinks: readonly string[] = [],
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
    if (gatedSet.has(path)) {
      gated.push(path);
      continue;
    }
    if (covering.length > 1) {
      overlapping.push(`${path} (${covering.map((declaration) => declaration.path).join(", ")})`);
    }
    if (covering.length > 0) {
      declared.push(path);
      if (covering.some((declaration) => declaration.awaitingOwnerArbitration === true)) {
        awaiting.push(path);
      }
    } else undeclared.push(path);
  }
  const contradictory: string[] = [];
  const stale: string[] = [];
  const malformed: string[] = [];
  const staleExtensions: string[] = [];
  for (const declaration of declarations) {
    const covered = universe.filter((path) => covers(declaration, path));
    const coveredDeclared = covered.filter((path) => !gatedSet.has(path));
    // An exact declaration of a gated file contradicts the surface; a gated
    // file under a declared directory is simply gated (F7 of the review).
    if (!isDirectory(declaration) && covered.some((path) => gatedSet.has(path))) {
      contradictory.push(declaration.path);
    } else if (coveredDeclared.length === 0) {
      stale.push(declaration.path);
    }
    if (isDirectory(declaration)) {
      for (const extension of declaration.extensions ?? []) {
        if (!coveredDeclared.some((path) => extensionOf(path) === extension)) {
          staleExtensions.push(`${declaration.path} ${JSON.stringify(extension)}`);
        }
      }
    }
    const extensionsMisplaced = isDirectory(declaration)
      ? (declaration.extensions ?? []).length === 0
      : declaration.extensions !== undefined;
    if (
      declaration.path.length === 0 ||
      declaration.path.startsWith("/") ||
      declaration.because.trim().length === 0 ||
      extensionsMisplaced
    ) {
      malformed.push(declaration.path);
    }
  }
  const gatedSymlinks = touchesGatedPaths(symlinks);
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
    staleExtensions,
    gatedSymlinks,
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
      `${audit.undeclared.length} undeclared; ${declarations.length} declaration(s); ` +
      `${audit.gatedSymlinks.length} gated symbolic link(s)`,
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
  for (const path of audit.contradictory) {
    report.check(
      path,
      false,
      "an exact declaration of a gated file: the list says not gated of a file that is",
    );
  }
  for (const path of audit.stale) {
    report.check(path, false, "a declaration that declares no tracked data file: remove it");
  }
  for (const entry of audit.overlapping) {
    report.check(entry, false, "a data file is covered by more than one declaration");
  }
  for (const path of audit.malformed) {
    report.check(
      path || "(empty path)",
      false,
      "a declaration needs a repository-relative path, a reason, and extensions if and only if it is a directory",
    );
  }
  for (const entry of audit.staleExtensions) {
    report.check(entry, false, "a declared extension no file of the directory carries: remove it");
  }
  for (const path of audit.gatedSymlinks) {
    report.check(
      path,
      false,
      "a gated path tracked as a symbolic link: the gate would read its target, which is not on the surface",
    );
  }
  return report;
}

/** One entry of `git ls-files -s -z`: `<mode> <object> <stage>\t<path>`. */
export interface StagedEntry {
  readonly mode: string;
  readonly path: string;
}

/** Parses `git ls-files -s -z`, or returns null on a record it does not recognise. */
export function parseStagedEntries(stdout: string): StagedEntry[] | null {
  const entries: StagedEntry[] = [];
  for (const record of stdout.split("\0")) {
    if (record.length === 0) continue;
    const match = record.match(/^([0-7]{6}) [0-9a-f]{40,64} [0-3]\t(.+)$/s);
    if (match === null) return null;
    entries.push({ mode: match[1] ?? "", path: match[2] ?? "" });
  }
  return entries;
}

export const SYMLINK_MODE = "120000";

if (import.meta.main) {
  const listed = readGit(["ls-files", "-s", "-z"], "list the tracked files");
  if (!listed.ok) {
    console.error(`check-data-inventory: ${listed.reason}`);
    process.exit(1);
  }
  const entries = parseStagedEntries(listed.stdout);
  if (entries === null) {
    console.error(
      "check-data-inventory: `git ls-files -s -z` printed a record this parser does not read",
    );
    process.exit(1);
  }
  if (entries.length === 0) {
    console.error(
      "check-data-inventory: git ls-files listed no file; an empty tree is not an empty inventory",
    );
    process.exit(1);
  }
  const tracked = entries.map((entry) => entry.path);
  const symlinks = entries
    .filter((entry) => entry.mode === SYMLINK_MODE)
    .map((entry) => entry.path);
  concludeGate(
    "Data-file inventory",
    reportInventory(tracked, auditInventory(tracked, NOT_GATED, symlinks)),
  );
}
