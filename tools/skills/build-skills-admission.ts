// Skills admission receipt (ADR-0072) — generator and gate.
//
// Until this file, the admission state of a skill was a word written by hand
// in its frontmatter (`metadata.status`), whose form T1 checked and which
// nothing tied to the checks the skill had passed: editing a skill changed
// nothing of what it declared.
//
// The state is now derived. For every skill directory under skills/:
//
// 1. its FINGERPRINT is computed (skill-fingerprint.ts, a versioned recipe);
// 2. every known CHECK is run on it. Two are the verdict of the function their
//    gate calls; three are a per-skill verdict composed here from the pieces
//    of a gate that judges the collection as a whole:
//    - `structure`: T1, lintSkillDirectory of check-skills.ts, as the gate;
//    - `non-cascade`: T3, evaluateNonCascade of check-skills-cascade.ts, as
//      the gate;
//    - `routing`: T2, composed: every positive trigger of the skill ranks
//      first at the default floor (gradeRoutingCases) and its description
//      collides with no other (pairwiseOverlap);
//    - `security`: T4, composed: every entry of the directory is readable
//      text (loadSkillTree) and no line matches a refused pattern
//      (scanForSkillRisks);
//    - `distribution`: the committed marketplace manifest lists the skill
//      (listedSkills). Narrower than its gate, which holds the manifest equal
//      to the generated one byte for byte;
// 3. its STATE is derived from the results of the REQUIRED checks
//    (skills-admission-policy.v1.json): `candidate` when each of them passed,
//    `incomplete` otherwise.
//
// A required check that failed, could not judge (`unavailable`: its runner
// threw, or its own source could not be read) or left no result makes the
// state `incomplete`. No flag of this script selects, skips or waives a check:
// not running a check is never a dispensation. A policy that cannot be read,
// does not read back as written (a key written twice), carries a key or a
// schema version this script does not know, or contradicts itself, is read as
// every known check being required, and the gate fails naming the defect.
//
// A file under skills/ that git does not track (never added, or ignored) is a
// named refusal: hashed, it would give a fingerprint no clone can give, and
// the workstation and CI would disagree on the same commit.
//
// `promoted` is not a state this script derives. A promotion is an act of the
// owner bound to a fingerprint (ADR-0072 D6); no record of one exists yet, so
// no tool can write the word, and a skill that declares it fails the gate.
//
// The RECEIPT (ecosystem/projections/skills-admission.v1.json) is generated
// and tracked. It holds no date and no machine path: two generations on the
// same tree are the same bytes. Its results are those of the check code and
// data of the commit that carries it.
//
// `bun tools/skills/build-skills-admission.ts` writes the receipt, then exits
// with the verdict the gate gives on what it wrote: a receipt that records a
// state the gate refuses is written, and the script fails.
// `--check` (wired into `bun run check`) fails, naming the skill, when:
// - a skill directory cannot be fingerprinted, or holds a file git does not
//   track;
// - the committed receipt is not the one the tree generates: one byte changed
//   in a skill file without regenerating it is enough;
// - the status a skill declares (`metadata.status`) is not its derived state,
//   so the hand-written word can no longer contradict the evidence;
// - the policy is not followed as written.
//
// Idea adapted from NVIDIA/SkillEvaluator@35af6d9 (no text taken): a
// publication status derived from evidence and distinct from the exit code
// (src/skillevaluator/reporting/base.py:2387), and a required-tier policy that
// resolves to "required" whenever it is invalid, conflicting or absent
// (src/skillevaluator/reporting/base.py:1872).

