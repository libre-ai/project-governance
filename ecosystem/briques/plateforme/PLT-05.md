# PLT-05 — Matrice de compatibilité

## Contexte

ADR-0042 §6 fait de la plateforme une promesse par palier, donnée après qualification par un parcours réel. ADR-0054 §3 nomme les cibles de P02 : trois moteurs de navigateur à trois largeurs, macOS réel, extension sur Chrome et Firefox réels (D90). ADR-0057 §4 étend à tous les produits la qualification macOS de P02 (D98). ADR-0006 fixe pour le Notebook une matrice matérielle à une seule classe de machine requise, et interdit d'extrapoler la preuve de cette classe aux classes non mesurées. ADR-0064 D7, encore proposé, ouvrirait le palier Linux d'un produit une fois ce produit prototypé sur macOS et sa matrice de parité verte. Aucun invariant n'est cité : la promesse de plateforme vient d'ADR-0042 §6.

## Ce que la brique ferme

- La mesure d'une classe de machine comptée pour une autre (ADR-0006) : le vérificateur cité refuse un hôte dont le système, l'architecture, la mémoire ou le nombre de processeurs sortent des bornes de la classe choisie.
- La mesure prise dans une machine virtuelle et présentée comme preuve physique : il la refuse aussi.

## Ce qu'elle ne fait pas

- Elle ne construit aucune coquille : sans PLT-02, aucune surface n'est à qualifier sur une cible.
- Elle ne compare pas un produit à ses références : la matrice de parité d'ADR-0042 §6 reste dans la fiche du produit.
- Elle ne fixe ni le plafond de mémoire ni le seuil d'accessibilité : PLT-02 et PLT-07.
- Elle n'ouvre aucun palier : le passage au palier Linux suit la règle qu'ADR-0064 D7 propose, et aucune preuve citée ne l'applique.

## Mesure

- Preuve citée : le vérificateur de classe de ressources du Notebook. Il lit le manifeste des classes, relève le matériel de l'hôte, refuse un hôte hors de la classe choisie, puis imprime la classe retenue, son niveau de preuve et l'empreinte du manifeste.
- Au commit cité, le manifeste qu'il lit porte trois classes, toutes sur macOS arm64 : une seule a un niveau de preuve qualifié, les deux autres attendent une mesure.
- Il montre une matrice matérielle pour un produit web. Il ne montre ni une matrice de coquille Tauri, ni un palier, ni le refus d'une plateforme promise sans qualification (ADR-0042 §6) : aucune preuve citée ne lit une promesse.
- Une copie du manifeste vit dans `project-governance`. Au 2026-11-11, `git grep notebook-resource-classes` n'y trouve, hors du manifeste, qu'un inventaire de données, deux fichiers de migration et un document de revue : aucun gate de ce dépôt ne la lit.
- Prochaine preuve : la fiche d'un produit qui liste ses cibles qualifiées, relue par un gate de flotte qui refuse une cible promise sans parcours.
