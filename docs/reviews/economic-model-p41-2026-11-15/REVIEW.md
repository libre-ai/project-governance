<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Modèle économique commun (ADR-0066) et scission de P15 (ADR-0067) : quatre passes de revue

**Date :** 2026-11-15
**Objet :** les deux ADR proposés `docs/adr/0066-economic-model-hosted-service-only.md` et `docs/adr/0067-amend-adr-0042-p15-split-p41-tickets.md`, les lignes D109 à D113 du registre (et D114, inscrite après la passe 4 et relue par aucune), les fiches `ecosystem/produits/P15.v1.yaml` et `ecosystem/produits/P41.v1.yaml`, et les documents que ces ADR amendent.
**Nature :** dossier de revue d'une pull request écrite par des agents. Il ne vaut pas arbitrage du propriétaire : il rend compte de ce qui a été relu, sur quel commit, de ce qui a été corrigé ensuite, et de ce qui reste à relire.
**État :** les passes 1, 2 et 3 ont rendu `reject`. Le verdict du dossier est celui de la passe 4 : `approve-with-minor-reservations`. Ce verdict porte sur le commit `7592bfc7330423e7d620b9559c7943e1896a17e8`. Deux commits l'ont suivi, qu'aucune passe n'a relus : celui qui inscrit la passe 4, puis celui qui inscrit les confirmations du propriétaire du 2026-11-15 et la décision D114 (voir « Après la passe 4 : confirmations du propriétaire »). Des trois réserves mineures que la passe 4 laissait ouvertes, ces confirmations lèvent M1 et M4 ; la moitié de R2 restée ouverte n'est pas confirmée, et se tranche à la signature.

## Les passes

| Passe | Identifiant | Mode | Commit relu | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `economic-model-p41-pass-1` | revue seule, relecteur indépendant à contexte neuf | `e0c2832e74e09139c2a560a95fca90642b8e7418` | `reject` : 6 constats à corriger, 8 mineurs |
| 2 | `economic-model-p41-pass-2` | revue seule, relecteur indépendant à contexte neuf, distinct de l'auteur des corrections | `5615d556a27ba590b76327141338f33db7414005` | `reject` : 1 constat à corriger, 5 mineurs |
| 3 | `economic-model-p41-pass-3` | revue seule du seul diff postérieur à la passe 2, relecteur indépendant à contexte neuf | `a60cac27e92cb87fc2ecb3d43018d9c59db40e9b` | `reject` : 2 constats à corriger, 3 mineurs |
| 4 | `economic-model-p41-pass-4` | revue seule du seul diff postérieur à la passe 3, relecteur indépendant à contexte neuf | `7592bfc7330423e7d620b9559c7943e1896a17e8` | `approve-with-minor-reservations` : 3 mineurs |

Le commit relu par la passe 1 est un commit de la branche de travail ; la fusion par squash ne le garde pas.

Ce que ce dossier ne sait pas de la passe 1 : son rapport complet n'est pas versionné ici, et l'auteur des corrections n'a reçu que les constats, par son mandat. Les commandes rejouées par le relecteur, les empreintes qu'il a relevées et les identifiants d'agent, de session et de modèle ne lui ont pas été transmis. Ils manquent donc à ce dossier, alors que le protocole (`docs/reviews/AGENT-REVIEW-PROTOCOL.md`, « Attributable review record ») les demande.

## Passe 1 : les 14 constats, et ce qui a suivi

Les gravités sont celles du relecteur. « Corrigé » veut dire : modifié par l'auteur des corrections après la passe 1. La passe 2 a relu ces corrections.

