<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# ADR-0063 — Pile puriste : Rust partout où du contenu est traité, TypeScript à la lisière de l'interface, LangGraph oracle de recherche seulement

- **Statut :** proposé — l'acceptation est un acte du propriétaire : il ajoute la ligne d'arbitrage datée et fait passer ce statut de proposé à en vigueur dans la pull request qu'il fusionne. Tant que ces deux lignes n'ont pas changé, l'ADR n'est pas en vigueur, fusionné ou non.
- **Arbitrage :** aucun à ce jour. L'écriture de cet ADR a été décidée par le propriétaire le 2026-11-09 par question structurée en chat (« 0066 + 0063 d'abord », sur les cinq ADR candidats de la vision complète) ; son contenu reste une proposition de l'agent.
- **Date de rédaction :** 2026-11-09
- **Portée :** la pile d'exécution de tout dépôt de l'organisation qui traite du contenu : produits du catalogue (ADR-0042 §1), fabrique, harness, gates de flotte lorsqu'ils lisent du contenu, hôtes de native messaging, CLI et TUI. Ne modifie ni les contrats canoniques, ni les licences, ni l'ordre d'ADR-0042 §3.
- **Amende :**
  - ADR-0042 §5, l'énoncé « Les produits serveur suivent Bun et PostgreSQL » : les produits serveur suivent **Rust** (axum, sqlx) et PostgreSQL ; la dérogation SQLite de Work Supervision v0 est inchangée.
  - ADR-0058 (LangGraph JS admis comme runtime des workers TypeScript) : **renversé** pour les produits et la fabrique. LangGraph redevient ce qu'ADR-0032 D38 en faisait avant l'amendement : un oracle de recherche de patrons, jamais un runtime servi. ADR-0032 D2 à D5 restent en vigueur mot pour mot.
  - I-06 (stack) : « Rust admis comme runtime serveur complet lorsque l'ADR d'un produit le décide » devient « Rust est le runtime serveur de tout produit ; Bun et TypeScript strict sont l'outillage de build, de test et de gates, et la lisière de l'interface (React 19 dans une coquille Tauri 2 ou une PWA) ». Le texte historique reste dans `docs/decisions/INVARIANTS.md` entre guillemets, comme pour I-10 et I-25.
