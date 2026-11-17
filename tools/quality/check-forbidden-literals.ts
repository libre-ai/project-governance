/**
 * Four literals that had no owner: a gate refuses them in tracked source.
 *
 * Two neighbouring families already have one and are deliberately NOT read
 * here: machine-local paths belong to `check-context-hygiene.sh`, and a default
 * branch written into a request belongs to `check-resolved-refs.ts`, whose
 * narrow scope was settled by measurement. Reading them a second time would be
 * two answers to one question, with two exemption markers to keep in step.
 *
 * WHAT IT REFUSES, one finding per line and per family:
 *
 *   - a download handed straight to an interpreter: the bytes that run are
 *     whatever the remote serves at that second, and no review ever read them;
 *   - a permission opened to every account of the machine;
 *   - an IPv4 address written where a connection is made. Loopback, the
 *     unspecified and broadcast addresses and the three documentation ranges
 *     are not addresses of anything, so they are not counted;
 *   - a workflow step whose failure is tolerated without saying why on the
 *     line. A comment ten lines above drifts away from the step it explains.
 *
 * WHAT IT DOES NOT READ, each class counted so the total is accounted for:
 * prose (it describes these forms in order to forbid them), lockfiles, tests
 * and fixtures (their object is the pattern itself), binary files. A line that
 * is only a comment is skipped for the same reason as prose.
 *
 * THE EXCEPTION: a line may carry the marker below followed by a reason. A bare
 * marker exempts nothing — an exception without a reason is a silent allowance.
 * The marker is distinct from the ones of the two neighbouring gates, so an
 * exemption granted by one is never an exemption from another.
 *
 * The marker counts only inside the trailing comment of the line (in the
 * file's comment syntax, outside a string), after the literal it exempts.
 *
 * WHAT IT DOES NOT FOLLOW: a symbolic link or a submodule entry is counted in a
 * class of its own and never opened; its target is not this repository's text.
 *
 * KNOWN LIMITS, not read by this gate: an interpreter fed by process or command
 * substitution (`<interp> <(<download>)`, `<interp> -c "$(<download>)"`); a
 * download written to a file and run by a later command; a relay split across
 * lines other than by a trailing backslash. Strings are told from code by
 * counting quote characters, not by parsing the language.
 *
 * The forms are assembled from fragments rather than quoted: this gate reads
 * its own file, and a gate that must exempt itself to pass has a blind spot
 * shaped like itself.
 */

