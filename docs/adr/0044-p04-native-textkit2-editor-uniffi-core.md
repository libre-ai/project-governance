# ADR-0044 — P04 : éditeur natif SwiftUI/AppKit + TextKit 2, cœur Rust par UniFFI

- **Statut :** proposed — la fusion de cette pull request constitue l'arbitrage propriétaire
- **Arbitrage :** décision propriétaire Y19, prise par question structurée (ADR-0022/I-24) au vu des prototypes de la question N1 du PRD de P04 : la voie (a) est la voie de développement, et l'ADR n'est posé qu'après deux mesures manquantes — AT-02 avec aperçu en direct, et la mémoire résidente avec un index plein texte réel. Les deux mesures ont été faites le 2026-10-09 et passent (§Preuves). Owner-arbitration: 2026-10-09
- **Applique :** ADR-0042 §8 (premier palier : application macOS native, adaptateur d'interface du cœur Rust du produit) ; I-06 (Rust pour les moteurs spécialisés) ; I-08 (discipline de preuve : protocole et effectifs figés et commités avant toute mesure) ; I-11 (licences : les briques des mesures sont sous MIT, UniFFI sous MPL-2.0) ; I-24 (décision par question structurée)
- **Autorise :** l'écriture de l'éditeur de l'application macOS de P04 sur cette voie, quand le travail de P04 s'ouvrira selon l'ordre d'ADR-0042 §3
- **N'autorise pas :** la création d'un dépôt ; l'activation de P04 ; un moteur web dans l'éditeur de P04 ; l'adoption d'une brique hors des licences admises ; une promesse de performance sur la machine de référence, qui n'a pas été mesurée ; l'extension de ce choix aux autres produits du catalogue, dont la technologie d'interface relève de leur propre décision

## Contexte

Le PRD de P04 (notes et mémoire personnelle) laisse ouverte la question N1 : la technologie de l'éditeur de l'application macOS. Deux voies étaient retenues : (a) AppKit/SwiftUI avec un éditeur TextKit 2, cœur Rust appelé par UniFFI ; (b) une coquille AppKit embarquant CodeMirror 6 dans une WKWebView, sans réseau, appelant le même cœur. La décision Y5 demandait de prototyper les deux et de trancher sur AT-01 (fidélité à l'octet sur un coffre synthétique de 10 000 notes) et AT-02 (latence frappe → rendu).

Les deux prototypes ont passé AT-01 et AT-02 : ces deux tests ne départagent pas. Les écarts mesurés se trouvent ailleurs — mémoire résidente, texte exposé à l'accessibilité, ouverture d'une note, surface d'attaque — et tous favorisent (a). Le propriétaire a retenu (a) (Y19), sous réserve de deux mesures que la première série ne contenait pas : la latence avec un vrai aperçu en direct, dont le coût est le risque R15 du PRD pour un éditeur entièrement à écrire, et la mémoire avec un index réel, NFR-10 portant sur l'application et son index. Ce document en est le résumé décisionnel ; le rapport détaillé et les prototypes restent privés.

## Décision

1. **L'éditeur de l'application macOS de P04 est natif** : AppKit, `NSTextView` sur TextKit 2 (`NSTextLayoutManager`), SwiftUI admis pour la coquille hors éditeur. L'aperçu en direct est rendu par attributs et par fragments de mise en page TextKit 2, sans moteur web.
2. **Le cœur Rust du produit est appelé par UniFFI.** Il porte la lecture et l'écriture fidèles à l'octet, l'analyse Markdown de l'aperçu et l'index plein texte ; l'interface Swift ne réimplémente aucune de ces fonctions.
3. **L'éditeur ne modifie aucun caractère que la personne n'a pas tapé** : substitutions automatiques (guillemets, tirets, remplacements, correction, détection de liens et de données) et insertion intelligente d'espaces désactivées ; l'aperçu ne change que des attributs. Ce sont les conditions sous lesquelles AT-01 a tenu ; une contribution qui en retire une rouvre AT-01.
4. **La voie (b), CodeMirror 6 dans une WKWebView, est écartée pour P04**, pour les écarts mesurés : mémoire de fin 413 Mio contre 49 Mio sans index ; 0,54 % du texte d'une note de 1 Mio exposé à l'accessibilité contre 100 % ; première ouverture au seuil de NFR-03 (p95 99,7 à 100,9 ms) contre 28 à 76 ms avec coloration ; un moteur web et trois processus de plus dans la surface d'attaque.

## Conséquences et limites

- **NFR-03 n'est pas tenu sur la note de 1 Mio avec l'aperçu** : première ouverture p95 113 ms pour un seuil de 100 ms, parce que l'aperçu analyse et rend tout le document à l'ouverture. Les notes ordinaires s'ouvrent en p95 11 ms. Un rendu de la zone visible d'abord, puis du reste par tranches, est requis avant la qualification de P04 ; il n'est pas mesuré.
- L'aperçu mesuré est minimal : titres, emphase, liens et liens wiki, listes et tâches, code, citations, frontmatter, masquage de la syntaxe hors de la ligne du curseur. Callouts, transclusions, tableaux, notes de bas de page et images restent à écrire ; chaque ajout se re-mesure contre AT-02.
- Le cas le plus coûteux du re-parse incrémental — ouvrir ou fermer une clôture de code dans une note de 1 Mio, qui re-parse jusqu'à la fin — n'est pas dans AT-02.
- **La machine de référence du PRD (32 Gio, 12 CPU) n'est pas mesurée** ; les mesures sont faites sur une machine plus puissante (36 Gio, 14 CPU). Les paramètres qui suivraient la machine (fils et budget d'écriture de l'index) sont épinglés, mais la latence n'est pas transposée : sa seule garantie est la marge mesurée, 1,6× sous le seuil au pire cas. Le risque R7 du PRD reste ouvert.
- Un pic transitoire d'environ 220 Mio apparaît aux premières trames affichées, indépendamment de la taille de la note et de l'index, et disparaît en une à deux secondes ; son propriétaire n'est pas établi. Il est compris dans le verdict de NFR-10.
- La base SQLite de l'architecture du PRD et l'hôte de native messaging ne sont pas dans la mesure de NFR-10 : il reste 188 Mio pour eux au pire lancement.
- La saisie composée (IME) n'a été vérifiée que par programme, et l'accessibilité par l'API, pas avec un vrai clavier japonais ni avec la synthèse VoiceOver.
- L'éditeur avec aperçu est entièrement à écrire et à maintenir ; deux langages, Rust et Swift. Le coût d'écriture n'est pas un critère de cette décision.

## Preuves

Protocoles figés et commités avant chaque série (effectifs, seuils, statistiques, règles de rejet) ; statistiques au rang le plus proche sur les échantillons poolés ; une frappe non rendue en 2 s compte +∞ ; un lancement fait session verrouillée ou écran éteint est rejeté et refait. Rapport privé : `analyses/omarchy-2026-10-07/15-p04-n1-prototypes.md`, sections 0 à 10 (série du 2026-10-08, deux voies) et « Mesures complémentaires (a) » (série du 2026-10-09).

| Mesure | Seuil (PRD de P04) | (a) TextKit 2 | (b) CodeMirror 6 / WKWebView |
| --- | --- | --- | --- |
| AT-01, aller-retour sans édition | 100 % des 10 000 fichiers identiques à l'octet | 200 000 / 200 000 (20 passes) | 100 000 / 100 000 (10 passes sur 20 prévues, une passe interrompue par une erreur WebKit) |
| AT-01, édition d'un paragraphe | aucun octet modifié hors du paragraphe | 199 640 / 199 640 exactes | 99 820 / 99 820 exactes |
| AT-02, coloration syntaxique, 5 000 lignes | p95 ≤ 16 ms | p95 5,83 ms | p95 6,04 ms |
| AT-02, coloration syntaxique, 1 Mio | p95 ≤ 50 ms | p95 6,12 ms | p95 6,18 ms |
| **AT-02, aperçu en direct, 5 000 lignes** | p95 ≤ 16 ms | **p95 10,27 ms** (médiane 7,17 ; 3 000 frappes) | non mesuré |
| **AT-02, aperçu en direct, 1 Mio** | p95 ≤ 50 ms | **p95 9,79 ms** (médiane 6,74 ; 3 000 frappes) | non mesuré |
| Mémoire, note de 1 Mio ouverte, sans index (fin de lancement) | — | 49 Mio | 413 Mio (dont 240 Mio de processus GPU WebKit) |
| **NFR-10, index tantivy de 10 000 notes, note de 1 Mio avec aperçu** | ≤ 500 Mio | **pic de vie max 312 Mio** sur 60 lancements (médiane 270 index existant, 296 index construit dans le processus) ; fin de lancement médianes 51 et 53 Mio, max 94 Mio | non mesuré |
| Texte exposé à l'accessibilité, note de 1 Mio | — | 100 % | 0,54 % |
| NFR-03, première ouverture, note de 1 Mio | p95 ≤ 100 ms | 76 ms avec coloration ; **113 ms avec aperçu** | 99,7 ms (100,9 ms sur la note de 5 000 lignes) |

- Contrôles de l'aperçu, sans verdict : rendu incrémental identique à un rendu complet après 1 000 éditions aléatoires par note (attributs et structure suivie) ; une passe AT-01 avec aperçu actif : 10 000 / 10 000 allers-retours identiques, 9 982 / 9 982 éditions exactes.
- Briques des mesures, licence lue dans leur fichier de licence : `pulldown-cmark` 0.13.4 (MIT), `tantivy` 0.26.2 (MIT) ; UniFFI 0.32.1 (MPL-2.0). Graphe du cœur sans licence hors des licences admises ; toutes les versions verrouillées ont au moins trois jours.
