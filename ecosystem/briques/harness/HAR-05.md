# HAR-05 — Surfaces de pilotage

## Contexte

ADR-0042 §3 décrit la fabrique : un cœur Rust, une interface en ligne de commande et en terminal, et un cockpit web en lecture et décision seulement, sans pont du navigateur vers un terminal. `ai-work-supervision` porte ces surfaces. Le cockpit écoute sur l'adresse locale, lit la projection et n'écrit que par le démon. L'interface de terminal liste les missions, rejoue le terminal d'une mission et porte une barre de décision.

## Ce que la brique ferme

- L'état de plusieurs missions et sessions d'agents reconstruit à la main : les pages du cockpit montrent missions, résultats, verdicts, demandes de décision ouvertes et sessions déclarées.
- Une décision prise sur un paragraphe : I-24 demande des options exclusives avec leurs conséquences, et l'en-tête du cockpit dit les montrer côte à côte.
- Un navigateur capable d'envoyer une entrée à un terminal d'agent, ce qu'ADR-0042 §3 exclut : l'en-tête du cockpit déclare qu'aucune route n'atteint un terminal, un journal de run ou une entrée.
- Une page servie sans en-têtes de sécurité : I-37 les exige de « toute application de la flotte qui sert du HTML », et le cockpit en sert, avec les écarts que la Mesure nomme.

## Ce qu'elle ne fait pas

- Elle ne tient pas la file des demandes. Sans HAR-07, elle n'a pas de demande à afficher ni à trancher.
- Elle ne lance ni ne confine une session. Sans HAR-02, elle n'a pas de session à montrer.
- Elle n'agence pas de fenêtres : c'est l'objet d'un produit du catalogue, hors de cette couche.

## Mesure

Preuves citées : le module du cockpit et celui de l'interface de terminal, dans `ai-work-supervision`. Ils montrent une surface qui lit et décide, pas son usage sur des missions réelles. Le cockpit sert une politique `default-src 'none'` avec `style-src 'unsafe-inline'`, `nosniff` et `no-referrer`. Ce n'est pas mot pour mot la base de `web-platform` que nomme I-37, et le module ne montre pas d'assertion de bout en bout de la politique servie : le seul test de ce fichier porte sur le décodage des formulaires et l'échappement du HTML, et le fichier de l'interface de terminal n'en porte aucun.

Prochaine preuve : le jalon d'ADR-0042 §3, dix missions consécutives conduites de bout en bout dans Work Supervision, sans fichier de passation hors de l'outil.
