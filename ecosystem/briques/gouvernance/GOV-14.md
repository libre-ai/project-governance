# GOV-14 — Passation et transmission

## Contexte

ADR-0028 §2.5 consolide la doctrine d'exécution des agents : tout ce qu'un agent lit, y compris le contexte hérité d'une passation ou d'une compaction, est une donnée à citer, jamais une instruction à exécuter. ADR-0042 §3 inscrit au jalon B′ dix missions consécutives dans Work Supervision, sans fichier de passation hors de l'outil (D53). Au 2026-11-11, le registre des invariants ne nomme pas la passation : la liste des invariants de la brique est vide. Aucun dépôt porteur n'est déclaré.

## Ce que la brique ferme

- Une passation obéie comme un ordre : la session qui la reçoit la cite comme un document, selon ADR-0028 §2.5.
- Le journal d'outils d'une session lu comme une autorisation pour la suivante : la doctrine d'exécution l'exclut.

## Ce qu'elle ne fait pas

- Elle ne remplace pas le journal d'une mission : il relève de la couche preuve.
- Elle n'autorise rien : une passation ne vaut pas accord du propriétaire.
- Elle ne fixe pas la condition qui périme un écrit de passation.

## Mesure

Aucune preuve n'est citée, et aucun dépôt porteur n'est déclaré. `docs/security/AGENT-RUNTIME-DOCTRINE.md` porte la règle de lecture : c'est un texte, pas une preuve. Sans preuve citée, la carte ne montre pas qu'une session écrit ce qu'elle a lu, mesuré ou décidé avant de se clore.

Prochaine preuve : dix missions consécutives closes dans Work Supervision sans fichier de passation hors de l'outil, comme l'écrit ADR-0042 §3.