import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { concludeGate, GateReport } from "../quality/gate-report";
import { readGit } from "../quality/git-diff";
import { listedSkills, MANIFEST_PATH, SKILLS_ROOT } from "./build-skills-manifest";
import { lintSkillDirectory } from "./check-skills";
import { evaluateNonCascade, loadSkillTexts } from "./check-skills-cascade";
import {
  DEFAULT_RANK1_FLOOR,
  gradeRoutingCases,
  loadSkillSources,
  PAIRWISE_ERROR_THRESHOLD,
  pairwiseOverlap,
  parseSkillSource,
} from "./check-skills-routing";
import {
  loadSkillTree,
  PATTERNS_PATH,
  scanForSkillRisks,
  validatePatterns,
} from "./check-skills-security";
import { parseFrontmatter } from "./lint-skill";
import {
  compareUtf8,
  FINGERPRINT_RECIPE,
  fingerprintSkillDirectory,
  type Refusal,
} from "./skill-fingerprint";

export const RECEIPT_PATH = "ecosystem/projections/skills-admission.v1.json";
export const POLICY_PATH = "tools/skills/skills-admission-policy.v1.json";
export const RECEIPT_FORMAT = "libre-ai.skills-admission.v1";
export const POLICY_FORMAT = "libre-ai.skills-admission-policy.v1";
/** Every key the policy may carry. `because` is prose and is not read. */
const POLICY_KEYS: readonly string[] = ["schema_version", "because", "required_checks"];
const REGENERATE = "regenerate it with `bun run build:skills-admission`";

/** Every check this script knows, in the order the receipt lists them. */
export const ADMISSION_CHECKS = [
  "structure",
  "routing",
  "non-cascade",
  "security",
  "distribution",
] as const;

export type AdmissionCheckId = (typeof ADMISSION_CHECKS)[number];
/** `unavailable`: the check could not judge. It is not a pass, and not a zero. */
export type CheckResult = "pass" | "fail" | "unavailable";
export type AdmissionState = "candidate" | "incomplete";

export interface ReceiptCheck {
  readonly id: AdmissionCheckId;
  readonly required: boolean;
  readonly result: CheckResult;
}

export interface ReceiptEntry {
  readonly name: string;
  readonly fingerprint: string;
  readonly files: number;
  readonly checks: readonly ReceiptCheck[];
  readonly state: AdmissionState;
}

export interface AdmissionReceipt {
  readonly schema_version: string;
  readonly recipe: string;
  readonly skills: readonly ReceiptEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCheckId(value: unknown): value is AdmissionCheckId {
  return ADMISSION_CHECKS.some((id) => id === value);
}

export interface RequiredChecks {
  readonly required: readonly AdmissionCheckId[];
  /** Why the policy was not followed, or null when it was read as written. */
  readonly defect: string | null;
}

/** Whatever the defect, the answer is every known check. */
function everything(defect: string): RequiredChecks {
  return { required: ADMISSION_CHECKS, defect };
}

/** The text without the white space JSON allows between two tokens. */
function withoutJsonWhitespace(text: string): string {
  let kept = "";
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      kept += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      kept += char;
    } else if (char !== " " && char !== "\t" && char !== "\n" && char !== "\r") {
      kept += char;
    }
  }
  return kept;
}

/**
 * The required checks of the policy file as written; `null` is a file that
 * could not be read. A parser keeps the last of two keys of the same name and
 * says nothing: a file listing the five checks, then `required_checks` again
 * with one, would be followed as one. So the text must read back as written,
 * white space apart; a key written twice, or a name hidden behind an escape,
 * does not.
 */
export function readRequiredChecks(text: string | null): RequiredChecks {
  if (text === null) return resolveRequiredChecks(undefined);
  let policy: unknown;
  try {
    policy = JSON.parse(text);
  } catch {
    return resolveRequiredChecks(undefined);
  }
  if (withoutJsonWhitespace(text) !== JSON.stringify(policy)) {
    return everything(
      "does not read back as written: a key written twice, or an escape, makes a parser read something the file does not show",
    );
  }
  return resolveRequiredChecks(policy);
}

/**
 * The required checks of an already-parsed policy. `undefined` is what the
 * reader passes for a file it could not read or parse. Whatever the defect,
 * the answer is every known check: a policy can only be loosened by a list
 * that is readable and coherent.
 */