| N° | Gravité | Constat | Suite |
| --- | --- | --- | --- |
| 1 | à corriger | ADR-0066 annonce quatre choix du propriétaire et ne cite que trois libellés ; D4 (D112) porte un marqueur d'arbitrage sans libellé. | Corrigé : le libellé « Nommer le verrou » et sa conséquence sont cités dans la ligne d'arbitrage, dans D4 et dans la table « Source » d'ADR-0066, dans D112 et dans le marqueur du corps de la pull request. |
| 2 | à corriger | Le contenu de D1 et de D2 dépasse les libellés cités ; les deux consignes antérieures sont citées sans date. | Corrigé : chaque décision d'ADR-0066 donne d'abord le texte retenu, mot pour mot, puis les ajouts de l'auteur sous « lecture de l'auteur, à confirmer à la signature ». L'interdit ajouté sort de « N'autorise pas ». Les deux consignes sont datées (commentaires du 2026-11-15 sur la page de relecture du catalogue, fiches P02 et P04) et dites non versionnées. D110, `docs/positioning/non-goals.md` et la fiche `EXP-08` sont alignés. |
| 3 | à corriger | Deux invariants cités pour ce qu'ils ne disent pas : I-10 (« toute exportation reste possible ») et I-29 (« la possession ne signifie pas la gratuité de l'infrastructure »). | Corrigé : I-10 et I-29 sont cités pour leur texte ; la phrase sur la gratuité de l'infrastructure est rendue à ADR-0033 D1. |
| 4 | à corriger | ADR-0067 range ADR-0055 D2 (« P15 n'est pas scindé. ») sous « Ne modifie pas », par une lecture de l'auteur. | Corrigé : D2 est inscrit sous « Amende », avec sa relecture explicite, marquée lecture de l'auteur ; D113 le dit aussi. |
| 5 | à corriger | L'intitulé de P41, « projets, tickets et support », est une déduction de l'auteur, présentée comme décidée. | Corrigé : le numéro P41, son intitulé et l'intitulé de P15 sont déclarés propositions de l'auteur dans ADR-0067, D113 et le corps de la pull request ; `intitule` entre dans `a_relire` sur les deux fiches, ce que le gate accepte. |
| 6 | à corriger | Le protocole de revue n'est pas satisfait : aucun dossier sous `docs/reviews/`. | Corrigé en deux temps : ce dossier a d'abord consigné la passe 1 et les textes retenus, puis les passes 2 à 4. Ce qui lui manque encore au regard du protocole est dit plus haut et dans « Ce que ce dossier ne couvre pas ». |
| 7 | mineur | La formule « Sans frais chez vous » face à ADR-0033 et à I-29. | Corrigé : la formule est gardée ; ADR-0066 D3 écrit que la condition l'accompagne toujours et que « Sans frais » ne s'emploie jamais seul, comme lecture de l'auteur à confirmer. |
| 8 | mineur | ADR-0067 affirme que le nombre de produits « n'est écrit dans aucun document » ; ADR-0064 l'écrit. | Corrigé : la phrase est retirée ; ADR-0067 dit qu'il n'écrit pas ce nombre, et nomme les endroits où ADR-0064 l'écrit. |
| 9 | mineur | ADR-0064 dit « P01 à P41 » à un endroit et « quarante » ou « 40 produits » à quatre autres. | Corrigé par clause de lecture : ADR-0067, « Lecture d'ADR-0064 », traite les cinq endroits un par un (un modifié en place, trois lus autrement, un laissé comme état daté). |
| 10 | mineur | Les ADR amendés ne portent pas la mention « Amendé par ». | Corrigé : ADR-0054 (par ADR-0066), ADR-0055 et ADR-0064 (par ADR-0067) la portent dans leur ligne de statut, selon la forme d'ADR-0042 et d'ADR-0044. |
| 11 | mineur | Des mesures sont périmées par la fusion de #187. | Corrigé : la branche servie est fusionnée dans la branche de travail ; les comptes (fiches portant « par abonnement », champs `a_relire`) sont repris après cette fusion dans ADR-0066 et dans le corps de la pull request. |
| 12 | mineur | Le corps de la pull request dit que la CI n'a pas tourné. | Corrigé dans le corps de la pull request, qui dit l'état relevé après la dernière poussée. |
| 13 | mineur | `P41.v1.yaml` : une limite a « Un agent » pour sujet, et non le produit. | Corrigé : la limite a le produit pour sujet, sous la forme « Ne … pas ». |
| 14 | mineur | « La relève en continu », propre à un lecteur de flux, figure dans une règle commune à tous les produits. | Corrigé : le texte retenu est cité tel quel ; la règle d'ADR-0066 D1 et D109 disent que ce sont des exemples, et que celui-là est celui d'un lecteur de flux. |

## Passe 2

Relecteur indépendant à contexte neuf, distinct de l'auteur et de l'auteur des corrections. Commit relu : `5615d556a27ba590b76327141338f33db7414005`. Verdict : `reject`, pour un constat à corriger. Les 14 constats de la passe 1 sont relus : 13 corrigés et justes, le constat 6 partiel tant que cette passe n'était pas inscrite ici.

Commandes rejouées par le relecteur sur ce commit, toutes `pass` : `bun install --frozen-lockfile`, `bun run check:produits` (41 produits = 41 fiches, 36 champs `a_relire` sur 18 fiches), `bun run check:briques`, `bun run check:doctrine`, `bun run build:vision` suivi d'un `git status --short` vide, `bun test ecosystem/ distribution/build-vision.test.ts` (1009 pass, 0 fail). Elles ont tourné sous Bun 1.4.4, pas sous la révision épinglée. CI sur ce commit : 15 verts, 1 rouge, « Index freshness and GitHub reconciliation », rouge aussi sur la tête de la branche servie `275ed6277580fb65b99e8ae6b625770ecbe13d12`.

| N° | Gravité | Constat | Suite donnée après la passe |
| --- | --- | --- | --- |
| A1 | à corriger | La ligne D109 du registre écrit comme arbitré « aucune fonction n'est réservée à l'offre payante », qu'ADR-0066 range sous lecture de l'auteur. | Corrigé : D109 porte le même marqueur que D110, D111 et D113, et cite l'option écartée. |
| M1 | mineur | La même lecture est écrite sans marqueur dans les non-objectifs, la brique EXP-08, `vision.md`, la mention « Amendé par » d'ADR-0054 et le titre d'ADR-0066. | Non corrigé, réserve ouverte. La question posée et l'option écartée, reproduites plus bas, la soutiennent ; le mot pour mot n'y est pas. À confirmer à la signature. |
| M2 | mineur | ADR-0066 ajoute à I-10 et à I-17 deux gloses qui ne sont pas dans leur texte. | Corrigé : les deux gloses sont séparées du texte des invariants et marquées lecture de l'auteur. |
| M3 | mineur | Le tableau de lecture d'ADR-0067 donne pour ADR-0064 D1 le texte d'après modification, et le texte d'avant pour les autres lignes. | Corrigé : la cellule donne le texte d'avant et son remplacement. |
| M4 | mineur | La brique PRD-15 et la mention « Amendé par » d'ADR-0042 écrivent l'intitulé de P15 et l'attribution à P41 comme acquis. | Non corrigé, réserve ouverte : ADR-0067 les dit propositions de l'auteur, et la signature les tranche. |
| M5 | mineur | Ce dossier disait encore « passe 2 à faire ». | Corrigé par la présente section. |

Ce que la passe 2 n'a pas pu vérifier : la fidélité des textes retenus à la page de décision, qui n'est pas versionnée ; le relevé des sept lecteurs de flux cité par ADR-0066, sans source versionnée ; les contrôles sous la révision de Bun épinglée.

## Passe 3

Relecteur indépendant à contexte neuf, sans continuité avec la passe 2. Il a relu le seul diff entre `5615d556a27ba590b76327141338f33db7414005` et `a60cac27e92cb87fc2ecb3d43018d9c59db40e9b`. Verdict : `reject`. A1 est corrigé pour la phrase visée, M2 et M3 sont corrigés. Commandes rejouées, toutes `pass` sous Bun 1.4.4 : `bun install --frozen-lockfile`, `bun run check:doctrine`, `bun run check:produits`, et le gate de revue appelé comme la CI l'appelle.

| N° | Gravité | Constat | Suite donnée après la passe |
| --- | --- | --- | --- |
| C1 | à corriger | D109 écrivait encore sans marqueur que les mêmes fonctions valent « sur l'instance qu'on héberge soi-même et sur l'offre hébergée », qu'ADR-0066 range sous lecture de l'auteur. | Corrigé : D109 cite « Mêmes fonctions partout » et marque ce que « partout » couvre comme lecture de l'auteur. |
| C2 | à corriger | Trois phrases de ce dossier étaient fausses : il disait ne pas couvrir la passe 2, disait les corrections non relues, et attribuait la passe 3 au relecteur de la passe 2. | Corrigé : les trois phrases sont réécrites. |
| N1 | mineur | Les deux options écartées de la première question sont citées sans dire par quel canal elles sont arrivées. | Corrigé : le canal est dit au-dessus du tableau des textes retenus. |
| N2 | mineur | D109 disait « l'option écartée » au singulier. | Corrigé. |
| N3 | mineur | Une virgule fautive dans la ligne « Invariants » d'ADR-0066. | Corrigé. |

## Passe 4

Relecteur indépendant à contexte neuf, sur le seul diff entre `a60cac27e92cb87fc2ecb3d43018d9c59db40e9b` et `7592bfc7330423e7d620b9559c7943e1896a17e8`. Verdict : `approve-with-minor-reservations` ; c'est le verdict de ce dossier. C1, C2, N1, N2 et N3 sont relus corrigés. Commandes rejouées, en code 0 sous Bun 1.4.4 : `bun install --frozen-lockfile`, `bun run check:doctrine`, `bun run check:produits`.

| N° | Gravité | Constat | Suite donnée après la passe |
| --- | --- | --- | --- |
| R1 | mineur | Une phrase de la ligne 6 du tableau de la passe 1 disait encore « la passe 2 reste à faire ». | Corrigé. |
| R2 | mineur | D109 écrivait sans marqueur « liste non fermée » et « pour un lecteur de flux », et paraphrasait « On paie l'hébergement géré ». ADR-0066 D1 écrit la même glose hors de son bloc de lecture de l'auteur. | Corrigé dans D109, qui cite le texte retenu et marque la glose. Non corrigé dans ADR-0066 D1 : réserve ouverte. |
| R3 | mineur | Ce dossier disait le canal des options écartées « sous le tableau » ; il est au-dessus. | Corrigé. |

Le commit qui porte ces trois corrections et le verdict de la passe 4 n'a été relu par aucune passe.

## Après la passe 4 : confirmations du propriétaire

Le 2026-11-15, après la passe 4, le propriétaire a répondu à six questions à options posées dans la session de l'agent qui tient la pull request. Cinq confirment ou corrigent des lectures de l'auteur ; la sixième est une décision nouvelle. Les libellés retenus et leurs conséquences sont reproduits plus bas, sous « Confirmations du 2026-11-15 ». Ces questions ne sont pas versionnées : ce dossier ne peut pas plus les confronter à leur source que les textes de la page de décision.

**Ce commit n'a été relu par aucune passe.** Il est le fils de `ed6a71c7b14ecbb0b2b7e585d814ec6862c570b9`, lui-même non relu. Les verdicts des quatre passes, et les tableaux qui les rapportent, ne sont pas modifiés : ils décrivent l'état relu, où ces phrases étaient marquées « à confirmer ».

Ce qui a changé :

| Objet | Avant | Après |
| --- | --- | --- |
| ADR-0066 D1, D109 | « partout » et « aucune fonction n'est réservée à l'offre payante » : lecture de l'auteur | arbitré, « Oui, aucune fonction réservée » |
| ADR-0066 D2, D110 | où un produit déclare son offre, et ce qui vaut avant : lecture de l'auteur (« l'ADR qui fixe sa première version ») | arbitré, « Dans son ADR » ; la précision « qui fixe sa première version » est retirée, la confirmation ne la porte pas |
| ADR-0066 D3, D111 | « Sans frais » jamais seul : lecture de l'auteur | arbitré, « Jamais sans sa condition » |
| ADR-0066 D5, D114 | « non décidé » : la distribution signée de P02 se paie-t-elle | décision nouvelle, « Sans frais » ; amende D81 sur ce point ; ADR-0054 le dit dans sa mention « Amendé par » |
| ADR-0066, ligne « Invariants » | deux gloses marquées, sur I-10 et sur I-17 | celle sur I-17 est couverte par « Dans son ADR » ; celle sur I-10 reste marquée |
| ADR-0067 D1, D113 | numéro P41, intitulés de P41 et de P15 : propositions de l'auteur ; catégorie : hypothèse de l'auteur | arbitré, « Tout confirmer », nom provisoire « Tickets » compris |
| ADR-0067, relecture d'ADR-0055 D2, D113 | lecture de l'auteur | arbitré, « Oui, amender avec cette relecture » |
| Fiche de P41 | 12 champs dans `a_relire` | 9 : `intitule`, `nom_provisoire` et `categorie` en sortent |
| Fiche de P15 | 8 champs dans `a_relire` | 7 : `intitule` en sort |

