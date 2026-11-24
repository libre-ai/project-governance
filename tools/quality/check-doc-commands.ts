/**
 * Documents show commands that exist.
 *
 * A document that teaches `bun run <script>` keeps teaching it after the script
 * is renamed or removed: nothing reads the document against `package.json`, so
 * the drift is found by the reader, not by a gate. This gate reads the commands
 * of the declared documents and asserts that each one names a key of `scripts`.
 *
 * What this gate asserts, mechanically:
 *   - every declared document is readable; an unreadable document is a failure,
 *     never a zero (a missing file and a file with no command must not look alike);
 *   - the manifest is readable, is JSON, and has a non-empty `scripts` object;
 *   - every `bun run <name>` shown in a declared document, inside a fenced code
 *     block or a code span, names a key of `scripts`, or is admitted by an
 *     `exemptions` entry with the same document and the same command;
 *   - an exemption that admits no unresolved command is stale, and fails;
 *   - a declared document that shows no command at all fails: its declaration
 *     would otherwise vouch for nothing.
 *
 * Grammar. A command is `bun run` followed by a name of `[A-Za-z0-9:_-]+`. Two
 * occurrences are not read as commands and are counted apart:
 *   - a placeholder: `bun run` followed by `<`, or a name followed by `…`
 *     (`bun run check:…`, `bun run <script>`). They name no script, so they are
 *     neither verified nor failures;
 *   - bare prose: an occurrence outside any fenced block and outside any code
 *     span. Prose is not read; it is neither verified nor a failure.
 *
 * `cargo` commands (owner decision of 2026-11-24, "extend by name": verify that
 * the command exists, without running it). A `cargo run|test|build|check` that
 * names a package (`-p`, `--package`) or a binary (`--bin`) is resolved against
 * the `Cargo.toml` files the registry declares with `cargo`, read as files.
 * Every other `cargo` form shown in code is NOT RECOGNISED: it is counted
 * apart, printed, and never counted as resolved. The grammar, what a name is
 * resolved against, and the limits of the manifest reading are stated in
 * `doc-commands-cargo.ts`.
 *
 * What it deliberately does NOT assert:
 *   - that a resolved command succeeds when it is run: a key of `scripts` or a
 *     package may exist and still fail. Nothing a document shows is executed;
 *   - the commands of other tools (`git`, `clever`, a bare `bun <file>`): only
 *     `bun run` and `cargo` are read;
 *   - the documents that are not declared: the declaration is the scope, and a
 *     new document that shows a command is outside it until it is declared;
 *   - that a command is the RIGHT one for the sentence around it.
 *
 * The declared documents, the manifests and the exemptions live in data, in the
 * repository the gate is run against: `tools/quality/doc-commands.v1.json`
 * unless `--registry` names another path. Nothing here names this repository:
 *
 *   bun tools/quality/check-doc-commands.ts [<root>] [--registry <path>]
 *
 * `<root>` defaults to the git toplevel of the working directory. The registry,
 * the manifests and the documents are read under `<root>` and nowhere else: a
 * path or a symbolic link that leaves it is unreadable, hence a failure. A
 * registry that is absent, unreadable or malformed is a failure, never zero
 * documents. `reusable-doc-commands.yml` runs this file from the governance
 * checkout against the workspace of a consuming repository.
 */

import { execSync } from "node:child_process";
import {
  type CargoReading,
  type CargoWorkspace,
  classifyCargo,
  isContainedPath,
  loadCargoWorkspace,
  readContained,
  resolveCargo,
} from "./doc-commands-cargo";
import { GateReport, renderGateReport } from "./gate-report";

export interface DeclaredDocument {
  readonly path: string;
  readonly because: string;
}

/** One command a declared document shows that the manifest cannot resolve, admitted by name. */
export interface CommandExemption {
  readonly path: string;
  /** The command as read: `bun run <name>`, or `cargo` and its tokens up to a `--`. */
  readonly command: string;
  readonly because: string;
}

