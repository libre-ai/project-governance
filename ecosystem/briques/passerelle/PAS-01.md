# PAS-01 — Passerelle unique de contenu

## Contexte

La règle de la couche vient d'ADR-0064 D1, encore proposé : la passerelle « ne voit que des métadonnées typées ». ADR-0063, encore proposé, range la forme de la passerelle parmi ce qu'il ne décide pas et la renvoie aux fiches de cette couche. Le schéma du corps de plan d'exécution (v2, cité en preuve par PAS-02) connaît un mode réseau `private-gateway-only`, une liste d'origines de passerelle et une sortie vers un modèle. Aucun invariant du registre ne lie la brique : I-32 et I-33 bornent le harness, pas une passerelle, et ne sont pas cités. La brique dépend de PAS-02 : sans classes de données, elle n'a pas de métadonnée de classe sur laquelle décider. Elle dépend d'IDN-02 : sans jeton atténué, elle ne peut pas borner ce qu'un appelant est autorisé à transmettre.

## Ce que la brique ferme

Cette fiche ne cite aucune preuve et la carte ne donne à la brique aucun dépôt porteur : aucune des fermetures ci-dessous n'est montrée réalisée.

- L'appel de modèle ou d'outil qui part sans contrôle de classe, de zone et de budget.
- L'adaptateur de fournisseur qui reçoit l'état complet d'une mission : le modèle de menace de ce dépôt inscrit cette menace et lui oppose un Biscuit atténué.
- Le point de contrôle qui lit le contenu qu'il régule.

## Ce qu'elle ne fait pas

- Elle ne juge pas les arguments d'un appel d'outil : ADR-0045 (D66) fait du harness l'autorité unique de cette politique.
- Elle ne traite ni ne stocke aucun contenu : cela revient à la couche d'exécution, sous EXE-01.
- Elle ne choisit pas le modèle : c'est PAS-04.

## Mesure

- Preuve citée : aucune. La forme de la passerelle n'est pas décidée.
- Prochaine preuve : un test publié où un appel de modèle émis hors de la passerelle échoue, et où l'appel admis ne lui transmet aucun octet de contenu.
