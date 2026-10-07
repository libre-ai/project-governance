# Refusé : une skill générale « verify-the-world »

- **Date :** 2026-08-18 (ADR-0025, admission des six premières skills).
- **Proposition écartée :** une skill générale de vérification empirique
  (« ne crois pas ce que le code prétend, vérifie le monde réel ») distincte
  de `verify-runtime`.

## Raison du refus

Cette doctrine générale existe déjà, sous deux formes qui la couvrent
entièrement :

- **La preuve d'exécution d'un changement précis** est le rôle admis de
  `verify-runtime` (surface CLI/API/web/bibliothèque/agent, verdict
  PASS/FAIL/BLOCKED/SKIP). Une skill « verify-the-world » séparée
  recouvrirait `verify-runtime` à un niveau de généralité supérieur, sans
  ajouter de mécanisme — exactement le doublon interne que le gate T2
  (ADR-0025 D2.1) existe pour attraper.
- **La preuve d'une revue** (reproduire l'évidence plutôt que l'affirmer)
  est le rôle de `docs/reviews/AGENT-REVIEW-PROTOCOL.md`, pointé par la
  skill `review-fanout` sans y être dupliqué.

Une doctrine de « toujours vérifier empiriquement » qui ne s'attache à
aucune surface précise n'est pas une skill actionnable — c'est un principe,
et un principe se rappelle par la posture générale de l'agent, pas par un
`SKILL.md` de plus qui répéterait ce que deux artefacts déjà admis couvrent.

## Prior requests

_(aucune — première entrée, day-1)_
