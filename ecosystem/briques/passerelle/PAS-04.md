# PAS-04 — Routeur de modèles

## Contexte

Le catalogue d'ADR-0042 §1 nomme P33, routeur de modèles, et le sort du gel (D52). ADR-0058 le compte parmi les produits dont la fiche déclare un appel de modèle (D99). ADR-0063, encore proposé, renverserait ce choix de runtime pour les produits. Cette fiche décrit la méthode de routage, pas le produit P33, qui n'est pas une brique de la carte. L'inventaire de la flotte donne à `ai-model-policy` la sélection de modèle sous politique explicable ; ce dépôt n'est pas déclaré porteur ici. La brique dépend de GOV-04 : sans registre d'admission, elle n'a pas de liste de cibles admises. Elle dépend de PAS-02 : sans classe ni zone, elle n'a pas de critère de choix. Elle dépend de PAS-01 : sans point de contrôle, aucun appel ne lui parvient sous forme de métadonnées.

## Ce que la brique ferme

Cette fiche ne cite aucune preuve et la carte ne donne à la brique aucun dépôt porteur : aucune des fermetures ci-dessous n'est montrée réalisée.

- L'appel vers un modèle non admis : le routeur ne choisirait que dans le registre d'admission de GOV-04.
- La donnée personnelle routée hors de l'appareil : I-21 veut que « les données concernant une personne physique restent sur le device de leur détenteur ».
- Le secours qui change de zone : la cible de repli obéirait aux mêmes règles de classe et de zone.

## Ce qu'elle ne fait pas

- Elle n'admet aucun modèle : l'admission est une décision de GOV-04.
- Elle ne sert aucun modèle : le serveur local est EXE-03.
- Elle ne lit pas le contenu de l'appel.

## Mesure

- Preuve citée : aucune.
- Prochaine preuve : un test publié où le routeur refuse une cible absente du registre d'admission, puis bascule vers une cible admise de la même zone quand la première ne répond pas.
