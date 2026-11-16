<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Liste générée des produits avec code : deux passes de revue

**Date :** 2026-11-16
**Objet :** `distribution/build-products-with-code.ts` et son test, `distribution/index/products-with-code.v1.json`, `ecosystem/schemas/products-with-code.v1.schema.json`, le champ `withCode` et le refus d'un produit déclaré deux fois dans `ecosystem/fleet-versions.ts`, `readFleetVersionsInput` extrait de `ecosystem/check-fleet-versions.ts`, le workflow `.github/workflows/products-with-code.yml`, l'`intent-to-add` de l'étape d'index de `.github/workflows/inventory-drift.yml`, deux déclarations de `tools/quality/check-data-inventory.ts`, `distribution/README.md`, le script `build:products-with-code`.
**Nature :** dossier de revue d'une pull request écrite par un agent. Il ne vaut pas arbitrage du propriétaire. Le marqueur est du propriétaire (2026-11-15, « Du code existe » ; 2026-11-16, « Produit + chemin vérifié ») ; l'emplacement du fichier, sa forme et son contrôle de dérive sont des choix de l'agent, rapportés dans la pull request.
**État :** passe 1 `reject` sur `48601182b405022430b5add965cf2b76867dd030` ; passe 2 `approve-with-minor-reservations` sur `a281e9e57f63f3edce3ed34f7ced06330639dc6b`. Le commit qui suit la passe 2 applique deux de ses trois constats ; aucune passe ne l'a relu.

## Les passes

| Passe | Mode | Commit relu | Verdict |
| --- | --- | --- | --- |
| 1 | revue seule, relecteur indépendant à contexte neuf, lecture seule, sondes et mutations sur une copie | `48601182b405022430b5add965cf2b76867dd030` | `reject` : 1 bloquant, 7 mineurs |
| 2 | même mode, relecteur neuf, constats de la passe 1 statués un par un | `a281e9e57f63f3edce3ed34f7ced06330639dc6b` | `approve-with-minor-reservations` : 1 moyen, 2 mineurs |

Les commits relus sont des commits de la branche de travail ; la fusion par squash ne les garde pas. Les relecteurs sont des sous-agents de la même famille de modèles que l'auteur : le quorum à deux familles (I-35) n'est pas satisfait.

## Passe 1 : 8 constats

| N° | Gravité | Constat | Suite (statut de la passe 2) |
| --- | --- | --- | --- |
| 1 | bloquant | L'étape de dérive ne voyait pas un fichier supprimé ou jamais commité : `git diff --exit-code` ignore un fichier non suivi, `brick-map.yml` et `feeds-freshness.yml` font `git add --intent-to-add` pour cette raison. Même trou sur l'étape d'index du même job. | Corrigé sur les deux étapes. Résolu : sonde git 2.56.0, fichier supprimé puis régénéré → rc=0 sans `-N`, rc=1 avec. |
| 2 | mineur | Un produit déclaré deux fois dans une fiche avec deux chemins passait (`uniqueItems` compare l'objet entier) et apparaissait deux fois dans la liste, dans l'ordre de la fiche. | Corrigé : refusé (`products Pnn is declared twice`). Résolu : le refus neutralisé fait rougir 1 test. |
| 3 | mineur | La déclaration `distribution/index/` de l'inventaire des données nommait `build-index.ts` comme générateur de tous ses fichiers. | Corrigé : deux chemins exacts, chacun avec son générateur. Résolu. |
| 4 | mineur | Le cas « contrôle vert, zéro produit » n'était ni testé ni écrit. | Corrigé : liste vide, testée et validée par le schéma, écrite dans le README. Résolu. |
| 5 | mineur | Le bloc `import.meta.main` du générateur n'a pas de test. | Non corrigé, déclaré en limite. Passe 2 : limite acceptable, la décision est entière dans `projectProductsWithCode`, couverte. |
| 6 | mineur | La JSDoc de `withCode` ne disait pas qu'il porte aussi les produits vérifiés d'une fiche en violation. | Corrigé. Résolu. |
| 7 | mineur | Le job d'inventaire ne lance pas `bun install` alors que les fiches sont validées par ajv ; le commentaire « Bun built-ins only » du job est faux depuis l'étape `check-fleet-versions` existante. | Non corrigé dans ce job, déclaré : défaut antérieur. Le générateur a quitté ce job (constat N1) pour un workflow qui lance `bun install --frozen-lockfile`. Hypothèse non vérifiée : la résolution d'ajv sans `node_modules` passe par l'installation automatique de Bun, hors du lockfile. |
| 8 | mineur | Le champ `rule`, une phrase en anglais, vivait dans la donnée : la reformuler changeait toute copie épinglée. Pas de schéma publié pour un consommateur extérieur. | Corrigé : `rule` retiré, schéma `ecosystem/schemas/products-with-code.v1.schema.json`, fichier commité testé contre lui, un cas refusé par contrainte. Résolu. |

## Passe 2 : 3 constats nouveaux

| N° | Gravité | Constat | Suite (non relue) |
| --- | --- | --- | --- |
| N1 | moyen | L'étape de dérive était dans le job « Index freshness and GitHub reconciliation », rouge sur les trois derniers runs de la base pour d'autres causes (SQL brut et en-têtes d'un autre dépôt) et non requis : son échec ne changeait aucun verdict visible. | Corrigé : workflow propre `products-with-code.yml` (push, pull request, hebdomadaire, alerte de répétition d'échec sur les runs planifiés), non requis, puisque la dérive peut venir d'un autre dépôt. |
| N2 | mineur | Le générateur n'écrivait pas sa sortie contre le schéma qu'il publie, dont deux motifs recopient `project.v1`. | Corrigé : un document hors schéma n'est pas publié ; le garde neutralisé fait rougir 1 test. |
| N3 | mineur | Les messages de commit ne répondent pas aux deux questions de `gate-integrity` §5 et ne déclarent pas les limites 5 et 7. | Dans la description de la pull request. |

## Contrôle indépendant du contenu commité (passe 2)

Par un autre instrument que le générateur : lecture REST des fiches à la branche servie des 19 dépôts qui en déclarent une. Trois fiches déclarent `products` (personal-knowledge-workspace P04 `apps/desktop`, signalement P15 `apps/extension-shared`, square-control P40 `crates/layout`), les trois chemins existent, les trois fiches produit nomment ces dépôts dans `depot`. Le fichier commité y correspond.

## Mutations

| Ligne neutralisée | Résultat |
| --- | --- |
| ajout à `withCode` d'un produit vérifié | 2 rouges |
| tri de `withCode` | 1 rouge |
| garde « contrôle rouge » | 1 rouge |
| garde « contrôle qui n'a rien affirmé » | 1 rouge |
| garde « liste ≠ compte des vérifiés » | 1 rouge |
| projection champ par champ remplacée par la liste brute | 1 rouge |
| refus d'un produit déclaré deux fois | 1 rouge |
| motif `code` du schéma retiré | 1 rouge |
| `additionalProperties: true` sur une entrée du schéma | 1 rouge |
| validation du document contre le schéma | 1 rouge |

## Limites déclarées

- Le bloc `import.meta.main` du générateur n'a pas de test (constat 5).
- Le job d'inventaire résout ajv sans `bun install` (constat 7), défaut antérieur à ce changement.
- Le relecteur et l'auteur sont de la même famille de modèles (I-35).
- Le dernier commit n'est relu par aucune passe.
