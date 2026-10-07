# Les preuves — comment chaque affirmation se vérifie

Loi d'exposition (invariant I-15) : rien n'est mis en vitrine qui ne soit vérifiable. Ce document est le mode d'emploi de cette loi pour un tiers — humain ou agent : pour chaque type d'affirmation, l'artefact qui la porte et la commande ou le chemin qui la vérifie. Les chiffres défavorables sont publiés au même titre que les autres : l'honnêteté est le positionnement.

## Table de correspondance

| Type d'affirmation                                                     | Artefact                                                                                                                                                                             | Vérification                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| « Les fondations tiennent depuis un checkout vierge »                  | [`verification/harness/reference-chain.ts`](../../verification/harness/reference-chain.ts) + [évidence publiée](../../verification/harness/wp-g2-q01-reference-chain-evidence.md)    | `bun verification/harness/reference-chain.ts` — digest attendu `f45dfad0…` (détail ci-dessous)                    |
| « Chaque gate franchie est traçable »                                  | [`distribution/evidence/gate-acceptance-log.md`](../../distribution/evidence/gate-acceptance-log.md)                                                                                 | chaque ligne porte sa référence : pull request, SHA, ADR ou candidat immuable                                     |
| « La couverture d'automatisation est mesurée, pas déclarée »           | [`distribution/evidence/coverage-metrics.ts`](../../distribution/evidence/coverage-metrics.ts) + [instantané 2026-07-22](../../distribution/evidence/coverage-2026-07-22.json)       | `bun distribution/evidence/coverage-metrics.ts libre-ai/libre-ai` depuis un clone                                 |
| « La parité face au meilleur du marché est auditée, déficits compris » | [`docs/parity/audits/`](../parity/audits) — 8 audits produit → benchmark nommé                                                                                                       | lecture ; chiffres réels reproduits ci-dessous, y compris défavorables                                            |
| « Les contrats sont verrouillés et conformes »                         | [`contracts/`](../../contracts) (catalogue [`catalog.v1.json`](../../contracts/catalog.v1.json), schémas, vecteurs golden)                                                           | `bun run check:contracts` puis `bun run check:generated-contracts`                                                |
| « La topologie publique est machine-lisible et sans dérive »           | [`ecosystem/repositories.v1.yaml`](../../ecosystem/repositories.v1.yaml) (autorité) → [`distribution/index/repositories.v1.json`](../../distribution/index/repositories.v1.json)     | `bun ecosystem/build-index.ts` puis `git diff` (index déterministe) ; gates CI `inventory-drift` et `truth-drift` |
| « Chaque produit est un pari falsifiable, pas une conviction »         | champs `hypothesis` / `evidence_required` / `promotion_criteria` / `kill_predicates` de l'inventaire                                                                                 | `grep -A4 "kill_predicates" ecosystem/repositories.v1.yaml` ; statut ci-dessous                                   |
| « Aucun secret commité, aucune revendication de production »           | [`tools/quality/check-secret-scan.ts`](../../tools/quality/check-secret-scan.ts), [`tools/quality/check-no-clever-production.ts`](../../tools/quality/check-no-clever-production.ts) | `bun tools/quality/check-secret-scan.ts` ; `bun tools/quality/check-no-clever-production.ts`                      |
| « Licences et provenance sont vérifiables fichier par fichier »        | [`REUSE.toml`](../../REUSE.toml), [`LICENSING.md`](../../LICENSING.md), DCO par commit                                                                                               | `reuse lint` (check CI requis « Licensing ») ; trailer `Signed-off-by` sur chaque commit                          |

## La chaîne de référence

Le harness [`verification/harness/reference-chain.ts`](../../verification/harness/reference-chain.ts) exécute dix étapes ordonnées (contrats, projections générées, plateforme web Bun + React, autorisation Biscuit, mondes WIT, crates proof/artifact, scan de secrets, non-revendication de production, barrière RLS deux-tenants, e2e Playwright trois moteurs) et émet un rapport JSON dont le digest est un SHA-256 sur les seules paires ordonnées `étape:statut` — les durées, volatiles, en sont exclues pour que l'évidence se reproduise octet pour octet.

Quand les dix étapes passent, le digest est recalculable à la main, sans exécuter le harness :

```console
printf 'contracts:passed\ngenerated-contracts:passed\nweb-react:passed\nbiscuit:passed\nwit:passed\nproof-artifact:passed\nsecret-scan:passed\nno-clever:passed\nrls:passed\nplaywright:passed' | shasum -a 256
```

