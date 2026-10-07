# Gate S — challenge contradictoire en bootstrap solo

**Décision : `accepted-for-candidate-drafting-only`**

**Portée :** conservation du dossier et préparation machine-checkable du candidat uniquement.

**N'autorise pas :** moteur expérimental, implémentation Rust/WASM, statut `locked`, sauvegarde utilisateur, release ou affirmation de revue indépendante.

## Pourquoi cette gate existe

Le dépôt est actuellement maintenu par une seule personne. Les équipes humaines GitHub `security` et `architecture` mentionnées par `CODEOWNERS` n'existent pas encore. L’indépendance technique repose donc sur des agents et sessions séparés selon `docs/reviews/AGENT-REVIEW-PROTOCOL.md`, sans présenter le challenge auteur Gate S comme un verdict.

La Gate S documente le challenge sans simuler l'indépendance. ADR-0003 sépare le cycle : une Gate A tenue par un agent indépendant examine le protocole et les vecteurs avant toute implémentation ; une Gate B tenue par un autre contexte agentique indépendant examine ensuite le composant construit avant release.

## Méthode exécutée

- lecture contradictoire du WIT, des schémas, de chaque préimage AAD/digest et de la migration ;
- validation Ajv 2020 du golden et des classifications de mutations ;
- dérivation Argon2id recoupée entre pyca/cryptography et OpenSSL EVP_KDF ;
- AES-256-GCM recoupé entre pyca/cryptography et Node Web Crypto ;
- ouverture positive et refus des dix mutations backup, dont digest seul et secrets hors bornes ;
- canonicalisation Context v2 positive et refus de douze entrées adversariales ;
- refus des paramètres faibles avant Argon2id ;
- parsing/résolution WIT avec `wit-parser` ;
- encodage jetable de la frontière WIT pour distinguer imports du module et imports du composant ;
- mesure native conservatoire du profil KDF et de l'amplification mémoire one-shot, sans intégrer de moteur au dépôt ;
- CI complète `Bun quality` et `Rust quality` ;
- revue des axes sécurité, qualité, performance, complétude, souveraineté et données personnelles ;
- quatre passes Gate A fraîches sur `9b1b994`, puis quatre nouvelles sur `be17f27` ; les rejets et approbations historiques sont archivés et invalidés par chaque remédiation normative.

Ces recoupements réduisent le risque d'erreur de transcription. Ils ne constituent ni une preuve formelle ni une revue indépendante.

## Constats et traitement

