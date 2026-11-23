# PLT-10 — Interface générée sous catalogue fermé

## Contexte

Un assistant qui « montre ses sources et demande avant d'agir » (fiche P34) aura à afficher plus que du texte : un plan d'action à examiner, des résultats à comparer, un formulaire à remplir. Quand c'est un modèle exposé à du contenu non fiable qui décrit cette interface, la description mêle deux natures que ADR-0045 sépare. Sa **structure** (quels composants, quelles fonctions, quels identifiants) peut être fermée : c'est la forme qu'INV-c donne à la sortie d'un composant de quarantaine, « validée par un schéma à vocabulaire fermé », reprise par I-32. Ses **valeurs** (un texte à afficher, un champ rempli) ne le sont pas : INV-c dit qu'« une valeur non fermée (un texte à afficher, un corps de message) n'est pas une sortie de quarantaine : c'est une donnée non fiable soumise à INV-a et INV-b ». I-32 exige alors qu'aucune chaîne dérivée d'un contenu non fiable n'entre dans le contexte d'un modèle qui détient un outil à effet, et qu'une politique déterministe juge chaque argument d'appel d'outil ; la revue humaine n'y compte pour aucune de ces propriétés. ADR-0045 en est la source, et I-32 couvre les produits comme la forge.

La forme vient d'une lecture du protocole A2UI (`a2ui-project/a2ui`, Apache-2.0, révision `5ff1b05f02d39f969b52a942e78e864ef3ac01fa` lue le 2026-11-23, rien exécuté) : l'agent décrit des composants dans une liste plate, le client les valide contre un catalogue fermé puis les rend avec ses propres widgets. Cette lecture a aussi relevé ce que la brique doit faire autrement, chaque point dans un fichier de ce dépôt externe, à cette révision :

- la validation y est permissive sans configuration : `typescript/core/web_core/src/validation/payload-validator.ts`, lignes 192 à 197 ;
- une fonction que le client n'implémente pas y part vers l'agent, y compris depuis une liaison passive : `specification/v1_0/docs/a2ui_protocol.md`, lignes 1482 à 1489 ;
- l'agent y décide quelles données le client lui renvoie (`sendDataModel`) : même document, lignes 1097 à 1101 ;
- une image peut y être chargée depuis n'importe quel hôte, seuls les schémas d'adresse étant filtrés : `typescript/core/web_core/src/common/sanitize_media_url.ts`, lignes 22 à 50 ;
- aucune des fonctions de son catalogue d'outils MCP n'exige de geste de la personne : `catalogs/mcp/v1/catalog.json`.

ADR-0057 fixe un seul moteur de rendu pour toute la flotte : la portabilité vers plusieurs frameworks, argument central d'A2UI, n'est pas reprise. La carte qu'elle complète applique ADR-0064, encore proposé.

Cette brique est ajoutée sur décision du propriétaire du 2026-11-23, qui a aussi retenu un contrat propre à la flotte plutôt qu'un profil d'A2UI.

## Ce que la brique ferme

Aucune preuve n'est citée : ces points disent ce que la brique fermerait.

- La structure acceptée parce que le validateur était mal réglé : la validation est stricte sans option qui l'assouplisse, un composant ou une fonction hors du catalogue fait refuser la surface entière, et un refus sort en code fermé, jamais en texte libre. Le vocabulaire fermé porte sur la structure seule.
- La valeur générée traitée comme sûre parce que la structure l'est : un texte affiché, un champ rempli par le modèle ou une saisie de la personne restent des données non fiables (INV-a et INV-b d'ADR-0045). Ils n'entrent pas dans le contexte d'un modèle qui détient un outil à effet, sinon comme référence opaque, et ils sont affichés comme du texte, jamais interprétés.
- Le catalogue qui diverge entre l'agent et le produit sous un même nom : il est désigné par son identifiant et par l'empreinte de son contenu.
- Le contrat dont les bornes dépendent de l'implémentation : profondeur, nombre de composants, taille d'un message et acyclicité sont écrites dans le contrat, avec leurs vecteurs.
- La saisie qui part vers l'agent sans geste : une fonction que le produit n'implémente pas est une erreur, jamais un appel à l'agent ; ce que le produit renvoie à l'agent est décidé par le produit, champ par champ, et jamais par l'agent.
- La ressource qui exfiltre : un média est une référence opaque que le produit résout, jamais une adresse écrite par le modèle ; un lien sortant demande un geste et vise un hôte de la liste du produit.
- L'action à effet décidée par la forme de l'interface : la structure d'une surface qui porte une action à effet vient d'un gabarit du produit, et le modèle n'en remplit que les valeurs. Ces valeurs sont des arguments d'appel d'outil : la politique d'argument du harness les juge et refuse, fermé, celles qu'elle n'admet pas (INV-b). L'approbation de la personne, liée à l'appel exact, s'y ajoute et ne la remplace pas.
- Le contenu généré confondu avec celui du produit : une surface générée porte un marqueur de provenance visible que l'agent ne peut pas retirer.

## Ce qu'elle ne fait pas

- Elle ne fournit pas la coquille. PLT-02 présente le cœur d'un produit dans une coquille Tauri 2 ou une PWA ; sans elle, aucune surface n'est rendue ni vérifiée.
- Elle ne porte pas la politique d'appel d'outils du harness, que décrit ADR-0045 : elle en dépend pour les valeurs qu'une surface transmet à une action à effet, et ne s'y substitue pas.
- Elle ne fixe pas la licence du catalogue de composants. La question du paquet d'interface reste celle de PLT-09.
- Elle ne reprend ni le protocole A2UI comme dépendance, ni ses catalogues MCP et de graphiques Vega, ni ses rendus pour d'autres frameworks.
- Elle n'écrit pas le contrat avant d'avoir un consommateur. Sur décision du propriétaire du 2026-11-23, le contrat, le catalogue en données et le validateur viennent avec le premier produit qui affiche une interface générée et qui a un dépôt.

## Mesure

- Aucune preuve citée. Au 2026-11-23, six dépôts de l'inventaire ne portent ni contrat ni code d'interface générée : `project-governance`, `schemas-and-contracts`, `application-development-toolkit`, `personal-knowledge-workspace`, `signalement` et `square-control`, lus à leur branche servie. Recherche de « a2ui », « agent-to-user », « ag-ui », « generative ui » et « interface générée » : aucun fichier hors de cette brique. Les autres dépôts de l'inventaire n'ont pas été lus.
- Prochaine preuve : le contrat d'interface générée dans `schemas-and-contracts`, avec des vecteurs valides et invalides pour chaque borne, et un refus pour une fonction absente du catalogue.
- Preuve suivante : le validateur de ce contrat, appelé par l'agent avant l'émission et par le produit avant le rendu, avec un test par règle de la section précédente.
