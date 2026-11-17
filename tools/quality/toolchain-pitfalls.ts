/**
 * Reader of the toolchain pitfall catalogue (`docs/toolchain/PITFALLS.md`).
 *
 * The catalogue promises two things a reviewer cannot hold by eye: every
 * remedy cites a test that exists, and the document names no repository of
 * the fleet, no host and no machine-local path. This module turns both into
 * something a test can run.
 *
 * The readers are pure functions over text and fail closed: a document that
 * cannot be read, carries no table or carries a table without a row yields a
 * violation, never an empty success. Violations carry the 1-based line they
 * were found at.
 *
 * The text is read raw, with no Markdown semantics: every line that starts
 * with a vertical bar is a table line, fenced or not. A reader that imitates
 * a renderer disagrees with it somewhere, so the catalogue never quotes a
 * table as an example. Where a renderer would show a table line that this
 * reader does not read as a row, the line is refused as out of form: any
 * non-empty line that follows a table before a blank line, an indented line
 * that starts with a bar, and a delimiter row without outer bars.
 *
 * Not wired into `bun run check`: the module's test runs it on the real
 * document under `bun test`, and the command below prints the same verdict.
 *
 *   bun tools/quality/toolchain-pitfalls.ts [document]
 */

export interface Pitfall {
  /** Text of the nearest heading above the table. */
  readonly family: string;
  readonly symptom: string;
  readonly cause: string;
  /** Prose of the remedy cell, without its witness. */
  readonly remedy: string;
  /** The one test path the remedy cell cites in a code span. */
  readonly testPath: string;
  readonly line: number;
}

export interface PitfallCheck {
  /** Rows read as well-formed entries; every other row is a violation. */
  readonly entries: number;
  readonly violations: string[];
}

/** Volume of a reading: `entries + rejected === rows`. */
export interface PitfallCounts {
  readonly tables: number;
  /** Lines a renderer shows as table rows, header and delimiter excluded. */
  readonly rows: number;
  readonly entries: number;
  /** Rows not read as an entry, each named by a violation. */
  readonly rejected: number;
}

interface Reading {
  readonly entries: Pitfall[];
  readonly violations: string[];
  tables: number;
  rows: number;
  rejected: number;
}

const DEFAULT_DOCUMENT = "docs/toolchain/PITFALLS.md";
const REPOSITORY_INDEX = "ecosystem/repositories.v1.yaml";

