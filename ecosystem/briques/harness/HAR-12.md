# HAR-12 — Niveaux d'autonomie par produit

## Contexte

I-17 ferme la surface où la touche humaine reste requise, « mutations des garde-fous » et « activations » comprises. ADR-0011 gradue déjà l'autonomie d'un run : un premier merge critique d'une couche est un arrêt dur, ses répétitions passent sur revue verte (D4), et des plafonds chiffrés arrêtent un run qui boucle ou dérive (D6). D32 confirme que D4 et D6 restent en vigueur. ADR-0064, proposé, donne par D2 à chaque brique, brique produit comprise, un champ d'autonomie à trois valeurs. Au 2026-11-11, hors de la carte, aucun fichier suivi de ce dépôt ne contient « budget d'erreur », « error budget », « niveau d'autonomie » ni « autonomy level » : une échelle par produit et par classe de données, et un déploiement sous budget d'erreur, sont une proposition de l'agent, non arbitrée. I-13, qui réduit la touche humaine aux invariants, est voisin et n'est pas cité.

## Ce que la brique ferme

Aucune preuve n'est citée ici : les fermetures ci-dessous sont l'objet de la brique, pas un fait montré.

- Un agent qui déploie sur un produit où il ne devait que proposer.
- Un niveau d'autonomie tenu par habitude, que rien n'écrit ni ne vérifie.
- Une montée de niveau décidée par l'agent : c'est une mutation de garde-fou, sur la surface d'I-17.

## Ce qu'elle ne fait pas

- Elle n'accorde rien : ADR-0064 fait du champ d'autonomie la restitution du plafond que la doctrine donne déjà.
- Elle ne dit pas quels actes restent au propriétaire. Sans GOV-01, un niveau n'a pas de répartition des actes sur laquelle s'appuyer.
- Elle ne définit pas les classes de données, qui relèvent de PAS-02.
- Elle ne mesure pas le budget d'erreur d'un produit ; cette mesure relève de la couche exploitation.

## Mesure

Preuve citée : aucune. Le champ d'autonomie de la carte porte une valeur parmi trois par brique. Il ne distingue pas les classes de données, et la charte d'un produit, dans le schéma de la carte, n'a pas de ligne d'autonomie.

Prochaine preuve : une charte de produit qui déclare son niveau, et un gate qui refuse une action d'agent au-dessus de ce niveau.