export interface DocCommandsConfig {
  /** The `package.json` whose scripts resolve `bun run`. At least one of `manifest`, `cargo`. */
  readonly manifest?: string;
  /** The root `Cargo.toml` whose packages resolve `cargo`. */
  readonly cargo?: string;
  readonly documents: readonly DeclaredDocument[];
  readonly exemptions: readonly CommandExemption[];
}

/** A document as read by the effectful half: `text` is null when it could not be read. */
export interface ReadDocument {
  readonly path: string;
  readonly text: string | null;
}

/** One `bun run ` occurrence of a document, classified before anything is verified. */
export type Occurrence =
  | { readonly kind: "read"; readonly line: number; readonly name: string }
  | { readonly kind: "placeholder"; readonly line: number }
  | { readonly kind: "prose"; readonly line: number };

const OCCURRENCE = /bun run /g;
const NAME = /^[A-Za-z0-9:_-]+/;

/**
 * Which characters of a line lie inside a closed code span.
 *
 * The line is split on backticks: the odd segments are the spans, but only when
 * a closing backtick follows them. An unclosed backtick opens no span, so the
 * text after it stays prose.
 */
function codeSpanMask(line: string): boolean[] {
  const mask = new Array<boolean>(line.length).fill(false);
  const parts = line.split("`");
  let position = 0;
  for (const [index, part] of parts.entries()) {
    const closed = index % 2 === 1 && index < parts.length - 1;
    if (closed) mask.fill(true, position, position + part.length);
    position += part.length + 1;
  }
  return mask;
}

/** One match of a command pattern: where it is, and whether it sits in code. */
interface Hit {
  readonly line: number;
  /** Null for bare prose; otherwise what follows the match, cut at the end of a code span. */
  readonly rest: string | null;
  /** What follows the match up to the end of the line, code span or not. */
  readonly tail: string;
}

/**
 * Every match of `pattern` in a text, line by line, with the fenced blocks and
 * the code spans told apart from prose. The text is read in NFC, as the other
 * gates do.
 */
function scanHits(text: string, pattern: RegExp): Hit[] {
  const hits: Hit[] = [];
  let inFence = false;
  for (const [index, line] of text.normalize("NFC").split("\n").entries()) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    const inSpan = codeSpanMask(line);
    for (const match of line.matchAll(pattern)) {
      const tail = line.slice(match.index + match[0].length);
      if (!inFence && !inSpan[match.index]) {
        hits.push({ line: index + 1, rest: null, tail });
        continue;
      }
      const close = inFence ? -1 : tail.indexOf("`");
      hits.push({ line: index + 1, rest: close === -1 ? tail : tail.slice(0, close), tail });
    }
  }
  return hits;
}

/**
 * Every `bun run ` of a text, with its line, classified as a command read, a
 * placeholder, or bare prose.
 */
export function scanOccurrences(text: string): Occurrence[] {
  return scanHits(text, OCCURRENCE).map((hit): Occurrence => {
    if (hit.rest === null) return { kind: "prose", line: hit.line };
    const name = NAME.exec(hit.tail)?.[0];
    if (name === undefined) return { kind: "placeholder", line: hit.line };
    const after = hit.tail[name.length];
    return after === "<" || after === "…"
      ? { kind: "placeholder", line: hit.line }
      : { kind: "read", line: hit.line, name };
  });
}

/** One `cargo ` occurrence of a document: bare prose, or what the code after it reads as. */
export interface CargoOccurrence {
  readonly line: number;
  readonly reading: CargoReading | { readonly kind: "prose" };
}

// `cargo` as a word of its own: `cargo-deny ` and `escargo ` are not occurrences.
const CARGO_OCCURRENCE = /(?<![A-Za-z0-9_-])cargo /g;

