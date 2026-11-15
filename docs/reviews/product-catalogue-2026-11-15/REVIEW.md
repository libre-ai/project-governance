<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-minor-reservations

# Catalogue des produits en données : trois passes de revue de code, quatre audits des données

**Date :** 2026-11-15
**Objet :** le gate `ecosystem/check-produits.ts`, sa bibliothèque `ecosystem/produits.ts`, le schéma `ecosystem/schemas/produit.v1.schema.json`, ses vecteurs, leurs tests, leur câblage, et les données sous `ecosystem/produits/` (une fiche par produit du catalogue d'ADR-0042 §1).
**Nature :** dossier de revue d'une pull request écrite par des agents sur la consigne « Go » du propriétaire du 2026-11-15, après qu'il a choisi « un fichier par produit dans project-governance » comme source unique des définitions de produit. Ce dossier ne vaut pas arbitrage du propriétaire : il rend compte de ce qui a été relu, sur quel commit, et de ce qui ne l'a pas été.
**Rôles :** chaque passe est une passe de revue seule (`candidate-integration`), faite par un sous-agent à contexte neuf qui n'a pas écrit ce qu'il relit et n'a pas reçu les conclusions de l'auteur. Aucune n'a modifié un fichier suivi ; chacune a relevé l'état de l'arbre au début et à la fin. Auteurs et relecteurs sont de la même famille de modèles.

La ligne de verdict est celle des deux dernières passes, code et données. Elle ne couvre pas la relecture des fiches par le propriétaire, qui reste entière : voir « Ce qui reste au propriétaire ».

## Les passes

| Passe | Identifiant | Objet | Commit relu | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `product-catalogue-code-pass-1` | code, revue adverse | `648a32cbd308115e4fd109bd724481449e91d938` | `reject` |
| 1 | `product-catalogue-data-pass-1` | données, les 40 fiches | même commit | `reject` : 5 bloquants, 14 majeurs, 31 mineurs |
| 2 | `product-catalogue-code-pass-2` | code, revue adverse | `4189ee2fc14cd225946c1f6c820a499097bbe0ef` | `reject` : 1 majeur |
| 2 | `product-catalogue-data-pass-2` | données, les 40 fiches | même commit | `reject` : 3 bloquants, 13 majeurs, 57 mineurs |
| 3 | `product-catalogue-code-pass-3` | code, delta depuis la passe 2 | `749b9ea449c5285175c4a4c20b9f6b4f4fb4cd3d` | `approve-with-minor-reservations` |
| 3 | `product-catalogue-data-pass-3` | données, delta de 33 fiches | même commit | `reject` : 0 bloquant, 7 majeurs, 4 mineurs |
| 4 | `product-catalogue-data-pass-4` | données, delta de 10 fiches | `002c77646a946e79cfdbdcb94b350f07b504c1b7` | `approve-with-minor-reservations` |

Les totaux sont ceux que chaque relecteur a comptés. Ces commits sont des commits de la branche de travail ; la fusion par squash ne les garde pas.

Entre `749b9ea` et `002c776`, seules des fiches changent : `git diff --stat 749b9ea..002c776 -- . ':!ecosystem/produits/P*.v1.yaml'` ne rend aucune ligne. Le verdict de la passe 3 sur le code vaut donc pour `002c776`.

Empreintes relevées par la passe 3 (`shasum -a 256`), inchangées à `002c776` :

- `7c53ed24ead2fdbf747b72086706e3edf320db77e9f947ef4778741e4db6f7a2` pour `ecosystem/schemas/produit.v1.schema.json` ;
- `5a195ee691497b9476d1fd2de75f80516cbadf6c581c8b357c999a8696df8311` pour `ecosystem/fixtures/produits/vectors.v1.json`.

## Code : ce que chaque passe a trouvé, et ce qui a suivi

**Passe 1, `reject`.** Faux verts exécutés : un caractère de contrôle seul passait le schéma dans toute valeur de texte ; une source du gate (schéma, ADR-0042, inventaire) remplacée par un lien symbolique suivi était lue et attestée « as indexed », sur un arbre entièrement indexé ; une source absente de l'index et présente sur le disque était lue de même ; une ligne de catalogue indentée ou sans barre initiale n'exigeait pas de fiche ; les variables de redirection de git héritées détournaient la lecture vers un autre dépôt ; un chemin non fusionné faussait la somme des compteurs. Preuve requise : 11 mutations du schéma sur 12 laissaient les suites vertes.

Suite : le schéma refuse tout caractère de contrôle et exige un caractère visible ; chaque source est déclarée avec son état d'index, et un lien, une absence ou un fichier vide sont des échecs nommés ; les appels git des gates retirent les variables de redirection (le correctif est dans le code partagé avec la carte des briques et avec le générateur de la page vision) ; un chemin non fusionné a son compteur ; chaque contrainte du schéma a un vecteur invalide.

**Passe 2, `reject`.** Les défauts de la passe 1 sont fermés par sonde exécutée. Un défaut majeur : dans la section du catalogue, un tableau placé sous un sous-titre, ou une ligne à identifiant mal formé (`P 41`, `P100`, `p41`) ou sans identifiant, ajoutait un produit sans exiger de fiche. Mineurs : quatre des six variables de redirection n'étaient tenues par aucun test ; un schéma vide ou non JSON levait une exception sans ligne du gate ni compteurs ; deux caractères invisibles classés lettre ou symbole passaient pour visibles ; trois bornes du schéma n'étaient tenues par aucun vecteur.

Suite : la section du catalogue se ferme au prochain titre de niveau égal ou supérieur au sien ; toute ligne de tableau de la section est l'en-tête, la séparation ou une ligne lue en entier, sinon le gate échoue en la nommant ; le catalogue est l'union du lecteur du gate et de celui de la carte des briques, et un produit que l'un lit et pas l'autre est un échec ; le schéma est lu dans l'arbre jugé et une lecture impossible est un échec avec compteurs ; un test par variable de redirection ; un vecteur par borne.

**Passe 3, `approve-with-minor-reservations`.** Les sept constats de la passe 2 sont fermés par sonde. Vingt mutations de code rejouées par le relecteur : 19 rouges, 1 survivante. Neuf affaiblissements du schéma : 9 rouges dans la suite, 9 verts au gate (le gate valide avec le schéma suivi ; le schéma est gardé par ses vecteurs et par le gate de preuve de revue).

Réserves ouvertes, **non corrigées** :

- un titre de niveau égal ou supérieur placé dans un bloc de code ou un commentaire HTML de la section ferme la section pour les deux lecteurs ; un tableau placé après ajoute un produit sans exiger de fiche. Forme absente de l'ADR actuel, non déclarée au README du dossier ;
- un élément de ligne accepté peut contenir un second identifiant après une virgule ; si ce second produit est listé ailleurs, son second domaine n'est vu par personne ;
- sous un schéma suivi qui compile mais n'exige plus un champ, une fiche sans ce champ lève une exception : code 1, sans ligne du gate ni compteurs ;
- le contrôle « le schéma déclare des propriétés » n'est tenu par aucun test (la mutation survivante) ;
- le test qui compare l'énumération `realisation` aux valeurs employées par les fiches rougit quand une fiche change légitimement de type et qu'une valeur n'est plus employée ; le README ne le dit pas, et le test lit le disque alors que le gate lit l'index ;
- le test des exports du module fige la liste de ses consommateurs.

## Données : ce que les audits ont mesuré

Les 40 fiches ont été écrites par quatre sous-agents, dix produits chacun, puis corrigées en trois tours.

**Passe 1, `reject`.** Sans écart sur les 40 fiches : intitulé, catégorie, type de réalisation, dépôt porteur, libellé de fonction et étiquettes repris du site. Bloquants : deux dépendances inversées (le produit sert l'autre au lieu d'en dépendre), deux renvois à un document que le dépôt ne contient pas, deux outils de référence nommés. Majeurs : étiquettes du site plus affirmatives que leur source, réserves tombées, une fiche (P15) qui annonçait le remplacement de l'outil de tickets que sa charte refuse.

Suite : règles de sens écrites au README du dossier (`depend_de`, outils tiers, autorité de la fiche sur `fonction` et `etiquettes`) ; P15 bornée par sa charte ; étiquettes non soutenues réécrites et signalées dans `a_relire`.

**Passe 2, `reject`.** Trois bloquants : deux portaient sur les noms publics de P01 et P03, que le glossaire du dépôt ne porte pas ; ils ne sont pas retenus, ces noms étant des décisions du propriétaire du 2026-11-09 consignées dans le dépôt du site (le README du dossier le dit désormais). Le troisième, retenu : la fonction de P15 décrivait encore l'outil que sa charte refuse. Majeurs : étiquettes non soutenues, limites réelles supprimées au motif qu'elles ressemblaient à une consigne, dépendances traitées de façon non uniforme.

**Passe 3, `reject`.** Les quinze constats bloquants et majeurs retenus de la passe 2 sont fermés. Sept majeurs nouveaux, d'une même cause : le passage des limites à l'indicatif avait durci certaines d'entre elles ou fait tomber une réserve de la source.

**Passe 4, `approve-with-minor-reservations`.** Les sept majeurs sont fermés. Réserves mineures ouvertes, **non corrigées** : P17 `ne_fait_pas` (le partage reste borné à trois objets que la source ne nomme pas, et la construction est incorrecte) ; P14 `ne_fait_pas` (la limite sur les modèles métier est dite à sens unique) ; P28 `ne_fait_pas` (« absolue » tombé, « tous médias » cité sans autre occurrence dans la fiche).

## Ce que ce dossier ne couvre pas

- **Les sources des fiches ne sont pas dans ce dépôt.** Les audits ont confronté les fiches à deux documents de travail du propriétaire qui ne sont pas versionnés ici (les fiches détaillées de la vision produit d'octobre 2026 et le catalogue de la mission de spécification du même mois), au dépôt du site, à ADR-0042, ADR-0054, ADR-0055 et aux chartes de la carte des briques. Un tiers ne peut donc pas rejouer l'audit des données depuis ce dépôt seul. Les rapports complets des sept passes ne sont pas publiés ici pour la même raison : ils citent ces documents ligne à ligne.
- **Les omissions.** Les audits ont cherché ce qu'une fiche affirme de trop, pas ce qu'elle oublie de sa source.
- **La version de Bun.** Toutes les sondes ont tourné sous Bun 1.4.4 ; le dépôt épingle une révision 1.4.0. Aucune sonde n'a tourné sous la révision de la CI avant l'ouverture de la pull request.
- **Le workflow.** Le job `product-catalogue` de `brick-map.yml` n'avait jamais été exécuté au moment d'écrire ce dossier ; le workflow n'est pas un check requis, et `check:produits` n'est pas dans la chaîne `check`, comme `check:briques`.
- **`bun run check` complet** n'a pas été lancé localement ; les contrôles lancés un par un sont nommés dans la description de la pull request.
- **Défauts vus dans du code que la pull request ne corrige pas :** le lecteur du catalogue de `ecosystem/briques.ts` ferme la section à tout titre et ignore les lignes indentées ; `ecosystem/check-briques.ts` saute les entrées d'index non régulières quand il compare le disque à l'index, si bien qu'une source de la carte des briques en lien suivi y est encore lue ; la même comparaison applique les filtres d'attributs de git ; le motif de texte de `ecosystem/schemas/brique.v1.schema.json` laisse passer un caractère de contrôle seul.

## Ce qui reste au propriétaire

- **Relire les champs signalés.** Le gate compte 174 champs `a_relire` sur les 40 fiches : ce sont des propositions d'agent ou des valeurs reformulées. Par champ, compté sur les fiches à `002c776` : 40 `a_la_place_de`, 37 `ne_fait_pas`, 31 `depend_de`, 30 `pour_qui`, 23 `etiquettes`, 6 `capacites`, 5 `promesse`, 1 `fonction`, 1 `nom_provisoire`. Tant qu'un champ y figure, il n'a pas été relu.
- **P15.** La fiche est bornée par sa charte (capture et relais d'un signalement) ; son intitulé d'ADR-0042 reste « projets, tickets et support », et son nom provisoire est devenu « Signalement » alors que le site dit « Tickets ».
- **P02.** Commun sans revenu direct dans le catalogue d'octobre, offre hébergée payante dans ADR-0054.
- **P20.** Le sens du besoin est marqué « à confirmer » dans sa source ; la fiche le dit dans `ne_fait_pas`, faute d'autre champ.
- **Les noms publics.** Le glossaire `docs/decisions/LEXICON.md` ne porte pas les six noms tranchés, et « Corpus » (P03) y est aussi un nom réservé.
- **L'acceptation de la fusion**, qui vaut signature pour le schéma, entré dans la surface gardée.
