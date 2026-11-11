# Distribution

Templates, projections de repositories, documentation, knowledge packs, SDK et supports d’acculturation.

Le sous-dossier `feeds/` contient les projections générées de l'évidence (changelog Markdown, feed JSON, feed Atom), produites par `distribution/build-feeds.ts` — jamais éditées à la main ; leur fraîcheur est garantie par le workflow `feeds-freshness`.

Le sous-dossier `vision/` contient la page vision (ADR-0064 D6) : `index.html` est généré par `distribution/build-vision.ts` depuis la carte des briques (`ecosystem/briques/`), et ne s'édite jamais à la main ; `vision.css` est écrit à la main. La page ne porte ni script ni style en ligne. Le générateur lance le gate de la carte et n'écrit rien si la carte a une violation. Le workflow `brick-map` régénère la page et échoue sur une dérive. Régénérer : `bun run build:vision`. Aucun site ne sert cette page : c'est un fichier de ce dépôt.
