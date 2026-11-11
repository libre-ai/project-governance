# PLT-08 — Poste de pilotage signé

## Contexte

Au 2026-11-11, l'expression « poste de pilotage » n'apparaît dans aucun fichier de ce dépôt hors de la carte. La brique regroupe deux outils. Le premier est Work Supervision : ADR-0042 §3 en décrit le cœur Rust, les terminaux et le cockpit web. Le second est l'agencement des fenêtres, P40, que le §9 dit outil local mono-poste et qu'ADR-0052 publie dans `square-control` (D76). Au commit cité, `square-control` porte un script de signature et un contrôle statique du binaire. Dans `ai-work-supervision`, au commit lu le 2026-11-11, aucun chemin de l'arbre ne contient « sign » ni « notar ». Aucun invariant n'est cité.

## Ce que la brique ferme

- Le binaire du poste qui importe un symbole réseau, déclare un schéma d'URL ou porte un droit hors de la liste fermée.
- La signature ad hoc prise pour une identité stable : le script de signature dit quel mode il a employé.

## Ce qu'elle ne fait pas

- Elle ne distribue rien à un tiers : ADR-0052 n'autorise ni la signature Apple ni cette distribution, qui relèvent de PLT-03.
- Elle ne tient pas la signature des artefacts : sans PRV-03, ses binaires ne portent pas de signature à vérifier avant usage.
- Elle ne définit pas les surfaces de pilotage : HAR-05.
- Elle n'installe rien : livrer un binaire n'est pas l'installer.

## Mesure

- Preuve citée : le gate statique du bundle de P40. Il compare symboles importés, bibliothèques liées, droits et chaînes à des listes fermées, et vérifie la signature et le runtime durci.
- Au commit cité, le workflow de CI de `square-control` tourne sur Linux et n'appelle pas ce gate. La signature est locale ou ad hoc.
- Prochaine preuve : le même gate joué par un job macOS sur un bundle signé d'une identité stable, puis étendu aux binaires de Work Supervision.
