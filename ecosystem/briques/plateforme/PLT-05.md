# PLT-05 — Matrice de compatibilité

## Contexte

ADR-0042 §6 fait de la plateforme une promesse par palier, donnée après qualification par un parcours réel. ADR-0054 §3 nomme les cibles de P02 : trois moteurs de navigateur à trois largeurs, macOS réel, extension sur Chrome et Firefox réels (D90). ADR-0057 §4 étend à tous les produits la qualification macOS de P02 (D98). ADR-0006 fixe pour le Notebook une matrice matérielle à une seule classe de machine requise. ADR-0064 D7, encore proposé, ouvrirait le palier Linux d'un produit une fois ce produit prototypé sur macOS et sa matrice de parité verte. Aucun invariant n'est cité : la promesse de plateforme vient d'ADR-0042 §6.

## Ce que la brique ferme

- La plateforme promise sans qualification, ce qu'ADR-0042 n'autorise pas.
- La preuve d'une classe de machine extrapolée à une classe non mesurée (ADR-0006).
- Le palier Linux ouvert avant la fin du palier macOS, ou le palier macOS sauté : c'est la règle qu'ADR-0064 D7 propose.

## Ce qu'elle ne fait pas

- Elle ne construit aucune coquille : sans PLT-02, aucune surface n'est à qualifier sur une cible.
- Elle ne compare pas un produit à ses références : la matrice de parité d'ADR-0042 §6 reste dans la fiche du produit.
- Elle ne fixe ni le plafond de mémoire ni le seuil d'accessibilité : PLT-02 et PLT-07.

## Mesure

- Preuve citée : le vérificateur de classe de ressources du Notebook. Il classe la machine de mesure contre le manifeste des classes, puis imprime la classe retenue et son niveau de preuve.
- Il montre une matrice matérielle pour un produit web, pas une matrice de coquille Tauri ni un palier.
- Une copie du manifeste vit dans `project-governance`, où aucun gate ne la lit (`tools/quality/check-data-inventory.ts`).
- Prochaine preuve : la fiche d'un produit qui liste ses cibles qualifiées, relue par un gate de flotte.
