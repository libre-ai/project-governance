# PRV-04 — Gestion des clés

## Contexte

Ce dépôt porte le mode opératoire d'une cérémonie de clés (`docs/security/KEY-CEREMONY-RUNBOOK.md`) et son outil. L'outil génère une paire Ed25519 et chiffre la clé privée sous une phrase de passe ; cette clé signera les enregistrements de lignage d'agents. ADR-0028 §2.7 nomme le déclencheur de la cérémonie : le prononcé du verrou de l'orchestrateur (D35). Le mode opératoire prévoit un manifeste de clés publiques `config/signing-keys.v1.json` ; aucun fichier suivi de ce dépôt ne porte ce nom (`git ls-files | grep -c signing-keys` : 0, au 2026-11-11). Pour les clés des jetons, la spécification d'identité de ce dépôt (`docs/specifications/IDENTITY-AUTHORIZATION.md`) écrit une rotation à deux clés. Aucun invariant du registre ne lie la brique.

## Ce que la brique ferme

- La cérémonie lancée par une automatisation : l'outil sort en erreur quand une variable d'environnement de CI est posée. Le mode `--dev-key` passe ce refus ; il n'écrit aucune clé privée.
- Le PEM de la clé privée posé tel quel sur disque : l'outil n'écrit qu'une enveloppe chiffrée (scrypt, puis ChaCha20-Poly1305). Ce chiffrement ne vaut pas scellement au commit lu : voir la section suivante.

## Ce qu'elle ne fait pas

- Elle ne scelle pas la clé privée sous un secret de son détenteur. Au commit lu, l'outil ne saisit aucune phrase de passe : il chiffre sous la variable d'environnement `KEYGEN_TEST_PASSPHRASE` ou, à défaut, sous une valeur d'attente écrite dans son code. L'option de rescellement que le mode opératoire nomme n'est pas lue par l'outil.
- Elle ne vérifie pas que la génération se fait hors ligne : le mode opératoire le prescrit, l'outil l'affiche en avertissement.
- Elle ne fait tourner ni ne retire aucune clé : le mode opératoire et la spécification d'identité écrivent chacun un protocole de rotation, que la preuve citée ici n'exerce pas.
- Elle ne signe rien elle-même : PRV-03 signe avec les clés qu'elle fournit.
- Elle ne gère pas la clé d'empreinte d'un run : ADR-0046 la veut propre au run, jamais transmise et détruite à sa fin.
- Elle ne remet aucun secret à un agent (PRV-11) et n'émet aucun jeton (IDN-02).
- Un agent n'y écrit pas seul : le mode opératoire est adressé au propriétaire.

## Mesure

- Preuve citée : l'outil de génération de la cérémonie, dans ce dépôt. Il montre une génération, un chiffrement sous phrase de passe et un refus en CI, écrits. Son fichier de test n'importe pas l'outil : il déclare ne sceller aucune clé et vérifie sa propre copie du calcul d'identifiant de clé. La preuve ne montre ni cérémonie tenue, ni clé scellée sous une phrase de passe saisie, ni clé publique enregistrée, ni rotation.
- Prochain fait observable : un outil qui saisit la phrase de passe et dont le test l'importe, puis une clé publique de production enregistrée dans ce dépôt par une pull request du propriétaire.
