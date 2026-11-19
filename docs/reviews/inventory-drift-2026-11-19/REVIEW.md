<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-minor-reservations

# Exemptions de `project-website` pour le workflow Inventory drift : revue

**Date :** 2026-11-19
**Objet :** les entrées ajoutées pour `libre-ai/project-website` à `ecosystem/sql-construction-allowlist.v1.yaml` et à `ecosystem/web-headers-allowlist.v1.yaml`, qui ferment les trois constats rouges du workflow « Inventory drift » sur la branche servie.
**Nature :** dossier de revue d'une pull request écrite par un agent sur la consigne « Merge, Push, et go all reste à faire » du propriétaire du 2026-11-19. Cette consigne ne tranche pas ces exemptions une à une : ce dossier rend compte de la relecture qui les a examinées, et ne vaut pas arbitrage du propriétaire.
**Rôle :** une passe de revue seule, faite par un sous-agent à contexte neuf, en lecture seule, qui n'a pas écrit ce qu'il relit et n'a pas reçu les conclusions de l'auteur.

## La passe

| Passe | Commit relu | Verdict |
| --- | --- | --- |
| 1 | `f0ed70dccd7a5588989fa5d6b15f3c29270f9b76` | `ACCEPT-WITH-CHANGES` |

Les trois sites ont été lus sur la branche servie du site : chacun est sûr, chaque `count` est exact (une occurrence par fichier), chaque `because` est vrai.

| Site | Constat de la passe | Suite |
| --- | --- | --- |
| `server/store.ts:47`, `unsafe-call` | Sûr : `sql.unsafe(SCHEMA_SQL)`, où `SCHEMA_SQL` est un gabarit sans interpolation (`server/store.ts:29-44`) ; les quatre requêtes du store sont des gabarits à valeurs liées. Mineur, facultatif : une écriture du DDL en gabarit sans paramètre supprimerait l'appel, non testée. | Exemption gardée. |
| `src/web/gates.ts:39`, `exec-non-constant` | Pas du SQL : `RegExp.prototype.exec` sur un élément de tuple typé `RegExp`, que le scanner ne reconnaît pas (`ecosystem/sql-construction-scanner.ts:307-318`). Mineur : la correction de code est préférable à l'exemption, car aucun des six motifs n'est global et `text.match(pattern)` rend la même chose. | Corrigé dans le site (`libre-ai/project-website#22`) ; l'entrée est retirée de la liste. |
| `src/headers.ts:31`, `csp-header-literal` | Sûr : les 14 directives valent `'self'` ou `'none'`, toutes les réponses passent par `withSecurity`. Mineur, formulation : « every directive is 'self' or 'none' » décrit le code, ce n'est pas une borne ; `src/headers.test.ts` n'épingle que 8 directives. La vraie borne est le `Caddyfile`, que ce gate tient à la base stricte (`strictBaseViolations`) et que `src/caddy-headers.test.ts` exige identique à la table. | `because` réécrit pour citer cette borne en premier. |

## Non relu

Les compteurs des deux gates sur la flotte, rejoués par l'auteur et non par la passe. Ce dossier et les deux changements faits après la passe n'ont été relus par aucune passe.
