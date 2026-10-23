import { readPullRequestEvent, stripNonDeclarations } from "./check-pr-door";
import { concludeGate, GateReport } from "./gate-report";
import { type ChangedPath, listChangedPaths, readGit, runGit } from "./git-diff";

/**
 * Negatives gate (ADR-0056 D5) — a pull request that declares what it does
 * NOT add is held to that declaration by its own diff.
 *
 * Why: ADR-0056 D5 makes a negative declared and contradicted by the diff a
 * blocking defect from the signature, and until this gate nothing read the
 * declaration: a pull request could write "adds no dependency" above a new
 * entry in `package.json` and only a careful reviewer would see it.
 *
 * The form (owner decisions in chat on 2026-10-23, which ADR-0056 left to the
 * gate), on its own line, at the start of the line, like `Door:`:
 *
 *     Not-added: dependency, schema, telemetry
 *
 * - at most one `Not-added:` line, outside HTML comments and fenced code
 *   blocks (removed first, by check-pr-door's own `stripNonDeclarations`, so
 *   the template's guidance or a quoted example never counts). Two lines are
 *   refused. A line whose key is not written exactly `Not-added:`
 *   (`not-added:`, `Not added:`) is refused rather than ignored: ignoring it
 *   would let the author believe a negative is held that nothing reads;
 * - values from the closed vocabulary, separated by commas, each once:
 *   `dependency`, `schema`, `workflow` (checked against the diff) and
 *   `hosted-service`, `telemetry`, `public-surface` (declarative: validated as
 *   values, printed as not verified by this gate, read in review — D2);
 * - optional: no line, the gate passes and says so. A line present is
 *   validated, and each verifiable negative is confronted to the diff; a
 *   contradiction fails, named.
 *
 * What "adds" means, per verifiable negative. The path patterns, manifest
 * sections and file names are data (`pr-negatives.v1.json`), not logic:
 *
 * - `workflow`: a path added (status `A`) under `.github/workflows/`. Any
 *   file there, a non-workflow file included: the negative says the pull
 *   request adds nothing to that directory. A renamed workflow counts — the
 *   path list is read with `--no-renames`, and GitHub keys a workflow by its
 *   path (its run history and its check name follow the new path).
 * - `schema`: a path added whose name ends in `.schema.json` — the fleet's
 *   whole convention, measured on 2026-10-23 (the data file carries the
 *   measure and its command). A modified schema is not an added one.
 * - `dependency`: an entry present at the head and absent at the base in a
 *   dependency section of a read manifest (`package.json`: `dependencies`,
 *   `devDependencies`, `optionalDependencies`, `peerDependencies`;
 *   `Cargo.toml`: `[dependencies]`, `[dev-dependencies]`,
 *   `[build-dependencies]`, `[workspace.dependencies]` and their
 *   `[target.*]` forms) — a manifest added is compared to an empty one; or a
 *   lockfile added. An entry moved to another section is new in that section:
 *   a development dependency promoted to runtime adds a runtime dependency.
 *   The two sides are parsed, not diffed line by line: a reformatted manifest
 *   adds no entry, and an entry added inside an unchanged hunk context is
 *   still seen.
 *
 * A lockfile only modified is not, alone, a dependency added. It changes on
 * every version bump and every re-resolution; a direct dependency enters
 * through its manifest, which is read. The negative is about the direct
 * dependencies the pull request takes on, not about the transitive set a
 * resolver picks: those lockfiles are named and counted on the verdict line,
 * never judged in silence.
 *
 * What the gate cannot read is a failure of the negative, not a zero: a
 * manifest of an ecosystem it does not parse (`requirements*.txt`,
 * `pyproject.toml`, `go.mod`… — the list is data), added or modified while
 * `dependency` is declared, makes that negative unverifiable, and an
 * unverifiable negative fails, named. The author drops the negative or the
 * gate learns the format. A manifest or diff that cannot be read or parsed
 * fails the same way.
 *
 * The diff is read from git, never from the REST API: the merge base of the
 * fetched base branch and HEAD, the path list from the shared `git-diff.ts`
 * (`--no-renames -z`), file contents with `git cat-file blob`, which applies
 * no textconv, filter or diff driver. The diff is read only when a verifiable
 * negative is declared; otherwise there is nothing to confront it to.
 *
 * Runs on `pull_request` events (including `edited`). Elsewhere it declares
 * that it judged nothing. An event payload absent or unreadable on a
 * pull_request run is a failure.
 */

