<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-minor-reservations

# Entrées périmées de `apps/p02-api` dans deux listes d'autorisation : revue

**Date :** 2026-11-23
**Objet :** le retrait, par la pull request #295, de deux entrées qui visaient `libre-ai/personal-knowledge-workspace` `apps/p02-api` : `apps/p02-api/test/pg.ts` (`unsafe-call`, `count: 5`) dans `ecosystem/sql-construction-allowlist.v1.yaml`, et `apps/p02-api/src/main.ts` (`servers_outside_surfaces`) dans `ecosystem/web-headers-allowlist.v1.yaml`.
**Nature :** dossier de revue d'une pull request écrite par un agent sur la consigne « Go all reste à faire » du propriétaire (2026-11-23). Cette consigne ne tranche pas ces entrées. Ce dossier rend compte de la passe qui les a examinées et ne vaut pas arbitrage du propriétaire. La fusion reste au propriétaire (ADR-0068 D2 exclut les données à la racine d'`ecosystem/`).
**Rôle :** une seule passe de revue, en mode `candidate-integration`, faite en lecture seule par un sous-agent à contexte neuf. Ce sous-agent n'a pas écrit ce qu'il relit et n'a pas reçu les conclusions de l'auteur.

## La passe

| Passe | Commit relu | Base (`git merge-base`) | Verdict |
| --- | --- | --- | --- |
| 1 | `ef578bf3226bedaf658a307a3df0f52fd96641c5` | `70fb8fafef5ae77037cea2dcf41c83adfe66a5f9` | `approve-with-minor-reservations` |

La branche servie de `personal-knowledge-workspace` relue est `migrate/recover-code`, de tête `19d4216595cfae1ab916f437c2167dda13a74ad3`.

| Question | Mesure de la passe |
| --- | --- |
| Les deux fichiers ont-ils disparu ? | Oui, établi par deux instruments. `git ls-tree -r HEAD --name-only -- apps/p02-api` sur un clone renvoie 0 entrée. `gh api repos/…/contents/<chemin>` sans `?ref=` répond 404 pour les deux fichiers. Le retrait vient de `19d4216 chore: retire the apps/p02-api Bun server from the tree (#54)`. |
| Reste-t-il des références périmées ? | `git grep -n p02-api` au commit relu ne trouve que 4 lignes, toutes en prose dans `docs/adr/0063-…`, et épinglées à un sha qui résout. Aucun gate ne les lit. Les 3 autres entrées PKW des deux listes visent des fichiers présents à la tête de PKW. |
| Les gates passent-ils à la cible et échouent-ils sur la base ? | Sur la base : `check-sql-construction` rc=1 (`stale allowance`, 1 assertion sur 32 en échec) et `check-web-headers` rc=1 (`stale declaration`, 1 sur 40). À la cible : rc=0, 32 et 39 assertions tenues, 0 site non couvert, 0 surface en infraction. En CI, le job « Index freshness and GitHub reconciliation » est vert au commit relu (run `45252154965`). |
| Le retrait relâche-t-il un garde-fou ? | Non : une entrée retirée retire une autorisation. Si le code revient sous le même chemin, les gates rougissent, et c'est le rouge voulu. Les entrées étant filtrées par dépôt, aucun autre dépôt n'est touché. |
| La description est-elle exacte ? | Oui, à une réserve près : la commande de retour arrière supposait une fusion par commit de merge. |

## Constats

| Gravité | Disposition | Constat | Suite |
| --- | --- | --- | --- |
| minor | suggestion | La description donnait `git revert -m 1 <merge commit>` comme retour arrière. Après un squash, `-m 1` échoue : c'est `git revert <sha>` qui s'applique. | Description corrigée : les deux formes sont données. |
| non-blocking | ready | `docs/adr/0063-…:47` dit encore que le retrait de `p02-api` n'est pas décidé. C'est une citation datée et épinglée, hors du périmètre de cette pull request. | Non traité ici. |

Aucun constat `blocking` ni `major`.

## Non relu

- La passe a rejoué les gates avec Bun 1.4.4-canary, alors que la CI épingle 1.4.0-canary.1. Le job CI au commit relu est vert de son côté.
- La cause du rouge des sept autres pull requests n'a été lue que sur #279. Pour les six autres, seul le statut du job a été vu.
- Ce dossier et la correction de la description n'ont été relus par aucune passe.
