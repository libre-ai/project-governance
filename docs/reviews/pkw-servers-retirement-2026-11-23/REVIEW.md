<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-minor-reservations

# Retrait des serveurs de `personal-knowledge-workspace` : revue des listes d'autorisation

**Date :** 2026-11-23
**Objet :** les entrées retirées de `ecosystem/sql-construction-allowlist.v1.yaml` et de `ecosystem/web-headers-allowlist.v1.yaml` par la pull request #293, avec le reste de son diff (gate de composition, exemption de context hygiene, notes datées).
**Nature :** dossier de revue d'une pull request écrite par un agent, après les décisions du propriétaire du 2026-11-23 en chat (« Retirer les deux », « Retirer l'app notebook entière »). Ces décisions retirent les serveurs ; elles ne tranchent pas les entrées une à une. Ce dossier rend compte des relectures qui les ont examinées et ne vaut pas arbitrage du propriétaire. Aucune des deux passes n'est une approbation de promotion par rôle : **not a role-specific promotion approval**.
**Fusion :** `git diff --name-only 70fb8fa...1cae9d1 | bun tools/skills/bounded-merge-scope.ts` sort en code 1 (`examined=10 admitted=1 refused=9`) : la fusion revient au propriétaire (ADR-0068), pas à un agent.

## Les passes

| Passe | Commit relu | Verdict |
| --- | --- | --- |
| `pkw-servers-g-1` | `5cd63fb81e9fc65ca484c7cf4e8504217b52983b` | `approve-with-minor-reservations` |
| `pkw-servers-r-1` | `1cae9d19666fa9a8e8d34be32c12b723bbcf7fde` | `approve-with-minor-reservations` |

Aucun contrat ni vecteur n'est touché : pas d'empreinte à relever.

## Passe `pkw-servers-g-1` (auteur)

**Rôle :** passe `candidate-integration` en revue seule, faite par l'agent auteur, après commit, arbre propre, sans modifier les fichiers relus (`docs/reviews/AGENT-REVIEW-PROTOCOL.md`, règle d'indépendance : le même agent peut faire la passe de revue). Ce n'est pas une passe à contexte neuf : l'auteur connaissait ses propres conclusions. Modèle `claude-opus-5-5` ; session du harnais `c79598a7-9e1e-42cf-bfbc-e29615fbe251`, sous-agent `a12689927fa30d505`.

