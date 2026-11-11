# HAR-12 — Niveaux d'autonomie par produit

## Contexte

I-13 réduit la touche humaine aux invariants, et I-17 ferme la surface où elle reste requise. ADR-0011 gradue déjà l'autonomie d'un run : un premier merge critique d'une couche est un arrêt dur, ses répétitions passent sur revue verte (D4), et des plafonds chiffrés arrêtent un run qui boucle ou dérive (D6). D32 confirme que D4 et D6 restent en vigueur. ADR-0064, proposé, donne par D2 à chaque brique un champ d'autonomie à trois valeurs. Dans les documents de ce dépôt, au 2026-11-11, aucun texte ne nomme un niveau d'autonomie par produit ni un budget d'erreur.

## Ce que la brique ferme

- Un agent qui déploie sur un produit où il ne devait que proposer.
- Un niveau d'autonomie tenu par habitude, que rien n'écrit ni ne vérifie.
- Une montée de niveau décidée par l'agent : c'est une mutation de garde-fou, sur la surface d'I-17.

## Ce qu'elle ne fait pas

- Elle n'accorde rien : ADR-0064 fait du champ d'autonomie la restitution du plafond que la doctrine donne déjà.
- Elle ne dit pas quels actes restent au propriétaire. Sans GOV-01, un niveau n'a pas de répartition des actes sur laquelle s'appuyer.
- Elle ne définit pas les classes de données, qui relèvent de PAS-02.
- Elle ne mesure pas le budget d'erreur d'un produit ; cette mesure relève de la couche exploitation.

## Mesure

Preuve citée : aucune. Le champ d'autonomie de la carte porte trois valeurs par brique. Il ne porte pas une échelle par produit et par classe, et la charte d'un produit n'a pas de ligne d'autonomie.

Prochaine preuve : une charte de produit qui déclare son niveau, et un gate qui refuse une action d'agent au-dessus de ce niveau.
