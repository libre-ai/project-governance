import { concludeGate, GateReport } from "./gate-report";
import { listChangedPaths, readGit, runGit } from "./git-diff";

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
 * `ecosystem/refusals.v1.yaml` joined the gated surface on 2026-10-23, as
 * ADR-0056 names it ("Suites nommées": the shape check of the register, "et
 * entrée du fichier dans la surface de `check-review-evidence`"). Removing an
 * entry, or lifting the refusal it carries, is an owner decision (ADR-0056
 * D4), and an entry written without its review would be read by the next
 * session as a settled refusal. Like FORGOTTEN.yaml, the file is gated
 * exactly, not its neighbours; its shape is checked by `check-refusals.ts`.
 * `tools/quality/refusals-exemptions.v1.json` joined with it: an exemption
 * relaxes that shape gate for one evidence, which is a guardrail mutation
 * (I-17) in the same way as editing the register.
 *
 * The rest of that class joined on 2026-10-24 (#153): every data file that
 * loosens a gate — an exemption, an allowlist, a waiver, an exception, a
 * threshold — or bounds what a gate inspects. Before, a pull request could
 * widen `ecosystem/sql-construction-allowlist.v1.yaml`, or empty the surface
 * list of `pr-negatives.v1.json`, with no review evidence, although I-17 puts
 * guardrail mutations on the human-touch surface. The class is written in data
 * below (`LOOSENING_CLASS`), and the test suite requires every tracked file it
 * matches to be either gated or declared in `NOT_GATED_LOOSENING` with its
 * reason. A new allowlist cannot then be added beside the others unguarded and
 * unsaid. Each file is gated exactly, not its neighbours.
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
 * REMOVES. Observed on #131 at c6cc66f: "9 candidate signal(s): 4 admissible,
 * 5 rejected", the four admitted
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
  /^ecosystem\/refusals\.v1\.yaml$/,
  /^tools\/quality\/refusals-exemptions\.v1\.json$/,
  // The loosening class (#153). Each line names the gate that reads the file.
  // check-pinned-citations.ts: exemptions, foreign owners, unnumbered ADRs, threshold.
  /^tools\/quality\/pinned-citations\.v1\.json$/,
  // check-pr-negatives.ts: the surface a `Not-added:` negative is confronted to.
  /^tools\/quality\/pr-negatives\.v1\.json$/,
  // check-threat-model-citations.ts: the scope and the files whose citations are checked.
  /^tools\/quality\/threat-model-citations\.v1\.json$/,
  // check-ref-monotonicity.py: a composed ref allowed to move backwards or sideways.
  /^\.github\/composition\/ref-monotonicity-exemptions\.json$/,
  // check-release-age.ts: packages admitted younger than the release-age floor.
  /^ecosystem\/release-age-exceptions\.v1\.yaml$/,
  // check-sql-construction.ts: raw-SQL construction sites admitted as safe.
  /^ecosystem\/sql-construction-allowlist\.v1\.yaml$/,
  // check-web-headers.ts: header relaxations, raw HTML sinks, servers outside surfaces.
  /^ecosystem\/web-headers-allowlist\.v1\.yaml$/,
  // check-work-package-link.ts: exempt classes, approving owners, maturity floor.
  /^ecosystem\/work-package-policy\.v1\.yaml$/,
  // bump-generation.ts: historical sites a bump leaves, commit identity, token secret.
  /^tools\/fleet\/bump-generation\.v1\.yaml$/,
  // check-dependency-policy.ts (cargo-deny): licence, source and advisory policy, ADR-0042 §4 and §11.
  /^deny\.toml$/,
  // check-advisory-waivers.ts reads it as a waiver source; ADR-0042 §11 names it with the root one.
  /^crates\/ecosystem-engine\/deny\.toml$/,
  // Bun's release-age guard and check-release-age.ts: `minimumReleaseAge` and its excludes.
  /^bunfig\.toml$/,
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
  "ecosystem/refusals.v1.yaml",
  "tools/quality/refusals-exemptions.v1.json",
  "tools/quality/pinned-citations.v1.json",
  "tools/quality/pr-negatives.v1.json",
  "tools/quality/threat-model-citations.v1.json",
  ".github/composition/ref-monotonicity-exemptions.json",
  "ecosystem/release-age-exceptions.v1.yaml",
  "ecosystem/sql-construction-allowlist.v1.yaml",
  "ecosystem/web-headers-allowlist.v1.yaml",
  "ecosystem/work-package-policy.v1.yaml",
  "tools/fleet/bump-generation.v1.yaml",
  "deny.toml",
  "crates/ecosystem-engine/deny.toml",
  "bunfig.toml",
];

/** Pure filter, so "what counts as gated" is testable without a git call. */
export function touchesGatedPaths(changedPaths: readonly string[]): string[] {
  return changedPaths.filter((path) => GATED_PATH_PATTERNS.some((pattern) => pattern.test(path)));
}

/**
 * The class of files that loosen a gate, or bound what it inspects (#153).
 * A tracked file belongs to it when ANY of the three rules matches; the rules
 * are the searches that found the class, kept so that they run again:
 *
 * - `path`: the path names a loosening (`git ls-files | grep -iE …`);
 * - `dataDirectory`: a non-code file directly in `tools/quality/` is data a
 *   gate of that directory reads — all four found are a gate's configuration;
 * - `key`: a JSON, YAML or TOML file carries, at the start of a line, a key
 *   that names an exemption list. `exclude`/`excludes` are matched too, at the
 *   price of declaring the compiler's `exclude` below: Bun's
 *   `minimumReleaseAgeExcludes` is an exemption list, and a narrower key list
 *   would have missed it.
 */
export const LOOSENING_CLASS = {
  path: /allow|exempt|waiver|exception|baseline/i,
  dataDirectory: /^tools\/quality\/[^/]+$/,
  code: /\.(ts|sh)$/,
  data: /\.(json|ya?ml|toml)$/,
  key: /^[ \t]*"?(allow|allowances|allowlist|exempt|exemptions|exceptions|waivers?|ignore|historical_sites|excludes?|[A-Za-z]+Excludes)"?[ \t]*[:=]/m,
} as const;

interface NotGated {
  readonly path: string;
  /** Why the file matches the class without loosening a gate, or why it is not guarded here. */
  readonly because: string;
}

/**
 * Tracked files the class matches and this gate does not guard, each with its
 * reason. Adding one is an edit of this list, which a reviewer sees.
 */
export const NOT_GATED_LOOSENING: readonly NotGated[] = [
  {
    path: "distribution/evidence/coverage-baseline-2026-07-19.json",
    because:
      "a dated coverage measurement published as evidence; only the evidence feeds cite it, no gate reads it as a threshold",
  },
  {
    path: "docs/consolidation/COMPOSITION-BASELINE.md",
    because: "a consolidation document; no gate reads it",
  },
  {
    path: "docs/reviews/square-control-bootstrap/95e1bcea42e6c20c9fc8987b65b7c55de007d2f2/evidence/identity-allowlist.json",
    because:
      "frozen evidence of a past review, under the commit it reviewed; no gate of this repository reads it",
  },
  {
    path: "docs/reviews/square-control-bootstrap/95e1bcea42e6c20c9fc8987b65b7c55de007d2f2/evidence/provider-policy.json",
    because:
      "frozen evidence of a past review (its `exclude` key is the reviewed product's); no gate of this repository reads it",
  },
  {
    path: "docs/security/ADVISORY-WAIVER-POLICY.md",
    because:
      "the policy in prose; the waivers live in the waiver sources (deny.toml, gated above) and the rules in check-advisory-waivers.ts, which reads this file only as a fixture-marked text",
  },
  {
    path: "tools/attestation/fixtures/frozen-readback.json",
    because: "a test fixture of the attestation tooling; no gate reads it as policy",
  },
  {
    path: "tsconfig.json",
    because:
      "the compiler configuration; its `exclude` lists build outputs and dependencies, and no decision or ADR fixes it the way ADR-0042 fixes deny.toml",
  },
  {
    path: "tools/quality/advisory-waivers.ts",
    because:
      "the pure half of the advisory-waiver gate, not a waiver list: check-advisory-waivers reads 0 waivers in this tree and marks this file as a fixture; gate code is not on this surface",
  },
  {
    path: "tools/quality/check-advisory-waivers.ts",
    because: "gate code (the advisory-waiver gate itself); gate code is not on this surface",
  },
  {
    path: "tools/quality/check-empty-allowances.ts",
    because:
      "gate code; its DECLARED_ALLOWANCES list is an allowlist kept in code, the same as this list, and gate code is not on this surface",
  },
  {
    path: "tools/quality/advisory-waivers.test.ts",
    because: "a test file",
  },
  {
    path: "tools/quality/check-advisory-waivers.test.ts",
    because: "a test file",
  },
  {
    path: "tools/quality/check-advisory-waivers.adversarial.test.ts",
    because: "a test file",
  },
  {
    path: "tools/quality/check-empty-allowances.test.ts",
    because: "a test file",
  },
];

/** Reads a tracked file's text, or null when it is not text the key rule applies to. */
export type ReadText = (path: string) => string | null;

/** Whether one tracked path belongs to the loosening class. Pure: the reader is injected. */
export function isLooseningClassMember(path: string, readText: ReadText): boolean {
  if (LOOSENING_CLASS.path.test(path)) return true;
  if (LOOSENING_CLASS.dataDirectory.test(path) && !LOOSENING_CLASS.code.test(path)) return true;
  if (!LOOSENING_CLASS.data.test(path)) return false;
  const text = readText(path);
  return text !== null && text.match(LOOSENING_CLASS.key) !== null;
}

/**
 * The loosening class confronted to the guarded surface. The members split
 * into gated, declared and undeclared; a declaration that is gated too, or
 * that no tracked member matches any more, is a defect of the list.
 */
export interface LooseningClassAudit {
  readonly members: readonly string[];
  readonly gated: readonly string[];
  readonly declared: readonly string[];
  /** Members neither gated nor declared: the files that escape the guard. */
  readonly undeclared: readonly string[];
  /** Declared AND gated: the list says "not gated" of a file that is. */
  readonly contradictory: readonly string[];
  /** Declarations naming no tracked member: a standing excuse ready for another file. */
  readonly stale: readonly string[];
}

export function auditLooseningClass(
  tracked: readonly string[],
  readText: ReadText,
  notGated: readonly NotGated[] = NOT_GATED_LOOSENING,
): LooseningClassAudit {
  const members = tracked.filter((path) => isLooseningClassMember(path, readText));
  const declaredPaths = notGated.map((entry) => entry.path);
  const gated = touchesGatedPaths(members);
  return {
    members,
    gated,
    declared: members.filter((path) => declaredPaths.includes(path)),
    undeclared: members.filter((path) => !gated.includes(path) && !declaredPaths.includes(path)),
    contradictory: gated.filter((path) => declaredPaths.includes(path)),
    stale: declaredPaths.filter((path) => !members.includes(path)),
  };
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
  return runGit(["cat-file", "-e", `HEAD:${path}`]).exitCode === 0;
}

/**
 * Exit 1 on a git read that failed, or return what it read.
 *
 * An unreadable diff is not an empty one: an empty path list reads as
 * "touches none of the gated paths" and passes, an empty content diff reads
 * as "no evidence" for a reason that is not the change. Both reads share this
 * one exit, so a single probe (a head with no merge base) holds it.
 */
function orExit<T>(
  read: ({ readonly ok: true } & T) | { readonly ok: false; readonly reason: string },
): T {
  if (!read.ok) {
    console.error(`check-review-evidence: ${read.reason}`);
    process.exit(1);
  }
  return read;
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
    const fetched = runGit(["fetch", "--quiet", "origin", baseRef]);
    if (fetched.exitCode !== 0) {
      console.error(
        `check-review-evidence: could not fetch origin/${baseRef}: ${fetched.stderr.trim()}`,
      );
      process.exit(1);
    }
    const range: string = `origin/${baseRef}...HEAD`;
    // The path list is the shared one (`git-diff.ts`): `--no-renames`, so an
    // ADR moved out of docs/adr is listed under its old path, deleted, instead
    // of "touching none" of the gated paths; `-z`, so a non-ASCII name is not
    // quoted into a form the gated patterns do not match.
    const changedPaths: readonly string[] = orExit(listChangedPaths([range])).entries.map(
      (entry) => entry.path,
    );
    // The parser reads git's own format, whatever the repository config says:
    // - no colour: an escape sequence before `+` would hide an added line;
    // - no external diff driver and no textconv: either replaces the text
    //   git compares, so a driver could print an added marker the change
    //   never wrote;
    // Rename detection is pinned ON here (`--find-renames`, whatever
    // `diff.renames` says), unlike the path list: without it, an ADR renamed inside docs/adr would print its whole
    // body as added lines, and a marker an earlier pull request wrote in it
    // would count as evidence. Detected, a pure rename adds no line; an ADR
    // moved out of the gated paths shows as a deletion, because rename
    // detection only pairs paths the pathspec kept.
    // The `a/`/`b/` prefixes and `core.quotePath=false` only keep the file
    // printed beside each signal readable: `destinationPath` already absorbs
    // `diff.noprefix`, and the verdict never depends on the file name, so for
    // the verdict these three are equivalent mutants and no test claims them.
    const diff: string = orExit(
      readGit(
        [
          "-c",
          "core.quotePath=false",
          "diff",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--find-renames",
          "--src-prefix=a/",
          "--dst-prefix=b/",
          range,
          "--",
          ...GATED_PATHSPECS,
        ],
        `diff ${range}`,
      ),
    ).stdout;
    const prBody = await readPullRequestBody();
    concludeGate(
      "Review evidence",
      evaluateReviewEvidence(changedPaths, prBody, diff, existsAtHead),
    );
  }
}
