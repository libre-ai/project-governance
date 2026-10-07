# Rapport d'évidence — vague 0 (2026-07-19)

Première itération publique du traceur (ADR-0009 §7) : la forge se documente elle-même. Ce rapport est de l'évidence, jamais une autorité (`docs/README.md`).

## Livrables de la vague, avec références vérifiables

| Livrable                                                                                                | Référence                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doctrine cible ratifiée (constellation-portefeuille, méthode, deux lois, noyau sécurité)                | ADR-0008 (PR #110), ADR-0009 (PR #117), invariants I-01..I-20                                                                                                                                     |
| Autorité de séquencement (goals des vagues 0-4)                                                         | PR #118, `docs/transformation/EXECUTION-SEQUENCING.md`                                                                                                                                            |
| `main` = vérité courante seule — control plane                                                          | `constantin-jais/constantin-jais` PR #115 : 314 fichiers retirés, préservés sous le tag `archive/pre-constellation-2026-07-19`, gate inversée (les strates retirées ne peuvent plus réapparaître) |
| Inventaire machine-lisible + drift bidirectionnel                                                       | PR #119, `ecosystem/repositories.v1.yaml`, workflow `Public truth drift`                                                                                                                          |
| Carte d'autorité documentaire + décomposition de `vision.md` (2059 → 543 lignes, déplacements verbatim) | PR #120, `docs/README.md`, `DETAILED-TARGET.md`, `TOOLCHAIN.md`, `PROGRAM.md`                                                                                                                     |
| Publication d'évidence (ce dossier)                                                                     | ce rapport + `gate-acceptance-log.md`                                                                                                                                                             |

## Engagements de préservation (archives détenues par le propriétaire)

Les contenus retirés de GitHub restent intégralement détenus hors ligne ; leurs empreintes engagent publiquement leur intégrité sans en exposer le contenu :

```
SHA256(mirrors 2026-07-19 / SHA256SUMS)  = 5893fd208072973909e3c8a4a917ff5b2715b4d2eb4168e6741f90d7b300e263
SHA256(metadata 2026-07-19 / SHA256SUMS) = 8c2db63220c9705a807710241625b4044885825dd15c3a6745dc4aa80227d9ad
SHA256(socle-unmerged-branches.bundle)   = a3577a6f84cc48c7900a51cb059364374e907d282398d633273f6eb8f310d03a
SHA256(key-remediation patch)            = 2301b6f155939e0d200e23f629216c0b3764342bea090dffbd4bf167b05c77f2
```

## Gate de sortie — test de l'agent froid

Protocole : une session d'agent neuve, munie du seul chargeur canonique (pointeurs, zéro doctrine), répond à cinq questions de topologie, décompte, statut, autorité et frontière méta.

**Verdict : 4/5 sans ambiguïté ; la 5ᵉ a rempli exactement le rôle du test.** L'agent a correctement désigné l'inventaire comme source du décompte — et y a lu « 8 produits » parce que l'entrée `agent-board` portait un champ `product:` en contradiction avec l'ADR-0009 §2 (sept produits ; Missions = application de la couche 2). L'ambiguïté a été corrigée le jour même dans l'inventaire (`application:` + note), par le commit qui publie ce rapport. Les quatre autres réponses (topologie moyeu + 4 couches ; statut `frozen-until-wave-4` de feed-radar et ses lois d'activation ; doctrine = registre exclusivement, un document hors registre est nul ; une décomposition du control plane n'est pas une autorité produit et ne se mute pas) sont conformes au registre, sources exactes citées.

**Gate de sortie de la vague 0 : ATTEINTE** — zéro document vivant ne contredit la cible (gates CI en service), l'évidence est publiée et accessible anonymement, le test de l'agent froid passe après correction de l'unique ambiguïté qu'il a lui-même détectée.
