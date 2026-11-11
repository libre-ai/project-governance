# HAR-05 — Surfaces de pilotage

## Contexte

ADR-0042 §3 décrit la fabrique : un cœur Rust, une interface en ligne de commande et en terminal, et un cockpit web en lecture et décision seulement. `ai-work-supervision` porte ces surfaces. Le cockpit écoute sur l'adresse locale, lit la projection et n'écrit que par le démon. L'interface de terminal liste les missions et porte une barre de décision.

## Ce que la brique ferme

- Un propriétaire qui reconstruit à la main l'état de plusieurs missions et sessions d'agents.
- Une décision prise sur un paragraphe : les options d'une demande sont montrées côte à côte, avec conséquence et réversibilité, comme le veut I-24.
- Un navigateur capable d'envoyer une entrée à un terminal d'agent, ce qu'ADR-0042 §3 exclut.
- Une page servie sans en-têtes de sécurité, qu'I-37 exige de toute application qui sert du HTML.

## Ce qu'elle ne fait pas

- Elle ne tient pas la file des demandes : elle affiche celle de HAR-07.
- Elle ne lance ni ne confine une session, ce qui relève de HAR-02.
- Elle n'agence pas les fenêtres du poste : c'est l'objet d'un produit du catalogue, hors de cette couche.

## Mesure

Preuves citées : le module du cockpit et celui de l'interface de terminal, dans `ai-work-supervision`. Ils montrent une surface qui lit et décide, pas son usage sur des missions réelles.

Prochaine preuve : le jalon d'ADR-0042 §3, dix missions consécutives conduites de bout en bout dans Work Supervision, sans fichier de passation hors de l'outil.
