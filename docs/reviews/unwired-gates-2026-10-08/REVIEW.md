# Revue — un garde-fou de confidentialité déclaré actif et exécuté nulle part

**Date :** 2026-10-08
**Objet :** `tools/quality/check-no-transmission.ts`, les douze lignes d'ADR qui
le déclarent actif, et le déclencheur `pretest` du manifeste racine.
**Nature :** revue de mesure sur un diff de travail. Conformément à
`docs/reviews/README.md`, une revue antérieure à un commit immuable ne vaut que
comme constat préliminaire ; ce document porte des **mesures**, pas une
attestation de candidat.

## Ce qui a été mesuré, et comment

Clone frais de la branche servie, résolue et non supposée
(`git ls-remote --symref`, en-tête `ref:` de `HEAD`). Interrogation des
vingt-quatre dépôts que déclare `ecosystem/repositories.v1.yaml`, en une requête
GraphQL unique, sur l'expression `HEAD:package.json` — la forme résolue, jamais
un nom de branche écrit. Les probes d'existence de dépôt lisent le **code de
sortie**, jamais la sortie : le corps d'un 404 s'écrit sur la sortie standard,
de sorte qu'une sortie non vide ne prouve aucune présence.

## Constat 1 — le garde-fou n'est pas mort, son objet n'est pas ici

- Aucun fichier suivi sous `apps/` dans ce dépôt : l'objet historique du
  garde-fou (`apps/boussole/`, `apps/practices/`) est parti avec la répartition
  de l'ADR-0020.
- Sur les vingt-quatre dépôts de l'inventaire, vingt-deux portent un manifeste
  sur leur branche servie ; **exactement un** câble le garde-fou :
  `libre-ai/personal-knowledge-notebook`, en `check:no-transmission` scopé
  `apps/notebook/src`, à l'intérieur de sa chaîne `check` agrégée, et il
  l'atteint par `@libre-ai/governance` résolu sur **ce** dépôt.
- Les deux dépôts produits que le commentaire de `ci.yml` nommait comme points
  d'application ne résolvent plus.

Conséquence : l'éviction est exclue par la mesure — retirer le fichier casse la
chaîne d'un consommateur vivant. Et un câblage local est exclu aussi : ce dépôt
n'a aucune racine local-only, et une racine inventée pour avoir quelque chose à
scanner est précisément le défaut que ce garde-fou existe pour empêcher.

Ce qui manquait réellement : ce dépôt **publie un exécutable qu'il n'exécutait
jamais**. Les onze cas de test existants ne couvraient que le scanner pur ; la
moitié qu'un consommateur invoque — racines obligatoires, refus d'une racine
vide, saut des arbres vendorisés, ligne de volume — n'avait aucune couverture
d'exécution. C'est exactement cette moitié qui a échoué en silence de la
répartition jusqu'au 2026-08-04 : un glob vide, une phrase rassurante, code 0.

## Constat 2 — douze lignes d'ADR, six vraies, six fausses

Le relevé annonçait onze lignes dans quatre ADR ; le compte exact est **douze**
(ADR-0017 en porte cinq, pas quatre).

| ADR      | Lignes | Sujet     | Verdict mesuré                                                     |
| -------- | -----: | --------- | ------------------------------------------------------------------ |
| ADR-0012 |      2 | Notebook  | **vrai** — le câblage mesuré est celui que ces lignes enregistrent |
| ADR-0028 |      4 | Notebook  | **vrai** — récit daté du même câblage                              |
| ADR-0016 |      1 | Boussole  | **faux au présent** — aucun dépôt ne le câble pour Boussole        |
| ADR-0017 |      5 | Practices | **faux au présent** — ni l'arbre, ni le dépôt, ni son successeur   |

Les six lignes fausses sont corrigées par une note datée dans chaque ADR, selon
la forme que l'ADR-0012 D4 emploie déjà — le texte ratifié n'est pas réécrit, et
aucune décision n'est modifiée.

## Constat 3 — `pretest` est écrit et ne se déclenche jamais

- `check-bun-manifests.ts` **exige** le script : `pretest` doit valoir
  exactement `bun run check:bun`. Probé en le retirant : « package.json: pretest
  must enforce the Bun floor », 1 assertion sur 1 en échec. Le retirer n'est
  donc pas la correction.
