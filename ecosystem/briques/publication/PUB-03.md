# PUB-03 — Site par public, bilingue, RGAA

## Contexte

I-05 fait du site une application qui sert des projections. ADR-0033 le veut statique, sans JavaScript client ni requête externe, consommateur de projections épinglées par sha. Dans `project-website`, le générateur dérive les pages de copies épinglées, refusées si elles s'écartent de leurs empreintes (fiches de projet, fichiers de licences, document de déploiement), de la projection de marque et du portefeuille de l'autorité ; les jetons et les styles viennent du paquet d'interface installé. Les présentations de produit y sont rédigées à la main. I-15 n'ouvre la vitrine d'un produit que sur une chose vérifiable, et I-37 demande une assertion de bout en bout de la politique de sécurité servie. Au 2026-11-11, aucun invariant ne nomme l'accessibilité.

## Ce que la brique ferme

- Une promesse reformulée par le site : I-29 ne fait des surfaces publiques que des projections, et la construction échoue sans la projection de marque.
- Une page qui appelle un tiers ou ne se lit pas sans JavaScript : la suite le refuse.

## Ce qu'elle ne fait pas

- Elle ne dresse pas la liste des produits : sans PUB-02, le générateur n'a pas d'univers à couvrir.
- Elle ne possède pas la promesse : sans PUB-07, la page d'accueil n'a pas de texte de marque.
- Elle ne se déploie pas seule : ADR-0035 exige un commit immuable, un environnement choisi par le propriétaire et un test de fumée.

## Mesure

Preuves citées : le générateur du site et sa suite de bout en bout, épinglés à un commit de `project-website`. La suite refuse toute violation `serious` ou `critical` relevée par axe aux étiquettes WCAG 2.2 AA. À ce commit, le générateur ne reçoit que la copie de marque française, et la suite ne porte pas l'assertion qu'I-37 demande. Une page produit n'y affiche ni exposition ni maturité : la décision locale 0003 du dépôt porteur écrit que le site diverge de son autorité. L'application d'I-15 n'est donc pas montrée, ni une conformité RGAA, ni un déploiement, ni un parcours par public.

Prochaine preuve : une déclaration d'accessibilité RGAA publiée avec son audit, sur une release fumée selon ADR-0035.
