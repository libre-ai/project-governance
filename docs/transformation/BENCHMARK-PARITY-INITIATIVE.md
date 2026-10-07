# Benchmark-parity initiative — completing the CDCs to best-in-class

**Ratified in session, 2026-07-22 (owner).** Amends the run-γ objective: the
product target is no longer "reconstruct the locked specs as written" but
"raise each product's locked spec (CDC) to at least benchmark parity with a
named best-in-class reference." The reconstruction (implementation) then aims
at the amended spec. This is a SPEC amendment initiative — each amendment is
owner-signed under the Specification Lock (precedent: ADR-0003 bounded
amendment); the loop produces the dossiers, never the signature.

## Why (finding that triggered it)

Legacy reference apps were mined first (notebook/boussole/radar/practices at
their frozen revisions): they were **Dojo/spec-stage proofs**, mostly LESS
complete than the current locked specs — so "90% features lost" is not a legacy
regression. The real bar the owner holds is **industrial benchmarks**, not the
legacy apps. Hence per-product benchmark-parity audits.

## Benchmark registry (owner-set)

| Produit            | Benchmark (barre)                                   | Note                                                      |
| ------------------ | --------------------------------------------------- | --------------------------------------------------------- |
| Notebook           | **SiYuan** (siyuan-note/siyuan)                     | PKM local-first, blocs/graph/sync                         |
| Radar              | **Inoreader** (inoreader.com)                       | agrégateur pro sources/règles                             |
| Missions + Polaris | **Multica** (multica-ai/multica)                    | plateforme d'agents gérés — couche 2, pas une app produit |
| Boussole           | **VAA** (Voxe / Smartvote / Wahl-O-Mat)             | comparateur civique                                       |
| Practices          | **DataCamp** (interactif)                           | apprentissage scénarisé                                   |
| Sessions           | **Miro / Mural**                                    | facilitation collaborative                                |
| Spec-Studio        | **Notion / Linear** (surface specs)                 | authoring structuré                                       |
| Model-Policy       | **registres modèles** (HF model cards / OpenRouter) | comparaison sourcée                                       |
| Website            | (aucun — projection d'inventaire)                   | —                                                         |

**Ambition (owner): T1 d'abord** — parité-cœur sans conflit de non-goal pour
tous les produits, T2 et arbitrages ensuite.

## Tiering (per audit)

- **T1 Parité-cœur** — feature absente du CDC, aucun conflit non-goal, cohérente
  avec la souveraineté local-first. → candidat direct à l'amendement de spec.
- **T2 Parité-étendue** — surfaces plus lourdes (plugins, intégrations, teams).
- **ARBITRAGE** — la feature benchmark heurte un non-goal verrouillé. Décision
  owner : soit amender le non-goal (avec le trade-off souveraineté), soit
  confirmer l'exclusion. Le loop NE tranche PAS.
- **DÉPASSÉ** — notre spec excède le benchmark (ex. quorums/Biscuit vs Multica).

## Wave-1 results (audits done)

| Produit → benchmark        | Total | Couvert           | T1  | T2  | Conflits/arbitrages                           |
| -------------------------- | ----- | ----------------- | --- | --- | --------------------------------------------- |
| Notebook → SiYuan          | 143   | 29                | 42  | 43  | 29 (6 arbitrages critiques)                   |
| Radar → Inoreader          | 105   | 32                | 38  | 20  | 15 (5 arbitrages)                             |
| Missions/Polaris → Multica | 36    | 24 (16+8 dépassé) | 8   | 2   | 2 arbitrages ; **dépasse sur sécurité/audit** |

### Arbitrages remontés (décisions owner) — wave 1

- **Notebook** : (1) sync cloud E2E, (2) collaboration temps-réel, (3)
  publication publique, (4) RAG-chat du notebook, (5) plugins/marketplace,
  (6) révocation à distance. Tous heurtent des non-goals local-first.
- **Radar** : (A1) archive full-text + résumés IA, (A2) cross-tenant/teams,
  (A3) intégrations webhook, (A4) alertes mots-clés push, (A5) sync OPML.
- **Agents** : (A1) push WebSocket vs pull event-chain audité, (A2) contexte
  agent persistant vs isolation planning-only.

## Wave-2 audits (in flight)

boussole→VAA, practices→DataCamp, sessions→Miro, spec-studio→Notion/Linear,
model-policy→registries.

## Deliverable shape (per product)

`docs/apps/<x>-parity.md` (audit + tiers) committed for review, then an
amendment PR to `docs/apps/<x>.md` adding the T1 journeys/sections (owner
signs). ARBITRAGES batched into one owner decision doc. Implementation (wave
4b) then targets the amended CDC.

## Sequence interaction

This does NOT change C3 (Polaris before 4b) unless the owner also picks
sequence option B (push 1-2 products to full CDC now). Parity amendments make
the wave-4b target richer; they can be prepared entirely now (spec work),
independent of the build sequence.
