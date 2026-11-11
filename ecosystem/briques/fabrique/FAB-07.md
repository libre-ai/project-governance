# FAB-07 — Livraison par anneaux

## Contexte

ADR-0035 rend la release autorisable dépôt par dépôt (D41). I-07 la borne : un candidat immuable, un environnement que le propriétaire sélectionne explicitement, un smoke test après déploiement et un retour arrière démontré. I-20 demande des releases liées à leur évidence. Une première release est fumée sur l'URL technique avant toute bascule du domaine canonique (ADR-0035 D4). Au 2026-11-11, les ADR, le registre, les méthodes et les spécifications de ce dépôt ne nomment pas d'anneaux de destinataires : le mot est celui de cette brique. Aucun dépôt porteur n'est déclaré.

## Ce que la brique ferme

- La release exposée à tous d'un seul coup : c'est l'objet de la brique, que rien ne réalise encore.
- La release sans retour arrière : après la première, chaque release garde la révision immuable précédente comme cible (ADR-0035 D4).
- L'environnement choisi par défaut : le propriétaire le sélectionne explicitement pour chaque release (I-07).
- La release détachée de son évidence : I-20 les veut liées.

## Ce qu'elle ne fait pas

- Elle ne signe pas l'artefact et n'écrit pas son manifeste. Sans PRV-02, un passage ne peut pas lier la release à son évidence. Sans PRV-03, il ne peut pas faire vérifier ce qu'il remet.
- Elle n'autorise aucun déploiement à un agent. Chaque release garde son point de contrôle explicite (ADR-0035 D4). Sans GOV-01, rien ne dit qu'il revient au propriétaire.
- Elle ne publie pas un dépôt pour la première fois : c'est une autre frontière, que cette brique ne porte pas.

## Mesure

- Preuve citée : aucune. La skill `deploy-clever` de ce dépôt décrit les conditions d'ADR-0035 et déclare qu'elle n'applique rien par elle-même.
- Prochaine preuve : une release d'un dépôt de la flotte dont la trace montre le passage par chaque cercle, avec le smoke test et la révision de retour de chaque passage.
