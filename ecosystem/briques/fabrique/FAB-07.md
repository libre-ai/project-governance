# FAB-07 — Livraison par anneaux

## Contexte

ADR-0035 rend la release autorisable dépôt par dépôt, sur un candidat immuable, avec un smoke test après déploiement et un retour arrière démontré (I-07). Il pose un premier palier : une première release est fumée sur l'URL technique avant toute bascule du domaine canonique. I-20 demande des releases liées à leur évidence. La doctrine ne nomme pas d'anneaux de destinataires. Aucun dépôt de la flotte ne porte de mécanisme qui fasse avancer une release d'un cercle au suivant.

## Ce que la brique ferme

- La release exposée à tous d'un seul coup : elle atteint un cercle, y est observée, puis passe au suivant.
- La release sans retour arrière : chaque passage garde la révision immuable précédente comme cible (ADR-0035 D4).
- L'exposition publique sans rien de vérifiable : I-15 n'ouvre la vitrine qu'à partir d'un fait vérifiable.
- L'environnement choisi par défaut : le propriétaire le sélectionne explicitement pour chaque release (I-07).

## Ce qu'elle ne fait pas

- Elle ne signe pas l'artefact et n'écrit pas son manifeste : ce sont PRV-03 et PRV-02.
- Elle n'autorise aucun déploiement à un agent : chaque release garde le point de contrôle du propriétaire, selon GOV-01 (ADR-0035 D4).
- Elle ne publie pas un dépôt pour la première fois : cette frontière relève d'I-30.

## Mesure

- Preuve citée : aucune. La skill `deploy-clever` de ce dépôt décrit les conditions d'ADR-0035 et déclare elle-même qu'elle n'applique rien par du code.
- Prochaine preuve : une release d'un dépôt de la flotte dont la trace montre le passage par chaque cercle, avec le smoke test et la révision de retour de chaque passage.