Résultat attendu : `f45dfad03581f3d56ea53ca74a7b9ac3034ef7ce7013eebe6eac71cc3959a89f` — le digest de l'[évidence publiée du 2026-07-20](../../verification/harness/wp-g2-q01-reference-chain-evidence.md). Limite affichée : le rapport est ancré par digest, **pas signé cryptographiquement** — la signature attend la brique provenance (vague 2, aucune cérémonie de clés autorisée à ce jour).

## Le journal des verdicts de gates

[`distribution/evidence/gate-acceptance-log.md`](../../distribution/evidence/gate-acceptance-log.md) journalise chaque verdict — acceptations, amorçages prononcés, auto-merges sur revue propre, et aussi les rejets initiaux de revue (REJECT puis remédiation) et les arrêts durs respectés. Ce journal est de l'évidence, jamais une autorité : il prouve, il ne décide pas ([`distribution/evidence/README.md`](../../distribution/evidence/README.md)).

## Les audits de parité

Huit produits sont audités trait par trait contre un benchmark best-in-class nommé ([`docs/parity/README.md`](../parity/README.md), audits du 2026-07-22). Chaque trait est classé COUVERT / ABSENT-T1 / T2 / CONFLIT (non-objectif assumé) / DÉPASSÉ. L'état réel, déficits compris :

| Produit → benchmark                                                                         | Traits couverts     |
| ------------------------------------------------------------------------------------------- | ------------------- |
| [Notebook → SiYuan](../parity/audits/PARITY-notebook-siyuan.md)                             | 29/143              |
| [Radar → Inoreader](../parity/audits/PARITY-radar-inoreader.md)                             | 32/105              |
| [Boussole → VAA (Voxe/Smartvote)](../parity/audits/PARITY-boussole-voxe.md)                 | 32/58               |
| [Practices → DataCamp](../parity/audits/PARITY-practices-datacamp.md)                       | 35/62               |
| [Missions/Polaris → Multica](../parity/audits/PARITY-agents-multica.md)                     | 24/36 (+8 dépassés) |
| [Sessions → Miro/Mural](../parity/audits/PARITY-sessions-miro.md)                           | 16/62               |
| [Spec Studio → Notion/Linear](../parity/audits/PARITY-specstudio-notion.md)                 | 20/75               |
| [Model Policy → registres HF/OpenRouter](../parity/audits/PARITY-modelpolicy-registries.md) | 18/68               |

Statut affiché : ces audits sont de la recherche et des brouillons pour revue propriétaire — pas des spécifications verrouillées. Le benchmark est une **cible** enregistrée dans l'inventaire, jamais une revendication de parité atteinte ; le déficit est suivi séparément.

## La conformance des contrats

Le catalogue d'autorités verrouillé ([`contracts/catalog.v1.json`](../../contracts/catalog.v1.json)) se vérifie par `bun run check:contracts` : entrées du catalogue, paires schéma-fixture, opérations HTTP, et l'intégralité des vecteurs golden des moteurs (orchestration d'agents, policy-core, radar, notebook, boussole — cas nominaux, bornes et refus). `bun run check:generated-contracts` vérifie que les projections TypeScript générées sont conformes octet pour octet aux schémas.

## L'index machine

[`distribution/index/repositories.v1.json`](../../distribution/index/repositories.v1.json) est la projection JSON déterministe de l'inventaire autoritaire [`ecosystem/repositories.v1.yaml`](../../ecosystem/repositories.v1.yaml) : mêmes faits, ordre de champs stable, tri par nom, aucun timestamp d'exécution — le fichier commité ne change que quand l'inventaire change, et un diff de régénération en CI est un signal de dérive, jamais du bruit. Régénération : `bun ecosystem/build-index.ts`.

## La falsifiabilité par produit

Chaque produit de couche 1 et l'application de couche 2 portent dans l'inventaire quatre champs qui en font un pari testable : `hypothesis` (le pari réfutable), `evidence_required` (les artefacts exigés pour juger), `promotion_criteria` (paires `to`/`when` sur l'échelle d'exposition) et `kill_predicates` (prédicats machine-évaluables dont la vérification déclenche une revue propriétaire d'abandon — jamais un kill automatique : c'est un point de la surface à touche humaine).

Statut affiché : les 10 blocs portent `criteria_status: owner-ratified` dans [`ecosystem/repositories.v1.yaml`](../../ecosystem/repositories.v1.yaml) — dérivés des audits de parité et des cahiers des charges verrouillés, puis ratifiés par arbitrage propriétaire. Ces critères engagent donc la promotion et l'abandon ; ce sont des engagements, pas des propositions. La bascule de ce champ est un acte propriétaire : un critère ramené à `draft-pending-owner` redevient une proposition.
