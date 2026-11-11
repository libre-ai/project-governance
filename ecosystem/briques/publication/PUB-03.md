# PUB-03 — Site par public, bilingue, RGAA

## Contexte

I-05 fait du site une application qui sert des projections. ADR-0033 le range parmi les consommateurs de projections épinglées par sha, et l'exige statique, sans JavaScript client ni requête externe. Le dépôt `project-website` porte un générateur statique, une page d'accueil par langue et une suite de bout en bout. Son contenu est dérivé d'instantanés épinglés des fiches de projet et de la projection de marque. Son README dit que ce n'est pas un service déployé. Aucun invariant ne porte l'accessibilité.

## Ce que la brique ferme

- Une promesse reformulée par le site : I-29 n'y admet qu'une projection de la marque.
- Une vitrine sans rien de vérifiable derrière elle (I-15).
- Une page servie sans les en-têtes de sécurité de la flotte, ou avec un sink HTML brut (I-37).

## Ce qu'elle ne fait pas

- Elle ne saisit aucun état de produit : elle lit le catalogue, PUB-02.
- Elle ne possède ni la promesse ni la voix, qui restent à PUB-07.
- Elle ne se déploie pas seule : ADR-0035 exige un candidat immuable, un environnement choisi par le propriétaire et un test de fumée.
- Elle ne porte pas l'accessibilité des produits, rangée sous PLT-07.

## Mesure

Preuves citées : le générateur du site et sa suite de bout en bout, épinglés au commit du dépôt porteur. La suite refuse toute violation `serious` ou `critical` relevée par axe au niveau WCAG 2.2 AA, toute requête hors origine et toute page illisible sans JavaScript. Elle ne montre ni une conformité RGAA, ni un déploiement, ni un parcours par public.

Prochaine preuve : une déclaration d'accessibilité RGAA publiée avec son audit, sur une release fumée selon ADR-0035.
