# PLT-10 — Interface générée sous catalogue fermé

## Contexte

Un assistant qui « montre ses sources et demande avant d'agir » (fiche P34) aura à afficher plus que du texte : un plan d'action à examiner, des résultats à comparer, un formulaire à remplir. Quand c'est un modèle exposé à du contenu non fiable qui décrit cette interface, la description mêle deux natures que ADR-0045 sépare. Sa **structure** (quels composants, quelles fonctions, et les identifiants validés contre un référentiel du produit) peut être fermée : c'est la forme qu'INV-c donne à la sortie d'un composant de quarantaine, « validée par un schéma à vocabulaire fermé », reprise par I-32. Ses **valeurs** (un texte à afficher, un champ rempli) ne le sont pas : INV-c dit qu'« une valeur non fermée (un texte à afficher, un corps de message) n'est pas une sortie de quarantaine : c'est une donnée non fiable soumise à INV-a et INV-b ». I-32 exige alors qu'aucune chaîne dérivée d'un contenu non fiable n'entre dans le contexte d'un modèle qui détient un outil à effet, et qu'une politique déterministe juge chaque argument d'appel d'outil ; la revue humaine n'y compte pour aucune de ces propriétés. ADR-0045 en est la source, et I-32 couvre les produits comme la forge.

La forme vient d'une lecture du protocole A2UI (`a2ui-project/a2ui`, Apache-2.0, révision `5ff1b05f02d39f969b52a942e78e864ef3ac01fa` lue le 2026-11-23, rien exécuté) : l'agent décrit des composants dans une liste plate, le client les valide contre un catalogue fermé puis les rend avec ses propres widgets. Cette lecture a aussi relevé ce que la brique doit faire autrement, chaque point dans un fichier de ce dépôt externe, à cette révision :

- la validation y est permissive sans configuration : `typescript/core/web_core/src/validation/payload-validator.ts`, lignes 176-177 et 189 à 196 ;
- une fonction que le client n'implémente pas y part vers l'agent, y compris depuis une liaison passive, dès que le catalogue ne la déclare pas, ou la déclare sans `requiresUserActivation` ni `allowedCallers: "agentOnly"` ; depuis une action de la personne, seul `agentOnly` l'arrête ; une fonction non déclarée n'y part que si le client a accepté le message, ce que la validation permissive du point précédent lui fait faire : `specification/v1_0/docs/a2ui_protocol.md`, lignes 1484 et 1488 ;
- l'agent y fixe, en créant la surface, si le client lui renvoie à chaque message le modèle de données entier de cette surface (`sendDataModel`, un booléen) : même document, lignes 186 et 1097 à 1101 ;
- une image peut y être chargée depuis n'importe quel hôte, seuls les schémas d'adresse étant filtrés : `typescript/core/web_core/src/common/sanitize_media_url.ts`, lignes 22 à 50 ;
- aucune des fonctions de son catalogue d'outils MCP n'exige de geste de la personne : `catalogs/mcp/v1/catalog.json`.

ADR-0057 fixe un seul moteur de rendu pour toute la flotte : la portabilité vers plusieurs frameworks, argument central d'A2UI, n'est pas reprise. La carte qu'elle complète applique ADR-0064, encore proposé.

Cette brique est ajoutée sur décision du propriétaire du 2026-11-23, qui a aussi retenu un contrat propre à la flotte plutôt qu'un profil d'A2UI.

## Ce que la brique ferme

Aucune preuve n'est citée : ces points disent ce que la brique fermerait.

