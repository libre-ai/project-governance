// The Rust half of the periodic fleet advisory control (ADR-0021 D1, I-26).
//
// Since decision Y44 (2026-10-09) the RustSec verdict is out of every required
// check: it depends on the advisory database of the day, not on the tree. The
// periodic control is therefore the only place the state of the world of the
// fleet's Cargo graphs is asked — and before this module it read package.json
// and bun.lock only, so ten Rust repositories were examined by nothing.
//
// What is examined: every tracked Cargo.lock of a repository's served branch,
// with cargo-deny `check advisories` (the binary verified by
// tools/quality/check-dependency-policy.ts, never a second acquisition path)
// and the deny.toml that governs it — the nearest one walking up from the
// lockfile, which is the file cargo-deny's own users maintain beside it.
//
// What a waiver is worth here: cargo-deny honours `[advisories] ignore`
// without reading dates, so an ignore whose waiver expired keeps silencing the
// advisory forever. The control asks cargo-deny for the ignored advisories as
// well (`--log-level info` demotes them to notes instead of dropping them) and
// counts an ignored advisory as covered only when the waiver discipline of
// tools/quality/advisory-waivers.ts holds for it today. An expired or
// malformed waiver is reported as an uncovered advisory.
//
// Fail closed: a declared Cargo.lock that cannot be read, a lockfile without
// its manifest or governing deny.toml, an advisory database that cannot be
// fetched, a run that produced no summary — each is a failed examination,
// never zero advisories (gate-integrity §2).

import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { evaluateWaivers } from "../quality/advisory-waivers";
import { readRepositoryWaivers } from "../quality/check-advisory-waivers";
import { countLockedPackages } from "../quality/check-dependency-policy";

/** The cargo-deny invocation of the periodic control: advisories only, JSON diagnostics. */
export function denyAdvisoryArguments(manifestPath: string, configPath: string): string[] {
  return [
    // `info` keeps the diagnostics of ignored advisories (as notes) so their
    // waivers can be judged; at the default level they are dropped silently.
    "--log-level",
    "info",
    "--locked",
    "--color",
    "never",
    "--format",
    "json",
    "--manifest-path",
    manifestPath,
    "--workspace",
    "check",
    "--config",
    configPath,
    "--show-stats",
    "advisories",
  ];
}

/** Tracked Cargo.lock paths among repository-relative paths, sorted. */
export function cargoLockPaths(paths: readonly string[]): string[] {
  return paths.filter((path) => /(^|\/)Cargo\.lock$/.test(path)).sort();
}

/**
 * The deny.toml governing a lockfile: the nearest tracked one walking up from
 * the lockfile's directory to the repository root. `null` when none exists.
 */
export function governingDenyConfig(lock: string, tracked: ReadonlySet<string>): string | null {
  let directory = posix.dirname(lock);
  for (;;) {
    const candidate = directory === "." ? "deny.toml" : `${directory}/deny.toml`;
    if (tracked.has(candidate)) return candidate;
    if (directory === ".") return null;
    directory = posix.dirname(directory);
  }
}

export interface AdvisoryFinding {
  /** RUSTSEC id, or `yanked <crate version>` for a yanked crate without advisory. */
  readonly id: string;
  /** cargo-deny diagnostic code: vulnerability, unmaintained, unsound, notice, yanked. */
  readonly code: string;
  readonly aliases: readonly string[];
  /** Crate name of the advisory, when cargo-deny names one. */
  readonly crate: string | null;
}

export interface DenyReading {
  /** False: cargo-deny could not answer (database, metadata, binary). Never zero findings. */
  readonly ran: boolean;
  readonly detail: string;
  /** Advisories cargo-deny reported (error or warning severity). */
  readonly reported: readonly AdvisoryFinding[];
  /** Advisories cargo-deny matched but an `[advisories] ignore` entry silenced. */
  readonly ignored: readonly AdvisoryFinding[];
}

interface DenyLine {
  readonly type?: unknown;
  readonly fields?: {
    readonly code?: unknown;
    readonly severity?: unknown;
    readonly level?: unknown;
    readonly message?: unknown;
    readonly advisory?: {
      readonly id?: unknown;
      readonly aliases?: unknown;
      readonly package?: unknown;
    };
    readonly labels?: ReadonlyArray<{ readonly span?: unknown }>;
  };
}

