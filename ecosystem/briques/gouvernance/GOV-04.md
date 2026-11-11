# GOV-04 — Registre d'admission des modèles

## Contexte

Le catalogue d'ADR-0042 §1 compte un routeur de modèles et un assistant, sans règle d'admission. ADR-0063 et ADR-0064 nomment l'admission des modèles comme un ADR candidat distinct, qui n'est pas écrit. Aucun invariant ne la régit. Le dépôt `ai-model-policy` porte un évaluateur : il confronte l'instantané des faits d'un modèle à une politique approuvée et rend un verdict. Sa fiche déclare que cet arbre n'est pas requalifié. Aucune liste de modèles admis par produit n'existe.

## Ce que la brique ferme

- Un produit qui appelle un modèle que personne n'a admis.
- Un fait manquant sur un modèle, lu comme un accord : l'évaluateur le rend indéterminé ou inéligible.
- Une admission prononcée sans source : chaque fait d'un instantané porte la sienne.

## Ce qu'elle ne fait pas

- Elle ne fixe pas les critères d'admission : ils relèvent de GOV-16 et d'un ADR à écrire.
- Elle ne route aucun appel de modèle : c'est la couche passerelle.
- Elle n'évalue pas la qualité d'un modèle.
- Elle ne bloque aujourd'hui aucune construction : aucun gate ne lit de liste d'admission.

## Mesure

Preuve citée : l'évaluateur de politique du dépôt `ai-model-policy`, épinglé au commit de sa branche servie. Il montre qu'une politique approuvée s'évalue contre les faits d'un modèle, avec refus par défaut. Il ne montre ni liste de modèles admis, ni produit qui la consulte.

Prochaine preuve : une liste des modèles admis par produit existe en données, et un gate fait échouer la construction d'un produit qui en appelle un autre.
