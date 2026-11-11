# GOV-04 — Registre d'admission des modèles

## Contexte

ADR-0042 §1 inscrit au catalogue P33, routeur de modèles, et P34, assistant IA. ADR-0063, proposé, renvoie l'admission des modèles comme gate à un ADR candidat distinct. Le registre des invariants, lu le 2026-11-11, ne porte aucune règle d'admission d'un modèle. Le dépôt `ai-model-policy` porte un évaluateur : il confronte l'instantané des faits d'un modèle et un besoin à une politique approuvée, et rend un verdict. La fiche de ce dépôt, au commit cité, déclare que cet arbre n'est pas requalifié.

## Ce que la brique ferme

- Un fait manquant sur un modèle, lu comme un accord : l'évaluateur rend alors `indeterminate` ou `ineligible`, jamais `eligible`.
- Une politique approuvée par son auteur ou par un agent : l'évaluateur exige un approbateur humain, distinct de l'auteur.
- Un fait périmé lu comme valide : quand un fait porte une source, l'évaluateur refuse une date de collecte future, et une source plus ancienne que l'âge maximal de la règle.

## Ce qu'elle ne fait pas

- Elle ne fixe pas les critères d'admission : ils relèvent de GOV-16 et d'un ADR à écrire.
- Elle n'approuve aucune politique. Sans GOV-01, aucune politique n'est approuvée, donc aucun verdict n'est rendu.
- Elle ne route aucun appel de modèle : c'est la couche passerelle.
- Elle n'évalue pas la qualité d'un modèle.

## Mesure

Preuve citée : l'évaluateur de politique du dépôt `ai-model-policy`, épinglé par son sha. Il montre qu'une politique approuvée s'évalue contre les faits d'un modèle, et qu'un fait absent ne rend pas le modèle éligible. Il ne montre ni liste de modèles admis par produit, ni produit qui consulte un verdict.

Prochaine preuve : une liste des modèles admis par produit existe en données, et un gate fait échouer la construction d'un produit qui en appelle un autre.
