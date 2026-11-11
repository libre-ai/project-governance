# IDN-03 — Racine par organisation

## Contexte

ADR-0042 §5 impose le tenant `organization` dès le premier produit du catalogue (D55). Chaque jeton interne porte déjà un tenant opaque obligatoire, et la base répète cette frontière par RLS (I-09, D15). La spécification d'identité réserve en revanche la clé privée de signature au seul émetteur d'autorisation. Aucune racine propre à une organisation n'existe, ni aucune sous-racine par produit.

## Ce que la brique ferme

- La clé unique qui signe pour toutes les organisations : sa compromission atteint chaque tenant à la fois.
- Le jeton d'un produit accepté par un autre : une sous-racine par produit borne ce qu'un vérificateur admet.
- La frontière de tenant tenue par un seul fait du jeton : la racine ajoute une séparation cryptographique à celle d'I-09 et d'I-21.

## Ce qu'elle ne fait pas

- Elle n'émet pas de jetons : IDN-02 le fait, sous la racine qu'elle fournit.
- Elle ne s'applique pas à P40, outil local mono-poste que D61 exempte du tenant.
- Elle ne garde pas les clés : leur stockage et leur rotation relèvent de PRV-04.
- Elle ne crée aucune organisation : l'adhésion et les rôles restent des faits du produit.

## Mesure

- Preuve citée : aucune. Le tenant obligatoire existe dans chaque jeton, mais aucune clé n'est propre à une organisation, et aucun dépôt ne porte la brique.
- Prochaine preuve : un vecteur publié où un jeton signé sous la racine d'une organisation est refusé par le vérificateur d'une autre.
