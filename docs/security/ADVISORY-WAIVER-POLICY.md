# Fleet policy — dependency advisory waivers

- **Status:** doctrine — applies to every repository in the fleet that
  waives or ignores a published advisory (`cargo deny`/`cargo audit`
  ignore lists, `bun audit` exclusions, `osv-scanner` ignores, or an
  equivalent mechanism in any other ecosystem the fleet adopts).
- **Scope:** the discipline a waiver must carry to be legitimate. Not in
  scope: which gate blocks a pull request versus a periodic fleet scan —
  that split is `ADR-0021` (D1/D2/D3), unchanged by this document.

## The policy

An advisory waiver that is not dated, referenced and bounded is not a
decision — it is a hole nobody is asked to revisit. Every waiver entry, in
any repository, in any waiver mechanism, carries three properties:

1. **Dated.** An explicit expiry, a real calendar date. Undated is
   permanent, and permanent is the defect.
2. **Referenced.** A pointer to the record that justifies it — an ADR, a
   dossier, a decision log entry. A date with nothing to review behind it
   is a renewal with nothing to read.
3. **Bounded.** The expiry sits within a fixed horizon of the last review,
   never dated far enough out that it survives a full review cycle
   unexamined. A waiver renewable to an arbitrary future date is a waiver
   nobody re-reads.

