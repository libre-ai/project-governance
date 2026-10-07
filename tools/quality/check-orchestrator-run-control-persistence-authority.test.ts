import { describe, expect, test } from "bun:test";

interface WorkPackage {
  readonly id: string;
  readonly dependsOn: readonly string[];
  readonly definitionStatus: string;
  readonly humanGates: readonly string[];
  readonly writePaths: readonly string[];
}

interface WorkPackagePlan {
  readonly packages: readonly WorkPackage[];
}

const runControlWritePath = "crates/agent-orchestrator-run/**";
const runControlRoot = "crates/agent-orchestrator-run";
const transferredFromPureCorePaths = [
  "Cargo.toml",
  "Cargo.lock",
  "package.json",
  "README.md",
  "docs/apps/orchestrator.md",
  "project.v1.yaml",
] as const;
const expectedRunControlWritePaths = [
  runControlWritePath,
  ...transferredFromPureCorePaths,
  ".github/workflows/ci.yml",
  "docs/reviews/orchestrator-run-control-persistence/**",
  "tools/quality/rust-coverage-gate.test.ts",
  "verification/agent-orchestrator/check-run-capabilities.ts",
  "verification/agent-orchestrator/run-capability-boundary.test.ts",
  "verification/agent-orchestrator/with-postgres.sh",
  "verification/agent-orchestrator/benchmark-memory.sh",
  "verification/agent-orchestrator/review-evidence.test.ts",
] as const;
const expectedDeclaredPathOwners = ["WP-G2-T01", "WP-G2-Q01", "WP-G2-A01", "WP-G3-O01"] as const;

function staticPrefix(writePath: string): string {
  const wildcardIndexes = ["*", "?", "[", "{"].map((marker) => writePath.indexOf(marker));
  const firstWildcard = Math.min(
    ...wildcardIndexes.filter((index) => index >= 0),
    writePath.length,
  );

  return writePath.slice(0, firstWildcard).replace(/\/$/, "");
}

function overlapProbes(writePath: string): readonly string[] {
  const prefix = staticPrefix(writePath);
  if (prefix === writePath) {
    return [writePath, `${writePath}/__authority_probe__`];
  }
  if (prefix.length === 0) {
    return ["__authority_probe__", "crates/agent-orchestrator-run/__authority_probe__"];
  }

  return [prefix, `${prefix}/__authority_probe__`];
}

