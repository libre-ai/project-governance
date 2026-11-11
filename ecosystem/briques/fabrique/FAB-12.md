# FAB-12 — Décisions en données

## Contexte

I-24, posé par ADR-0022 (D31) et amendé par D74, fait présenter toute décision réelle en deux à quatre options avec leurs conséquences. I-17 range le registre, les ADR et les escalades dans la surface à touche humaine. Un gate de ce dépôt exige, pour toute mutation de cette surface, une référence de revue ou une ligne d'arbitrage datée. `ai-work-supervision` tient les demandes de décision dans une table, avec leur état. ADR-0060, rédigé le 2026-10-24, renvoyait son choix à un ADR ultérieur. ADR-0062 l'a porté le 2026-11-09 et note qu'aucune décision du registre ne citait ce renvoi : c'est le cas observé d'une question ouverte que rien ne comptait.

## Ce que la brique ferme

- La demande sans état ni date : dans la table citée, une demande porte sa question, son état, qui l'a ouverte, qui l'a close, le choix retenu et ses instants de création et de mise à jour.
- La décision présentée en paragraphe : chaque option porte les mêmes champs obligatoires, libellé, conséquence et réversibilité (I-24).
- L'arbitrage affirmé par une phrase libre : sur la surface gardée, le gate ne reconnaît que le mot `Owner-arbitration:` suivi d'une date, ou la référence d'un dossier de revue qui existe (I-17).

## Ce qu'elle ne fait pas

- Elle ne répond pas. Sans GOV-01, qui dit quels actes reviennent au propriétaire, elle n'a pas de décision réservée à tenir.
- Elle ne remplace ni le registre des décisions ni les ADR, qui restent la surface signée (I-17).
- Elle ne compte ni ne rappelle les demandes ouvertes : aucune preuve citée ici ne les liste.
- Elle ne prouve pas qu'un arbitrage a eu lieu : l'en-tête du gate dit que sa marque est une convention de texte.

## Mesure

- Preuve locale : `tools/quality/check-review-evidence.ts`. Pour cette brique, elle montre une seule chose : la trace d'une réponse du propriétaire a une forme qu'un gate lit, un mot fixe suivi d'une date. Elle ne tient ni la question, ni les options, ni l'auteur de la demande.
- Preuve épinglée : la migration de coordination du magasin de `ai-work-supervision`. Elle montre la table des demandes et celle de leurs options. C'est un schéma : elle ne montre ni une demande enregistrée, ni une liste des demandes ouvertes.
- Prochaine preuve : la liste des demandes ouvertes, chacune avec son instant d'ouverture, imprimée dans un rapport de jalon.
