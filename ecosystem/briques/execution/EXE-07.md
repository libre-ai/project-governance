# EXE-07 — Environnements éphémères

## Contexte

ADR-0042 fait avancer plusieurs lignes produit en même temps, chaque dépôt n'ayant qu'un propriétaire à la fois. Son §10 (D62) admet que Work Supervision crée ses worktrees par le `git` du système, appelé en processus séparé. `ai-work-supervision` porte la crate correspondante : un worktree par mission, créé à l'ouverture, retiré à la clôture. Chaque étape s'y écrit en trois temps : intention au journal, effet dans git, confirmation au journal. La brique ne couvre aujourd'hui que l'arbre de travail d'un dépôt.

## Ce que la brique ferme

- Deux missions qui écrivent dans le même arbre de travail et mêlent leurs changements.
- Le résidu d'une mission interrompue : une intention sans confirmation est résolue à la reprise.
- La suppression sans trace : un abandon archive d'abord le diff, dont seules l'empreinte et la taille entrent au journal.

## Ce qu'elle ne fait pas

- Elle ne confine pas ce qui s'exécute dans l'environnement : c'est EXE-01.
- Elle ne tient pas le journal où elle écrit : c'est PRV-01.
- Elle ne supprime pas le résultat accepté d'une mission, dont la branche est conservée.

## Mesure

- Preuves citées : la crate de worktrees de `ai-work-supervision` et son test de cycle de vie. Ils montrent la création, le retrait et la réconciliation après une panne injectée à chaque étape.
- Prochaine preuve : une mission réelle dont le journal porte la confirmation de retrait de son environnement, vérifiée par un outil distinct de celui qui l'a écrite.
