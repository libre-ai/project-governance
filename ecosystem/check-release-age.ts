/**
 * Release-age guard across the fleet (threat triage 2026-10-09, menace 6;
 * owner arbitration 2026-10-10).
 *
 * `minimumReleaseAge = 259200` (three days) is what keeps a freshly published,
 * not-yet-reported malicious version out of a `bun install` that resolves. It
 * lives in each repository's `bunfig.toml`, and until this gate nothing checked
 * it: the triage found it "gardé par aucun gate", and the first measurement of
 * this gate (2026-10-10) found one workspace root that set `linker` and no
 * release age at all, three install roots with a `bun.lock` and no `bunfig.toml`,
 * and five test-only `bunfig.toml` files.
 *
 * For every active, public entry of `ecosystem/repositories.v1.yaml`:
 *
 *   1. every tracked `bunfig.toml` (any depth) is read at `HEAD` and must carry
 *      `[install] minimumReleaseAge >= 259200`, and either no
 *      `minimumReleaseAgeExcludes` or a list whose every package is declared in
 *      `ecosystem/release-age-exceptions.v1.yaml` for that file, with a reason;
 *   2. every directory holding a tracked `bun.lock` (an install root) must hold
 *      a tracked `bunfig.toml` — Bun reads the configuration of the directory it
 *      runs in, so a lockfile next to no configuration installs unguarded.
 *
 * Counters sum to the universe: `bunfig.toml` examined = tracked, and install
 * roots covered + uncovered = lockfile directories. A repository whose tree or
 * file cannot be read fails; it is never counted as "no bunfig.toml".
 *
 * Network: one REST tree and one GraphQL batch per repository, so it runs in
 * `inventory-drift.yml` next to the other fleet gates, never in `bun run check`.
 */

import { disagreementWithBun, parseTomlDocument, toPlain } from "../tools/quality/toml-document";
import { parseRegistry, type RegistryEntry } from "./check-context-conformance";
import { exemption, type FleetFileReader, readRepositoryFiles } from "./fleet-tree";

export const MINIMUM_RELEASE_AGE_SECONDS = 259200;

const BUNFIG = /(^|\/)bunfig\.toml$/;
const LOCKFILE = /(^|\/)bun\.lockb?$/;

