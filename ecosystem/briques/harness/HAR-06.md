# HAR-06 — Dialogue entre agents

## Contexte

I-32, posé par ADR-0045 (D66), traite le rapport d'un autre agent comme un contenu non fiable : il n'entre pas dans le contexte d'un modèle qui détient un outil à effet. I-18 ajoute qu'une donnée opérationnelle n'est jamais une autorité. `ai-work-supervision` porte une forme voisine d'un canal entre agents : une session déclare son état au démon sous un vocabulaire fermé. Au commit lu, le module de coordination du même dépôt déclare l'acteur sans l'authentifier.

## Ce que la brique ferme

- Un agent qui en instruit un autre par un texte libre, canal d'injection qu'I-32 ferme.
- Un message d'agent pris pour une autorisation, alors qu'il n'est qu'une donnée opérationnelle (I-18).
- Un émetteur non identifié : tant que l'acteur est déclaré sans être authentifié, un processus peut se dire propriétaire.

## Ce qu'elle ne fait pas

- Elle ne transporte pas de contenu, qui passe par référence opaque (I-32).
- Elle n'ouvre pas de session. Sans HAR-02, un message n'a pas de session déclarée à laquelle se rattacher.
- Elle n'authentifie pas l'émetteur. Sans IDN-04, elle n'a pas d'identité d'agent à vérifier.
- Elle ne route rien par un plan de contrôle : ce rôle revient à PAS-01.

## Mesure

Preuve citée : le module de pont de `ai-work-supervision`. Il montre qu'un événement de harnais devient un état fermé et une note courte, jamais le message de l'agent. Il ne montre aucun message d'un agent à un autre.

Prochaine preuve : un contrat de message typé entre agents, avec un vecteur rouge qui refuse un champ de texte libre.