const TABLE_HEADER = "| Symptôme | Cause | Parade |";
const TABLE_RULE = /^\|(?: :?-{3,}:? \|){3}$/;
const COLUMNS = ["Symptôme", "Cause", "Parade"] as const;
const FAMILIES = ["shell", "osv-scanner", "bun"] as const;
const HEADING = /^#{1,6}\s+(.+?)\s*$/;
const CODE_SPAN = /`([^`]+)`/g;
// A delimiter row a renderer accepts without outer bars: `--- | ---`.
const BARE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/;

// What a test file is called in this repository: `x.test.ts`, `x.spec.ts`,
// `x_test.ext`, `test_x.py`. A remedy that cites a source file (a manifest, a
// configuration) in a code span is not citing its witness.
const TEST_PATH =
  /^(?:[\w.-]+\/)*(?:test_[\w.-]+\.py|[\w.-]+\.(?:test|spec)\.[a-z]+|[\w.-]+_test\.[a-z]+)$/;
const WITNESS_LABEL = /\s*Témoin\s*:\s*$/;

// Host forms. The domain form is open: any dotted name whose last label is
// alphabetic is a host, unless that label is the extension of a file tracked
// in this repository (`.md`, `.py`, `.sh` and `.rs` are delegated top-level
// domains too, and the catalogue has to cite such files). The cost is that a
// host under such a suffix passes, and that a dotted identifier in prose
// (`Bun.YAML.parse`) is refused: write it in a form the reader accepts.
// IPv6 literals are not detected.
const URL_SCHEME = /[a-z][a-z0-9+.-]*:\/\//i;
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/;
const DOMAIN =
  /(?<![\w.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z][a-z0-9-]*[a-z0-9])(?![\w-])/gi;
const LOCALHOST = /(?<![\w.-])localhost(?![\w-])/i;
const HOST_PORT = /(?<![\w.-])[a-z][\w.-]*:\d{1,5}(?!\d)/i;
const LOCAL_PATH = /\/(?:Users|home)\/[A-Za-z0-9._-]+/;

/** Lower-cased extensions of the tracked files, the suffixes a domain may not end with. */
function trackedExtensions(tracked: ReadonlySet<string>): Set<string> {
  const extensions = new Set<string>();
  for (const path of tracked) {
    const base = path.slice(path.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    if (dot !== -1) extensions.add(base.slice(dot + 1).toLowerCase());
  }
  return extensions;
}

function carriesHost(line: string, extensions: ReadonlySet<string>): boolean {
  if (URL_SCHEME.test(line) || IPV4.test(line) || LOCALHOST.test(line)) return true;
  if (HOST_PORT.test(line)) return true;
  return [...line.matchAll(DOMAIN)].some(
    (match) => !extensions.has((match[1] ?? "").toLowerCase()),
  );
}

// Built from code points: a NUL or a replacement character written in this
// file would make the file itself unreadable to the tools that scan it.
const NUL = String.fromCharCode(0);
const REPLACEMENT = String.fromCharCode(0xfffd);

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Cells of a table line, or null when the line is not closed by a bar. */
function splitCells(line: string): string[] | null {
  const trimmed = line.trimEnd();
  if (trimmed.length < 2 || !trimmed.endsWith("|") || trimmed.endsWith("\\|")) return null;
  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replaceAll("\\|", "|").trim());
}

function readRow(line: string, at: number, family: string, into: Reading): void {
  const cells = splitCells(line);
  if (cells === null) {
    into.violations.push(`line ${at}: table row is not closed by a vertical bar`);
    return;
  }
  if (cells.length !== COLUMNS.length) {
    into.violations.push(
      `line ${at}: row has ${cells.length} column(s), expected ${COLUMNS.length}`,
    );
    return;
  }
  const [symptom = "", cause = "", remedyCell = ""] = cells;
  const empty = COLUMNS.filter((_, index) => cells[index] === "");
  if (empty.length > 0) {
    into.violations.push(`line ${at}: empty cell(s): ${empty.join(", ")}`);
    return;
  }
  const witnesses = [...remedyCell.matchAll(CODE_SPAN)].filter((span) =>
    TEST_PATH.test(span[1] ?? ""),
  );
  const witness = witnesses[0];
  if (witness === undefined) {
    into.violations.push(`line ${at}: the Parade cell cites no test path in a code span`);
    return;
  }
  if (witnesses.length > 1) {
    into.violations.push(
      `line ${at}: the Parade cell cites ${witnesses.length} test paths, expected exactly one`,
    );
    return;
  }
  const remedy = remedyCell.slice(0, witness.index).replace(WITNESS_LABEL, "").trim();
  if (remedy === "") {
    into.violations.push(`line ${at}: the Parade cell has no remedy before its test path`);
    return;
  }
  into.entries.push({ family, symptom, cause, remedy, testPath: witness[1] ?? "", line: at });
}

const outOfForm = (at: number): string => `line ${at}: table line out of form`;

/** Why a table cannot be read, or null when its rows can be. */
function refuseTable(
  lines: string[],
  start: number,
  end: number,
  family: string | null,
): string | null {
  const at = start + 1;
  if ((lines[start] ?? "").trimEnd() !== TABLE_HEADER) {
    return `line ${at}: table header is not exactly '${TABLE_HEADER}'`;
  }
  if (!TABLE_RULE.test((lines[start + 1] ?? "").trimEnd())) {
    return `line ${at + 1}: table has no three-column rule under its header`;
  }
  if (family === null) return `line ${at}: table has no family heading above it`;
  if (!(FAMILIES as readonly string[]).includes(family)) {
    return `line ${at}: family '${family}' is not one of ${FAMILIES.join(", ")}`;
  }
  if (end - start === 2) return `line ${at}: table has no row`;
  return null;
}

function read(text: string): Reading {
  const reading: Reading = { entries: [], violations: [], tables: 0, rows: 0, rejected: 0 };
  if (text.includes(NUL) || text.includes(REPLACEMENT)) {
    reading.violations.push("document: unreadable (NUL or undecodable byte)");
    return reading;
  }
  const lines = text.split(/\r?\n/);
  let family: string | null = null;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.startsWith("|")) {
      if (line.trimStart().startsWith("|") || BARE_RULE.test(line)) {
        reading.violations.push(outOfForm(index + 1));
      }
      const heading = HEADING.exec(line);
      if (heading?.[1] !== undefined) family = heading[1];
      index += 1;
      continue;
    }
    // A renderer keeps a table open until a blank line, bar or no bar.
    const start = index;
    while (index < lines.length && (lines[index] ?? "").trim() !== "") index += 1;
    reading.tables += 1;
    const refusal = refuseTable(lines, start, index, family);
    if (refusal !== null) reading.violations.push(refusal);
    for (let row = start + 2; row < index; row += 1) {
      const text = lines[row] ?? "";
      reading.rows += 1;
      if (!text.startsWith("|")) {
        reading.violations.push(outOfForm(row + 1));
        reading.rejected += 1;
      } else if (refusal !== null || family === null) {
        reading.rejected += 1;
      } else {
        const before = reading.entries.length;
        readRow(text, row + 1, family, reading);
        if (reading.entries.length === before) reading.rejected += 1;
      }
    }
  }
  if (reading.tables === 0) reading.violations.push("document: no pitfall table");
  return reading;
}

/** Tables, rows, entries and rejected rows of the catalogue. */
export function countPitfalls(text: string): PitfallCounts {
  const { tables, rows, entries, rejected } = read(text);
  return { tables, rows, entries: entries.length, rejected };
}

/** The well-formed entries of the catalogue, in document order. */
export function parsePitfalls(text: string): Pitfall[] {
  return read(text).entries;
}

const NAME_CHARACTER = /[A-Za-z0-9_-]/;

/**
 * The line with, inside each code span, the tracked path or the longest
 * tracked directory the span starts with blanked out. A repository of the
 * index is called like a directory of this repository (`.github`, `tools`),
 * and the catalogue has to cite paths under it; a name anywhere else still
 * counts, next to a slash or a dot or not.
 */
function maskTrackedPaths(
  line: string,
  tracked: ReadonlySet<string>,
  directories: ReadonlySet<string>,
): string {
  return line.replace(CODE_SPAN, (span, content: string) => {
    if (tracked.has(content) || directories.has(content)) return " ".repeat(span.length);
    let prefix = 0;
    for (let slash = content.indexOf("/"); slash !== -1; slash = content.indexOf("/", slash + 1)) {
      if (directories.has(content.slice(0, slash))) prefix = slash + 1;
    }
    return `\`${" ".repeat(prefix)}${content.slice(prefix)}\``;
  });
}

