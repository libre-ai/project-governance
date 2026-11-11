# IDN-01 — Identité provider-neutre

## Contexte

I-09 fixe la frontière d'identité : « OIDC provider-neutre » puis « session navigateur opaque ». ADR-0002 §2 retient le flux Authorization Code avec PKCE et ne sélectionne aucun fournisseur. D16 tient ce flux pour stable et laisse le choix du fournisseur au dépôt consommateur. Le contrat `auth.v1` est verrouillé au catalogue de `schemas-and-contracts`, au commit cité. Le paquet `auth-web` de `ai-work-supervision` porte le flux et un émetteur de test en processus. ADR-0028 (D35) a inscrit dans I-09 un état par sous-composant, relevé le 2026-08-18 : OIDC et session y sont construits, sans consommateur. La brique dépend de GOV-07 : sans l'autorité des contrats canoniques, `auth.v1` n'a pas de source unique contre laquelle vérifier une implémentation.

## Ce que la brique ferme

- La dépendance à un fournisseur d'identité nommé : la frontière est un contrat, et le choix du fournisseur ne modifie pas le contrat de session (ADR-0002 §2).
- Le vol ou la fixation de session : la spécification d'identité de ce dépôt (`docs/specifications/IDENTITY-AUTHORIZATION.md`), source d'I-09, veut un cookie opaque dont le serveur ne garde qu'un condensé à clé, renouvelé à chaque authentification.
- La confusion entre authentification et autorisation : D09 sépare la session navigateur du jeton interne, qui n'atteint jamais le navigateur.

## Ce qu'elle ne fait pas

- Elle n'autorise aucune action entre services : c'est le rôle d'IDN-02.
- Elle ne donne pas d'identité aux agents ni aux runners : c'est IDN-04.
- Elle ne choisit ni ne provisionne un fournisseur de production : D16 laisse cet acte au dépôt consommateur, sous ses propres contrôles.

## Mesure

- Preuves citées : le contrat `auth.v1` et le module de transaction OIDC de `auth-web`, épinglés au commit de leur dépôt. Le contrat spécifie la frontière. Le module réalise la transaction : PKCE S256, état et nonce aléatoires, transaction à usage unique dont seul le condensé du cookie est stocké. Ils ne montrent ni la session applicative ni un produit qui s'en sert.
- Prochaine preuve : un produit du catalogue ouvre une session par ce flux contre un fournisseur autre que l'émetteur de test, et son test de bout en bout est publié.
