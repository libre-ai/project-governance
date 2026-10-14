#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Libre AI contributors
# SPDX-License-Identifier: Apache-2.0
#
# Doctrine governance — the deterministic half of
# .github/workflows/doctrine-governance.yml, in one file that the workflow and
# `bun run check` both run (2026-10-14). Before, these checks lived as inline
# shell in the workflow only: `bun run check` was green locally on an accepted
# ADR citing no invariant, and only the pull request run said otherwise. One
# site, so the two cannot drift.
#
# Hard backstop for ADR-0008 §7: doctrine exists only in the invariants
# register, every accepted ADR carries its owner-arbitration trace, and the
# superseded doctrine or retired brands cannot silently resurface in living
# documents. The pull-request-only check (product paths need a work-package
# reference) stays in the workflow: it needs the base of the pull request.
#
# The deny-list motifs below are read by
# tools/quality/check-doctrine-patterns.test.ts, which fails on a superseded
# motif that matches no normative file. It requires exactly one assignment of
# each of the two deny-list variables in this file, so never spell either
# assignment out elsewhere here, in a comment included.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
adr_files=(docs/adr/*.md)

# --- ADR numbering is unique -------------------------------------------------
# Grandfathered collision: the two 0004 files predate this gate
# (0004-licensing-governance + 0004-agent-orchestration-option-b).
dups=$(ls docs/adr | grep -oE '^[0-9]{4}' | sort | uniq -d | grep -v '^0004$' || true)
if [ -n "$dups" ]; then
  echo "Duplicate ADR numbers: $dups"
  fail=1
fi

# --- Accepted ADRs from 0008 onward carry an Arbitrage line -----------------
# --- and cite an invariant or state they carry none -------------------------
# An accepted ADR is doctrine, and doctrine belongs in the invariants register
# (ADR-0008 point 7): it either fed the register or explicitly did not.
accepted=0
for f in "${adr_files[@]}"; do
  num=$(basename "$f" | cut -c1-4)
  case "$num" in *[!0-9]*) continue ;; esac
  if [ "$((10#$num))" -lt 8 ]; then continue; fi
  grep -qiE 'Statut.*accepted' "$f" || continue
  accepted=$((accepted + 1))
  if ! grep -qiE 'Arbitrage' "$f"; then
    echo "$f: accepted without an Arbitrage line"
    fail=1
  fi
  if ! grep -qE 'I-[0-9]{2}' "$f" && ! grep -qF 'No invariant' "$f"; then
    echo "$f: accepted, cites no I-## invariant, and carries no 'No invariant' line"
    fail=1
  fi
done

# --- Invariants register citations resolve -----------------------------------
cited=0
for n in $(grep -oE 'ADR-[0-9]{4}' docs/decisions/INVARIANTS.md | sort -u | cut -d- -f2); do
  cited=$((cited + 1))
  if ! ls docs/adr/"${n}"-*.md >/dev/null 2>&1; then
    echo "INVARIANTS.md cites ADR-${n} but docs/adr/${n}-*.md does not exist"
    fail=1
  fi
done
if grep -E 'ADR 0047' docs/decisions/INVARIANTS.md | grep -qv 'control-plane'; then
  echo "INVARIANTS.md: cross-repo ADR citation without the control-plane qualifier"
  fail=1
fi
for f in docs/specifications/IDENTITY-AUTHORIZATION.md docs/specifications/DATA-LIFECYCLE.md docs/transformation/G1-WORK-PACKAGES.md; do
  test -s "$f" || { echo "missing cited source: $f"; fail=1; }
done

# --- Superseded doctrine and retired brands stay out of living documents ------
# "Libre IA" (brand-name variant) added 2026-07-24 after the owner confirmed
# the ADR-0008 verdict trans-surface: the brand is "Libre AI" everywhere.
# ADR-0020 (2026-07-28) extends the motifs to newly superseded doctrine
# statements; the superseding acts, the origin ADRs and the bannered
# historical sequencing document may cite them, nothing else may.
# SUPERSEDED motifs are derived from origin texts still carried by a conserved
# normative register (ADR-0008 line 7, ADR-0009 §7) and must keep matching
# them there. PREVENTIVE motifs guard against the resurgence of purged texts
# and banned brands/domains: zero matches outside the excluded citers is their
# healthy state.
superseded="projections (générées )?à sens unique|repositories spécialisés (=|sont des) projections|partagé par plusieurs produits vit au socle|source unique(\*\*)? de la topologie publique"
preventive="unique source modifiable|One .?bun\.lock.?, one Cargo workspace|One Bun and one Cargo workspace|Daidalos|free-ai\.fr|libre-ia\.fr|Libre IA"
matches=$(grep -rn -E "$superseded|$preventive" \
  --include='*.md' . \
  | grep -v 'docs/reviews/' \
  | grep -v 'docs/adr/0008-' \
  | grep -v 'docs/adr/0009-' \
  | grep -v 'docs/adr/0020-' \
  | grep -v 'docs/superpowers/specs/2026-07-28-multi-repo-activation-design.md' \
  | grep -v 'docs/transformation/EXECUTION-SEQUENCING.md' \
  | grep -v 'docs/decisions/LEXICON.md' \
  | grep -v 'node_modules/' || true)
if [ -n "$matches" ]; then
  echo "$matches"
  echo "Superseded doctrine or a retired brand resurfaced in a living document."
  fail=1
fi

# --- Retired ecosystem brands (LEXICON §6.3) --------------------------------
# Word-bounded, case-insensitive dead-brand motifs from the signed Lexicon
# map. Exclusions are the historical registers the map lists in §6.2, file by
# file.
matches=$(grep -rniE '\brumble\b|\bbolt\b|\bwrench\b|\bgear\b|\bportal\b|\bcos-matic\b|\bcosmatic\b' \
  --include='*.md' . \
  | grep -v 'docs/reviews/' \
  | grep -v 'node_modules/' \
  | grep -v 'docs/adr/0008-' \
  | grep -v 'docs/decisions/LEXICON.md' \
  | grep -v 'docs/decisions/DECISION-REGISTER.md' \
  | grep -v 'docs/architecture/DETAILED-TARGET.md' \
  | grep -v 'docs/transformation/G0-FREEZE-EVIDENCE.md' \
  | grep -v 'docs/transformation/REPOSITORY-MAP.md' \
  | grep -v 'docs/transformation/PROGRAM.md' \
  | grep -vE '^(\./)?vision\.md:' || true)
if [ -n "$matches" ]; then
  echo "$matches"
  echo "A retired ecosystem brand resurfaced in a living document (LEXICON §6.1)."
  fail=1
fi

if [ "$accepted" -eq 0 ] || [ "$cited" -eq 0 ]; then
  echo "Doctrine governance examined nothing: ${#adr_files[@]} ADR file(s), $accepted accepted from 0008, $cited register citation(s)"
  exit 1
fi
if [ "$fail" -ne 0 ]; then
  echo "Doctrine governance failed."
  exit 1
fi
echo "Doctrine governance verified: ${#adr_files[@]} ADR file(s), $accepted accepted from 0008 checked for Arbitrage and invariant, $cited register ADR citation(s) resolved, 2 deny-lists clean"
