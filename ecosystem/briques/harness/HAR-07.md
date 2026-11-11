# HAR-07 — File d'arrêts

## Contexte

I-24, posé par ADR-0022 et amendé par ADR-0051 (D74), fixe la forme d'une décision qui revient au propriétaire : contexte restitué, deux à quatre options exclusives, conséquences. ADR-0034 D5 en fait une mutation typée, et `schemas-and-contracts` porte les contrats de demande et de réponse. `ai-work-supervision` porte les demandes de décision, qui bloquent leur mission tant qu'elles restent ouvertes. Le module de coordination lu ne porte ni champ de situation ni mesure de l'intervalle entre ouverture et réponse.

## Ce que la brique ferme

- Un arrêt d'agent resté dans une conversation, que personne ne retrouve.
- Un travail qui continue sans réponse à la question qui le conditionne.
- Une escalade présentée sans options ni conséquences, contraire à I-24.
- Une réponse donnée par un agent à la place du propriétaire : I-17 range les escalades dans la surface à touche humaine.

## Ce qu'elle ne fait pas

- Elle n'affiche rien : les surfaces relèvent de HAR-05.
- Elle ne répond pas. Sans GOV-01, rien ne dit que la réponse revient au propriétaire.
- Elle n'ouvre pas de session. Sans HAR-02, un arrêt n'a pas de session déclarée qui l'ouvre.
- Elle ne décide pas quand un agent doit s'arrêter.
- Elle ne reçoit pas les refus de la politique d'argument : ADR-0045 les veut terminaux, sans demande de décision humaine.

## Mesure

Preuves citées : le module de coordination de `ai-work-supervision` et le contrat de demande de décision de `schemas-and-contracts`. Le premier montre le cycle d'une demande et la réponse réservée au propriétaire, sur un acteur déclaré, non authentifié. Le second fixe les champs d'une demande liée à un plan.

Prochaine preuve : une file où chaque arrêt porte sa situation déclarée et l'intervalle mesuré entre ouverture et réponse.