function directoriesOf(tracked: ReadonlySet<string>): Set<string> {
  const directories = new Set<string>();
  for (const path of tracked) {
    for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
      directories.add(path.slice(0, slash));
    }
  }
  return directories;
}

/** Whether a line names a repository, as a whole word: a slash or a dot does not join it. */
function citesName(line: string, name: string): boolean {
  const haystack = line.toLowerCase();
  const needle = name.toLowerCase();
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    const previous = haystack[from - 1];
    const next = haystack[from + needle.length];
    const open = previous === undefined || !NAME_CHARACTER.test(previous);
    const closed = next === undefined || !NAME_CHARACTER.test(next);
    if (open && closed) return true;
    from = haystack.indexOf(needle, from + 1);
  }
  return false;
}

/**
 * Entries and violations of the catalogue against the tracked tree and the
 * repository names. An empty tracked set or an empty name list is a
 * violation: a comparison against nothing would hold for any document.
 */
export function checkPitfalls(
  text: string,
  tracked: ReadonlySet<string>,
  repositoryNames: readonly string[],
): PitfallCheck {
  const { entries, violations: structure } = read(text);
  const violations = [...structure];
  if (tracked.size === 0) violations.push("document: the set of tracked paths is empty");
  if (repositoryNames.length === 0) violations.push("document: no repository name to refuse");
  for (const entry of entries) {
    if (!tracked.has(entry.testPath)) {
      violations.push(`line ${entry.line}: test path ${entry.testPath} is not tracked by git`);
    }
  }
  const extensions = trackedExtensions(tracked);
  const directories = directoriesOf(tracked);
  text.split(/\r?\n/).forEach((line, index) => {
    const at = index + 1;
    const masked = maskTrackedPaths(line, tracked, directories);
    for (const name of repositoryNames) {
      if (citesName(masked, name)) violations.push(`line ${at}: names the repository ${name}`);
    }
    if (carriesHost(line, extensions)) {
      violations.push(`line ${at}: carries a host name, an address or a URL`);
    }
    if (LOCAL_PATH.test(line)) violations.push(`line ${at}: carries a machine-local path`);
  });
  return { entries: entries.length, violations };
}

