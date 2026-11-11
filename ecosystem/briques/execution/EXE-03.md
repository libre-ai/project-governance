# EXE-03 — Serveur de modèles local

## Contexte

Le registre des invariants ne nomme ni serveur de modèles ni inférence (`grep -ciE 'serveur de mod|model server|inf[ée]rence' docs/decisions/INVARIANTS.md` : 0, au 2026-11-11) ; deux invariants contraignent la brique. I-21 veut que « les données concernant une personne physique restent sur le device de leur détenteur ». I-07 fixe la cible d'un service hébergé : « Clever Cloud Paris/UE ». I-10 demande le « local-first où la spec l'exige » ; son sujet est le cycle de vie des données, il est voisin et n'est pas cité. Le catalogue d'ADR-0042 §1 porte un routeur de modèles et un assistant. ADR-0065 (fusionné, statut non clos dans son fichier) admet pour eux des briques de base sous conditions et relève qu'elles n'ont « aucune notion de résidence des données ». ADR-0063, encore proposé, range le choix d'un serveur de modèles local parmi ce qu'il ne décide pas et le renvoie à la couche `passerelle`. La carte le range en `execution` par la règle d'ADR-0064 D1, encore proposé : « tout ce qui traite du contenu est ici, et seulement ici ». La brique ne déclare aucune dépendance. Un serveur sert sans routeur, et PAS-04 n'en est pas une. Le mot « admis » de son rôle renvoie au registre d'admission de GOV-04, que la table du même D1 ne permet pas à cette couche de citer.

## Ce que la brique ferme

Cette fiche ne cite aucune preuve et la carte ne donne à la brique aucun dépôt porteur : aucune des fermetures ci-dessous n'est montrée réalisée.

- L'inférence qui envoie par défaut un contenu personnel à un tiers, alors qu'I-21 le garde sur l'appareil.
- Le serveur posé sur un hôte hors de la cible d'I-07, quand l'appareil ne suffit pas.

## Ce qu'elle ne fait pas

- Elle ne choisit pas le modèle : c'est PAS-04.
- Elle ne décide pas de l'admission d'un modèle : c'est GOV-04.
- Elle ne contrôle pas l'appel qui lui parvient : c'est PAS-01.
- Elle ne garantit pas qu'un produit réponde hors ligne : I-10, voisin, laisse cette exigence à la spécification de chaque produit.

## Mesure

- Preuve citée : aucune. Le choix du serveur n'est pas décidé. Dans les noms de fichiers des dépôts publics de l'inventaire, lus par l'API de la forge le 2026-11-11, aucun ne contient `llama`, `ollama`, `vllm`, `inference`, `gguf` ni `mlx`.
- Prochaine preuve : un produit de la flotte qui obtient une réponse d'un modèle servi sur l'appareil, réseau coupé, avec un test qui échoue si l'appel sort de la machine.
