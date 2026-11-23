<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-minor-reservations

# Retrait des serveurs de `personal-knowledge-workspace` : revue des listes d'autorisation

**Date :** 2026-11-23
**Objet :** la pull request #293 : gate de composition (porte `e2e` de PKW retirée, test qui lie le workflow au runner), exemption de context hygiene, notes datées. Les passes `g-1` à `r-3` ont aussi relu les entrées `p02-api` qu'elle retirait de `ecosystem/sql-construction-allowlist.v1.yaml` et de `ecosystem/web-headers-allowlist.v1.yaml`. Depuis la mise à jour de la branche sur la base (section dédiée plus bas), ce retrait n'est plus dans son diff : la pull request #295 du propriétaire (`a787af8`) l'a fusionné avant elle.
**Nature :** dossier de revue d'une pull request écrite par un agent, après les décisions du propriétaire du 2026-11-23 en chat (« Retirer les deux », « Retirer l'app notebook entière »). Ces décisions retirent les serveurs ; elles ne tranchent pas les entrées une à une. Ce dossier rend compte des relectures qui les ont examinées et ne vaut pas arbitrage du propriétaire. Aucune des passes n'est une approbation de promotion par rôle : **not a role-specific promotion approval**.
**Fusion :** `git diff --name-only origin/migrate/recover-code...HEAD | bun tools/skills/bounded-merge-scope.ts`, base `a120cbf`, tête : le commit qui porte ce dossier, puis la fusion de la base qui le suit (section « Mise à jour de la branche sur la base : `a120cbf` ») : `examined=9 admitted=1 refused=8 gated-patterns=32 excluded-patterns=18`, exit 1. La fusion revient au propriétaire (ADR-0068), pas à un agent.

## Les passes

| Passe | Commit relu | Verdict |
| --- | --- | --- |
| `pkw-servers-g-1` | `5cd63fb81e9fc65ca484c7cf4e8504217b52983b` | `approve-with-minor-reservations` |
| `pkw-servers-r-1` | `1cae9d19666fa9a8e8d34be32c12b723bbcf7fde` | `approve-with-minor-reservations` |
| `pkw-servers-r-2` | `b15313962342a64d44f2c4aabfed33b11f65d417` | `approve-with-minor-reservations` |
| `pkw-servers-r-3` | `20092f7cfc897881c17799f5ceabd52c34f5c53b` | `approve-with-minor-reservations` |
| `pkw-servers-r-4` | `396d74f6d998e2326c15acc41895f27632782a36` | `approve-with-minor-reservations` |

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
| **M1**, antérieur à la PR : aucun test ne lie les conditions `if:` du workflow (`.github/workflows/validate-composition.yml:161`, étape WASM ; `:173` et `:194`, étapes navigateur) aux tables `E2E` et `wasm` de `.github/composition/check-products.py`. Mesuré : PKW retiré de la condition de l'étape WASM, les 164 tests Python et `bun test tools/quality/check-workflows.test.ts` (143 tests, 0 échec) restent verts. | minor | suggestion ; **corrigé** après la passe (voir plus bas) |
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
- Ordre de fusion. Sur la base, le run `schedule` 45260673290 échoue avec exactement les deux lignes `stale` de `apps/p02-api` (SQL et web headers) et `1 of 40 assertion(s)` ; le passage de 40 à 39 assertions à la tête correspond à la déclaration retirée (mesure à `1cae9d1` ; depuis `a787af8`, la base porte elle-même ce retrait et compte 39 assertions). Sur PKW #55 (tête `05f59a7`), le job de composition passe les étapes native et WASM et n'échoue qu'à l'installation des navigateurs (étape 16), faute d'`apps/notebook`. Le `notebook-webkit-macos.yml` de #55 n'appelle que les portes `native` et `wasm`.

**Limites de la passe :** `bun test` non lancé en entier (la CI « Bun quality » était verte) ; #294 non relue.

## Changement fait après `pkw-servers-r-1` : `b153139`

Relu par la passe `pkw-servers-r-2` ci-dessous.

