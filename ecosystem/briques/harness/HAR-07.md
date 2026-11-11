# HAR-07 — File d'arrêts

## Contexte

I-24 fixe la forme d'une décision qui revient au propriétaire : contexte restitué, deux à quatre options exclusives, conséquences. ADR-0034 D5 en fait une mutation typée, et `schemas-and-contracts` porte les contrats de demande et de réponse. `ai-work-supervision` porte les demandes de décision, qui bloquent leur mission tant qu'elles restent ouvertes. La politique qui dit quand un agent s'arrête vit dans le harnais du propriétaire, hors flotte. Rien dans la flotte ne classe un arrêt par sa situation ni ne mesure le délai de réponse.

## Ce que la brique ferme

- Un arrêt d'agent resté dans une conversation, que personne ne retrouve.
- Un travail qui continue sans réponse à la question qui le conditionne.
- Une escalade présentée sans options ni conséquences, contraire à I-24.
- Une réponse donnée par un agent à la place du propriétaire, contraire à I-17.

## Ce qu'elle ne fait pas

- Elle n'affiche rien : les surfaces relèvent de HAR-05.
- Elle ne décide pas quand un agent doit s'arrêter ; cette politique reste hors flotte.
- Elle ne reçoit pas les refus de la politique d'argument, terminaux et sans renvoi humain (I-32).

## Mesure

Preuves citées : le module de coordination de `ai-work-supervision` et le contrat de demande de décision de `schemas-and-contracts`. Le premier montre le cycle d'une demande et la réponse réservée au propriétaire. Le second fixe les champs d'une demande liée à un plan.

Prochaine preuve : une file où chaque arrêt porte sa situation déclarée et l'intervalle mesuré entre ouverture et réponse.
