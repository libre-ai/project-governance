# IDN-03 — Racine par organisation

## Contexte

ADR-0042 §5 impose le tenant `organization` dès le premier produit du catalogue (D55). I-09 veut un « tenant obligatoire + RLS ». ADR-0002 §1 et D15 rendent le tenant opaque obligatoire dans chaque jeton interne. La spécification d'identité de ce dépôt (`docs/specifications/IDENTITY-AUTHORIZATION.md`) fait répéter cette frontière par RLS. Elle réserve la clé privée de signature au seul émetteur d'autorisation. Elle ne décrit ni racine par organisation ni sous-racine par produit. La racine et la sous-racine sont une proposition de l'agent, non arbitrée. La brique dépend d'IDN-02 : sans jeton émis, une racine n'a rien à signer.

## Ce que la brique ferme

Aucune de ces fermetures n'est réalisée : la brique n'a ni dépôt porteur ni preuve.

- La clé unique qui signe pour toutes les organisations : sa compromission atteint chaque tenant à la fois.
- Le jeton d'un produit accepté par un autre : une sous-racine par produit bornerait ce qu'un vérificateur admet.
- La frontière de tenant tenue par un seul fait du jeton : la racine ajouterait une séparation cryptographique au « tenant obligatoire » d'I-09.

## Ce qu'elle ne fait pas

- Elle n'émet pas de jetons : IDN-02 le fait.
- Elle ne s'applique pas à P40, outil local mono-poste que D61 exempte du tenant.
- Elle ne garde pas les clés : leur stockage et leur rotation relèvent de PRV-04.

## Mesure

- Preuve citée : aucune. Le tenant obligatoire des jetons est porté par IDN-02 ; il ne réalise pas une racine.
- Prochaine preuve : une décision du propriétaire sur la racine par organisation, puis un vecteur publié où un jeton signé sous la racine d'une organisation est refusé par le vérificateur d'une autre.
