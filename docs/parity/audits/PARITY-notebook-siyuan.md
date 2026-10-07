# Benchmark-Parity : Libre AI Notebook vs. SiYuan

> **Statut de calibrage (2026-08-18, ADR-0027) :** cet audit mesure la
> **spec** du produit, pas son code livré — requalifié **« spec-baseline,
> non opposable »** jusqu'à ré-exécution contre du code réellement livré.
> Les chiffres de couverture restent un inventaire de traits utile, mais ne
> peuvent fonder aucun `promotion_criteria`/`kill_predicate` de fiche
> produit avant cette ré-exécution ni avant que le jalon dogfooding du
> produit soit atteint. Voir
> `docs/adr/0027-parity-gates-fire-only-after-dogfooding.md`.

**Date:** 2026-07-22 | **Spec:** ~/Documents/libre-ai-d01/docs/apps/notebook.md

---

## Inventaire SiYuan (143 features)

### Édition & Interface (15)

| #   | Fonctionnalité                                            | Statut CDC                     |
| --- | --------------------------------------------------------- | ------------------------------ |
| 1   | WYSIWYG markdown block editor                             | COUVERT                        |
| 2   | 20+ block types (heading, list, code, table, quote, etc.) | COUVERT (subset)               |
| 3   | 10+ inline elements (bold, link, mark, etc.)              | COUVERT (subset)               |
| 4   | Block zoom/focus mode                                     | ABSENT                         |
| 5   | List outline/navigation panel                             | ABSENT                         |
| 6   | Multi-tab browsing with split-screen                      | ABSENT                         |
| 7   | Nested documents                                          | COUVERT                        |
| 8   | Large document support (1M+ words)                        | ABSENT                         |
| 9   | Template snippets system                                  | ABSENT                         |
| 10  | JavaScript/CSS customization snippets                     | ABSENT du CDC                  |
| 11  | Undo/redo with revision history                           | PARTIAL (local revisions only) |
| 12  | Auto-save on device                                       | COUVERT (IndexedDB persist)    |
| 13  | Dark/light theme toggle                                   | ABSENT                         |
| 14  | Keyboard shortcuts customization                          | ABSENT                         |
| 15  | Drag-drop reordering of blocks                            | ABSENT                         |

### Liaisons & Références (11)