function writePathsOverlap(left: string, right: string): boolean {
  const leftGlob = new Bun.Glob(left);
  const rightGlob = new Bun.Glob(right);
  const probes = new Set([...overlapProbes(left), ...overlapProbes(right)]);

  if ([...probes].some((probe) => leftGlob.match(probe) && rightGlob.match(probe))) {
    return true;
  }

  const containsWildcard = (writePath: string): boolean => /[*?[{]/.test(writePath);
  if (!containsWildcard(left) || !containsWildcard(right)) {
    return false;
  }

  const leftPrefix = staticPrefix(left);
  const rightPrefix = staticPrefix(right);
  // Glob intersection is not available from Bun.Glob. When both patterns can
  // share a character prefix before either wildcard, ownership must fail
  // closed even if a finite probe does not satisfy their suffixes. Requiring
  // a path-segment boundary here would miss wildcards inside a component.
  return (
    leftPrefix.length === 0 ||
    rightPrefix.length === 0 ||
    leftPrefix.startsWith(rightPrefix) ||
    rightPrefix.startsWith(leftPrefix)
  );
}

function findDeclaredRunControlPathOwners(plan: WorkPackagePlan): readonly WorkPackage[] {
  return plan.packages.filter((entry) =>
    entry.writePaths.some((candidate) =>
      expectedRunControlWritePaths.some((authorized) => writePathsOverlap(candidate, authorized)),
    ),
  );
}

function overlapsRunControlBoundary(writePath: string): boolean {
  if (writePath === runControlRoot || writePath.startsWith(`${runControlRoot}/`)) {
    return true;
  }

  const glob = new Bun.Glob(writePath);
  if (glob.match(runControlRoot) || glob.match(`${runControlRoot}/__authority_probe__`)) {
    return true;
  }

  const wildcardIndexes = ["*", "?", "[", "{"].map((marker) => writePath.indexOf(marker));
  const firstWildcard = Math.min(
    ...wildcardIndexes.filter((index) => index >= 0),
    writePath.length,
  );
  if (firstWildcard === writePath.length) {
    return false;
  }
  const staticPrefix = writePath.slice(0, firstWildcard);

  return staticPrefix.length === 0 || runControlRoot.startsWith(staticPrefix);
}

function findRunControlOwners(plan: WorkPackagePlan): readonly WorkPackage[] {
  return plan.packages.filter((entry) =>
    entry.writePaths.some((writePath) => overlapsRunControlBoundary(writePath)),
  );
}

function hasExpectedAdrTitle(adr: string): boolean {
  return adr.startsWith("# ADR-0040 — Persistance du contrôle de run Orchestrator\n");
}

function hasSingleD45Entry(decisionRegister: string): boolean {
  return decisionRegister.split("\n").filter((line) => line.startsWith("| D45 |")).length === 1;
}

async function adrPathsForNumber(expectedNumber: string): Promise<readonly string[]> {
  const owners: string[] = [];
  for await (const path of new Bun.Glob("docs/adr/*.md").scan(".")) {
    const firstLine = (await Bun.file(path).text()).split("\n", 1)[0] ?? "";
    const number = /^# ADR-(\d{4})\b/.exec(firstLine)?.[1];
    if (number === expectedNumber) {
      owners.push(path);
    }
  }

  return owners.sort();
}

describe("orchestrator run-control persistence authority", () => {
  test("binds the direct SQLx component profile and final-consumer graph proof", async () => {
    const [adr, decisionRegister, design, implementationPlan] = await Promise.all([
      Bun.file("docs/adr/0040-orchestrator-run-control-persistence.md").text(),
      Bun.file("docs/decisions/DECISION-REGISTER.md").text(),
      Bun.file(
        "docs/superpowers/specs/2026-09-11-orchestrator-run-control-persistence-design.md",
      ).text(),
      Bun.file("docs/superpowers/plans/2026-09-11-orchestrator-run-control-persistence.md").text(),
    ]);
    const exactCoreDeclaration =
      'sqlx-core = { version = "=0.9.0", default-features = false, features = ["_rt-tokio", "json", "chrono"] }';
    const exactPostgresDeclaration =
      'sqlx-postgres = { version = "=0.9.0", default-features = false, features = ["json", "chrono"] }';
    const normalizedAdr = adr.replace(/\s+/g, " ");
    const normalizedDesign = design.replace(/\s+/g, " ");
    const normalizedPlan = implementationPlan.replace(/\s+/g, " ");

    expect(implementationPlan).toContain(exactCoreDeclaration);
    expect(implementationPlan).toContain(exactPostgresDeclaration);
    expect(implementationPlan).not.toMatch(/^sqlx\s*=/m);
    expect(implementationPlan).not.toContain('features = ["runtime-tokio", "postgres"');
    expect(implementationPlan).toContain("use sqlx_core::connection::ConnectOptions;");
    expect(implementationPlan).toContain("use sqlx_core::raw_sql::raw_sql;");
    expect(implementationPlan).toContain(
      "use sqlx_postgres::{PgConnectOptions, PgConnection, PgPool, PgPoolOptions, PgSslMode, Postgres};",
    );
    expect(implementationPlan).toContain('raw_sql("DISCARD ALL")');
    expect(implementationPlan).not.toContain('sqlx::raw_sql("DISCARD ALL")');
    expect(implementationPlan).not.toContain("use sqlx::postgres::PgConnectOptions");
    expect(implementationPlan).toContain("sqlx::postgres::notice");

    for (const authority of [adr, decisionRegister, design, implementationPlan]) {
      expect(authority).toContain("2026-09-11");
      expect(authority).toContain("sqlx-core");
      expect(authority).toContain("sqlx-postgres");
      expect(authority).toContain("semver-exempt");
      expect(authority).toContain("_rt-tokio");
    }

    expect(normalizedAdr).toContain("active inconditionnellement `sqlx-core/migrate`");
    expect(normalizedAdr).toContain("deux sites `eprintln!`");
    expect(adr).not.toContain("observed API leak");
    expect(design).toContain("does not prove an observed API leak");
    expect(normalizedDesign).toContain("compile availability and known module exclusion only");
    expect(normalizedDesign).toContain("not an end-to-end or complete dependency-source proof");
    expect(normalizedDesign).toContain("complete requalification on every component update");
    expect(normalizedDesign).toContain(
      "Cargo metadata package superset is not the selected build graph",
    );
    expect(normalizedDesign).toContain("lockfile-only packages are not selected-graph failures");
    expect(normalizedDesign).toContain("debug, release and dev `tracing/log-always`");

    expect(normalizedPlan).toContain("separate same-graph consumer");
    expect(normalizedPlan).toContain("facade introduced by another consumer");
    expect(normalizedPlan).toContain("direct `sqlx-core/migrate`");
    expect(normalizedPlan).toContain("direct `sqlx-postgres/migrate`");
    expect(normalizedPlan).toContain("duplicate SQLx component versions");
    expect(normalizedPlan).toContain("TLS or any extra feature");
    expect(normalizedPlan).toContain("fails closed");
    expect(normalizedPlan).toContain(
      "`sqlx-core/default` may appear through `sqlx-postgres`, but it is empty in 0.9.0",
    );
    expect(normalizedPlan).toContain(
      "compare concrete effective feature closures, not isolated feature names",
    );
    expect(normalizedPlan).toContain("truly unselected `cfg` branches");
    expect(normalizedPlan).toContain("no directory named `testing` is exempt");
    expect(normalizedPlan).toContain("four production blockers remain unchanged");
  });

  test("detects every ownership pattern that overlaps the runtime boundary", () => {
    const plan: WorkPackagePlan = {
      packages: [
        {
          id: "parent-owner",
          dependsOn: [],
          definitionStatus: "locked",
          humanGates: [],
          writePaths: ["crates/**"],
        },
        {
          id: "child-owner",
          dependsOn: [],
          definitionStatus: "locked",
          humanGates: [],
          writePaths: ["crates/agent-orchestrator-run/src/**"],
        },
        {
          id: "wildcard-owner",
          dependsOn: [],
          definitionStatus: "locked",
          humanGates: [],
          writePaths: ["crates/agent-*/**"],
        },
        {
          id: "global-owner",
          dependsOn: [],
          definitionStatus: "locked",
          humanGates: [],
          writePaths: ["**"],
        },
        {
          id: "nested-wildcard-owner",
          dependsOn: [],
          definitionStatus: "locked",
          humanGates: [],
          writePaths: ["crates/*/src/**"],
        },
        {
          id: "wildcard-file-owner",
          dependsOn: [],
          definitionStatus: "locked",
          humanGates: [],
          writePaths: ["crates/agent-*/Cargo.toml"],
        },
        {
          id: "suffix-owner",
          dependsOn: [],
          definitionStatus: "locked",
          humanGates: [],
          writePaths: ["**/*.rs"],
        },
        {
          id: "brace-owner",
          dependsOn: [],
          definitionStatus: "locked",
          humanGates: [],
          writePaths: ["crates/{agent-orchestrator-run,agent-harness}/**"],
        },
        {
          id: "sibling-owner",
          dependsOn: [],
          definitionStatus: "locked",
          humanGates: [],
          writePaths: ["crates/agent-harness/**"],
        },
        {
          id: "literal-sibling-owner",
          dependsOn: [],
          definitionStatus: "locked",
          humanGates: [],
          writePaths: ["crates/agent-orchestrator"],
        },
      ],
    };

    expect(findRunControlOwners(plan).map((entry) => entry.id)).toEqual([
      "parent-owner",
      "child-owner",
      "wildcard-owner",
      "global-owner",
      "nested-wildcard-owner",
      "wildcard-file-owner",
      "suffix-owner",
      "brace-owner",
    ]);
  });

  test("detects an unexpected exact or glob owner of support paths", () => {
    const packageFixture = (id: string, writePaths: readonly string[]): WorkPackage => ({
      id,
      dependsOn: [],
      definitionStatus: "locked",
      humanGates: [],
      writePaths,
    });
    const plan: WorkPackagePlan = {
      packages: [
        packageFixture("WP-G3-O01", expectedRunControlWritePaths),
        packageFixture("unexpected-exact-owner", ["README.md"]),
        packageFixture("unexpected-glob-owner", ["verification/agent-orchestrator/**"]),
        packageFixture("unexpected-suffix-owner", [
          "docs/reviews/orchestrator-run-control-persistence/*/security.md",
        ]),
        packageFixture("unexpected-component-wildcard-owner", [
          "docs/reviews/orchestrator-*/**/security.md",
        ]),
        packageFixture("unrelated-owner", ["crates/agent-harness/**"]),
      ],
    };
    const sharedWitness = "docs/reviews/orchestrator-run-control-persistence/abcdef0/security.md";

    expect(
      new Bun.Glob("docs/reviews/orchestrator-*/**/security.md").match(sharedWitness),
    ).toBeTrue();
    expect(
      new Bun.Glob("docs/reviews/orchestrator-run-control-persistence/**").match(sharedWitness),
    ).toBeTrue();

    expect(findDeclaredRunControlPathOwners(plan).map((entry) => entry.id)).toEqual([
      "WP-G3-O01",
      "unexpected-exact-owner",
      "unexpected-glob-owner",
      "unexpected-suffix-owner",
      "unexpected-component-wildcard-owner",
    ]);
  });

  test("binds ADR-0040, D45 and only the locked runtime work package", async () => {
    const [adr, decisionRegister, design, implementationPlan, plan] = await Promise.all([
      Bun.file("docs/adr/0040-orchestrator-run-control-persistence.md").text(),
      Bun.file("docs/decisions/DECISION-REGISTER.md").text(),
      Bun.file(
        "docs/superpowers/specs/2026-09-11-orchestrator-run-control-persistence-design.md",
      ).text(),
      Bun.file("docs/superpowers/plans/2026-09-11-orchestrator-run-control-persistence.md").text(),
      Bun.file("docs/transformation/work-packages.v1.json").json() as Promise<WorkPackagePlan>,
    ]);
    const workPackage = plan.packages.find((entry) => entry.id === "WP-G3-O01");
    const pureCorePackage = plan.packages.find((entry) => entry.id === "WP-G3-O02");
    const runControlOwners = findRunControlOwners(plan);
    const declaredPathOwners = findDeclaredRunControlPathOwners(plan);

    expect(hasExpectedAdrTitle(adr)).toBeTrue();
    expect(hasExpectedAdrTitle("")).toBeFalse();
    expect(await adrPathsForNumber("0040")).toEqual([
      "docs/adr/0040-orchestrator-run-control-persistence.md",
    ]);
    expect(hasSingleD45Entry(decisionRegister)).toBeTrue();
    expect(decisionRegister).toContain(
      "| D45 | Run-control persistence is isolated and non-executing",
    );
    expect(design).toContain("authority ADR-0040/D45");
    expect(adr).toContain("max_level_off");
    expect(adr).toContain("PgSslMode::Disable");
    expect(design).toContain("tracing::level_filters::STATIC_MAX_LEVEL");
    expect(design).toContain("log::STATIC_MAX_LEVEL");
    expect(design).toContain("global downstream effect");
    expect(design).toContain("Unix-domain socket");
    expect(design).toContain("TLS transport");
    expect(design).toContain("Every TLS implementation");
    expect(design).toContain("never invokes `to_url_lossy`");
    expect(design).not.toContain("PgConnectOptions::to_url_lossy()");
    expect(decisionRegister).toContain("diagnostics globally off");
    expect(decisionRegister).toContain("Unix-domain socket only");
    expect(adr).toContain("faits de rétention immuables");
    expect(design).toContain("### 7.2 `run_retention_facts`");
    expect(design.replace(/\s+/g, " ")).toContain(
      "execution projections from `run_events` and the lifecycle projection from `run_retention_facts`",
    );
    expect(design).toContain("No role receives table-wide `UPDATE` on `runs`");
    expect(design).toContain("exact retention observation is already recorded");
    expect(implementationPlan).toContain("exact retention observation is already recorded");
    expect(adr).toContain("enfant direct strictement evidence-only");
    expect(implementationPlan).toContain("pub struct LedgerPageRequest");
    expect(implementationPlan).toContain("pub struct ReferencePageRequest");
    expect(implementationPlan).toContain("pub struct RunSweepPageRequest");
    expect(implementationPlan).toContain("expire_tombstones");
    expect(implementationPlan).toContain("Task 11 owns the first restore implementation");
    expect(implementationPlan).toContain("max_buffered_rows");
    expect(implementationPlan).toContain("orchestrator_run_test_support");
    expect(design).not.toContain("It cannot `UPDATE` or `DELETE` a tombstone");
    expect(implementationPlan).toContain(
      "byte-for-byte unchanged outside the status scalar and evidence mapping CST ranges",
    );
    expect(implementationPlan).not.toContain("implemented-review-pending");
    expect(implementationPlan).not.toContain("implementation_sha:");
    expect(implementationPlan).toContain("struct ScanStats");
    expect(implementationPlan).toContain("page.len() > batch_size");
    expect(implementationPlan).toContain("single-page lease");
    expect(implementationPlan).toContain("drop-counted rows");
    expect(implementationPlan).toContain("purged_rows");
    expect(implementationPlan).toContain("clear_cached_statements");
    expect(implementationPlan).toContain("disable_statement_logging");
    expect(implementationPlan).toContain('log = { version = "=0.4.33"');
    expect(implementationPlan).toContain('tracing = { version = "=0.1.44"');
    expect(implementationPlan).toContain('features = ["max_level_off", "release_max_level_off"]');
    expect(implementationPlan).toContain("tracing::level_filters::STATIC_MAX_LEVEL");
    expect(implementationPlan).toContain("log::STATIC_MAX_LEVEL");
    expect(implementationPlan).toContain(
      'sqlx-core = { version = "=0.9.0", default-features = false, features = ["_rt-tokio", "json", "chrono"] }',
    );
    expect(implementationPlan).toContain(
      'sqlx-postgres = { version = "=0.9.0", default-features = false, features = ["json", "chrono"] }',
    );
    expect(implementationPlan).not.toContain("tls-rustls-ring-webpki");
    expect(implementationPlan).not.toContain("tls-rustls-ring-native-roots");
    expect(implementationPlan).toContain("Never call `to_url_lossy`");
    expect(implementationPlan).not.toContain("options.to_url_lossy().query_pairs()");
    expect(implementationPlan).toContain("get_socket()");
    expect(implementationPlan).toContain("PgSslMode::Disable");
    expect(implementationPlan).toContain("Unix-domain socket only");
    expect(implementationPlan).toContain("TLS transport");
    expect(implementationPlan).toContain('host("[")');
    expect(implementationPlan).toContain("tracing-subscriber =");
    expect(implementationPlan).toContain("positive control");
    expect(implementationPlan).toContain("direct collector APIs");
    expect(implementationPlan).toContain("RAISE INFO");
    expect(implementationPlan).toContain("sqlx::postgres::notice");
    expect(implementationPlan).toContain("debug and release");
    expect(implementationPlan).toContain("log-always");
    expect(implementationPlan).toContain(
      'RUSTDOCFLAGS="-D warnings" cargo doc --quiet --locked --workspace --all-features --no-deps',
    );
    expect(implementationPlan).toContain(
      "cargo test --locked --workspace --all-features -- --test-threads=1",
    );
    expect(implementationPlan).toContain(
      "cargo test --release --locked --workspace --all-features -- --test-threads=1",
    );
    expect(
      implementationPlan.match(
        /--fail-under-lines 87 --fail-under-functions 90 -- --test-threads=1/g,
      ) ?? [],
    ).toHaveLength(4);
    expect(implementationPlan).toContain(
      'cargo llvm-cov report -p libre-ai-agent-orchestrator-run --summary-only | tee -a "$GITHUB_STEP_SUMMARY"',
    );
    expect(implementationPlan).not.toContain(
      "cargo llvm-cov report -p libre-ai-agent-orchestrator-run \\\n      --all-features",
    );
    expect(implementationPlan.replace(/\s+/g, " ")).toContain(
      "run: | set -euo pipefail verification/agent-orchestrator/with-postgres.sh --",
    );
    expect(implementationPlan.replace(/\s+/g, " ")).toContain(
      "The release test graph includes the dev dependency that activates `tracing/log-always`",
    );
    expect(implementationPlan).toContain("global downstream effect");
    expect(implementationPlan).toContain("driver that preserves safe downstream diagnostics");
    expect(adr.replace(/\s+/g, " ")).toContain("quatrième blocage production");
    expect(design).toContain("role-provisioning compatibility");
    expect(implementationPlan).toContain("four production blockers");
    expect(implementationPlan).toContain("provider attestation");
    expect(design).toContain("pg_roles.rolcanlogin");
    expect(design).toContain("pg_auth_members");
    expect(design).toContain("information_schema.column_privileges");
    expect(design).toContain("information_schema.routine_privileges");
    expect(design).toContain("pg_attribute.attacl");
    expect(design).toContain("pg_class.relowner");
    expect(design).toContain("pg_database.datdba");
    expect(design).toContain("pg_extension.extowner");
    expect(design).toContain("pg_parameter_acl");
    expect(design).toContain("pg_db_role_setting");
    expect(design).toContain("has_column_privilege");
    expect(design).toContain("has_database_privilege");
    expect(design).toContain("has_parameter_privilege");
    expect(design).toContain("session_replication_role");
    expect(design).toContain("inherit_option");
    expect(design).toContain("set_option");
    expect(design).toContain("session_replication_role = 'origin'");
    expect(design).toContain("rolcreaterole");
    expect(design).toContain("rolcreatedb");
    expect(design).toContain("rolreplication");
    expect(design).toContain("rolinherit");
    expect(design).toContain("rolconfig");
    expect(adr).toContain("NOCREATEROLE");
    expect(design).toContain("pg_extension");
    expect(implementationPlan).toContain("forbidden extra column grant");
    expect(implementationPlan).toContain("forbidden database owner");
    expect(implementationPlan).toContain("forbidden extension owner");
    expect(implementationPlan).toContain("forbidden parameter grant");
    expect(implementationPlan).toContain("membership option mismatch");
    expect(implementationPlan).toContain("role-and-database default");
    expect(implementationPlan).toContain("database-wide default");
    expect(implementationPlan).toContain("CREATEROLE");
    expect(implementationPlan).toContain(
      "current local review does not require provider attestation",
    );
    expect(implementationPlan).toContain('"check:run-review-evidence"');
    expect(implementationPlan).toContain(
      "bun test verification/agent-orchestrator/review-evidence.test.ts",
    );
    expect(implementationPlan).toContain("run-review-evidence");
    expect(implementationPlan).toContain(
      "crates/agent-orchestrator-run/examples/uds_persistence.rs",
    );
    expect(implementationPlan).toContain(
      "cargo check --locked -p libre-ai-agent-orchestrator-run --example uds_persistence",
    );
    expect(implementationPlan).toContain("run-example-check");
    expect(implementationPlan).toContain(
      "production `src/**/*.rs` and the exact package-owned `examples/uds_persistence.rs`",
    );
    expect(implementationPlan).toContain(
      "capability-forbidden:examples/uds_persistence.rs:environment",
    );
    expect(implementationPlan).toContain(
      "capability-forbidden:examples/uds_persistence.rs:filesystem",
    );
    expect(implementationPlan).toContain(
      "capability-forbidden:examples/uds_persistence.rs:network",
    );
    expect(implementationPlan).toContain(
      "capability-forbidden:examples/uds_persistence.rs:emission",
    );
    expect(implementationPlan).toContain(
      "capability-forbidden:examples/uds_persistence.rs:connection-secret",
    );
    expect(implementationPlan).toContain(
      "capability-forbidden:examples/uds_persistence.rs:startup-options",
    );
    expect(implementationPlan).toContain(
      "capability-forbidden:examples/uds_persistence.rs:url-formatting",
    );
    expect(implementationPlan).toContain("unexpected-example:examples/other.rs");
    expect(implementationPlan).toContain("caller-injected `PgConnectOptions`");
    expect(implementationPlan).toContain(
      "capability-forbidden:src/pool.rs:ambient-connect-options",
    );
    expect(implementationPlan).toContain(
      "capability-forbidden:examples/uds_persistence.rs:ambient-connect-options",
    );
    expect(implementationPlan).toContain("new_without_pgpass");
    expect(implementationPlan).toContain("Default::default");
    expect(implementationPlan).toContain("FromStr::from_str");
    expect(implementationPlan).not.toContain("receipt_digest: Digest, deleted_at: DateTime<Utc>");
    expect(design).toContain("caller supplies no deletion timestamp");
    expect(implementationPlan).toContain("clock_timestamp()` after acquiring");
    expect(implementationPlan).toContain("delayed authenticated receipt");
    expect(implementationPlan).toContain("concurrent lock wait");
    expect(design).toContain("SnapshotRetirementFact");
    expect(adr).toContain("SnapshotRetirementFact");
    expect(design).toContain("libre-ai.snapshot-retirement.v1\\0");
    expect(implementationPlan).toContain("execution_snapshot_digest");
    expect(design.replace(/\s+/g, " ")).toContain("no admissible execution snapshot can contain");
    expect(implementationPlan).toContain("snapshot between tombstone capture and deletion commit");
    expect(design.replace(/\s+/g, " ")).toContain(
      "validates only bounds, ordering and internal digests",
    );
    expect(implementationPlan).toContain("does not infer catalog authenticity or freshness");
    expect(implementationPlan).not.toContain("wrong-catalog");
    expect(decisionRegister).toContain("role-provisioning compatibility");
    expect(implementationPlan).toContain("println!");
    expect(implementationPlan).toContain("immutable-role-review");
    expect(implementationPlan).toContain("interval '840 hours'");
    expect(implementationPlan).not.toContain(
      "CHECK (expires_at = deleted_at + interval '35 days')",
    );
    expect(implementationPlan).toContain("listen_addresses=''");
    expect(implementationPlan).toContain("--auth-host=reject");
    expect(design).toContain("does not persist replay phase");
    expect(implementationPlan).not.toContain("pub enum RunPhase");
    expect(implementationPlan).toContain("delete_lineage_with_tombstone");
    expect(implementationPlan).toContain("O(tombstones + runs * log(tombstones))");
    expect(implementationPlan).toContain("WP-G3-H01 remains a prerequisite for every later slice");
    expect(implementationPlan).toContain(
      "every changed path against the exact WP-G3-O01 writePaths",
    );
    expect(design).toContain("WP-G2-T01`, `WP-G2-Q01` and `WP-G2-A01`");
    expect(design).toContain("hub-era paths are not concurrent satellite write authority");
    expect(implementationPlan).toContain("ADR-0020 satellite precedence rule");
    expect(implementationPlan).toContain("guard lock-only grant");
    expect(implementationPlan).toContain("SELECT(tenant_id, run_id)` on `runs`");
    expect(implementationPlan).toContain("pg_advisory_xact_lock");
    expect(implementationPlan).toContain(
      "sorts and deduplicates them by immutable signed numeric value",
    );
    expect(implementationPlan).toContain(
      "mutable deadline cursor order remains separate from lock order",
    );
    expect(implementationPlan).toContain("transaction_isolation");
    expect(implementationPlan).toContain("READ COMMITTED");
    expect(implementationPlan).toContain("VOLATILE");
    expect(implementationPlan).toContain("historical duplicate compares the replayed current head");
    expect(implementationPlan).toContain("commands/manifest.json");
    expect(implementationPlan).toContain("scan every tracked UTF-8 byte of the dossier");
    expect(implementationPlan).toContain("recursively scan every decoded JSON string");
    expect(implementationPlan).toContain("POSIX and Windows absolute machine paths");
    expect(implementationPlan).toContain("reject duplicate object names after decoding");
    expect(implementationPlan).toContain("byte-for-byte RFC 8785 representation");
    expect(implementationPlan).toContain("overwritten first value");
    expect(implementationPlan).toContain(
      "benchmark.csv`, every review Markdown file, `commands/manifest.json` and `commands/*.txt`",
    );
    expect(implementationPlan).toContain('git merge-base --is-ancestor "$I" origin/main');
    expect(implementationPlan).toContain('git merge-base --is-ancestor "$E" origin/main');
    expect(implementationPlan).toContain(
      "cargo llvm-cov --locked -p libre-ai-agent-orchestrator-run --all-features --lcov",
    );
    expect(implementationPlan).toContain(
      "workspace coverage passes while the run-store package coverage fails",
    );
    expect(workPackage?.definitionStatus).toBe("locked");
    expect(workPackage?.dependsOn).toEqual([
      "WP-G2-Q01",
      "WP-G2-D01",
      "WP-G2-A01",
      "WP-G3-H01",
      "WP-G3-O02",
    ]);
    expect(workPackage?.humanGates).toEqual(["layer-2-bootstrap-security-merge"]);
    expect(workPackage?.writePaths).toEqual(expectedRunControlWritePaths);
    for (const transferredPath of transferredFromPureCorePaths) {
      expect(pureCorePackage?.writePaths).not.toContain(transferredPath);
    }
    expect(runControlOwners.map((entry) => entry.id)).toEqual(["WP-G3-O01"]);
    expect(declaredPathOwners.map((entry) => entry.id)).toEqual([...expectedDeclaredPathOwners]);
  });
});
