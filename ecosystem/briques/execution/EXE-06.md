# EXE-06 — Mémoire d'agent intègre

## Contexte

ADR-0009 §6 pose que tout rappel de mémoire porte une enveloppe de contenu non fiable, dont l'intégrité est signée et vérifiable. I-18 le reprend : « enveloppe d'intégrité signée sur tout rappel ». I-32 interdit qu'une chaîne dérivée d'un contenu non fiable, « résumée, compactée » comprise, entre dans le contexte d'un modèle qui détient un outil à effet. Le paquet d'enveloppe de `schemas-and-contracts` compte la mémoire parmi ses sources. La spécification du service de mémoire est un brouillon, tenu dans `execution-continuity-evaluator`, en attente de verrou. Aux commits cités, les seuls noms de fichiers de ces deux dépôts qui contiennent `memory` sont cette spécification et son gate de synchronisation. La brique dépend d'IDN-04 : la spécification brouillon borne le rappel à l'identité de l'agent, et sans elle un souvenir n'a pas de titulaire.

## Ce que la brique ferme

- Le souvenir altéré, ou dépouillé de sa marque, entre deux exécutions : l'enveloppe rend l'altération détectable (I-18).
- Le souvenir pris pour une autorité : I-18 veut des « données `operational` jamais autorité ».

## Ce qu'elle ne fait pas

- Elle n'isole pas le modèle du contenu rappelé : ADR-0045 (D66) classe l'enveloppe en défense en profondeur, et I-32 ne la compte pas comme isolation.
- Elle n'authentifie pas l'origine : l'empreinte est symétrique, et l'identité de l'agent vient d'IDN-04.
- Elle ne persiste rien : le service de mémoire n'existe qu'en spécification.

## Mesure

- Preuves citées : le module d'enveloppe de `schemas-and-contracts` et son test. Ils montrent qu'un contenu rappelé est marqué non fiable et qu'une altération fait échouer la vérification. Ils ne montrent ni versionnement ni mémoire persistée.
- Prochaine preuve : un service de mémoire dont chaque rappel sort sous enveloppe vérifiée, avec un vecteur rouge où un souvenir altéré en base est refusé.
