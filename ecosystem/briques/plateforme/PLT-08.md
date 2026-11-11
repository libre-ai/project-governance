# PLT-08 — Poste de pilotage signé

## Contexte

Au 2026-11-11, l'expression « poste de pilotage » n'apparaît dans aucun fichier de ce dépôt hors de la carte : réunir sous ce nom les deux outils qui suivent est une proposition de l'agent, non arbitrée. Le premier est Work Supervision, qu'ADR-0042 §1 loge dans `ai-work-supervision` ; le §3 décrit pour la fabrique un cœur Rust, des terminaux et un cockpit web. Le second est l'agencement des fenêtres, P40, que le §9 dit outil local mono-poste et qu'ADR-0052 publie dans `square-control` (D76). Au commit cité, `square-control` porte un script de signature et un contrôle statique du binaire. Dans `ai-work-supervision`, au commit `7a0afef5` lu le 2026-11-11, aucun chemin de l'arbre ne contient « sign » ni « notar ». Aucun invariant n'est cité : aucun de ceux relus pour cette brique ne porte sur la signature ou le contrôle d'un binaire.

## Ce que la brique ferme

- Le bundle de P40 qui importe un symbole absent de la liste fermée du dépôt, ou un des symboles que le gate interdit (réseau, chargement dynamique, interfaces privées).
- Le bundle qui lie une bibliothèque que le gate interdit (cadres privés, réseau, capture d'écran), déclare un schéma d'URL, ou porte un des cinq droits que le script nomme.
- Le bundle sans runtime durci, ou dont la signature ne se vérifie pas.
- Le binaire qui garde dans ses octets un chemin de la machine qui l'a construit.

## Ce qu'elle ne fait pas

- Elle ne distribue rien à un tiers : ADR-0052 n'autorise ni la signature Apple ni cette distribution, qui relèvent de PLT-03.
- Elle ne tient pas la signature de ce que la flotte remet à un tiers : c'est PRV-03, qui n'est pas une dépendance. Au commit cité, le bundle est signé par un script du dépôt porteur.
- Elle ne distingue pas une signature ad hoc d'une identité stable : le gate cité vérifie qu'une signature existe et tient, pas qui signe.
- Elle ne définit pas les surfaces de pilotage : HAR-05.
- Elle n'installe rien : livrer un binaire n'est pas l'installer.

## Mesure

- Preuve citée : le gate statique du bundle de P40. Il compare les symboles importés à une liste fermée et leurs bibliothèques à un ensemble admis. Il cherche des symboles, des bibliothèques liées, des droits et des chaînes interdits. Il vérifie la signature et le runtime durci, imprime ce qu'il a examiné et échoue sur une entrée illisible.
- Au commit cité, le workflow de CI de `square-control` tourne sur Linux et écrit que ce gate n'y tourne pas. Le script de signature du même dépôt, non cité en preuve, signe d'une identité locale ou, à défaut, ad hoc, et imprime le mode employé.
- La preuve porte sur P40 seul : rien n'est montré pour Work Supervision.
- Prochaine preuve : le même gate joué par un job macOS sur un bundle signé d'une identité stable, puis étendu aux binaires de Work Supervision.