export const VERIFIABLE_NEGATIVES = ["dependency", "schema", "workflow"] as const;
export const DECLARATIVE_NEGATIVES = ["hosted-service", "telemetry", "public-surface"] as const;
export type VerifiableNegative = (typeof VERIFIABLE_NEGATIVES)[number];
export type Negative = VerifiableNegative | (typeof DECLARATIVE_NEGATIVES)[number];

const VOCABULARY: ReadonlySet<string> = new Set([
  ...VERIFIABLE_NEGATIVES,
  ...DECLARATIVE_NEGATIVES,
]);
const VERIFIABLE: ReadonlySet<string> = new Set(VERIFIABLE_NEGATIVES);
const NEGATIVES_KEY = "Not-added:";
/** Any spelling of the key at the start of a line: the exact one is checked afterwards. */
const CANDIDATE_LINE = /^[ \t]*(not[- \t]?added[ \t]*:)(.*)$/gim;
/** The key anywhere, to count the mentions a comment or code block hid. */
const KEY_ANYWHERE = /not[- \t]?added[ \t]*:/gi;
const BAD_SEPARATOR = /[\s;|/]/;

export interface NegativesLines {
  readonly linesExamined: number;
  readonly removedBlocks: number;
  /** `Not-added:` mentions inside the removed comments and code blocks: not declarations. */
  readonly ignoredInBlocks: number;
  readonly candidateLines: number;
}

export type NegativesDeclaration =
  | (NegativesLines & { readonly kind: "absent" })
  | (NegativesLines & { readonly kind: "refused"; readonly reasons: readonly string[] })
  | (NegativesLines & { readonly kind: "declared"; readonly values: readonly Negative[] });

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

/** Pure parse of the `Not-added:` declaration of a pull request description. */
export function readNegativesDeclaration(body: string): NegativesDeclaration {
  const normalized = body.replace(/\r\n?/g, "\n");
  const { text, removedBlocks } = stripNonDeclarations(normalized);
  const candidates = [...text.matchAll(CANDIDATE_LINE)];
  const lines: NegativesLines = {
    linesExamined: text === "" ? 0 : text.split("\n").length,
    removedBlocks,
    ignoredInBlocks: countMatches(normalized, KEY_ANYWHERE) - countMatches(text, KEY_ANYWHERE),
    candidateLines: candidates.length,
  };
  const [candidate] = candidates;
  if (candidate === undefined) return { ...lines, kind: "absent" };
  if (candidates.length > 1) {
    return {
      ...lines,
      kind: "refused",
      reasons: [`${candidates.length} Not-added lines — declare at most one`],
    };
  }
  const key = candidate[1] ?? "";
  if (key !== NEGATIVES_KEY) {
    return {
      ...lines,
      kind: "refused",
      reasons: [`key "${key}" — write it exactly "${NEGATIVES_KEY}"`],
    };
  }
  const value = (candidate[2] ?? "").trim();
  if (value === "") {
    return {
      ...lines,
      kind: "refused",
      reasons: ["empty Not-added line — name at least one value, or remove the line"],
    };
  }
  const reasons: string[] = [];
  const values: Negative[] = [];
  for (const raw of value.split(",")) {
    const item = raw.trim();
    if (item === "") {
      reasons.push("empty value (a doubled, leading or trailing comma)");
    } else if (BAD_SEPARATOR.test(item)) {
      reasons.push(`"${item}" — values are separated by commas only`);
    } else if (!VOCABULARY.has(item)) {
      reasons.push(`"${item}" is not in the vocabulary (${[...VOCABULARY].join(", ")})`);
    } else if (values.includes(item as Negative)) {
      reasons.push(`"${item}" is declared twice`);
    } else {
      values.push(item as Negative);
    }
  }
  if (reasons.length > 0) return { ...lines, kind: "refused", reasons };
  return { ...lines, kind: "declared", values };
}

