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
 * Every heading of the index (any number of `#`, indented or not, with or
 * without a space after the hashes) ends the table above it. Only an exact
 * `## <group>/<repository> — <title> (<directory>)` declares a readable series;
 * any other heading with the shape of a declaration, or whose first word is a
 * `group/name`, is a declared, unreadable series — red, never dropped.
 *
 * A file has one row. A second row naming the same file is a duplicate and
 * red, counted apart from `matched`, so that `matched` equals `indexed`.
 *
 * Two ADRs of one series sharing a number are red, each one named, unless the
 * exemption list (`--exemptions`, JSON, schema
 * `libre-ai.decision-series-exemptions.v1`; this repository's list is
 * ecosystem/decision-series-exemptions.v1.json) names that file with its
 * reason. Exemptions are per file: a third ADR on an exempted number is red.
 * An exemption that exempts nothing is stale and red; one for an unreadable
 * series is unjudged. An unreadable or malformed list is red, never empty.
 * LIMIT: a gap in the numbering (0001, 0003) is not checked; it belongs to
 * renumbering, outside this gate.
 *
 * Counters printed on every run, and they sum:
 *   series:     declared = readable + unreadable
 *   adr:        examined = indexed + missing
 *   entries:    listed   = examined + misnamed + skipped
 *   numbers:    examined = unique + shared + exempted
 *   exemptions: declared = applied + stale + unjudged
 *   rows:       read     = matched + duplicate + stale + malformed + unjudged
 *   checkouts:  supplied = used + unused
 * Rows of an unreadable series are unjudged: there is no tree to judge them by.
 * A run that declares no series, or examines no ADR, is red.
 *
 * Usage:
 *   bun ecosystem/check-decision-series.ts --index <file> [--exemptions <file>]
 *     [--repo <group>/<name>=<checkout>]...
 * Exit codes: 0 pass, 1 violation or unreadable source, 2 usage.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const EXIT_PASS = 0;
const EXIT_VIOLATION = 1;
const EXIT_USAGE = 2;

const NAME_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const SERIES_HEADING = /^## (\S+) (?:—|-) (.+) \(([^()]+)\)\s*$/;
/** The same shape on a heading's text, whatever its level and spacing. */
const SERIES_SHAPE = /^\S+\s+(?:—|-)\s.*\([^()]+\)$/;
const LEADING_HASHES = /^#+/;
const EXEMPTIONS_SCHEMA = "libre-ai.decision-series-exemptions.v1";
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
  numbersUnique: number;
  numbersShared: number;
  numbersExempted: number;
  exemptionsDeclared: number;
  exemptionsApplied: number;
  exemptionsStale: number;
  exemptionsUnjudged: number;
  rowsRead: number;
  matched: number;
  duplicate: number;
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

/** One ADR file allowed to share its number with another ADR of its series. */
interface Exemption {
  readonly repository: string;
  readonly directory: string;
  readonly file: string;
  readonly because: string;
}

class UsageError extends Error {}

function exemptionKey(repository: string, directory: string, file: string): string {
  return `${repository}\0${directory}\0${file}`;
}

function seriesKey(repository: string, directory: string): string {
  return `${repository}\0${directory}`;
}

/**
 * The exemption list, validated whole: a wrong schema, an unknown key, an
 * entry without its reason or a repeated entry throws, so the gate never runs
 * on half a list.
 */
