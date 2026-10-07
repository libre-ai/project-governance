---
name: rgpd-dpia
description: Point to the rgpd-kit DPIA (Art. 35 GDPR) scaffold when a product change introduces automated decision-making, large-scale processing, special-category data, or vulnerable subjects. Never fills in or approves a DPIA — approval stays a manual owner act.
license: Apache-2.0
status: candidate
---

<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# AIPD / DPIA (Art. 35 RGPD)

## Quand l'utiliser

Un changement produit introduit ou étend l'une des quatre conditions de dépistage Art. 35(3) : décision automatisée, traitement à grande échelle, données de catégorie spéciale, sujets vulnérables.

## Ce que fournit rgpd-kit

- Gabarit AIPD : `createDpiaScaffold` / type `DPIAAssessment`, dépôt `libre-ai/rgpd-kit`, fichier `src/aida-template.ts` ; contrepartie lisible : `docs/aida-template.md`.
- Le gabarit produit une évaluation **vide, non approuvée** : les quatre questions de dépistage, une liste de risques à documenter (`severity: low|medium|high` + mitigation), et un champ `approvedBy: { role: owner|dpo|legal, date, name }` jamais pré-rempli.

## Ce que ce skill ne fait jamais

- Remplir un champ du gabarit à la place du propriétaire.
- Prononcer ou simuler une approbation. L'approbation AIPD est un acte propriétaire manuel, non gaté par CI (décision du 2026-07-23) : aucun gate n'existe ni ne doit être inventé pour l'automatiser.
- Trancher seul l'obligation légale au-delà du signal des quatre questions de dépistage — signaler le besoin, jamais décider à la place du propriétaire.

## Ce qu'il fait

- Signale le besoin dès qu'une des quatre conditions de dépistage est plausible.
- Pointe vers le gabarit et son type sans les dupliquer ici.
- Rappelle que `approvedBy` reste vide jusqu'à signature propriétaire, et que le rôle signataire est `owner`, `dpo` ou `legal` — jamais un agent.
