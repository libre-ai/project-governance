<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-minor-reservations

# Retrait des exemptions `p02-api` du workflow Inventory drift : revue

**Date :** 2026-11-23
**Objet :** le retrait de deux entrées devenues sans objet quand `libre-ai/personal-knowledge-workspace#54` a retiré `apps/p02-api` de l'arbre :
- `apps/p02-api/test/pg.ts`, règle `unsafe-call`, dans `ecosystem/sql-construction-allowlist.v1.yaml` ;
- `apps/p02-api/src/main.ts`, dans `servers_outside_surfaces` de `ecosystem/web-headers-allowlist.v1.yaml`.

**Nature :** dossier de revue d'une pull request écrite par un agent, sur la consigne « Go all reste à faire » du propriétaire du 2026-11-23. La consigne ne tranche pas ces retraits un à un. Ce dossier rend compte de la relecture qui les a examinés, et ne vaut pas arbitrage du propriétaire.

**Rôle :** une seule passe de revue, faite par un sous-agent à contexte neuf, en lecture seule. Il n'a pas écrit ce qu'il relit et n'a pas reçu les conclusions de l'auteur.

## La passe

| Passe | Commit relu | Verdict |
| --- | --- | --- |
| 1 | `4a72bdb29cd9108e9bb90be3df591b2431d08ccc` | `APPROVE-WITH-MINOR` |

| Question | Constat de la passe |
| --- | --- |
| Les chemins ont-ils disparu de PKW ? | Oui, par deux instruments :<br>- `contents/apps/p02-api` rend 404 ;<br>- l'arbre complet de la branche servie (`19d4216`, non tronqué, 396 entrées) n'a aucun chemin `p02-api` ou `p02_api`. |
| Le code a-t-il été déplacé ailleurs, avec un besoin d'exemption ? | Non :<br>- PKW #54 supprime les 10 fichiers de `apps/p02-api/` et n'ajoute aucun source ;<br>- à la tête de la PR, les gates impriment `24 raw-SQL construction site(s) found, 24 covered … 0 not` et `9 web surface(s) = 7 conformant + 2 exempted … + 0 violating`. |
| Une autre référence à `p02-api` reste-t-elle, que lit un gate ? | Non, ni à la tête de la PR ni sur la branche servie : les deux seules occurrences sont les lignes retirées. La fusion se fait sans conflit (`git merge-tree` rc 0). |
| CI | `Index freshness and GitHub reconciliation` passe au vert : `SQL construction verified: 32 assertion(s) hold`, `Web headers verified: 39 assertion(s) hold`. Seul `check-review-evidence` reste rouge ; ce dossier existe pour le lever. |

## Réserve mineure, hors du diff

`docs/adr/0063-*.md` (lignes 42, 47, 53 et 67) cite `apps/p02-api` à un sha épinglé de PKW (`7416b6c`). Depuis PKW #54, la ligne 47 (« son retrait de l'arbre n'est pas décidé ») n'est plus vraie au présent. C'est de la prose d'ADR, qu'aucune liste d'exemption ne lit. Il faut la remettre à jour avant l'acceptation d'ADR-0063. Ce point n'est pas traité ici.

## Non relu

Ce dossier lui-même n'a été relu par aucune passe.

Une autre PR, #294, retire du même fichier `web-headers-allowlist.v1.yaml` les entrées du Notebook (section `allowances`). Ses blocs sont disjoints de ceux-ci et elle n'a pas été relue ici.
