# Parity Audit: Model Policy vs. HuggingFace + OpenRouter

> **Statut de calibrage (2026-08-18, ADR-0027) :** cet audit mesure la
> **spec** du produit, pas son code livré — requalifié **« spec-baseline,
> non opposable »** jusqu'à ré-exécution contre du code réellement livré.
> Les chiffres de couverture restent un inventaire de traits utile, mais ne
> peuvent fonder aucun `promotion_criteria`/`kill_predicate` de fiche
> produit avant cette ré-exécution ni avant que le jalon dogfooding du
> produit soit atteint. Voir
> `docs/adr/0027-parity-gates-fire-only-after-dogfooding.md`.

**Scope:** Model metadata registry + eligibility evaluation — compare Model Policy spec against benchmarks.
**Date:** 2026-07-22 | **Evidence:** Deep research via web + spec cross-reference.

## Benchmark Inventory: HuggingFace + OpenRouter Features (65+ mapped)

### Model Card Metadata (HF)
1. Model ID/slug | 2. Model name | 3. Description | 4. Intended use | 5. Model type
6. License (SPDX code) | 7. Author/creator | 8. Organization | 9. Creation date | 10. Last update date
11. Base model reference | 12. Fine-tuned from | 13. Model size (parameters) | 14. Model format (PyTorch, TF, ONNX, SafeTensors)
15. Quantization options | 16. Inference framework | 17. Transformers version | 18. Context window length

### Training & Evaluation
19. Training data (linked datasets) | 20. Preprocessing/postprocessing docs | 21. Training compute (FLOPs) | 22. Training tokens
23. Evaluation metrics (accuracy, F1, BLEU, etc.) | 24. Benchmarks | 25. Benchmark scores side-by-side | 26. Papers/citations
27. Dataset licenses | 28. Training data filtering/curation notes

### Safety & Limitations
29. Known limitations | 30. Bias disclosures | 31. Ethical considerations | 32. Recommended uses | 33. Out-of-scope uses
34. Mitigation strategies | 35. Safety filters/rating | 36. Responsible AI statement

### Content & Discovery
37. Tags/keywords | 38. Language support | 39. Capabilities (vision, audio, tool-use, reasoning)
40. Compatibility flags (LoRA, quantization) | 41. Model versioning/tags | 42. Related models
43. Model lineage (base → FT → FT) | 44. Download statistics/trending | 45. Popularity score

### Provider & Hosting (OpenRouter)
46. Hosting provider (HF, Together.ai, Replicate, local, etc.) | 47. Model availability (API, download, local)
48. API endpoint specification | 49. Inference latency/throughput | 50. Cost per token (input/output)
51. Rate limits | 52. Free tier availability | 53. Context window limit | 54. Max completion length
55. Provider routing (OpenRouter auto) | 56. Multi-provider access | 57. Failover/fallback

### Licensing & Restrictions
58. Model redistribution (allowed/restricted) | 59. Commercial use (allowed/restricted)
60. Training data redistribution | 61. Fine-tuning allowed (yes/no) | 62. Fair use policy
63. Citation requirement | 64. Vulnerability disclosures

### Analytics & Comparison
65. Usage statistics | 66. Cost calculator | 67. Model comparison tool | 68. Benchmark leaderboard

## Parity Matrix

| Section | COUVERT (Spec ✓) | ABSENT-T1 (Core Policy) | ABSENT-T2 (Extended) | CONFLIT (Non-Goal) |
|---------|----------|------|------|--------|
| **Policy Rules** | Rules + sourced facts, deterministic eval, deny-by-default | License compat matrix, compute class, fine-tuning disclosure | Advanced operators (date >), weighted scoring | Leaderboard; routing |
| **Model Snapshot** | Versioned immutable, provenance/license validation, source cite | Training data audit trail, safety filter flag, jurisdiction sourced | Lineage graph, eval diff, throughput benchmark | Scraping cards |
| **Eligibility Eval** | Deterministic (policy + need + snapshot → eligible/ineligible/indeterminate), trace failed rules | Safety rule integration, jurisdiction rule (e.g., "hosting_region not in [eu, self-hosted]") | Pricing rules, throughput SLA | Procurement automation |
| **Export & Replay** | Export need/policy/snapshot/result hashes, replay with same engine version | Structured trace (JSON: rules, evidence, why indeterminate), audit log (who, when, need) | Result versioning, snapshot freshness warning | Network calls during eval |
| **Source Adaptation** | Source adapter (HF, OpenRouter, CSV), validates provenance/license, freezes | Multi-source merge (HF + OpenRouter + custom), conflict resolution, deprecation marker | Refresh schedule, version pinning, change tracking | Routing |
| **Accessibility** | Policy diff, verdict, trace are tables/lists, keyboard/screen-reader | Explanation template (machine-to-human), citation rendering (source + quote), rule clarity | Documentation, glossary, inline help | N/A |
| **Determinism & QA** | Byte-exact decoder, ceiling+1 refusals, golden vectors (Rust WASM), property tests (order-independent) | Engine version metadata in result, test vectors per operator, unknown-path golden suite | Regression suite, chaos test, mutation testing | N/A |