import { closeSync, constants, lstatSync, openSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { extname, join } from "node:path";

import { isPatternSubject } from "./check-resolved-refs";
import { GITLINK_MODE, SYMLINK_MODE } from "./git-diff";

export const FORBIDDEN_LITERAL_MARKER = "allow-forbidden-literal:";

export type LiteralFamily =
  | "download-to-interpreter"
  | "world-writable-permission"
  | "network-ipv4-literal"
  | "unjustified-failure-tolerance";

export interface LiteralFinding {
  file: string;
  line: number;
  family: LiteralFamily;
  text: string;
}

export interface LiteralScan {
  /** Every file handed in. It equals examined plus the five exclusion counters. */
  tracked: number;
  examined: number;
  excludedProse: number;
  excludedLockfile: number;
  excludedPatternSubject: number;
  excludedBinary: number;
  /** Symbolic links and submodule entries: their content is not this repository's, never read. */
  excludedLink: number;
  findings: readonly LiteralFinding[];
  /** Lines that matched but carried a reasoned allowance — counted, never hidden. */
  allowed: readonly LiteralFinding[];
}

export interface ScannedFile {
  path: string;
  /** null: a binary file. */
  text: string | null;
  /** A symbolic link or a submodule entry: counted, never read. */
  link?: boolean;
}

const DOWNLOADERS = ["curl", "wget"] as const;
// A versioned name (`python3.12`) is the same interpreter.
const INTERPRETER = /^(?:sh|bash|zsh|dash|ksh|python[\d.]*|node|bun|perl|ruby)$/;

// A path prefix (`/usr/bin/…`) still names the downloader.
const DOWNLOADER = new RegExp(String.raw`(?<![\w.-])(?:${DOWNLOADERS.join("|")})(?![\w-])`, "g");
// The pipeline ends at a list operator: what follows `||`, `&&`, `;` or a
// background `&` does not read the download's output.
const PIPELINE_END = /\|\||&&|;|(?<![|>])&(?![>&])/;
// `|&` pipes stderr too: still a relay.
const PIPE = /\|&?/;
// Prefixes that run the next word as the command.
const SUDO = "sudo";
const ENV = "env";
const PASS_THROUGH = new Set(["exec", "command", "nohup", "time"]);
// sudo options that consume the following word (`-u root`).
const SUDO_OPTIONS_WITH_ARGUMENT = new Set([
  "-u",
  "-g",
  "-U",
  "-C",
  "-D",
  "-h",
  "-p",
  "-r",
  "-t",
  "-T",
  "-R",
]);
const ENV_OPTIONS_WITH_ARGUMENT = new Set(["-u", "-C", "-S"]);
const ASSIGNMENT = /^\w+=/;

function basename(word: string): string {
  return word.slice(word.lastIndexOf("/") + 1);
}

/** Whether the command a pipeline stage runs, past its wrappers, is an interpreter. */
function runsInterpreter(stage: string): boolean {
  const words = stage
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  let at = 0;
  while (at < words.length) {
    const command = basename(words[at] ?? "");
    if (ASSIGNMENT.test(command)) {
      at += 1;
      continue;
    }
    const wrapper =
      command === SUDO
        ? SUDO_OPTIONS_WITH_ARGUMENT
        : command === ENV
          ? ENV_OPTIONS_WITH_ARGUMENT
          : PASS_THROUGH.has(command)
            ? new Set<string>()
            : null;
    if (wrapper === null) return INTERPRETER.test(command);
    at += 1;
    while (at < words.length) {
      const word = words[at] ?? "";
      if (word.startsWith("-")) at += wrapper.has(word) ? 2 : 1;
      else if (command === ENV && ASSIGNMENT.test(word)) at += 1;
      else break;
    }
  }
  return false;
}

function relaysDownload(line: string): boolean {
  for (const match of line.matchAll(DOWNLOADER)) {
    const pipeline = line.slice(match.index).split(PIPELINE_END)[0] ?? "";
    if (pipeline.split(PIPE).slice(1).some(runsInterpreter)) return true;
  }
  return false;
}

const PERMISSION_COMMAND = ["ch", "mod"].join("");
// The mode argument of the command (`<cmd> [-R] MODE`) and of a call (`<cmd>Sync(p, MODE)`).
const COMMAND_MODE = new RegExp(
  String.raw`(?<![\w-])${PERMISSION_COMMAND}\s+(?:-\S+\s+)*([^\s;|&)]+)`,
  "g",
);
const CALL_MODE = new RegExp(
  String.raw`${PERMISSION_COMMAND}(?:Sync)?\s*\([^,()]*,\s*([^\s,)]+)`,
  "g",
);
const OCTAL_MODE = /^(?:0o|0)?([0-7]{3,4})$/;
const SYMBOLIC_CLAUSE = /^([ugoa]*)([+=])([rwxXst]*)$/;
const WRITE_BIT_FOR_OTHERS = 2;

/** A mode is open when it grants write to others, in octal or in a symbolic clause. */
function grantsWriteToOthers(raw: string): boolean {
  const mode = raw.replace(/^["']|["']$/g, "");
  const octal = OCTAL_MODE.exec(mode)?.[1];
  if (octal !== undefined) return (Number(octal.at(-1)) & WRITE_BIT_FOR_OTHERS) !== 0;
  return mode.split(",").some((clause) => {
    const parts = SYMBOLIC_CLAUSE.exec(clause);
    if (parts === null) return false;
    const who = parts[1] ?? "";
    return (who.includes("o") || who.includes("a")) && (parts[3] ?? "").includes("w");
  });
}

function opensPermission(line: string): boolean {
  if (!line.includes(PERMISSION_COMMAND)) return false;
  const modes = [...line.matchAll(COMMAND_MODE), ...line.matchAll(CALL_MODE)];
  return modes.some((match) => grantsWriteToOthers(match[1] ?? ""));
}

const NETWORK_WORDS = ["ssh", "scp", "curl", "wget", "host"] as const;
const NETWORK_CONTEXT = new RegExp(
  `(?<![A-Za-z])(?:${NETWORK_WORDS.join("|")})(?![A-Za-z])|://|@`,
  "i",
);
// A final period ends a sentence, not the address.
const DOTTED_QUAD = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?!\.?\d)/g;
const UNSPECIFIED_ADDRESS = [0, 0, 0, 0].join(".");
const BROADCAST_ADDRESS = [255, 255, 255, 255].join(".");
// Loopback (127/8) and the three documentation ranges of RFC 5737.
const UNCOUNTED_PREFIXES = ["127.", "192.0.2.", "198.51.100.", "203.0.113."] as const;

// The bare word, quoted, or as a constant expression: the runner reads all three as true.
const FAILURE_TOLERANCE = new RegExp(
  String.raw`${["continue", "on", "error"].join("-")}:\s*(?:true|'true'|"true"|\$\{\{\s*true\s*\}\})(?![\w])`,
  "i",
);
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;

/**
 * A comment is read in the file's own syntax: `*` opens a line only inside a
 * C-family block comment (in a shell script it is a `case` default branch), and
 * `#` is a private member in TypeScript. A file of any other kind is read with `#`.
 */
const C_FAMILY_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".rs",
  ".go",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".java",
  ".kt",
  ".swift",
  ".css",
  ".scss",
  ".jsonc",
]);
const MARKUP_EXTENSIONS = new Set([".html", ".htm", ".xml", ".svg", ".vue"]);

