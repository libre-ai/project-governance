/**
 * Public truth drift (weekly, `.github/workflows/truth-drift.yml`).
 *
 * Two comparisons with the observable GitHub organization:
 *
 *   manifest   — every `github_status` of `ecosystem/LEGACY-MANIFEST.yaml`
 *                must match the live state of that repository name: a
 *                reserved home present and unarchived, a frozen one present
 *                and archived, a removed or never-published one absent.
 *   inventory  — the public half of `ecosystem/repositories.v1.yaml` must
 *                match the organization's public repositories, both ways.
 *
 * Both used to be inline shell in the workflow, and both had the two defects
 * `tools/quality/gate-report.ts` exists to forbid: the green line printed no
 * volume (the inventory step printed nothing at all), and any failed
 * `gh api` call — rate limit, 5xx, network — read as "absent", which is the
 * PASSING answer for every removed repository. A probe is now an absence
 * only on HTTP 404; any other failure is unreadable and fails the gate.
 *
 * Limit stated, not hidden: with the repository-scoped CI token, GitHub
 * answers 404 for a private repository the token cannot read, exactly as for
 * a deleted one. A `removed-*` entry is therefore verified "absent or private
 * and unreadable" in CI; only an organization-scoped token removes that
 * blind spot.
 *
 * Usage: bun ecosystem/check-truth-drift.ts manifest|inventory
 *        (requires `gh` + GH_TOKEN)
 */

import { concludeGate, GateReport } from "../tools/quality/gate-report";
import { buildIndex } from "./build-index";
import { fetchLiveRepositories, ORGANIZATION } from "./check-inventory-drift";
import { RETRY_DELAYS_MS } from "./github-fleet";

export type ForgeState =
  | { readonly kind: "present"; readonly archived: boolean }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly reason: string };

export interface LegacyEntry {
  /** Bare repository name, the `legacy.` prefix of the manifest id removed. */
  readonly name: string;
  readonly githubStatus: string;
}

export type Expectation = "present-unarchived" | "present-archived" | "absent";

const MANIFEST_SOURCE = "ecosystem/LEGACY-MANIFEST.yaml";
const LEGACY_PREFIX = "legacy.";

// The pinned @types/bun does not declare Bun.YAML yet (same cast as build-index.ts).
const yamlApi = (Bun as unknown as { YAML: { parse(text: string): unknown } }).YAML;

/** Parse the manifest strictly: a malformed entry throws, it is never skipped. */
export function parseLegacyManifest(yamlText: string): LegacyEntry[] {
  const document = yamlApi.parse(yamlText) as { repositories?: unknown } | null;
  const repositories = document?.repositories;
  if (!Array.isArray(repositories)) {
    throw new Error(`${MANIFEST_SOURCE}: expected a repositories sequence`);
  }
  return repositories.map((raw, index) => {
    const entry = raw as { id?: unknown; github_status?: unknown } | null;
    const id = entry?.id;
    if (typeof id !== "string" || !id.startsWith(LEGACY_PREFIX) || id === LEGACY_PREFIX) {
      throw new Error(
        `${MANIFEST_SOURCE}: repositories[${index}].id must be "${LEGACY_PREFIX}<name>", got ${JSON.stringify(id)}`,
      );
    }
    const githubStatus = entry?.github_status;
    if (typeof githubStatus !== "string" || githubStatus.length === 0) {
      throw new Error(`${MANIFEST_SOURCE}: ${id} has no github_status`);
    }
    return { name: id.slice(LEGACY_PREFIX.length), githubStatus };
  });
}

/** `null` for a status this gate does not know: it must fail, never pass silently. */
export function expectationFor(githubStatus: string): Expectation | null {
  if (githubStatus === "reserved-active-product-home") return "present-unarchived";
  if (githubStatus === "frozen-reserved-product-home") return "present-archived";
  // A never-published repository has no forge identity; its name appearing
  // in the organization would be a new repository squatting a legacy name.
  if (githubStatus.startsWith("removed-") || githubStatus === "never-published") return "absent";
  return null;
}

function describeLive(state: ForgeState): string {
  if (state.kind === "absent") return "absent";
  if (state.kind === "unreadable") return "unreadable";
  return state.archived ? "present-archived" : "present-unarchived";
}

const EXPECTATION_TEXT: Record<Expectation, string> = {
  "present-unarchived": "present and unarchived",
  "present-archived": "present and archived",
  absent: "absent",
};

export function auditManifest(
  entries: readonly LegacyEntry[],
  observed: ReadonlyMap<string, ForgeState>,
  privateSkip: ReadonlySet<string>,
): GateReport {
  const report = new GateReport();
  let expectedPresent = 0;
  let expectedAbsent = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (privateSkip.has(entry.name)) {
      skipped++;
      console.log(`SKIP ${entry.name} (private, unreadable with the repository token)`);
      continue;
    }
    const expectation = expectationFor(entry.githubStatus);
    if (expectation === null) {
      report.check(
        entry.name,
        false,
        `unknown github_status '${entry.githubStatus}', no expected forge state`,
      );
      continue;
    }
    if (expectation === "absent") expectedAbsent++;
    else expectedPresent++;
    const state = observed.get(entry.name);
    if (state === undefined) {
      report.check(entry.name, false, "never probed, nothing compared");
      continue;
    }
    if (state.kind === "unreadable") {
      report.check(entry.name, false, `unreadable (${state.reason}), nothing compared`);
      continue;
    }
    const live = describeLive(state);
    const holds = expectation === "absent" ? state.kind === "absent" : live === expectation;
    report.check(
      entry.name,
      holds,
      `expected ${EXPECTATION_TEXT[expectation]} (${entry.githubStatus}), live=${live}`,
    );
  }
  report.volume(
    `${entries.length} manifest entries read, ${expectedPresent + expectedAbsent} compared ` +
      `with the live organization (${expectedPresent} expected present, ` +
      `${expectedAbsent} expected absent), ${skipped} skipped as private`,
  );
  return report;
}

