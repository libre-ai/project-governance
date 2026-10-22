# ADR-0054 — Amendement d'ADR-0042 pour P02 v1 : surfaces, stack serveur, dépôt dédié, offre hébergée

- **Statut :** proposé — la fusion de cette pull request vaut signature du propriétaire (ADR-0043).
- **Arbitrage :** Owner-arbitration: 2026-10-22 — décisions P02-D1 à P02-D13 du lot P02 v1, arbitrées en chat le 2026-10-22 et reprises dans la table de décisions du registre (`docs/decisions/DECISION-REGISTER.md`, D81 à D93). La formulation du propriétaire est reprise, non réinterprétée.
- **Date de rédaction :** 2026-10-22
- **Portée :** produit P02 (veille de flux, domaine Connaissance) uniquement. Ne modifie ni le catalogue, ni les autres produits, ni les règles de topologie des autres domaines.
- **Amende :**
  - ADR-0042 §5 (stack serveur), pour P02 seulement ;
  - ADR-0042 §7 (domaine Connaissance : un second dépôt produit dédié à P02), pour ce seul domaine ;
  - ADR-0042 §8 (premier palier de plateformes), pour P02 seulement : web responsive et PWA, application macOS par adaptateur Tauri 2, extension navigateur.
  - Explicitement : l'offre hébergée amende la ligne de `docs/positioning/non-goals.md` qui affirme qu'aucune offre hébergée n'existe. Cette ligne est remplacée dans cette pull request ; l'auto-hébergement et l'export sans verrou sont conservés.
- **Invariants :** I-06 amendé (Rust admis comme runtime serveur complet lorsque l'ADR d'un produit le décide). Le texte historique reste dans `docs/decisions/INVARIANTS.md` entre guillemets, comme pour I-10 et I-25.
- **Source :** décisions du propriétaire en chat le 2026-10-22. Les faits mesurés sont reproductibles avec les commandes listées dans le corps de la pull request.

## Contexte

État mesuré le 2026-10-22 :

- `libre-ai/feed-radar` n'existe pas (`gh repo view libre-ai/feed-radar` répond qu'il ne peut pas résoudre le dépôt).
- Son successeur `libre-ai/information-feed-filter` est archivé (`isArchived: true`). Son périmètre a été transféré vers `libre-ai/personal-knowledge-workspace`.
- Le code de P02 vit dans `libre-ai/personal-knowledge-workspace`, sur la branche servie : crates P02 et une API Bun à trois routes. Ce n'est pas un dépôt produit à part entière.
- La pull request `libre-ai/personal-knowledge-workspace#23` est un brouillon non fusionné : `+6117 / −33`, 61 fichiers. Elle ajoute un parseur isolé sous `RLIMIT`, les items, les planifications, les quotas, le fuzzing et une suite de bout en bout. Son corps liste des points ouverts : un ADR-0054 non publié dans ce dépôt (autre document ; le numéro de cet ADR appartient au seul `project-governance`), un worker qui lit les planifications de tous les locataires, pas de déduplication inter-jobs, pas de rétention, et un `bun@1.4.0-canary.1` épinglé sans release.
- Le dépôt n'a aucune interface : pas de fichier Swift, pas d'application web, pas d'extension navigateur.

## Décision

### 1. Stack serveur de P02 (amende ADR-0042 §5, P02-D5)

Pour P02, le serveur est entièrement en Rust : axum pour l'API HTTP, sqlx pour l'accès aux données, PostgreSQL pour le stockage. L'API et le worker vivent dans un même workspace Cargo. Le parseur s'exécute comme processus fils isolé, sur tous les systèmes d'exploitation.

ADR-0042 §5 (Bun et PostgreSQL pour les produits serveur) ne s'applique pas à P02. Les autres produits serveur conservent §5 sans changement.

### 2. Dépôt dédié dans le domaine Connaissance (amende ADR-0042 §7, P02-D9)

ADR-0042 §7 pose qu'un domaine a au plus un dépôt produit. Pour le seul domaine Connaissance, cet amendement en admet un second : `libre-ai/information-watch`, dédié à P02.

- P02 est porté par le nouveau dépôt. Le dépôt du domaine `libre-ai/personal-knowledge-workspace` conserve les autres produits du domaine (P01 et P03 à P07, comme le pose §7), et son code P02 devient une référence.
- Le nom est proposé dans `docs/decisions/LEXICON.md` §15. Son nom public est dérivé de la règle standard (« Libre AI » et le nom du dépôt en casse de titre), sans exception de marque.
- La création du dépôt, de son distant de staging privé et de son exposition publique sont des actes du propriétaire au titre de I-30 (nom et enrôlement ; distant de staging privé ; exposition publique après attestation). Aucun n'est exécuté par cette pull request, qui ne crée pas le dépôt.

