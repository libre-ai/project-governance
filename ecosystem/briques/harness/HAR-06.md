# HAR-06 — Dialogue entre agents

## Contexte

I-32, posé par ADR-0045 (D66), traite une chaîne « rapportée par un autre agent » comme un contenu non fiable : elle n'entre pas dans le contexte d'un modèle qui détient un outil à effet, et y circule comme référence opaque. I-18 ajoute l'identité des agents et le fait qu'une donnée opérationnelle n'est jamais une autorité. `ai-work-supervision` porte une forme voisine d'un canal entre agents : une session déclare son état au démon sous un vocabulaire fermé. Ce canal va d'une session au démon, pas d'un agent à un autre.

## Ce que la brique ferme

Aucune preuve n'est citée ici : les fermetures ci-dessous sont l'objet de la brique, pas un fait montré.

- Un agent qui en instruit un autre par un texte libre, canal d'injection qu'I-32 ferme.
- Un message d'agent pris pour une autorisation, alors qu'il n'est qu'une donnée opérationnelle (I-18).
- Un émetteur non identifié, qu'I-18 exclut en donnant une identité à chaque agent.

## Ce qu'elle ne fait pas

- Elle ne transporte pas de contenu, qui passe par référence opaque (I-32).
- Elle n'ouvre pas de session. Sans HAR-02, un message n'a pas de session déclarée à laquelle se rattacher.
- Elle n'authentifie pas l'émetteur. Sans IDN-04, un message n'a ni émetteur ni destinataire identifiés.
- Elle ne route rien par un plan de contrôle : ce rôle revient à PAS-01.

## Mesure

Preuve citée : aucune. Le module de pont de `ai-work-supervision` traduit un événement de harnais en un état fermé et une note courte, jamais le message de l'agent. Il ne montre aucun message d'un agent à un autre : il n'est pas cité en preuve.

Prochaine preuve : un contrat de message typé entre agents, avec un vecteur rouge qui refuse un champ de texte libre.