- **Généralise :** ADR-0054 §1 (P02-D5 : serveur entièrement en Rust, API et worker dans un même workspace Cargo), qui ne valait que pour P02 ; ADR-0037 (cœur natif de l'exécution autorisée sans dépendance LangGraph), qui ne valait que pour le graphe d'exécution.
- **Confirme :** ADR-0057 (Tauri 2 coquille macOS de tous les produits) ; ADR-0044 D3 ; ADR-0034 §« Frontière du premier incrément » (aucun framework d'agent dans un runtime, un contrat ou un SDK).
- **Applique :** I-06 (amendé ici), I-08 (discipline de preuve), I-11 (licences), I-18 (noyau de sécurité des boucles), I-32 (isolation par construction), I-38 (aucune installation live).
- **Invariants :** I-06 amendé (voir « Amende »). Aucun invariant retiré, aucun ajouté.
- **Origine :** inspection — vision complète du 2026-11-09 (document d'analyse hors dépôt, principe P1 « Rust partout où du contenu est traité ») ; mesure du jour, ci-dessous.

## Contexte

La doctrine porte aujourd'hui trois énoncés de pile qui ne disent pas la même chose :

1. ADR-0042 §5 : « Les produits serveur suivent Bun et PostgreSQL ».
2. ADR-0054 §1 : « Pour P02, le serveur est entièrement en Rust : axum pour l'API HTTP, sqlx pour l'accès aux données, PostgreSQL pour le stockage », et I-06 amendé en conséquence : Rust admis « lorsque l'ADR d'un produit le décide ».
3. ADR-0058 : LangGraph JS « est un runtime admis du graphe interne d'un worker TypeScript ».

Le premier produit dont la pile serveur a été décidée après mesure (P02, ADR-0054) a choisi Rust. Le deuxième produit sorti du gel (P15, ADR-0055) est porté par `signalement`, dont le serveur est en Rust. La règle générale (Bun serveur) n'a donc **aucun produit** qui l'applique, et chaque produit qui s'ouvre doit la contourner par un ADR. Une règle que tous ses cas contournent n'est pas une règle : c'est un compromis par défaut.

Le compromis a un coût que la vision complète nomme : du contenu d'utilisateur (flux, documents, messages) traité par un runtime JavaScript avec sa chaîne de dépendances npm, là où les invariants de sécurité (I-18, I-32, I-38) et la discipline de preuve supposent un binaire unique, un graphe de dépendances audité par `cargo` (gate de provenance de `rev`, Dependabot cargo prouvé le 2026-10-09) et une frontière de contenu tenue par le typage. ADR-0058 ajoute un framework d'agent dans ce même plan de données, pour des workers qui n'existent pas encore.

### Mesure du 2026-11-09

- **Aucun worker LangGraph n'existe dans un produit.** `gh search code --owner libre-ai '"@langchain/langgraph"'` ne renvoie, hors documents, que `libre-ai/execution-continuity-evaluator` (`tools/review/package.json`, `tools/review/fanout-graph.ts`, ses tests et son registre d'avis). C'est l'outillage de revue du dépôt d'étude d'ADR-0032 : un oracle de recherche, pas un worker de produit. La porte d'ADR-0058 est donc encore à deux sens : la renverser ne casse aucun produit.
- **Deux produits serveur, deux serveurs Rust.** P02 (ADR-0054 §1) et P15 (`signalement`, serveur axum). Zéro produit serveur en Bun.
- **Bun reste indispensable comme outillage.** Les gates de ce dépôt (`tools/quality/*.ts`, `ecosystem/*.ts`) et de la flotte sont en TypeScript sous Bun ; cet ADR ne les touche pas.

## Décision proposée

- **D1. Rust partout où du contenu est traité.** Tout composant qui lit, transforme, stocke ou transmet du contenu d'utilisateur ou d'organisation est écrit en Rust : serveurs (axum, sqlx, PostgreSQL), parseurs, moteurs de recherche et d'index, hôtes de native messaging, CLI et TUI, moteur de la fabrique et du harness. « Contenu » s'entend au sens d'ADR-0045 et I-32 : toute donnée qui n'est pas une métadonnée typée produite par le système lui-même.
- **D2. TypeScript strict à la lisière de l'interface seulement.** React 19 et Vite dans une coquille Tauri 2 (ADR-0057) ou une PWA (ADR-0054 §3). La lisière ne porte aucune règle métier, aucun parseur, aucun appel de modèle : elle appelle le cœur Rust par le pont Tauri ou par une API typée.
- **D3. Bun est l'outillage, jamais le runtime servi.** Build, tests, gates, génération de projections et scripts de flotte restent sous Bun et TypeScript strict (I-06). Aucun processus Bun ne sert une requête d'utilisateur ni ne traite son contenu.
- **D4. LangGraph est un oracle de recherche, pas un runtime.** ADR-0058 est renversé pour les produits, la fabrique et le harness ; ADR-0032 D38 retrouve sa forme initiale (« jamais une autorité, jamais un runtime servi »). Le graphe d'exécution des agents est le cœur natif d'ADR-0034/0037. L'outillage de revue de `execution-continuity-evaluator` reste admis au titre d'ADR-0032 (étude de patrons) et porte dans son `AGENTS.md` la mention « oracle de recherche, jamais servi ».
- **D5. Parité avant réécriture.** Rien d'existant n'est réécrit pour la pureté : un composant TypeScript qui traite du contenu aujourd'hui (s'il en apparaît un à l'inventaire) est inscrit comme dérogation datée dans la fiche de son dépôt, avec le test de parité qui conditionne son remplacement. Le gate de conformance par dépôt (carte des briques, ADR-0064) compte ces dérogations ; une dérogation sans date de fin est un rouge.
- **D6. Première preuve.** Le premier produit qui atteint « prototypé » sous cette pile est P02 (`information-watch`), décision du propriétaire du 2026-11-09 (« P02 information-watch » comme première preuve) ; P15 suit. Aucun autre produit ne sort du gel avant.

## Ce qui n'est pas décidé ici

- Les classes de données et les zones d'exécution (local, UE) : ADR candidat « classes et zones », à écrire après celui-ci.
- L'admission des modèles comme gate (poids ouverts, hébergement UE, signature) : ADR candidat distinct.
- Le choix d'un serveur de modèles local et la forme de la passerelle : relèvent de la couche `passerelle` de la carte des briques (ADR-0064), à décider par leurs propres fiches.
- Le sort du dépôt `execution-continuity-evaluator` au-delà de la mention D4.
- Les plateformes au-delà de macOS : ADR-0064 porte le palier Linux et son déclencheur.

## Conséquences

- Si accepté : I-06 est réécrit dans `docs/decisions/INVARIANTS.md` (texte historique conservé entre guillemets) ; ADR-0042 reçoit « Amendé par : ADR-0063 » sur sa ligne de statut ; ADR-0058 reçoit « Renversé par : ADR-0063 » ; le `AGENTS.md` de `execution-continuity-evaluator` reçoit la mention D4 ; le gabarit de fiche de dépôt (couche `gouvernance`, conformance) reçoit un champ `derogation-pile` daté. Aucun code n'est réécrit.
- Si renversé : le propriétaire écrit ici la pile qu'il retient, et ADR-0054 reste l'exception nommée qu'il est aujourd'hui.
- Coût assumé : les produits serveur n'ont plus de voie « rapide » en Bun ; un produit qui n'a pas encore de cœur Rust commence par là. C'est le choix de la vision complète : la pureté de la pile est une propriété de sécurité (surface de dépendances, frontière de contenu), pas une préférence.

## Retour arrière

Porte à deux sens tant que la mesure ci-dessus tient (aucun worker LangGraph de produit, aucun serveur Bun de produit). Annuler la fusion rend l'état antérieur ; si un composant a été écrit sous D1 entre-temps, il reste valide sous ADR-0054 (Rust admis par ADR de produit). Le jour où un worker LangGraph ou un serveur Bun de produit existe, cette porte devient à sens unique et la mesure est à refaire avant tout renversement.
