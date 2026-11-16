/**
 * Federated decision-series gate.
 *
 * An index file declares series of ADRs, one per level-two heading of the form
 * `## <group>/<repository> — <title> (<directory>)`, each followed by a table
 * whose rows are `| <number> | <title> | [<file>](<directory>/<file>) |`.
 * Every ADR file of every declared series (`NNNN-<slug>.md` directly under the
 * series directory) must have its row in the table of its own series.
 *
 * WHY THE CHECKOUT AND NOT A BRANCH. The series are read from the directories
 * given on the command line — in CI, the checkout of the pull request. An
 * earlier template read the default branch, which held no ADR directory yet:
 * the gate then judged a tree the change was not part of. This gate resolves no
 * git ref at all; whoever runs it decides which tree it reads.
 *
 * WHY AN UNREADABLE SERIES IS RED. A declared repository with no checkout, a
 * declared directory that is absent, outside its repository, or a heading that
 * looks like a declaration and does not parse are all failures, never a skip:
 * "nothing to read" and "could not read" must not leave the same trace.
 *
 * Links are relative to the repository carrying the series, without a host:
 * a row whose link has a scheme, an absolute path, a `.`/`..` segment, or does
 * not point at `<directory>/<file>` indexes nothing and is reported malformed.
 * A trailing HTML comment on a row (an exemption marker read by another gate)
 * is ignored here.
 *
 * Every entry of a readable series directory is accounted for. An entry named
 * `NNNN-<slug>.md` is an ADR and is examined. A file that looks like an ADR
 * under another name (`ADR-0002-x.md`, `003-x.md`, `0004_x.md`, `0006-x.MD`,
 * `00007-x.md`) is misnamed and red: otherwise a wrong name would take a
 * decision out of the gate with a green verdict. Anything else (a README, a
 * subdirectory) is skipped, counted and named.
 *
 * A checkout supplied on the command line that no declared series consumes is
 * red: a typo in the caller's repository name must not leave a tree unread
 * without a trace.
 *
 * Counters printed on every run, and they sum:
 *   series:    declared = readable + unreadable
 *   adr:       examined = indexed + missing
 *   entries:   listed   = examined + misnamed + skipped
 *   rows:      read     = matched + stale + malformed + unjudged
 *   checkouts: supplied = used + unused
 * Rows of an unreadable series are unjudged: there is no tree to judge them by.
 * A run that declares no series, or examines no ADR, is red.
 *
 * Usage:
 *   bun ecosystem/check-decision-series.ts --index <file> [--repo <group>/<name>=<checkout>]...
 * Exit codes: 0 pass, 1 violation or unreadable source, 2 usage.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const EXIT_PASS = 0;
const EXIT_VIOLATION = 1;
const EXIT_USAGE = 2;

const NAME_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const SERIES_HEADING = /^## (\S+) (?:—|-) (.+) \(([^()]+)\)\s*$/;
const ADR_FILE = /^(\d{4})-[^/\\]+\.md$/;
/** An optional `ADR` prefix, a run of digits, a separator, a `.md` in any case. */
const ADR_LOOKALIKE = /^(?:adr[-_]?)?\d+[-_].*\.md$/i;
const ROW_NUMBER = /^\d{4}$/;
const ROW_LINK = /^\[([^\]]+)\]\(([^()\s]+)\)$/;
const TABLE_SEPARATOR = /^\|(\s*:?-+:?\s*\|)+$/;
const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

interface SeriesDeclaration {
  readonly heading: string;
  readonly repository: string | null;
  readonly directory: string | null;
  readonly rows: readonly string[];
}

interface Counters {
  declared: number;
  readable: number;
  unreadable: number;
  examined: number;
  indexed: number;
  missing: number;
  listed: number;
  misnamed: number;
  skipped: number;
  rowsRead: number;
  matched: number;
  stale: number;
  malformed: number;
  unjudged: number;
  supplied: number;
  used: number;
  unused: number;
}