- `pretest` ne se déclenche que sur `bun run test`. Probé : `bun test <fichier>`
  n'imprime pas le plancher Bun avant la suite — le hook ne part pas.
- Rectification du relevé : `check-bun-manifests` **était** exécuté par la
  chaîne. `check` commence par `bun run check:bun`, qui l'appelle, et
  `check:toolchain` le rappelle. Ce qui était mort, c'est `pretest` lui-même, et
  avec lui la garantie que `bun test` lancé seul vérifie le plancher.
- Correction : le maillon de la chaîne passe de `bun test` à `bun run test`, ce
  qui fait partir le hook. Verdict de `check-bun-manifests` dans `bun run
check` : deux occurrences avant, trois après.

## Constat 4 — le gate de code mort était aveugle par construction

Deux règles le rendaient incapable de voir du code que rien n'atteint :

- un fichier de test était traité comme **entrée**, donc un module atteignable
  depuis son seul test était déclaré atteint ;
- une **auto-mention** était traitée comme invocation : le bloc d'usage dans
  l'en-tête d'un script le nommait comme son propre appelant. Vérifié : la même
  ligne d'en-tête est capturée par les **deux** balayages de chemins, de sorte
  qu'exclure l'auto-mention dans un seul des deux ne change aucun verdict.

Ce qui les remplace est plus étroit et objectif : un module qui **se déclare
commande** (`import.meta.main`, un shebang, une lecture de la ligne de commande
du processus) est une entrée. C'est une propriété du code, pas de qui le
mentionne.

Mesure avant / après, les deux versions du gate lancées sur **le même arbre** —
147 sources examinées dans les deux cas, donc c'est bien le gate qui change et
non le corpus : ancienne version, 136 entrées découvertes, **zéro** constat,
« Dead code verified: 3 assertion(s) hold » ; nouvelle version, 82 entrées,
**deux** constats — `tools/convergence/anchor.ts` et
`tools/convergence/verify-proposals.ts`, 4 fichiers et 579 lignes dont les seuls
importateurs sont leurs deux fichiers de test.

La classe que ce gate ne sait toujours pas voir est énoncée dans son en-tête
plutôt que tue : un **exécutable que rien n'invoque** reste atteignable par
construction. Y répondre demande l'inventaire des appelants — c'est ce que la
mesure de flotte ci-dessus a fait à la main pour le garde-fou de
non-transmission.

Cette correction voyage dans **sa propre pull request**, et non avec les
constats 1 à 3 : elle rend `bun run check` rouge sur deux constats vrais, et les
résorber est une décision propriétaire (voir la section suivante). Les constats
1 à 3 sont verts et se livrent séparément — un rouge vrai ne doit pas retenir
une correction verte, et une correction verte ne doit pas servir à faire passer
un rouge.

## Ce que cette revue ne tranche pas

L'éviction de `tools/convergence/` n'est pas proposée ici. L'ADR-0019 §2 exige
que chaque entrée du registre d'oubli porte « son arbitrage propriétaire daté »,
et l'objet de ce code n'a pas disparu : l'hypothèse qu'il instrumente,
`convergence-requires-verbatim-anchoring`, est vivante au statut `draft` dans le
corpus de connaissance, avec son critère de succès chiffré et aucune mesure
encore enregistrée. Le constat du gate est juste ; la suite est une décision
propriétaire.

**Arbitrage rendu (2026-10-09) — option A, éviction.** Le propriétaire a tranché
sur les trois options présentées, en retenant comme argument contre l'option B le
refus d'écrire une interface de commande pour faire taire un gate : cela aurait
rendu le vert en fabriquant une fausse entrée, c'est-à-dire en reproduisant le
défaut même que la correction retire. L'entrée
`forgotten.convergence-anchor-instrument` est posée au registre d'oubli, datée de
cet arbitrage, ancrée sur un commit dont les quatre chemins ont été vérifiés
présents. Les mesures ci-dessus ne sont pas réécrites : elles sont la preuve sur
laquelle l'arbitrage a été rendu, et c'est à ce titre que ce fichier est inscrit
à la liste de citation autorisée du registre.