// ---------------------------------------------------------------------------
// The data: what "added" means, in pr-negatives.v1.json.

export const CONFIG_PATH: string = "tools/quality/pr-negatives.v1.json";

export interface ManifestFormat {
  readonly basename: string;
  readonly parser: "json" | "toml";
  readonly sections: readonly string[];
}

export interface NegativesConfig {
  readonly workflow: readonly RegExp[];
  readonly schema: readonly RegExp[];
  readonly manifests: readonly ManifestFormat[];
  readonly lockfiles: readonly string[];
  readonly unreadManifests: readonly RegExp[];
}

export type ConfigRead =
  | { readonly ok: true; readonly config: NegativesConfig }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item !== "")
  );
}

function compile(patterns: readonly string[], where: string): RegExp[] | string {
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `${where}: "${pattern}" is not a valid pattern (${message})`;
    }
  }
  return compiled;
}

/** Pure validation of the parsed data file. Anything unexpected is a reason, never a default. */
export function validateConfig(value: unknown): ConfigRead {
  const fail = (reason: string): ConfigRead => ({ ok: false, reason: `${CONFIG_PATH}: ${reason}` });
  if (!isRecord(value)) return fail("expected an object");
  const { workflow, schema, dependency } = value;
  if (!isRecord(workflow) || !isNonEmptyStrings(workflow.addedPathPatterns)) {
    return fail("workflow.addedPathPatterns must list at least one pattern");
  }
  if (!isRecord(schema) || !isNonEmptyStrings(schema.addedPathPatterns)) {
    return fail("schema.addedPathPatterns must list at least one pattern");
  }
  if (!isRecord(dependency)) return fail("dependency rule missing");
  const { manifests, lockfiles, unreadManifestPatterns } = dependency;
  if (!Array.isArray(manifests) || manifests.length === 0) {
    return fail("dependency.manifests must list at least one manifest format");
  }
  const formats: ManifestFormat[] = [];
  for (const manifest of manifests) {
    if (
      !isRecord(manifest) ||
      typeof manifest.basename !== "string" ||
      manifest.basename === "" ||
      (manifest.parser !== "json" && manifest.parser !== "toml") ||
      !isNonEmptyStrings(manifest.sections)
    ) {
      return fail(
        "each dependency.manifests entry needs a basename, a json|toml parser and sections",
      );
    }
    formats.push({
      basename: manifest.basename,
      parser: manifest.parser,
      sections: manifest.sections,
    });
  }
  if (!isNonEmptyStrings(lockfiles)) return fail("dependency.lockfiles must list file names");
  if (!isNonEmptyStrings(unreadManifestPatterns)) {
    return fail("dependency.unreadManifestPatterns must list at least one pattern");
  }
  const names = [...formats.map((format) => format.basename), ...lockfiles];
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) return fail(`"${duplicate}" is listed twice`);
  const workflowPatterns = compile(workflow.addedPathPatterns, "workflow.addedPathPatterns");
  const schemaPatterns = compile(schema.addedPathPatterns, "schema.addedPathPatterns");
  const unread = compile(unreadManifestPatterns, "dependency.unreadManifestPatterns");
  for (const compiled of [workflowPatterns, schemaPatterns, unread]) {
    if (typeof compiled === "string") return fail(compiled);
  }
  return {
    ok: true,
    config: {
      workflow: workflowPatterns as RegExp[],
      schema: schemaPatterns as RegExp[],
      manifests: formats,
      lockfiles,
      unreadManifests: unread as RegExp[],
    },
  };
}

// ---------------------------------------------------------------------------
// Dependency entries of a manifest, read on both sides.

export type EntriesRead =
  | { readonly ok: true; readonly entries: readonly string[] }
  | { readonly ok: false; readonly reason: string };