export function resolveRequiredChecks(policy: unknown): RequiredChecks {
  if (policy === undefined) return everything("unreadable, or not valid JSON");
  if (!isRecord(policy) || !Array.isArray(policy.required_checks)) {
    return everything("expected an object carrying a `required_checks` list");
  }
  if (policy.schema_version !== POLICY_FORMAT) {
    return everything(
      `\`schema_version\` is ${JSON.stringify(policy.schema_version)}, and this script reads "${POLICY_FORMAT}" only`,
    );
  }
  const unknown = Object.keys(policy).filter((key) => !POLICY_KEYS.includes(key));
  if (unknown.length > 0) {
    return everything(
      `carries ${unknown.map((key) => JSON.stringify(key)).join(", ")}, which this script does not read: a key it ignores cannot be allowed to look like a rule`,
    );
  }
  const listed: readonly unknown[] = policy.required_checks;
  if (listed.length === 0)
    return everything("`required_checks` is empty: nothing would be required");
  const seen = new Set<AdmissionCheckId>();
  for (const entry of listed) {
    if (!isCheckId(entry)) {
      return everything(
        `\`required_checks\` names ${JSON.stringify(entry)}, which is not a known check (${ADMISSION_CHECKS.join(", ")})`,
      );
    }
    if (seen.has(entry)) return everything(`\`required_checks\` lists "${entry}" twice`);
    seen.add(entry);
  }
  return { required: ADMISSION_CHECKS.filter((id) => seen.has(id)), defect: null };
}

/**
 * Pure: the state the results of the required checks derive. Anything but a
 * recorded `pass` on every required check is `incomplete`: a missing result, a
 * failure and a check that could not judge all read the same.
 */
export function deriveAdmissionState(
  required: readonly string[],
  results: Readonly<Record<string, unknown>>,
): AdmissionState {
  const complete = required.length > 0 && required.every((id) => results[id] === "pass");
  return complete ? "candidate" : "incomplete";
}

export interface CollectionRead {
  /** Entries met: those listed under the root, or the root alone when it cannot be listed. */
  readonly entries: number;
  /** Directories of the root that hold an entry named SKILL.md. */
  readonly skills: readonly string[];
  /** Other entries of the root: a README, the refusals directory. */
  readonly notSkills: readonly string[];
  /** Entries that could not be classified, the root included. */
  readonly refused: readonly Refusal[];
}

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every entry directly under the root, each in exactly one of three lists.
 * Read with lstat and readdir, not with a glob: a glob restricted to files
 * drops a SKILL.md that is a link, and the skill would leave the collection
 * without a trace.
 */
export function listSkillDirectories(root: string): CollectionRead {
  const skills: string[] = [];
  const notSkills: string[] = [];
  const refused: Refusal[] = [];
  let entries: string[];
  try {
    if (lstatSync(root).isSymbolicLink()) {
      return {
        entries: 1,
        skills,
        notSkills,
        refused: [{ path: root, reason: "symbolic link, never followed" }],
      };
    }
    entries = readdirSync(root).sort(compareUtf8);
  } catch (error) {
    return {
      entries: 1,
      skills,
      notSkills,
      refused: [{ path: root, reason: `cannot be listed (${errorCode(error)})` }],
    };
  }
  for (const entry of entries) {
    const path = join(root, entry);
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(path);
    } catch (error) {
      refused.push({ path, reason: `cannot be inspected (${errorCode(error)})` });
      continue;
    }
    if (stats.isSymbolicLink()) {
      refused.push({ path, reason: "symbolic link, never followed: it may stand for a skill" });
    } else if (stats.isDirectory() && existsOrLink(join(path, "SKILL.md"))) {
      skills.push(entry);
    } else {
      notSkills.push(entry);
    }
  }
  return { entries: entries.length, skills, notSkills, refused };
}

/** Whether an entry exists, without following it if it is a link. */
function existsOrLink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export type UntrackedRead =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly reason: string };

