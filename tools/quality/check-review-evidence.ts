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
 * Runs only on `pull_request` events: the diff against the PR's base and the
 * PR description both exist there. A `push` to `main` only ever happens
 * through a protected-branch merge that already passed this gate at PR time,
 * so there is nothing further to check post-merge.
 */

export const GATED_PATH_PATTERNS: readonly RegExp[] = [
  /^docs\/adr\//,
  /^docs\/decisions\/INVARIANTS\.md$/,
  /^docs\/decisions\/DECISION-REGISTER\.md$/,
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
}

/** Pure scan over one text blob, so the two accepted forms are independently testable. */
export function findEvidenceSignals(source: "pr-body" | "diff", text: string): EvidenceSignal[] {
  const signals: EvidenceSignal[] = [];
  for (const match of text.matchAll(REVIEW_ARTIFACT_PATTERN)) {
    signals.push({ source, kind: "review-artifact", text: match[0] });
  }
  for (const match of text.matchAll(OWNER_ARBITRATION_PATTERN)) {
    signals.push({ source, kind: "owner-arbitration-marker", text: match[0] });
  }
  return signals;
}

/**
 * Pure verdict: given what changed and where evidence might live, decide.
 * No git, no GitHub API — the effectful half below gathers those and calls in.
 */
export function evaluateReviewEvidence(
  changedPaths: readonly string[],
  prBody: string,
  diffText: string,
): GateReport {
  const report = new GateReport();
  const gated = touchesGatedPaths(changedPaths);
  if (gated.length === 0) {
    report.allowEmpty(
      "this run touches none of docs/adr/**, docs/decisions/INVARIANTS.md or docs/decisions/DECISION-REGISTER.md",
    );
    return report;
  }

  const signals = [
    ...findEvidenceSignals("pr-body", prBody),
    ...findEvidenceSignals("diff", diffText),
  ];
  const ok = signals.length > 0;
  report.check(
    gated.join(", "),
    ok,
    ok
      ? `evidence found: ${signals.map((signal) => `${signal.kind} (${signal.source}): ${signal.text}`).join("; ")}`
      : "neither the pull request description nor the diff of the gated files references a docs/reviews/** artefact or carries an 'Owner-arbitration: YYYY-MM-DD' marker",
  );
  return report;
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
    const changedPaths = names.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const diff = sh([
      "git",
      "diff",
      `origin/${baseRef}...HEAD`,
      "--",
      "docs/adr",
      "docs/decisions/INVARIANTS.md",
      "docs/decisions/DECISION-REGISTER.md",
    ]);
    const prBody = await readPullRequestBody();
    concludeGate("Review evidence", evaluateReviewEvidence(changedPaths, prBody, diff.stdout));
  }
}