export function auditInventory(
  declaredPublic: readonly string[],
  livePublic: readonly string[],
  observed: ReadonlyMap<string, ForgeState>,
): GateReport {
  const report = new GateReport();
  // Either side empty is a broken read (a moved file, a failed listing), not
  // an agreement: the organization holds this very repository.
  if (declaredPublic.length === 0) {
    report.check(
      "repositories.v1.yaml",
      false,
      "declares no public repository, the comparison asserted nothing",
    );
  }
  if (livePublic.length === 0) {
    report.check(
      `${ORGANIZATION} organization`,
      false,
      "no public repository observed, the listing asserted nothing",
    );
  }
  const declared = new Set(declaredPublic);
  for (const name of livePublic) {
    report.check(
      name,
      declared.has(name),
      declared.has(name)
        ? "public and declared public"
        : "public repository absent from repositories.v1.yaml",
    );
  }
  for (const name of declaredPublic) {
    const state = observed.get(name);
    if (state === undefined) {
      report.check(name, false, "never probed, nothing compared");
    } else if (state.kind === "unreadable") {
      report.check(name, false, `unreadable (${state.reason}), nothing compared`);
    } else {
      report.check(
        name,
        state.kind === "present",
        state.kind === "present"
          ? "declared public and observable"
          : "inventory declares it public but it is not observable",
      );
    }
  }
  report.volume(
    `${declaredPublic.length} declared public repositories compared with ` +
      `${livePublic.length} observed public in the ${ORGANIZATION} organization`,
  );
  return report;
}

/** Pure classification of one `gh api repos/<org>/<name> --jq .archived` run. */
export function classifyProbe(exitCode: number, stdout: string, stderr: string): ForgeState {
  if (exitCode === 0) {
    const body = stdout.trim();
    if (body === "true" || body === "false") return { kind: "present", archived: body === "true" };
    return { kind: "unreadable", reason: `unexpected response ${JSON.stringify(body)}` };
  }
  if (/\(HTTP 404\)/.test(stderr)) return { kind: "absent" };
  return { kind: "unreadable", reason: stderr.trim() || `gh api exited ${exitCode}` };
}

async function probe(name: string): Promise<ForgeState> {
  let state: ForgeState = { kind: "unreadable", reason: "not attempted" };
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const proc = Bun.spawn(["gh", "api", `repos/${ORGANIZATION}/${name}`, "--jq", ".archived"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    state = classifyProbe(exitCode, stdout, stderr);
    // A 404 is an answer, not a transient failure: only unreadable retries.
    if (state.kind !== "unreadable") return state;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await Bun.sleep(wait);
  }
  return state;
}

async function probeAll(names: readonly string[]): Promise<Map<string, ForgeState>> {
  const observed = new Map<string, ForgeState>();
  for (const name of names) observed.set(name, await probe(name));
  return observed;
}

/**
 * Names exempted from the manifest probe because the repository token cannot
 * read them. Empty since `policy` was deleted on 2026-09-16: no manifest entry
 * is a live private repository any more.
 */
const PRIVATE_SKIP: ReadonlySet<string> = new Set();

async function runManifest(): Promise<void> {
  const entries = parseLegacyManifest(
    await Bun.file(new URL("LEGACY-MANIFEST.yaml", import.meta.url)).text(),
  );
  const observed = await probeAll(
    entries.map((entry) => entry.name).filter((name) => !PRIVATE_SKIP.has(name)),
  );
  concludeGate("Legacy manifest drift", auditManifest(entries, observed, PRIVATE_SKIP));
}

async function runInventory(): Promise<void> {
  const yamlText = await Bun.file(new URL("repositories.v1.yaml", import.meta.url)).text();
  const declaredPublic = buildIndex(yamlText)
    .repositories.filter((entry) => entry.visibility === "public")
    .map((entry) => {
      const [owner, name] = entry.repository.split("/");
      if (owner !== ORGANIZATION || name === undefined || name.length === 0) {
        throw new Error(
          `inventory entry outside the ${ORGANIZATION} organization: ${entry.repository}`,
        );
      }
      return name;
    });
  const livePublic = (await fetchLiveRepositories())
    .filter((repository) => !repository.isPrivate)
    .map((repository) => repository.name)
    .sort();
  const observed = await probeAll(declaredPublic);
  concludeGate("Public inventory drift", auditInventory(declaredPublic, livePublic, observed));
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode === "manifest") await runManifest();
  else if (mode === "inventory") await runInventory();
  else {
    console.error("usage: bun ecosystem/check-truth-drift.ts manifest|inventory");
    process.exit(2);
  }
}
