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
 * The forms are assembled from fragments rather than quoted: this gate reads
 * its own file, and a gate that must exempt itself to pass has a blind spot
 * shaped like itself.
 */

import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";

import { isPatternSubject } from "./check-resolved-refs";

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
  /** Every file handed in. It equals examined plus the four exclusion counters. */
  tracked: number;
  examined: number;
  excludedProse: number;
  excludedLockfile: number;
  excludedPatternSubject: number;
  excludedBinary: number;
  findings: readonly LiteralFinding[];
  /** Lines that matched but carried a reasoned allowance — counted, never hidden. */
  allowed: readonly LiteralFinding[];
}

const DOWNLOADERS = ["curl", "wget"] as const;
const INTERPRETERS = [
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "python",
  "python3",
  "node",
  "bun",
  "perl",
  "ruby",
] as const;

// `[^|]*\|` stops at the first pipe, so `a || b` (whose second character is a
// pipe, not an interpreter) is not a relay.
const DOWNLOAD_TO_INTERPRETER = new RegExp(
  String.raw`(?<![\w-])(?:${DOWNLOADERS.join("|")})\b[^|]*\|\s*(?:sudo\s+(?:-\S+\s+)*)?(?:${INTERPRETERS.join("|")})(?![\w-])`,
);

const PERMISSION_COMMAND = ["ch", "mod"].join("");
const ALL_BITS = "7".repeat(3);
// The octal forms with their optional prefixes, then the two symbolic forms.
const OPEN_PERMISSION = new RegExp(String.raw`(?<![\d.])(?:0o?)?${ALL_BITS}(?!\d)|a\+rwx|o\+w`);

const NETWORK_WORDS = ["ssh", "scp", "curl", "wget", "host"] as const;
const NETWORK_CONTEXT = new RegExp(
  `(?<![A-Za-z])(?:${NETWORK_WORDS.join("|")})(?![A-Za-z])|://|@`,
  "i",
);
const DOTTED_QUAD = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g;
const UNSPECIFIED_ADDRESS = [0, 0, 0, 0].join(".");
const BROADCAST_ADDRESS = [255, 255, 255, 255].join(".");
// Loopback (127/8) and the three documentation ranges of RFC 5737.
const UNCOUNTED_PREFIXES = ["127.", "192.0.2.", "198.51.100.", "203.0.113."] as const;

const FAILURE_TOLERANCE = new RegExp(
  String.raw`${["continue", "on", "error"].join("-")}:\s*true\b`,
);
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;

const COMMENT_PREFIXES = ["#", "//", "*", "/*", "<!--"] as const;
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
    matches: (_path, line) => DOWNLOAD_TO_INTERPRETER.test(line),
  },
  {
    family: "world-writable-permission",
    matches: (_path, line) => line.includes(PERMISSION_COMMAND) && OPEN_PERMISSION.test(line),
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

function isCommentOnly(line: string): boolean {
  const start = line.trimStart();
  return COMMENT_PREFIXES.some((prefix) => start.startsWith(prefix));
}

/** An allowance must state its reason on the line; a comment closer is not a reason. */
function carriesReasonedAllowance(line: string): boolean {
  const marker = line.indexOf(FORBIDDEN_LITERAL_MARKER);
  if (marker === -1) return false;
  const reason = line
    .slice(marker + FORBIDDEN_LITERAL_MARKER.length)
    .replace(/(?:-->|\*\/)\s*$/, "")
    .trim();
  return reason.length > 0;
}

/**
 * The whole decision as a pure function, so every branch is tested without a
 * filesystem. `text: null` is a binary file.
 */
export function scanForbiddenLiterals(
  files: readonly { path: string; text: string | null }[],
): LiteralScan {
  const findings: LiteralFinding[] = [];
  const allowed: LiteralFinding[] = [];
  let examined = 0;
  let excludedProse = 0;
  let excludedLockfile = 0;
  let excludedPatternSubject = 0;
  let excludedBinary = 0;

  for (const file of files) {
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
    for (const [index, line] of file.text.split("\n").entries()) {
      if (isCommentOnly(line)) continue;
      for (const { family, matches } of DETECTORS) {
        if (!matches(file.path, line)) continue;
        const finding: LiteralFinding = {
          file: file.path,
          line: index + 1,
          family,
          text: line.trim(),
        };
        if (carriesReasonedAllowance(line)) allowed.push(finding);
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
    findings,
    allowed,
  };
}

const GATE = "Forbidden literals";
/** Distinct from 1 (findings): the gate could not read, so it found nothing AND proved nothing. */
const READ_FAILURE_EXIT = 2;

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
  const listed = readGit(["-C", root, "ls-files", "-z"], "list the tracked files");
  if (!listed.ok) failToRead([listed.reason]);

  const files: { path: string; text: string | null }[] = [];
  const unreadable: string[] = [];
  for (const path of listed.stdout.split("\0")) {
    if (path.length === 0) continue;
    try {
      const bytes = readFileSync(join(root, path));
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
  const volume = `tracked=${scan.tracked} examined=${scan.examined} excluded-prose=${scan.excludedProse} excluded-lockfile=${scan.excludedLockfile} excluded-test-fixture=${scan.excludedPatternSubject} excluded-binary=${scan.excludedBinary} findings=${scan.findings.length} allowed=${scan.allowed.length}`;

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
