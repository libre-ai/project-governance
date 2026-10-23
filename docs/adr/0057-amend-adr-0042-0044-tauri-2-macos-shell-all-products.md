# ADR-0057 — Amendement d'ADR-0042 §6/§8 et d'ADR-0044 : Tauri 2 est la coquille macOS de tous les produits du catalogue, P04 inclus

- **Statut :** proposé — la fusion de cette pull request vaut signature du propriétaire (ADR-0043).
- **Arbitrage :** Owner-arbitration: 2026-10-23 — décision prise en chat par question structurée (ADR-0022/I-24), après restitution des trois ADR qu'elle renverse et des mesures qu'ils portent. La formulation du propriétaire est reprise, non réinterprétée (section « Source »).
- **Date de rédaction :** 2026-10-23
- **Portée :** la technologie de la coquille macOS de tout produit du catalogue d'ADR-0042 §1. Ne modifie ni le cœur Rust des produits, ni l'extension navigateur, ni l'hôte de native messaging, ni la matrice de parité, ni l'ordre d'ADR-0042 §3.
- **Amende :**
  - ADR-0042 §6, l'énoncé « un cœur Rust et des adaptateurs d'interface par plateforme » (`docs/adr/0042-product-vision-and-realization-method.md:153-154`) : l'adaptateur macOS est nommé, c'est une coquille Tauri 2 ;
  - ADR-0042 §8, le premier palier « application macOS native » pour tous les produits (`docs/adr/0042-product-vision-and-realization-method.md:205-207`) : « native » devient « Tauri 2 » ; le reste du §8 (extension, native messaging par stdio, aucun port en écoute, signature et notarisation) est inchangé ;
  - ADR-0044 décisions 1 et 4 (`docs/adr/0044-p04-native-textkit2-editor-uniffi-core.md:17` et `:20`) : l'éditeur de l'application macOS de P04 n'est plus natif ; la voie (b), CodeMirror 6 dans une WKWebView, est rétablie et portée par la coquille Tauri 2. Les décisions 2 et 3 d'ADR-0044 (cœur Rust par UniFFI ou par le pont de la coquille ; aucun caractère modifié que la personne n'a pas tapé) restent en vigueur.
- **Généralise :** ADR-0054 §3 (D88, D92, D93 ; `docs/adr/0054-amend-adr-0042-p02-v1-surfaces-stack-repository.md:48` et `:54`), qui ne valait que pour P02.
- **Invariants :** aucun invariant modifié. I-06 (stack web : Bun, TypeScript strict, React 19) couvre déjà le front d'une coquille Tauri ; I-08 (discipline de preuve) et I-27 (parité) s'appliquent sans changement.
- **N'autorise pas :** la création d'un dépôt ; l'activation d'un produit ; une promesse de performance non mesurée ; une plateforme hors du premier palier (mobiles, Windows, Linux restent au second palier d'ADR-0054 §3) ; l'abandon d'un seuil mesuré d'ADR-0044.

## Contexte

État de la doctrine le 2026-10-23, avant cet ADR :

- ADR-0042 §8, arbitré « tous les produits » le 2026-10-08 : le premier palier est une application macOS **native**, adaptateur d'interface du cœur Rust du produit (D57).
- ADR-0044, arbitré le 2026-10-09 (D63) : l'éditeur de P04 est natif (AppKit, TextKit 2). La voie (b), CodeMirror 6 dans une WKWebView, est écartée sur mesures : mémoire de fin de lancement 413 Mio contre 49 Mio sans index ; 0,54 % du texte d'une note de 1 Mio exposé à l'accessibilité contre 100 % ; première ouverture au seuil de NFR-03 ; un moteur web et trois processus de plus dans la surface d'attaque.
- ADR-0054 §3, arbitré le 2026-10-22 (D88) : pour P02 seul, l'application macOS est une coquille Tauri 2, le cœur Rust et le front web dans une WKWebView, sous un plafond de 512 MiB de mémoire résidente figé avant mesure (D92) et une clause de retour au natif si le plafond est dépassé.

Tauri 2 sur macOS rend le front dans une WKWebView : les mesures d'ADR-0044 sur la voie (b) décrivent donc le même moteur de rendu que la coquille retenue ici. Elles ne sont pas contredites par cet ADR ; elles deviennent les seuils que la coquille doit tenir (§3).

Faits mesurés le 2026-10-23, reproductibles par les commandes indiquées :

- Licence de Tauri : fichiers `LICENSE-MIT`, `LICENSE-APACHE-2.0` et `LICENSE.spdx` à la racine du dépôt (`gh api repos/tauri-apps/tauri/contents --jq '.[] | select(.name | test("LICEN")) | .name'`). Double licence MIT ou Apache-2.0, toutes deux admises par ADR-0042 §4.
- Gouvernance : Tauri est un Programme de The Commons Conservancy, fondation de droit néerlandais, statuts publics (<https://commonsconservancy.org/dracc/0035/>). Aucune entreprise ne détient la marque ni le code ; CrabNebula est un partenaire commercial, dont aucun service n'est requis.
- Activité : dernière release `tauri-cli-v2.12.4` publiée le 2026-10-21 ; dernier push le 2026-10-23 (`gh api repos/tauri-apps/tauri/releases/latest --jq .tag_name` ; `gh api repos/tauri-apps/tauri --jq .pushed_at`).
- Les prototypes de la question N1 de P04 (`~/Documents/libre-ai-work/p04-n1-prototypes/`, répertoire jetable du rapport privé du 2026-10-08) n'existent plus sur le poste : `ls` répond « No such file or directory ». La re-mesure sous Tauri ne peut pas être faite dans la session qui écrit cet ADR ; elle est posée comme condition bloquante (§3).

## Décision

### 1. Tauri 2 est la coquille macOS de tous les produits du catalogue (amende ADR-0042 §6 et §8)

Pour tout produit soumis à ADR-0042 §8, l'application macOS du premier palier est une coquille Tauri 2 : le cœur Rust du produit est lié dans le processus de l'application, le front est écrit sur la stack d'I-06 et rendu dans la WKWebView du système. Le front ne réimplémente aucune fonction du cœur.

Le reste du §8 est inchangé : l'extension navigateur parle au même cœur par native messaging et stdio ; aucun port n'est ouvert sur la machine ; un service en écoute sur `localhost` reste écarté ; la distribution à un tiers exige signature et notarisation.

L'exemption nommée de P40 (ADR-0042 §9) n'est pas touchée : P40 n'a aujourd'hui aucune surface d'interface, ses entrées sont des raccourcis clavier et l'API d'accessibilité. Le jour où P40 porte une fenêtre, cette fenêtre est une coquille Tauri 2 au titre du présent ADR, sans nouvel arbitrage.

### 2. P04 passe sur la coquille Tauri 2, la voie (b) de l'éditeur est rétablie (amende ADR-0044 D1 et D4)

L'application macOS de P04 est une coquille Tauri 2. Son éditeur est CodeMirror 6, servi depuis la mémoire de l'application sans réseau, selon la conception de la voie (b) du rapport du 2026-10-08 : schéma d'URL privé, liste de règles de contenu bloquant toute URL hors schéma, politique de sécurité de contenu `default-src 'none'`, magasin de données non persistant.

Les décisions 2 et 3 d'ADR-0044 tiennent : le cœur Rust porte la lecture et l'écriture fidèles à l'octet, l'analyse Markdown de l'aperçu et l'index plein texte ; l'éditeur ne modifie aucun caractère que la personne n'a pas tapé. Le pont entre le front et le cœur est celui de la coquille Tauri ; UniFFI n'est plus requis pour P04.

### 3. Les mesures d'ADR-0044 deviennent des seuils bloquants, re-mesurés sous Tauri avant tout code d'éditeur de P04

Aucun code de l'éditeur de P04 n'est écrit avant qu'une série de mesures, protocole figé et commité avant la mesure (I-08), ait été rejouée dans une coquille Tauri 2 sur la même machine de mesure et le même corpus synthétique CR-10k que le rapport du 2026-10-08. Les seuils sont ceux du PRD de P04 restitués par ADR-0044 ; ils ne sont pas révisés :

| Mesure | Seuil | Valeur mesurée sur la voie (b) le 2026-10-08, hors Tauri |
| --- | --- | --- |
| AT-01, aller-retour sans édition | 100 % des 10 000 fichiers identiques à l'octet, 20 passes | 100 000 / 100 000 sur 10 passes ; N de 20 non atteint |
| AT-01, édition d'un paragraphe | aucun octet modifié hors du paragraphe | 99 820 / 99 820 sur 10 passes |
| AT-02, aperçu en direct, 5 000 lignes | p95 ≤ 16 ms | non mesuré |
| AT-02, aperçu en direct, 1 Mio | p95 ≤ 50 ms | non mesuré |
| NFR-03, première ouverture, 1 Mio | p95 ≤ 100 ms | 99,7 ms |
| NFR-10, mémoire résidente, app + index + interface | ≤ 500 Mio | 413 Mio sans index |
| Texte exposé à l'accessibilité, note de 1 Mio | 100 % | 0,54 % |

Un seuil rouge au terme de la série n'est pas une révision du seuil : c'est une décision de surface, qui retourne à ADR-0044 pour P04 et se prend par ADR. Le seuil d'accessibilité est nouveau comme seuil, pas comme mesure : ADR-0044 l'avait relevé sans le poser en critère ; il le devient, parce que la voie (b) l'a mesuré à 0,54 % et que l'accessibilité n'est jamais coupée (règle de ne jamais couper : validation aux frontières, sécurité, accessibilité).

### 4. Les règles de P02 valent pour tous les produits (généralise ADR-0054 §3)

- **Plafond de mémoire figé avant mesure.** Chaque produit porte dans sa fiche `project.v1.yaml` ou son ADR le plafond de mémoire résidente de sa coquille en régime établi, écrit avant toute mesure. À défaut de valeur propre, le plafond est celui de P02 : 512 MiB (D92). Un dépassement mesuré à la qualification est une décision de surface (retour au natif pour ce produit), jamais une révision du plafond.
- **Qualification macOS.** La coquille est construite et lancée sur un runner macOS ; `lsof -i -P` ne montre aucun port en écoute ; `codesign --verify --strict` et `spctl --assess` passent ; un ticket de notarisation existe pour chaque release candidate ; le parcours fonctionnel tourne sous Playwright webkit (D93). Le spike `@wdio/tauri-service` de P02 est fait une fois, pour P02 ; son verdict, vert ou rouge, vaut pour la flotte jusqu'à un ADR contraire.
- **Mobiles, Windows et Linux** restent au second palier (ADR-0054 §3). Tauri 2 les cible, ce qui n'est pas une promesse : la promesse se fait par palier, après qualification par un parcours réel (ADR-0042 §6).

## Conséquences

- **D57 amendé** : la coquille du premier palier est Tauri 2, non « native ». **D63 amendé** : l'éditeur de P04 est CodeMirror 6 dans la coquille Tauri 2, sous les seuils du §3. **D88, D92, D93 généralisés** à tous les produits.
- **Un seul moteur de rendu de front** pour la flotte : React 19 et TypeScript strict (I-06) servent le web, la PWA et la coquille macOS. Aucun produit n'écrit deux interfaces.
- **Deux risques assumés, mesurés et nommés**, qui se retrouvent dans la matrice de menace de chaque produit : un moteur web dans le processus de l'application, avec ses processus auxiliaires (surface d'attaque mesurée par ADR-0044 : trois processus de plus) ; le texte de l'éditeur exposé à l'accessibilité par la WKWebView, mesuré à 0,54 % sur la voie (b), désormais un seuil bloquant du §3.
- **Le travail de P04 ne commence pas par l'éditeur** : il commence par la série de mesures du §3, protocole commité d'abord. Le cœur Rust de P04 (lecture, écriture, analyse, index) n'en dépend pas et peut avancer.
- **Rien ici ne crée de dépôt, ne modifie de ruleset et n'exécute d'acte du propriétaire.**

## Source

Question posée au propriétaire le 2026-10-23, par question structurée, après restitution d'ADR-0042 §8, d'ADR-0044 et d'ADR-0054 §3 avec leurs mesures :

> Quel périmètre pour Tauri dans la flotte libre-ai ?

Option retenue, dans sa formulation exacte :

> **Tauri partout, P04 inclus** — Rouvre ADR-0044 : il faut re-mesurer AT-01/AT-02/NFR-10 sous Tauri avant de l'écrire. Mémoire mesurée 413 Mio en WKWebView contre un seuil P04 de 500 Mio avec index. Risque élevé de rouge.

Options écartées : « Adaptateur admis par ADR produit » (recommandée par l'agent) ; « Tauri par défaut, sauf P04 et P40 » ; « Attendre la mesure P02 (D92) ».

Le message initial du propriétaire, le même jour : « On adopte : https://github.com/tauri-apps/tauri ».

La re-mesure demandée par l'option retenue n'a pas pu être faite avant la rédaction : les prototypes du 2026-10-08 ont été purgés du poste (section « Contexte »). Elle est posée comme condition bloquante au §3, au lieu d'être supposée verte.
