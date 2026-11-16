<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Produits avec code et phases comme versions : deux passes de revue

**Date :** 2026-11-16
**Objet :** les champs optionnels `products`, `phases[].product`, `phases[].delivers` et `phases[].depends_on` du schéma `libre-ai.project.v1` (`ecosystem/schemas/project.v1.schema.json`), le contrôle de flotte `ecosystem/check-fleet-versions.ts` et sa moitié pure `ecosystem/fleet-versions.ts`, leurs tests, l'étape du job d'inventaire.
**Nature :** dossier de revue d'une pull request écrite par un agent. Il ne vaut pas arbitrage du propriétaire. Les choix de forme sont du propriétaire (2026-11-16, questions à options : « Produit + chemin vérifié », « Phases = versions », « Déduit de dependencies ») ; ce dossier rend compte de ce qui a été relu, sur quel commit, et de ce qui a été corrigé ensuite.
**État :** la passe 1 a rendu `reject`, la passe 2 `approve-with-minor-reservations`, sur le commit `00c32e40c45652a5db219098442a14c9f25d64d3`. Le verdict du dossier est celui de la passe 2. Le commit qui la suit corrige trois de ses mineurs ; aucune passe ne l'a relu.

## Les passes

| Passe | Identifiant | Mode | Commit relu | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `project-products-versions-pass-1` | revue seule, relecteur indépendant à contexte neuf, lecture seule | `8671553449997be8405251fd209fe9524e425f9b` | `reject` : 1 à corriger, 8 mineurs |
| 2 | `project-products-versions-pass-2` | revue seule du diff postérieur à la passe 1, relecteur indépendant à contexte neuf, distinct du premier | `00c32e40c45652a5db219098442a14c9f25d64d3` | `approve-with-minor-reservations` : 5 mineurs |

Les commits relus sont des commits de la branche de travail ; la fusion par squash ne les garde pas. Les relecteurs sont des sous-agents de la même famille de modèles que l'auteur : le quorum à deux familles (I-35) n'est pas satisfait.

## Passe 1 : les 9 constats, et ce qui a suivi

| N° | Gravité | Constat | Suite (relue par la passe 2) |
| --- | --- | --- | --- |
| 1 | à corriger | Le gate se fiait au `repository` déclaré par la fiche : une fiche du dépôt X déclarant Y remplaçait les phases de Y et rendait « prête » une version qui attend une phase non faite de Y. | Corrigé : une fiche est lue sous le nom que lui donne l'index ; un nom déclaré différent est refusé. Passe 2 : corrigé, usurpateur placé en premier ou en dernier. |
| 2 | mineur | Le compteur de consommation était vrai par construction. | Partiellement : compteurs fixés par un test à valeurs ; la somme « avec + sans consommateur » reste vraie par construction (deux filtres complémentaires). |
| 3 | mineur | Auto-dépendance et cycles non refusés. | Corrigé : une phase qui s'attend elle-même est refusée et nommée avec son cycle. Passe 2 : cycles de 1, 2 et 3 phases, aucun faux positif. |
| 4 | mineur | « is not a fiche » écrit quand le catalogue est illisible. | Corrigé : « cannot be held to the catalogue: it is unreadable ». |
| 5 | mineur | Entrées de `dependencies` hors fiches et dépôts de l'index sans fiche non comptés. | Corrigé : le volume imprime l'index (fiches + sans fiche) et les entrées (sur une fiche lue + ailleurs). Sur la flotte : 24 = 19 + 5, 30 = 27 + 3. |
| 6 | mineur | Segments `.` acceptés dans `code`. | Corrigé dans le motif du schéma. |
| 7 | mineur | Id de phase en double non refusé. | Corrigé : refusé. |
| 8 | mineur | Version d'un produit inconnu listée « prête ». | Corrigé : jamais prête. |
| 9 | mineur | Tests manquants (catalogue, fiche absente, sommes, décompte sous catalogue illisible). | Corrigé, sauf la branche d'échec de `git ls-files`, non testée. |

## Passe 2 : les 5 constats nouveaux, et ce qui a suivi (non relu)

| N° | Gravité | Constat | Suite |
| --- | --- | --- | --- |
| N1 | mineur | Trois sommes vraies par construction : « ailleurs » calculé par soustraction, l'index, avec/sans consommateur. | « Ailleurs » est maintenant compté dans sa propre branche. L'index et la consommation restent des partitions par construction ; c'est leur définition. |
| N2 | mineur | Avec « le premier id gagne », une dépendance vers une phase en double se résolvait selon l'ordre d'écriture. | Corrigé : une phase en double n'est plus une cible ; la dépendance est non résolue, avec le motif. Test dans les deux ordres. |
| N3 | mineur | Le message de commit dit « counted blocked » pour une phase sur un cycle ; `blocked` ne compte que les versions. | Rectifié dans le message de fusion. |
| N4 | mineur | Le refus des segments vides était déjà dans l'ancien motif ; son test ne discrimine pas le changement. | Rectifié dans le message de fusion ; le test reste comme non-régression. |
| N5 | mineur | Une version d'une fiche en violation pour une autre raison était listée « prête ». | Corrigé : les versions d'une fiche en violation sont comptées bloquées. |

Discrimination des corrections postérieures à la passe 2 : neutraliser le retrait des phases en double fait rougir 2 tests, accepter les versions d'une fiche en violation en fait rougir 1.

## Ce que ce dossier ne couvre pas

- Une relecture du dernier commit par une troisième passe.
- Une fiche réelle qui porte `products` ou une version : la flotte n'en compte aucune à la date de la revue.
- `render-fleet-status.ts`, qui lit encore le `repository` déclaré par la fiche : hors du diff.
