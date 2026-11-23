<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-minor-reservations

# Retrait des serveurs de `personal-knowledge-workspace` : revue des listes d'autorisation

**Date :** 2026-11-23
**Objet :** les entrées retirées de `ecosystem/sql-construction-allowlist.v1.yaml` et de `ecosystem/web-headers-allowlist.v1.yaml` par la pull request #293, avec le reste de son diff (gate de composition, exemption de context hygiene, notes datées).
**Nature :** dossier de revue d'une pull request écrite par un agent, après les décisions du propriétaire du 2026-11-23 en chat (« Retirer les deux », « Retirer l'app notebook entière »). Ces décisions retirent les serveurs ; elles ne tranchent pas les entrées une à une. Ce dossier rend compte de la relecture qui les a examinées et ne vaut pas arbitrage du propriétaire.
**Rôle :** une passe `candidate-integration` en revue seule, faite par l'agent auteur, après commit, arbre propre, sans modifier les fichiers relus (`docs/reviews/AGENT-REVIEW-PROTOCOL.md`, règle d'indépendance : le même agent peut faire la passe de revue). Ce n'est pas une passe à contexte neuf : l'auteur connaissait ses propres conclusions. Identifiant de passe `pkw-servers-g-1`, modèle `claude-opus-5-5`.

## La passe

| Passe | Commit relu | Verdict |
| --- | --- | --- |
| `pkw-servers-g-1` | `5cd63fb81e9fc65ca484c7cf4e8504217b52983b` | `approve-with-minor-reservations` |

Aucun contrat ni vecteur n'est touché : pas d'empreinte à relever.

| Surface | Constat | Disposition |
| --- | --- | --- |
| SQL, `apps/p02-api/test/pg.ts`, `unsafe-call` ×5 | Le fichier n'existe plus sur la branche servie de PKW depuis PKW #54 (`19d4216`) : l'entrée était périmée et faisait échouer `check-sql-construction` sur la base. Le retrait resserre la liste, il n'élargit rien. Rejoué sur la flotte vivante : `SQL construction verified: 32 assertion(s) hold`, 24 sites trouvés, 24 couverts. | ready |
| Web headers, serveur déclaré `apps/p02-api/src/main.ts` | Même cause, même effet. Rejoué : `Web headers verified: 39 assertion(s) hold`, 0 surface en violation, 11 serveurs déclarés. Le serveur `tools/qualification/notebook-core-v2/serve.ts` reste déclaré : PKW #55 (tête `05f59a7`) le garde. | ready |
| Web headers, deux entrées de `apps/notebook/src/server/handler.ts` | Gardées ici, à raison : tant que `apps/notebook` est sur la branche servie de PKW, les retirer fait échouer le gate. Leur retrait est la pull request #294, après PKW #55. | ready |
| `check-products.py`, `validate-composition.yml` | Seule la porte `e2e` de PKW (`apps/notebook`) disparaît, et PKW sort des deux étapes navigateur ; la porte `wasm` (`notebook-core-v2/build.ts`) et `NOTEBOOK_QUALIFICATION_NODE` restent, ce que PKW #55 garde. Une demande `e2e` pour PKW est refusée (`No applicable gate`), pas sautée. Tests : 164 OK ; réinsérer l'entrée `e2e` de PKW fait rougir 2 tests, remplacer l'étape `wasm` de PKW par un no-op en fait rougir 2. | ready |
| Context hygiene (script et gabarit réutilisable) | L'exemption visait `docs/reviews/notebook-core-v2/gate-a/a28e116/`. Deux instruments : la recherche de code de l'organisation ne trouve le chemin que dans l'exemption ; l'API d'arbre, sur la branche servie des 24 dépôts non archivés de `libre-ai`, le trouve dans 0 dépôt, 0 illisible. L'exemption ne couvrait plus rien. Mineur : le commentaire du script ajoute « the owner retired the Notebook the same day », alors que ces rapports relevaient de la qualification du cœur, qui reste ; la raison du retrait est le chemin mort, pas la décision. | suggestion |
| Note de `ci.yml`, note de `docs/LOCAL-COMPOSITION.md` | Conformes à PKW #55 : `check:no-transmission` y passe à `apps/desktop/src` (`package.json` de la tête `05f59a7`) ; seule la porte `e2e` est refusée. | ready |

## Risques résiduels

- La fusion de #293 ne change rien pour PKW tant que son épingle d'outillage reste à `a00daec8`. Inversement, PKW #55 reste rouge à `composition / validate` tant que l'épingle ne passe pas à la génération qui porte #293. L'ordre est écrit dans la description de #293.
- `project-website` copie `docs/LOCAL-COMPOSITION.md` dans `src/data/deploy/LOCAL-COMPOSITION.md` ; cette copie n'est pas mise à jour ici.

## Non relu

Les 58 échecs de `bun test`, identiques par nom sur la base et sur ce commit, attribués à l'environnement sans autre analyse. Ce dossier, et tout changement fait après la passe, n'ont été relus par aucune passe.
