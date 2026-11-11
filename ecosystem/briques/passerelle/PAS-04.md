# PAS-04 — Routeur de modèles

## Contexte

Le catalogue d'ADR-0042 nomme P33, routeur de modèles, et le sort du gel (D52). ADR-0058 le range parmi les produits qui déclarent un appel de modèle (D99), et ADR-0063 propose de renverser ce choix de runtime. Aucun dépôt de la flotte ne porte de routeur. Le dépôt `ai-model-policy` évalue un usage prévu contre une politique, et ne route aucun appel. Cette fiche décrit la méthode de routage. Le produit P33 reste hors de la carte tant qu'il n'a pas de charte.

## Ce que la brique ferme

- L'appel vers un modèle non admis : le routeur ne choisit que dans le registre d'admission de GOV-04.
- La donnée routée hors de sa zone : la classe de PAS-02 borne les cibles, et une donnée personnelle reste locale (I-21).
- Le secours qui change de territoire : la cible de repli obéit aux mêmes règles de classe et de zone (I-07).

## Ce qu'elle ne fait pas

- Elle n'admet aucun modèle : l'admission est une décision de GOV-04.
- Elle ne sert aucun modèle : le serveur local est EXE-03.
- Elle ne lit pas le contenu de l'appel : elle décide sur les métadonnées que PAS-01 lui présente.

## Mesure

- Preuve citée : aucune. Aucun routeur n'existe dans la flotte.
- Prochaine preuve : un test publié où le routeur refuse une cible absente du registre d'admission, puis bascule vers une cible admise de la même zone quand la première ne répond pas.
