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
 * What it deliberately does NOT assert:
 *   - that a resolved command succeeds when it is run: a key of `scripts` may
 *     exist and still fail;
 *   - the commands of other tools (`cargo`, `git`, `clever`): only `bun run` is read;
 *   - the documents that are not declared: the declaration is the scope, and a
 *     new document that shows `bun run` is outside it until it is declared;
 *   - that a command is the RIGHT one for the sentence around it.
 *
 * The declared documents, the manifest and the exemptions live in data:
 * `tools/quality/doc-commands.v1.json`.
 */

import { execSync } from "node:child_process";
import { join } from "node:path";
import { readOrNull } from "./check-threat-model-citations";
import { concludeGate, GateReport } from "./gate-report";

export interface DeclaredDocument {
  readonly path: string;
  readonly because: string;
}

/** One command a declared document shows that the manifest cannot resolve, admitted by name. */
export interface CommandExemption {
  readonly path: string;
  /** The command as written, `bun run <name>`. */
  readonly command: string;
  readonly because: string;
}

export interface DocCommandsConfig {
  readonly manifest: string;
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

/**
 * Every `bun run ` of a text, with its line, classified as a command read, a
 * placeholder, or bare prose. The text is read in NFC, as the other gates do.
 */
export function scanOccurrences(text: string): Occurrence[] {
  const occurrences: Occurrence[] = [];
  let inFence = false;
  for (const [index, line] of text.normalize("NFC").split("\n").entries()) {
    const lineNumber = index + 1;
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    const inSpan = codeSpanMask(line);
    for (const match of line.matchAll(OCCURRENCE)) {
      const start = match.index;
      if (!inFence && !inSpan[start]) {
        occurrences.push({ kind: "prose", line: lineNumber });
        continue;
      }
      const rest = line.slice(start + match[0].length);
      const name = NAME.exec(rest)?.[0];
      if (name === undefined) {
        occurrences.push({ kind: "placeholder", line: lineNumber });
        continue;
      }
      const after = rest[name.length];
      if (after === "<" || after === "…") {
        occurrences.push({ kind: "placeholder", line: lineNumber });
      } else {
        occurrences.push({ kind: "read", line: lineNumber, name });
      }
    }
  }
  return occurrences;
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
): { report: GateReport; volume: DocCommandsVolume } {
  const report = new GateReport();
  const manifest = parseScripts(manifestText);
  report.check(
    config.manifest,
    manifest.failure === null,
    manifest.failure === null
      ? `${manifest.names.size} script(s) declared`
      : `manifest ${manifest.failure} — no command can be resolved against it`,
  );

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
            : `${command} cannot be resolved: the manifest ${manifest.failure}`;
        report.check(item, false, why);
      }
    }
    if (readHere === 0) {
      report.check(
        declared.path,
        false,
        `declared but shows no command (${found.length} occurrence(s) of "bun run ", none read)`,
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
  };
  report.volume(
    `${manifest.names.size} script(s) in ${config.manifest}; ` +
      `${declaredRead} declared document(s) read, ${declaredUnreadable} unreadable; ` +
      `${occurrences} occurrence(s) of "bun run " = ${read} read + ${placeholders} placeholder(s) ` +
      `+ ${bareProse} bare prose (neither verified nor a failure); ` +
      `${read} read = ${resolved} resolved + ${exempted} exempted + ${unresolved} unresolved; ` +
      `${config.exemptions.length} exemption(s) declared, ${exemptionsStale} stale`,
  );
  return { report, volume };
}

/** Collects every input from disk: the effectful half of the gate. */
export async function loadDocCommandsInput(
  root: string,
  config: DocCommandsConfig,
): Promise<{ manifest: string | null; documents: ReadDocument[] }> {
  const manifest = (await readOrNull(root, config.manifest)).text;
  const documents = await Promise.all(config.documents.map((doc) => readOrNull(root, doc.path)));
  return { manifest, documents };
}

export const CONFIG_PATH = "tools/quality/doc-commands.v1.json";

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function validateConfig(value: unknown): DocCommandsConfig {
  const where = "doc-commands.v1.json";
  const candidate = value as Partial<DocCommandsConfig> | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    !isNonBlank(candidate.manifest) ||
    !Array.isArray(candidate.documents) ||
    candidate.documents.length === 0 ||
    !Array.isArray(candidate.exemptions)
  ) {
    throw new Error(`${where}: expected { manifest, documents[≥1], exemptions }`);
  }
  const paths = new Set<string>();
  for (const doc of candidate.documents) {
    if (!isNonBlank(doc?.path) || !isNonBlank(doc?.because)) {
      throw new Error(`${where}: every document needs a path and a non-empty because`);
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
    if (typeof entry.command !== "string" || !/^bun run [A-Za-z0-9:_-]+$/.test(entry.command)) {
      throw new Error(
        `${where}: exemption command ${String(entry.command)} is not of the form \`bun run <name>\``,
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

if (import.meta.main) {
  const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  const config = validateConfig(await Bun.file(join(root, CONFIG_PATH)).json());
  const input = await loadDocCommandsInput(root, config);
  const { report } = evaluateDocCommands(input.manifest, input.documents, config);
  // The counters are printed on a failure too, so the failing run shows its own sums.
  if (report.outcome === "violations" && report.volumeSummary !== null) {
    console.error(`Doc commands: ${report.volumeSummary}`);
  }
  concludeGate("Doc commands", report);
}
