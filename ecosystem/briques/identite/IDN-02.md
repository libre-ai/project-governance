# IDN-02 — Jetons atténués

## Contexte

I-09 retient un « Biscuit Ed25519 atténué, court, révocable », avec « tenant obligatoire ». ADR-0002 §1 fait refuser par les politiques Biscuit un tenant manquant ou divergent, et D15 rend le tenant opaque obligatoire dans chaque jeton interne. Le dépôt `capability-authorization` porte l'émission, l'atténuation, la vérification et la rotation à deux clés. Ses sept politiques datalog ont la même empreinte git que les contrats de `schemas-and-contracts`, aux deux commits cités (comparaison des arbres git des deux dépôts). Il vendorise `biscuit-auth` avec un correctif amont. I-28 donne à un tel correctif un « foyer unique » (ADR-0031, D37) et nomme ce foyer `authz-biscuit` ; ADR-0041 §4 le nomme `capability-authorization`. ADR-0028 a inscrit dans I-09 l'état du Biscuit au 2026-08-18 : construit, sans consommateur. La brique dépend de GOV-07 : sans les contrats canoniques, ses politiques n'ont pas d'original dont être la copie.

## Ce que la brique ferme

- Le jeton à tout faire : le module d'émission borne chaque jeton à un tenant, une ressource, un ensemble d'opérations et une échéance. I-09 et D15 n'en portent que le tenant et la durée courte ; le reste vient de la spécification d'identité de ce dépôt (`docs/specifications/IDENTITY-AUTHORIZATION.md`).
- L'élargissement par délégation : une atténuation ne peut que restreindre. Elle n'ajoute ni rôle ni opération et ne repousse pas l'échéance.
- La fuite du jeton par les traces : l'affichage de débogage de chaque type qui le porte est caviardé, et une erreur ne rend qu'un code fermé.
- La copie divergente d'un correctif de sécurité : I-28 interdit une seconde copie dans un autre dépôt (D37).

## Ce qu'elle ne fait pas

- Elle n'authentifie personne : elle autorise un principal déjà vérifié par IDN-01 ou IDN-04.
- Elle ne propage pas la révocation : c'est IDN-05.
- Elle ne franchit jamais la frontière du navigateur (D09).

## Mesure

- Preuves citées : le module d'émission et d'atténuation, et la suite de tests d'autorisation, épinglés au commit du dépôt porteur. La suite contient le cas qui vérifie qu'une atténuation hors ligne ne fait que réduire l'autorité. Elles ne montrent aucun service qui consomme ces jetons.
- Prochaine preuve : un service de la flotte refuse une requête réelle sur un jeton atténué, et ce refus figure dans une évidence publiée.
