<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Champ `accroche` des fiches produit : une passe de revue

**Date :** 2026-11-16
**Objet :** le champ `accroche` du schéma `libre-ai.produit.v1` (`ecosystem/schemas/produit.v1.schema.json`), sa règle dans `ecosystem/produits.ts`, ses vecteurs et ses tests, les 41 fiches `ecosystem/produits/Pnn.v1.yaml` et le README du dossier.
**Nature :** dossier de revue d'une pull request écrite par un agent. Il ne vaut pas arbitrage du propriétaire : il rend compte de ce qui a été relu, sur quel commit, et de ce qui a été corrigé ensuite.
**État :** la passe 1 a rendu `approve-with-minor-reservations`, sur le commit `a2335030f5f8167fb698603d4098e3093566e8ed`. Les corrections qui ont suivi n'ont été relues par aucune passe.

## La passe

| Passe | Identifiant | Mode | Commit relu | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `product-accroche-pass-1` | revue seule, relecteur indépendant à contexte neuf, en lecture seule | `a2335030f5f8167fb698603d4098e3093566e8ed` | `approve-with-minor-reservations` : 0 constat à corriger, 9 mineurs |

Le commit relu est un commit de la branche de travail ; la fusion par squash ne le garde pas. Le relecteur est un sous-agent de la même famille de modèles que l'auteur : le quorum à deux familles (I-35) n'est pas satisfait.

Commandes rejouées par le relecteur : `bun run check:produits` (pass, 48 assertions, 41 fiches valides) ; `bun test ecosystem/produits.test.ts ecosystem/check-produits.process.test.ts` (378 pass, 0 fail) ; neutralisation de la règle sur une copie `git archive HEAD` (8 fail, exactement les cas « rule accroche word ») ; comparaison des 41 accroches aux 40 lignes du site (deux écarts, P15 et P41, ceux attendus) ; compte en caractères et en octets des lignes du site.

Ce que le relecteur n'a pas vérifié : le texte des décisions du propriétaire, donné en conversation et sans trace dans le dépôt ; la CI ; `lint`, `typecheck` et les autres sous-contrôles.

## Les 9 constats, et ce qui a suivi

| N° | Gravité | Constat | Suite |
| --- | --- | --- | --- |
| 1 | mineur | L'accroche de P29 dit « sans pistage », ce que la fiche ne dit pas. | `accroche` entre dans `a_relire` de P29. |
| 2 | mineur | L'accroche de P24 dit « publiez vos podcasts » ; aucune capacité ne publie. | `accroche` entre dans `a_relire` de P24. |
| 3 | mineur | L'accroche de P37 promet des secrets « partagés et révoqués » ; la fiche borne le partage. | `accroche` entre dans `a_relire` de P37. |
| 4 | mineur | Le README dit que le site projette les champs de la fiche ; il les écrit encore à la main. | Corrigé : « le site doit les projeter […] Il les écrit encore lui-même tant qu'il ne lit pas les fiches. » La phrase valait déjà pour `fonction` et `etiquettes`. |
| 5 | mineur | Le motif « réécrites après le 2026-11-09 » ne distingue pas P03, seulement renommée dans #187 ; la description de la PR dit « rewritten as an offer » pour cinq fiches, vrai pour deux. | Corrigé : le README donne un motif par groupe (promesse réécrite, renommage, scission, ligne qui dit plus que la fiche) ; la description de la PR aussi. |
| 6 | mineur | « 77 » est un compte d'octets ; en caractères, unité de `maxLength`, la plus longue ligne fait 75. | Corrigé dans le schéma, le README et la description ; recompté par `wc -m` sous `LC_ALL=en_US.UTF-8` (contrôle : « é » compte 1). |
| 7 | mineur | La borne de 90 peut se lire comme décidée par le propriétaire. | Corrigé : le README et le schéma disent que la borne est un choix de l'agent. |
| 8 | mineur | La règle ne vérifie pas que « sans frais » porte sa condition (ADR-0066 D3), ni dans `offre` ni dans `accroche`. | Non corrigé : déclaré dans les limites du README. Aucune accroche ne contient « frais ». |
| 9 | mineur | « Trois cas » pour deux puces ; « 41 read, 0 mismatch » compte une attente remappée. | Corrigé : le README dit « 39 sont la ligne du même produit » et donne les quatre raisons ; la description de la PR aussi. |

Après ces corrections, le gate imprime 42 champs `a_relire` sur 23 fiches (32 sur 18 sur la base).

## Ce que ce dossier ne couvre pas

- Une relecture des corrections par une seconde passe.
- L'origine de chaque `promesse` : la revue compare les accroches au texte actuel des fiches, pas aux sources des fiches.
