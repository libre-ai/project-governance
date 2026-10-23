import { concludeGate, GateReport } from "./gate-report";

/**
 * Review-evidence gate (K4 redefinition, Domain A re-ratification, 2026-08-18,
 * ADR-0023).
 *
 * POLARIS.md used to describe K4 ("mutations of layer 3 and guardrails: human
 * review + signature + bounded rollback") as realized by "CODEOWNERS +
 * doctrine gate + independent-review protocol" — but no `.github/CODEOWNERS`
 * file exists in this repository (grep confirms it; G0-CANONICAL-BOOTSTRAP.md
 * already says enforcement stays disabled until reviewer teams exist). The
 * honest realization, for a solo-maintainer forge, is what actually happens
 * on every accepted doctrine change: a documented adversarial review pass,
 * then an owner merge — the merge itself IS the signature (AGENTS.md: "a
 * doctrine merge is a signature"). This gate is the mechanical backstop for
 * that honest definition: it fails a pull request that mutates the closed
 * human-touch surface (I-17 — the registers, the ADRs) without pointing at
 * either artefact that makes the review real.
 *
 * Two admissible forms of evidence, searched in both the pull request
 * description and the diff of the gated files themselves:
 *
 * 1. A reference to a review artefact under `docs/reviews/` — the existing,
 *    established location for dossiers, verdicts and counter-reviews (see
 *    docs/reviews/AGENT-REVIEW-PROTOCOL.md and the many *-VERDICT-*.md,
 *    *-DOSSIER.md files already living there).
 * 2. A dated owner-arbitration marker: the literal token `Owner-arbitration:`
 *    (case-insensitive) immediately followed by an ISO date. This is
 *    deliberately narrow. A free-form sentence claiming arbitration —
 *    "arbitrated by the owner", "owner approved" — is exactly what a trivial
 *    bypass would type, so it is not recognised; only the literal token plus
 *    a real date counts. This is a text-convention backstop, not a
 *    cryptographic one — proportionate to what a solo-maintainer forge can
 *    enforce mechanically without inventing a signing ceremony nobody asked
 *    for (anti-gold-plating: the owner's arbitration already IS the human
 *    control point I-17 requires; this gate only makes forgetting to cite it
 *    impossible to merge silently).
 *
 * `ecosystem/FORGOTTEN.yaml` joined the gated surface on 2026-10-08 (owner
 * decision Y13): ADR-0019 §2 makes every eviction carry a dated owner
 * arbitration, and its `decided_by: owner` / `decided_on:` fields are written
 * by the same hand that writes the entry — they record the claim, they are
 * not evidence of it. The pull request that registers an eviction cites the
 * arbitration the same way a doctrine change does. The three pull requests
 * that touched the register before this date (#4, #10, #17) carried neither
 * form; the gate judges the diff of the pull request under review, so they
 * are not re-evaluated.
 *
 * `docs/decisions/LEXICON.md` joined the gated surface on 2026-10-14: the
 * lexicon fixes the meaning of the words the invariants and ADRs are written
 * in, so redefining a term changes what a signed rule says without touching
 * the rule. It was left out when the surface was drawn; #102 amended it under
 * this gate's blind spot.
 *
 * A review-artefact reference counts only if it names a path that exists in
 * the tree under review (2026-10-14). Before, any string shaped like
 * `docs/reviews/…` passed — a reference to a dossier that was never written
 * produced the same green as a real one (observed on #102's first run). The
 * standing files of the directory (its README and the review protocol) exist
 * in every tree, so citing them proves nothing about this change and they are
 * not admissible either.
 *
 * In the diff, only the lines the pull request ADDS are evidence (2026-10-23).
 * Before, the whole `git diff` text was scanned: a marker on a context line —
 * already in the register, merged by an earlier pull request, shown only
 * because it sits next to the changed line — counted the same as one this
 * pull request writes, and so did a marker on a line the pull request
 * REMOVES. Observed on #131: "10 candidate signal(s): 4 admissible", the four
 * being `Owner-arbitration:` markers of decisions D91 to D93 printed as
 * context around the added row. A hunk header (`@@ … @@ <function context>`)
 * repeats a nearby line too, so it is not evidence either. The diff is parsed
 * hunk by hunk and each added line is attached to its file.
 *
 * Runs only on `pull_request` events: the diff against the PR's base and the
 * PR description both exist there. A `push` to `main` only ever happens
 * through a protected-branch merge that already passed this gate at PR time,
 * so there is nothing further to check post-merge.
 */

export const GATED_PATH_PATTERNS: readonly RegExp[] = [
  /^docs\/adr\//,
  /^docs\/decisions\/INVARIANTS\.md$/,
  /^docs\/decisions\/DECISION-REGISTER\.md$/,
  /^docs\/decisions\/LEXICON\.md$/,
  /^ecosystem\/FORGOTTEN\.yaml$/,
];

/**
 * The same surface as git pathspecs, for the diff the evidence is searched in.
 * One entry per pattern above — the test suite holds the two lists together,
 * so a path cannot be gated without its diff being read.
 */