export function isBunfig(path: string): boolean {
  return BUNFIG.test(path);
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function bunfigIn(directory: string): string {
  return directory === "" ? "bunfig.toml" : `${directory}/bunfig.toml`;
}

/** The install roots (directories of a tracked `bun.lock`) that hold no tracked `bunfig.toml`. */
export function uncoveredInstallRoots(paths: readonly string[]): {
  readonly roots: readonly string[];
  readonly uncovered: readonly string[];
} {
  const tracked = new Set(paths);
  const roots = [...new Set(paths.filter((path) => LOCKFILE.test(path)).map(directoryOf))].sort();
  return { roots, uncovered: roots.filter((root) => !tracked.has(bunfigIn(root))) };
}

/**
 * The failures of one `bunfig.toml`; empty when it carries the guard. Two
 * independent TOML readers must agree on the document, or it is unreadable:
 * a decoy `minimumReleaseAge` inside a multi-line string must not satisfy the
 * gate (the reason `toml-document.ts` exists).
 */
export function reviewBunfig(text: string, allowedExcludes: ReadonlySet<string>): string[] {
  let plain: unknown;
  try {
    const document = parseTomlDocument(text);
    const disagreement = disagreementWithBun(text, document);
    if (disagreement !== null) return [`unreadable: ${disagreement}`];
    plain = toPlain(document.root);
  } catch (error) {
    return [`unreadable: ${(error as Error).message}`];
  }
  const install = (plain as Record<string, unknown>).install;
  if (typeof install !== "object" || install === null || Array.isArray(install)) {
    return [
      `no [install] table — add \`minimumReleaseAge = ${MINIMUM_RELEASE_AGE_SECONDS}\` and \`minimumReleaseAgeExcludes = []\``,
    ];
  }
  const table = install as Record<string, unknown>;
  const failures: string[] = [];
  const age = table.minimumReleaseAge;
  if (age === undefined) {
    failures.push(
      `[install] has no minimumReleaseAge (expected >= ${MINIMUM_RELEASE_AGE_SECONDS})`,
    );
  } else if (typeof age !== "number" || !Number.isInteger(age)) {
    failures.push(`minimumReleaseAge is not an integer: ${JSON.stringify(age)}`);
  } else if (age < MINIMUM_RELEASE_AGE_SECONDS) {
    failures.push(`minimumReleaseAge = ${age} is below ${MINIMUM_RELEASE_AGE_SECONDS}`);
  }
  const excludes = table.minimumReleaseAgeExcludes;
  if (excludes !== undefined) {
    if (!Array.isArray(excludes) || excludes.some((item) => typeof item !== "string")) {
      failures.push("minimumReleaseAgeExcludes is not a list of package names");
    } else {
      const undeclared = (excludes as string[]).filter((name) => !allowedExcludes.has(name));
      if (undeclared.length > 0) {
        failures.push(
          `minimumReleaseAgeExcludes names ${undeclared.map((name) => JSON.stringify(name)).join(", ")} without an entry in ecosystem/release-age-exceptions.v1.yaml`,
        );
      }
    }
  }
  return failures;
}

/** The excluded package names of a readable bunfig.toml; empty when none or unreadable. */
export function declaredExcludes(text: string): string[] {
  try {
    const plain = Bun.TOML.parse(text) as { install?: { minimumReleaseAgeExcludes?: unknown } };
    const excludes = plain.install?.minimumReleaseAgeExcludes;
    return Array.isArray(excludes)
      ? excludes.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export interface ReleaseAgeException {
  readonly repository: string;
  readonly path: string;
  readonly package: string;
  readonly because: string;
}

/** The exception register; a malformed entry throws, so the gate never runs on half a register. */
export function parseExceptions(text: string): ReleaseAgeException[] {
  const document = Bun.YAML.parse(text) as { readonly exceptions?: unknown } | null;
  const entries = document?.exceptions;
  if (!Array.isArray(entries)) {
    throw new Error("release-age-exceptions.v1.yaml: `exceptions` must be a list");
  }
  return entries.map((entry, index) => {
    const record = entry as Record<string, unknown>;
    for (const key of ["repository", "path", "package", "because"]) {
      const value = record[key];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`release-age-exceptions.v1.yaml: exceptions[${index}].${key} is required`);
      }
    }
    return record as unknown as ReleaseAgeException;
  });
}

export interface ReleaseAgeTally {
  repositories: number;
  exempt: number;
  bunfigTracked: number;
  bunfigExamined: number;
  installRoots: number;
  installRootsUncovered: number;
}

export function emptyTally(): ReleaseAgeTally {
  return {
    repositories: 0,
    exempt: 0,
    bunfigTracked: 0,
    bunfigExamined: 0,
    installRoots: 0,
    installRootsUncovered: 0,
  };
}

export function summarizeVolume(tally: ReleaseAgeTally): string {
  return `${tally.repositories + tally.exempt} inventory entries (${tally.repositories} read, ${tally.exempt} exempt): ${tally.bunfigExamined} of ${tally.bunfigTracked} tracked bunfig.toml examined, ${tally.installRoots - tally.installRootsUncovered} of ${tally.installRoots} install roots covered by a bunfig.toml`;
}

export interface ItemCheck {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

/** Every check of one repository, and the tally it adds. Pure given the reader. */
export async function reviewRepository(
  entry: RegistryEntry,
  exceptions: readonly ReleaseAgeException[],
  tally: ReleaseAgeTally,
  reader: FleetFileReader = readRepositoryFiles,
): Promise<ItemCheck[]> {
  const exempt = exemption(entry);
  if (exempt !== null) {
    tally.exempt++;
    return [{ item: entry.repository, ok: true, note: `exempt: ${exempt}` }];
  }
  tally.repositories++;
  const { listing, files } = await reader(entry.repository, isBunfig);
  if (listing.kind === "unreadable") {
    return [
      { item: entry.repository, ok: false, note: `tree unreadable at HEAD: ${listing.reason}` },
    ];
  }
  const checks: ItemCheck[] = [];
  const bunfigs = listing.paths.filter(isBunfig);
  tally.bunfigTracked += bunfigs.length;
  for (const path of bunfigs) {
    const item = `${entry.repository}:${path}`;
    const read = files.get(path);
    if (read === undefined || read.kind === "unreadable") {
      checks.push({
        item,
        ok: false,
        note: `unreadable at HEAD: ${read?.reason ?? "no read outcome recorded"}`,
      });
      continue;
    }
    tally.bunfigExamined++;
    const allowed = new Set(
      exceptions
        .filter((e) => e.repository === entry.repository && e.path === path)
        .map((e) => e.package),
    );
    const failures = reviewBunfig(read.text, allowed);
    checks.push({
      item,
      ok: failures.length === 0,
      note: failures.length === 0 ? "release-age guard present" : failures.join("; "),
    });
  }
  // An exception that no longer matches a listed exclude is a stale permission:
  // it would silently admit the package again the day someone re-adds it.
  for (const exception of exceptions.filter((e) => e.repository === entry.repository)) {
    const read = files.get(exception.path);
    const listed = read?.kind === "text" ? declaredExcludes(read.text) : [];
    if (!listed.includes(exception.package)) {
      checks.push({
        item: `${entry.repository}:${exception.path}`,
        ok: false,
        note: `stale exception: ecosystem/release-age-exceptions.v1.yaml admits ${JSON.stringify(exception.package)} but this bunfig.toml does not exclude it — remove the entry`,
      });
    }
  }
  const { roots, uncovered } = uncoveredInstallRoots(listing.paths);
  tally.installRoots += roots.length;
  tally.installRootsUncovered += uncovered.length;
  for (const root of uncovered) {
    checks.push({
      item: `${entry.repository}:${root === "" ? "." : root}`,
      ok: false,
      note: `install root (tracked bun.lock) without a tracked ${bunfigIn(root)} — bun install there runs without minimumReleaseAge`,
    });
  }
  if (bunfigs.length === 0 && roots.length === 0) {
    checks.push({
      item: entry.repository,
      ok: true,
      note: `no bunfig.toml and no bun.lock among ${listing.paths.length} tracked file(s)`,
    });
  }
  return checks;
}

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const registry = parseRegistry(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const exceptions = parseExceptions(
    await Bun.file("ecosystem/release-age-exceptions.v1.yaml").text(),
  );
  const report = new GateReport();
  const tally = emptyTally();
  for (const entry of registry) {
    for (const check of await reviewRepository(entry, exceptions, tally)) {
      report.check(check.item, check.ok, check.note);
    }
  }
  report.volume(summarizeVolume(tally));
  // `renderGateReport` prints the volume on the success line only; a red run
  // must say how much it read too, or "9 failures" cannot be told from "9 of 9".
  if (report.outcome !== "pass")
    console.error(`Release-age guard volume: ${summarizeVolume(tally)}`);
  concludeGate("Release-age guard", report);
}
