# HAR-12 — Niveaux d'autonomie par produit

## Contexte

I-13 réduit la touche humaine aux invariants, et I-17 ferme la surface où elle reste requise. ADR-0011 gradue déjà l'autonomie d'un run : un premier merge critique d'une couche est un arrêt dur, ses répétitions passent sur revue verte (D4), et des plafonds chiffrés arrêtent un run qui boucle ou dérive (D6). ADR-0064 D2 donne à chaque brique un champ d'autonomie à trois valeurs. Aucun texte ne fixe une échelle par produit et par classe de données, de la proposition seule au déploiement sous budget d'erreur.

## Ce que la brique ferme

- Un agent qui déploie sur un produit où il ne devait que proposer.
- Un niveau d'autonomie tenu par habitude, que rien n'écrit ni ne vérifie.
- Une montée de niveau décidée par l'agent : c'est une mutation de garde-fou, sur la surface d'I-17.

## Ce qu'elle ne fait pas

- Elle n'accorde rien : elle restitue le plafond que la doctrine donne déjà.
- Elle ne définit pas les classes de données, qui relèvent de PAS-02.
- Elle ne mesure pas le budget d'erreur d'un produit ; cette mesure relève de la couche exploitation.

## Mesure

Preuve citée : aucune. Le champ d'autonomie de la carte porte trois valeurs par brique. Il ne porte pas une échelle par produit et par classe, et la charte d'un produit n'a pas de ligne d'autonomie.

Prochaine preuve : une charte de produit qui déclare son niveau, et un gate qui refuse une action d'agent au-dessus de ce niveau.
