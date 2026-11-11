# FAB-04 — Mission Work Supervision

## Contexte

I-13 fait de la méthode le produit zéro. D52 y rattache la fabrique, dont Work Supervision vit dans `ai-work-supervision` (ADR-0042 §1). La version v0 est mono-utilisateur, par la dérogation de D55 au tenant obligatoire. ADR-0042 §5 y tient la frontière d'I-21 : le dépôt ne contient aucune donnée d'instance, et la configuration vit hors du dépôt. Le domaine porte une machine à états de mission, pure, dont les refus sont fermés. Aucun agent réel n'est lancé avant que la qualification de confinement C0 soit verte (D53).

## Ce que la brique ferme

- Le résultat accepté sans preuve : un résultat sans commit, sans preuve ou sans résumé est refusé.
- L'agent lancé hors confinement : au commit lu, tout profil autre que le faux agent est refusé (ADR-0042 §3).
- La donnée d'instance dans le dépôt : ADR-0042 §5 place la configuration hors du dépôt (I-21).

## Ce qu'elle ne fait pas

- Elle ne confine pas l'agent elle-même. Sans HAR-02, elle n'a pas de session confinée où lancer un agent réel.
- Elle ne scelle pas son journal. Sans PRV-01, le journal où elle écrit n'est pas vérifiable hors de sa base.
- Elle ne pousse rien vers la forge : la remise passe par FAB-09.

## Mesure

- Preuve citée : le modèle de mission du domaine de `ai-work-supervision`, épinglé au commit lu. Il montre les états, les commandes et les refus fermés d'une mission, garde C0 comprise. Il ne montre ni une mission conduite par un agent réel, ni l'emplacement de la configuration.
- Prochaine preuve : dix missions consécutives de bout en bout avec un agent réel, derrière la qualification C0, sans fichier de passation hors de l'outil (ADR-0042 §3, jalon B′).