const UNTRACKED =
  "not tracked by git (never added, or ignored): hashed, it would give a fingerprint no clone can give — remove it, or `git add` it";

/**
 * The files under the root that git does not track, relative to it, ignored
 * ones included (no `--exclude-standard`: an ignored `*.log` is the case that
 * can never reach a commit). Git could not answer: a failure, never an empty
 * list, which would read as a clean tree.
 */
export function listUntracked(root: string): UntrackedRead {
  const read = readGit(
    ["-C", root, "ls-files", "--others", "-z", "--", "."],
    `ask git which files under ${root}/ it does not track`,
  );
  if (!read.ok) return read;
  return { ok: true, paths: read.stdout.split("\0").filter((path) => path !== "") };
}

export interface CheckSources {
  readonly root: string;
  readonly manifestPath: string;
  readonly patternsPath: string;
}

type Verdicts = Map<string, CheckResult>;
type Runner = (skills: readonly string[], sources: CheckSources) => Promise<Verdicts>;

/**
 * One runner per known check. A runner returns a verdict for the skills it
 * judged; a skill it leaves out, or a runner that throws, reads `unavailable`.
 */
const RUNNERS: Readonly<Record<AdmissionCheckId, Runner>> = {
  structure: async (skills, { root }) => {
    const verdicts: Verdicts = new Map();
    for (const name of skills) {
      try {
        const { checks } = await lintSkillDirectory(root, name);
        verdicts.set(
          name,
          checks.length > 0 && checks.every((check) => check.ok) ? "pass" : "fail",
        );
      } catch {
        // SKILL.md could not be read: T1 did not judge this skill.
      }
    }
    return verdicts;
  },

  // The default floor, never SKILLS_RANK1_FLOOR: an environment variable must
  // not be able to change what a tracked receipt says.
  routing: async (_skills, { root }) => {
    const sources = (await loadSkillSources(root)).map(parseSkillSource);
    const routable = sources.flatMap((source) =>
      source.description.ok ? [{ name: source.name, description: source.description.value }] : [],
    );
    const colliding = new Set<string>();
    for (const pair of pairwiseOverlap(routable)) {
      if (pair.similarity >= PAIRWISE_ERROR_THRESHOLD) colliding.add(pair.a).add(pair.b);
    }
    const cases = gradeRoutingCases(sources, DEFAULT_RANK1_FLOOR);
    const verdicts: Verdicts = new Map();
    for (const source of sources) {
      const own = cases.filter((result) => result.skill === source.name);
      const routed = own.length > 0 && own.every((result) => result.outcome === "pass");
      verdicts.set(source.name, routed && !colliding.has(source.name) ? "pass" : "fail");
    }
    return verdicts;
  },

  "non-cascade": async (_skills, { root }) => {
    const texts = await loadSkillTexts(root);
    const failed = new Set(
      evaluateNonCascade(texts)
        .checks.filter((check) => !check.ok)
        .map((check) => check.skill),
    );
    return new Map(texts.map((text) => [text.name, failed.has(text.name) ? "fail" : "pass"]));
  },

  security: async (skills, { root, patternsPath }) => {
    // Throws on an unreadable or malformed patterns file: with no pattern the
    // scan would match nothing and call every skill clean.
    const patterns = validatePatterns(
      await Bun.file(patternsPath)
        .json()
        .catch(() => undefined),
    );
    const verdicts: Verdicts = new Map();
    for (const name of skills) {
      const read = loadSkillTree(join(root, name));
      const everyEntryRead =
        read.undecodable.length === 0 && read.symlinks.length === 0 && read.unreadable.length === 0;
      const clean = scanForSkillRisks(read.scanned, patterns).length === 0;
      verdicts.set(name, everyEntryRead && clean ? "pass" : "fail");
    }
    return verdicts;
  },

  distribution: async (skills, { manifestPath }) => {
    if (!existsSync(manifestPath)) return new Map();
    const listed = listedSkills(await Bun.file(manifestPath).text());
    if (!listed.ok) return new Map();
    return new Map(skills.map((name) => [name, listed.dirs.includes(name) ? "pass" : "fail"]));
  },
};

