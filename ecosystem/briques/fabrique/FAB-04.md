# FAB-04 — Mission Work Supervision

## Contexte

I-13 fait de la méthode le produit zéro, et ADR-0042 place la fabrique dans `ai-work-supervision` (D52). La version v0 est mono-utilisateur, par dérogation nommée à I-09 (D55). Son domaine porte une machine à états de mission, pure, dont les refus sont fermés. Aucun agent réel n'est lancé avant que la qualification de confinement C0 soit verte (D53) : le seul exécuteur admis est le faux agent.

## Ce que la brique ferme

- Le résultat accepté sans preuve : un résultat sans commit, sans preuve ou sans résumé est refusé (I-13).
- L'agent lancé hors confinement : tout profil autre que le faux agent est refusé tant que C0 n'est pas vert (ADR-0042 §3).
- L'état rapporté pris pour un fait : ce qu'une session déclare n'est jamais un résultat vérifié (I-18).
- La donnée d'instance dans le dépôt : la configuration vit hors du dépôt (I-21).

## Ce qu'elle ne fait pas

- Elle ne confine pas l'agent elle-même : elle exige la session confinée de HAR-02.
- Elle ne scelle pas son journal : elle y écrit, et PRV-01 en porte la vérification.
- Elle ne pousse rien vers la forge : la remise passe par FAB-09.

## Mesure

- Preuve citée : le modèle de mission du domaine de `ai-work-supervision`, épinglé au commit lu. Il montre les états, les commandes et les refus fermés d'une mission, garde C0 comprise. Il ne montre pas une mission conduite par un agent réel.
- Prochaine preuve : dix missions consécutives de bout en bout avec un agent réel, derrière la qualification C0, sans fichier de passation hors de l'outil (ADR-0042 §3, jalon B′).