/** Every `cargo ` of a text, with its line, classified by `classifyCargo`. */
export function scanCargoOccurrences(text: string): CargoOccurrence[] {
  return scanHits(text, CARGO_OCCURRENCE).map((hit) => ({
    line: hit.line,
    reading: hit.rest === null ? { kind: "prose" as const } : classifyCargo(hit.rest),
  }));
}

interface ManifestScripts {
  readonly names: ReadonlySet<string>;
  /** Why the manifest cannot be used, or null when it can. */
  readonly failure: string | null;
}

function parseScripts(text: string | null): ManifestScripts {
  const none: ReadonlySet<string> = new Set<string>();
  if (text === null) return { names: none, failure: "could not be read" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { names: none, failure: "is not valid JSON" };
  }
  const scripts =
    typeof parsed === "object" && parsed !== null && "scripts" in parsed
      ? parsed.scripts
      : undefined;
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
    return { names: none, failure: "has no scripts object" };
  }
  const names = new Set(Object.keys(scripts));
  if (names.size === 0) return { names, failure: "declares no script" };
  return { names, failure: null };
}

export interface DocCommandsVolume {
  readonly manifestScripts: number;
  readonly declaredRead: number;
  readonly declaredUnreadable: number;
  readonly occurrences: number;
  readonly read: number;
  readonly placeholders: number;
  readonly bareProse: number;
  readonly resolved: number;
  readonly exempted: number;
  readonly unresolved: number;
  readonly exemptions: number;
  readonly exemptionsStale: number;
  readonly cargoPackages: number;
  readonly cargoOccurrences: number;
  /** In code and not a placeholder: resolved + exempted + unresolved + unrecognised. */
  readonly cargoRead: number;
  readonly cargoPlaceholders: number;
  readonly cargoBareProse: number;
  readonly cargoResolved: number;
  readonly cargoExempted: number;
  readonly cargoUnresolved: number;
  /** A `cargo` form this gate cannot resolve by name: counted apart, never as resolved. */
  readonly cargoUnrecognised: number;
}

interface Coverage {
  readonly exemption: CommandExemption;
  /** Read commands of the document and the command this entry names. */
  matched: number;
  /** Unresolved commands this entry admits. */
  used: number;
}