function collectEntries(
  node: unknown,
  segments: readonly string[],
  trail: readonly string[],
  out: string[],
): string | null {
  if (!isRecord(node))
    return `${trail.length === 0 ? "the document" : trail.join(".")} is not a table`;
  const [head, ...rest] = segments;
  if (head === undefined) {
    for (const key of Object.keys(node)) out.push([...trail, key].join("."));
    return null;
  }
  const keys = head === "*" ? Object.keys(node) : Object.hasOwn(node, head) ? [head] : [];
  for (const key of keys) {
    const problem = collectEntries(node[key], rest, [...trail, key], out);
    if (problem !== null) return problem;
  }
  return null;
}

/**
 * Pure: the dependency entries of one manifest text, as `<section>.<name>`.
 * A section absent is no entry; a section present but not a table, or a text
 * that does not parse, is a reason.
 */
export function dependencyEntries(format: ManifestFormat, text: string): EntriesRead {
  let document: unknown;
  try {
    document = format.parser === "json" ? JSON.parse(text) : Bun.TOML.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `does not parse as ${format.parser} (${message})` };
  }
  const entries: string[] = [];
  for (const section of format.sections) {
    const problem = collectEntries(document, section.split("."), [], entries);
    if (problem !== null) return { ok: false, reason: problem };
  }
  return { ok: true, entries };
}

// ---------------------------------------------------------------------------
// The confrontation.

export type BlobRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/** Reads a file at the base (merge base) or at the head of the pull request. */
export type BlobReader = (side: "base" | "head", path: string) => BlobRead;

export type ChangesRead =
  | { readonly ok: true; readonly entries: readonly ChangedPath[]; readonly readBlob: BlobReader }
  | { readonly ok: false; readonly reason: string };

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function addedMatching(entries: readonly ChangedPath[], patterns: readonly RegExp[]): string[] {
  return entries
    .filter((entry) => entry.status === "A" && patterns.some((pattern) => pattern.test(entry.path)))
    .map((entry) => entry.path);
}

export interface DependencyScan {
  /** `<path>: <section>.<name>`, present at the head and absent at the base. */
  readonly addedEntries: readonly string[];
  readonly lockfilesAdded: readonly string[];
  readonly lockfilesModified: readonly string[];
  /** `<path> (<status>)` of a manifest whose format this gate does not read. */
  readonly unread: readonly string[];
  /** `<path> (<side>): <reason>` of a read manifest that could not be read or parsed. */
  readonly unreadable: readonly string[];
  readonly manifestsRead: number;
}

/** Pure over the change set: every dependency the diff adds, and what it could not read. */
export function scanDependencies(
  entries: readonly ChangedPath[],
  readBlob: BlobReader,
  config: NegativesConfig,
): DependencyScan {
  const addedEntries: string[] = [];
  const lockfilesAdded: string[] = [];
  const lockfilesModified: string[] = [];
  const unread: string[] = [];
  const unreadable: string[] = [];
  let manifestsRead = 0;
  for (const { status, path } of entries) {
    if (status === "D") continue;
    const name = basenameOf(path);
    const format = config.manifests.find((manifest) => manifest.basename === name);
    if (format !== undefined) {
      manifestsRead += 1;
      const sides: Partial<Record<"base" | "head", readonly string[]>> = {};
      for (const side of status === "A" ? (["head"] as const) : (["base", "head"] as const)) {
        const blob = readBlob(side, path);
        const read = blob.ok ? dependencyEntries(format, blob.text) : blob;
        if (read.ok) sides[side] = read.entries;
        else unreadable.push(`${path} (${side}): ${read.reason}`);
      }
      const { base = [], head } = sides;
      if (head !== undefined && (status === "A" || sides.base !== undefined)) {
        for (const entry of head) if (!base.includes(entry)) addedEntries.push(`${path}: ${entry}`);
      }
    } else if (config.lockfiles.includes(name)) {
      (status === "A" ? lockfilesAdded : lockfilesModified).push(path);
    } else if (config.unreadManifests.some((pattern) => pattern.test(name))) {
      unread.push(`${path} (${status})`);
    }
  }
  return { addedEntries, lockfilesAdded, lockfilesModified, unread, unreadable, manifestsRead };
}

interface Confrontation {
  readonly ok: boolean;
  readonly note: string;
}