- **M1 corrigé.** `.github/composition/test_check_products.py`, classe `WorkflowMatchesRunner` : la condition `if:` des étapes native, WASM et suite navigateur de `validate-composition.yml` doit sélectionner exactement les cibles pour lesquelles `check-products.py` planifie la porte ; l'étape d'installation des navigateurs doit sélectionner les mêmes cibles que la suite, et son dictionnaire `children` doit être égal à la table `E2E`. Commande : `python3 -B -m unittest discover -s .github/composition -p 'test_*.py'`, 166 tests OK. Mutations, chacune rejouée puis restaurée : PKW retiré de la condition de l'étape WASM, 1 échec ; PKW remis dans la condition de la suite navigateur, 2 échecs ; `'personal-knowledge-workspace': 'apps/notebook'` remis dans `children`, 1 échec.
- **Suggestion de la passe `pkw-servers-g-1` appliquée.** Le commentaire de `tools/quality/check-context-hygiene.sh` donne désormais pour raison que le chemin n'existe plus nulle part, et ne cite plus le retrait du Notebook.

**Effet sur les verdicts.** Ce commit ajoute un test et change un commentaire : aucun changement de règle, donc les verdicts ne deviennent pas périmés au sens de `docs/reviews/AGENT-REVIEW-PROTOCOL.md:32`.

## Passe `pkw-servers-r-2` (indépendante, commit final)

**Rôle :** passe `candidate-integration` en revue seule, à rôle séparé, sur le commit final. Sous-agent sans délégation, en lecture seule, dans un nouveau clone jetable effacé en fin de passe. Il n'a pas écrit ce qu'il relit ; il a reçu le résumé du delta dans son mandat et a lu ce dossier. Modèle `claude-opus-5-5` ; session du harnais `c79598a7-9e1e-42cf-bfbc-e29615fbe251` (la même que celle de la passe auteur, ce qui ne l'invalide pas : `docs/reviews/AGENT-REVIEW-PROTOCOL.md:16`, `:32`) ; identifiant de sous-agent non exposé. **Not a role-specific promotion approval.** Aucun constat bloquant ni majeur, aucune preuve requise ouverte.

**Axes couverts :** sécurité (retraits qui resserrent, aucun élargissement) ; correction (diff `70fb8fa...b153139` lu en entier, delta `b153139` relu ligne à ligne) ; valeur des tests (six mutations tuées, deux survivantes : N1) ; chaîne d'approvisionnement (aucune dépendance ni action ajoutée, appelants épinglés par SHA complet).

| Constat | Gravité | Disposition |
| --- | --- | --- |
| **N1** : `WorkflowMatchesRunner.step_targets` lit toute cible entre guillemets sur la ligne `if:`, commentaire YAML compris. Mesuré : `if: inputs.target == 'ai-model-policy' # 'personal-knowledge-workspace'` sur l'étape WASM, le YAML chargé donne `inputs.target == 'ai-model-policy'` (PKW exclu), et `Ran 166 tests … OK`, `308 pass, 0 fail` sur `check-workflows.test.ts` et `check-workflow-supply-chain.test.ts`. Même vert pour `… \|\| inputs.target == 'personal-knowledge-workspace' && false`. Contredit « never silently » (description de la PR, message de `b153139`). Correctif : retirer le commentaire, exiger l'une des deux formes de condition en entier, échouer sinon. | minor | suggestion ; **corrigé** après la passe (voir plus bas) |
| M1 : corrigé par `WorkflowMatchesRunner`, sous la réserve N1. | minor | prêt |
| M3 : la description de la PR ne prévoit plus que la montée d'épingle dans PKW #55. | minor | prêt |
| M4 : inchangé, risque résiduel. | minor | suggestion |

**Commandes et sorties de la passe :**

- `python3 -B -m unittest discover -s .github/composition -p 'test_check_products.py'` à la tête : 166 tests, OK.
- Mutations du workflow, chacune rejouée puis restaurée : PKW retiré de la condition WASM, 1 échec ; PKW remis dans la condition de la suite navigateur, 2 échecs ; `apps/notebook` remis dans `children`, 1 échec ; `if: >-` sur plusieurs lignes, 1 échec (`no target read`) ; `if:` placé sous `shell:`, 1 échec (`has no if: on its next line`) ; commentaire `# 'personal-knowledge-workspace'`, 0 échec (N1) ; conjonction `&& false`, 0 échec (N1).
- `git diff --name-only 70fb8fa...b153139 | bun tools/skills/bounded-merge-scope.ts`, depuis `70fb8fa` : `examined=10 admitted=1 refused=9 gated-patterns=32 excluded-patterns=18`, exit 1.
- `bash tools/quality/check-context-hygiene.sh` à la tête : `Context hygiene verified: 1209 tracked file(s) scanned`.
- CI de la tête, job 138008037101 : `SQL construction verified: 32 assertion(s) hold … 24 … found, 24 covered`, `Web headers verified: 39 assertion(s) hold`. Les 17 check-runs de `b153139` sont `success`.

## Changement fait après `pkw-servers-r-2` : `20092f7`

Relu par la passe `pkw-servers-r-3` ci-dessous.

- **N1 corrigé.** `WorkflowMatchesRunner.step_targets` retire d'abord le commentaire YAML (tout ce qui suit ` #` : dans un scalaire YAML non quoté, ` #` ouvre un commentaire même entre guillemets), puis exige que la condition entière ait l'une des deux formes admises, `inputs.target == '<t>'( || inputs.target == '<t>')*` ou `contains(fromJSON('["<t>"(,"<t>")*]'), inputs.target)`, et échoue sur toute autre forme. Commande : `python3 -B -m unittest discover -s .github/composition -p 'test_*.py'`, 166 tests OK. Mutations, chacune rejouée puis restaurée : B1, commentaire `# 'personal-knowledge-workspace'` sur l'étape WASM, 1 échec (cibles lues `ai-model-policy` seule, différentes du plan) ; B2, `… || inputs.target == 'personal-knowledge-workspace' && false`, 1 échec (`has neither admitted shape`) ; PKW retiré de la condition WASM, 1 échec ; PKW remis dans la condition de la suite navigateur, 2 échecs ; `apps/notebook` remis dans `children`, 1 échec.

**Effet sur les verdicts.** Ce commit resserre un test : aucun changement de règle, donc les verdicts ne deviennent pas périmés au sens de `docs/reviews/AGENT-REVIEW-PROTOCOL.md:32`.

## Passe `pkw-servers-r-3` (indépendante, commit final)

Section rédigée par l'auteur à partir du résumé que le coordinateur a fait du rapport du relecteur ; le texte exact est dans le transcript du relecteur, non reproduit ici.

**Rôle :** passe `candidate-integration` en revue seule, à rôle séparé, sur le commit final. Sous-agent sans délégation, en lecture seule, dans un clone jetable. Modèle `claude-opus-5-5` ; session du harnais `c79598a7-9e1e-42cf-bfbc-e29615fbe251`. **Not a role-specific promotion approval.** Aucun constat bloquant ni majeur, aucune preuve requise ouverte.

**Axes couverts :** sécurité (les retraits resserrent) ; correction (delta `20092f7` lu en entier) ; valeur des tests (huit mutations tuées, une forme équivalente restée verte comme attendu (`contains` avec la liste exacte), deux survivantes : N2 et D ; compte corrigé par la passe `r-4`, constat N6, au lieu de « neuf tuées ») ; chaîne d'approvisionnement (rien d'ajouté).

