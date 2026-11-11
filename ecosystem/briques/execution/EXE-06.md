# EXE-06 — Mémoire d'agent intègre

## Contexte

ADR-0009 §6 pose que tout rappel de mémoire porte une enveloppe de contenu non fiable, dont l'intégrité est signée et vérifiable. I-18 le reprend : « enveloppe d'intégrité signée sur tout rappel ». I-32 contraint la brique : aucune chaîne dérivée d'un contenu non fiable, « résumée, compactée » comprise, n'entre dans le contexte d'un modèle qui détient un outil à effet, et l'enveloppe ne compte pour aucune de ses trois propriétés. Un souvenir dérivé d'un contenu non fiable, même sous enveloppe, ne se rend donc pas à un modèle qui détient un outil à effet. Le paquet d'enveloppe de `schemas-and-contracts` compte la mémoire parmi ses sources. La spécification du service de mémoire est un brouillon, tenu dans `execution-continuity-evaluator`, en attente de verrou. Dans `schemas-and-contracts`, au commit cité, aucun nom de fichier ne contient `memory` ; dans `execution-continuity-evaluator`, à sa tête lue le 2026-11-11, seuls cette spécification et son gate de synchronisation en contiennent. La brique dépend d'IDN-04 : la spécification brouillon borne le rappel à l'identité de l'agent, et sans elle un souvenir n'a pas de titulaire.

## Ce que la brique ferme

- Le contenu rappelé altéré, ou dépouillé de sa marque : la vérification échoue fermée sur toute altération du contenu, du drapeau, de la source, de l'étiquette ou de l'horodatage, pour qui ne détient pas la clé (I-18).
- Le contenu rappelé présenté à un modèle comme une instruction : le rendu vérifie d'abord l'enveloppe, puis encadre le contenu de délimiteurs échappés, marqué `trusted=false`.

## Ce qu'elle ne fait pas

- Elle n'isole pas le modèle du contenu rappelé : ADR-0045 (D66) classe l'enveloppe en défense en profondeur, et I-32 ne la compte pas comme isolation.
- Elle n'authentifie pas l'origine : l'empreinte est symétrique, la clé est partagée entre qui produit et qui vérifie, et l'identité de l'agent vient d'IDN-04.
- Elle ne classe pas un souvenir : la spécification brouillon écrit qu'une mémoire rappelée n'est jamais autorité, selon la clause d'I-18 sur les « données `operational` jamais autorité » ; aucune preuve citée ici ne l'exerce.
- Elle ne persiste rien : aucune preuve citée ici ne garde un souvenir d'une exécution à l'autre, et le service de mémoire n'est décrit que par la spécification brouillon.

## Mesure

- Preuves citées : le module d'enveloppe de `schemas-and-contracts` et son test. Ils montrent qu'un contenu d'une source non fiable est marqué `trusted:false`, qu'une altération fait échouer la vérification, et que le rendu échappe les délimiteurs. `memory` figure dans la liste fermée des sources du module ; le test exerce la source `web`, et `memory` n'y paraît que comme source substituée dans un cas de falsification. Ils ne montrent ni mémoire persistée, ni rappel borné à un agent.
- Prochaine preuve : un service de mémoire dont chaque rappel sort sous enveloppe vérifiée, avec un vecteur rouge où un souvenir altéré en base est refusé.
