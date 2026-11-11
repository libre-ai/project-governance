<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: reject

# Page vision générée depuis la carte des briques (ADR-0064 D6) : passes de revue de code

**Date :** 2026-11-11
**Objet :** le générateur `distribution/build-vision.ts`, sa suite, sa sortie suivie `distribution/vision/index.html`, la feuille de style `distribution/vision/vision.css`, le job de dérive de `.github/workflows/brick-map.yml`, et leur câblage (`tools/quality/check-data-inventory.ts`, `ecosystem/briques.ts`, les briques PUB-01 et FAB-13, la précision 13 d'ADR-0064).
**Nature :** dossier de revue d'une pull request écrite par un agent sur la consigne « go » du propriétaire du 2026-11-11. ADR-0064 reste au statut proposé : ce dossier ne vaut pas arbitrage du propriétaire. Il rend compte de ce qui a été relu, par qui, sur quel commit, et de ce qui ne l'a pas été.
**Rôles :** chaque passe est une passe de revue seule (`candidate-integration`), faite par un sous-agent à contexte neuf qui n'a pas écrit ce qu'il relit et n'a pas reçu les conclusions de l'auteur. Aucune n'a modifié un fichier suivi ; les empreintes de début et de fin sont dans chaque rapport. Aucun verdict de ce dossier n'est une approbation de promotion par rôle.

**Lecture de la ligne de verdict.** Elle porte le dernier verdict rendu par une passe : `reject`, passe 3, sur `fa6a085`. Les corrections qui ont suivi ne sont relues par aucune passe au moment où ce dossier est écrit, et une question que la revue ne peut pas trancher reste ouverte (la licence de la page). ADR-0056 D2 n'admet aucune « preuve requise » ouverte sous un verdict d'approbation : cette ligne ne peut changer qu'après la décision du propriétaire sur la licence et une passe fraîche sur la tête finale.

## Les passes

| Passe | Objet | Commit relu | Verdict | Rapport |
| --- | --- | --- | --- | --- |
| 1 | tout le diff, revue adverse | `ecc75f1abc6a990308303e792add82b465a06a67` | `reject` | `ecc75f1abc6a990308303e792add82b465a06a67/REVIEW.md` |
| 2 | delta de correction, puis le tout | `aa14e787f55d7f6455d964cef665aad85bddb4a8` | `approve-with-minor-reservations` | `aa14e787f55d7f6455d964cef665aad85bddb4a8/REVIEW.md` |
| 3 | delta de correction, et ce dossier | `fa6a085d7b048343e35d7df5081cc08b4589055b` | `reject` | `fa6a085d7b048343e35d7df5081cc08b4589055b/REVIEW.md` |

Ces commits sont des commits de la branche de travail. La fusion par squash ne les garde pas : les rapports citent les empreintes des fichiers, qui restent comparables.

## Ce que chaque passe a trouvé, et ce qui a suivi

**Passe 1, `reject`.** Un constat majeur : la page imprimait « vérifiée par le gate » sur la règle de la couche `gouvernance`, dont le gate vérifie une moitié et compte l'autre, alors que la même page nomme les briques que cette seconde moitié refuserait. Onze constats mineurs ou non bloquants : le statut d'ADR-0064 lu sur n'importe quelle ligne, et tout statut inconnu imprimé « encore proposé » ; trois phrases fausses du code (deux dans la précision 13 et la section qui la porte, une dans la fiche PUB-01) ; une suite qui laissait vivre 28 mutants sur 57 ; l'ADR lu sur le disque et non dans l'index ; deux racines différentes pour la carte et pour la page ; une déclaration d'inventaire par répertoire ; trois familles de valeurs imprimées sans échappement ; des champs de la carte absents de la page ; des accords faux ; la licence de la page ; des tableaux passés en `display: block`.

Suite, commit `aa14e78` : la table des couches porte un champ qui dit quelle part d'une règle est vérifiée, et la page l'imprime ; le statut est le premier mot de l'unique ligne de statut, et un statut que la page ne sait pas dire ne donne aucune page ; les phrases sont corrigées ; la suite pose un marqueur par champ et une valeur inhabituelle par compte ; l'ADR est lu dans l'index ; une seule racine ; deux chemins exacts à l'inventaire ; le slug et le statut sont échappés ; la page imprime la source d'une origine, un retrait et une marque transitoire ; les tableaux restent des tableaux dans une région nommée.

**Passe 2, `approve-with-minor-reservations`.** Aucun constat bloquant ni majeur. Les douze constats de la passe 1 sont resondés : huit tenus, trois partiellement, un laissé comme déclaré. Huit constats nouveaux, mineurs ou non bloquants : le mot « en vigueur », que la ligne de statut d'ADR-0064 annonce pour son acceptation, ne donne aucune page (échec fermé, message nommé) ; deux phrases de la classe déjà corrigée restaient fausses, et la fiche FAB-13 annonçait encore la page comme preuve à venir ; 38 mutants non équivalents sur 166 survivaient, dont les sept du bloc principal ; le sens imprimé de « en cours » disait plus que ce que le gate lancé par le générateur vérifie pour une citation épinglée ; un commentaire du gate affirmait que le volume et la page ne peuvent pas diverger sur la règle partielle ; un fichier déposé sous `distribution/vision/` et dont l'extension est du code pour l'inventaire n'était vu ni par l'inventaire ni par le job de dérive (`check:source` refuse déjà les quatre extensions JavaScript ; les autres passaient) ; les 99 briques tenaient sur une ligne du fichier suivi ; la légende de la matrice ne désignait les cellules que par leur aspect.

Suite, commit `fa6a085` : la précision 13 nomme les mots que le générateur lit ; les textes sont corrigés ; la lecture de l'ADR dans l'index devient une fonction testée sur un dépôt git temporaire ; la suite tient onze phrases du texte fixe, les colonnes de la table des couches, la diagonale de la matrice, les accords, les libellés des champs vides et les attributs `scope` ; « en cours » est défini par ce que le gate vérifie ; un test tient le champ de règle partielle à la seule couche `gouvernance` ; le job de dérive compare la liste des fichiers suivis ; chaque brique est sur sa propre ligne ; la légende dit en texte ce que chaque cellule porte.

**Passe 3, `reject`.** Aucun constat bloquant. Un constat majeur, introduit par le delta : la fixture git du nouveau test lançait `git init` et `git add --all` sans nettoyer l'environnement ; lancée depuis un hook de worktree lié, ou avec `GIT_DIR` posé, la suite remplaçait l'index du dépôt ambiant par les fichiers de la fixture, et restait verte (mesure de la passe : index de 932 entrées à 4). Ni la CI ni un clone simple ne le déclenchent, et aucun hook n'est suivi par le dépôt. Dix autres constats : une phrase de la fiche FAB-13 disait encore que la page n'est pas générée, et la phrase corrigée la disait « preuve de PUB-01 », ce qu'elle n'est pas ; la précision 13 nommait deux mots lus, le générateur en lit trois ; le test du texte fixe ne tenait que onze phrases, et ne vérifiait pas sous quel libellé un champ est imprimé ; le contrôle des fichiers suivis comparait des noms joints par des espaces, qu'un lien symbolique ou un nom fabriqué passaient ; trois phrases de ce dossier étaient fausses ou trop larges ; le bloc principal a quatre sites sans test, le dossier en déclarait deux ; la ligne de verdict du dossier portait une approbation alors qu'une « preuve requise » restait ouverte ; la séparation en deux lignes de la précision 13 tient à la mise en lignes du source ; la liste de mutations n'est pas sous un répertoire de commit.

Suite, **non relue par une passe indépendante au moment où ce dossier est écrit** :

- la fixture lance git avec un environnement déclaré, un dépôt par cas, et la lecture de l'ADR ne transmet plus les variables qui redirigent git ; un test pose `GIT_DIR` et `GIT_INDEX_FILE` vers un autre dépôt et exige que le dépôt demandé soit lu. Sonde rejouée par l'auteur : suite lancée avec ces deux variables pointées sur un dépôt témoin de deux fichiers → index du témoin inchangé (2 entrées), 43 tests verts ; même sonde contre la fixture de `fa6a085` → index du témoin remplacé par les trois fichiers de la fixture ;
- les deux phrases de FAB-13 sont corrigées, la carte a été balayée pour les autres mentions de la page (aucune autre) ;
- la précision 13 nomme les trois mots et dit que la séparation tient au source ;
- un libellé par champ et les titres, en-têtes et noms de région sont tenus par la suite ;
- le job de dérive compare les entrées d'index, mode compris, à deux fichiers réguliers. Rejoué par l'auteur dans des clones jetables, le bloc lu depuis le fichier du workflow : vert sans changement ; rouge pour un script suivi, un fichier en sous-répertoire, un lien symbolique à la place de la page, la feuille de style retirée, un fichier nommé comme les deux, un nom avec saut de ligne, une page exécutable ;
- ce dossier est corrigé sur les phrases que la passe 3 a trouvées fausses.

## Preuve de discrimination, rejouable

`evidence/mutations.json` liste 107 mutations par substitution de `distribution/build-vision.ts`. Chacune remplace une fois le texte `find` par le texte `replace` ; une mutation dont le `find` n'apparaît pas exactement une fois dans le fichier est inapplicable, ce qui compte comme un échec de la preuve. Pour chacune : appliquer, lancer `bun test distribution/build-vision.test.ts`, exiger au moins un test rouge, restaurer le fichier. Relevé du 2026-11-11 sur le commit qui ajoute cette version de la liste : 107 mutations, 107 font rougir la suite, 0 survit, 0 inapplicable ; 43 tests verts avant et après restauration. La passe 3 a rejoué les 94 premières sur `fa6a085` (94 rouges) et noté que deux d'entre elles font rougir la plupart des tests par une erreur de type plutôt que par une assertion, la forme sans plantage étant tuée par un test.

Cette liste est la preuve de l'auteur pour l'arbre qui la porte, pas l'évidence figée d'une passe : elle n'est pas sous un répertoire de commit, et elle périme dès que le générateur change. À rejouer avant de s'en servir.

Les passes ont écrit leurs propres mutants. La passe 3 en compte 58 sur le delta, dont 28 survivants (table de son rapport, point 3). L'auteur a ajouté depuis un test pour ceux qu'elle nomme, sauf pour les cinq du bloc principal et pour la fin du message de résumé ; un survivant est déclaré équivalent par la passe. Ce compte n'a pas été refait par une passe après correction.

Quatre sites du bloc principal du générateur ne sont exercés par aucun test : la racine prise à l'emplacement du script et non dans le répertoire courant, le code de sortie non nul quand aucune page n'est produite, le chemin où la page est écrite, et l'impression des motifs de refus. Les passes 2 et 3 les ont sondés à la main. Le job de dérive exerce la racine et le chemin d'écriture pour le seul cas où le répertoire courant est la racine et où la carte est verte ; rien n'exerce en CI la sortie non nulle ni l'impression des motifs.

## Ce qui reste ouvert, déclaré

- **Licence de la page — décision du propriétaire, qui tient le verdict.** `REUSE.toml` place `distribution/**` sous EUPL-1.2. La page reprend deux sortes de texte : les fiches, sous CC-BY-4.0 par `**/*.md`, et des champs des fichiers de couche (nom, rôle, charte), sous EUPL-1.2 par `ecosystem/**`. Elle est laissée sous la licence que la règle existante lui donne, celle des flux générés de `distribution/feeds/`. La passe 1 a classé la question « preuve requise » au sens d'ADR-0056 D2, comme décision de périmètre que la revue ne peut pas prendre, avec pour plus petit contrôle l'arbitrage du propriétaire.
- **Pas de `tabindex` sur les régions défilantes.** Le linter du dépôt refuse `tabindex` sur un élément non interactif. Dans un navigateur qui ne donne pas le focus à une région défilante, le défilement horizontal d'un tableau sur un écran étroit se fait au pointeur ou au toucher.
- **Aucun contrôle n'ouvre la page dans un navigateur.** L'auteur dit avoir regardé le rendu une fois (clair, sombre, largeur de téléphone) ; aucune passe ne peut le vérifier. Les passes ont vérifié la structure et calculé les contrastes des jetons, sans navigateur ni lecteur d'écran.
- **Les compteurs sont imprimés sans échappement.** Ils sont typés `number` et calculés par le gate ; aucun chemin de données ne les atteint.
- **Le sens de « en cours » dépend d'un autre gate pour 40 briques sur 73** (passe 2, N4) : leurs seules preuves sont des citations épinglées, que le gate des citations résout. Le générateur ne lit pas ce verdict ; la page dit que ce gate les résout de son côté, sans dire que son verdict n'est pas lu.
- **Le gate de la carte hérite de l'environnement git de l'appelant.** `ecosystem/check-briques.ts`, fusionné avant cette pull request et hors de son objet, lance git sans retirer `GIT_DIR` : appelé par le générateur depuis un hook de worktree lié, il lit le dépôt que ces variables désignent. Il n'écrit rien.
- **La séparation en deux lignes de la précision 13** tient à la mise en lignes du source : les joindre fait compter ADR-0064 comme admis par le gate de doctrine (voir ci-dessous).
- **Trois lectures de D6 laissées au propriétaire**, écrites dans la précision 13 d'ADR-0064 : `vision.md` non remplacé, publication « privée d'abord » non réalisée au sens strict, texte fixe de la page écrit dans le générateur.
- **Le workflow `brick-map.yml` n'est pas un check requis** (état des rulesets non relu par les passes).

## Ce que la revue a trouvé hors de son objet

Non corrigé ici :

- le gate de doctrine (`tools/quality/check-doctrine-governance.sh`) tient pour admis tout ADR dont une ligne quelconque porte le nom du champ de statut suivi du mot d'acceptation, pas seulement sa ligne de statut. Mesuré en écrivant la précision 13 : une phrase qui nommait les deux sur une même ligne a fait passer le compte du gate de 54 à 55 ADR admis, ADR-0064 compris, sans que sa ligne de statut change ; la phrase a été coupée en deux lignes avant tout commit, et le compte est revenu à 54. La passe 3 l'a reproduit en joignant les deux lignes. Le générateur de la page lisait le statut de la même façon avant la passe 1 ; il ne lit plus que la ligne de statut.