## Coverage Counts

| Metric | Count |
|--------|-------|
| **Total benchmark features** | 68 |
| **COUVERT in Model Policy spec** | 18 |
| **Absent-T1 (core policy)** | 7 |
| **Absent-T2 (extended)** | 8 |
| **CONFLIT (spec non-goals)** | 4 |

## Tier 1 Amendments (Core Policy Required)

1. **License Compatibility Rule** — Sourced fact: model license (SPDX). Rule: `license IN ["Apache-2.0", "MIT", "CC0-1.0"]`. Unknown = indeterminate. Amendment: `model.licenseId: string` field; `license_in(allowlist)`.

2. **Training Compute Classification** — Sourced fact: `trainingFLOPs: number | null`. Rule: `training_flops < 1e20`. Unknown = indeterminate per policy. Amendment: Snapshot field, eval trace shows unknown path.

3. **Fine-Tuning Disclosure** — Sourced fact: `finetuningAllowed: boolean | "unknown"`. Rule: `finetuning_allowed == true`. Amendment: Field in snapshot, operator `finetuning_eq(true|false|unknown)`.

4. **Provider Jurisdiction/Region** — Sourced fact: `hostingRegion: enum ["self-hosted", "eu", "us", "asia", "unknown"]`. Rule: `region_in(["eu", "self-hosted"])`. Amendment: Snapshot field, enum closed, operator `region_in(allowlist)`.

5. **Safety Filter Status** — Sourced fact: `safetyFilterStatus: enum ["present", "absent", "unknown"]`. Rule: `safety_filter_in(["present", "unknown"])`. Amendment: Field in snapshot, operator.

6. **Sourced Fact Audit Trail** — Each fact carries: source URL, fetch date, checksum (detect drift). Immutable once frozen. Amendment: Snapshot schema `facts: Array<{key, value, sourceUrl, fetchedAt, sourceChecksum}>`.

7. **Rule Trace Output** — Evaluation includes: per rule, (rule-id, result: pass/fail/unknown, evidence: facts checked, verdict basis). Amendment: Policy Evaluation v2 schema `ruleTraces: Array<{ruleId, result, evidenceRefs}>`.

8. **Unknown Handling Policy Explicit** — Policy specifies: for each unknown rule, block (indeterminate) or pass (assume OK). Immutable with policy version. Amendment: `unknownBehavior: "block" | "pass"` per rule.

## Tier 2 Amendments (Extended)

- **Training Data Audit Trail** — Datasets used (HF IDs), tokenizer, filtering, reproducibility. Informational only.
- **Model Lineage Graph** — Track base → FT → FT. Snapshot includes parent refs. Evaluate entire lineage.
- **Evaluation Diff** — Compare two snapshots: which benchmarks changed? which policies differ? Informational.
- **Throughput/Latency Info** — Snapshot includes latency (p50/p95), throughput (tokens/sec). T2 operators: `latency_p95 < 100ms`, `throughput > 50`.
- **Snapshot Freshness Warning** — Eval flags: "snapshot is N days old; HF may have updated model". UI warning, not blocker.
- **Cost/Budget Rules** — T2 rule: `cost_per_token < $0.001`. From OpenRouter pricing. Informational (procurement out of scope).

## Key Arbitrages

**Option A: Leaderboard/Ranking** → Reject. Model Policy is deny-by-default, not ranking. Use OpenRouter's tool.
**Option B: Procurement Automation** → Reject. Verdict informs decision; humans/ops choose. No auto-select.
**Option C: Network Calls During Eval** → Reject. Snapshot is immutable input. Refresh separately, eval frozen snapshot.
**Option D: Recursive License Analysis** → Reject. Operates on sourced facts only. Org legal decides recursion.

## Recommended Next Steps

1. Owner confirms T1 amendments (license, compute, fine-tuning, jurisdiction, safety, audit trail, trace, unknown policy). Rejections?
2. Schema finalization: Spec v2 snapshot/policy/evaluation schemas locked + golden vectors passed.
3. Prioritize T1 only in Rust/WASM. T2 info fields can be added in UI without schema breaking change.
4. Security review: RLS (tenant-isolated), no cross-org bleed, snapshot immutability, malformed rejection (ceiling+1 test).
5. Compliance audit: License redistribution (forbidden unless source permits). GDPR/FedRAMP per provider region.
