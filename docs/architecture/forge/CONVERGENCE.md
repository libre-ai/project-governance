<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Libre-AI Forge — Unknowns & Convergence

## KnownUnknown

Purpose:
convert vague uncertainty into a bounded object.

```yaml
known_unknown:
  id:
  question:
  affects: []
  blocking: false
  resolution:
    type: targeted_search|experiment|decision|external_input
  status: open|resolving|resolved|invalidated
  evidence_refs: []
```

## Unknown rules

Invalid:
- "need to understand architecture better"

Valid:
- "need to know whether package B calls API X before changing signature"

Every new context expansion must reference:
- a KnownUnknown ;
- or a direct acceptance/eval failure.

## ConvergenceContract

```yaml
convergence:
  repeated_finding_limit: 2
  max_scope_growth_ratio: 0.20
  max_repair_cycles_without_severity_reduction: 2
  unknowns_must_not_grow_without_new_evidence: true
  assess_blocking_findings_by_severity_and_evidence: true
  candidate_required_before_phase_exit: true
```

## Metrics

- open unknowns ;
- blocking findings ;
- repeated findings ;
- repair cycles ;
- retry density ;
- scope growth ;
- candidate latency ;
- evidence growth ;
- acceptance pass rate.

## Escalation order

1. targeted experiment ;
2. narrow context expansion ;
3. deduplicate/defer non-blocking findings ;
4. structured Decision ;
5. block/replan impacted subgraph.

Never:
- generic "analyze repository again".

## Interpretation and refusal boundaries

Thresholds above are illustrative, not universally qualified defaults. A scope ratio needs a declared baseline and unit; changing either requires a versioned decision. Newly evidenced critical findings may increase the count without indicating regression. Track severity and acceptance impact, not only totals.

A convergence alert triggers a bounded experiment or a decision. It never authorizes hiding findings, weakening acceptance, broadening permissions or falsely marking work complete. Deferral is allowed only when acceptance and safety remain satisfied, with reason and accountable authority recorded.