| Constat | Gravité | Disposition |
| --- | --- | --- |
| N1 : corrigé par `20092f7`. | minor | prêt |
| **N2** : la ligne `if:` gardée intacte, suivie d'une ligne plus indentée `&& false` : le YAML prolonge le scalaire, PKW n'est plus jamais sélectionné. Mesuré : 166 tests OK. | minor | suggestion ; **corrigé** après la passe (voir plus bas) |
| **D** : un second `if:` dans la même étape, sans PKW ; le YAML chargé garde le dernier. Mesuré : 166 tests OK, et 328 tests Bun passés. Le comportement de GitHub sur une clé en double n'est pas mesuré. | minor | suggestion ; **corrigé** après la passe (voir plus bas) |
| M4 : inchangé, risque résiduel. | minor | suggestion |

**Commandes et sorties de la passe :** 166 tests OK à la tête ; onze mutations du workflow : huit tuées, une forme équivalente restée verte comme attendu (`contains` avec la liste exacte), deux survivantes (N2, D) (compte corrigé par N6) ; lecture du YAML par Ruby, qui garde le dernier `if:` en double ; `git diff --name-only 70fb8fa...20092f7 | bun tools/skills/bounded-merge-scope.ts`, exit 1 ; `bash tools/quality/check-context-hygiene.sh`, 1209 fichiers suivis examinés ; 17 check-runs de `20092f7` au vert.

