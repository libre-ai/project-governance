# EXE-02 — Hôtes maîtrisés

## Contexte

I-07 fixe la cible d'exécution : Clever Cloud, Paris, Union européenne. ADR-0035 (D41) rend le déploiement autorisable dépôt par dépôt, sur un candidat immuable, dans un environnement choisi par le propriétaire. Le premier cas est `project-website`, une projection statique sans compte ni donnée personnelle. Son outillage vérifie l'application distante avant de s'en servir. Cet outillage ne couvre aucun produit avec état.

## Ce que la brique ferme

- Le service déployé hors de la cible : l'outillage refuse une application dont la zone n'est pas Paris (I-07).
- Le déploiement sur l'application d'un autre titulaire, ou d'un autre type que celui attendu.
- L'autorisation qui déborde : I-07 la borne au périmètre prouvé.
- La donnée d'organisation hors d'une instance privée sous tenant opaque (I-21).

## Ce qu'elle ne fait pas

- Elle ne choisit pas l'environnement : c'est un acte du propriétaire à chaque release.
- Elle ne définit pas les zones admises par classe de données : c'est PAS-02.
- Elle ne décrit pas l'hôte en fichiers versionnés : c'est EXE-05.
- Elle ne confine pas les tâches qui tournent sur l'hôte : c'est EXE-01.

## Mesure

- Preuves citées : le module de contexte d'hébergement de `project-website` et son test. Ils montrent qu'une application de staging est refusée quand son titulaire, son type ou sa zone diffèrent de l'attendu.
- Prochaine preuve : un produit avec état déployé sur un hôte de l'Union depuis sa seule déclaration versionnée, avec test de fumée et retour arrière démontré.