/**
 * Repository names of the fleet index, each as `owner/name` and as `name`.
 * Throws on an index that does not carry the expected shape: an unreadable
 * source of names must not read as "no name to refuse".
 */
export function readRepositoryNames(indexText: string): string[] {
  // Bun.YAML.parse stops silently at a NUL: what follows would not be read.
  if (indexText.includes(NUL)) throw new Error("repository index carries a NUL");
  const root: unknown = Bun.YAML.parse(indexText);
  const list =
    typeof root === "object" && root !== null && "repositories" in root
      ? root.repositories
      : undefined;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("repository index has no non-empty 'repositories' list");
  }
  const names = new Set<string>();
  list.forEach((entry: unknown, index) => {
    const repository =
      typeof entry === "object" && entry !== null && "repository" in entry
        ? entry.repository
        : undefined;
    const parts = typeof repository === "string" ? repository.split("/") : [];
    const [owner = "", name = ""] = parts;
    if (typeof repository !== "string" || parts.length !== 2 || owner === "" || name === "") {
      throw new Error(`repository index entry ${index + 1} has no 'owner/name' repository`);
    }
    names.add(repository);
    names.add(name);
  });
  return [...names];
}

/** `checkPitfalls` on a file; a file that cannot be read is a violation. */
export async function checkPitfallsFile(
  path: string,
  tracked: ReadonlySet<string>,
  repositoryNames: readonly string[],
): Promise<PitfallCheck> {
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (error) {
    return { entries: 0, violations: [`${path}: unreadable: ${message(error)}`] };
  }
  return checkPitfalls(text, tracked, repositoryNames);
}

if (import.meta.main) {
  const document = process.argv[2] ?? DEFAULT_DOCUMENT;
  const sources: string[] = [];

  const listing = Bun.spawnSync(["git", "ls-files"], { stdout: "pipe", stderr: "pipe" });
  const tracked = new Set(
    listing.exitCode === 0 ? listing.stdout.toString().split("\n").filter(Boolean) : [],
  );
  if (listing.exitCode !== 0) sources.push(`git ls-files: exit ${listing.exitCode}`);

  let names: string[] = [];
  try {
    names = readRepositoryNames(await Bun.file(REPOSITORY_INDEX).text());
  } catch (error) {
    sources.push(`${REPOSITORY_INDEX}: unreadable: ${message(error)}`);
  }

  let text: string | null = null;
  try {
    text = await Bun.file(document).text();
  } catch (error) {
    sources.push(`${document}: unreadable: ${message(error)}`);
  }
  const result: PitfallCheck =
    text === null ? { entries: 0, violations: [] } : checkPitfalls(text, tracked, names);
  const counts: PitfallCounts =
    text === null ? { tables: 0, rows: 0, entries: 0, rejected: 0 } : countPitfalls(text);
  const violations = [...sources, ...result.violations];
  const volume =
    `${result.entries} entr(ies) examined in ${document} against ${tracked.size} tracked ` +
    `path(s) and ${names.length} repository name(s), ${violations.length} violation(s) ` +
    `(tables=${counts.tables} rows=${counts.rows} entries=${counts.entries} rejected=${counts.rejected})`;
  if (violations.length > 0) {
    for (const violation of violations) console.error(`Toolchain pitfalls: ${violation}`);
    console.error(`Toolchain pitfalls failed: ${volume}`);
    process.exit(1);
  }
  console.log(`Toolchain pitfalls verified: ${volume}`);
}
