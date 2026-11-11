# PRV-02 — Manifeste de provenance

## Contexte

I-20 veut que chaque release soit liée à l'évidence qui l'a autorisée (ADR-0009 §7). Le contrat `artifact-manifest.v1` de `schemas-and-contracts` décrit un artefact par ses fichiers, leurs tailles et leurs empreintes. Le dépôt `artifact-verification` porte la bibliothèque Rust qui compare un candidat à son manifeste. Pour un build ou une release, elle exige un rapport d'évidence positif, lié au contenu par son empreinte. Aucune release de la flotte ne porte encore de manifeste.

## Ce que la brique ferme

- Le fichier changé, manquant ou ajouté entre la construction et l'intégration : tout écart de liste, de taille ou d'empreinte est un refus à code fermé.
- La release sans évidence, ou liée à l'évidence d'un autre contenu : le lien manquant ou inexact est refusé (I-20).
- L'empreinte calculée sur une forme non canonique : le document est canonisé avant d'être haché, comme I-10 l'exige d'une exportation (ADR-0049, D71).

## Ce qu'elle ne fait pas

- Elle n'établit pas la confiance : l'application choisit l'évidence et les clés auxquelles elle se fie.
- Elle ne signe pas le manifeste : la signature est PRV-03.
- Elle ne dit pas ce qu'un modèle ou un jeu de données contient : c'est PRV-09.

## Mesure

- Preuves citées : le module de vérification de `artifact-verification` et le schéma du manifeste dans `schemas-and-contracts`, chacun épinglé à un commit. Ils montrent qu'un candidat se vérifie contre un manifeste et son évidence. Ils ne montrent aucun manifeste produit pour une release.
- Prochain fait observable : une release de la flotte publiée avec son manifeste et son rapport d'évidence, vérifiés par cette bibliothèque dans le workflow de release.
