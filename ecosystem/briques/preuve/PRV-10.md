# PRV-10 — Signature des modèles

## Contexte

Aucun invariant ni aucun ADR en vigueur ne porte la signature des modèles. ADR-0063, encore proposé, range l'admission des modèles par gate, signature comprise, parmi ce qu'il ne décide pas. I-10 pose le principe voisin pour les exportations : hors de son contexte de confiance, un contenu s'authentifie par signature, jamais par une empreinte nue. Aucun dépôt de la flotte ne vérifie la signature d'un fichier de poids.

## Ce que la brique ferme

- Les poids substitués entre leur éditeur et le poste : une empreinte publiée à côté du fichier ne prouve pas qui l'a publiée.
- Le modèle chargé avant vérification : la signature se vérifie avant tout chargement, avec refus fermé.
- Le modèle sans origine : un modèle non signé n'est pas chargé.

## Ce qu'elle ne fait pas

- Elle ne juge pas le modèle : licence, poids ouverts et hébergement relèvent de l'admission, GOV-04.
- Elle ne tient pas la liste des modèles : c'est PRV-09, qui fournit l'empreinte signée.
- Elle ne gère pas les clés de confiance : c'est PRV-04. Elle reprend le mécanisme de PRV-03.

## Mesure

- Preuve citée : aucune. Aucune décision en vigueur ne fonde la brique, et aucun code ne vérifie la signature d'un modèle.
- Prochain fait observable : un ADR accepté sur l'admission des modèles, puis un test où un fichier de poids à signature absente ou invalide est refusé avant chargement.