**Axes couverts :** sécurité (les retraits resserrent les deux listes et l'exemption ; aucune n'est élargie) ; qualité (tests et neutralisations ci-dessous) ; performance (aucun chemin chaud : seule l'étape e2e de PKW disparaît du plan de composition) ; complétude (balayage `p02-api` et `notebook`, notes datées) ; souveraineté et vie privée (aucune dépendance, aucun service, aucune donnée personnelle ajoutés ; le retrait de l'exemption rend au scanner de chemins locaux un chemin qu'il ne voyait plus).

| Surface | Constat | Disposition |
| --- | --- | --- |
| SQL, `apps/p02-api/test/pg.ts`, `unsafe-call` ×5 | Le fichier n'existe plus sur la branche servie de PKW depuis PKW #54 (`19d4216`) : l'entrée était périmée et faisait échouer le gate sur la base. Le retrait resserre la liste. | ready |
| Web headers, serveur déclaré `apps/p02-api/src/main.ts` | Même cause, même effet. Le serveur `tools/qualification/notebook-core-v2/serve.ts` reste déclaré : PKW #55 (tête `05f59a7`) le garde. | ready |
| Web headers, deux entrées de `apps/notebook/src/server/handler.ts` | Gardées ici : tant que `apps/notebook` est sur la branche servie de PKW, les retirer fait échouer le gate. Leur retrait est la pull request #294, après PKW #55. | ready |
| `check-products.py`, `validate-composition.yml` | Seule la porte `e2e` de PKW (`apps/notebook`) disparaît, et PKW sort des deux étapes navigateur ; la porte `wasm` (`notebook-core-v2/build.ts`) et `NOTEBOOK_QUALIFICATION_NODE` restent, ce que PKW #55 garde. Une demande `e2e` pour PKW est refusée (`No applicable gate`), pas sautée. | ready |
| Context hygiene (script et gabarit réutilisable) | L'exemption visait `docs/reviews/notebook-core-v2/gate-a/a28e116/`, qui n'existe plus nulle part. Le commentaire du script donnait pour raison le retrait du Notebook. | suggestion ; corrigée après la passe (voir plus bas) |
| Note de `ci.yml`, note de `docs/LOCAL-COMPOSITION.md` | Conformes à PKW #55 : `check:no-transmission` y passe à `apps/desktop/src` ; seule la porte `e2e` est refusée. | ready |

**Commandes et sorties :**

| Chiffre | Commande | Sortie |
| --- | --- | --- |
| Gate SQL sur la flotte vivante | `bun --no-env-file ecosystem/check-sql-construction.ts`, avec un jeton GitHub en lecture dans `GITHUB_TOKEN` | `SQL construction verified: 32 assertion(s) hold`, 24 sites trouvés, 24 couverts |
| Gate web headers sur la flotte vivante | `bun --no-env-file ecosystem/check-web-headers.ts`, même environnement | `Web headers verified: 39 assertion(s) hold`, 0 surface en violation, 11 serveurs déclarés |
| Tests de composition | `python3 -B -m unittest discover -s .github/composition -p 'test_*.py'` | `Ran 164 tests`, `OK` |
| Neutralisation, entrée `e2e` de PKW réinsérée dans `E2E` | même commande | 2 échecs |
| Neutralisation, étape `wasm` de PKW remplacée par `pass` | même commande | 2 échecs |
| Chemin de l'exemption, recherche de code | `gh search code --owner libre-ai "gate-a/a28e116"` | trouvé seulement dans l'exemption |
| Chemin de l'exemption, arbre servi | pour chaque dépôt de `gh repo list libre-ai --json name,isArchived` non archivé : `gh api "repos/libre-ai/<dépôt>/git/trees/<branche par défaut>?recursive=1" --jq '[.tree[].path \| select(test("notebook-core-v2/gate-a"))] \| length'` | 24 dépôts lus, 0 avec le chemin, 0 illisible |
| `check:no-transmission` dans PKW #55 | `gh api "repos/libre-ai/personal-knowledge-workspace/contents/package.json?ref=05f59a7e9f042fcbb8a519fbb98da6a9b4d04530" --jq .content \| base64 -d \| grep no-transmission` | `--roots apps/desktop/src` |
| `bun test`, base contre tête | `bun --no-env-file test` à la tête et dans un worktree à `70fb8fa` ; noms des tests `(fail)` comparés après retrait des durées | 58 et 58, ensembles identiques |

## Passe `pkw-servers-r-1` (indépendante)

**Rôle :** passe `candidate-integration` en revue seule, à rôle séparé. Sous-agent sans délégation, en lecture seule, dans un clone jetable. Il n'a pas écrit ce qu'il relit, mais il a reçu le résumé des affirmations de l'auteur dans son mandat et a lu son dossier. Modèle `claude-opus-5-5`. Ce n'est pas une approbation de promotion par rôle. Il n'a relevé aucun constat bloquant ni majeur, et aucune preuve requise ouverte.

**Axes couverts :** sécurité (retraits qui resserrent ; sonde plantée au chemin anciennement exempté : `rc=1` à la tête, `rc=0` sur la base) ; correction (diff lu en entier, note de `ci.yml` vérifiée contre `package.json` de PKW #55) ; valeur des tests (trois mutations du script tuées, une mutation du workflow survivante : M1) ; chaîne d'approvisionnement (aucune dépendance ni action ajoutée ; appelants épinglés par SHA complet).

| Constat | Gravité | Disposition |
| --- | --- | --- |
| **M1**, antérieur à la PR : aucun test ne lie les conditions `if:` du workflow aux tables de `check-products.py`. Mesuré : PKW retiré de la condition de l'étape WASM, les 164 tests Python et `bun test tools/quality/check-workflows.test.ts` (143 tests, 0 échec) restent verts. | minor | suggestion ; **corrigé** après la passe (voir plus bas) |
| **M2** : ce dossier ne suivait pas tout le protocole (commandes absentes, phrase « not a role-specific promotion approval » absente, axes non dits, identifiant de session absent, passe sur `5cd63fb` et non sur le commit final). | minor | suggestion ; complété dans ce dossier |
| **M3** (inféré) : si l'épingle de PKW monte par `bump-generation` avant la fusion de #55, la composition Linux de PKW ne lance plus l'e2e alors que `apps/notebook` est encore servi. | minor | suggestion ; la description de la PR ne prévoit plus que la montée dans #55 |
| **M4**, antérieur à la PR : `docs/security/notebook-core-v2-review/INDEPENDENT-REVIEW.md:55-58` cite, avec leurs empreintes, les rapports `docs/reviews/notebook-core-v2/gate-a/a28e116/*.md`, absents des branches servies des 27 dépôts de l'organisation. Restaurer ces rapports scellés exigerait de rétablir l'exemption. | minor | suggestion |

**Commandes et sorties de la passe :**

- `python3 -B -m unittest discover -s .github/composition -p 'test_*.py'` : 164 OK à la tête, 163 sur la base.
- Mutations du script : entrée `e2e` de PKW réinsérée, 2 échecs ; refus du plan vide remplacé par `pass`, 2 échecs ; étape `wasm` de PKW remplacée par un no-op, 2 échecs. Mutation du workflow (PKW retiré de l'étape WASM) : 0 échec, d'où M1.
- `check-sql-construction.ts` et `check-web-headers.ts` contre la flotte : `32 assertion(s) hold … 24 … found, 24 covered` et `39 assertion(s) hold … 11 declared server(s)`. Une entrée plantée vers `apps/does-not-exist/…` dans chaque liste : `rc=1`, `stale allowance … 1 of 32` et `stale declaration … 1 of 40`.
- Arbre des branches servies (`git/trees/<servie>?recursive=1`) des 27 dépôts de `libre-ai` (24 non archivés, dont 4 privés, et 3 archivés) : aucun ne contient `gate-a/a28e116`, aucun arbre tronqué, aucun illisible.
- Appelants de la flotte : épingles par SHA complet (`a00daec8` ×23, `75d6ea08` ×5, `1cebcb49` ×2), aucune par branche. `manifest.json` : aucune cible ne dépend de PKW.
- `git diff --name-only 70fb8fa...1cae9d1 | bun tools/skills/bounded-merge-scope.ts` : `examined=10 admitted=1 refused=9 gated-patterns=32 excluded-patterns=18`, exit 1.

## Changements faits après les passes

Un commit, postérieur à `1cae9d1`, relu par aucune passe :

- **M1 corrigé.** `.github/composition/test_check_products.py`, classe `WorkflowMatchesRunner` : la condition `if:` des étapes native, WASM et suite navigateur de `validate-composition.yml` doit sélectionner exactement les cibles pour lesquelles `check-products.py` planifie la porte ; l'étape d'installation des navigateurs doit sélectionner les mêmes cibles que la suite, et son dictionnaire `children` doit être égal à la table `E2E`. Commande : `python3 -B -m unittest discover -s .github/composition -p 'test_*.py'`, 166 tests OK. Mutations, chacune rejouée puis restaurée : PKW retiré de la condition de l'étape WASM, 1 échec ; PKW remis dans la condition de la suite navigateur, 2 échecs ; `'personal-knowledge-workspace': 'apps/notebook'` remis dans `children`, 1 échec.
- **Suggestion de la passe `pkw-servers-g-1` appliquée.** Le commentaire de `tools/quality/check-context-hygiene.sh` donne désormais pour raison que le chemin n'existe plus nulle part, et ne cite plus le retrait du Notebook.

**Effet sur les verdicts.** Ce commit ajoute un test et change un commentaire : aucun changement de règle, donc les verdicts ne deviennent pas périmés au sens de `docs/reviews/AGENT-REVIEW-PROTOCOL.md:32`. En revanche, aucune des deux passes ne couvre le commit final, qu'exige la condition de fusion `candidate-integration` (`:45`). Une passe sur le nouveau commit remplit cette condition.

## Risques résiduels

- La fusion de #293 ne change rien pour PKW tant que son épingle d'outillage reste à `a00daec8`. Inversement, PKW #55 reste rouge à `composition / validate` tant que l'épingle ne passe pas à la génération qui porte #293. Le vert de PKW après la montée d'épingle est inféré, pas mesuré.
- M3 : la montée d'épingle doit se faire dans PKW #55, pas avant.
- M4 : restaurer les rapports scellés de Gate A exigerait de rétablir l'exemption.
- `project-website` copie `docs/LOCAL-COMPOSITION.md` dans `src/data/deploy/LOCAL-COMPOSITION.md` ; cette copie n'est pas mise à jour ici.
- Hors périmètre : `notebook-webkit-macos.yml` de PKW #55 garde deux étapes « Install PostgreSQL 16 for the P02 database tests », après le retrait de `p02-api`.

## Non relu

Les 58 échecs de `bun test`, attribués à l'environnement sans autre analyse. Ce dossier, et le commit fait après les passes, n'ont été relus par aucune passe.
