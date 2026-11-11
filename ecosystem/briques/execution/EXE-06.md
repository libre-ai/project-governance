# EXE-06 — Mémoire d'agent intègre

## Contexte

ADR-0009 pose que tout rappel de mémoire porte une enveloppe de contenu non fiable, à l'intégrité signée et vérifiable. I-32 ajoute qu'un résumé ou une compaction reste une chaîne non fiable. Le paquet d'enveloppe de `schemas-and-contracts` compte la mémoire parmi ses sources. La spécification du service de mémoire est un brouillon, tenu dans `execution-continuity-evaluator`, sans verrou prononcé. Aucun des deux dépôts ne porte le service lui-même.

## Ce que la brique ferme

- Le souvenir altéré, ou dépouillé de sa marque, entre deux exécutions : l'enveloppe rend l'altération détectable (I-18).
- Le souvenir pris pour une autorité : une donnée d'exploitation n'autorise seule aucune écriture sur une source de vérité (I-18).
- L'instruction glissée dans un résumé, puis relue par un modèle qui détient un outil à effet (I-32).

## Ce qu'elle ne fait pas

- Elle n'isole pas le modèle du contenu rappelé : ADR-0045 classe l'enveloppe en défense en profondeur.
- Elle ne produit pas le contenu qu'elle retient : il vient d'une tâche confinée par EXE-01.
- Elle n'authentifie pas l'origine : l'empreinte est symétrique, et l'identité de l'agent vient d'IDN-04.

## Mesure

- Preuves citées : le module d'enveloppe de `schemas-and-contracts` et son test. Ils montrent qu'un contenu rappelé est marqué non fiable et qu'une altération fait échouer la vérification. Ils ne montrent ni versionnement ni mémoire persistée.
- Prochaine preuve : un service de mémoire dont chaque rappel sort sous enveloppe vérifiée, avec un vecteur rouge où un souvenir altéré en base est refusé.