function parseExemptions(text: string): readonly Exemption[] {
  const document: unknown = JSON.parse(text);
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new Error("not a JSON object");
  }
  const record = document as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (keys !== "exemptions,schema_version") {
    throw new Error(`expected exactly schema_version and exemptions, got: ${keys}`);
  }
  if (record.schema_version !== EXEMPTIONS_SCHEMA) {
    throw new Error(`schema_version must be ${EXEMPTIONS_SCHEMA}`);
  }
  if (!Array.isArray(record.exemptions)) throw new Error("exemptions must be an array");
  const seen = new Set<string>();
  return record.exemptions.map((raw: unknown, position: number): Exemption => {
    const where = `exemptions[${position}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`${where} is not an object`);
    }
    const entry = raw as Record<string, unknown>;
    const entryKeys = Object.keys(entry).sort().join(",");
    if (entryKeys !== "because,directory,file,repository") {
      throw new Error(`${where}: expected repository, directory, file, because; got: ${entryKeys}`);
    }
    const { repository, directory, file, because } = entry;
    if (typeof repository !== "string" || !isRepositoryName(repository)) {
      throw new Error(`${where}: repository is not <group>/<name>`);
    }
    if (typeof directory !== "string" || !isPlainRelativePath(directory)) {
      throw new Error(`${where}: directory is not a plain relative path`);
    }
    if (typeof file !== "string" || !ADR_FILE.test(file)) {
      throw new Error(`${where}: file is not NNNN-<slug>.md`);
    }
    if (typeof because !== "string" || because.trim() === "") {
      throw new Error(`${where}: because is empty`);
    }
    const key = exemptionKey(repository, directory, file);
    if (seen.has(key)) throw new Error(`${where}: ${repository} ${directory}/${file} given twice`);
    seen.add(key);
    return { repository, directory, file, because };
  });
}

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
  readonly exemptions: string | null;
  readonly checkouts: ReadonlyMap<string, string>;
} {
  let index: string | null = null;
  let exemptions: string | null = null;
  const checkouts = new Map<string, string>();
  for (let position = 0; position < argv.length; position += 2) {
    const flag = argv[position];
    const value = argv[position + 1];
    if (value === undefined) throw new UsageError(`missing value after ${flag}`);
    if (flag === "--index") {
      if (index !== null) throw new UsageError("--index given twice");
      index = value;
    } else if (flag === "--exemptions") {
      if (exemptions !== null) throw new UsageError("--exemptions given twice");
      exemptions = value;
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
  return { index, exemptions, checkouts };
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
    const stripped = line.trimStart();
    if (stripped.startsWith("#")) {
      // Every heading, whatever its level, its indentation or the space after
      // its hashes, ends the table above it.
      close();
      const level = stripped.length - stripped.replace(LEADING_HASHES, "").length;
      const headingText = stripped.slice(level).trim();
      const firstToken = headingText.split(/\s/)[0] ?? "";
      const match = SERIES_HEADING.exec(line);
      if (match !== null && isRepositoryName(match[1] ?? "")) {
        current = { heading: line, repository: match[1] ?? null, directory: match[3] ?? null };
      } else if (SERIES_SHAPE.test(headingText) || firstToken.includes("/")) {
        // Has the shape of a declaration, or a group/name first word, yet is
        // not an exact level-two declaration (another level, no space after
        // the hashes, a forgotten group, a missing directory): a typo must not
        // make a series vanish, so it is kept as a declared, unreadable series.
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
  exemptions: readonly Exemption[],
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
    numbersUnique: 0,
    numbersShared: 0,
    numbersExempted: 0,
    exemptionsDeclared: exemptions.length,
    exemptionsApplied: 0,
    exemptionsStale: 0,
    exemptionsUnjudged: 0,
    rowsRead: 0,
    matched: 0,
    duplicate: 0,
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
  const exempted = new Set(
    exemptions.map((entry) => exemptionKey(entry.repository, entry.directory, entry.file)),
  );
  const applied = new Set<string>();
  const unreadableSeries = new Set<string>();
  for (const series of declarations) {
    if (series.repository !== null) consumed.add(series.repository);
    const label = series.repository ?? series.heading;
    const checkout = series.repository === null ? undefined : checkouts.get(series.repository);
    let listing: ReturnType<typeof listSeries>;
    if (series.repository === null || series.directory === null) {
      listing = { error: "heading is not ## <group>/<repository> — <title> (<directory>)" };
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
      if (series.repository !== null && series.directory !== null) {
        unreadableSeries.add(seriesKey(series.repository, series.directory));
      }
      violations.push(`${label}: unreadable series — ${listing.error}`);
      continue;
    }
    counters.readable += 1;
    const repository = series.repository ?? "";
    const directory = series.directory ?? "";
    const present = new Set(listing.files);
    const rowsPerFile = new Map<string, number>();
    for (const row of series.rows) {
      const verdict = readRow(row, directory);
      if (verdict.kind === "malformed") {
        counters.malformed += 1;
        violations.push(`${label}: malformed row (${verdict.reason}): ${row}`);
      } else if (!present.has(verdict.file)) {
        counters.stale += 1;
        violations.push(`${label}: row names ${directory}/${verdict.file}, absent from the series`);
      } else if (rowsPerFile.has(verdict.file)) {
        // A second row for the same file indexes nothing more: counted apart,
        // so that `matched` is exactly the number of files indexed.
        counters.duplicate += 1;
        rowsPerFile.set(verdict.file, (rowsPerFile.get(verdict.file) ?? 0) + 1);
      } else {
        counters.matched += 1;
        rowsPerFile.set(verdict.file, 1);
      }
    }
    for (const [file, count] of rowsPerFile) {
      if (count > 1) violations.push(`${label}: ${directory}/${file} has ${count} rows`);
    }
    const indexed = new Set(rowsPerFile.keys());
    const filesPerNumber = new Map<string, number>();
    for (const file of listing.files) {
      const number = file.slice(0, 4);
      filesPerNumber.set(number, (filesPerNumber.get(number) ?? 0) + 1);
    }
    for (const file of listing.files) {
      const number = file.slice(0, 4);
      const key = exemptionKey(repository, directory, file);
      if ((filesPerNumber.get(number) ?? 0) === 1) {
        counters.numbersUnique += 1;
      } else if (exempted.has(key)) {
        counters.numbersExempted += 1;
        applied.add(key);
      } else {
        counters.numbersShared += 1;
        violations.push(`${label}: ${directory}/${file} shares number ${number} with another ADR`);
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
  for (const entry of exemptions) {
    const where = `${entry.repository} ${entry.directory}/${entry.file}`;
    if (applied.has(exemptionKey(entry.repository, entry.directory, entry.file))) {
      counters.exemptionsApplied += 1;
    } else if (unreadableSeries.has(seriesKey(entry.repository, entry.directory))) {
      // No tree to judge it by; the unreadable series is already red.
      counters.exemptionsUnjudged += 1;
    } else {
      // Exempts nothing: the file is gone, no longer shares its number, or
      // names no declared series. A standing excuse waiting for another file.
      counters.exemptionsStale += 1;
      violations.push(`exemption ${where} is stale: it exempts no shared number`);
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
  let exemptions: readonly Exemption[] = [];
  if (parsed.exemptions !== null) {
    try {
      exemptions = parseExemptions(readFileSync(parsed.exemptions, "utf8"));
    } catch (error) {
      console.error(`cannot read exemptions ${parsed.exemptions}: ${describe(error)}`);
      return EXIT_VIOLATION;
    }
  }
  const { counters, violations, notes } = check(parseIndex(text), parsed.checkouts, exemptions);
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
    `numbers: examined=${counters.examined} unique=${counters.numbersUnique} shared=${counters.numbersShared} exempted=${counters.numbersExempted}`,
  );
  console.log(
    `exemptions: declared=${counters.exemptionsDeclared} applied=${counters.exemptionsApplied} stale=${counters.exemptionsStale} unjudged=${counters.exemptionsUnjudged}`,
  );
  console.log(
    `rows: read=${counters.rowsRead} matched=${counters.matched} duplicate=${counters.duplicate} stale=${counters.stale} malformed=${counters.malformed} unjudged=${counters.unjudged}`,
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