export const GATED_PATHSPECS: readonly string[] = [
  "docs/adr",
  "docs/decisions/INVARIANTS.md",
  "docs/decisions/DECISION-REGISTER.md",
  "docs/decisions/LEXICON.md",
  "ecosystem/FORGOTTEN.yaml",
];

/** Pure filter, so "what counts as gated" is testable without a git call. */
export function touchesGatedPaths(changedPaths: readonly string[]): string[] {
  return changedPaths.filter((path) => GATED_PATH_PATTERNS.some((pattern) => pattern.test(path)));
}

const REVIEW_ARTIFACT_PATTERN = /docs\/reviews\/[^\s)`"'<>]+/g;
const OWNER_ARBITRATION_PATTERN = /owner-arbitration:\s*\d{4}-\d{2}-\d{2}/gi;

export interface EvidenceSignal {
  readonly source: "pr-body" | "diff";
  readonly kind: "review-artifact" | "owner-arbitration-marker";
  readonly text: string;
  /** The gated file whose added line carries the signal; null for the PR body, which has none. */
  readonly file: string | null;
}

/** One line the pull request adds, without its `+` prefix, attached to the file it is added to. */
export interface AddedLine {
  readonly file: string;
  readonly text: string;
}

/**
 * Every line of a unified diff, classified. The four counts sum to the number
 * of lines of the diff, so what was not examined is said, not dropped.
 */
export interface DiffScan {
  readonly added: readonly AddedLine[];
  /** Unchanged lines shown around a change: already in the base, written by someone else. */
  readonly context: number;
  readonly removed: number;
  /** `diff --git`, index, mode, `---`/`+++`, `@@` hunk headers, `\ No newline`: never content. */
  readonly header: number;
}

/** `b/docs/x.md` or `"b/docs/x y.md"` → `docs/x.md`; `/dev/null` (a deleted file) → null. */
function destinationPath(raw: string): string | null {
  const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  if (unquoted === "/dev/null") return null;
  return unquoted.startsWith("b/") ? unquoted.slice(2) : unquoted;
}

/**
 * Pure parse of `git diff` output into the lines the change adds.
 *
 * Only a line INSIDE a hunk is content, so the parser tracks whether it is in
 * one: `@@` opens a hunk, `diff --git` closes it and starts the next file.
 * Inside a hunk every content line carries a one-character prefix, so a `+++`
 * there is an added line whose text begins with `++` — only outside a hunk is
 * it the destination header. A line outside any hunk is never added content,
 * whatever it starts with: fail-closed on input that is not a git diff.
 */
export function extractAddedLines(diffText: string): DiffScan {
  const added: AddedLine[] = [];
  let context = 0;
  let removed = 0;
  let header = 0;
  if (diffText === "") return { added, context, removed, header };

  const lines = (diffText.endsWith("\n") ? diffText.slice(0, -1) : diffText).split("\n");
  let file: string | null = null;
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      file = null;
      header += 1;
    } else if (line.startsWith("@@")) {
      inHunk = true;
      header += 1;
    } else if (!inHunk) {
      if (line.startsWith("+++ ")) file = destinationPath(line.slice(4));
      header += 1;
    } else if (line.startsWith("+")) {
      // A hunk always follows a `+++` header in git output; a file-less hunk
      // is malformed input and its lines are not attributable, so not evidence.
      if (file === null) header += 1;
      else added.push({ file, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      removed += 1;
    } else if (line.startsWith("\\")) {
      header += 1;
    } else {
      // A space-prefixed line, or an empty one where a tool stripped the
      // trailing space of an empty context line: unchanged either way.
      context += 1;
    }
  }
  return { added, context, removed, header };
}

/** Files that live in `docs/reviews/` in every tree: citing them reviews nothing. */
export const STANDING_REVIEW_PATHS: readonly string[] = [
  "docs/reviews/README.md",
  "docs/reviews/AGENT-REVIEW-PROTOCOL.md",
];

/** Answers whether a repository-relative path exists in the tree under review. */
export type PathExists = (path: string) => boolean;

/** Pure scan over one text blob, so the two accepted forms are independently testable. */
export function findEvidenceSignals(
  source: "pr-body" | "diff",
  text: string,
  file: string | null,
): EvidenceSignal[] {
  const signals: EvidenceSignal[] = [];
  for (const match of text.matchAll(REVIEW_ARTIFACT_PATTERN)) {
    // Sentence punctuation is not part of a path: "see docs/reviews/x.md." cites x.md.
    const path = match[0].replace(/[.,;:]+$/, "").replace(/\/+$/, "");
    signals.push({ source, kind: "review-artifact", text: path, file });
  }
  for (const match of text.matchAll(OWNER_ARBITRATION_PATTERN)) {
    signals.push({ source, kind: "owner-arbitration-marker", text: match[0], file });
  }
  return signals;
}

/** `pr-body`, or `diff <file>` — where a signal was read, as the report prints it. */
function signalOrigin(signal: EvidenceSignal): string {
  return signal.file === null ? signal.source : `${signal.source} ${signal.file}`;
}

/**
 * Pure verdict: given what changed and where evidence might live, decide.
 * No git, no GitHub API — the effectful half below gathers those and calls in.
 */
export function evaluateReviewEvidence(
  changedPaths: readonly string[],
  prBody: string,
  diffText: string,
  pathExists: PathExists,
): GateReport {
  const report = new GateReport();
  const gated = touchesGatedPaths(changedPaths);
  if (gated.length === 0) {
    report.allowEmpty(`this run touches none of ${GATED_PATHSPECS.join(", ")}`);
    return report;
  }

  const scan = extractAddedLines(diffText);
  const signals = [
    ...findEvidenceSignals("pr-body", prBody, null),
    ...scan.added.flatMap((line) => findEvidenceSignals("diff", line.text, line.file)),
  ];
  const admissible: EvidenceSignal[] = [];
  const rejected: string[] = [];
  for (const signal of signals) {
    if (signal.kind === "owner-arbitration-marker") {
      admissible.push(signal);
    } else if (STANDING_REVIEW_PATHS.includes(signal.text)) {
      rejected.push(
        `${signal.text} (${signalOrigin(signal)}) is a standing file of docs/reviews/, not a review`,
      );
    } else if (!pathExists(signal.text)) {
      rejected.push(
        `${signal.text} (${signalOrigin(signal)}) does not exist in the tree under review`,
      );
    } else {
      admissible.push(signal);
    }
  }

  const examined =
    `${scan.added.length} added line(s) examined in the diff of the gated files ` +
    `(${scan.context} context, ${scan.removed} removed and ${scan.header} header line(s) are not evidence)`;
  report.volume(
    `${examined}; ${signals.length} candidate signal(s): ${admissible.length} admissible, ${rejected.length} rejected`,
  );
  const ok = admissible.length > 0;
  const rejectedNote = rejected.length > 0 ? `; rejected references: ${rejected.join("; ")}` : "";
  report.check(
    gated.join(", "),
    ok,
    ok
      ? `evidence found: ${admissible.map((signal) => `${signal.kind} (${signalOrigin(signal)}): ${signal.text}`).join("; ")}${rejectedNote}`
      : `neither the pull request description nor a line the pull request adds to the gated files references an existing docs/reviews/** artefact or carries an 'Owner-arbitration: YYYY-MM-DD' marker (${examined}; ${signals.length} candidate signal(s) examined${rejectedNote})`,
  );
  return report;
}

/** `git cat-file -e HEAD:<path>` answers for a blob or a tree, so a dossier directory counts. */
function existsAtHead(path: string): boolean {
  return sh(["git", "cat-file", "-e", `HEAD:${path}`]).exitCode === 0;
}