function findingOf(line: DenyLine): AdvisoryFinding | null {
  const fields = line.fields ?? {};
  const code = typeof fields.code === "string" ? fields.code : "";
  const advisory = fields.advisory;
  if (advisory !== undefined && advisory !== null && typeof advisory.id === "string") {
    const aliases = Array.isArray(advisory.aliases)
      ? advisory.aliases.filter((alias): alias is string => typeof alias === "string")
      : [];
    const crate = typeof advisory.package === "string" ? advisory.package : null;
    return { id: advisory.id, code, aliases, crate };
  }
  if (code === "yanked") {
    const span = fields.labels?.[0]?.span;
    const crate =
      typeof span === "string" ? span.split(" ").slice(0, 2).join(" ") : "unknown crate";
    return { id: `yanked ${crate}`, code, aliases: [], crate: crate.split(" ")[0] ?? null };
  }
  return null;
}

/**
 * Interpret one `cargo-deny --format json check advisories` run.
 *
 * cargo-deny writes one JSON object per line on stderr and ends a completed
 * check with a `summary` object; exit 1 means "found something" only when an
 * advisory diagnostic of error severity backs it. A database that cannot be
 * fetched, a `cargo metadata` that fails or a missing summary is a run that
 * could not answer — exactly the confusion readAudit refuses for `bun audit`.
 */
export function readDenyAdvisories(exitCode: number, output: string): DenyReading {
  const reported: AdvisoryFinding[] = [];
  const ignored: AdvisoryFinding[] = [];
  const errors: string[] = [];
  let summary = false;
  let reportedErrors = 0;
  for (const raw of output.split("\n")) {
    const text = raw.trim();
    if (!text.startsWith("{")) continue;
    let line: DenyLine;
    try {
      line = JSON.parse(text) as DenyLine;
    } catch {
      continue;
    }
    if (line.type === "summary") {
      summary = true;
      continue;
    }
    const fields = line.fields ?? {};
    if (line.type === "log") {
      if (fields.level === "ERROR" && typeof fields.message === "string") {
        errors.push(fields.message);
      }
      continue;
    }
    if (line.type !== "diagnostic") continue;
    const finding = findingOf(line);
    if (finding === null) {
      if (fields.severity === "error" && typeof fields.message === "string") {
        errors.push(`${String(fields.code ?? "diagnostic")}: ${fields.message}`);
      }
      continue;
    }
    if (fields.severity === "note" || fields.severity === "help") {
      ignored.push(finding);
    } else {
      reported.push(finding);
      if (fields.severity === "error") reportedErrors += 1;
    }
  }

  const reason = errors.length > 0 ? ` — ${errors.join("; ").slice(0, 400)}` : "";
  if (!summary) {
    return {
      ran: false,
      detail: `cargo-deny exited ${exitCode} without a check summary${reason}`,
      reported: [],
      ignored: [],
    };
  }
  if (exitCode !== 0 && (reportedErrors === 0 || errors.length > 0)) {
    return {
      ran: false,
      detail: `cargo-deny exited ${exitCode} without an advisory finding to explain it — not a clean result, an unanswered question${reason}`,
      reported: [],
      ignored: [],
    };
  }
  return { ran: true, detail: exitCode === 0 ? "clean" : "advisories found", reported, ignored };
}

export type CoverageVerdict =
  | { readonly covered: true; readonly waiver: string }
  | { readonly covered: false; readonly reason: string };

/** Whether the deny.toml `config` holds a waiver valid today for `finding`. */
export type WaiverCoverage = (config: string, finding: AdvisoryFinding) => CoverageVerdict;

function namesFinding(id: string, finding: AdvisoryFinding): boolean {
  if (id === finding.id || finding.aliases.includes(id)) return true;
  // cargo-deny also accepts a crate spec (`name` or `name@version`) in ignore.
  return finding.crate !== null && (id === finding.crate || id.startsWith(`${finding.crate}@`));
}