**Limites de la passe :** `bun test` non lancé en entier ; #294 non relue ; comportement de GitHub sur une clé en double non mesuré.

## Changement fait après `pkw-servers-r-3`

`dd87f67`, relu par la passe `pkw-servers-r-4` ci-dessous :

- **N2 et D corrigés.** Le contrôle lit désormais le workflow avec un vrai parseur YAML, sans dépendance ajoutée : `tools/quality/validate-composition-gates.test.ts`, test Bun qui charge le fichier avec `Bun.YAML` (le parseur du runtime). Il compare la valeur `if:` chargée de chaque étape de porte (native, WASM, suite navigateur) aux cibles pour lesquelles `.github/composition/check-products.py` planifie la porte, obtenues en appelant le script avec `--plan`, et garde l'exigence des deux formes admises sur la valeur chargée. L'étape d'installation des navigateurs doit sélectionner les cibles de la suite, et son dictionnaire `children` doit correspondre aux répertoires du plan e2e. `Bun.YAML` garde sans rien dire la dernière de deux clés égales (mesuré sur Bun 1.4.0 : `if: x == 1` puis `if: y == 2` donne `y == 2`) : les clés en double sont donc trouvées par un contrôle dédié, `duplicateKeys`, qui parcourt les mappings en style bloc du même texte et saute le corps des scalaires de bloc. `WorkflowMatchesRunner`, la version texte en Python, est retirée : le nouveau test couvre tout ce qu'elle couvrait.
- Commande : `bun --no-env-file test tools/quality/validate-composition-gates.test.ts`, 17 tests, 0 échec. Mutations, chacune rejouée puis restaurée : B1, commentaire `# 'personal-knowledge-workspace'`, 1 échec ; B2, `&& false` sur la ligne, 1 échec (`has neither admitted shape`) ; tabulation dans la condition, 1 échec ; guillemets doubles autour de PKW, 1 échec ; `contains(…, inputs.target` sans parenthèse fermante, 2 échecs ; PKW retiré de la condition WASM, 1 échec ; PKW remis dans la suite navigateur, 2 échecs ; `apps/notebook` remis dans `children`, 1 échec ; N2, ligne de continuation `&& false`, 1 échec (`has neither admitted shape`) ; D, second `if:` sans PKW, 2 échecs (`line 163: if`) ; D bis, second `if:` identique au premier, 1 échec, du seul contrôle de clés en double.

**Effet sur les verdicts.** Ce commit remplace un test par un test plus strict : aucun changement de règle, donc les verdicts ne deviennent pas périmés au sens de `docs/reviews/AGENT-REVIEW-PROTOCOL.md:32`.

## Mise à jour de la branche sur la base : `3c606e0`

La branche servie a reçu `a787af8`, la pull request #295 du propriétaire, qui retire les deux mêmes entrées `p02-api` des listes d'autorisation. La branche a été mise à jour par un commit de fusion signé DCO (`git merge --signoff --no-edit origin/migrate/recover-code`, sans conflit), sans rebase ni push en force.

- `git diff --stat origin/migrate/recover-code...HEAD` : 9 fichiers, aucun sous `ecosystem/`. Le retrait des entrées `p02-api` n'est plus dans le diff de #293 ; `git grep -n -I 'p02-api' HEAD -- ecosystem/` ne trouve plus rien.
- Gates des listes d'autorisation rejoués sur l'arbre fusionné, contre la flotte vivante (`bun --no-env-file ecosystem/check-sql-construction.ts` et `ecosystem/check-web-headers.ts`, jeton GitHub en lecture dans `GITHUB_TOKEN`) : `SQL construction verified: 32 assertion(s) hold`, 24 sites trouvés, 24 couverts ; `Web headers verified: 39 assertion(s) hold`, 0 surface en violation, 11 serveurs déclarés.
- Tests rejoués : `python3 -B -m unittest discover -s .github/composition -p 'test_*.py'`, 164 tests OK ; `bun --no-env-file test tools/quality/validate-composition-gates.test.ts`, 17 pass, 0 fail.

`dd87f67`, cette fusion et le dossier à `396d74f` sont relus par la passe `pkw-servers-r-4` ci-dessous.

## Passe `pkw-servers-r-4` (indépendante, commit final)