function confrontDependency(scan: DependencyScan): Confrontation {
  const contradictions = [
    ...scan.addedEntries.map((entry) => `dependency entry added: ${entry}`),
    ...scan.lockfilesAdded.map((path) => `lockfile added: ${path}`),
  ];
  const unverifiable = [
    ...scan.unreadable.map((problem) => `manifest unreadable: ${problem}`),
    ...scan.unread.map((path) => `manifest of a format this gate does not read: ${path}`),
  ];
  if (contradictions.length > 0 || unverifiable.length > 0) {
    const parts = [
      contradictions.length > 0 ? `contradicted by the diff — ${contradictions.join("; ")}` : null,
      unverifiable.length > 0
        ? `cannot verify — ${unverifiable.join("; ")} (remove "dependency" from the Not-added line, or teach ${CONFIG_PATH} the format)`
        : null,
    ];
    return { ok: false, note: parts.filter((part) => part !== null).join("; ") };
  }
  const lockNote =
    scan.lockfilesModified.length > 0
      ? `; lockfile(s) modified without a manifest entry added, not judged an addition: ${scan.lockfilesModified.join(", ")}`
      : "";
  return {
    ok: true,
    note: `no dependency entry added in ${scan.manifestsRead} manifest(s) read, no lockfile added${lockNote}`,
  };
}

function confrontPaths(added: readonly string[], what: string, examined: number): Confrontation {
  return added.length > 0
    ? { ok: false, note: `contradicted by the diff — ${what} added: ${added.join(", ")}` }
    : { ok: true, note: `no ${what} added among ${examined} changed path(s)` };
}

/** Pure verdict over one description and, when a verifiable negative needs it, the diff. */
export function evaluateNegatives(
  body: string,
  label: string,
  readChanges: () => ChangesRead,
  config: NegativesConfig,
): GateReport {
  const report = new GateReport();
  const declaration = readNegativesDeclaration(body);
  const ignored =
    declaration.ignoredInBlocks > 0
      ? `; ${declaration.ignoredInBlocks} Not-added mention(s) inside them ignored, not declarations`
      : "";
  const lines =
    `${declaration.linesExamined} description line(s) examined after removing ` +
    `${declaration.removedBlocks} comment/code block(s)${ignored}; ${declaration.candidateLines} Not-added line(s)`;

  if (declaration.kind === "absent") {
    report.check(
      `${label} — Not-added`,
      true,
      "no Not-added line: nothing declared, nothing to confront (optional, ADR-0056 D5)",
    );
    report.volume(`${lines}; diff not read: no negative declared`);
    return report;
  }
  if (declaration.kind === "refused") {
    report.check(`${label} — Not-added`, false, `refused: ${declaration.reasons.join("; ")}`);
    report.volume(`${lines}; diff not read: the declaration is refused`);
    return report;
  }

  const { values } = declaration;
  report.check(`${label} — Not-added`, true, `Not-added: ${values.join(", ")}`);
  const verifiable = values.filter((value): value is VerifiableNegative => VERIFIABLE.has(value));
  const declarative = values.filter((value) => !VERIFIABLE.has(value));
  for (const value of declarative) {
    report.check(
      `${label} — Not-added ${value}`,
      true,
      "declarative: a vocabulary value, not verified by this gate — read in review (ADR-0056 D2)",
    );
  }
  const negatives =
    `negatives: ${values.length} declared, ${verifiable.length} verified against the diff` +
    `${verifiable.length > 0 ? ` (${verifiable.join(", ")})` : ""}, ${declarative.length} declarative, not verified by this gate` +
    `${declarative.length > 0 ? ` (${declarative.join(", ")})` : ""}`;
  if (verifiable.length === 0) {
    report.volume(`${lines}; ${negatives}; diff not read: no verifiable negative declared`);
    return report;
  }

  const changes = readChanges();
  if (!changes.ok) {
    report.check(`${label} — diff`, false, `unreadable, nothing verified: ${changes.reason}`);
    report.volume(`${lines}; ${negatives}; diff unreadable`);
    return report;
  }
  const { entries } = changes;
  const counts = (["A", "M", "D", "T"] as const)
    .map((status) => `${entries.filter((entry) => entry.status === status).length} ${status}`)
    .join(", ");
  let dependencyVolume = "";
  for (const value of verifiable) {
    let confrontation: Confrontation;
    if (value === "workflow") {
      confrontation = confrontPaths(
        addedMatching(entries, config.workflow),
        "workflow file",
        entries.length,
      );
    } else if (value === "schema") {
      confrontation = confrontPaths(
        addedMatching(entries, config.schema),
        "schema file",
        entries.length,
      );
    } else {
      const scan = scanDependencies(entries, changes.readBlob, config);
      confrontation = confrontDependency(scan);
      dependencyVolume =
        `; dependency: ${scan.manifestsRead} manifest(s) read, ${scan.lockfilesAdded.length} lockfile(s) added, ` +
        `${scan.lockfilesModified.length} lockfile(s) modified not judged, ${scan.unread.length} manifest(s) of an unread format, ` +
        `${scan.unreadable.length} unreadable`;
    }
    report.check(`${label} — Not-added ${value}`, confrontation.ok, confrontation.note);
  }
  report.volume(
    `${lines}; ${negatives}; diff: ${entries.length} changed path(s) examined (${counts})${dependencyVolume}`,
  );
  return report;
}

