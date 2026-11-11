# PRV-02 — Manifeste de provenance

## Contexte

I-20 veut des « releases liées à leur évidence » ; sa source est ADR-0009 §7. Le contrat `artifact-manifest.v1` de `schemas-and-contracts`, verrouillé au catalogue au commit cité, décrit un artefact par ses fichiers, leurs tailles, leurs empreintes et leurs types de média. Il exige une référence au rapport d'évidence pour un build ou une release. Le dépôt `artifact-verification` porte la bibliothèque Rust qui compare un candidat à son manifeste. Pour un build ou une release, elle exige un rapport d'évidence au verdict positif, lié au contenu par son empreinte.

## Ce que la brique ferme

- Le fichier changé, manquant ou ajouté entre la construction et l'intégration : tout écart de liste, de taille ou d'empreinte est un refus à code fermé.
- La release sans évidence, ou liée à l'évidence d'un autre contenu : le lien manquant ou inexact est refusé (I-20).
- L'empreinte calculée sur une forme non canonique : le document d'évidence est canonisé avant d'être haché.

## Ce qu'elle ne fait pas

- Elle n'établit pas la confiance : la bibliothèque reçoit le rapport d'évidence de l'appelant et ne vérifie aucune signature.
- Elle ne signe pas le manifeste : la signature est PRV-03.
- Elle ne dit pas ce qu'un modèle ou un jeu de données contient : c'est PRV-09.

## Mesure

- Preuves citées : le module de vérification de `artifact-verification` et le schéma du manifeste dans `schemas-and-contracts`, chacun épinglé à un commit. Ils montrent qu'un candidat se vérifie contre un manifeste et son évidence. Ils ne montrent aucun manifeste produit pour une release.
- Prochain fait observable : une release de la flotte publiée avec son manifeste et son rapport d'évidence, vérifiés par cette bibliothèque dans le workflow de release.
