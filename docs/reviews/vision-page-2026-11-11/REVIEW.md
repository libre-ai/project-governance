<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-minor-reservations

# Page vision générée depuis la carte des briques (ADR-0064 D6) : passes de revue de code

**Date :** 2026-11-11
**Objet :** le générateur `distribution/build-vision.ts`, sa suite, sa sortie suivie `distribution/vision/index.html`, la feuille de style `distribution/vision/vision.css`, le job de dérive de `.github/workflows/brick-map.yml`, et leur câblage (`tools/quality/check-data-inventory.ts`, `ecosystem/briques.ts`, la brique PUB-01, la précision 13 d'ADR-0064).
**Nature :** dossier de revue d'une pull request écrite par un agent sur la consigne « go » du propriétaire du 2026-11-11. ADR-0064 reste au statut proposé : ce dossier ne vaut pas arbitrage du propriétaire. Il rend compte de ce qui a été relu, par qui, sur quel commit, et de ce qui ne l'a pas été.
**Rôles :** chaque passe est une passe de revue seule (`candidate-integration`), faite par un sous-agent à contexte neuf qui n'a pas écrit ce qu'il relit et n'a pas reçu les conclusions de l'auteur. Aucune n'a modifié un fichier suivi ; les empreintes de début et de fin sont dans chaque rapport. Ce verdict n'est pas une approbation de promotion par rôle.

## Les passes

| Passe | Objet | Commit relu | Verdict | Rapport |
| --- | --- | --- | --- | --- |
| 1 | tout le diff, revue adverse | `ecc75f1abc6a990308303e792add82b465a06a67` | `reject` | `ecc75f1abc6a990308303e792add82b465a06a67/REVIEW.md` |
| 2 | delta de correction, puis le tout | `aa14e787f55d7f6455d964cef665aad85bddb4a8` | `approve-with-minor-reservations` | `aa14e787f55d7f6455d964cef665aad85bddb4a8/REVIEW.md` |

Ces commits sont des commits de la branche de travail. La fusion par squash ne les garde pas : les rapports citent les empreintes des fichiers, qui restent comparables.

## Ce que chaque passe a trouvé, et ce qui a suivi

**Passe 1, `reject`.** Un constat majeur : la page imprimait « vérifiée par le gate » sur la règle de la couche `gouvernance`, dont le gate vérifie une moitié et compte l'autre, alors que la même page nomme les briques que cette seconde moitié refuserait. Onze constats mineurs ou non bloquants : le statut d'ADR-0064 lu sur n'importe quelle ligne, et tout statut inconnu imprimé « encore proposé » ; trois phrases de la précision 13 et de la fiche PUB-01 fausses du code ; une suite qui laissait vivre 28 mutants sur 57 (comptes saisis, champs non imprimés, échappements retirés) ; l'ADR lu sur le disque et non dans l'index ; deux racines différentes pour la carte et pour la page ; une déclaration d'inventaire par répertoire ; trois familles de valeurs imprimées sans échappement ; des champs de la carte absents de la page ; des accords faux ; la licence de la page ; des tableaux passés en `display: block`.

Suite, commit `aa14e78` : la table des couches porte un champ qui dit quelle part d'une règle est vérifiée, et la page l'imprime ; le statut est le premier mot de l'unique ligne de statut, et un statut que la page ne sait pas dire ne donne aucune page ; les trois phrases sont corrigées ; la suite pose un marqueur par champ et une valeur inhabituelle par compte ; l'ADR est lu dans l'index ; une seule racine ; deux chemins exacts à l'inventaire ; le slug et le statut sont échappés ; la page imprime la source d'une origine, un retrait et une marque transitoire ; les tableaux restent des tableaux dans une région nommée. La licence est laissée telle que déclarée (voir « Ce qui reste ouvert »).

**Passe 2, `approve-with-minor-reservations`.** Aucun constat bloquant ni majeur. Les douze constats de la passe 1 sont resondés : huit tenus, trois partiellement, un laissé comme déclaré. Huit constats nouveaux, mineurs ou non bloquants : le mot « en vigueur », que la ligne de statut d'ADR-0064 annonce pour son acceptation, ne donne aucune page (échec fermé, message nommé) ; deux phrases de la classe déjà corrigée restaient fausses, dans le rôle de PUB-01 et dans l'en-tête du générateur, et la fiche FAB-13 annonçait encore la page comme preuve à venir ; 38 mutants non équivalents sur 166 survivaient, dont les sept du bloc principal ; le sens imprimé de « en cours » disait plus que ce que le gate lancé par le générateur vérifie pour une citation épinglée ; le commentaire du gate affirmait que le volume et la page ne peuvent pas diverger sur la règle partielle, ce qui est faux si le champ est posé ailleurs ; un script déposé sous `distribution/vision/` n'était vu par rien ; les 99 briques tenaient sur une ligne du fichier suivi ; la légende de la matrice ne désignait les cellules que par leur aspect.

Suite, **non relue par une passe indépendante au moment où ce dossier est écrit** : la précision 13 dit quel mot le générateur lit ; les trois textes sont corrigés ; la lecture de l'ADR dans l'index est une fonction testée sur un dépôt git temporaire ; la suite verrouille le texte fixe de la page, les colonnes de la table des couches, la diagonale de la matrice, les accords, les libellés des champs vides, les attributs `scope`, et les cas de `standingOf` qui survivaient ; « en cours » est défini par ce que le gate vérifie ; un test tient le champ de règle partielle à la seule couche `gouvernance` ; le job de dérive refuse tout fichier suivi autre que la page et sa feuille de style ; chaque brique est sur sa propre ligne ; la légende dit en texte ce que chaque cellule porte.

## Preuve de discrimination, rejouable

`evidence/mutations.json` liste 94 mutations par substitution de `distribution/build-vision.ts`. Chacune remplace une fois le texte `find` par le texte `replace` ; une mutation dont le `find` n'apparaît pas exactement une fois dans le fichier est inapplicable, ce qui compte comme un échec de la preuve. Pour chacune : appliquer, lancer `bun test distribution/build-vision.test.ts`, exiger au moins un test rouge, restaurer le fichier. Relevé du 2026-11-11 sur le commit qui ajoute ce dossier : 94 mutations, 94 font rougir la suite, 0 survit, 0 inapplicable ; 41 tests verts avant et après restauration. La liste périme dès que le générateur change : à rejouer avant de s'en servir.

Deux sites ne sont couverts par aucune mutation tuée, et aucun test ne les exerce : la racine du dépôt prise à l'emplacement du script et non dans le répertoire courant, et le code de sortie non nul quand aucune page n'est produite. La passe 2 les a sondés à la main (générateur lancé depuis trois répertoires, carte rouge, statut illisible : sorties dans son rapport) ; le job de dérive les exerce pour le seul cas où le répertoire courant est la racine.

## Ce qui reste ouvert, déclaré

- **Licence de la page (passe 1, C11 ; preuve requise au sens d'ADR-0056 D2, décision de périmètre).** `REUSE.toml` place `distribution/**` sous EUPL-1.2, et les fiches que la page reprend sous CC-BY-4.0 par `**/*.md`. La page est laissée sous la licence que la règle existante lui donne, celle des flux générés de `distribution/feeds/`, qui reprennent eux aussi des textes sous CC-BY-4.0. Le même titulaire déclare les deux. Passer la page sous CC-BY-4.0, comme `brand/projections/**`, est une ligne de `REUSE.toml` et une décision du propriétaire ; le sens inverse ne se reprend pas pour les copies déjà prises.
- **Pas de `tabindex` sur les régions défilantes.** Le linter du dépôt refuse `tabindex` sur un élément non interactif. Dans un navigateur qui ne donne pas le focus à une région défilante, le défilement horizontal d'un tableau sur un écran étroit se fait au pointeur ou au toucher.
- **Aucun contrôle n'ouvre la page dans un navigateur.** Le rendu a été regardé une fois par l'auteur (clair, sombre, largeur de téléphone) ; les passes ont vérifié la structure et calculé les contrastes des jetons, sans navigateur ni lecteur d'écran.
- **Les compteurs sont imprimés sans échappement.** Ils sont typés `number` et calculés par le gate ; aucun chemin de données ne les atteint.
- **Le sens de « en cours » dépend d'un autre gate pour 40 briques sur 73** (passe 2, N4) : leurs seules preuves sont des citations épinglées, que le gate des citations résout. Le générateur ne lit pas ce verdict ; la page le dit.
- **Trois lectures de D6 laissées au propriétaire**, écrites dans la précision 13 d'ADR-0064 : `vision.md` non remplacé, publication « privée d'abord » non réalisée au sens strict, texte fixe de la page écrit dans le générateur.
- **Le workflow `brick-map.yml` n'est pas un check requis.**

## Ce que la revue a trouvé hors de son objet

Non corrigé ici :

- le gate de doctrine (`tools/quality/check-doctrine-governance.sh`) tient pour admis tout ADR dont une ligne quelconque porte le nom du champ de statut suivi du mot d'acceptation, pas seulement sa ligne de statut. Mesuré en écrivant la précision 13 : une phrase qui nommait les deux sur une même ligne a fait passer le compte du gate de 54 à 55 ADR admis, ADR-0064 compris, sans que sa ligne de statut change ; la phrase a été coupée en deux lignes avant tout commit, et le compte est revenu à 54. Le générateur de la page lisait le statut de la même façon avant la passe 1 ; il ne lit plus que la ligne de statut.
