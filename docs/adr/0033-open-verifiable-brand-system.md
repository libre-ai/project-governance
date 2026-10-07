# ADR-0033 — Système de marque ouvert et vérifiable

- **Statut :** proposed — plateforme et direction A approuvées par le propriétaire
  en session le 2026-09-09 ; le merge signé sous I-17 reste l'acte d'adoption
  doctrinale.
- **Date :** 2026-09-09
- **Portée :** plateforme verbale Libre AI, architecture de famille, sémantique
  visuelle, autorité des sources et conditions de publication des projections.
- **Étend :** ADR-0008 (nom et marque), ADR-0009 (portefeuille et preuve),
  ADR-0020 (autorités multi-repository).
- **Invariant candidat :** I-29.
- **Décision :** D39.
- **Numérotation :** renuméroté de 0032 à 0033 lors de l'intégration du
  2026-09-09, après ratification de l'ADR-0032 LangGraph sur `main`.

## Contexte

La constellation disposait d'un nom, d'un LEXICON, d'une doctrine de preuve et
d'états projetés, mais pas d'une plateforme de marque unique. Le site et le
profil d'organisation pouvaient donc reformuler indépendamment la proposition,
coder en dur un inventaire ou présenter « ouvert », « souverain » et
« explicable » sans mécanisme, date et limite adjacents.

La recherche de référence a confirmé un territoire utile sans justifier une
imitation : Trail démontre la force d'une idée traduite en système ; Proton la
cohérence d'une famille ; Mullvad la valeur d'une preuve proche de la promesse ;
Ink & Switch une posture de laboratoire ; Mozilla et Oxide une voix et une
matérialité d'ingénierie. Les signes distinctifs de ces références ne sont pas
repris.

Le propriétaire a choisi la direction A puis a renforcé son niveau de
provocation : l'adversaire n'est pas une entreprise, mais la relation de
dépendance créée lorsque le produit est accessible et sa fabrique reste fermée.

## Décisions

### D1 — La promesse oppose location du produit et possession de la fabrique

La tension canonique est :

> Les plateformes propriétaires vous louent le produit.

La promesse canonique est :

> Possédez la fabrique.

« Posséder » est rendu concret par l'inspection, la modification selon les
licences, le choix de déploiement pour ce qui est distribuable, la reprise des
données, la réversibilité et l'accès aux décisions et limites. Il ne signifie
ni gratuité de l'infrastructure, ni absence de dépendance, ni contrôle absolu.
La provocation vise le modèle fermé, jamais une entreprise, une communauté ou
une géographie.

### D2 — La preuve fait partie du produit

Une qualification publique transverse n'est publiable qu'avec, dans la même
unité de lecture :

1. l'affirmation ;
2. son mécanisme ;
3. une source HTTPS ;
4. une date de vérification calendaire ;
5. une limite non vide.

La matrice `brand/proof-matrix.md` porte les trois qualifications transverses.
Les états, maturités et dates des produits restent exclusivement dérivés de
leurs fiches `project.v1.yaml`. Une projection ne transforme jamais un état
prévu en capacité disponible.

### D3 — Une marque mère, une famille textuelle

`Libre AI` reste la seule marque mère. Le premier emploi public d'un produit est
`Libre AI <Product>`, avec `<Product>` issu du LEXICON. Un produit ne reçoit ni
micro-marque, ni promesse indépendante, ni couleur permanente assimilable à un
état.

### D4 — La fabrique ouverte gouverne le système visuel

Le concept est la **fabrique ouverte** ; son geste est l'**assemblage ouvert**.
Cadres interrompus, joints orthogonaux, lignes fonctionnelles et étiquettes de
preuve rendent les pièces et contrôles inspectables. Halos, cerveaux,
étincelles, orbites, chatbots, réseaux décoratifs et dégradés jade/iris sont
exclus.

La palette **Envol constructif** est adoptée : graphite chaud, jade minéral,
iris ardoise, états réservés à leur fonction. Le signe figuratif candidat est
le **Portique d'atelier** (`Workshop Gantry` en anglais), construit en trois
pièces orthogonales sur une grille de 24 unités, monochrome et lisible à 16 px.

### D5 — Les autorités restent unidirectionnelles

- `governance/brand/` possède la sémantique, la copie, la matrice de preuve et
  la projection JSON déterministe ;
- `ui` possède les tokens, la géométrie SVG, les composants et la licence des
  assets ;
- `website` et `.github` ne sont que des consommateurs de projections épinglées
  par SHA complet revu ;
- aucun texte public, asset ou état n'est une seconde autorité.

### D6 — La publication figurative a deux contrôles indépendants

Un signe candidat reste non publié jusqu'à l'acceptation propriétaire du texte
exact de `LicenseRef-Libre-AI-Brand-1.0` **et** l'archivage d'un contrôle de
similarité visuelle daté (EUIPO, INPI, WIPO et références nommées). Ce contrôle
est un screening visuel borné, pas un avis juridique ni un enregistrement.

Le site reste statique, sans JavaScript client, tracking, asset distant ou
requête runtime externe. Un merge doctrinal, la publication des assets, les
merges aval et le déploiement sont quatre actions externes séparées.

## Conséquences

- `brand/README.md` devient l'autorité française ; `brand/README.en.md` est sa
  traduction gouvernée ; `brand/projections/public-brand.v1.json` est généré et
  contrôlé contre les deux sources et la matrice de preuve.
- `@libre-ai/ui` réalise la direction adoptée sans posséder sa sémantique.
- Le site et le profil cessent de coder en dur un nombre de produits ou de
  reformuler la promesse.
- La projection de marque porte le nom public de chaque produit recensé ;
  `Libre AI Practices` conserve l'élision signée par le LEXICON, et les produits
  Carrière, Travel Agent et Website rejoignent explicitement la famille commune.
- Les claims absolus (« gratuit », supériorité totale, sécurité totale,
  explicabilité totale, absence de dépendance, contrôle absolu) restent
  interdits.
- Toute modification de la plateforme canonique demande un nouvel arbitrage ;
  une correction de rendu qui n'en change pas le sens reste une réalisation
  aval.

## Retour arrière

Avant publication, le retour arrière consiste à abandonner les branches
candidates : aucune surface publique ne change. Après publication, chaque
projection conserve son précédent SHA immuable ; le rollback repointe vers ce
SHA puis rejoue les gates de dérive, de sécurité et de rendu. Un rollback de
projection n'annule pas silencieusement I-29 : la doctrine doit être amendée par
la même surface propriétaire.
