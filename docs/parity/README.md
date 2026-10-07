# Benchmark-parity initiative — artifacts

Durable home for the benchmark-parity initiative (owner reframe 2026-07-22:
each product/service CDC must reach at least parity with a named best-in-class
benchmark). Charter: `docs/transformation/BENCHMARK-PARITY-INITIATIVE.md`.
Standing decisions (souverain-compatible posture, collab-temps-réel-first) are
in the `libre-ai-benchmark-parity` memory. These files were produced by the
parity audit agents and moved out of ephemeral scratch into git so they survive
across sessions. **They are research + DRAFTS for owner review — not locked
specs.**

## audits/ — benchmark parity audits (8 products)

**Statut de calibrage (2026-08-18, ADR-0027) :** les huit audits mesurent
tous une spec, jamais du code livré — requalifiés « spec-baseline, non
opposable » jusqu'à ré-exécution. Aucun `promotion_criteria`/`kill_predicate`
de fiche produit ne peut s'appuyer sur eux avant cette ré-exécution ni avant
le jalon dogfooding du produit ; la cible v1 opposable est le MVP que chaque
audit recommande lui-même (ex. Radar : 32/105, pas les 70/105 que sa fiche
fixe aujourd'hui), l'étalon complet devenant l'horizon `proven`. Voir
`docs/adr/0027-parity-gates-fire-only-after-dogfooding.md`.

| File                               | Product → benchmark             | Parité              |
| ---------------------------------- | ------------------------------- | ------------------- |
| `PARITY-notebook-siyuan.md`        | Notebook → SiYuan               | 29/143              |
| `PARITY-radar-inoreader.md`        | Radar → Inoreader               | 32/105              |
| `PARITY-boussole-voxe.md`          | Boussole → VAA (Voxe/Smartvote) | 32/58               |
| `PARITY-practices-datacamp.md`     | Practices → DataCamp            | 35/62               |
| `PARITY-agents-multica.md`         | Missions/Polaris → Multica      | 24/36 (+8 dépassés) |
| `PARITY-sessions-miro.md`          | Sessions → Miro/Mural           | 16/62               |
| `PARITY-specstudio-notion.md`      | Spec-Studio → Notion/Linear     | 20/75               |
| `PARITY-modelpolicy-registries.md` | Model-Policy → HF/OpenRouter    | 18/68               |

Each: feature inventory → COUVERT / ABSENT-T1 / T2 / CONFLIT(non-goal) / DÉPASSÉ,
plus tiered amendment proposals. T1 = sovereignty-compatible core parity =
candidate CDC amendments (owner-signed).

## draft-specs/ — new/elevated CDC drafts (owner review pending)

- `DRAFT-SPEC-agent-board.md` — the undocumented reserved app (couche-2 fleet
  board; benchmark Multica + Linear).
- `DRAFT-SPEC-memory.md` — Polaris memory service (benchmark Letta/Mem0/Zep;
  K1/K2/K3 invariants).
- `DRAFT-SPEC-source-ingestion.md` — Sessions' `AttachSource` capability
  (owner decision 2026-08-18 to reopen the design after the 2026-07-30
  retirement of its Rust predecessor); topology, contract and K2/K3
  neutralization boundary, plus a module-by-module reuse verdict on the
  retired history.
- `DRAFT-SPEC-ui.md`, `DRAFT-SPEC-auth-web.md` — layer-4 bricks elevated
  (Radix/shadcn ; Auth.js/Ory).
- `DRAFT-SPEC-provenance-proof.md`, `DRAFT-SPEC-envelope.md` — layer-3 trust
  bricks elevated (SLSA/Sigstore ; prompt-injection defenses). Both DÉPASSÉ vs
  benchmark on the structural approach.

## design/ — sovereign real-time collaboration

- `DESIGN-collab-v2-signable.md` — **owner-signed** design: CRDT (Loro) + E2EE
  **MLS (RFC 9420, OpenMLS)** + self-hosted ciphertext relay. Fixes the v1 key-
  derivation flaw. Carries the 3 CDC amendment surface (Sessions/Notebook/
  Specifications). **Next action: apply those 3 amendments** (spec-lock is
  structural — editable). First E2EE merge = ADR-0011 D4 hard-stop.
- `DESIGN-sovereign-realtime-collab.md` — v1 (superseded by v2; kept for the
  non-goal-coexistence + landing-plan sections).

## Pre-freeze feature maps — forgotten

The mined legacy feature maps were Dojo-stage proofs describing Dioxus interfaces,
mostly LESS complete than current specs, and one of them carried a claim ADR-0015
recorded as false. They were evicted on 2026-07-28 (ADR-0019, entry
`forgotten.legacy-reference-parity`). The bar is the industrial benchmarks above.

## Resume order (next session)

1. Apply the collab-RT v2 amendments to the 3 CDCs (`design/DESIGN-collab-v2-signable.md`).
2. Promote the `draft-specs/` into real reviewable specs (agent-board, memory first).
3. Produce the T1 amendment PRs per audited product.