/** Pure verdict over texts already read, so every rule is testable without a filesystem. */
export function evaluateDocCommands(
  manifestText: string | null,
  documents: readonly ReadDocument[],
  config: DocCommandsConfig,
  cargo: CargoWorkspace | null = null,
): { report: GateReport; volume: DocCommandsVolume; unrecognised: string[] } {
  const report = new GateReport();
  const manifestName = config.manifest ?? null;
  const manifest: ManifestScripts =
    manifestName === null
      ? { names: new Set<string>(), failure: "is not declared" }
      : parseScripts(manifestText);
  if (manifestName !== null) {
    report.check(
      manifestName,
      manifest.failure === null,
      manifest.failure === null
        ? `${manifest.names.size} script(s) declared`
        : `manifest ${manifest.failure} — no command can be resolved against it`,
    );
  }
  const cargoName = config.cargo ?? null;
  const workspace: CargoWorkspace = cargo ?? {
    packages: [],
    failures: cargoName === null ? [] : [`${cargoName} was not read`],
  };
  if (cargoName !== null) {
    report.check(
      cargoName,
      workspace.failures.length === 0,
      workspace.failures.length === 0
        ? `${workspace.packages.length} package(s) read`
        : `cargo manifests unreadable — ${workspace.failures.join("; ")}`,
    );
  }

  const textOf = new Map(documents.map((document) => [document.path, document.text] as const));
  const coverage = new Map<string, Coverage>(
    config.exemptions.map((exemption) => [
      JSON.stringify([exemption.path, exemption.command]),
      { exemption, matched: 0, used: 0 },
    ]),
  );

  let declaredRead = 0;
  let declaredUnreadable = 0;
  let occurrences = 0;
  let read = 0;
  let placeholders = 0;
  let bareProse = 0;
  let resolved = 0;
  let exempted = 0;
  let unresolved = 0;
  let cargoOccurrences = 0;
  let cargoPlaceholders = 0;
  let cargoBareProse = 0;
  let cargoResolved = 0;
  let cargoExempted = 0;
  let cargoUnresolved = 0;
  const unrecognised: string[] = [];

  for (const declared of config.documents) {
    const text = textOf.get(declared.path) ?? null;
    if (text === null) {
      declaredUnreadable += 1;
      report.check(
        declared.path,
        false,
        "declared document could not be read — a missing file is not zero commands",
      );
      continue;
    }
    declaredRead += 1;
    const found = scanOccurrences(text);
    let readHere = 0;
    for (const occurrence of found) {
      occurrences += 1;
      if (occurrence.kind === "placeholder") {
        placeholders += 1;
        continue;
      }
      if (occurrence.kind === "prose") {
        bareProse += 1;
        continue;
      }
      read += 1;
      readHere += 1;
      const command = `bun run ${occurrence.name}`;
      const item = `${declared.path}:${occurrence.line} ${command}`;
      const cover = coverage.get(JSON.stringify([declared.path, command]));
      if (cover !== undefined) cover.matched += 1;
      const refused = !manifest.names.has(occurrence.name);
      if (!refused) {
        resolved += 1;
        report.check(item, true, `${command} names a script of ${config.manifest}`);
      } else if (cover !== undefined) {
        exempted += 1;
        cover.used += 1;
        report.check(item, true, `exempted: ${cover.exemption.because}`);
      } else {
        unresolved += 1;
        const why =
          manifest.failure === null
            ? `${command} names no key of scripts in ${config.manifest}`
            : manifestName === null
              ? `${command} cannot be resolved: the registry declares no package manifest`
              : `${command} cannot be resolved: the manifest ${manifest.failure}`;
        report.check(item, false, why);
      }
    }
    const foundCargo = scanCargoOccurrences(text);
    for (const { line, reading } of foundCargo) {
      cargoOccurrences += 1;
      if (reading.kind === "placeholder") {
        cargoPlaceholders += 1;
        continue;
      }
      if (reading.kind === "prose") {
        cargoBareProse += 1;
        continue;
      }
      const item = `${declared.path}:${line} ${reading.command}`;
      if (reading.kind === "unrecognised") {
        unrecognised.push(`${item}: ${reading.why}`);
        continue;
      }
      readHere += 1;
      const cover = coverage.get(JSON.stringify([declared.path, reading.command]));
      if (cover !== undefined) cover.matched += 1;
      const refusal =
        cargoName === null
          ? "the registry declares no cargo manifest"
          : resolveCargo(reading, workspace.packages);
      if (refusal === null) {
        cargoResolved += 1;
        report.check(item, true, `names targets of the manifests under ${cargoName}`);
      } else if (cover !== undefined) {
        cargoExempted += 1;
        cover.used += 1;
        report.check(item, true, `exempted: ${cover.exemption.because}`);
      } else {
        cargoUnresolved += 1;
        report.check(item, false, `${reading.command} cannot be resolved: ${refusal}`);
      }
    }
    if (readHere === 0) {
      report.check(
        declared.path,
        false,
        `declared but shows no command (${found.length} occurrence(s) of "bun run ", ` +
          `${foundCargo.length} of "cargo ", none read)`,
      );
    }
  }

  let exemptionsStale = 0;
  for (const cover of coverage.values()) {
    const { exemption } = cover;
    const item = `exemption ${exemption.path} ${exemption.command}`;
    const ok = cover.used > 0;
    if (!ok) exemptionsStale += 1;
    const note = ok
      ? `admits ${cover.used} unresolved command(s): ${exemption.because}`
      : cover.matched > 0
        ? "admits only commands that resolve — stale, remove it"
        : "admits no command read in the declared documents — stale, remove it";
    report.check(item, ok, note);
  }

  const volume: DocCommandsVolume = {
    manifestScripts: manifest.names.size,
    declaredRead,
    declaredUnreadable,
    occurrences,
    read,
    placeholders,
    bareProse,
    resolved,
    exempted,
    unresolved,
    exemptions: config.exemptions.length,
    exemptionsStale,
    cargoPackages: workspace.packages.length,
    cargoOccurrences,
    cargoRead: cargoResolved + cargoExempted + cargoUnresolved + unrecognised.length,
    cargoPlaceholders,
    cargoBareProse,
    cargoResolved,
    cargoExempted,
    cargoUnresolved,
    cargoUnrecognised: unrecognised.length,
  };
  report.volume(
    `${
      manifestName === null
        ? "no package manifest declared"
        : `${manifest.names.size} script(s) in ${manifestName}`
    }; ` +
      `${declaredRead} declared document(s) read, ${declaredUnreadable} unreadable; ` +
      `${occurrences} occurrence(s) of "bun run " = ${read} read + ${placeholders} placeholder(s) ` +
      `+ ${bareProse} bare prose (neither verified nor a failure); ` +
      `${read} read = ${resolved} resolved + ${exempted} exempted + ${unresolved} unresolved; ` +
      `${
        cargoName === null
          ? "no cargo manifest declared"
          : `${workspace.packages.length} package(s) under ${cargoName}`
      }; ` +
      `${cargoOccurrences} occurrence(s) of "cargo " = ${volume.cargoRead} read ` +
      `+ ${cargoPlaceholders} placeholder(s) + ${cargoBareProse} bare prose; ` +
      `${volume.cargoRead} read = ${cargoResolved} resolved + ${cargoExempted} exempted ` +
      `+ ${cargoUnresolved} unresolved + ${unrecognised.length} not recognised ` +
      `(counted apart, never as resolved); ` +
      `${config.exemptions.length} exemption(s) declared, ${exemptionsStale} stale`,
  );
  return { report, volume, unrecognised };
}

