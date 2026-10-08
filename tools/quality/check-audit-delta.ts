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

// FETCH_HEAD rather than origin/<base>: an actions/checkout clone is shallow
// and single-ref, where the remote-tracking ref may not exist but a targeted
// fetch always resolves. Locally the two are the same commit.
//
// The base is never a written branch name.
//
// A repository whose default branch is documentary — four editorial files, no
// manifest and no lockfile — audits as empty, so every advisory already carried
// by the real base looked "introduced by this change" and a documentation-only
// transfer went red on two advisories it did not move. That is the exact
// failure mode the D2 gate exists to prevent, mirrored: judging a change on the
// state of the world.
//
// A literal `main` fallback reproduced it on every PUSH run, where
// `GITHUB_BASE_REF` is empty: the fleet serves `migrate/recover-code`, whose
// `main` is the documentary branch. Resolving the served branch instead is not
// enough either — on a push to the served branch, base and head are the same
// commit, and the gate would report a green over a vacuous delta.
//
// So the base is resolved per event, and WHICH base was used is asserted, since
// a delta is meaningless without saying what it was taken against:
//
//   pull_request → GITHUB_BASE_REF, the pull request's own target
//   push         → the event's `before`, the tip this push replaced
//   otherwise    → the served branch, read from origin/HEAD, never written down
function servedBranch(): string | null {
  const local = sh(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (local.exitCode === 0) {
    const name = local.stdout.trim();
    const slash = name.indexOf("/");
    if (slash !== -1) return name.slice(slash + 1);
  }
  const remote = sh(["git", "ls-remote", "--symref", "origin", "HEAD"]);
  if (remote.exitCode === 0) {
    const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(remote.stdout);
    return match?.[1] ?? null;
  }
  return null;
}

/**
 * The tip a push replaced, read from the event payload.
 *
 * `{ before: null }` means the question does not apply: this is not a push run,
 * no event file was named, or the push CREATED the branch — a creation reports
 * an all-zero `before`, where there is no previous tip to compare against.
 *
 * An event file that WAS named but cannot be read or parsed is an `error`, never
 * a `null`. The first form of this function awaited nothing: `Bun.file(path).text()`
 * returns a promise, a double cast silenced the compiler, `JSON.parse` choked on
 * `[object Promise]` with `SyntaxError: JSON Parse error: Unexpected identifier
 * "object"`, and a bare `catch` swallowed it. The function therefore returned null
 * for EVERY push event since it was written, every push run fell through to the
 * served-branch fallback, and the only trace was a green over a base nobody asked
 * for. "Could not read the event" and "the event names no base" are now two
 * answers, as "found nothing" and "could not look" already are for the audit.
 */
async function pushBefore(): Promise<{ before: string | null } | { error: string }> {
  const path = process.env.GITHUB_EVENT_PATH;
  if (process.env.GITHUB_EVENT_NAME !== "push" || path === undefined) return { before: null };
  const why = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (cause) {
    return {
      error: `the push event payload named by GITHUB_EVENT_PATH (${path}) could not be read: ${why(cause)} — a named event file that cannot be read is not an absent base, and reading it as one would compare this push against the served branch instead of against the tip it replaced`,
    };
  }
  let event: { before?: unknown };
  try {
    event = JSON.parse(text) as { before?: unknown };
  } catch (cause) {
    return {
      error: `the push event payload named by GITHUB_EVENT_PATH (${path}) is not parsable JSON: ${why(cause)}`,
    };
  }
  const before = event.before;
  if (typeof before !== "string" || before.length === 0 || /^0+$/.test(before)) {
    return { before: null };
  }
  return { before };
}

const target = process.env.GITHUB_BASE_REF?.trim();
const pushed = await pushBefore();
if ("error" in pushed) {
  report.check("push event payload", false, pushed.error);
  concludeGate("Audit delta", report);
  throw new Error("unreachable: concludeGate exits on a failing report");
}
const before = pushed.before;
const resolved =
  target !== undefined && target.length > 0
    ? { ref: target, how: "the pull request's target branch", from: "pull-request-target" }
    : before !== null
      ? { ref: before, how: "the tip this push replaced (event `before`)", from: "push-before" }
      : (() => {
          const served = servedBranch();
          return served === null
            ? null
            : {
                ref: served,
                how: "the branch this repository serves, read from origin/HEAD",
                from: "served-branch-fallback",
              };
        })();

if (resolved === null) {
  report.check(
    "base",
    false,
    "no base could be resolved: no pull-request target, no push `before`, and origin/HEAD answered nothing — a delta has no meaning without a base",
  );
  concludeGate("Audit delta", report);
}
const baseRef = (resolved as { ref: string; how: string; from: string }).ref;
const baseHow = (resolved as { ref: string; how: string; from: string }).how;
const resolvedFrom = (resolved as { ref: string; how: string; from: string }).from;

const fetched = sh(["git", "fetch", "--quiet", "--depth=1", "origin", baseRef]);
if (fetched.exitCode !== 0) {
  report.check(
    "base lockfile",
    false,
    `could not fetch the base ${baseRef}: ${fetched.stderr.trim()}`,
  );
  concludeGate("Audit delta", report);
}

// Base and head being the same commit makes every delta empty by construction,
// and that is two different situations:
//
//   - a pull request or a push whose base IS its head is a defect — a pull
//     request against itself, or a push event whose `before` equals its tip —
//     and the gate fails, because it was handed a base and the base is wrong;
//   - a LOCAL run sitting on the served branch has simply nothing to compare.
//     The gate is wired in ci.yml only, never in `bun run check`, so this is a
//     developer reading it by hand. Failing there would be a red for a
//     non-defect; `allowEmpty` says it examined nothing and why.
const baseSha = sh(["git", "rev-parse", "FETCH_HEAD"]).stdout.trim();
const headSha = sh(["git", "rev-parse", "HEAD"]).stdout.trim();
const vacuous = baseSha.length > 0 && baseSha === headSha;
const handedABase = resolvedFrom !== "served-branch-fallback";

if (vacuous && handedABase) {
  report.check(
    "base",
    false,
    `base and head are the same commit (${headSha.slice(0, 8)}) while the base came from ${baseHow}: a delta taken against its own head measures nothing`,
  );
  concludeGate("Audit delta", report);
}
if (vacuous) {
  report.allowEmpty(
    `base and head are the same commit (${headSha.slice(0, 8)}) and no event handed a base — a local run on the served branch has nothing to compare, and this gate runs in ci.yml, never in \`bun run check\``,
  );
  concludeGate("Audit delta", report);
  // `concludeGate` only leaves the process on FAILURE (`gate-report.ts`: `if
  // (!rendered.ok) process.exit(1)`). On a green report it prints and returns,
  // so the idiom `allowEmpty(); concludeGate();` fell straight through: the gate
  // went on to fetch, audit and conclude a SECOND time, printing two verdicts
  // for one run and auditing a base it had just declared it could not compare.
  // The failing branches above exit by construction; this one has to say so.
  process.exit(0);
}
report.check("base", true, `${baseRef} at ${baseSha.slice(0, 8)} — ${baseHow}`);

// `bun audit` needs the manifest AND the lockfile (verified: the lockfile
// alone is refused with "No package.json was found").
const baseLock = sh(["git", "show", "FETCH_HEAD:bun.lock"]);
const baseManifest = sh(["git", "show", "FETCH_HEAD:package.json"]);
let baseAdvisories: string[] = [];
// "absent" and "unreadable" are two different answers. A base that carries no
// lockfile audits as empty, legitimately — a documentary branch has none. But a
// `git show` that fails for any OTHER reason (an object the shallow fetch did
// not bring, a partial clone) would silently make every head advisory read as
// introduced, and the previous form recorded no check for that branch at all.
const baseMissing = (result: { exitCode: number; stderr: string }): boolean =>
  result.exitCode !== 0 &&
  /does not exist|exists on disk, but not in|path .* does not exist/i.test(result.stderr);
if (baseLock.exitCode !== 0 && !baseMissing(baseLock)) {
  report.check(
    "base lockfile",
    false,
    `bun.lock could not be read at ${baseRef}: ${baseLock.stderr.trim() || "git show failed without a message"} — this is not an absent lockfile, and treating it as one would make every head advisory read as introduced`,
  );
  concludeGate("Audit delta", report);
}
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