interface CommentSyntax {
  /** What a line that is only a comment starts with. */
  readonly whole: readonly string[];
  /** What opens a comment running to the end of a line of code. */
  readonly trailing: readonly string[];
}

function commentSyntax(path: string): CommentSyntax {
  const extension = extname(path).toLowerCase();
  if (C_FAMILY_EXTENSIONS.has(extension))
    return { whole: ["//", "/*", "*"], trailing: ["//", "/*"] };
  if (MARKUP_EXTENSIONS.has(extension)) return { whole: ["<!--"], trailing: ["<!--"] };
  return { whole: ["#"], trailing: ["#"] };
}

const PROSE_EXTENSIONS = [".md", ".txt"] as const;

function isCountedAddress(candidate: string): boolean {
  // isIP refuses an octet above 255, which a version number can carry.
  if (isIP(candidate) !== 4) return false;
  if (candidate === UNSPECIFIED_ADDRESS || candidate === BROADCAST_ADDRESS) return false;
  return !UNCOUNTED_PREFIXES.some((prefix) => candidate.startsWith(prefix));
}

function carriesNetworkAddress(line: string): boolean {
  if (!NETWORK_CONTEXT.test(line)) return false;
  return (line.match(DOTTED_QUAD) ?? []).some(isCountedAddress);
}

interface Detector {
  readonly family: LiteralFamily;
  readonly matches: (path: string, line: string) => boolean;
}

const DETECTORS: readonly Detector[] = [
  {
    family: "download-to-interpreter",
    matches: (_path, line) => relaysDownload(line),
  },
  {
    family: "world-writable-permission",
    matches: (_path, line) => opensPermission(line),
  },
  {
    family: "network-ipv4-literal",
    matches: (_path, line) => carriesNetworkAddress(line),
  },
  {
    family: "unjustified-failure-tolerance",
    matches: (path, line) => WORKFLOW_FILE.test(path) && FAILURE_TOLERANCE.test(line),
  },
];

