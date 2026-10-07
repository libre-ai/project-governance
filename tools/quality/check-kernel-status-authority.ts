import { concludeGate, GateReport } from "./gate-report";

/**
 * Kernel status authority gate (domain F/H, 2026-08-18).
 *
 * `docs/specifications/LOOP-SECURITY-KERNEL.md`'s "Status of the five
 * controls at this lock" table is the single normative source for K1–K5
 * status. Before this gate, that guarantee held nowhere but convention: the
 * kernel document itself drifted internally (the header claimed "two
 * controls complete at the orchestrator lock", the "Enforcement boundary"
 * section named one, the status table named zero — three counts in one
 * file, because two promotion commits (#150, #196) each updated only the
 * table and never the surrounding prose), and `POLARIS.md` /
 * `THREAT-MODEL.md` each carried their own independently-dated K-status
 * claims that could silently diverge from it. This gate makes that
 * divergence a merge-time failure instead of a discovery a year later.
 *
 * A "K-status claim" is a control identifier (`K1`–`K5`) and a status word
 * from the kernel's own vocabulary (`in service`, `specified`, `reviewed`)
 * plus the two generic words that show up in the wild describing a
 * not-yet-closed gap (`pending`, `complete`), within a bounded window of
 * each other, in either order — a table cell or a sentence clause, not a
 * cross-paragraph coincidence.
 *
 * Two escape hatches, both nominative (adding one means editing this file,
 * which a reviewer sees):
 *
 * 1. Directory-level: `docs/reviews/**`, `distribution/evidence/**` and
 *    `distribution/feeds/**` are append-only evidence and changelog stores —
 *    the same treatment `doctrine-governance.yml` already gives
 *    `docs/reviews/` for its own superseded-doctrine and retired-brand
 *    scans. A dated verdict or changelog entry that once said "K3 in
 *    service" is a trace of that day, not a competing status.
 * 2. File-level (`DECLARED_FILE_ALLOWANCES`): a small number of specific
 *    files outside those directories that legitimately carry a K-status
 *    claim as history rather than a live restatement — a dated ADR
 *    quoting the status at its ratification, a dated bullet in `STATUS.md`,
 *    or `THREAT-MODEL.md`'s frozen 2026-07-22 table, now bannered to point
 *    at the kernel document instead of standing as a second source.
 *
 * Every declared file allowance is checked for staleness the same way
 * `check-empty-allowances.ts` checks its own list: a declaration naming a
 * file that no longer contains a K-status claim is a standing permission
 * nobody needs, and fails loudly rather than sitting there unused.
 */

export const KERNEL_FILE = "docs/specifications/LOOP-SECURITY-KERNEL.md";

const STATUS_WORDS = "in service|specified|reviewed|pending|complete";

const K_NUMBER_PATTERN = /\bK[1-5]\b/i;
const STATUS_WORD_PATTERN = new RegExp(`\\b(?:${STATUS_WORDS})\\b`, "i");

/**
 * `K[1-5]` then a status word within 100 characters, or the reverse order —
 * for prose. A bounded window keeps a long paragraph from pairing a control
 * mentioned in one sentence with an unrelated status word two sentences
 * later. No `g` flag: this pattern is only ever used with `.test()` on one
 * line at a time, and a global-flagged regex's `lastIndex` state is a
 * well-known footgun across repeated `.test()` calls on different strings.
 */
export const KERNEL_STATUS_PATTERN = new RegExp(
  `\\bK[1-5]\\b.{0,100}?\\b(?:${STATUS_WORDS})\\b|\\b(?:${STATUS_WORDS})\\b.{0,100}?\\bK[1-5]\\b`,
  "i",
);

/**
 * A markdown table row is one record, however wide the cells make the line —
 * `docs/method/POLARIS.md`'s K-rows run past 250 characters once the
 * requirement column is in French prose. Windowing the same way as prose
 * would silently miss real status claims (proven against this repository:
 * with a 100-character window, only the K4 row matched, because it happens
 * to repeat "K4" mid-row closer to the status cell — K1/K2/K3/K5 did not).
 * So a table row asserts a claim whenever it carries both tokens anywhere,
 * in either order.
 */
function isTableRow(line: string): boolean {
  return line.startsWith("|");
}

export interface KernelStatusMatch {
  /** 1-based, for a human-readable violation message. */
  readonly line: number;
  readonly text: string;
}

