# EXE-03 — Serveur de modèles local

## Contexte

Aucun invariant ne nomme un serveur de modèles ; trois le contraignent. I-21 veut que « les données concernant une personne physique restent sur le device de leur détenteur ». I-10 demande le « local-first où la spec l'exige ». I-07 fixe la cible d'un service hébergé : « Clever Cloud Paris/UE ». Le catalogue d'ADR-0042 §1 porte un routeur de modèles et un assistant. ADR-0065 (fusionné, statut non clos dans son fichier) admet pour eux des briques de base sous conditions et relève qu'elles n'ont « aucune notion de résidence des données ». ADR-0063, encore proposé, range le choix d'un serveur de modèles local parmi ce qu'il ne décide pas. La brique dépend de PAS-04 : sans routeur, elle ne sait pas quel modèle admis servir.

## Ce que la brique ferme

Aucune de ces fermetures n'est réalisée : la brique n'a ni dépôt porteur ni preuve.

- L'inférence qui envoie par défaut un contenu personnel à un tiers, alors qu'I-21 le garde sur l'appareil.
- Le produit qui cesse de répondre hors ligne là où sa spécification exige le local-first (I-10).
- Le serveur posé sur un hôte hors de la cible d'I-07, quand le poste ne suffit pas.

## Ce qu'elle ne fait pas

- Elle ne choisit pas le modèle : c'est PAS-04.
- Elle ne décide pas de l'admission d'un modèle : c'est GOV-04.
- Elle ne contrôle pas l'appel qui lui parvient : c'est PAS-01.

## Mesure

- Preuve citée : aucune. Le choix du serveur n'est pas décidé. Dans les noms de fichiers des dépôts publics de l'inventaire, lus par l'API de la forge le 2026-11-11, aucun ne contient `llama`, `ollama`, `vllm`, `inference`, `gguf` ni `mlx`.
- Prochaine preuve : un produit de la flotte qui obtient une réponse d'un modèle servi sur le poste, réseau coupé, avec un test qui échoue si l'appel sort de la machine.