function isProse(path: string): boolean {
  const lower = path.toLowerCase();
  return PROSE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isLockfile(path: string): boolean {
  return path.endsWith(".lock");
}

function isCommentOnly(syntax: CommentSyntax, line: string): boolean {
  const start = line.trimStart();
  return syntax.whole.some((prefix) => start.startsWith(prefix));
}

const QUOTES = ['"', "'", "`"] as const;

/** An opener after an odd number of one quote character sits inside a string. */
function insideString(prefix: string): boolean {
  return QUOTES.some((quote) => prefix.split(quote).length % 2 === 0);
}

/**
 * Where the trailing comment of a line of code opens, or -1: the first opener
 * of the file's syntax that starts the line or follows a blank, outside a string.
 */
function trailingCommentStart(syntax: CommentSyntax, line: string): number {
  let first = -1;
  for (const opener of syntax.trailing) {
    let at = line.indexOf(opener);
    while (at !== -1) {
      const blankBefore = at === 0 || /\s/.test(line[at - 1] ?? "");
      if (blankBefore && !insideString(line.slice(0, at))) break;
      at = line.indexOf(opener, at + 1);
    }
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }
  return first;
}

/**
 * An allowance is a marker with a reason, inside the trailing comment of the
 * line, after the literal it exempts: the code before the comment must still
 * match on its own. A marker in a string is text, not an allowance.
 */
function carriesReasonedAllowance(
  syntax: CommentSyntax,
  line: string,
  matchesCode: (code: string) => boolean,
): boolean {
  const comment = trailingCommentStart(syntax, line);
  if (comment === -1) return false;
  const marker = line.indexOf(FORBIDDEN_LITERAL_MARKER, comment);
  if (marker === -1) return false;
  if (!matchesCode(line.slice(0, comment))) return false;
  const reason = line
    .slice(marker + FORBIDDEN_LITERAL_MARKER.length)
    .replace(/(?:-->|\*\/)\s*$/, "")
    .trim();
  return reason.length > 0;
}

interface LogicalLine {
  /** The first physical line, the one a finding names. */
  readonly line: number;
  readonly text: string;
}

/**
 * Physical lines ending in a backslash are one command: `<download> \` then
 * `| <interpreter>` on the next line is one relay. A comment line never
 * continues, so it is skipped alone.
 */
function logicalLines(syntax: CommentSyntax, text: string): LogicalLine[] {
  const physical = text.split("\n");
  const logical: LogicalLine[] = [];
  let index = 0;
  while (index < physical.length) {
    const first = index;
    let current = physical[index] ?? "";
    index += 1;
    if (isCommentOnly(syntax, current)) continue;
    const parts: string[] = [];
    while (current.trimEnd().endsWith("\\") && index < physical.length) {
      parts.push(current.trimEnd().slice(0, -1).trim());
      current = physical[index] ?? "";
      index += 1;
    }
    parts.push(current.trim());
    logical.push({ line: first + 1, text: parts.join(" ") });
  }
  return logical;
}

/**
 * The whole decision as a pure function, so every branch is tested without a
 * filesystem. `text: null` is a binary file.
 */
export function scanForbiddenLiterals(files: readonly ScannedFile[]): LiteralScan {
  const findings: LiteralFinding[] = [];
  const allowed: LiteralFinding[] = [];
  let examined = 0;
  let excludedProse = 0;
  let excludedLockfile = 0;
  let excludedPatternSubject = 0;
  let excludedBinary = 0;
  let excludedLink = 0;

  for (const file of files) {
    if (file.link === true) {
      excludedLink += 1;
      continue;
    }
    if (isProse(file.path)) {
      excludedProse += 1;
      continue;
    }
    if (isLockfile(file.path)) {
      excludedLockfile += 1;
      continue;
    }
    if (isPatternSubject(file.path)) {
      excludedPatternSubject += 1;
      continue;
    }
    if (file.text === null) {
      excludedBinary += 1;
      continue;
    }
    examined += 1;
    const syntax = commentSyntax(file.path);
    for (const { line, text } of logicalLines(syntax, file.text)) {
      for (const { family, matches } of DETECTORS) {
        if (!matches(file.path, text)) continue;
        const finding: LiteralFinding = { file: file.path, line, family, text };
        const matchesCode = (code: string): boolean => matches(file.path, code);
        if (carriesReasonedAllowance(syntax, text, matchesCode)) allowed.push(finding);
        else findings.push(finding);
      }
    }
  }

  return {
    tracked: files.length,
    examined,
    excludedProse,
    excludedLockfile,
    excludedPatternSubject,
    excludedBinary,
    excludedLink,
    findings,
    allowed,
  };
}

const GATE = "Forbidden literals";
/** Distinct from 1 (findings): the gate could not read, so it found nothing AND proved nothing. */
const READ_FAILURE_EXIT = 2;

type StagedEntries =
  | { readonly ok: true; readonly links: ReadonlyMap<string, boolean> }
  | { readonly ok: false; readonly reason: string };

const STAGED_RECORD = /^([0-7]{6}) [0-9a-f]+ [0-3]\t(.+)$/s;

/**
 * Pure parse of `git ls-files -s -z`: `<mode> <sha> <stage>\t<path>\0`. Each
 * path once, in order (an unmerged path has one record per stage), mapped to
 * whether any of its records is a symbolic link or a submodule entry.
 */
export function parseStagedEntries(output: string): StagedEntries {
  const links = new Map<string, boolean>();
  if (output === "") return { ok: true, links };
  if (!output.endsWith("\0"))
    return { ok: false, reason: "ls-files output does not end with a NUL" };
  for (const record of output.slice(0, -1).split("\0")) {
    const match = STAGED_RECORD.exec(record);
    if (match === null) return { ok: false, reason: `unexpected ls-files record "${record}"` };
    const mode = match[1] ?? "";
    const path = match[2] ?? "";
    const link = mode === SYMLINK_MODE || mode === GITLINK_MODE;
    links.set(path, (links.get(path) ?? false) || link);
  }
  return { ok: true, links };
}

function failToRead(reasons: readonly string[]): never {
  for (const reason of reasons) console.error(`${GATE}: ${reason}`);
  console.error(`${GATE} could not read its sources: no verdict.`);
  process.exit(READ_FAILURE_EXIT);
}

if (import.meta.main) {
  const { readGit } = await import("./git-diff");
  const { concludeGate, GateReport } = await import("./gate-report");

  const top = readGit(["rev-parse", "--show-toplevel"], "resolve the repository root");
  if (!top.ok) failToRead([top.reason]);
  const root = top.stdout.trim();
  // `-z`: paths come NUL-terminated and unquoted, whatever `core.quotePath` says.
  // `-s`: the mode of each entry, so a link is known without touching it.
  const listed = readGit(["-C", root, "ls-files", "-s", "-z"], "list the tracked files");
  if (!listed.ok) failToRead([listed.reason]);
  const entries = parseStagedEntries(listed.stdout);
  if (!entries.ok) failToRead([entries.reason]);

  const files: ScannedFile[] = [];
  const unreadable: string[] = [];
  for (const [path, indexedAsLink] of entries.links) {
    try {
      const absolute = join(root, path);
      // The index mode, then the working tree: a file swapped for a link since
      // staging is a link too. Either way its target is never opened.
      if (indexedAsLink || lstatSync(absolute).isSymbolicLink()) {
        files.push({ path, text: null, link: true });
        continue;
      }
      const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        bytes = readFileSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      // A NUL byte is git's own test for a binary file.
      files.push({ path, text: bytes.includes(0) ? null : new TextDecoder().decode(bytes) });
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      unreadable.push(`could not read tracked file ${path}: ${cause}`);
    }
  }
  // A listed file that cannot be read is not a file without findings.
  if (unreadable.length > 0) failToRead(unreadable);

  const scan = scanForbiddenLiterals(files);
  const volume = `tracked=${scan.tracked} examined=${scan.examined} excluded-prose=${scan.excludedProse} excluded-lockfile=${scan.excludedLockfile} excluded-test-fixture=${scan.excludedPatternSubject} excluded-binary=${scan.excludedBinary} excluded-link=${scan.excludedLink} findings=${scan.findings.length} allowed=${scan.allowed.length}`;

  const report = new GateReport().volume(volume);
  for (const finding of scan.findings) {
    console.log(`${finding.file}:${finding.line}: ${finding.family}: ${finding.text}`);
    report.check(
      `${finding.file}:${finding.line}`,
      false,
      `${finding.family}: ${finding.text} (remove it, or annotate the line \`${FORBIDDEN_LITERAL_MARKER} <reason>\`)`,
    );
  }
  for (const finding of scan.allowed) {
    console.log(`  allowed  ${finding.file}:${finding.line}  ${finding.family}`);
  }
  if (scan.findings.length === 0 && scan.tracked > 0) {
    report.check(
      "forbidden literals",
      scan.examined > 0,
      scan.examined > 0
        ? `no forbidden literal in ${scan.examined} examined file(s)`
        : `none of the ${scan.tracked} tracked file(s) was examined — every one fell in an exclusion class`,
    );
  }
  console.log(`${GATE}: ${volume}`);
  concludeGate(GATE, report);
}