Ce que ces confirmations font des trois réserves ouvertes :

| Réserve | Suite |
| --- | --- |
| M1 | Levée. La lecture écrite sans marqueur dans les non-objectifs, la brique EXP-08, `vision.md`, la mention « Amendé par » d'ADR-0054 et le titre d'ADR-0066 est celle que « Oui, aucune fonction réservée » confirme. Ces textes ne sont pas modifiés pour cela. |
| M4 | Levée. L'intitulé de P15 et l'attribution de « projets, tickets et support » à P41, écrits comme acquis dans la brique PRD-15 et dans la mention « Amendé par » d'ADR-0042, sont ceux que « Tout confirmer » acte. |
| R2, moitié ouverte | Non levée. Aucune des six réponses ne dit que « synchronisation, relève en continu, sauvegardes » sont des exemples. Ce commit déplace la glose d'ADR-0066 D1 sous un bloc « lecture de l'auteur, à confirmer à la signature », comme D109 la marquait déjà : la forme est corrigée, le fond reste à confirmer. |

Ce que ces confirmations ne couvrent pas, et qui reste marqué lecture de l'auteur : dans ADR-0066, les exemples d'hébergement géré (D1), la portée de « Sans frais chez vous » et de « produits concernés » (D3), les deux lectures ajoutées à D5 (les plans et quotas de D87 portent sur le service hébergé ; une mention publique de ce « sans frais » porte sa condition), et la glose sur I-10.

