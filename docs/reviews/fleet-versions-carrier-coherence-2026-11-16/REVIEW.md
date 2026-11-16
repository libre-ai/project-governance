<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Cohérence produit ↔ dépôt porteur dans le contrôle de flotte : une passe de revue

**Date :** 2026-11-16
**Objet :** la règle qui tient `products[].id` et `phases[].product` d'une fiche de projet au champ `depot` de la fiche produit (`ecosystem/fleet-versions.ts`, `ecosystem/check-fleet-versions.ts`, leurs tests, deux descriptions de `ecosystem/schemas/project.v1.schema.json`, la section `depot` de `ecosystem/produits/README.md`).
**Nature :** dossier de revue d'une pull request écrite par un agent. Il ne vaut pas arbitrage du propriétaire. La règle est du propriétaire (2026-11-16, question à options : « Le contrôle de flotte doit-il exiger que le produit déclaré dans `products` ou `phases[].product` d'un dépôt ait ce même dépôt dans le champ `depot` de sa fiche produit ? », option retenue « Exiger la cohérence ») ; ce dossier rend compte de ce qui a été relu, sur quel commit, et de ce qui a été corrigé ensuite.
**État :** une passe, `approve-with-minor-reservations`, sur le commit `7b0fd1ed7f068efaa50d38fa04bb1be15f5971f7`. Le commit qui la suit applique cinq de ses sept mineurs ; aucune passe ne l'a relu.

## La passe

| Passe | Identifiant | Mode | Commit relu | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `fleet-versions-carrier-pass-1` | revue seule, relecteur indépendant à contexte neuf, lecture seule, mutations sur une copie | `7b0fd1ed7f068efaa50d38fa04bb1be15f5971f7` | `approve-with-minor-reservations` : 7 mineurs |

Le commit relu est un commit de la branche de travail ; la fusion par squash ne le garde pas. Le relecteur est un sous-agent de la même famille de modèles que l'auteur : le quorum à deux familles (I-35) n'est pas satisfait.

## Les 7 constats, et ce qui a suivi (non relu)

| N° | Gravité | Constat | Suite |
| --- | --- | --- | --- |
| 1 | mineur | Le motif de `depot` du contrôle (`^libre-ai/[a-z0-9.][a-z0-9.-]*$`) était plus étroit que celui du schéma produit (`^libre-ai/[A-Za-z0-9._-]+$`) : une fiche valide pour ce schéma rendait tout le catalogue illisible. | Corrigé : le contrôle reprend le motif du schéma produit. Test : `libre-ai/Notes_v2` est un porteur. |
| 2 | mineur | Le libellé « carried by another repository » comptait aussi les produits à `depot: null`. | Corrigé : « carried by another repository or by none ». |
| 3 | mineur | Le volume n'imprimait ni le nombre de fiches lues ni leur répartition par porteur (gate-integrity §2). | Corrigé : « N fiche(s) in the catalogue = X with a carrier + Y without ». Sur la flotte au 2026-11-16 : 41 = 8 + 33, le même compte que `check-produits.ts` (« carrier: 8 with a depot + 33 without »). |
| 4 | mineur | `waiting = true` dans la branche « version portée ailleurs » n'est pas observable : toute violation de la fiche bloque déjà ses versions. | Gardé, déclaré en limite : la ligne est symétrique de la branche « produit inconnu » et tient si le blocage au niveau de la fiche change. |
| 5 | mineur | Le motif de `depot` n'était couvert par aucun test (mutation `/.*/` survivante). | Corrigé : `depot: notes` est refusé avec son motif ; la même mutation fait rougir 1 test. |
| 6 | mineur | La moitié qui lit les fichiers (`readCatalogue`) n'a pas de test ; c'était déjà le cas avant ce changement. | Non corrigé, déclaré en limite. Le relecteur l'a exercée à la main : une fiche retirée de l'arbre donne `catalogue of products: unreadable (fiche P04 unreadable (ENOENT …))`, rc=1. |
| 7 | mineur | L'en-tête du module ne citait pas le quatrième choix du propriétaire. | Corrigé. |

## Mutations rapportées

Par le relecteur, sur une copie, `bun test ecosystem/fleet-versions.test.ts` :

| Ligne neutralisée | Résultat |
| --- | --- |
| `if (carrier === repository) return null;` forcé à accepter | 5 rouges |
| `waiting = true` (version portée ailleurs) neutralisé | 0 rouge (constat 4) |
| motif `CARRIER` remplacé par `/.*/` | 0 rouge (constat 5) |
| contrôle `id` ≠ nom de fichier neutralisé | 1 rouge |
| garde « aucune fiche » neutralisée | 1 rouge |
| garde « fiche illisible » neutralisée | 1 rouge |

Par l'auteur, après les corrections : le motif `CARRIER` remplacé par `/.*/` fait rougir 1 test.

## Ce que ce dossier ne couvre pas

- Une relecture du commit correctif par une seconde passe.
- Une fiche réelle qui déclare un produit : à la date de la revue, la flotte n'en compte aucune sur sa branche servie. Trois pull requests de dépôts (personal-knowledge-workspace #49, signalement #35, square-control #5) en déclarent, et le validateur local de l'auteur les juge conformes à cette règle ; elles ne sont pas fusionnées.
- `libre-ai/information-watch`, porteur de P02 selon D89, n'est pas à l'inventaire (dépôt privé, enrôlement par acte du propriétaire, I-30) : la fiche P02 garde `depot: null`, et ce dépôt ne peut pas déclarer P02 tant qu'il n'est pas enrôlé.