// ---------------------------------------------------------------------------
// The effectful half: the event, the data file, git.

/** Fetch the base, take its merge base with HEAD, and read the change set from there. */
function readPullRequestChanges(baseRef: string): ChangesRead {
  const fetched = runGit(["fetch", "--quiet", "origin", baseRef]);
  if (fetched.exitCode !== 0) {
    return { ok: false, reason: `could not fetch origin/${baseRef}: ${fetched.stderr.trim()}` };
  }
  const mergeBase = readGit(
    ["merge-base", `origin/${baseRef}`, "HEAD"],
    `find the merge base of origin/${baseRef} and HEAD`,
  );
  if (!mergeBase.ok) return mergeBase;
  const base = mergeBase.stdout.trim();
  const listed = listChangedPaths([base, "HEAD"]);
  if (!listed.ok) return listed;
  const readBlob: BlobReader = (side, path) => {
    const read = readGit(
      ["cat-file", "blob", `${side === "base" ? base : "HEAD"}:${path}`],
      `read ${path} at the ${side}`,
    );
    return read.ok ? { ok: true, text: read.stdout } : read;
  };
  return { ok: true, entries: listed.entries, readBlob };
}

async function loadConfig(): Promise<ConfigRead> {
  try {
    return validateConfig(JSON.parse(await Bun.file(CONFIG_PATH).text()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `${CONFIG_PATH} unreadable (${message})` };
  }
}

if (import.meta.main) {
  const gate = "PR negatives";
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    concludeGate(
      gate,
      new GateReport().allowEmpty(
        `not a pull_request run (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}) — ` +
          "the declaration lives in a pull request description, judged at the PR gate",
      ),
    );
  } else {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    const baseRef = process.env.GITHUB_BASE_REF;
    let failure: string | null = null;
    let event: { body: string; number: number | null } | null = null;
    if (!eventPath) {
      failure = "GITHUB_EVENT_PATH is unset on a pull_request run";
    } else {
      try {
        const read = readPullRequestEvent(await Bun.file(eventPath).text());
        if (read.ok) event = read;
        else failure = read.reason;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failure = `event payload unreadable at ${eventPath} (${message})`;
      }
    }
    const config = await loadConfig();
    if (event === null || failure !== null) {
      concludeGate(
        gate,
        new GateReport().check("pull request event", false, failure ?? "no event"),
      );
    } else if (!config.ok) {
      concludeGate(gate, new GateReport().check("negatives data", false, config.reason));
    } else {
      const label =
        event.number === null ? "pull request description" : `PR #${event.number} description`;
      const readChanges = (): ChangesRead =>
        baseRef
          ? readPullRequestChanges(baseRef)
          : { ok: false, reason: "GITHUB_BASE_REF is unset on a pull_request run" };
      concludeGate(gate, evaluateNegatives(event.body, label, readChanges, config.config));
    }
  }
}