export type SkillResults = Readonly<Record<AdmissionCheckId, CheckResult>>;

/** Every known check, on every skill. No argument selects or skips one. */
export async function runAdmissionChecks(
  skills: readonly string[],
  sources: CheckSources,
): Promise<Map<string, SkillResults>> {
  const byCheck = new Map<AdmissionCheckId, Verdicts>();
  for (const id of ADMISSION_CHECKS) {
    try {
      byCheck.set(id, await RUNNERS[id](skills, sources));
    } catch {
      byCheck.set(id, new Map());
    }
  }
  const verdict = (id: AdmissionCheckId, name: string): CheckResult =>
    byCheck.get(id)?.get(name) ?? "unavailable";
  return new Map(
    skills.map((name) => [
      name,
      {
        structure: verdict("structure", name),
        routing: verdict("routing", name),
        "non-cascade": verdict("non-cascade", name),
        security: verdict("security", name),
        distribution: verdict("distribution", name),
      },
    ]),
  );
}

/** Pure: one receipt entry from a fingerprint, results and the required list. */
export function buildReceiptEntry(
  name: string,
  fingerprint: { readonly fingerprint: string; readonly files: number },
  results: SkillResults,
  required: readonly AdmissionCheckId[],
): ReceiptEntry {
  return {
    name,
    fingerprint: fingerprint.fingerprint,
    files: fingerprint.files,
    checks: ADMISSION_CHECKS.map((id) => ({
      id,
      required: required.includes(id),
      result: results[id],
    })),
    state: deriveAdmissionState(required, results),
  };
}

/** Pure: the receipt of a set of entries, in a stable order. */
export function buildReceipt(entries: readonly ReceiptEntry[]): AdmissionReceipt {
  return {
    schema_version: RECEIPT_FORMAT,
    recipe: FINGERPRINT_RECIPE,
    skills: [...entries].sort((left, right) => compareUtf8(left.name, right.name)),
  };
}

export function renderReceipt(receipt: AdmissionReceipt): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

export interface AdmissionSources extends CheckSources {
  readonly policyPath: string;
}

export interface DeclaredStatus {
  /** `metadata.status` as written, or null when the frontmatter cannot be read. */
  readonly status: string | null;
  readonly note: string;
}

export interface AdmissionRead {
  readonly root: string;
  readonly policyPath: string;
  readonly collection: CollectionRead;
  readonly policy: RequiredChecks;
  /** One entry per skill that could be fingerprinted. */
  readonly receipt: AdmissionReceipt;
  /** Skills with no fingerprint, and every entry that forbids one. */
  readonly unfingerprinted: ReadonlyMap<string, readonly Refusal[]>;
  readonly declared: ReadonlyMap<string, DeclaredStatus>;
  readonly filesHashed: number;
  /** What git does not track under the root, or why it could not say. */
  readonly untracked: UntrackedRead;
  /** The untracked files that belong to no skill directory. */
  readonly strays: readonly Refusal[];
}

async function readDeclaredStatus(root: string, name: string): Promise<DeclaredStatus> {
  let source: string;
  try {
    source = await Bun.file(join(root, name, "SKILL.md")).text();
  } catch (error) {
    return { status: null, note: `SKILL.md cannot be read (${errorCode(error)})` };
  }
  const parsed = parseFrontmatter(source);
  if ("error" in parsed) return { status: null, note: `frontmatter unreadable: ${parsed.error}` };
  const status = parsed.metadata.status;
  return status === undefined
    ? { status: null, note: "no metadata.status" }
    : { status, note: `metadata.status "${status}"` };
}