- La structure acceptée parce que le validateur était mal réglé : la validation est stricte sans option qui l'assouplisse, un composant ou une fonction hors du catalogue fait refuser la surface entière, et un refus sort en code fermé, jamais en texte libre. Le vocabulaire fermé porte sur la structure seule. Un identifiant de composant ou un chemin de liaison écrit par le modèle n'en fait partie que s'il est validé contre un référentiel du produit, comme INV-c l'exige d'un identifiant (« identifiants validés contre un référentiel ») ; un gabarit du produit compte comme l'un de ces référentiels, ce qu'INV-c ne dit pas et que la brique ajoute. Un identifiant d'instance, qui ne sert qu'à relier les composants d'une même surface, est validé contre la liste des composants de cette surface : toute référence se résout, sans cycle ; il n'est ni affiché ni renvoyé à l'agent, sauf si le produit le décide (point « La saisie qui part vers l'agent sans geste »). Un autre identifiant, ou un chemin de liaison, qui n'est validé contre aucun référentiel fait refuser la surface entière, comme un composant hors du catalogue. Un formulaire dont les chemins de liaison ne viennent pas d'un gabarit du produit est donc refusé. Le contrat ne pourra assouplir cette règle qu'en écrivant le cas et ses vecteurs.
- La valeur générée traitée comme sûre parce que la structure l'est : un texte affiché ou un champ rempli par le modèle restent des données non fiables (INV-a et INV-b d'ADR-0045). La brique traite de même la saisie de la personne dans une surface générée. Elle s'écarte en cela d'ADR-0045. Cet ADR fait produire le plan à partir de « la seule requête de confiance » (lignes 53, 55 et 73) ; la ligne 34 nomme « la requête de l'utilisateur » celle avec laquelle une consigne injectée « concourt », et la brique en déduit que la requête de confiance est celle de la personne. Or une saisie faite dans une surface que le modèle a décrite peut recopier un contenu non fiable, ou y avoir été guidée. Une requête tapée dans une surface générée ne devient donc jamais la requête de confiance du planificateur. Ces valeurs n'entrent pas dans le contexte d'un modèle qui détient un outil à effet, sinon comme référence opaque, et elles sont affichées comme du texte, jamais interprétées.
- Le catalogue qui diverge entre l'agent et le produit sous un même nom : il est désigné par son identifiant et par l'empreinte de son contenu.
- Le contrat dont les bornes dépendent de l'implémentation : profondeur, nombre de composants, taille d'un message et acyclicité sont écrites dans le contrat, avec leurs vecteurs.
- La saisie qui part vers l'agent sans geste : une fonction que le produit n'implémente pas est une erreur, jamais un appel à l'agent ; ce que le produit renvoie à l'agent est décidé par le produit, champ par champ, et jamais par l'agent.
- La ressource qui exfiltre : un média est une référence opaque que le produit résout, jamais une adresse écrite par le modèle ; un lien sortant demande un geste et vise un hôte de la liste du produit.
- L'action à effet décidée par la forme de l'interface : la structure d'une surface qui porte une action à effet vient d'un gabarit du produit, et le modèle n'en remplit que les valeurs. Ces valeurs sont des arguments d'appel d'outil : la politique d'argument du harness les juge et refuse, fermé, celles qu'elle n'admet pas (INV-b). L'approbation de la personne, liée à l'appel exact, s'y ajoute et ne la remplace pas.
- Le contenu généré confondu avec celui du produit : une surface générée porte un marqueur de provenance visible que l'agent ne peut pas retirer.

## Ce qu'elle ne fait pas

- Elle ne fournit pas la coquille. PLT-02 présente le cœur d'un produit dans une coquille Tauri 2 ou une PWA ; sans elle, aucune surface n'est rendue ni vérifiée.
- Elle ne porte pas la politique d'appel d'outils du harness, HAR-04, que décrit ADR-0045 : elle en dépend pour les valeurs qu'une surface transmet à une action à effet, et ne s'y substitue pas. La table d'ADR-0064 D1 n'admet pas qu'une brique de la couche plateforme dépende du harness : cette dépendance n'est pas déclarée.
- Elle ne fait pas tourner le modèle qui écrit la description. Exposé à du contenu non fiable, ce modèle ne détient aucun outil à effet (INV-a d'ADR-0045) ; la brique valide et rend sa sortie, rien de plus. Une question reste ouverte : la règle de D1 pour la couche exécution dit que « tout ce qui traite du contenu est ici, et seulement ici », sans définir « contenu », et ne dit donc pas si valider la sortie d'un modèle relève de cette couche ou de celle-ci.
- Elle ne fixe pas la licence du catalogue de composants. La question du paquet d'interface reste celle de PLT-09.
- Elle ne reprend ni le protocole A2UI comme dépendance, ni ses catalogues MCP et de graphiques Vega, ni ses rendus pour d'autres frameworks.
- Elle n'écrit pas le contrat avant d'avoir un consommateur. Sur décision du propriétaire du 2026-11-23, le contrat, le catalogue en données et le validateur viennent avec le premier produit qui affiche une interface générée et qui a un dépôt.

## Mesure

- Aucune preuve citée. Le 2026-11-23, une recherche de « a2ui », « agent-to-user », « ag-ui », « generative ui » et « interface générée » ne trouve aucun fichier hors de cette brique dans six dépôts de l'inventaire, lus à leur branche servie et à ces têtes :
  - `project-governance` `365c7661e01ee9e902e914c229d938596da80133` ;
  - `schemas-and-contracts` `1b0b6f463c649299855244a1ed2a540723b77a7f` ;
  - `application-development-toolkit` `b841d732e5ecd690bd40fdb7da73203bbed53193` ;
  - `personal-knowledge-workspace` `7416b6cc4b272767e6d0c1cfabbadd0f0e049829` ;
  - `signalement` `6ba46309211ce077f08fad181fb38caf3dbf1bae` ;
  - `square-control` `91bc393e7b3631561557945e62fc2f1378353ebe`.

  C'est un plancher : une recherche par termes ne montre pas l'absence d'un code qui n'en emploierait aucun. Les autres dépôts de l'inventaire n'ont pas été lus.
- Prochaine preuve : le contrat d'interface générée dans `schemas-and-contracts`, avec des vecteurs valides et invalides pour chaque borne, et un refus pour une fonction absente du catalogue.
- Preuve suivante : le validateur de ce contrat, appelé par l'agent avant l'émission et par le produit avant le rendu, avec un test par règle de la section précédente.