| ID | Sévérité | Challenge | Traitement |
| --- | --- | --- | --- |
| S-01 | major | `contract-error.message` permettrait à une implémentation de faire franchir diagnostics, valeurs privées ou erreurs de bibliothèque malgré la table de messages statiques. | Supprimer le record et retourner uniquement l'enum fermé `error-code`. L'affichage devient une responsabilité host non normative. |
| S-02 | major | Une revue unique exigeant protocole et binaire créerait un verrou circulaire. | Gate A examine le protocole/vecteurs avant implémentation ; Gate B examine ensuite le binaire, sans auto-approbation. |
| S-03 | major partiellement corrigé | La limite one-shot initiale de 100 MiB dépasse 1 GiB de RSS dans le harness natif de qualification et serait dangereuse avant même les copies WIT/navigateur. | Réduire le candidat à 16 MiB ; conserver zéro fallback KDF. Les benchmarks navigateurs/appareils et budgets explicites restent obligatoires en Gate B. Un format supérieur devra être chunké sous un autre contrat. |
| S-04 | major résiduel | La zéroïsation réelle des copies ABI, de la mémoire Argon2id et des erreurs/panics ne peut pas être prouvée par le contrat. | Choix de bibliothèques, instrumentation et inspection du composant exigés en Gate B. |
| S-05 | maîtrisé | Le digest est public et recalculable par un attaquant. | Il n'autorise rien, n'est jamais vérifié à la place du tag et ne peut court-circuiter Argon2id/AES-GCM. Les mutations couvrent digest recalculé et digest seul invalide. |
| S-06 | major résiduel | Le cœur stateless ne peut pas garantir la fraîcheur des identifiants, du sel et du nonce fournis par le host. | CSPRNG host, nouveaux id backup/contexte/blocs, sel et nonce par opération ; tests d'intégration navigateur obligatoires avant release. |
| S-07 | maîtrisé | `invalid-envelope` distingue les paramètres KDF publics invalides d'un échec cryptographique. | Accepté : aucune tentative cryptographique valide n'existe dans ce cas ; mauvais secret et toute altération cryptographique structurellement valide restent unifiés. |
| S-08 | major corrigé au contrat | Plusieurs conversions textuelles du recovery secret peuvent diverger entre création et restauration. | Interdire toute saisie libre en v2 ; imposer uniquement `libre-ai.recovery-secret-code.v1`, 16 octets CSPRNG ↔ 32 hexadécimaux stricts. |
| S-09 | major | Un `use` d'une interface `types` séparée ne ressemble pas à un import WIT explicite, mais devient des imports réels dans le composant encodé. | Regrouper types et fonctions dans l'unique interface exportée `api`; Gate B inspectera séparément module et composant. |
| S-10 | major résiduel | Rust ne permet pas de récupérer fiablement tous les OOM déclenchés à l'intérieur d'un parseur/JCS, même si les grandes préallocations explicites sont fallibles. | Limites brutes/contenus à environ 22/16 MiB et validation avant décodage ; Gate B injectera la pression mémoire et documentera les traps résiduels, sans fallback cryptographique. |
| S-11 | blocking corrigé | Le golden catalogué avait sept mutations tandis que sa copie de revue et le checker n'en avaient que six. | Rendre le golden byte-identique dans les deux emplacements et vérifier cette identité en CI. |
| S-12 | major corrigé | Le tri de `blocks` Context v2 ne définissait pas son comparateur et aucun vecteur ne couvrait la canonicalisation hostile. | Fixer le tri par octets UTF-8 du champ `id`, les autres tris et le JSON imbriqué ; ajouter golden, digest et douze refus. |
| S-13 | major corrigé | Les `id` arbitraires et `createdAt` précis exposaient des métadonnées corrélables en clair. | Imposer des id backup/contexte CSPRNG opaques de 128 bits et déplacer tout horodatage produit dans le plaintext/contenu explicitement partagé. |
| S-14 | major corrigé | Le domaine numérique JCS et les budgets profondeur/nœuds/arêtes Context restaient ouverts. | Fixer binary64 fini sous `2^53`, profondeur 64, 100 000 nœuds JSON et 16 384 liens ; matérialiser et vérifier les entrées/sorties aux bornes et au-delà. |
| S-15 | major corrigé | IDs locaux de blocs, révisions et exclusions rendaient les exports Context corrélables et divulguaient des données non sélectionnées. | Remapper chaque bloc en ID CSPRNG propre à l'export ; retirer `revision` et `excludedBlockIds` du payload portable. |
| S-16 | minor corrigé | Les profils `code.v1` et `text.v1` n'étaient pas auto-décrits dans l'enveloppe et pouvaient être confondus. | Conserver uniquement `code.v1` en v2 et réserver toute saisie libre à un futur major. |

Aucun constat major corrigible au niveau du candidat ne reste ouvert après S-01/S-02/S-03/S-08/S-09/S-11/S-12/S-13/S-14/S-15/S-16. S-04, S-06 et S-10 nécessitent le host ou le moteur réel et bloquent la release via la Gate B.

## Contraintes de progression

Après Gate S :

- le dossier de proposition et le candidat catalogué peuvent être revus ;
- aucun moteur ne peut être développé avant Gate A ;
- toute modification normative régénère les vecteurs et réexécute ce challenge ;
- v1 reste inchangé et aucun producteur v2 n'est activé.

Avant toute implémentation :

- quatre passes d’agents séparées — architecture, sécurité, cryptographie et vie privée — approuvent le même commit, puis le propriétaire autorise le merge sans remplacer ces verdicts techniques (Gate A) ;

Avant toute sauvegarde utilisateur ou release :

- un agent cryptographie indépendant de l’implémentation examine le composant réellement construit (Gate B) ;
- [`INDEPENDENT-REVIEW.md`](INDEPENDENT-REVIEW.md) reçoit des verdicts Gate A puis Gate B attribuables ;
- les constats résiduels ci-dessus sont fermés par preuves ;
- les gates projet sécurité, confidentialité locale et frontière Rust sont approuvées.
