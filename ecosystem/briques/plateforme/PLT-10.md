# PLT-10 — Interface générée sous catalogue fermé

## Contexte

Un assistant qui « montre ses sources et demande avant d'agir » (fiche P34) aura à afficher plus que du texte : un plan d'action à examiner, des résultats à comparer, un formulaire à remplir. Quand c'est un modèle qui décrit cette interface, la description est la sortie d'un composant exposé à du contenu non fiable. I-32 exige qu'une telle sortie soit « validée par schéma à vocabulaire fermé » et qu'aucune chaîne dérivée d'un contenu non fiable n'entre dans le contexte d'un modèle qui détient un outil à effet ; ADR-0045 en est la source, et I-32 couvre les produits comme la forge.

La forme vient d'une lecture du protocole A2UI (`a2ui-project/a2ui`, Apache-2.0, révision `5ff1b05` lue le 2026-11-23, rien exécuté) : l'agent décrit des composants dans une liste plate, le client les valide contre un catalogue fermé puis les rend avec ses propres widgets. Cette lecture a aussi mesuré ce que la brique doit faire autrement. La validation d'A2UI y est permissive par défaut. Une fonction que le client n'implémente pas y part vers l'agent, même depuis une liaison passive. L'agent y décide quelles données le client lui renvoie. Une image peut y être chargée depuis n'importe quel hôte. Son catalogue d'outils MCP déclenche des outils sans geste de la personne.

ADR-0057 fixe un seul moteur de rendu pour toute la flotte : la portabilité vers plusieurs frameworks, argument central d'A2UI, n'est pas reprise. La carte qu'elle complète applique ADR-0064, encore proposé.

Cette brique est ajoutée sur décision du propriétaire du 2026-11-23, qui a aussi retenu un contrat propre à la flotte plutôt qu'un profil d'A2UI.

## Ce que la brique ferme

Aucune preuve n'est citée : ces points disent ce que la brique fermerait.

- La description d'interface acceptée parce que le validateur était mal réglé : la validation est stricte sans option qui l'assouplisse, un composant ou une fonction hors du catalogue fait refuser la surface entière, et un refus sort en code fermé, jamais en texte libre (I-32).
- Le catalogue qui diverge entre l'agent et le produit sous un même nom : il est désigné par son identifiant et par l'empreinte de son contenu.
- Le contrat dont les bornes dépendent de l'implémentation : profondeur, nombre de composants, taille d'un message et acyclicité sont écrites dans le contrat, avec leurs vecteurs.
- La saisie qui part vers l'agent sans geste : une fonction que le produit n'implémente pas est une erreur, jamais un appel à l'agent ; ce que le produit renvoie à l'agent est décidé par le produit, champ par champ, et jamais par l'agent.
- La ressource qui exfiltre : un média est une référence opaque que le produit résout, jamais une adresse écrite par le modèle ; un lien sortant demande un geste et vise un hôte de la liste du produit.
- L'action à effet décidée par la forme de l'interface : la structure d'une surface qui porte une action à effet vient d'un gabarit du produit, le modèle n'en remplit que les valeurs, et l'action passe par une approbation liée à l'appel exact.
- Le contenu généré confondu avec celui du produit : une surface générée porte un marqueur de provenance visible que l'agent ne peut pas retirer.

## Ce qu'elle ne fait pas

- Elle ne fournit pas la coquille. PLT-02 présente le cœur d'un produit dans une coquille Tauri 2 ou une PWA ; sans elle, aucune surface n'est rendue ni vérifiée.
- Elle ne porte pas la politique d'appel d'outils du harness, que décrit ADR-0045 : elle applique la règle d'I-32 à la seule sortie qui décrit une interface.
- Elle ne fixe pas la licence du catalogue de composants. La question du paquet d'interface reste celle de PLT-09.
- Elle ne reprend ni le protocole A2UI comme dépendance, ni ses catalogues MCP et de graphiques Vega, ni ses rendus pour d'autres frameworks.
- Elle n'écrit pas le contrat avant d'avoir un consommateur. Sur décision du propriétaire du 2026-11-23, le contrat, le catalogue en données et le validateur viennent avec le premier produit qui affiche une interface générée et qui a un dépôt.

## Mesure

- Aucune preuve citée. Au 2026-11-23, aucun dépôt de l'inventaire ne porte de contrat d'interface générée (périmètre lu : `project-governance` et `application-development-toolkit` à leur branche servie ; recherche de « a2ui », « agent-to-user » et « ag-ui », zéro fichier).
- Prochaine preuve : le contrat d'interface générée dans `schemas-and-contracts`, avec des vecteurs valides et invalides pour chaque borne, et un refus pour une fonction absente du catalogue.
- Preuve suivante : le validateur de ce contrat, appelé par l'agent avant l'émission et par le produit avant le rendu, avec un test par règle de la section précédente.
