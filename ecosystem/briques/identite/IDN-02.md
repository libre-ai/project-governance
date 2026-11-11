# IDN-02 — Jetons atténués

## Contexte

I-09 retient le Biscuit Ed25519 atténué, court et révocable pour l'autorisation entre services. Le dépôt `capability-authorization` porte l'émission, l'atténuation, la vérification et la rotation à deux clés. Ses politiques datalog sont une projection à l'octet des contrats de `schemas-and-contracts`. Il vendorise `biscuit-auth` avec un correctif amont, dont il est le foyer unique au sens d'I-28. Au relevé daté qu'I-09 porte, la brique est construite et aucun consommateur ne l'invoque.

## Ce que la brique ferme

- Le jeton à tout faire : chaque jeton est borné à un tenant, une ressource, des opérations et une échéance (I-09, D15).
- L'élargissement par délégation : une atténuation ne peut que restreindre, jamais ajouter un rôle ni repousser l'échéance.
- La fuite du jeton par les traces : ses octets ne sortent ni par une erreur ni par un affichage de débogage.
- La copie divergente d'un correctif de sécurité : celui de `biscuit-auth` n'existe que dans ce dépôt (I-28, D37).

## Ce qu'elle ne fait pas

- Elle n'authentifie personne : elle autorise un principal déjà vérifié par IDN-01 ou IDN-04.
- Elle ne tient ni le magasin de révocation ni l'anneau de clés : elle les consomme, et la propagation relève d'IDN-05.
- Elle ne franchit jamais la frontière du navigateur (D09).

## Mesure

- Preuves citées : le module d'émission et d'atténuation, et la suite de tests d'autorisation, épinglés au commit du dépôt porteur. La suite contient le cas qui vérifie qu'une atténuation hors ligne ne fait que réduire l'autorité.
- Prochaine preuve : un service de la flotte refuse une requête réelle sur un jeton atténué, et ce refus figure dans une évidence publiée.