Trois conséquences affichées nomment un gate, et la deuxième un champ « offre » des fiches. Aucun n'existe dans ce dépôt le 2026-11-15, et ce commit n'en écrit aucun : ADR-0066 les range sous « Ce qui n'est pas décidé ici ».

Commandes rejouées par l'auteur de ce commit, et non par un relecteur, sous la même version de Bun que les passes : celles de la passe 2. Leur sortie est dans le corps de la pull request.

## Textes retenus par le propriétaire le 2026-11-15

La page de décision n'est pas versionnée. Ces textes sont ceux que l'auteur des corrections a reçus par son mandat ; il n'a pas lu la page. Ils sont reproduits ici pour qu'un lecteur du dépôt puisse confronter les deux ADR à ce qui a été retenu. Après la passe 2, l'agent qui tient la page de décision a transmis les options écartées de la première question ; elles ne sont pas plus vérifiables depuis ce dépôt que les textes retenus. Les deux options écartées étaient « Le service et des fonctions avancées » (« Certaines fonctions sont réservées à l'offre hébergée payante. ») et « Produit par produit ». Les options écartées des autres questions n'ont pas été transmises.

| Décision | Question posée | Libellé retenu | Conséquence affichée sous ce libellé |
| --- | --- | --- | --- |
| ADR-0066 D1 (D109) | « Fait-on payer le service, ou aussi des fonctions ? » | « Le service seulement » | « Mêmes fonctions partout. On paie l'hébergement géré : synchronisation, relève en continu, sauvegardes. Les limites de l'offre hébergée portent sur ce qui coûte : volume, fréquence, durée d'archive. » |
| ADR-0066 D2 (D110) | « Quels produits ont une offre hébergée ? » | « Ceux qui entrent en développement » | « P02 et P04 aujourd'hui. Chaque nouveau produit dit s'il en a une au moment où il démarre. Les non-objectifs restent vrais. » |
| ADR-0066 D3 (D111) | « Comment le dire sur le site et dans les fiches ? » | « "Sans frais chez vous. Abonnement si nous l'hébergeons." » | « Dit la condition. Conforme à la règle de marque. Vaut pour tous les produits concernés. » |
| ADR-0066 D4 (D112) | « "Par abonnement" dans "À la place de" : on garde ? » | « Nommer le verrou » | « Chaque fiche dit ce que la catégorie fait payer ou enferme. Je propose les six formules sur une prochaine page. » |
| ADR-0067 D1 (D113) | non transmise | « Deux produits » | « P15 garde la capture et le relais ; un nouveau produit porte l'outil de tickets. » |