### 3. Premier palier de P02 (amende ADR-0042 §8, P02-D2, P02-D6, P02-D8, P02-D10, P02-D12, P02-D13)

Le premier palier de plateformes de P02 est composé de trois surfaces sur le même cœur et la même API :

- **Application web responsive.** Une PWA construite avec React 19, TypeScript en mode strict et Vite. Un client typé est généré depuis la description OpenAPI. Un service worker et IndexedDB assurent la lecture et la recherche hors ligne des items conservés. Le design system est écrit sous EUPL ; `@libre-ai/ui` (Apache-2.0, bloqué pour cet usage) n'est pas réutilisé.
- **Application macOS.** Un adaptateur Tauri 2 : le cœur Rust et le front web tournent dans une WKWebView. L'hôte de native messaging, écrit en Rust, est livré avec l'application. L'application ne parse jamais les flux : elle délègue à l'API.
- **Extension navigateur** pour Chrome et Firefox, Manifest V3, sans accès réseau. Elle parle à l'hôte de native messaging par stdio.

Preuves, par surface :

- **Web :** Playwright sur chromium, firefox et webkit, à 360, 768 et 1280 px.
- **macOS :** l'application est construite et lancée sur un runner macOS. Le contrôle porte sur : `lsof -i -P` ne montre aucun port en écoute ; `codesign --verify --strict` et `spctl --assess` passent ; un ticket de notarisation existe pour chaque release candidate. La mémoire résidente doit rester sous 512 MiB en régime établi, chiffre figé avant mesure (P02-D12) ; un dépassement mesuré au troisième jalon est une décision de surface (Swift natif avec UniFFI), non une révision du seuil. Le parcours fonctionnel tourne sous Playwright webkit ; un spike de `@wdio/tauri-service` avec son fournisseur `embedded` décide si le parcours complet tourne aussi dans la coquille (P02-D13).
- **Extension :** sur un Chrome réel et un Firefox réel.

Les appareils mobiles, Windows et Linux ne font pas partie de ce palier ; ils sont candidats à un second palier.

### 4. Modèle commercial de P02 (P02-D1, P02-D7)

- P02 est commercial en deux sens : distribution signée et notarisée à des tiers, et offre hébergée payante pour plusieurs organisations (P02-D1). L'offre hébergée amende la ligne de `docs/positioning/non-goals.md` qui affirme qu'aucune offre hébergée n'existe.
- Plans et quotas sont dans l'application. Le paiement est hors application : aucune donnée de paiement, aucune donnée de carte et aucun webhook de prestataire de paiement dans le code (P02-D7).
- L'hébergement de l'offre payante sur Clever Cloud suit I-07. C'est une convention établie, pas une des décisions du propriétaire ci-dessus.

## Conséquences

- **I-06 amendé.** Rust est admis comme runtime serveur complet pour un produit lorsque l'ADR de ce produit le décide. Bun fullstack reste la règle pour tout autre produit.
- **ADR-0042 §5, §7 et §8 amendés** comme indiqué ci-dessus, pour P02 et pour le seul domaine Connaissance.
- **Y4 remplacé pour P02.** Y4 (worker en Rust, API en Bun) est consigné dans la spécification de P02, qui n'est pas dans ce dépôt. P02-D5 le remplace pour P02.
- **`libre-ai/personal-knowledge-workspace#23` devient une référence**, et non la base du nouveau travail. Cet ADR ne la ferme pas.
- **Aucun code produit de P02 ne démarre avant la fusion de cette pull request** (P02-D11).
- **Décisions de process** (sous-agents sur Haiku 5.5, revue bloquante par une seconde famille de modèles) sont consignées au seul registre (D84). Ce ne sont pas des amendements de doctrine.
- **Inventaire.** L'entrée d'inventaire, la cible de composition et l'épinglage de flotte sont déclarés par une pull request distincte, après la création du dépôt par le propriétaire (I-30), sur le précédent de `square-control`. Cette pull request ne déclare aucune entrée pour `libre-ai/information-watch`.
- **Rien ici ne crée de dépôt, ne modifie de ruleset et n'exécute d'acte du propriétaire.**
- **Non-objectifs mis à jour.** `docs/positioning/non-goals.md` ne dit plus qu'aucune offre hébergée n'existe ; il conserve « logiciel que chacun peut héberger, répliquer et quitter ».

## Invariants

- I-06 amendé dans `docs/decisions/INVARIANTS.md` ; son texte historique est conservé entre guillemets.

## Source

- Décisions du propriétaire P02-D1 à P02-D13, en chat, 2026-10-22.
- Faits mesurés : commandes listées dans le corps de la pull request, exécutées le 2026-10-22.