/**
 * The waivers of one checkout, read EXACTLY as the advisory-waivers gate reads
 * them (its own `readRepositoryWaivers` and `evaluateWaivers`, no second
 * parser — ADVISORY-WAIVER-POLICY.md, "One reading, reused"), and
 * the tracked file list of the same checkout.
 *
 * An ignored advisory is covered when at least one entry naming it passes the
 * gate's whole discipline on `today` — dated, referenced, justified, anchored,
 * and not expired. Anything else is reported with the gate's own defect codes.
 */
export function readCheckoutWaivers(
  root: string,
  today: string,
): { tracked: string[]; coverage: WaiverCoverage } {
  const listing = Bun.spawnSync(["git", "-C", root, "ls-files", "-z"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (listing.exitCode !== 0) {
    throw new Error(`git ls-files failed in ${root}: ${new TextDecoder().decode(listing.stderr)}`);
  }
  const tracked = new TextDecoder()
    .decode(listing.stdout)
    .split("\0")
    .filter((path) => path !== "");
  const { readings, isTrackedFile } = readRepositoryWaivers(root);
  const coverage: WaiverCoverage = (config, finding) => {
    const reading = readings.find((candidate) => candidate.file === config);
    if (reading === undefined) {
      return { covered: false, reason: `the waiver gate does not read ${config}` };
    }
    if (reading.error !== null) {
      return { covered: false, reason: `${config} ${reading.error}` };
    }
    const entries = reading.entries.filter(
      (entry) => entry.id !== null && namesFinding(entry.id, finding),
    );
    if (entries.length === 0) {
      return { covered: false, reason: "no waiver entry of the deny.toml names it" };
    }
    const reasons: string[] = [];
    for (const entry of entries) {
      const evaluation = evaluateWaivers([{ ...reading, entries: [entry] }], {
        today,
        isTrackedFile,
      });
      if (evaluation.defects.length === 0) {
        return { covered: true, waiver: `${entry.file}:${entry.line}` };
      }
      for (const defect of evaluation.defects) {
        reasons.push(`${defect.code} ${defect.where}: ${defect.message}`);
      }
    }
    return { covered: false, reason: reasons.join("; ") };
  };
  return { tracked, coverage };
}

export interface DenyRun {
  readonly exitCode: number;
  readonly output: string;
}

/** Runs cargo-deny; injected so the examination is testable without a binary or a network. */
export type DenyRunner = (manifestPath: string, configPath: string, cwd: string) => DenyRun;

export interface LockExamination {
  readonly lock: string;
  readonly config: string | null;
  /** `[[package]]` entries of the lockfile — the volume examined. */
  readonly packages: number;
  /** True when the examination answered AND nothing uncovered was found. */
  readonly ok: boolean;
  /** True when cargo-deny answered; false is a failed examination, never a zero. */
  readonly answered: boolean;
  /** cargo resolves the manifest inside an enclosing workspace: not a graph of its own. */
  readonly shadowed: boolean;
  readonly uncovered: readonly string[];
  readonly covered: readonly string[];
  readonly note: string;
}

export interface RustVolume {
  readonly repositories: number;
  readonly declared: number;
  readonly examined: number;
  readonly shadowed: number;
  readonly failed: number;
  readonly packages: number;
  readonly advisories: number;
}

/**
 * The volume line of the Rust half. `declared` must equal examined + shadowed
 * + failed; a mismatch is a counting defect of the control itself and is said
 * on the line rather than hidden.
 */
export function rustVolumeLine(volume: RustVolume): string {
  const sum = volume.examined + volume.shadowed + volume.failed;
  const mismatch =
    sum === volume.declared
      ? ""
      : ` — COUNTING DEFECT: ${sum} accounted for, ${volume.declared} declared`;
  return (
    `Rust: ${volume.repositories} repositories with a tracked Cargo.lock, ${volume.declared} Cargo.lock ` +
    `declared = ${volume.examined} examined + ${volume.shadowed} shadowed + ${volume.failed} failed, ` +
    `${volume.packages} package(s) examined, ${volume.advisories} uncovered advisory(ies)${mismatch}`
  );
}

/** cargo's own refusal to resolve a member of an enclosing workspace in isolation. */
const SHADOWED_BY_WORKSPACE = /current package believes it's in a workspace when it's not/;

function describe(finding: AdvisoryFinding): string {
  const crate = finding.crate === null ? "" : ` (${finding.crate})`;
  return `${finding.id}${crate}`;
}

/**
 * Examine every declared Cargo.lock of one checkout of a repository.
 *
 * `declared` is what the forge lists for the served branch; `tracked` is what
 * the checkout holds. A declared lockfile the checkout cannot read is a
 * failure, as is a lockfile without its Cargo.toml or without a governing
 * deny.toml — cargo-deny cannot be asked about it, so nothing is known.
 */
export function examineCheckout(
  root: string,
  declared: readonly string[],
  tracked: readonly string[],
  runDeny: DenyRunner,
  coverage: WaiverCoverage,
): LockExamination[] {
  const trackedSet = new Set(tracked);
  const results: LockExamination[] = [];
  for (const lock of declared) {
    const failed = (note: string, config: string | null = null, packages = 0) =>
      results.push({
        lock,
        config,
        packages,
        ok: false,
        answered: false,
        shadowed: false,
        uncovered: [],
        covered: [],
        note,
      });
    let lockText: string;
    try {
      lockText = readFileSync(join(root, lock), "utf8");
    } catch (error) {
      failed(`UNREADABLE declared Cargo.lock: ${(error as Error).message}`);
      continue;
    }
    const packages = countLockedPackages(lockText);
    if (packages === 0) {
      failed("Cargo.lock declares no [[package]] — unparseable or empty, not a clean graph");
      continue;
    }
    const manifest = posix.join(posix.dirname(lock), "Cargo.toml");
    if (!trackedSet.has(manifest)) {
      failed(
        `no tracked ${manifest} beside the lockfile — cargo-deny cannot resolve it`,
        null,
        packages,
      );
      continue;
    }
    const config = governingDenyConfig(lock, trackedSet);
    if (config === null) {
      failed("no tracked deny.toml governs this lockfile", null, packages);
      continue;
    }
    const run = runDeny(join(root, manifest), join(root, config), join(root, dirname(manifest)));
    const reading = readDenyAdvisories(run.exitCode, run.output);
    if (!reading.ran && SHADOWED_BY_WORKSPACE.test(run.output)) {
      // cargo itself refuses to resolve this manifest on its own: an enclosing
      // workspace claims it, so no build of the repository ever reads this
      // lockfile — the enclosing Cargo.lock is the graph, and it is examined
      // as its own entry. Measured 2026-10-09 on capability-authorization's
      // vendored crates.io archive (third_party/biscuit-auth-6.0.0), whose
      // upstream lockfile cannot change without breaking its provenance gate.
      // Counted apart, never as an examined graph.
      results.push({
        lock,
        config,
        packages: 0,
        ok: true,
        answered: true,
        shadowed: true,
        uncovered: [],
        covered: [],
        note: `${packages} locked package(s) NOT examined: cargo resolves this manifest inside an enclosing workspace, whose Cargo.lock governs the build`,
      });
      continue;
    }
    if (!reading.ran) {
      failed(reading.detail, config, packages);
      continue;
    }
    const uncovered = reading.reported.map(describe);
    const covered: string[] = [];
    for (const finding of reading.ignored) {
      const verdict = coverage(config, finding);
      if (verdict.covered) covered.push(`${describe(finding)} waived by ${verdict.waiver}`);
      else
        uncovered.push(
          `${describe(finding)} ignored in ${config} but not covered: ${verdict.reason}`,
        );
    }
    const unique = [...new Set(uncovered)].sort();
    results.push({
      lock,
      config,
      packages,
      ok: unique.length === 0,
      answered: true,
      shadowed: false,
      uncovered: unique,
      covered: [...new Set(covered)].sort(),
      note:
        unique.length === 0
          ? `${packages} package(s) examined, no uncovered advisory` +
            (covered.length > 0 ? `; ${covered.length} covered by a valid waiver` : "")
          : `${packages} package(s) examined, ${unique.length} uncovered advisory(ies): ${unique.join(", ")}`,
    });
  }
  return results;
}
