# IDN-03 — Racine par organisation

## Contexte

ADR-0042 §5 impose le tenant `organization` dès le premier produit du catalogue (D55). D15 rend le tenant opaque obligatoire dans chaque jeton interne ; ADR-0002 §1 l'impose à tout espace personnel autorisé côté serveur. La spécification d'identité de ce dépôt (`docs/specifications/IDENTITY-AUTHORIZATION.md`) fait répéter cette frontière par RLS. Elle réserve la clé privée de signature au seul émetteur d'autorisation. Elle ne décrit ni racine par organisation ni sous-racine par produit. La racine et la sous-racine sont une proposition de l'agent, non arbitrée. Aucun invariant du registre ne lie la brique : I-09 veut un « tenant obligatoire + RLS », que porte IDN-02, et ne demande pas de racine ; il est voisin et n'est pas cité. La brique dépend d'IDN-02 : sans jeton émis, une racine n'a rien à signer.

## Ce que la brique ferme

Cette fiche ne cite aucune preuve et la carte ne donne à la brique aucun dépôt porteur : aucune des fermetures ci-dessous n'est montrée réalisée.

- La clé unique qui signe pour toutes les organisations : sa compromission atteint chaque tenant à la fois.
- Le jeton d'un produit accepté par un autre : une sous-racine par produit bornerait ce qu'un vérificateur admet.
- La frontière de tenant tenue par un seul fait du jeton : la racine ajouterait une séparation cryptographique au « tenant obligatoire » d'I-09, voisin.

## Ce qu'elle ne fait pas

- Elle n'émet pas de jetons : IDN-02 le fait.
- Elle ne s'applique pas à P40, outil local mono-poste que D61 exempte du tenant.
- Elle ne garde pas les clés : leur stockage et leur rotation relèvent de PRV-04.

## Mesure

- Preuve citée : aucune. Le tenant obligatoire des jetons est porté par IDN-02 ; il ne réalise pas une racine.
- Prochaine preuve : une décision du propriétaire sur la racine par organisation, puis un vecteur publié où un jeton signé sous la racine d'une organisation est refusé par le vérificateur d'une autre.
