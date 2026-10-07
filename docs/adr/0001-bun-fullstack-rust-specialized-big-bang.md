# ADR-0001 — Bun fullstack, React 19, Rust spécialisé et migration Big Bang

- **Statut :** accepted
- **Portée :** écosystème
- **Remplace :** doctrine Rust-first/Dioxus et ADR-0033 historique

## Contexte

L’organisation multi-repositories et la stack Rust-first/Dioxus ont permis d’explorer l’écosystème, mais imposent désormais des coûts de synchronisation, de livraison web et de contexte agentique. La cible à long terme est suffisamment définie pour justifier une reconstruction sans compatibilité historique.

Au checkpoint du 2026-07-16, Bun stable est `1.3.14`. Le canary Rust vérifié est `1.4.0-canary.1+57f349f63`, commit `57f349f6307cf89dcfb8893f003c1ef421a74589`. Clever Cloud supporte Bun mais ne garantit pas encore le pin exact de sa version native.

## Décision

1. Créer un nouveau monorepo sans importer les historiques Git.
2. Figer ensemble les anciens repositories ; aucune nouvelle fonctionnalité n’y est développée.
3. Utiliser Bun `>=1.4.0` comme runtime, package manager, task runner, bundler, serveur HTTP et test runner TypeScript. Tous les manifests Bun déclarent ce plancher ; le bootstrap/CI conserve en plus une révision qualifiée exacte.
4. Utiliser React 19 pour le SSR, l’hydratation, le statique et le rendu client.
5. Utiliser directement `Bun.serve`, sans framework serveur ou meta-framework web.
6. Conserver Rust uniquement pour les composants spécialisés explicitement justifiés.
7. Utiliser JSON Schema, OpenAPI et WIT comme contrats canoniques ; générer les types Rust/TypeScript.
8. Réaliser un cutover global après reconstruction et qualification de la cible.
9. Ne maintenir aucune couche de compatibilité pour les anciens noms, packages ou APIs sauf obligation externe démontrée.
10. Conserver GitHub comme forge canonique déjà arbitrée ; ne pas introduire une nouvelle forge dans cette migration.
11. Différer volontairement toute configuration Clever Cloud jusqu’à la phase d’intégration/déploiement.

## Outillage retenu

- Biome : formatage et lint ;
- Ajv strict : validation JSON Schema ;
- React Aria Components : primitives UI accessibles ;
- Tailwind CSS v4 : styles utilitaires lorsqu’utiles ;
- Playwright : Chromium, Firefox, WebKit et viewport mobile ;
- Bun.sql : accès PostgreSQL des applications ;
- Biscuit : autorisation interne ;
- Clever Cloud Paris/UE : déploiement.

## Conséquences

- les outils existants peuvent cesser de fonctionner ;
- les produits peuvent être indisponibles pendant la reconstruction ;
- la parité historique exhaustive n’est pas une gate ;
- les comportements à conserver doivent être réacceptés dans les specs ;
- Dioxus n’entre pas dans la nouvelle cible web ;
- l’intégration continue dans le monorepo est obligatoire afin d’éviter un assemblage tardif ;
- le canary Bun reste interdit en production sans conservation reproductible et acceptation explicite.

## Garde-fous

- aucune perte de secret, PII, donnée ou obligation de licence ;
- anciens repositories conservés en lecture seule avec SHA final ;
- workstreams bornés par chemins et contrats ;
- validation humaine pour schémas, auth, migrations, releases et déploiements ;
- une seule implémentation durable par domaine.
