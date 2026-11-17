# PRV-04 — Gestion des clés

## Contexte

Ce dépôt porte le mode opératoire d'une cérémonie de clés (`docs/security/KEY-CEREMONY-RUNBOOK.md`) et son outil. L'outil génère une paire Ed25519 et scelle la clé privée sous une phrase de passe ; cette clé signera les enregistrements de lignage d'agents. ADR-0028 §2.7 nomme le déclencheur de la cérémonie : le prononcé du verrou de l'orchestrateur (D35). Le mode opératoire prévoit un registre de clés publiques `config/signing-keys.v1.json`, au format du contrat `signing-keys.v1` du dépôt des contrats (identifiant `ed25519-` suivi du SHA-256 des 32 octets bruts de la clé, témoin désigné par un rôle) ; aucun fichier de ce nom n'est suivi (`git ls-files config/signing-keys.v1.json` : vide, au 2026-11-17). Pour les clés des jetons, la spécification d'identité de ce dépôt (`docs/specifications/IDENTITY-AUTHORIZATION.md`) écrit une rotation à deux clés. Aucun invariant du registre ne lie la brique.

## Ce que la brique ferme

- La cérémonie lancée par une automatisation : l'outil refuse (code 4) quand une variable d'environnement de CI est posée. Le mode `--dev-key` passe ce refus ; il n'écrit aucune clé privée.
- Le PEM de la clé privée posé tel quel sur disque : l'outil n'écrit qu'une enveloppe scellée (scrypt, puis AES-256-GCM, octet de version 0x01) sous une phrase de passe saisie au terminal sans écho ou lue sur un descripteur hérité, jamais en argument ni dans l'environnement. L'enveloppe est relue et descellée en mémoire, et sa clé comparée à la clé publique, avant de recevoir son nom ; la clé publique n'est écrite qu'après.
- Une sortie posée dans un dépôt git : l'outil refuse un répertoire `--out` dont lui-même ou un parent porte une entrée `.git`.
- Une entrée de registre hors contrat : l'entrée que l'outil imprime suit `signing-keys.v1`, et son test la valide contre une copie octet pour octet du schéma du contrat.

## Ce qu'elle ne fait pas

- Elle ne vérifie pas que la génération se fait hors ligne : le mode opératoire le prescrit, l'outil l'affiche en avertissement.
- Elle ne fait tourner ni ne révoque aucune clé : le mode opératoire écrit les deux protocoles selon le contrat (la rotation retire l'entrée après re-signature, la révocation est réservée à la compromission), et la preuve citée ici n'en exerce aucun.
- Aucun contrôle de ce dépôt ne valide un registre `config/signing-keys.v1.json` : il n'en existe pas encore.
- Elle ne signe rien elle-même : PRV-03 signe avec les clés qu'elle fournit.
- Elle ne gère pas la clé d'empreinte d'un run : ADR-0046 la veut propre au run, jamais transmise et détruite à sa fin.
- Elle ne remet aucun secret à un agent (PRV-11) et n'émet aucun jeton (IDN-02).
- Un agent n'y écrit pas seul : le mode opératoire est adressé au propriétaire.

## Mesure

- Preuve citée : l'outil de génération de la cérémonie, dans ce dépôt, et son fichier de test, qui importe l'outil. Il montre la saisie de la phrase de passe hors argument et hors environnement, le scellement relu avant d'être nommé, les refus (CI, sortie sous git, cible existante, phrase de passe refusée) et l'entrée de registre validée contre le contrat. La saisie sur un vrai terminal n'est pas exercée par le test. La preuve ne montre ni cérémonie tenue, ni clé publique enregistrée, ni rotation, ni révocation.
- Prochain fait observable : la saisie au terminal constatée par le propriétaire sur la machine hors ligne, puis une clé publique de production enregistrée dans ce dépôt par une pull request du propriétaire.