interface SeriesListing {
  readonly files: readonly string[];
  readonly misnamed: readonly string[];
  /** Skipped entries; a directory carries a trailing `/`. */
  readonly skipped: readonly string[];
}

class UsageError extends Error {}

function isRepositoryName(value: string): boolean {
  const parts = value.split("/");
  return (
    parts.length === 2 &&
    parts.every((part) => NAME_SEGMENT.test(part) && part !== "." && part !== "..")
  );
}

/** A relative path made only of plain segments: no root, no `.`/`..`, no backslash. */
function isPlainRelativePath(value: string): boolean {
  if (value === "" || value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  if (URI_SCHEME.test(value)) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function parseArguments(argv: readonly string[]): {
  readonly index: string;
  readonly checkouts: ReadonlyMap<string, string>;
} {
  let index: string | null = null;
  const checkouts = new Map<string, string>();
  for (let position = 0; position < argv.length; position += 2) {
    const flag = argv[position];
    const value = argv[position + 1];
    if (value === undefined) throw new UsageError(`missing value after ${flag}`);
    if (flag === "--index") {
      if (index !== null) throw new UsageError("--index given twice");
      index = value;
    } else if (flag === "--repo") {
      const separator = value.indexOf("=");
      const name = separator === -1 ? "" : value.slice(0, separator);
      const path = separator === -1 ? "" : value.slice(separator + 1);
      if (!isRepositoryName(name) || path === "") {
        throw new UsageError(`--repo expects <group>/<name>=<checkout>, got: ${value}`);
      }
      if (checkouts.has(name)) throw new UsageError(`--repo ${name} given twice`);
      checkouts.set(name, path);
    } else {
      throw new UsageError(`unknown argument: ${flag}`);
    }
  }
  if (index === null) throw new UsageError("--index <file> is required");
  return { index, checkouts };
}

/**
 * The line without a trailing `<!-- … -->`, cut at the first opener. A string
 * search and not a regular expression: an unanchored `\s*<!--.*-->\s*$`
 * backtracks quadratically on a long run of spaces, and the index is content a
 * pull request controls.
 */
function withoutTrailingComment(line: string): string {
  const opener = line.indexOf(COMMENT_OPEN);
  const closes = line.length >= opener + COMMENT_OPEN.length + COMMENT_CLOSE.length;
  if (opener === -1 || !closes || !line.endsWith(COMMENT_CLOSE)) return line;
  return line.slice(0, opener);
}

function parseIndex(text: string): readonly SeriesDeclaration[] {
  const declarations: SeriesDeclaration[] = [];
  let current: { heading: string; repository: string | null; directory: string | null } | null =
    null;
  let rows: string[] = [];
  const close = () => {
    if (current !== null) declarations.push({ ...current, rows });
    current = null;
    rows = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("## ") || line.startsWith("# ")) {
      close();
      if (!line.startsWith("## ")) continue;
      const firstToken = line.slice(3).split(" ")[0] ?? "";
      const match = SERIES_HEADING.exec(line);
      if (match !== null && isRepositoryName(match[1] ?? "")) {
        current = { heading: line, repository: match[1] ?? null, directory: match[3] ?? null };
      } else if (match !== null || firstToken.includes("/")) {
        // Has the full shape of a declaration, or a group/name first word, yet
        // does not parse (a forgotten group, a missing directory): a typo must
        // not make a series vanish, so it is kept as a declared, unreadable series.
        current = { heading: line, repository: null, directory: null };
      }
      continue;
    }
    if (current === null) continue;
    const cells = withoutTrailingComment(line).trim();
    if (!cells.startsWith("|")) continue;
    if (TABLE_SEPARATOR.test(cells)) {
      rows.pop(); // the header row precedes its separator
      continue;
    }
    rows.push(cells);
  }
  close();
  return declarations;
}

/** The series directory, resolved and proven to stay inside its checkout; null when unreadable. */
function listSeries(
  checkout: string,
  directory: string,
): SeriesListing | { readonly error: string } {
  if (!isPlainRelativePath(directory)) {
    return { error: `directory "${directory}" is not a plain path relative to its repository` };
  }
  let root: string;
  let resolved: string;
  try {
    root = realpathSync(checkout);
    resolved = realpathSync(join(root, directory));
  } catch (error) {
    return { error: `cannot resolve "${directory}": ${describe(error)}` };
  }
  if (!resolved.startsWith(`${root}${sep}`)) {
    return { error: `directory "${directory}" resolves outside its repository` };
  }
  try {
    if (!statSync(resolved).isDirectory()) return { error: `"${directory}" is not a directory` };
    const files: string[] = [];
    const misnamed: string[] = [];
    const skipped: string[] = [];
    for (const entry of readdirSync(resolved, { withFileTypes: true })) {
      if (entry.isDirectory()) skipped.push(`${entry.name}/`);
      else if (ADR_FILE.test(entry.name)) files.push(entry.name);
      else if (ADR_LOOKALIKE.test(entry.name)) misnamed.push(entry.name);
      else skipped.push(entry.name);
    }
    return { files: files.sort(), misnamed: misnamed.sort(), skipped: skipped.sort() };
  } catch (error) {
    return { error: `cannot list "${directory}": ${describe(error)}` };
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ?? error.message;
  }
  return String(error);
}

type RowVerdict =
  | { readonly kind: "malformed"; readonly reason: string }
  | { readonly kind: "row"; readonly file: string };

function readRow(row: string, directory: string): RowVerdict {
  const cells = row
    .slice(1, row.endsWith("|") ? -1 : undefined)
    .split("|")
    .map((cell) => cell.trim());
  if (cells.length !== 3) return { kind: "malformed", reason: "expected 3 cells" };
  const [number, title, link] = cells as [string, string, string];
  if (!ROW_NUMBER.test(number)) return { kind: "malformed", reason: "number is not NNNN" };
  if (title === "") return { kind: "malformed", reason: "empty title" };
  const match = ROW_LINK.exec(link);
  if (match === null) return { kind: "malformed", reason: "file cell is not a [name](link)" };
  const target = match[2] ?? "";
  if (!isPlainRelativePath(target)) {
    return { kind: "malformed", reason: `link "${target}" is not relative to its repository` };
  }
  const file = target.slice(directory.length + 1);
  if (!target.startsWith(`${directory}/`) || file.includes("/") || !ADR_FILE.test(file)) {
    return { kind: "malformed", reason: `link "${target}" is not ${directory}/NNNN-<slug>.md` };
  }
  if (!file.startsWith(`${number}-`)) {
    return { kind: "malformed", reason: `number ${number} disagrees with ${file}` };
  }
  return { kind: "row", file };
}

function check(
  declarations: readonly SeriesDeclaration[],
  checkouts: ReadonlyMap<string, string>,
): {
  readonly counters: Counters;
  readonly violations: readonly string[];
  readonly notes: readonly string[];
} {
  const counters: Counters = {
    declared: declarations.length,
    readable: 0,
    unreadable: 0,
    examined: 0,
    indexed: 0,
    missing: 0,
    listed: 0,
    misnamed: 0,
    skipped: 0,
    rowsRead: 0,
    matched: 0,
    stale: 0,
    malformed: 0,
    unjudged: 0,
    supplied: checkouts.size,
    used: 0,
    unused: 0,
  };
  const violations: string[] = [];
  const notes: string[] = [];
  const consumed = new Set<string>();
  for (const series of declarations) {
    if (series.repository !== null) consumed.add(series.repository);
    const label = series.repository ?? series.heading;
    const checkout = series.repository === null ? undefined : checkouts.get(series.repository);
    let listing: ReturnType<typeof listSeries>;
    if (series.repository === null || series.directory === null) {
      listing = { error: "heading is not <group>/<repository> — <title> (<directory>)" };
    } else if (checkout === undefined) {
      listing = { error: "no checkout supplied for this declared repository" };
    } else {
      listing = listSeries(checkout, series.directory);
    }
    counters.rowsRead += series.rows.length;
    if ("error" in listing) {
      counters.unreadable += 1;
      // Rows of an unreadable series cannot be judged against a tree.
      counters.unjudged += series.rows.length;
      violations.push(`${label}: unreadable series — ${listing.error}`);
      continue;
    }
    counters.readable += 1;
    const directory = series.directory ?? "";
    const present = new Set(listing.files);
    const indexed = new Set<string>();
    for (const row of series.rows) {
      const verdict = readRow(row, directory);
      if (verdict.kind === "malformed") {
        counters.malformed += 1;
        violations.push(`${label}: malformed row (${verdict.reason}): ${row}`);
      } else if (!present.has(verdict.file)) {
        counters.stale += 1;
        violations.push(`${label}: row names ${directory}/${verdict.file}, absent from the series`);
      } else {
        counters.matched += 1;
        indexed.add(verdict.file);
      }
    }
    for (const file of listing.files) {
      counters.examined += 1;
      if (indexed.has(file)) {
        counters.indexed += 1;
      } else {
        counters.missing += 1;
        violations.push(`${label}: ${directory}/${file} has no row in its series table`);
      }
    }
    counters.listed += listing.files.length + listing.misnamed.length + listing.skipped.length;
    for (const file of listing.misnamed) {
      counters.misnamed += 1;
      violations.push(
        `${label}: ${directory}/${file} looks like an ADR but is not named NNNN-<slug>.md`,
      );
    }
    for (const entry of listing.skipped) {
      counters.skipped += 1;
      notes.push(`${label}: skipped ${directory}/${entry}`);
    }
  }
  for (const name of [...checkouts.keys()].sort()) {
    if (consumed.has(name)) {
      counters.used += 1;
    } else {
      counters.unused += 1;
      violations.push(`${name}: checkout supplied but no series declares this repository`);
    }
  }
  if (counters.declared === 0) violations.push("the index declares no series");
  else if (counters.examined === 0) violations.push("no ADR examined in any declared series");
  return { counters, violations, notes };
}

function main(argv: readonly string[]): number {
  let parsed: ReturnType<typeof parseArguments>;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`usage error: ${error.message}`);
      return EXIT_USAGE;
    }
    throw error;
  }
  let text: string;
  try {
    text = readFileSync(parsed.index, "utf8");
  } catch (error) {
    console.error(`cannot read index ${parsed.index}: ${describe(error)}`);
    return EXIT_VIOLATION;
  }
  const { counters, violations, notes } = check(parseIndex(text), parsed.checkouts);
  for (const violation of violations) console.error(`  - ${violation}`);
  for (const note of notes) console.log(`  ~ ${note}`);
  console.log(
    `series: declared=${counters.declared} readable=${counters.readable} unreadable=${counters.unreadable}`,
  );
  console.log(
    `adr: examined=${counters.examined} indexed=${counters.indexed} missing=${counters.missing}`,
  );
  console.log(
    `entries: listed=${counters.listed} examined=${counters.examined} misnamed=${counters.misnamed} skipped=${counters.skipped}`,
  );
  console.log(
    `rows: read=${counters.rowsRead} matched=${counters.matched} stale=${counters.stale} malformed=${counters.malformed} unjudged=${counters.unjudged}`,
  );
  console.log(
    `checkouts: supplied=${counters.supplied} used=${counters.used} unused=${counters.unused}`,
  );
  console.log(`violations=${violations.length}`);
  return violations.length === 0 ? EXIT_PASS : EXIT_VIOLATION;
}

if (import.meta.main) {
  process.exit(main(Bun.argv.slice(2)));
}