/** Pure scan over one file's text, so the pattern is testable without touching the filesystem. */
export function scanForKernelStatusClaims(text: string): KernelStatusMatch[] {
  const matches: KernelStatusMatch[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    const isClaim = isTableRow(line)
      ? K_NUMBER_PATTERN.test(line) && STATUS_WORD_PATTERN.test(line)
      : KERNEL_STATUS_PATTERN.test(line);
    if (isClaim) matches.push({ line: i + 1, text: line });
  }
  return matches;
}

interface FileAllowance {
  readonly file: string;
  /** Why this is a historical trace, not a competing live status. */
  readonly because: string;
}

/** Append-only evidence and changelog stores: a directory-level exemption, not a per-file one. */
export const EXEMPT_DIRECTORY_PREFIXES = [
  "docs/reviews/",
  "distribution/evidence/",
  "distribution/feeds/",
] as const;

export const IGNORED_PATH_PREFIXES = [
  ".git/",
  ".tools/",
  "node_modules/",
  "target/",
  "dist/",
] as const;

export const DECLARED_FILE_ALLOWANCES: readonly FileAllowance[] = [
  {
    file: "docs/security/THREAT-MODEL.md",
    because:
      "frozen 2026-07-22 controls-status snapshot, never amended since (single commit 5b7a964); bannered (domain F/H, 2026-08-18) to point at LOOP-SECURITY-KERNEL.md's table as the living source instead of standing as a second one",
  },
  {
    file: "STATUS.md",
    because:
      'dated bullet-point history ("K1 in service (2026-07-20)") in the same register as a merge-log entry, not a restated live status',
  },
  {
    file: "docs/adr/0018-wave-3-opening-orchestrator-and-harness.md",
    because:
      "accepted ADR (ratified 2026-07-25) quoting the K-status as of that ratification — a decision record, not a live claim; an ADR is a trace, per this gate's own remit",
  },
];

export function isExemptDirectory(path: string): boolean {
  return EXEMPT_DIRECTORY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export interface ScannedFile {
  readonly path: string;
  readonly text: string;
}

/**
 * Pure verdict over a set of already-read files, so the policy is testable
 * without a real filesystem walk. `files` is expected to already exclude the
 * kernel document itself and any exempt directory — the effectful half below
 * does that filtering while it globs.
 */
export function evaluateKernelStatusAuthority(files: readonly ScannedFile[]): GateReport {
  const report = new GateReport();
  const allowanceByFile = new Map(DECLARED_FILE_ALLOWANCES.map((a) => [a.file, a.because]));

  for (const { path, text } of files) {
    const matches = scanForKernelStatusClaims(text);
    if (matches.length === 0) {
      report.check(path, true, "no K1-K5 status claim outside the kernel table");
      continue;
    }
    const because = allowanceByFile.get(path);
    if (because !== undefined) {
      report.check(path, true, `declared allowance in force: ${because}`);
      continue;
    }
    report.check(
      path,
      false,
      `asserts a K-control status outside ${KERNEL_FILE} (its single normative source): ` +
        `${matches.map((m) => `line ${m.line}: "${m.text}"`).join("; ")} — point at the kernel ` +
        "table instead of restating a status, or add a nominative allowance here if this is a " +
        "legitimate dated historical trace",
    );
  }

  const scannedByPath = new Map(files.map((f) => [f.path, f.text]));
  for (const allowance of DECLARED_FILE_ALLOWANCES) {
    const text = scannedByPath.get(allowance.file);
    if (text === undefined) {
      report.check(
        `${allowance.file} (allowance)`,
        false,
        "declared allowance names a file this run did not scan — it moved, was deleted, or fell " +
          "under an exempt directory; remove the declaration or fix the glob/exempt-directory list",
      );
      continue;
    }
    if (scanForKernelStatusClaims(text).length === 0) {
      report.check(
        `${allowance.file} (allowance)`,
        false,
        "declared an allowance for a K-status claim that is no longer there — remove the now-stale declaration",
      );
    }
  }

  if (files.length === 0) {
    report.allowEmpty(
      "no non-kernel markdown file was scanned — check the glob and the exempt-directory list",
    );
  }

  return report;
}

if (import.meta.main) {
  const files: ScannedFile[] = [];
  const glob = new Bun.Glob("**/*.md");
  for await (const path of glob.scan({ cwd: ".", onlyFiles: true })) {
    if (path === KERNEL_FILE) continue;
    if (IGNORED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
    if (isExemptDirectory(path)) continue;
    files.push({ path, text: await Bun.file(path).text() });
  }

  concludeGate("Kernel status authority", evaluateKernelStatusAuthority(files));
}
