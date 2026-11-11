# IDN-01 — Identité provider-neutre

## Contexte

I-09 fixe la frontière d'identité : OIDC neutre vis-à-vis du fournisseur, puis session navigateur opaque. ADR-0002 §2 retient le flux Authorization Code avec PKCE et ne choisit aucun fournisseur (D16). Le contrat `auth.v1` est verrouillé dans `schemas-and-contracts`. Le paquet `auth-web` de `ai-work-supervision` l'implémente, avec un émetteur de test en processus. Au relevé daté qu'I-09 porte, cet ensemble est construit et aucun consommateur ne l'invoque. Aucun fournisseur de production n'est sélectionné.

## Ce que la brique ferme

- La dépendance à un fournisseur d'identité nommé : la frontière est un contrat, et le fournisseur se remplace sans le modifier (D16).
- Le vol ou la fixation de session : le cookie est opaque, le serveur n'en garde qu'un condensé, et il change à chaque authentification (I-09).
- La confusion entre authentification et autorisation : un navigateur ne reçoit jamais de jeton interne (D09).

## Ce qu'elle ne fait pas

- Elle n'autorise aucune action entre services : c'est le rôle d'IDN-02.
- Elle ne donne pas d'identité aux agents ni aux runners : c'est IDN-04.
- Elle ne choisit ni ne provisionne un fournisseur de production. D16 laisse cet acte au dépôt consommateur, sous ses propres contrôles.

## Mesure

- Preuves citées : le contrat `auth.v1` et le module de transaction OIDC de `auth-web`, épinglés au commit de leur dépôt. Ils montrent que la frontière est spécifiée et implémentée, pas qu'un produit s'en sert.
- Prochaine preuve : un produit du catalogue ouvre une session par ce flux contre un fournisseur auto-hébergé, et son test de bout en bout est publié.
