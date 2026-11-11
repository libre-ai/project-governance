# PRV-09 — Nomenclature des modèles et données

## Contexte

ADR-0021 (D30) donne à la flotte l'état du monde des avis de sécurité sur les dépendances de code : un contrôle périodique notifie, et le gate par demande de fusion juge ce que la demande introduit. Cet ADR ne porte pas sur les modèles, les poids ni les jeux de données : la nomenclature est une proposition de l'agent, non arbitrée. Aucun invariant du registre ne lie la brique. I-11 et I-21 touchent aux licences et aux données d'instance ; ils sont voisins et ne sont pas cités. L'inventaire de la flotte donne à `ai-model-policy` la sélection de modèle sous politique explicable ; ce dépôt n'est pas déclaré porteur ici.

## Ce que la brique ferme

Aucune de ces fermetures n'est réalisée : la brique n'a ni dépôt porteur ni preuve.

- Le modèle ou le jeu de données dont personne ne sait dire la licence : chaque entrée porterait la sienne.
- Le poids remplacé sans trace : chaque entrée porterait une empreinte et une source.
- L'avis publié sur un modèle déjà embarqué, que rien ne relie au produit.

## Ce qu'elle ne fait pas

- Elle ne refait pas l'inventaire des dépendances de code : ADR-0021 le confie au contrôle de flotte et au gate par demande de fusion.
- Elle n'admet ni ne refuse un modèle : l'admission est GOV-04.
- Elle ne vérifie pas la signature des poids : c'est PRV-10.

## Mesure

- Preuve citée : aucune. Dans les noms de fichiers des dépôts publics de l'inventaire, lus par l'API de la forge le 2026-11-11, aucun ne contient `sbom`, `nomenclature`, `cyclonedx`, `spdx` ni `model-card`.
- Prochain fait observable : un fichier de nomenclature dans le dépôt d'un produit qui appelle un modèle, validé par un gate qui échoue sur une entrée sans empreinte ou sans licence.
