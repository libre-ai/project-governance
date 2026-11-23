# FAB-14 — Revue de code

## Contexte

La carte ne portait aucune brique de revue de code au 2026-11-23 (périmètre lu : les onze fichiers de couche et leurs fiches à la révision `365c766` de ce dépôt). La revue existe pourtant dans la méthode : le protocole `docs/reviews/AGENT-REVIEW-PROTOCOL.md` fixe les rôles et l'enveloppe de verdict, l'orchestrateur de revues en éventail d'`execution-continuity-evaluator` lance des passes par commit et par rôle, et le banc `verification/trust-bench/` a mesuré qu'exiger l'accord de deux modèles retire les fausses alertes que chacun lève seul sur les témoins sains. ADR-0068 fait d'une revue à rôle séparé, qui a relu le sha exact, une condition de toute fusion par un agent. Rien de tout cela ne prouve qu'un fichier modifié a bien été relu, ni qu'un constat publié pointe une ligne réelle.

Cette brique est ajoutée sur décision du propriétaire du 2026-11-23, à la suite d'une lecture de l'outil de revue Open Code Review et de trois sources sur la revue par agents. Sa thèse : le code garantit la couverture, l'ancrage et la publication ; le modèle ne fait que juger. La carte qu'elle complète applique ADR-0064, encore proposé.

## Ce que la brique ferme

- Le fichier modifié jamais relu : l'ensemble des fichiers à revoir est arrêté avant la revue et scellé avec la base, la tête, les règles et l'identité du relecteur ; chaque fichier finit relu, repris d'une revue antérieure de la même identité, ou en échec d'une classe nommée. Une revue dont un fichier reste en échec, ou dont le budget s'épuise, est partielle et jamais un succès.
- Le constat qui pointe une ligne inventée : le relecteur cite un extrait ; le code le retrouve dans le diff et en déduit le fichier, la ligne et le côté. Un constat non retrouvé, ambigu, ou sur un fichier hors de l'ensemble scellé n'est pas publié ; il reste tracé avec son motif.
- Le contenu revu qui pilote un outil : le diff est un contenu non fiable, et I-32 interdit qu'une chaîne dérivée d'un contenu non fiable entre dans le contexte d'un modèle qui détient un outil à effet (`write`, `execute` ou `network`). Le relecteur ne détient donc aucun outil à effet ; il rend une sortie structurée, et la publication est faite par du code depuis cette sortie.
- Les règles de revue choisies par l'auteur du changement : les règles par zone de chemin sont lues sur la base, jamais sur la tête relue.
- Le constat écarté en silence : un constat que le vote ne retient pas reste tracé avec les votes qu'il a reçus ; un votant en panne est un vote absent, jamais un accord.

## Ce qu'elle ne fait pas

- Elle ne remplace pas la revue du propriétaire. I-17 garde à touche humaine le registre, les ADR, les amendements de verrous, les mutations des garde-fous et les escalades : une revue d'agent n'y vaut jamais signature. Sans GOV-01, qui répartit les actes entre le propriétaire, les agents et les gates, elle ne saurait pas quels verdicts ne lui reviennent pas.
- Elle ne confine pas elle-même le relecteur. HAR-02 fait de chaque session d'agent un objet qui porte son identité, sa zone de confinement et son journal ; sans elle, rien ne vérifie que le relecteur ne détient aucun outil à effet.
- Elle ne fusionne pas. La fusion par un agent reste bornée par ADR-0068, qui exige une revue à rôle séparé du sha exact sans en faire une autorisation.
- Elle ne corrige pas le code relu. Une correction est un nouveau changement, écrit par une autre session et relu à son tour.
- Elle ne met pas en œuvre I-32 pour tout le harness, que décrit ADR-0045 : elle en applique la règle à la seule revue, l'orchestrateur en éventail restant sous supervision humaine jusqu'au 2026-12-31 comme I-32 le prévoit.

## Mesure

- Aucune preuve citée. L'orchestrateur en éventail existe, mais il ne scelle pas l'ensemble des fichiers, n'ancre aucun constat et ne trace pas les constats écartés : il ne réalise pas la promesse de cette brique.
- Prochaine preuve : le module qui scelle l'ensemble des fichiers relus et ancre chaque constat à une ligne du diff, avec ses tests, dans `execution-continuity-evaluator`.
- Preuve suivante : le banc de confiance rejoué sur un corpus de changements réels de la flotte qui ont été annulés ou corrigés, avec ses témoins sains, imprimant pour chaque corpus les défauts attrapés et les fausses alertes avec leurs dénominateurs.
