# EXE-03 — Serveur de modèles local

## Contexte

Aucun invariant ne nomme un serveur de modèles. I-10 demande le local-first là où la spécification l'exige. I-21 garde sur l'appareil de leur détenteur les données qui concernent une personne physique. ADR-0065 admet sous conditions des briques de base pour le routeur de modèles et l'assistant du catalogue, et relève qu'elles n'ont aucune notion de résidence des données. ADR-0063, proposé, renvoie le choix d'un serveur local aux fiches de la carte.

## Ce que la brique ferme

- L'inférence qui envoie par défaut un contenu personnel à un tiers, alors qu'I-21 le garde sur l'appareil.
- Le produit qui cesse de répondre hors ligne là où sa spécification exige le local-first (I-10).
- Le serveur posé sur un hôte hors de la cible d'I-07, quand le poste ne suffit pas.

## Ce qu'elle ne fait pas

- Elle ne choisit pas le modèle : le routage vers un modèle admis est PAS-04.
- Elle ne reçoit aucun appel direct : tout appel de modèle franchit PAS-01.
- Elle ne décide pas de l'admission d'un modèle : c'est GOV-04.

## Mesure

- Preuve citée : aucune. Une recherche de code du 2026-11-11 n'a trouvé aucun serveur de modèles dans les dépôts de l'inventaire, et le choix du serveur n'est pas décidé.
- Prochaine preuve : un produit de la flotte qui obtient une réponse d'un modèle servi sur le poste, réseau coupé, avec un test qui échoue si l'appel sort de la machine.
