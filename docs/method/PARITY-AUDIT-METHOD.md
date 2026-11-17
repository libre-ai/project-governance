# Conduire un audit de parité — périmètre en union, quatre verdicts, absence prouvée, matrice comptée

Un audit de parité compare un produit à une ou plusieurs références libres
retenues. Cette méthode dit ce qu'un tel audit doit examiner, comment il
tranche chaque ligne, ce qui vaut preuve, et comment ses comptes se
recalculent. Elle ne remplace ni l'index de l'initiative
(`docs/parity/README.md`) ni les huit audits qu'il recense, qui gardent leur
format et leur statut ; elle vaut pour les audits écrits après elle.

Elle ne fixe aucune cible : la cible v1 d'un produit est réglée par I-27
(`docs/decisions/INVARIANTS.md`) et ADR-0027
(`docs/adr/0027-parity-gates-fire-only-after-dogfooding.md`), rappelés à la
section « Calibrage v1 et opposabilité (I-27) ».

## Périmètre (union)

Le périmètre de l'audit est l'**union** des fonctionnalités des références
retenues : une fonctionnalité présente chez une seule d'entre elles est une
ligne de la matrice au même titre qu'une fonctionnalité présente chez toutes.
Chaque ligne de l'union est **due à l'examen** : elle reçoit un statut par
référence et un verdict.

Une ligne ne sort du périmètre que d'une façon : par le verdict « exclure »,
motivé par une décision citée. Elle reste alors dans la matrice, numérotée et
comptée ; retirer une ligne du fichier n'est pas l'exclure.

L'union borne ce que l'audit **examine**, pas ce que le produit **doit
livrer**. Confondre les deux contredit I-27.

## Verdicts

Un verdict porte sur l'**idée** de la fonctionnalité, jamais sur le code d'une
référence. Aucun des quatre n'autorise à copier, traduire ou paraphraser du
code de référence.

| Verdict       | Sens                                                                                                              | Ce qu'il exige                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **reprendre** | comportement identique pour l'utilisateur, réécrit sur notre pile                                                 | une réécriture, ou une dépendance sous licence admise ; jamais le code de la référence          |
| **adapter**   | une contrainte du produit change ce que voit l'utilisateur ou ce que reçoit le modèle                             | la contrainte nommée, et l'écart de comportement qu'elle produit                                |
| **réécrire**  | conception propre : la fonction n'existe dans aucune source autorisée                                             | la conception, écrite avant le code                                                             |
| **exclure**   | la ligne sort du périmètre par décision                                                                           | l'identifiant de la décision (`D<n>`, `ADR-<nnnn>` ou `I-<nn>`) ; aucune source, aucun dépôt    |

Une exclusion sans décision citée est une omission, pas une exclusion. Une
exclusion qui porte une source se contredit : on ne cite pas où prendre ce
qu'on a décidé de ne pas faire. Que la décision citée justifie bien
l'exclusion se juge en revue ; aucun outil ne le mesure.

## Statuts et preuve d'absence

Chaque référence reçoit, pour chaque ligne, un statut parmi quatre :

| Statut         | Sens                                                                 |
| -------------- | -------------------------------------------------------------------- |
| **natif**      | la référence fournit la fonctionnalité sans extension ni contournement |
| **partiel**    | elle en fournit une partie ; la fiche de la ligne dit laquelle        |
| **absent**     | elle ne la fournit pas, et c'est prouvé                               |
| **non mesuré** | le code de la référence n'a pas été lu pour cette ligne               |

Toute autre valeur — une autre casse, « oui », une cellule vide — est comptée
sous `AUTRE`, à part, et jamais écartée du compte.

Un « absent » nomme, dans la cellule de preuve, les **motifs cherchés** et les
**chemins cherchés** dans le code de la référence :
`motifs: <ce qui a été cherché> ; chemins: <où>`. Sans les deux, il est
irrecevable : « je n'ai rien trouvé » ne dit ni ce qui a été cherché ni où.
Chaque étiquette ouvre son propre segment (séparé par `;`), une seule fois, et
porte un contenu qui contient au moins une lettre ou un chiffre : une étiquette
vide, suivie de l'autre étiquette ou de ponctuation seule ne prouve rien.

Un « non mesuré » se lève par lecture du code, jamais par la page de
fonctionnalités de la référence : une page de présentation dit ce qu'un
projet annonce, pas ce que son code fait.

## Présence et degré

La parité porte sur la **présence** d'une fonctionnalité. Son **degré** — le
nombre de langues d'interface, de langages pris en charge, de formats
d'import — ne fait pas d'elle plusieurs lignes et ne change pas son statut :
il se fixe dans la fiche de la ligne, avec sa justification.

## Versions figées

Une référence bouge. La matrice est figée à une **version nommée** de chaque
référence (étiquette ou révision), écrite dans l'en-tête de sa colonne de
statut. Un statut relevé à une autre version n'appartient pas à cette
matrice ; changer de version, c'est rejouer les lignes concernées, pas
corriger une cellule.

## Calibrage v1 et opposabilité (I-27)

Trois règles d'I-27 et d'ADR-0027 (décision D34 du registre) bornent tout
audit conduit selon cette méthode ; elle ne les redéfinit pas :

- un audit n'est **opposable** que s'il mesure du code livré. Un audit dont la
  colonne du produit a été remplie en lisant une spec reste « spec-baseline,
  non opposable » jusqu'à ré-exécution ;
- la **cible v1 opposable** est le MVP que l'audit recommande lui-même.
  L'étalon complet — ici, l'union — est l'horizon `proven`, jamais une
  exigence de v1 ;
- aucun gate fondé sur une comparaison de parité ne s'évalue avant le jalon
  dogfooding du produit.

Un audit conforme à cette méthode se termine donc par la recommandation de
son MVP, en numéros de lignes de sa matrice.

## Comptage par commande

La matrice est un fichier qui ne contient **que son tableau** : ni titre, ni
paragraphe. Ses lignes sont numérotées de 1 à N, dans l'ordre. Ses colonnes :

```
| # | fonctionnalité | <référence 1 @ version> | <référence 2 @ version> | verdict | décision | source | preuve |
```

Les deux premières et les quatre dernières colonnes sont fixes ; il y a une
colonne de statut par référence. « décision » ne se remplit que pour
« exclure » ; « source » nomme la source autorisée d'un « reprendre » ou d'un
« adapter » et reste vide pour « exclure ».

Aucun compte d'un audit ne s'écrit à la main. Il se recopie de la sortie de :

```
bun tools/parity/count-parity-matrix.ts <fichier-matrice>
```

La commande imprime `lignes`, un compteur par statut, `AUTRE`, un compteur par
verdict, `verdict_autre`, `absent_sans_preuve`, `exclure_sans_decision`,
`exclure_avec_source` et `structure`. Les compteurs de statut plus `AUTRE`
somment au nombre de lignes multiplié par le nombre de colonnes de statut ;
les deux nombres sont imprimés côte à côte.

| Code | Sens                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | matrice conforme                                                                                                                                                  |
| 1    | au moins un `AUTRE`, un verdict hors des quatre, une absence non prouvée, une exclusion sans décision ou avec source, ou un défaut de structure                   |
| 2    | usage, ou fichier absent ou illisible — jamais un zéro conforme                                                                                                   |

Ce que la commande ne mesure pas : qu'un « absent » l'était vraiment (il faut
le code de la référence), et qu'une décision citée justifie l'exclusion. Les
deux relèvent de la revue de la première matrice qui adopte cette méthode.
