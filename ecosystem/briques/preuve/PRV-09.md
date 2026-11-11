# PRV-09 — Nomenclature des modèles et données

## Contexte

La flotte tient une nomenclature pour son code seulement. Un gate applique la politique de dépendances de chaque dépôt : licences, sources et interdits. Un contrôle périodique de flotte porte l'état du monde des avis de sécurité (I-26, ADR-0021, D30). Rien de tel n'existe pour les modèles, leurs poids et les jeux de données. Le dépôt `ai-model-policy` valide des faits sourcés sur un modèle pour évaluer une politique, sans lister ce qu'un produit embarque.

## Ce que la brique ferme

- Le modèle ou le jeu de données dont personne ne sait dire la licence : chaque entrée porte la sienne, comme I-11 l'exige du code.
- Le poids remplacé sans trace : chaque entrée porte une empreinte et une source.
- L'avis publié sur un modèle déjà embarqué, que rien ne relie au produit : la nomenclature est ce qu'un contrôle de flotte lirait, sur le modèle d'I-26.
- La donnée d'instance glissée dans un dépôt sous le nom de jeu de données : la nomenclature référence, elle ne contient pas (I-21).

## Ce qu'elle ne fait pas

- Elle n'admet ni ne refuse un modèle : l'admission est GOV-04.
- Elle ne vérifie pas la signature des poids : c'est PRV-10.
- Elle ne refait pas la nomenclature du code, que les gates de dépendances tiennent déjà.

## Mesure

- Preuve citée : aucune. Les gates de dépendances couvrent le code, pas les modèles ni les données.
- Prochain fait observable : un fichier de nomenclature dans le dépôt d'un produit qui appelle un modèle, validé par un gate qui échoue sur une entrée sans empreinte ou sans licence.
