# EXE-02 — Hôtes maîtrisés

## Contexte

I-07 fixe la cible d'exécution : « Clever Cloud Paris/UE ». ADR-0035 (D41) rend le déploiement autorisable dépôt par dépôt, sur un candidat immuable, dans un environnement choisi par le propriétaire. Le cas cité est `project-website`, que l'inventaire de la flotte décrit comme une projection publique. Son outillage vérifie l'application distante de staging avant de s'en servir : titulaire, type `static`, zone. Il ne couvre aucun produit avec état.

## Ce que la brique ferme

- Le service déployé hors de la cible : l'outillage refuse une application dont la zone n'est pas Paris (I-07).
- Le déploiement sur l'application d'un autre titulaire, ou d'un autre type que celui attendu.
- L'autorisation qui déborde : I-07 la borne « au périmètre prouvé » et n'ouvre « aucun service ou add-on adjacent ».

## Ce qu'elle ne fait pas

- Elle ne choisit pas l'environnement : I-07 le fait sélectionner par le propriétaire.
- Elle ne définit pas les zones admises par classe de données : c'est PAS-02.
- Elle ne décrit pas l'hôte en fichiers versionnés : c'est EXE-05.
- Elle ne confine pas les tâches qui tournent sur l'hôte : c'est EXE-01.

## Mesure

- Preuves citées : le module de contexte d'hébergement de `project-website` et son test. Ils montrent qu'une application de staging est refusée quand son titulaire, son type ou sa zone diffèrent de l'attendu. Ils ne montrent aucun déploiement.
- Prochaine preuve : un produit avec état déployé sur un hôte de l'Union depuis sa seule déclaration versionnée, avec test de fumée et retour arrière démontré.