function sh(argv: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

async function readPullRequestBody(): Promise<string> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return "";
  try {
    const event = JSON.parse(await Bun.file(eventPath).text()) as {
      pull_request?: { body?: string | null };
    };
    return event.pull_request?.body ?? "";
  } catch {
    return "";
  }
}

if (import.meta.main) {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    concludeGate(
      "Review evidence",
      new GateReport().allowEmpty(
        `not a pull_request run (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}) — ` +
          "enforcement happens at the PR gate, where a diff against the base branch and a PR description both exist",
      ),
    );
  } else {
    const baseRef = process.env.GITHUB_BASE_REF;
    if (!baseRef) {
      console.error("check-review-evidence: GITHUB_BASE_REF is required on pull_request runs");
      process.exit(1);
    }
    const fetched = sh(["git", "fetch", "--quiet", "origin", baseRef]);
    if (fetched.exitCode !== 0) {
      console.error(
        `check-review-evidence: could not fetch origin/${baseRef}: ${fetched.stderr.trim()}`,
      );
      process.exit(1);
    }
    const names = sh(["git", "diff", "--name-only", `origin/${baseRef}...HEAD`]);
    // An unreadable diff is not an empty one: it would read as "touches none
    // of the gated paths" and pass.
    if (names.exitCode !== 0) {
      console.error(
        `check-review-evidence: could not list the paths changed in origin/${baseRef}...HEAD: ${names.stderr.trim()}`,
      );
      process.exit(1);
    }
    const changedPaths = names.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // The parser reads git's own format: no colour, no external diff driver,
    // no textconv, and the `a/`/`b/` prefixes whatever `diff.noprefix` says.
    const diff = sh([
      "git",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      `origin/${baseRef}...HEAD`,
      "--",
      ...GATED_PATHSPECS,
    ]);
    if (diff.exitCode !== 0) {
      console.error(
        `check-review-evidence: could not diff origin/${baseRef}...HEAD: ${diff.stderr.trim()}`,
      );
      process.exit(1);
    }
    const prBody = await readPullRequestBody();
    concludeGate(
      "Review evidence",
      evaluateReviewEvidence(changedPaths, prBody, diff.stdout, existsAtHead),
    );
  }
}