Le « six » de la quatrième conséquence était une erreur de la page : 25 fiches portaient « par abonnement » sur le commit relu par la passe 1 (`git grep -l "par abonnement" e0c2832 -- 'ecosystem/produits/*.yaml' | wc -l`).

### Confirmations du 2026-11-15, après la passe 4

Canal : des questions à options posées au propriétaire dans la session de l'agent qui tient la pull request, et non la page de décision. Ces questions ne sont pas versionnées. L'auteur du commit qui les inscrit a reçu par son mandat chaque question sous forme résumée, et le libellé retenu et sa conséquence mot pour mot : la colonne « Question » donne un résumé, pas le texte posé. Les options écartées n'ont pas été transmises.

| Décision | Question (résumée) | Libellé retenu | Conséquence affichée sous ce libellé |
| --- | --- | --- | --- |
| ADR-0066 D1 (D109) | Lecture de « Mêmes fonctions partout » | « Oui, aucune fonction réservée » | « Jamais de fonction payante. Seuls l'hébergement géré et ses quotas (volume, fréquence, durée d'archive) se paient. Le gate des fiches pourra s'y appuyer. » |
| ADR-0066 D2 (D110) | Où un produit déclare son offre hébergée | « Dans son ADR » | « Une trace signée par produit. Sans elle, pas d'offre hébergée et le gate refuse le champ "offre". P02 et P04 sont déjà couverts. » |
| ADR-0066 D3 (D111) | « Sans frais » | « Jamais sans sa condition » | « Toute mention porte "chez vous" ou l'équivalent. Vérifiable par un gate sur le site et dans les fiches. » |
| ADR-0067 D1 (D113) | Noms de la scission : numéro P41, intitulé « projets, tickets et support », nom provisoire « Tickets », catégorie Collaboration ; pour P15, intitulé « capture et relais de signalements » | « Tout confirmer » | « Numéro, intitulés, nom provisoire et catégorie sont actés. Le contenu de la fiche P41 (12 champs) reste marqué à relire. » |
| ADR-0067, relecture d'ADR-0055 D2 (D113) | Relecture de « P15 n'est pas scindé. » | « Oui, amender avec cette relecture » | « L'ancienne phrase reste dans l'histoire ; l'ADR-0067 dit comment la lire. Rien d'autre ne change. » |
| ADR-0066 D5 (D114), décision nouvelle | L'application signée et notarisée de P02 (ADR-0054 §4, D81) se paie-t-elle ? | « Sans frais » | « L'application signée se télécharge sans frais ; seul le service hébergé se paie. Cohérent avec "aucune fonction réservée". À écrire dans l'ADR-0066 avant fusion. » |

