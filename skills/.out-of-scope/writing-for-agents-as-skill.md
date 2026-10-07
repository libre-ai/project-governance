# Refusé : une skill « writing-for-agents »

- **Date :** 2026-08-18 (ADR-0025, admission des six premières skills).
- **Proposition écartée :** encoder la doctrine d'écriture des skills (budget
  de corps, divulgation progressive, mots-tête, formulation positive,
  `user-invoked` vs `model-invoked`) sous forme de skill invocable, au lieu
  d'un document de méthode.

## Raison du refus

La doctrine d'écriture des skills vit dans `docs/method/SKILLS-ANATOMY.md`.
L'écrire une seconde fois comme skill créerait deux sources de vérité sur le
même sujet — exactement ce que `docs/README.md` (carte d'autorité) interdit
pour tout autre sujet du dépôt. Une skill se charge à la demande, sur une
tâche précise ; une doctrine d'écriture se consulte au moment de créer ou
réviser une skill, un geste rare et déjà couvert par la lecture directe du
document de méthode. Le geste rare ne justifie pas le coût double du
pointeur (voir `SKILLS-ANATOMY.md`, « Le pointeur a un coût double ») que
créerait une skill qui ne ferait que renvoyer vers ce même document.

## Prior requests

_(aucune — première entrée, day-1)_
