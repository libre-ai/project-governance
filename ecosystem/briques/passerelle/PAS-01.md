# PAS-01 — Passerelle unique de contenu

## Contexte

Aucun composant de la flotte ne joue ce rôle aujourd'hui. La doctrine en fixe pourtant les bornes. I-32 fait circuler tout contenu non fiable comme référence opaque, et désigne le harness comme autorité unique de la politique d'argument. I-33 interdit qu'un argument, un résultat ou un identifiant métier quitte le harness. ADR-0063 renvoie la forme de la passerelle à cette fiche. Le plan d'exécution autorisé déclare déjà une sortie vers un modèle et un mode réseau, mais rien ne les applique en un point unique.

## Ce que la brique ferme

- L'appel de modèle ou d'outil qui part sans contrôle de classe, de zone et de budget.
- L'adaptateur de fournisseur qui reçoit l'état complet d'une mission, menace inscrite au modèle de menace.
- Le point de contrôle qui lit le contenu qu'il régule : la passerelle ne reçoit que des métadonnées typées (I-33).

## Ce qu'elle ne fait pas

- Elle ne juge pas les arguments d'un appel d'outil : I-32 réserve cette politique au harness.
- Elle ne traite ni ne stocke aucun contenu : cela revient au plan de données confiné, sous EXE-01.
- Elle ne choisit pas le modèle, ce que fait PAS-04, et ne définit pas les classes, ce que fait PAS-02.

## Mesure

- Preuve citée : aucune. Aucun dépôt de la flotte ne porte de passerelle, et sa forme n'est pas décidée.
- Prochaine preuve : un test publié où un appel de modèle émis hors de la passerelle échoue, et où l'appel admis ne lui transmet aucun octet de contenu.
