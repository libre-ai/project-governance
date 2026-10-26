import { concludeGate, GateReport } from "./gate-report";
import { type GitRead, listChangedPaths, readGit, runGit } from "./git-diff";

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
 * guardrail mutations on the human-touch surface. Each file is gated exactly,
 * not its neighbours, except `bunfig.toml`, which is gated at every depth:
 * check-release-age.ts reads every tracked one, and reusable-work-package-link
 * runs its gate from the governance checkout, so a `preload` in the root one
 * would execute code inside the gate of every consumer.
 *
 * The configuration of the aggregate's own tools joined on 2026-10-26. The
 * inventory held six files as "awaiting owner arbitration": `package.json`,
 * `tsconfig.json`, `biome.json`, `REUSE.toml`, `Cargo.toml` and
 * `crates/ecosystem-engine/Cargo.toml`. The owner delegated the decision that
 * day ("Le faire"), with this criterion: a file is gated if a change to it can
 * loosen a gate (lint levels, compiler strictness, exclusions, licence
 * annotations that exempt files, the scripts that compose `bun run check`);
 * otherwise it is declared, with its reason. All six meet it. So does the
 * manifest of every workspace package (`packages/<name>/package.json`):
 * `bun install` runs its lifecycle scripts, which execute code before any gate
 * (measured with Bun 1.4.4 on 2026-10-26: a `postinstall` of a workspace
 * package ran). `biome.json` and `REUSE.toml` are gated at every depth,
 * because each tool reads a nested one (measured the same day: a nested
 * `biome.json` with `"root": false` and the linter disabled removed its
 * subtree from `biome lint` with Biome 2.5.3, and a nested `REUSE.toml`
 * annotating `**` made a failing `reuse lint` pass). The measured cost, on the
 * 100 merged pull requests #48 to #159: 18 touched one of the six, 8 of them
 * touching no path gated before (16 touched `package.json`); none was opened
 * by a bot. The command: `gh pr list -R libre-ai/project-governance --state
 * merged --limit 100 --json number,author,files`.
 *
 * These files are gated by a second list, CONFIGURATION_PATH_PATTERNS, and not
 * by GATED_PATH_PATTERNS, because the latter is the guarded surface of I-17
 * for the whole fleet. check-work-package-link.ts runs in the consumers
 * (reusable-work-package-link.yml) and refuses every exemption, and requires
 * an explicit owner `ready`, on a pull request that touches a path of
 * GATED_PATH_PATTERNS; tools/fleet/bump-generation.ts refuses to propose a
 * bump that does. A consumer's root `package.json`, `Cargo.toml`, `biome.json`
 * or `REUSE.toml` would match the same anchored patterns. Measured on
 * 2026-10-26: the fleet-bump class of work-package-policy.v1.yaml lists
 * `package.json`, so a bump editing it would be refused; in
 * libre-ai/ai-work-supervision, the one repository `gh search code` finds
 * wiring the reusable gate, 17 of the 40 merged pull requests touched one of
 * these paths and would have needed an explicit `ready`. That is a fleet
 * decision, not the one delegated here, so it stays the owner's. The
 * inventory counts both lists as gated (`touchesReviewedPaths`).
 *
 * Dependency bumps: there is no automatic path for a bot. Every Rust
 * dependency of the crate is pinned exactly (`=x.y.z`), so a Dependabot cargo
 * update edits `crates/ecosystem-engine/Cargo.toml` and needs evidence like
 * any other change. Exempting an author would not keep the gate honest: the
 * author of a pull request says nothing about who wrote its later commits, and
 * a maintainer can push to a Dependabot branch. The path to green is the
 * owner's: write an `Owner-arbitration: YYYY-MM-DD` line in the description,
 * then close and reopen the pull request. This gate runs in ci.yml, on the
 * `opened`, `synchronize` and `reopened` events only, and a re-run replays the
 * payload of the event that started it, so an edited description is read
 * only by a new event. Dependabot opened none of the 151 pull requests
 * `gh pr list --state all` listed on 2026-10-26, and `.github/dependabot.yml` carries no
 * bun entry (owner decision 2026-09-08), so no bot edits `package.json` today.
 *
 * Which files belong here is not left to a name heuristic. Every tracked file
 * that is neither source code nor Markdown is either gated by this list or
 * declared not gated, with its reason, in `check-data-inventory.ts`, which
 * fails on any other: a new data file is a decision, gated or declared, never
 * a silent addition.
 *
 * LIMITS, not decided here (#152, ADR-0060 proposed in #158). The surface is
 * written in code that is itself outside the surface: this file, its test and
 * the inventory. A pull request that drops a pattern below, declares the file
 * in the inventory and adjusts the tests passes every gate with no review
 * evidence, because the gate it weakens is the one that judges it. The same
 * holds for the allowlists kept in the code of other gates, for the CI
 * definitions under `.github/workflows/`, and for Markdown a gate reads as
 * data. The full list, with the command that finds the code allowlists, is the LIMITS
 * section of `check-data-inventory.ts`. Guarding any of them is an owner
 * decision.
 *
 * A review-artefact reference counts only if it names a path that exists in
 * the tree under review (2026-10-14). Before, any string shaped like
 * `docs/reviews/…` passed — a reference to a dossier that was never written
 * produced the same green as a real one (observed on #102's first run). The
 * standing files of the directory (its README and the review protocol) exist
 * in every tree, so citing them proves nothing about this change and they are
 * not admissible either.
 *
 * A review record counts only for what it concludes (#160, 2026-10-26).
 * Before, an existing path was enough, whatever its verdict: on #158 a
 * dossier whose verdict was `reject` turned `Bun quality` green on 30beb61.
 * The gate now reads the cited file at HEAD, and it admits the reference only
 * if:
 *
 * 1. the file is a record, not a directory. A dossier directory holds several
 *    rounds, and which one applies cannot be read from the directory, so the
 *    reference must name the record;
 * 2. the record carries a readable verdict line, and every verdict line it
 *    carries gives the same verdict. Three forms are read. The canonical form
 *    is defined in docs/reviews/AGENT-REVIEW-PROTOCOL.md ("Verdict line"):
 *    the first line `Verdict: <verdict> on <commit>`, with ` on <commit>`
 *    optional. The other two are the forms the existing records use. Counted
 *    on the 14 records under docs/reviews/ other than the two standing files,
 *    on 2026-10-26:
 *    - first line `Verdict: <verdict>`, without the commit: 4 records (rounds
 *      2 to 5 of adr-0060-gates-run-from-pr-2026-10-24), all of which also
 *      carry the next form;
 *    - a `## Verdict` heading whose first non-blank line is
 *      `` **`<verdict>`** sur le commit `<commit>`. ``: 5 records (the five
 *      rounds of adr-0060-gates-run-from-pr-2026-10-24);
 *    - a `## Verdict` heading whose first non-blank line is `<verdict>`,
 *      alone or followed by ` — ` and prose: 2 records
 *      (guard-loosening-data-159);
 *    - none of these: 7 records (the ATTESTATION and CANONICALIZATION files
 *      of the two bootstrap dossiers, their REVIEW.md files, whose verdicts
 *      `PASS WITH NOTES`, `FAIL` and "no remaining blocking finding" are not
 *      protocol verdicts, and unwired-gates-2026-10-08/REVIEW.md). These
 *      records are immutable audit records and are not rewritten, so citing
 *      one of them is not evidence.
 *    The count, rerun with: `git ls-files 'docs/reviews/**.md'`, then for each
 *    file the first line and the first non-blank line after `## Verdict`;
 * 3. the verdict is `approve` or `approve-with-minor-reservations`. A
 *    `reject` record is refused: the protocol keeps it as an audit record,
 *    and that does not make it evidence;
 * 4. the record names the reviewed commit, as a full 40-character sha: in its
 *    canonical verdict line, in the verdict line of the `## Verdict` heading,
 *    or on a `Reviewed commit: <commit>` line (a list item or not, as in
 *    guard-loosening-data-159). Each of the 7 records with a readable verdict
 *    names it, and if a record names more than one commit the reference is
 *    refused;
 * 5. that commit is an ancestor of HEAD (`git merge-base --is-ancestor`). A
 *    record of another change is not evidence for this one. On 2026-10-26
 *    each of the seven reviewed commits is an ancestor of the head of the
 *    pull request it reviewed (#158: 5 of 5, #159: 2 of 2), and of no other.
 *    On a pull_request run HEAD is the merge commit of the pull request,
 *    whose history (fetch-depth 0) holds the commits of its branch. A rebase
 *    of the branch after the review therefore makes the record stale.
 *
 * A reference refused for any of these reasons is named in the verdict, like
 * a dangling one. It fails the gate only when no other evidence is admissible.
 *
 * LIMITS of the verdict read. It does not check that the reviewed commit is
 * the head: a gated change pushed after the reviewed commit, which the
 * protocol says makes the approval stale, still passes. Comparing the gated
 * paths between the two commits would catch it, but on a branch that merges
 * its base the merged changes would show up as well (on #158,
 * `git diff --name-only 2bfd7ca <head>` lists package.json, which #158 never
 * touched). The verdict line is text written in the repository: it records
 * what the reviewer concluded, and the gate cannot tell who wrote it. The
 * `review-verdict.v0.1` envelope that the protocol names is not read.
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
  // Bun reads it from its working directory: `minimumReleaseAge`, its excludes,
  // and `preload`, which executes code. check-release-age.ts reads every tracked one.
  /(^|\/)bunfig\.toml$/,
  // check-langgraph-advisory-floor.ts, distributed: the minimum version per advisory fix.
  /^distribution\/templates\/langgraph-gates\/langgraph-advisory-floor\.v1\.txt$/,
  // validate-cards / validate-knowledge-objects: what a card or an object must carry.
  /^ecosystem\/schemas\/project\.v1\.schema\.json$/,
  /^ecosystem\/schemas\/knowledge-object\.schema\.json$/,
  /^ecosystem\/schemas\/knowledge-projection\.schema\.json$/,
  // check-dependabot-conformance.ts: the exact form every consumer's dependabot.yml must take.
  /^distribution\/templates\/dependabot\/cargo\.yml$/,
  /^distribution\/templates\/dependabot\/github-actions\.yml$/,
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
  // `glob` magic: `**/` also matches no directory, so the root file is included.
  ":(glob)**/bunfig.toml",
  "distribution/templates/langgraph-gates/langgraph-advisory-floor.v1.txt",
  "ecosystem/schemas/project.v1.schema.json",
  "ecosystem/schemas/knowledge-object.schema.json",
  "ecosystem/schemas/knowledge-projection.schema.json",
  "distribution/templates/dependabot/cargo.yml",
  "distribution/templates/dependabot/github-actions.yml",
];

/**
 * The configuration of this repository's own tools (owner delegation,
 * 2026-10-26): a change needs review evidence here, but it is not a guarded
 * path of I-17 for the fleet gates that import GATED_PATH_PATTERNS
 * (check-work-package-link.ts, tools/fleet/bump-generation.ts). Each line
 * names the gate the file can loosen.
 */
export const CONFIGURATION_PATH_PATTERNS: readonly RegExp[] = [
  // `bun run check`: scripts.check lists the steps it runs; `bun install` runs its lifecycle scripts.
  /^package\.json$/,
  // `bun install` runs the lifecycle scripts of every workspace package (`workspaces: packages/*`).
  /^packages\/[^/]+\/package\.json$/,
  // `typecheck` (`tsc -p tsconfig.json`): what it reads (include, exclude) and how strict it is.
  /^tsconfig\.json$/,
  // `lint` (`biome ci .`): what it reads and the rule levels; Biome applies a nested one to its subtree.
  /(^|\/)biome\.json$/,
  // `reuse lint`: an annotation licenses every path it matches; a nested one is read as well.
  /(^|\/)REUSE\.toml$/,
  // `check:rust` (clippy, cargo test): members, [workspace.lints], profiles, [patch].
  /^Cargo\.toml$/,
  // `check:rust`: the crate's [lints] table, its test targets (autotests, [[test]]) and features.
  /^crates\/ecosystem-engine\/Cargo\.toml$/,
];

/** CONFIGURATION_PATH_PATTERNS as git pathspecs, one entry per pattern, in the same order. */
export const CONFIGURATION_PATHSPECS: readonly string[] = [
  "package.json",
  // `glob` magic: `*` does not cross a `/`, as `[^/]+` does not.
  ":(glob)packages/*/package.json",
  "tsconfig.json",
  ":(glob)**/biome.json",
  ":(glob)**/REUSE.toml",
  "Cargo.toml",
  "crates/ecosystem-engine/Cargo.toml",
];

/** Every pathspec whose diff this gate reads: the guarded surface, then the configuration. */
export const REVIEWED_PATHSPECS: readonly string[] = [
  ...GATED_PATHSPECS,
  ...CONFIGURATION_PATHSPECS,
];

/**
 * Pure filter on the guarded surface of I-17, so "what counts as gated" is
 * testable without a git call. The fleet gates import it.
 */
export function touchesGatedPaths(changedPaths: readonly string[]): string[] {
  return changedPaths.filter((path) => GATED_PATH_PATTERNS.some((pattern) => pattern.test(path)));
}

/** Pure filter on what needs review evidence here: the guarded surface and the configuration. */
export function touchesReviewedPaths(changedPaths: readonly string[]): string[] {
  return changedPaths.filter((path) =>
    [...GATED_PATH_PATTERNS, ...CONFIGURATION_PATH_PATTERNS].some((pattern) => pattern.test(path)),
  );
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

/** What the tree under review holds at a cited path. */
export type RecordRead =
  | { readonly kind: "absent" }
  | { readonly kind: "directory" }
  /** A gitlink (submodule) or anything else that is neither a file nor a directory. */
  | { readonly kind: "other" }
  | { readonly kind: "file"; readonly text: string };

/** Where a reviewed commit stands relative to the head under review. */
export type Ancestry = "ancestor" | "not-ancestor" | "unknown-commit";

/** The two reads the verdict needs from the tree under review, injected so the verdict stays pure. */
export interface ReviewTree {
  readonly read: (path: string) => RecordRead;
  readonly ancestry: (commit: string) => Ancestry;
}

/** The three verdicts of docs/reviews/AGENT-REVIEW-PROTOCOL.md. */
export type Verdict = "approve" | "approve-with-minor-reservations" | "reject";

const VERDICTS: readonly Verdict[] = ["approve", "approve-with-minor-reservations", "reject"];

/** The verdicts that make a record evidence; `reject` does not. */
export const ADMISSIBLE_VERDICTS: readonly Verdict[] = [
  "approve",
  "approve-with-minor-reservations",
];

function isVerdict(value: string | undefined): value is Verdict {
  return VERDICTS.some((verdict) => verdict === value);
}

// `approve` is a prefix of `approve-with-minor-reservations`: every form below
// is anchored at the end of the line, so the shorter one never reads the longer.
const VERDICT = "(approve-with-minor-reservations|approve|reject)";
const COMMIT = "([0-9a-f]{40})";
/** The canonical form, on the first line of the record. */
const CANONICAL_VERDICT_LINE = new RegExp(`^Verdict: ${VERDICT}(?: on ${COMMIT})?$`);
const VERDICT_HEADING = "## Verdict";
/** After the heading, as the five rounds of adr-0060-gates-run-from-pr-2026-10-24 write it. */
const HEADING_VERDICT_WITH_COMMIT = new RegExp(
  `^\\*\\*\`${VERDICT}\`\\*\\* sur le commit \`${COMMIT}\`\\.$`,
);
/** After the heading, as the two rounds of guard-loosening-data-159 write it. */
const HEADING_VERDICT_ALONE = new RegExp(`^${VERDICT}(?: — .+)?$`);
const REVIEWED_COMMIT_LINE = new RegExp(`^(?:- )?Reviewed commit: ${COMMIT}(?:\\s|$)`);

/** Every verdict and every reviewed commit a record states, each listed once, in reading order. */
export interface RecordStatement {
  readonly verdicts: readonly Verdict[];
  readonly commits: readonly string[];
}

/** Pure read of a record's verdict lines, in the three forms of the gate header. */
export function readRecordStatement(text: string): RecordStatement {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const verdicts: Verdict[] = [];
  const commits: string[] = [];
  const state = (verdict: string | undefined, commit: string | undefined): void => {
    if (isVerdict(verdict) && !verdicts.includes(verdict)) verdicts.push(verdict);
    if (commit !== undefined && !commits.includes(commit)) commits.push(commit);
  };
  const canonical = (lines[0] ?? "").match(CANONICAL_VERDICT_LINE);
  if (canonical !== null) state(canonical[1], canonical[2]);
  lines.forEach((line, index) => {
    const reviewed = line.match(REVIEWED_COMMIT_LINE);
    if (reviewed !== null) state(undefined, reviewed[1]);
    if (line !== VERDICT_HEADING) return;
    const next = lines.slice(index + 1).find((candidate) => candidate.trim().length > 0) ?? "";
    const withCommit = next.match(HEADING_VERDICT_WITH_COMMIT);
    if (withCommit !== null) {
      state(withCommit[1], withCommit[2]);
      return;
    }
    const alone = next.match(HEADING_VERDICT_ALONE);
    if (alone !== null) state(alone[1], undefined);
  });
  return { verdicts, commits };
}

/** Why a cited record is not evidence, or null when it is. */
function recordRefusal(record: RecordRead, tree: ReviewTree): string | null {
  if (record.kind === "absent") return "does not exist in the tree under review";
  if (record.kind === "directory") {
    return "is a directory, not a record: cite the record whose verdict applies";
  }
  if (record.kind === "other") return "is neither a file nor a directory";
  const { verdicts, commits } = readRecordStatement(record.text);
  const [verdict] = verdicts;
  if (verdict === undefined) {
    return "has no readable verdict line (first line `Verdict: <verdict> on <commit>`, docs/reviews/AGENT-REVIEW-PROTOCOL.md)";
  }
  if (verdicts.length > 1) return `states conflicting verdicts (${verdicts.join(", ")})`;
  if (!ADMISSIBLE_VERDICTS.includes(verdict)) {
    return `records the verdict ${verdict}: a refused review is not evidence`;
  }
  const [commit] = commits;
  if (commit === undefined) return `records ${verdict} but names no reviewed commit`;
  if (commits.length > 1) return `names more than one reviewed commit (${commits.join(", ")})`;
  const ancestry = tree.ancestry(commit);
  if (ancestry === "unknown-commit") {
    return `records ${verdict} on ${commit}, which is not a commit of this clone`;
  }
  if (ancestry === "not-ancestor") {
    return `records ${verdict} on ${commit}, which is not an ancestor of the head: it reviews another change`;
  }
  return null;
}

/** `approve on 0123abcd…`: what an admitted record concludes, as the report prints it. */
function recordConclusion(record: RecordRead): string {
  if (record.kind !== "file") return "";
  const { verdicts, commits } = readRecordStatement(record.text);
  return ` (${verdicts[0] ?? ""} on ${commits[0] ?? ""})`;
}

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
  tree: ReviewTree,
): GateReport {
  const report = new GateReport();
  const gated = touchesReviewedPaths(changedPaths);
  if (gated.length === 0) {
    report.allowEmpty(`this run touches none of ${REVIEWED_PATHSPECS.join(", ")}`);
    return report;
  }

  const scan = extractAddedLines(diffText);
  const signals = [
    ...findEvidenceSignals("pr-body", prBody, null),
    ...scan.added.flatMap((line) => findEvidenceSignals("diff", line.text, line.file)),
  ];
  // Each admitted signal as the report prints it: `<kind> (<origin>): <text>`.
  const admissible: string[] = [];
  const rejected: string[] = [];
  for (const signal of signals) {
    const admitted = `${signal.kind} (${signalOrigin(signal)}): ${signal.text}`;
    if (signal.kind === "owner-arbitration-marker") {
      admissible.push(admitted);
      continue;
    }
    if (STANDING_REVIEW_PATHS.includes(signal.text)) {
      rejected.push(
        `${signal.text} (${signalOrigin(signal)}) is a standing file of docs/reviews/, not a review`,
      );
      continue;
    }
    const record = tree.read(signal.text);
    const refusal = recordRefusal(record, tree);
    if (refusal === null) admissible.push(`${admitted}${recordConclusion(record)}`);
    else rejected.push(`${signal.text} (${signalOrigin(signal)}) ${refusal}`);
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
      ? `evidence found: ${admissible.join("; ")}${rejectedNote}`
      : `neither the pull request description nor a line the pull request adds to the gated files references a docs/reviews/** record approving a commit of this change or carries an 'Owner-arbitration: YYYY-MM-DD' marker (${examined}; ${signals.length} candidate signal(s) examined${rejectedNote})`,
  );
  return report;
}

/**
 * Exit 1 on a git read that failed where it had to succeed: a record that
 * exists but cannot be read is not a record without a verdict.
 */
function orExitRead(read: GitRead): string {
  if (!read.ok) {
    console.error(`check-review-evidence: ${read.reason}`);
    process.exit(1);
  }
  return read.stdout;
}

/** The cited path at HEAD: `git cat-file -t` tells a file from a directory, then the file is read. */
function readAtHead(path: string): RecordRead {
  const type = runGit(["cat-file", "-t", `HEAD:${path}`]);
  if (type.exitCode !== 0) return { kind: "absent" };
  const kind = type.stdout.trim();
  if (kind === "tree") return { kind: "directory" };
  if (kind !== "blob") return { kind: "other" };
  return {
    kind: "file",
    text: orExitRead(readGit(["cat-file", "blob", `HEAD:${path}`], `read ${path} at HEAD`)),
  };
}

/** `git merge-base --is-ancestor` answers 0 or 1; anything else is a failed read, not an answer. */
function ancestryOfHead(commit: string): Ancestry {
  if (runGit(["cat-file", "-e", `${commit}^{commit}`]).exitCode !== 0) return "unknown-commit";
  const run = runGit(["merge-base", "--is-ancestor", commit, "HEAD"]);
  if (run.exitCode === 0) return "ancestor";
  if (run.exitCode === 1) return "not-ancestor";
  console.error(
    `check-review-evidence: could not compare ${commit} with HEAD: ${run.stderr.trim()}`,
  );
  process.exit(1);
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
          ...REVIEWED_PATHSPECS,
        ],
        `diff ${range}`,
      ),
    ).stdout;
    const prBody = await readPullRequestBody();
    concludeGate(
      "Review evidence",
      evaluateReviewEvidence(changedPaths, prBody, diff, {
        read: readAtHead,
        ancestry: ancestryOfHead,
      }),
    );
  }
}