/** Collects every input from disk: the effectful half of the gate. Nothing outside `root` is read. */
export async function loadDocCommandsInput(
  root: string,
  config: DocCommandsConfig,
): Promise<{ manifest: string | null; documents: ReadDocument[]; cargo: CargoWorkspace | null }> {
  const manifest =
    config.manifest === undefined ? null : await readContained(root, config.manifest);
  const documents = await Promise.all(
    config.documents.map(async (doc) => ({
      path: doc.path,
      text: await readContained(root, doc.path),
    })),
  );
  const cargo = config.cargo === undefined ? null : await loadCargoWorkspace(root, config.cargo);
  return { manifest, documents, cargo };
}

export const CONFIG_PATH = "tools/quality/doc-commands.v1.json";

const EXEMPTED_COMMAND = /^(?:bun run [A-Za-z0-9:_-]+|cargo \S+(?: \S+)*)$/;

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function validateConfig(value: unknown): DocCommandsConfig {
  const where = "doc-commands.v1.json";
  const candidate = value as Partial<DocCommandsConfig> | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    (candidate.manifest === undefined && candidate.cargo === undefined) ||
    !Array.isArray(candidate.documents) ||
    candidate.documents.length === 0 ||
    !Array.isArray(candidate.exemptions)
  ) {
    throw new Error(`${where}: expected { manifest and/or cargo, documents[≥1], exemptions }`);
  }
  for (const key of ["manifest", "cargo"] as const) {
    const path: unknown = candidate[key];
    if (path !== undefined && (!isNonBlank(path) || !isContainedPath(path))) {
      throw new Error(`${where}: ${key} must be a path inside the repository`);
    }
  }
  const paths = new Set<string>();
  for (const doc of candidate.documents) {
    if (!isNonBlank(doc?.path) || !isNonBlank(doc?.because)) {
      throw new Error(`${where}: every document needs a path and a non-empty because`);
    }
    if (!isContainedPath(doc.path)) {
      throw new Error(`${where}: document ${doc.path} must be a path inside the repository`);
    }
    if (paths.has(doc.path)) throw new Error(`${where}: duplicate document ${doc.path}`);
    paths.add(doc.path);
  }
  // Written even when empty: an absent list and a list nobody could read must
  // not look alike.
  const seen = new Set<string>();
  for (const entry of candidate.exemptions) {
    if (!isNonBlank(entry?.path) || !paths.has(entry.path)) {
      throw new Error(`${where}: exemption path ${String(entry?.path)} is not a declared document`);
    }
    if (typeof entry.command !== "string" || !EXEMPTED_COMMAND.test(entry.command)) {
      throw new Error(
        `${where}: exemption command ${String(entry.command)} is not of the form ` +
          "`bun run <name>` or `cargo <subcommand> …` with single spaces",
      );
    }
    if (!isNonBlank(entry.because)) {
      throw new Error(
        `${where}: exemption ${entry.path} ${entry.command} needs a non-empty because`,
      );
    }
    const key = JSON.stringify([entry.path, entry.command]);
    if (seen.has(key)) {
      throw new Error(`${where}: duplicate exemption ${entry.path} ${entry.command}`);
    }
    seen.add(key);
  }
  return candidate as DocCommandsConfig;
}

