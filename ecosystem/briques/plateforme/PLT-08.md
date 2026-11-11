# PLT-08 — Poste de pilotage signé

## Contexte

La doctrine n'emploie pas l'expression « poste de pilotage ». La brique regroupe les deux outils que le propriétaire fait tourner sur son poste. Le premier est Work Supervision, outil de la méthode (I-13), dont ADR-0042 §3 décrit le cœur Rust, les terminaux en CLI et TUI, et le cockpit web limité à la lecture et à la décision. Le second est l'agencement des fenêtres, P40, publié dans `square-control` par ADR-0052 (D76). Seul `square-control` porte une chaîne de signature et de contrôle du binaire. `ai-work-supervision` porte le cockpit, sans signature ni release.

## Ce que la brique ferme

- Le binaire du poste qui importe un symbole réseau, déclare un schéma d'URL ou porte un droit hors de la liste fermée.
- La signature ad hoc prise pour une identité stable : le script de signature dit quel mode il a employé.
- L'outil d'agent installé parce que son dépôt a été publié ou synchronisé : I-38 exige une demande explicite du propriétaire.

## Ce qu'elle ne fait pas

- Elle ne distribue rien à un tiers : ADR-0052 n'autorise ni la signature Apple ni cette distribution, qui relèvent de PLT-03.
- Elle ne produit pas la signature : PRV-03.
- Elle ne définit pas les surfaces de pilotage : HAR-05.
- Elle n'installe rien sur un poste (I-38).

## Mesure

- Preuve citée : le gate statique du bundle de P40. Il compare symboles importés, bibliothèques liées, droits et chaînes à des listes fermées, et vérifie la signature et le runtime durci.
- Il tourne sur macOS, hors CI. La signature est locale ou ad hoc.
- Prochaine preuve : le même gate joué par un job macOS sur un bundle signé d'une identité stable, puis étendu aux binaires de Work Supervision.
