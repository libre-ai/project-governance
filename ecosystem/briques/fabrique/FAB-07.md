# FAB-07 — Livraison par anneaux

## Contexte

ADR-0035 rend la release autorisable dépôt par dépôt (D41). I-07 la borne : un candidat immuable, un environnement que le propriétaire sélectionne explicitement, un smoke test après déploiement et un retour arrière démontré. Une première release est fumée sur l'URL technique avant toute bascule du domaine canonique (ADR-0035 D4). Au 2026-11-11, les ADR, le registre, les méthodes et les spécifications de ce dépôt ne nomment pas d'anneaux de destinataires : le mot est celui de cette brique, et le passage par cercles est une proposition de l'agent, non arbitrée. Aucun dépôt porteur n'est déclaré. I-20, qui veut des releases liées à leur évidence, est voisin : ce lien est l'objet de PRV-02, et il n'est pas cité.

## Ce que la brique ferme

Aucune preuve n'est citée ici : les fermetures ci-dessous sont des règles de la doctrine ou l'objet de la brique, pas un fait montré.

- La release exposée à tous d'un seul coup : c'est l'objet de la brique, que cette fiche ne cite réalisé nulle part.
- La release sans retour arrière : après la première, chaque release garde la révision immuable précédente comme cible (ADR-0035 D4).
- L'environnement choisi par défaut : le propriétaire le sélectionne explicitement pour chaque release (I-07).

## Ce qu'elle ne fait pas

- Elle ne signe pas l'artefact et n'écrit pas son manifeste : ce sont les objets de PRV-03 et de PRV-02. Le rôle écrit ne demande ni l'un ni l'autre pour passer un cercle : ce ne sont pas des dépendances.
- Elle n'autorise aucun déploiement à un agent. Chaque release garde son point de contrôle explicite (ADR-0035 D4). Sans GOV-01, qui répartit les actes entre le propriétaire et les agents, aucun passage n'a d'autorisation à attendre.
- Elle ne publie pas un dépôt pour la première fois : c'est une autre frontière, que cette brique ne porte pas.

## Mesure

- Preuve citée : aucune. La skill `deploy-clever` de ce dépôt décrit les conditions d'ADR-0035 et déclare qu'elle n'applique rien par elle-même.
- Prochaine preuve : une release d'un dépôt de la flotte dont la trace montre le passage par chaque cercle, avec le smoke test et la révision de retour de chaque passage.
