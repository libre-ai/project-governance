# PLT-05 — Matrice de compatibilité

## Contexte

ADR-0042 §6 fait de la plateforme une promesse par palier, donnée après qualification par un parcours réel. ADR-0054 §3 nomme les cibles de P02 : trois moteurs de navigateur à trois largeurs, macOS réel, extension sur Chrome et Firefox réels (D90). ADR-0006 fixe pour le Notebook une matrice matérielle à une seule classe de machine requise. ADR-0064 D7, encore proposé, ouvre le palier Linux d'un produit quand il est prototypé sur macOS et que sa matrice de parité y est verte. Aucune matrice par produit n'existe en données.

## Ce que la brique ferme

- La plateforme promise sans qualification, ce qu'ADR-0042 n'autorise pas.
- La preuve d'une classe de machine extrapolée à une classe non mesurée (ADR-0006).
- Le palier Linux ouvert avant la fin du palier macOS, ou le palier macOS sauté (ADR-0064 D7).
- La parité jugée sur une spécification et non sur du code livré (I-27).

## Ce qu'elle ne fait pas

- Elle ne construit aucune coquille : PLT-02.
- Elle ne compare pas un produit à ses références : la matrice de parité d'ADR-0042 §6 reste dans la fiche du produit.
- Elle ne fixe ni le plafond de mémoire ni le seuil d'accessibilité : PLT-02 et PLT-07.

## Mesure

- Preuve citée : le vérificateur de classe de ressources du Notebook. Il classe la machine de mesure contre le manifeste des classes, puis imprime la classe retenue et son niveau de preuve.
- Il montre une matrice matérielle pour un produit web, pas une matrice de coquille Tauri ni un palier.
- Une copie du manifeste vit dans `project-governance`, où aucun gate ne la lit.
- Prochaine preuve : la fiche d'un produit qui liste ses cibles qualifiées, relue par un gate de flotte.
