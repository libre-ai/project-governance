# PRV-04 — Gestion des clés

## Contexte

Ce dépôt porte le mode opératoire d'une cérémonie de clés (`docs/security/KEY-CEREMONY-RUNBOOK.md`) et son outil. L'outil génère une paire Ed25519 et scelle la clé privée ; cette clé signera les enregistrements de lignage d'agents. ADR-0028 §2.7 nomme le déclencheur de la cérémonie : le prononcé du verrou de l'orchestrateur (D35). Le mode opératoire prévoit un manifeste de clés publiques `config/signing-keys.v1.json` ; aucun fichier suivi de ce dépôt ne porte ce nom (`git ls-files | grep -c signing-keys` : 0, au 2026-11-11). Pour les clés des jetons, la spécification d'identité de ce dépôt (`docs/specifications/IDENTITY-AUTHORIZATION.md`) écrit une rotation à deux clés. Aucun invariant du registre ne lie la brique.

## Ce que la brique ferme

- La clé privée qui traverse un réseau ou entre dans un dépôt : le mode opératoire la fait générer hors ligne, et l'outil ne l'écrit sur disque que scellée.
- La cérémonie lancée par une automatisation : l'outil refuse de tourner en CI.
- La clé sans fin de vie : le mode opératoire et la spécification d'identité écrivent chacun un protocole de rotation.

## Ce qu'elle ne fait pas

- Elle ne signe rien elle-même : PRV-03 signe avec les clés qu'elle fournit.
- Elle ne gère pas la clé d'empreinte d'un run : ADR-0046 la veut propre au run, jamais transmise et détruite à sa fin.
- Elle ne remet aucun secret à un agent (PRV-11) et n'émet aucun jeton (IDN-02).
- Un agent n'y écrit pas seul : le mode opératoire est adressé au propriétaire.

## Mesure

- Preuve citée : l'outil de génération de la cérémonie, dans ce dépôt. Il montre une génération et un scellement écrits et testés. Il ne montre ni cérémonie tenue, ni clé publique enregistrée, ni rotation.
- Prochain fait observable : une clé publique de production enregistrée dans ce dépôt par une pull request du propriétaire.