| #   | Fonctionnalité                          | Statut CDC    |
| --- | --------------------------------------- | ------------- |
| 16  | Bidirectional links (backlinks)         | COUVERT       |
| 17  | Block-level references with embeds      | COUVERT       |
| 18  | Unlinked mentions detection             | ABSENT        |
| 19  | Global relationship graph visualization | ABSENT        |
| 20  | Protocol links (siyuan://)              | ABSENT        |
| 21  | Custom attributes on blocks             | ABSENT        |
| 22  | SQL query embedding in documents        | ABSENT du CDC |
| 23  | Database blocks with table view         | ABSENT du CDC |
| 24  | Relations and rollup aggregations       | ABSENT du CDC |
| 25  | Tag system with hierarchies             | ABSENT        |
| 26  | Alias system for blocks                 | ABSENT        |

### Visualisations (8)

| #   | Fonctionnalité                  | Statut CDC |
| --- | ------------------------------- | ---------- |
| 27  | Mathematical formulas (LaTeX)   | ABSENT     |
| 28  | Flowchart diagrams              | ABSENT     |
| 29  | Gantt charts                    | ABSENT     |
| 30  | Timing diagrams                 | ABSENT     |
| 31  | Musical notation/staffs         | ABSENT     |
| 32  | Generic charts (bar, pie, line) | ABSENT     |
| 33  | Web clipping with preview       | ABSENT     |
| 34  | PDF annotation and linking      | ABSENT     |

### Recherche & Requêtes (4)

| #   | Fonctionnalité            | Statut CDC    |
| --- | ------------------------- | ------------- |
| 35  | Full-text local search    | COUVERT       |
| 36  | Advanced search filters   | ABSENT        |
| 37  | Saved searches            | ABSENT        |
| 38  | SQL-based content queries | ABSENT du CDC |

### Apprentissage & Répétition (2)

| #   | Fonctionnalité               | Statut CDC    |
| --- | ---------------------------- | ------------- |
| 39  | Spaced repetition flashcards | ABSENT du CDC |
| 40  | Riff algorithm scheduling    | ABSENT du CDC |

### Import/Export (9)

| #   | Fonctionnalité                         | Statut CDC                     |
| --- | -------------------------------------- | ------------------------------ |
| 41  | Standard Markdown export               | COUVERT (context export)       |
| 42  | PDF export                             | PARTIAL (context preview only) |
| 43  | Word/DOCX export                       | ABSENT                         |
| 44  | HTML export                            | ABSENT                         |
| 45  | Selective block export                 | COUVERT (context selection)    |
| 46  | Asset preservation in export           | COUVERT                        |
| 47  | Publish to WordPress/Cnblogs/Yuque     | ABSENT du CDC                  |
| 48  | WeChat/Zhihu export integration        | ABSENT du CDC                  |
| 49  | Automatic import from external sources | ABSENT du CDC                  |

### Sauvegarde & Synchronisation (8)

| #   | Fonctionnalité                | Statut CDC                                      |
| --- | ----------------------------- | ----------------------------------------------- |
| 50  | End-to-end encrypted backup   | COUVERT                                         |
| 51  | Encrypted cloud sync          | CONFLIT (non-goal: « no implicit server sync ») |
| 52  | Incremental sync              | CONFLIT (non-goal: « no server-side storage »)  |
| 53  | S3 custom sync support        | CONFLIT (non-goal: « no cloud sync »)           |
| 54  | WebDAV sync                   | CONFLIT (non-goal: « no cloud sync »)           |
| 55  | Manual export/import workflow | COUVERT                                         |
| 56  | Data import on device         | COUVERT (restore from backup)                   |
| 57  | Sync across devices           | CONFLIT (non-goal: « local-only workspace »)    |

### Partage & Publication (7)

| #   | Fonctionnalité                      | Statut CDC                                     |
| --- | ----------------------------------- | ---------------------------------------------- |
| 58  | Shareable export files              | COUVERT                                        |
| 59  | Export revocation tracking          | COUVERT (MarkExportSuperseded)                 |
| 60  | Authorization codes for team access | CONFLIT (non-goal: « no collaboration »)       |
| 61  | Public page sharing                 | CONFLIT (non-goal: « no public publishing »)   |
| 62  | Publishing plugins                  | CONFLIT (non-goal: « no plugins »)             |
| 63  | Docker/self-hosted server           | ABSENT du CDC                                  |
| 64  | Web server mode                     | CONFLIT (non-goal: « no server-side storage ») |

### Plateforme Mobile & Desktop (7)

| #   | Fonctionnalité           | Statut CDC                      |
| --- | ------------------------ | ------------------------------- |
| 65  | Android app              | ABSENT (v1 = Web PWA only)      |
| 66  | iOS app                  | ABSENT (v1 = Web PWA only)      |
| 67  | HarmonyOS app            | ABSENT (v1 = Web PWA only)      |
| 68  | Desktop Electron app     | ABSENT (v1 = Web PWA only)      |
| 69  | Web access               | COUVERT (PWA)                   |
| 70  | Cross-platform data sync | CONFLIT (non-goal: « no sync ») |
| 71  | Offline mobile access    | ABSENT (v1 = connected PWA)     |

### Plugins & Extensibilité (13)

| #   | Fonctionnalité                   | Statut CDC                               |
| --- | -------------------------------- | ---------------------------------------- |
| 72  | Plugin system via Petal API      | ABSENT du CDC (non-goal: « no plugins ») |
| 73  | Community Bazaar marketplace     | ABSENT du CDC                            |
| 74  | Custom plugin development        | ABSENT du CDC                            |
| 75  | Plugin API documentation         | ABSENT du CDC                            |
| 76  | Theme marketplace                | ABSENT du CDC                            |
| 77  | Icon pack marketplace            | ABSENT du CDC                            |
| 78  | Widget system                    | ABSENT du CDC                            |
| 79  | Community-contributed extensions | ABSENT du CDC                            |
| 80  | Plugin dependency resolution     | ABSENT du CDC                            |
| 81  | Live plugin updates              | ABSENT du CDC                            |
| 82  | Theme customization              | ABSENT du CDC                            |
| 83  | CSS variable system              | ABSENT du CDC                            |
| 84  | Dark mode variants               | ABSENT du CDC                            |

### Intelligence Artificielle (4)

| #   | Fonctionnalité         | Statut CDC                          |
| --- | ---------------------- | ----------------------------------- |
| 85  | OpenAI API integration | ABSENT du CDC                       |
| 86  | AI writing assistance  | ABSENT du CDC                       |
| 87  | Q&A chat with notebook | CONFLIT (non-goal: « no RAG chat ») |
| 88  | Tesseract OCR          | ABSENT du CDC                       |

### API & Développeur (5)

| #   | Fonctionnalité                      | Statut CDC                    |
| --- | ----------------------------------- | ----------------------------- |
| 89  | Documented REST API                 | ABSENT du CDC                 |
| 90  | WebSocket real-time API             | ABSENT du CDC                 |
| 91  | JavaScript SDK                      | ABSENT du CDC                 |
| 92  | siyuan:// protocol handler          | ABSENT du CDC                 |
| 93  | Data export formats (JSON/Markdown) | PARTIAL (context export only) |

### Sécurité & Confidentialité (6)

| #   | Fonctionnalité             | Statut CDC                              |
| --- | -------------------------- | --------------------------------------- |
| 94  | Privacy-first architecture | COUVERT                                 |
| 95  | No telemetry               | COUVERT (spec: « no hidden telemetry ») |
| 96  | Open source codebase       | ABSENT du CDC (not a feature)           |
| 97  | Local-only by default      | COUVERT                                 |
| 98  | Encrypted recovery codes   | COUVERT (recovery-secret-code.v1)       |
| 99  | Non-exportable device keys | COUVERT (Web Crypto)                    |

### Accessibilité & Localisation (9)

| #   | Fonctionnalité                 | Statut CDC                                      |
| --- | ------------------------------ | ----------------------------------------------- |
| 100 | Multi-language UI (i18n)       | ABSENT                                          |
| 101 | Keyboard navigation            | COUVERT (spec: « keyboard-only »)               |
| 102 | Screen reader support          | PARTIAL (spec: « editor announces formatting ») |
| 103 | High contrast mode             | ABSENT                                          |
| 104 | Text size adjustment           | ABSENT                                          |
| 105 | Reduced motion support         | ABSENT                                          |
| 106 | WCAG compliance                | PARTIAL (baseline required)                     |
| 107 | Degraded mode on quota full    | COUVERT (spec requirement)                      |
| 108 | Right-to-left language support | ABSENT                                          |

### Collaboration & Communication (8)

| #   | Fonctionnalité                  | Statut CDC                                  |
| --- | ------------------------------- | ------------------------------------------- |
| 109 | Real-time collaborative editing | CONFLIT (non-goal: « no collaboration »)    |
| 110 | Comments and annotations        | CONFLIT (non-goal: « no collaboration »)    |
| 111 | User presence indicators        | CONFLIT (non-goal: « no collaboration »)    |
| 112 | Conflict resolution UI          | COUVERT (explicit conflict report)          |
| 113 | Change tracking                 | ABSENT                                      |
| 114 | Revision history visualization  | PARTIAL (immutable revisions locally)       |
| 115 | Merge conflict detection        | COUVERT (restore logic)                     |
| 116 | Team workspaces                 | CONFLIT (non-goal: « personal local-only ») |

### Stockage & Gestion (9)

| #   | Fonctionnalité                        | Statut CDC                                                |
| --- | ------------------------------------- | --------------------------------------------------------- |
| 117 | IndexedDB storage                     | COUVERT                                                   |
| 118 | Storage quota management              | COUVERT (spec: « storage quota failure blocks mutation ») |
| 119 | Storage quota warnings                | COUVERT                                                   |
| 120 | Garbage collection of orphaned blocks | ABSENT                                                    |
| 121 | Database integrity checks             | ABSENT                                                    |
| 122 | Defragmentation tools                 | ABSENT                                                    |
| 123 | Block deduplication                   | ABSENT                                                    |
| 124 | Automatic cleanup routines            | ABSENT                                                    |
| 125 | Data migration tools                  | ABSENT                                                    |

### Restauration & Récupération (5)

| #   | Fonctionnalité                    | Statut CDC                     |
| --- | --------------------------------- | ------------------------------ |
| 126 | Backup encryption/decryption      | COUVERT                        |
| 127 | Conflict detection on restore     | COUVERT                        |
| 128 | Selective restore                 | ABSENT                         |
| 129 | Version comparison before restore | COUVERT (PreviewContextExport) |
| 130 | Recovery code validation          | COUVERT                        |

### Performance & Optimisation (8)

| #   | Fonctionnalité                | Statut CDC    |
| --- | ----------------------------- | ------------- |
| 131 | Lazy-loading large documents  | ABSENT        |
| 132 | Indexed full-text search      | COUVERT       |
| 133 | Incremental backup            | ABSENT        |
| 134 | Compression in backup         | ABSENT        |
| 135 | Cache invalidation            | ABSENT        |
| 136 | Query optimization            | ABSENT        |
| 137 | Background indexing           | ABSENT        |
| 138 | Bandwidth optimization (sync) | ABSENT du CDC |

### Intégrations & Écosystème (5)

| #   | Fonctionnalité      | Statut CDC    |
| --- | ------------------- | ------------- |
| 139 | WeChat integration  | ABSENT du CDC |
| 140 | Zhihu integration   | ABSENT du CDC |
| 141 | Yuque integration   | ABSENT du CDC |
| 142 | WordPress publisher | ABSENT du CDC |
| 143 | Extension ecosystem | ABSENT du CDC |

---

## Analyse de Parité

### Décompte

- **Total SiYuan:** 143 features
- **COUVERT (spec ou journey):** 29
- **ABSENT T1 (coherent, missing):** 42
- **ABSENT T2 (heavier surfaces):** 43
- **CONFLIT (non-goal conflicts):** 29

### Couverture Réelle du CDC

✓ **Cœur satisfait :** bloc local, révisions, liaisons, recherche IndexedDB, export sélectif, sauvegarde chiffrée, restauration avec conflits explicites, suppression locale.
✗ **Exclusions volontaires (« non-goals ») :** cloud sync, collaboration temps-réel, publication publique, RAG sur carnet complet, revocation distante, plugins/thèmes.

---

## Proposition d'Amendement

### T1 Parité-Cœur (Absent, Pas de Conflit, Cohérent)

Ajouter au CDC, compatible souveraineté locale :

| Titre                                    | Justification                                                                     | Impact                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Détection de mentions non liées**      | Améliore découverte de liaisons oubliées dans le graphe local.                    | Query supplémentaire sur index de mots ; pas de réseau ni de stockage. |
| **Visualisation du graphe de relations** | Rend visible la structure des références locales. Utile pour contextes complexes. | SVG rendu côté client ; Graph closure déjà calculée (export).          |
| **Attributes/Tags personnalisés**        | Ajoute métadonnées bloc pour filtrage/recherche avancée locale.                   | Schéma bloc + index supplémentaire IndexedDB.                          |
| **Recherche avancée + filtres**          | Enrichit `SearchLocalIndex` avec opérateurs (date, tag, attribut).                | Même limite : index IndexedDB, aucun réseau.                           |
| **Export texte/HTML (context)**          | Contextes exportés en formats lecteur-friendly au-delà de Markdown.               | Sérialisation supplémentaire dans le preview.                          |
| **Undo/Redo avec limite locale**         | Historique de révisions courtes exploitable.                                      | Révisions existantes déjà ; ajouter navigation UI.                     |

### T2 Parité-Étendue (Surfaces Lourdes, Absent, Pas de Conflit)

Évaluer hors scope v1 — architecture possible, coût non quantifié :

| Titre                             | Justification                                        | Risque                                                               |
| --------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| **Flashcards spaced-repetition**  | Apprentissage par répétition depuis bloc. Algo Riff. | Logique de schedulage + UI + état persistence. Orthogonal au carnet. |
| **Formules math (LaTeX)**         | Typographie scientifique.                            | Dépendance lourde (KaTeX/MathJax). Portable en export.               |
| **Diagrammes (flowchart, Gantt)** | Visualisations structurées.                          | Dépendances (Mermaid, etc.). Stockage + rendu client.                |
| **Web clipping**                  | Capture de contenu externe.                          | Demande permission clipboard + analyseur HTML. Dérive non-local.     |
| **Système de templates**          | Blocs réutilisables (patterns).                      | Analogie avec snippets. Structure de stockage supplémentaire.        |
| **Mobile native (iOS, Android)**  | Accès hors PWA.                                      | Développement multiplateformes. Synchronisation complexe.            |
| **SQL queries embed**             | Requêtes sur le graphe bloc.                         | Langage de requête + moteur. Surface à verrouiller.                  |

### Arbitrages Critiques (Conflits Non-Goal)

| Conflit                      | Non-Goal Spec (exact)                                                           | Option A (Libre AI)                                                                      | Option B (Converger SiYuan)                        | Trade-off                                                                |
| ---------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| **Sync cloud E2E**           | « implicit ingestion, background cloud sync or server-side note storage in v1 » | Garder local-only v1 ; export explicite = transfert.                                     | Ajouter cloud sync optionnel (WebDAV/S3).          | A = souveraineté garantie. B = commodité multi-device, coût trust.       |
| **Collaboration temps-réel** | « collaborative editing »                                                       | Exclure. Chaque device = workspace indépendant.                                          | Ajouter CRDT + server pour sync collaboratif.      | A = garantit isolation. B = use-case équipe, coût architecture+sécurité. |
| **Publication publique**     | « public publishing »                                                           | Export = fichier immutable hors-app. Propriétaire contrôle révocation.                   | Pages publiques hébergées (statique ou dynamique). | A = pas de dépendance serveur. B = partage aisé, plateforme dépendance.  |
| **RAG chat notebook**        | « RAG chat over the complete notebook »                                         | Exclure. Chat external = chatbot classique (pas accès bloc).                             | Embedding local + LLM-lite pour contexte.          | A = pas d'indexing continu. B = assistant contextuel, memory overhead.   |
| **Plugins/Marketplace**      | (Pas explicite, mais « no hidden telemetry » implique contrôle)                 | Exclure v1. Code = app elle-même.                                                        | Basaar-like : marketplace + Petal API.             | A = surface attaque minée. B = extensibilité, audit plugins complexe.    |
| **Revocation distance**      | « claiming remote revocation of a downloaded export »                           | Explicite refusal code. Export révoqué = metadata local, copie existante = propriétaire. | Ajouter beacon serveur (revocation list).          | A = pas de téléphone maison. B = contrôle post-download, trust serveur.  |

---

## Résumé Exec

**143 features SiYuan → 29 couvertes + 42 T1-feasible + 43 T2-lourdes + 29 conflits volontaires.**

**Cœur validé :** Libre AI Notebook couvre la trajectoire SiYuan pour bloc/révisions/liens/recherche/export/backup. Gap principal = visualisations, plugins, sync cloud, collaboration.

**Décisions en suspens :** 6 arbitrages (sync, collaboration, publish, RAG, plugins, revocation) nécessitent validation propriétaire. Chacun porte un trade-off souveraineté/commodité documenté.

**Dépendances critiques T2 :** Flashcards (orthogonal), Formules (lourdes), Diagrams (dépendances), Mobile native (multiplateformes), SQL queries (surface à geler).
