# IDN-04 — Identité des agents et des runners

## Contexte

I-18 exige l'« identité des agents (flotte/mission/capacités, révocation par agent) » ; sa source est ADR-0009 §6. Le contrôle K1 de la spécification du noyau de sécurité (`docs/specifications/LOOP-SECURITY-KERNEL.md`) la réalise par trois faits Biscuit. Le gabarit d'autorité `authority-v2` porte ces trois faits, et la politique `agent-runs-v2` exige la flotte et la mission dans chaque règle d'agent. Les deux contrats sont verrouillés au catalogue de `schemas-and-contracts`, au commit cité. ADR-0018 constate ces faits intégrés à l'autorité Biscuit, avec révocation par agent. I-09 relève l'état de l'identité d'agent : « fanout de revue uniquement, aucun produit couche 2/3 ne le consomme ». La brique dépend d'IDN-02 : sans jeton Biscuit, ces faits n'ont pas de porteur. L'identité attestée d'un runner, seconde moitié du rôle, est une proposition de l'agent, non arbitrée.

## Ce que la brique ferme

- L'agent anonyme : un jeton d'agent sans ses faits de flotte et de mission ne porte aucune autorité (I-18).
- Le jeton réutilisé d'une mission à l'autre, menace que le modèle de menace de ce dépôt rattache à I-18.
- L'agent qui écrit ses propres garde-fous : la spécification du noyau n'accorde par défaut à aucun jeton d'agent l'écriture sur la CI ou les gates.

## Ce qu'elle ne fait pas

- Elle ne vérifie pas le périmètre de capacités à la frontière d'outil : le gabarit encode ce fait sans le valider, et la spécification du noyau diffère ce contrôle.
- Elle ne fixe pas ce qu'un agent peut faire seul sur un produit : c'est HAR-12.
- Elle ne confine pas l'exécution : c'est EXE-01.
- Elle ne retire pas un jeton déjà émis : c'est IDN-05.

## Mesure

- Preuves citées : les contrats `authority-v2` et `agent-runs-v2`, épinglés. Ils fixent les trois faits et les clauses de flotte et de mission. Le test qui exerce le refus entre flottes vit dans `capability-authorization` ; il n'est pas cité ici. Ils ne montrent aucune identité de runner. Dans ce dépôt, au 2026-11-11, deux workflows lisent un jeton dans les secrets du dépôt (`grep -rln 'secrets\.' .github/workflows`).
- Prochaine preuve : un runner de CI obtient un jeton court par attestation, et son workflow ne lit plus aucun secret de dépôt.
