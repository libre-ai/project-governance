# HAR-07 — File d'arrêts

## Contexte

I-24, posé par ADR-0022 et amendé par ADR-0051 (D74), fixe la forme d'une décision qui revient au propriétaire : contexte restitué, deux à quatre options exclusives, conséquences. I-17 range les escalades dans la surface à touche humaine. ADR-0034 D5 fait de la décision humaine une mutation typée, et `schemas-and-contracts` porte le contrat de demande cité ici. `ai-work-supervision` porte les demandes de décision, qui bloquent leur mission tant qu'elles restent ouvertes. Ni le module de coordination ni le contrat lus ne portent un champ de situation ou une mesure de l'intervalle entre ouverture et réponse.

## Ce que la brique ferme

- Une question d'agent restée dans une conversation : une session déclarée ouvre une demande, qui devient un événement à journaliser.
- Un travail qui continue sans réponse à la question qui le conditionne : une demande ouverte est un blocage du lancement et de l'acceptation de sa mission.
- Une escalade présentée sans options ni conséquences, contraire à I-24 : le module refuse une demande hors de deux à quatre options, chacune avec sa conséquence et sa réversibilité, et le contrat borne les choix de même.
- Une réponse donnée par une session d'agent à la place du propriétaire, sur la surface d'I-17 : le module réserve la réponse à l'acteur propriétaire. Cet acteur est déclaré, non authentifié.

## Ce qu'elle ne fait pas

- Elle n'affiche rien : les surfaces relèvent de HAR-05.
- Elle ne répond pas. Sans GOV-01, elle n'a pas de règle qui réserve la réponse au propriétaire.
- Elle n'ouvre pas de session. Sans HAR-02, un arrêt n'a pas de session déclarée qui l'ouvre.
- Elle ne décide pas quand un agent doit s'arrêter.
- Elle ne reçoit pas les refus de la politique d'argument : ADR-0045 les veut terminaux, sans demande de décision humaine.
- Elle n'empêche pas un processus de se dire propriétaire : le module écrit que l'acteur est déclaratif.

## Mesure

Preuves citées : le module de coordination de `ai-work-supervision` et le contrat de demande de décision de `schemas-and-contracts`. Le premier montre le cycle d'une demande, ouverte, répondue ou retirée, et la réponse réservée au propriétaire, sur un acteur déclaré, non authentifié. Le second fixe les champs d'une demande liée à un plan, dont deux à quatre choix, un rôle requis et une expiration.

Faits attendus, non montrés : la situation déclarée de chaque arrêt, et l'intervalle mesuré entre son ouverture et sa réponse, que le rôle nomme.

Prochaine preuve : une file où chaque arrêt porte sa situation déclarée et l'intervalle mesuré entre ouverture et réponse.
