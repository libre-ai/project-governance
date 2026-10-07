# Fleet policy — dependency advisory waivers

- **Status:** doctrine — applies to every repository in the fleet that
  waives or ignores a published advisory (`cargo deny`/`cargo audit`
  ignore lists, `bun audit` exclusions, or an equivalent mechanism in any
  other ecosystem the fleet adopts).
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
change to the waiver list, in every repository that carries one. A policy
without a gate that enforces it is a convention, and a convention is what
produced the drift this policy exists to close (see below).

## The reference implementation, not a template to copy blindly

`libre-ai/feed-radar` carries the fleet's only proven instance:
`scripts/advisory-waiver-gate.sh`, folded into an existing required check
rather than given a workflow of its own, and `docs/adr/0005-dependency-
advisory-waivers.md`, its dated record. Three entries currently expire
`2026-09-30`. The gate's own header is the worked argument for every
design choice below — read it before writing a second instance, rather
than re-deriving the same tradeoffs from zero:

- two tiers, split by whether the verdict depends on the clock: file-content
  rules (dated, referenced, not already lapsed at the last review, within
  horizon, coherent across files if more than one waiver mechanism exists)
  fail immediately on a bad commit; the expiry-passed check is the only
  clock-dependent verdict, and it is pre-announced with a warning window
  rather than flipping red overnight with no commit to point at;
- the gate does **not** call `cargo audit`/`cargo deny` (or an equivalent
  live advisory fetch) itself — a network-fetching, database-dependent
  scan wired into a required check turns `main` red on an upstream
  publication with no local commit; verifying the waiver list against a
  live graph stays a reviewed, local operation, recorded in the ADR, not
  a CI step;
- portability of the date arithmetic matters more than it looks: the
  gate's civil-date conversion runs identically on the local shell and the
  CI runner because it avoids both GNU-only and BSD-only `date` flags.

This document does not add a new gate. A repository that waives an
advisory and has no such gate yet is out of compliance with this policy
from the day its first waiver is committed — bringing it into compliance
means porting `advisory-waiver-gate.sh`'s design to that repository's own
manifest format, not inventing a fourth property.

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