/** Everything the gate and the generator need, read once from the tree. */
export async function readAdmission(sources: AdmissionSources): Promise<AdmissionRead> {
  const collection = listSkillDirectories(sources.root);
  const policy = readRequiredChecks(
    await Bun.file(sources.policyPath)
      .text()
      .catch(() => null),
  );
  const untracked = listUntracked(sources.root);
  const strays: Refusal[] = [];
  const untrackedIn = new Map<string, Refusal[]>();
  for (const relative of untracked.ok ? untracked.paths : []) {
    const refusal = { path: join(sources.root, relative), reason: UNTRACKED };
    const owner = relative.split("/")[0] ?? "";
    if (collection.skills.includes(owner)) {
      untrackedIn.set(owner, [...(untrackedIn.get(owner) ?? []), refusal]);
    } else {
      strays.push(refusal);
    }
  }
  const results = await runAdmissionChecks(collection.skills, sources);
  const entries: ReceiptEntry[] = [];
  const unfingerprinted = new Map<string, readonly Refusal[]>();
  const declared = new Map<string, DeclaredStatus>();
  let filesHashed = 0;
  for (const name of collection.skills) {
    const fingerprint = fingerprintSkillDirectory(join(sources.root, name));
    const notTracked = untrackedIn.get(name) ?? [];
    if (!fingerprint.ok || notTracked.length > 0) {
      unfingerprinted.set(name, [...(fingerprint.ok ? [] : fingerprint.refusals), ...notTracked]);
      continue;
    }
    const own = results.get(name);
    if (own === undefined) throw new Error(`no check result for "${name}"`);
    filesHashed += fingerprint.files;
    entries.push(buildReceiptEntry(name, fingerprint, own, policy.required));
    declared.set(name, await readDeclaredStatus(sources.root, name));
  }
  return {
    root: sources.root,
    policyPath: sources.policyPath,
    collection,
    policy,
    receipt: buildReceipt(entries),
    unfingerprinted,
    declared,
    filesHashed,
    untracked,
    strays,
  };
}

/**
 * The volume the gate examined. Three sums a reader can check:
 * entries under the root = skills + not a skill + refused;
 * skills = fingerprinted + without fingerprint;
 * fingerprinted = candidate + incomplete.
 * `untracked` is what git answered, `unreadable` when it could not. The
 * entries left out of the collection are named, not only counted: a skill
 * directory whose SKILL.md is misspelt leaves the collection by that door.
 */
export function formatAdmissionVolume(read: AdmissionRead): string {
  const { entries, skills, notSkills, refused } = read.collection;
  const states = read.receipt.skills.map((entry) => entry.state);
  // Each number is counted on its own, never deduced from the others: a sum
  // that holds by construction would say nothing.
  const candidate = states.filter((state) => state === "candidate").length;
  const incomplete = states.filter((state) => state === "incomplete").length;
  const leftOut = notSkills.map((entry) => JSON.stringify(entry)).join(", ") || "none";
  return (
    `entries=${entries} under ${read.root}/ ` +
    `(skills=${skills.length} not-a-skill=${notSkills.length} refused=${refused.length}), ` +
    `skills=${skills.length} (fingerprinted=${states.length} without-fingerprint=${read.unfingerprinted.size}), ` +
    `files-hashed=${read.filesHashed}, ` +
    `untracked=${read.untracked.ok ? read.untracked.paths.length : "unreadable"}, ` +
    `required-checks=${read.policy.required.length} of ${ADMISSION_CHECKS.length} known, ` +
    `states=${states.length} (candidate=${candidate} incomplete=${incomplete}), ` +
    `not a skill: ${leftOut}`
  );
}

type CommittedEntries =
  | { readonly ok: true; readonly byName: ReadonlyMap<string, unknown> }
  | { readonly ok: false; readonly reason: string };