A **required** gate verifies these three properties mechanically, on every
change to the waiver list, in every repository that carries one — see
[The implementation](#the-implementation). A policy
without a gate that enforces it is a convention, and a convention is what
produced the drift this policy exists to close (see below).

## The implementation

The gate is `tools/quality/check-advisory-waivers.ts`; its rules are the pure
module `tools/quality/advisory-waivers.ts`, unit-tested in
`tools/quality/advisory-waivers.test.ts` and end-to-end in
`tools/quality/check-advisory-waivers.test.ts`. Owner decision 2026-10-09:
it lives in this authority and reaches the fleet through the template, rather
than as a script each repository copies.

- **Where it runs.** `.github/workflows/validate-composition.yml`, the
  reusable workflow every product repository's `code-validation.yml` calls,
  runs it on the target's tracked files, from the tooling generation the
  caller pinned — a repository picks it up when it moves to that generation.
  This repository runs it in `bun run check` (`check:advisory-waivers`). A
  repository that does not call `validate-composition.yml` runs
  `bun <governance checkout>/tools/quality/check-advisory-waivers.ts --root=.`
  in one of its own required checks.
<!-- allow-audit-flag-fixture: this policy names `--ignore` flags of audit commands; it waives nothing. -->

- **What it reads.** Every tracked waiver mechanism:
  - `[advisories] ignore` in `.cargo/audit.toml` and in cargo-deny's three
    file names, `deny.toml`, `.deny.toml` and `.cargo/deny.toml` (strings,
    `{ id, reason }` or `{ crate, reason }` tables);
  - in `osv-scanner.toml`, every `IgnoredVulns` entry (any spelling the
    scanner's decoder accepts: `[[IgnoredVulns]]`, quoted, lower-case, or an
    inline array) and every `[[PackageOverrides]]` with `ignore = true` or
    `vulnerability.ignore = true`;
  - `--ignore` flags of `bun audit`, `bun pm audit` and `cargo [+toolchain]
    audit` command lines in workflows, composite actions (`action.yml`),
    `package.json` scripts, shell and bash scripts, Makefiles and justfiles —
    commands continued with `\` and YAML block scalars (`|`, `>`) included.
  - **Equivalent mechanisms** (owner decision 2026-10-09): each of these
    stops an advisory from failing, so each is a waiver and carries the same
    metadata on its line — `[graph] exclude` entries in a cargo-deny file;
    `[advisories] unmaintained` or `unsound` set to any scope but `"all"`;
    `[advisories] vulnerability` or `notice` set to anything but `"deny"`;
    `severity_threshold` in `.cargo/audit.toml`; `cargo deny ... -A` / `-W`
    (`--allow` / `--warn`) on an advisory code (`vulnerability`,
    `unmaintained`, `unsound`, `notice`, `yanked`); `bun audit --audit-level`.
- **What an entry carries,** on the same line as its id (for a table, in its
  `reason`):

  ```toml
  # waiver-review-anchor: 2026-07-26
  [advisories]
  ignore = [
      "RUSTSEC-2026-0174", # http-types via the optional stripe feature; expires=2026-09-30; ref=docs/adr/0005-dependency-advisory-waivers.md
  ]
  ```

  `expires=` is a real ISO 8601 date (dated); `ref=` is a tracked
  repository-relative FILE other than the waiver file itself, or an `https`
  URL (referenced) — a directory is not a record; the remaining text is the
  justification, which needs at least ten characters in two words once paths
  are removed (`ok` or `see docs/x.md` is not one). osv-scanner has its own
  expiry fields and only they count: `ignoreUntil` (`effectiveUntil` for an
  override); an `expires=` written in its `reason` is refused, since the
  scanner never reads it. On a command line, each `--ignore` value must be a
  literal advisory id (`RUSTSEC-`, `GHSA-`, `CVE-`): an id behind a variable
  cannot be judged. The file's `waiver-review-anchor` is the date the
  list was last read against the resolved graph; no entry may expire before
  it or more than 365 days after it (bounded). An advisory waived in two files
  carries the same date in both. A `package.json` cannot carry a comment, so
  an exclusion written there always fails: put it on a line that can say when
  it ends.
- **Two tiers, split by whether the verdict depends on the clock.** Every
  rule above is a pure function of the committed files and fails on the
  commit that breaks it. The only clock-dependent verdict is the passed
  expiry, judged against `--today` (default: the runner's UTC date): it is
  announced on every run for the 30 days before it blocks, rather than
  flipping red overnight with no commit to point at. A review anchor dated
  after today also fails — it is the one way to stretch the horizon without
  reviewing anything.
- **It never runs `cargo audit`, `cargo deny` or `bun audit`.** A
  network-fetching, database-dependent scan wired into a required check turns
  a branch red on an upstream publication with no local commit (`ADR-0021`);
  verifying the waiver list against a live graph stays a reviewed, local
  operation, recorded in the waiver's `ref=`.
- **It fails closed.** A tracked waiver source it cannot read, cannot parse,
  or that its positional TOML reader and `Bun.TOML` do not read identically
  is a failure, never zero waivers; so is an `IgnoredVulns` or
  `ignore = true` occurrence in an osv-scanner file that no key accounts for.
  Every tracked text file is swept for a waiver-shaped flag (`--ignore`,
  `--audit-level`, `-A`/`-W`) near an audit command: one that no reader
  attributes to an entry — a YAML plain scalar continued on the next line,
  an argument array in a script — fails as unparseable. A test fixture or a
  document that only describes such flags says so with the marker
  `allow-audit-flag-fixture` and is listed by name on every run; the marker
  is not read in a workflow, action, manifest, script, Makefile or justfile.
  Each run prints its volume — `N waiver(s) read across I inspected of C
  classified file(s) (S skipped: reasons), K expiring within 30 days` —
  where inspected plus skipped equals classified, and a repository with no
  source to read fails as having asserted nothing.
- **One reading, reused.** `readWaiverFile(path, text)` in
  `tools/quality/advisory-waivers.ts` is the gate's reading of one file, and
  `readRepositoryWaivers(root)` in `tools/quality/check-advisory-waivers.ts`
  its reading of a work tree. Any other control that reports waivers (the
  periodic fleet advisory report) calls one of them; a second parser would
  see a different list.

**Provenance.** The design is that of `scripts/advisory-waiver-gate.sh`, the
fleet's first instance, merged in `feed-radar` as `4f0f2bbc` on 2026-07-26
with that repository's dated record `docs/adr/0005-dependency-advisory-waivers.md`.
`feed-radar` was retired by the 2026-10-07 consolidation and its successor is
archived without the script; the source survives only in the donor mirror
preserved under `archives/libre-ai-donors-20261007/`. The rules A–F of its
header are carried over; the reference check, the justification check, the
future-anchor check, the fail-closed reading and the sources beyond Cargo are
additions. The original's portability concern (no GNU- or BSD-only `date`
flags) disappears with the port to Bun: date arithmetic is `Date.UTC`.

## Why this is fleet policy, not repository convention

`docs/adr/0021-who-owns-the-state-of-the-world-for-dependency-
advisories.md` records the incident that made "the fleet owns the state
of the world" a decision: thirty of thirty-one repositories ran no audit
at all, and the one that did was the only reason a live-range pin was
caught. A waiver carries the same failure shape one level down — even a
repository that does run an audit can still waive an advisory silently,
undated, unreferenced, forever. `feed-radar`'s own history is the
concrete case: eight waivers in one file, five of which matched nothing
in the graph, went unreviewed until a gate forced the question. This
policy is what stops that from being repository-specific luck.

Owner-arbitration: 2026-08-18