Le « 12 champs » de la quatrième conséquence compte la liste `a_relire` de la fiche de P41 avant que trois des champs confirmés en sortent : il en reste 9.

Deux commentaires du propriétaire, écrits le même jour sur une autre page non versionnée, la page de relecture du catalogue, sont cités dans le « Contexte » d'ADR-0066 : l'un sur la fiche de P02, l'autre sur celle de P04. La décision les remplace.

## Ce que ce dossier ne couvre pas

- **Une relecture d'ensemble après la passe 2.** Les passes 3 et 4 ne relisent que le diff postérieur à la passe qui les précède.
- **Les sources.** Ni la page de décision ni la page de relecture du catalogue ne sont dans ce dépôt. Un tiers peut confronter les ADR aux textes reproduits ci-dessus ; il ne peut pas confronter ces textes aux pages.
- **Le rapport de la passe 1.** Seuls ses constats sont résumés ici, un par ligne.
- **La version de Bun.** Les contrôles locaux nommés dans le corps de la pull request ont tourné sous une version de Bun qui n'est pas la révision épinglée ; la CI juge sous la révision épinglée.

## Ce qui reste au propriétaire

- **Les « lectures de l'auteur » qui restent marquées** dans ADR-0066 : les exemples d'hébergement géré (D1), la portée de « Sans frais chez vous » et de « produits concernés » (D3), les deux lectures de D5, la glose sur I-10. ADR-0067 n'en porte plus.
- **Les champs `a_relire` des deux fiches** : 9 sur celle de P41, 7 sur celle de P15.
- **Une relecture du commit des confirmations**, qu'aucune passe n'a relu.
- **Les formules de `a_la_place_de`**, que le texte retenu renvoie à une page suivante.
- **L'acceptation de la fusion**, qui vaut signature des deux ADR.