function committedEntries(text: string): CommittedEntries {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `not valid JSON (${message})` };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.skills)) {
    return { ok: false, reason: "no `skills` list" };
  }
  const byName = new Map<string, unknown>();
  for (const entry of parsed.skills as readonly unknown[]) {
    if (!isRecord(entry) || typeof entry.name !== "string") {
      return { ok: false, reason: "a `skills` entry carries no `name`" };
    }
    if (byName.has(entry.name)) return { ok: false, reason: `"${entry.name}" is listed twice` };
    byName.set(entry.name, entry);
  }
  return { ok: true, byName };
}

function notPassed(entry: ReceiptEntry): string {
  const failing = entry.checks.filter((check) => check.required && check.result !== "pass");
  return failing.map((check) => `${check.id}=${check.result}`).join(", ") || "none";
}

/**
 * What to do about a skill the receipt does not hold as generated.
 * Regenerating only helps a state the gate accepts: it would record
 * `incomplete` as faithfully, and the gate would stay red.
 */
function remedy(generated: ReceiptEntry): string {
  return generated.state === "candidate"
    ? REGENERATE
    : `repair the skill or the check that does not pass (${notPassed(generated)}): generated again, the receipt would record "incomplete", which this gate refuses`;
}

function describeDifference(committed: unknown, generated: ReceiptEntry): string {
  const written = isRecord(committed) ? committed.fingerprint : undefined;
  if (written !== generated.fingerprint) {
    return `the receipt holds fingerprint ${JSON.stringify(written)} and the directory now gives ${generated.fingerprint}: it changed since the receipt was generated — ${remedy(generated)}`;
  }
  return `same fingerprint, but the checks or the state written in the receipt are not the ones the tree gives (state "${generated.state}", required checks not passed: ${notPassed(generated)}) — ${remedy(generated)}`;
}

/** Pure verdict: what was read from the tree against the committed receipt. */
export function evaluateAdmission(
  read: AdmissionRead,
  committed: string | null,
  receiptPath: string = RECEIPT_PATH,
): GateReport {
  const report = new GateReport();
  report.volume(formatAdmissionVolume(read));

  report.check(
    read.policyPath,
    read.policy.defect === null,
    read.policy.defect === null
      ? `${read.policy.required.length} required check(s): ${read.policy.required.join(", ")}`
      : `${read.policy.defect} — every known check is read as required until the policy is repaired`,
  );

  for (const { path, reason } of read.collection.refused) report.check(path, false, reason);
  report.check(
    `${read.root}/`,
    read.collection.skills.length > 0,
    read.collection.skills.length > 0
      ? `${read.collection.skills.length} skill directory(ies)`
      : "no skill directory found: the gate would hold a receipt of nothing",
  );

  for (const [name, refusals] of read.unfingerprinted) {
    for (const { path, reason } of refusals) {
      report.check(path, false, `${reason} — skill "${name}" has no fingerprint`);
    }
  }
  if (!read.untracked.ok) {
    report.check(
      `${read.root}/ — untracked files`,
      false,
      `${read.untracked.reason} — a stray file cannot be told from a versioned one`,
    );
  }
  for (const { path, reason } of read.strays) report.check(path, false, reason);

  const receipt = committed === null ? null : committedEntries(committed);
  if (receipt === null) {
    report.check(
      receiptPath,
      false,
      `absent — generate it with \`bun run build:skills-admission\``,
    );
  } else if (!receipt.ok) {
    report.check(receiptPath, false, `unreadable: ${receipt.reason}`);
  }

  for (const entry of read.receipt.skills) {
    const item = `${read.root}/${entry.name}`;
    if (receipt?.ok) {
      const written = receipt.byName.get(entry.name);
      const same = JSON.stringify(written) === JSON.stringify(entry);
      report.check(
        `${item} — receipt`,
        same,
        same
          ? `${entry.fingerprint}, ${entry.files} file(s), state "${entry.state}"`
          : written === undefined
            ? `not in the receipt — ${remedy(entry)}`
            : describeDifference(written, entry),
      );
    }
    const declared = read.declared.get(entry.name);
    const agrees = declared?.status === entry.state;
    report.check(
      `${item}/SKILL.md — declared status`,
      agrees,
      agrees
        ? `${declared?.note} is the derived state`
        : declared?.status === "promoted"
          ? `declares "promoted", which no tool derives: a promotion is an act of the owner bound to a fingerprint, and none is recorded for this one (derived state "${entry.state}")`
          : `${declared?.note ?? "no declared status"}, derived state "${entry.state}" (required checks not passed: ${notPassed(entry)}) — the frontmatter follows the derived state, never the reverse: a check that does not pass is repaired in the skill or in the check, and "incomplete" cannot be declared`,
    );
  }
  const unrepaired = read.receipt.skills
    .filter((entry) => entry.state === "incomplete")
    .map((entry) => entry.name);

  if (receipt?.ok) {
    const onTree = new Set(read.collection.skills);
    const gone = [...receipt.byName.keys()].filter((name) => !onTree.has(name)).sort(compareUtf8);
    report.check(
      `${receiptPath} — skills = collection`,
      gone.length === 0,
      gone.length === 0
        ? `no entry for a skill that is not under ${read.root}/`
        : `lists skill(s) that are not under ${read.root}/: ${gone.join(", ")} — ${REGENERATE}`,
    );
    const identical = read.unfingerprinted.size === 0 && committed === renderReceipt(read.receipt);
    report.check(
      `${receiptPath} — generated form`,
      identical,
      identical
        ? "byte-identical to the generated receipt"
        : unrepaired.length === 0
          ? `differs from the generated receipt — ${REGENERATE}`
          : `differs from the generated receipt — repair first: generated again, it would record "incomplete" for ${unrepaired.join(", ")}`,
    );
  }
  return report;
}