const GATE = "Doc commands";

/**
 * The whole gate against one repository root: registry, inputs, verdict, and
 * the lines to print. A registry that cannot be read or does not validate is a
 * failure with its reason, never a run over zero documents.
 */
export async function runDocCommands(
  root: string,
  registry: string = CONFIG_PATH,
  verbose = false,
): Promise<{ ok: boolean; lines: string[] }> {
  const refuse = (why: string) => ({ ok: false, lines: [`${GATE} failed: registry ${why}`] });
  if (!isContainedPath(registry)) return refuse(`${registry} must be a path inside the root`);
  const registryText = await readContained(root, registry);
  if (registryText === null) {
    return refuse(`${registry} could not be read under the root — not zero documents`);
  }
  let config: DocCommandsConfig;
  try {
    config = validateConfig(JSON.parse(registryText));
  } catch (error) {
    return refuse(`${registry} is not usable: ${error instanceof Error ? error.message : "?"}`);
  }
  const input = await loadDocCommandsInput(root, config);
  const { report, unrecognised } = evaluateDocCommands(
    input.manifest,
    input.documents,
    config,
    input.cargo,
  );
  const rendered = renderGateReport(GATE, report, verbose);
  const lines = unrecognised.map(
    (entry) => `${GATE}: not recognised, counted apart and not resolved — ${entry}`,
  );
  // The counters are printed on a failure too, so the failing run shows its own sums.
  if (report.outcome === "violations" && report.volumeSummary !== null) {
    lines.push(`${GATE}: ${report.volumeSummary}`);
  }
  return { ok: rendered.ok, lines: [...lines, ...rendered.lines] };
}

const USAGE = "usage: bun tools/quality/check-doc-commands.ts [<root>] [--registry <path>]";

/** `[<root>] [--registry <path>]`, or null when the arguments are not of that form. */
export function parseArguments(
  argv: readonly string[],
): { root: string | null; registry: string } | null {
  let root: string | null = null;
  let registry = CONFIG_PATH;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument === "--registry") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) return null;
      registry = value;
      index += 1;
    } else if (argument.startsWith("-") || root !== null) {
      return null;
    } else {
      root = argument;
    }
  }
  return { root, registry };
}

if (import.meta.main) {
  const options = parseArguments(process.argv.slice(2));
  if (options === null) {
    console.error(USAGE);
    process.exit(2);
  }
  const root =
    options.root ?? execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  const result = await runDocCommands(root, options.registry, Boolean(process.env.GATE_VERBOSE));
  for (const line of result.lines) {
    if (result.ok) console.log(line);
    else console.error(line);
  }
  if (!result.ok) process.exit(1);
}