**Rôle :** passe `candidate-integration` en revue seule, à rôle séparé, sur le commit final. Sous-agent sans délégation, en lecture seule, dans un nouveau clone jetable effacé en fin de passe. Il n'a pas écrit ce qu'il relit ; il a reçu le résumé du delta dans son mandat et a lu ce dossier. Modèle `claude-opus-5-5` ; session du harnais `c79598a7-9e1e-42cf-bfbc-e29615fbe251` ; identifiant de sous-agent non exposé. **Not a role-specific promotion approval.** Aucun constat bloquant ni majeur, aucune preuve requise ouverte.

**Axes couverts :** sécurité (rien d'élargi) ; correction (`dd87f67`, `3c606e0` et `396d74f` lus en entier ; fusion de la base recalculée) ; valeur des tests (treize mutations : dix tuées, trois survivantes : F, J + C, RUN) ; chaîne d'approvisionnement (rien d'ajouté).

| Constat | Gravité | Disposition |
| --- | --- | --- |
| N2, D : corrigés par `dd87f67` (ligne de continuation : `has neither admitted shape` ; `if:` en double : `line 163: if`). | minor | prêt |
| **N3** : le test ne lit que le `if:` des étapes. Mesuré : `if: inputs.target != 'personal-knowledge-workspace'` au niveau de `jobs.validate` et `continue-on-error: ${{ inputs.target == 'personal-knowledge-workspace' }}` sur l'étape WASM, 17 pass, 328 tests Bun de workflows passés. Inféré : le job sauté pour PKW, ou l'échec WASM masqué, laisse le check vert. Correctif : aucun `if:` de job, aucun `continue-on-error` sur une étape de porte. | minor | suggestion ; **corrigé** après la passe (voir plus bas) |
| **N4** : le nom d'étape n'est pas lié à la porte lancée. Mesuré : l'étape « Build and verify current product WASM » lance `--gate native`, 17 pass. Correctif : le `run` de chaque étape de porte appelle `check-products.py --target "$INPUT_TARGET" --gate <porte>`. | minor | suggestion ; **corrigé** après la passe (voir plus bas) |
| **N5** : `duplicateKeys` laisse passer en silence ce qu'il ne lit pas. Mesuré : une étape en mapping de flux avec deux `if:` (le bon en dernier), 17 pass. Lu (`validate-composition-gates.test.ts:63-71`) : mappings de flux, clés sur plusieurs lignes, toute ligne non `clé:` ignorés sans compteur. Le traitement d'une clé en double par GitHub n'est pas mesuré. Correctif : échouer sur un mapping de flux dans ce workflow, ou compter et imprimer les lignes non classées. | minor | suggestion ; **corrigé** après la passe (voir plus bas) |
| **N6** : correction de la passe `r-3` : 8 mutations tuées, 1 forme équivalente restée verte (`contains` avec la liste exacte), 2 survivantes (N2, D) ; « neuf tuées » était faux. | minor | suggestion ; **corrigé** dans la section `r-3` de ce dossier |
| M4 : inchangé, risque résiduel. | minor | suggestion |

**Commandes et sorties de la passe :**

- `bun test tools/quality/validate-composition-gates.test.ts` à la tête : `17 pass`, `0 fail`. `python3 -B -m unittest discover -s .github/composition -p 'test_*.py'` : `Ran 164 tests`, `OK`.
- Mutations, chacune rejouée puis restaurée, sur le test Bun : PKW retiré de la condition WASM, 1 échec ; B1, 1 échec ; B2, 1 échec ; N2, 1 échec ; D, 2 échecs ; second `if:` écrit `"if":` (le bon en dernier), 1 échec (`duplicateKeys`) ; PKW remis dans la suite navigateur, 2 échecs ; `apps/notebook` remis dans `children`, 1 échec ; alias `*only_policy` vers une valeur sans PKW, 1 échec ; étape renommée, 1 échec ; mapping de flux avec `if:` en double, 0 échec (N5) ; `if:` de job et `continue-on-error`, 0 échec, et `bun test tools/quality/check-workflows.test.ts ecosystem/check-workflow-supply-chain.test.ts ecosystem/check-action-pins.test.ts` : `328 pass, 0 fail` (N3) ; `--gate native` dans l'étape WASM, 0 échec (N4).
- Fusion de la base : `git merge-tree --write-tree dd87f67 a787af8` égale l'arbre de `3c606e0` (`633df6dc…`) ; `git diff --stat dd87f67 a787af8 -- ecosystem/sql-construction-allowlist.v1.yaml ecosystem/web-headers-allowlist.v1.yaml` vide.
- Périmètre : `git diff --name-only 034ca75...396d74f | bun tools/skills/bounded-merge-scope.ts`, depuis `034ca75` : `examined=9 admitted=1 refused=8 gated-patterns=32 excluded-patterns=18`, exit 1.
- Base actuelle : `git merge-tree --write-tree 396d74f 034ca75`, rc 0, arbre `6baba7e78a0734d0cf2096bdc0ce6e04b7c3161d` ; #277 (`distribution/vision/index.html`, `ecosystem/briques/fabrique.v1.yaml`, `ecosystem/briques/fabrique/FAB-14.md`) disjoint des 9 fichiers de #293. Sur ce commit de fusion simulé (local, non poussé) : `17 pass`, `Ran 164 tests OK`, context hygiene `1212 tracked file(s) scanned`.
- Règle de la branche servie : `gh api repos/libre-ai/project-governance/rules/branches/migrate/recover-code`, `strict_required_status_checks_policy: true` : la branche doit être à jour pour fusionner (`mergeStateStatus: BEHIND` à la tête).
- 17 check-runs de `396d74f`, tous `completed/success`.

**Limites :** `bun test` non lancé en entier ; #294 non relue ; comportement de GitHub sur une clé en double, un job sauté et `continue-on-error` non mesuré.

**Transfert à la prochaine mise à jour :** la prochaine fusion de la base n'est couverte par cette passe que si l'arbre du commit égale `git merge-tree --write-tree 396d74f <base>` (avec `034ca75` : `6baba7e78a0734d0cf2096bdc0ce6e04b7c3161d`).

## Changement fait après `pkw-servers-r-4`

Un commit, postérieur à `396d74f`, qui porte aussi cette version du dossier ; relu par aucune passe. Il change le test et ce dossier, pas le workflow ni le runner : `git diff 396d74f -- .github/` est vide.

- **N3 corrigé.** `tools/quality/validate-composition-gates.test.ts` exige que `jobs.validate` n'ait ni `if:` ni `continue-on-error`, et que son `env` pose `INPUT_TARGET: ${{ inputs.target }}`. Aucune étape de porte (native, WASM, suite navigateur) ne porte `continue-on-error`. La présence de la clé est testée, pas sa valeur : `continue-on-error: false` est refusé aussi.
- **N4 corrigé.** Le `run` de chaque étape de porte contient exactement un appel à `check-products.py`, dont toutes les valeurs `--gate` égalent la porte de l'étape et toutes les valeurs `--target` égalent `"$INPUT_TARGET"`.
- **N5 corrigé.** `duplicateKeys` devient `scanKeys`, qui classe chaque ligne du fichier dans quatre compteurs : clé en style bloc, corps de scalaire de bloc, ligne vide ou commentaire, ligne non classée. Leur somme doit égaler le nombre de lignes. Un mapping de flux (`{` en tête d'élément ou de valeur, ou dans une séquence de flux) et une clé explicite `?` sont des formes refusées, comptées et nommées. Le test échoue sur toute forme refusée, toute ligne non classée et toute clé en double. Les lignes du corps d'un scalaire de bloc (`|`, `>`) ont leur propre compteur. Toute autre ligne qui n'est ni une clé, ni vide, ni un commentaire est non classée, par exemple une ligne de continuation d'un scalaire simple. À la tête, il imprime : `scanKeys: 301 lines = 120 key + 132 block-scalar body + 49 blank or comment + 0 unclassified; 0 duplicate key(s), 0 refused form(s)`.
- **Limites écrites dans le commentaire du test :**
  - ce n'est pas un parseur de la sémantique de GitHub : il n'évalue aucune expression et n'admet que deux formes littérales ;
  - le traitement par GitHub d'une clé en double, d'un job sauté et de `continue-on-error` n'est pas mesuré ;
  - il ne lit que ce workflow, pas l'appelant ;
  - il lit le `run` comme du texte, donc un appel caché derrière une variable shell ou un second script lui échappe ;
  - le balayage des clés ne lit que le style bloc et échoue sur toute autre forme.
- Commande : `bun --no-env-file test tools/quality/validate-composition-gates.test.ts`, `27 pass`, `0 fail`. Mutations faites à l'outil Edit, chacune rejouée puis restaurée, `git diff --stat -- .github/workflows/validate-composition.yml` vide à la fin :

| Mutation | Échecs | Test rougi |
| --- | --- | --- |
| J seule : `if: inputs.target != 'personal-knowledge-workspace'` sur `jobs.validate` | 1 | job |
| C seule : `continue-on-error` sur l'étape WASM | 1 | étape WASM |
| J + C | 2 | job, étape WASM |
| `continue-on-error: ${{ inputs.target == 'personal-knowledge-workspace' }}` sur le job | 1 | job |
| RUN : `--gate native` dans l'étape WASM | 1 | étape WASM |
| F : étape WASM en mapping de flux avec deux `if:`, le bon en dernier | 1 | balayage : `1 unclassified`, `1 refused form(s)` |
| Clé explicite `? if` puis `: <condition>` | 1 | balayage |
| Second `if:` sans PKW, placé avant le bon | 1 | balayage : `line 162: if` |

**Effet sur les verdicts.** Ce commit resserre un test et met le dossier à jour : aucun changement de règle, donc les verdicts ne deviennent pas périmés au sens de `docs/reviews/AGENT-REVIEW-PROTOCOL.md:32`.

## Mise à jour de la branche sur la base : `a120cbf`

La base a reçu `a120cbf` (#284, trust-bench). Après le commit qui porte ce dossier, la branche est mise à jour par `git merge --signoff --no-edit origin/migrate/recover-code`, sans rebase ni push en force.

- #284 touche `verification/trust-bench/*`, `distribution/vision/index.html` et `ecosystem/briques/exploitation*`. Aucun de ces fichiers n'est un des 9 fichiers de #293.
- Condition de transfert de la passe `r-4` : l'arbre du commit de fusion doit égaler `git merge-tree --write-tree <commit qui porte ce dossier> a120cbf`. Cette égalité est vérifiée avant le push. Les deux empreintes sont dans la description de la pull request : ce dossier ne peut pas citer l'arbre qui le contient.
- La fusion ne change rien dans le périmètre de #293 : `git diff --name-only origin/migrate/recover-code...HEAD` liste les mêmes 9 fichiers.

## Risques résiduels

- La fusion de #293 ne change rien pour PKW tant que son épingle d'outillage reste à `a00daec8`. Inversement, PKW #55 reste rouge à `composition / validate` tant que l'épingle ne passe pas à la génération qui porte #293. Le vert de PKW après la montée d'épingle est inféré, pas mesuré.
- M3 : la montée d'épingle doit se faire dans PKW #55, pas avant.
- M4 : restaurer les rapports scellés de Gate A exigerait de rétablir l'exemption.
- `project-website` copie `docs/LOCAL-COMPOSITION.md` dans `src/data/deploy/LOCAL-COMPOSITION.md` ; cette copie n'est pas mise à jour ici.
- Hors périmètre : `notebook-webkit-macos.yml` de PKW #55 garde deux étapes « Install PostgreSQL 16 for the P02 database tests », après le retrait de `p02-api`.
- Le test de composition n'est pas un parseur de la sémantique de GitHub. Ses limites sont écrites dans son commentaire et dans la section « Changement fait après `pkw-servers-r-4` ». Le traitement par GitHub d'une clé en double, d'un job sauté et de `continue-on-error` n'est pas mesuré.
- La règle de la branche servie exige une branche à jour (`strict_required_status_checks_policy: true`). Toute nouvelle fusion de la base avant la fusion de #293 tombe hors de toute passe, sauf si son arbre égale `git merge-tree --write-tree <dernier commit relu ou vérifié> <base>`.

## Non relu

Les 58 échecs de `bun test`, attribués à l'environnement sans autre analyse.

Couverture des commits par les passes :
- `b153139` : relu par la passe `pkw-servers-r-2` ;
- `20092f7` : relu par la passe `pkw-servers-r-3` ;
- `dd87f67`, la fusion `3c606e0` et le dossier à `396d74f` : relus par la passe `pkw-servers-r-4`.

Le commit qui corrige N3, N4 et N5 et porte ce dossier dans son état final n'a été relu par aucune passe. La fusion de la base `a120cbf` qui le suit n'a pas été relue non plus : seule l'égalité d'arbre décrite plus haut a été vérifiée.