if (import.meta.main) {
  const gate = "Skills admission receipt";
  const read = await readAdmission({
    root: SKILLS_ROOT,
    manifestPath: MANIFEST_PATH,
    patternsPath: PATTERNS_PATH,
    policyPath: POLICY_PATH,
  });
  if (process.argv.includes("--check")) {
    const committed = existsSync(RECEIPT_PATH) ? await Bun.file(RECEIPT_PATH).text() : null;
    const report = evaluateAdmission(read, committed);
    // A failing run prints no success line, so the volume is printed apart.
    if (report.outcome !== "pass") console.error(`${gate}: ${formatAdmissionVolume(read)}`);
    concludeGate(gate, report);
  } else {
    // A receipt is written whole or not at all: a skill without a fingerprint,
    // an untracked file or a policy that is not followed as written would
    // make it say less, or something else, than what a clone holds.
    const blockers = [
      ...read.collection.refused,
      ...[...read.unfingerprinted.values()].flat(),
      ...read.strays,
      ...(read.untracked.ok ? [] : [{ path: SKILLS_ROOT, reason: read.untracked.reason }]),
      ...(read.policy.defect === null ? [] : [{ path: POLICY_PATH, reason: read.policy.defect }]),
    ];
    if (blockers.length > 0) {
      for (const { path, reason } of blockers) console.error(`${gate}: ${path}: ${reason}`);
      console.error(`${gate}: not written — ${formatAdmissionVolume(read)}`);
      process.exit(1);
    }
    const rendered = renderReceipt(read.receipt);
    await Bun.write(RECEIPT_PATH, rendered);
    // The exit code is the verdict of the gate on what was just written. A
    // receipt that records `incomplete` is a faithful one, and a red one: the
    // generator does not answer 0 for a state it knows the gate refuses.
    const report = evaluateAdmission(read, rendered);
    if (report.outcome === "pass") {
      console.log(`Generated ${RECEIPT_PATH}: ${formatAdmissionVolume(read)}`);
    } else {
      console.error(
        `${gate}: wrote ${RECEIPT_PATH}, which the gate refuses — ${formatAdmissionVolume(read)}`,
      );
      concludeGate(gate, report);
    }
  }
}
