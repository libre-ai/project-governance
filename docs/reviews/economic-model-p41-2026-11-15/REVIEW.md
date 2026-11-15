<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Modèle économique commun (ADR-0066) et scission de P15 (ADR-0067) : une passe de revue rendue, une passe à faire

**Date :** 2026-11-15
**Objet :** les deux ADR proposés `docs/adr/0066-economic-model-hosted-service-only.md` et `docs/adr/0067-amend-adr-0042-p15-split-p41-tickets.md`, les lignes D109 à D113 du registre, les fiches `ecosystem/produits/P15.v1.yaml` et `ecosystem/produits/P41.v1.yaml`, et les documents que ces ADR amendent.
**Nature :** dossier de revue d'une pull request écrite par des agents. Il ne vaut pas arbitrage du propriétaire : il rend compte de ce qui a été relu, sur quel commit, de ce qui a été corrigé ensuite, et de ce qui reste à relire.
**État :** ce dossier ne porte **aucun verdict final**. La passe 1 a rendu `reject`. Les corrections qui suivent n'ont pas été relues : la passe 2 est à faire.

## Les passes

| Passe | Identifiant | Mode | Commit relu | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `economic-model-p41-pass-1` | revue seule, relecteur indépendant à contexte neuf | `e0c2832e74e09139c2a560a95fca90642b8e7418` | `reject` : 6 constats à corriger, 8 mineurs |
| 2 | à attribuer | revue seule, par un relecteur distinct de l'auteur des corrections | à faire sur le commit final de la branche | à faire |

Le commit relu par la passe 1 est un commit de la branche de travail ; la fusion par squash ne le garde pas.

Ce que ce dossier ne sait pas de la passe 1 : son rapport complet n'est pas versionné ici, et l'auteur des corrections n'a reçu que les constats, par son mandat. Les commandes rejouées par le relecteur, les empreintes qu'il a relevées et les identifiants d'agent, de session et de modèle ne lui ont pas été transmis. Ils manquent donc à ce dossier, alors que le protocole (`docs/reviews/AGENT-REVIEW-PROTOCOL.md`, « Attributable review record ») les demande.

## Passe 1 : les 14 constats, et ce qui a suivi

Les gravités sont celles du relecteur. « Corrigé » veut dire : modifié par l'auteur des corrections après la passe 1, et **non relu**.

| N° | Gravité | Constat | Suite |
| --- | --- | --- | --- |
| 1 | à corriger | ADR-0066 annonce quatre choix du propriétaire et ne cite que trois libellés ; D4 (D112) porte un marqueur d'arbitrage sans libellé. | Corrigé : le libellé « Nommer le verrou » et sa conséquence sont cités dans la ligne d'arbitrage, dans D4 et dans la table « Source » d'ADR-0066, dans D112 et dans le marqueur du corps de la pull request. |
| 2 | à corriger | Le contenu de D1 et de D2 dépasse les libellés cités ; les deux consignes antérieures sont citées sans date. | Corrigé : chaque décision d'ADR-0066 donne d'abord le texte retenu, mot pour mot, puis les ajouts de l'auteur sous « lecture de l'auteur, à confirmer à la signature ». L'interdit ajouté sort de « N'autorise pas ». Les deux consignes sont datées (commentaires du 2026-11-15 sur la page de relecture du catalogue, fiches P02 et P04) et dites non versionnées. D110, `docs/positioning/non-goals.md` et la fiche `EXP-08` sont alignés. |
| 3 | à corriger | Deux invariants cités pour ce qu'ils ne disent pas : I-10 (« toute exportation reste possible ») et I-29 (« la possession ne signifie pas la gratuité de l'infrastructure »). | Corrigé : I-10 et I-29 sont cités pour leur texte ; la phrase sur la gratuité de l'infrastructure est rendue à ADR-0033 D1. |
| 4 | à corriger | ADR-0067 range ADR-0055 D2 (« P15 n'est pas scindé. ») sous « Ne modifie pas », par une lecture de l'auteur. | Corrigé : D2 est inscrit sous « Amende », avec sa relecture explicite, marquée lecture de l'auteur ; D113 le dit aussi. |
| 5 | à corriger | L'intitulé de P41, « projets, tickets et support », est une déduction de l'auteur, présentée comme décidée. | Corrigé : le numéro P41, son intitulé et l'intitulé de P15 sont déclarés propositions de l'auteur dans ADR-0067, D113 et le corps de la pull request ; `intitule` entre dans `a_relire` sur les deux fiches, ce que le gate accepte. |
| 6 | à corriger | Le protocole de revue n'est pas satisfait : aucun dossier sous `docs/reviews/`. | Partiel : ce dossier consigne la passe 1 et les textes retenus. La passe 2 reste à faire ; tant qu'elle ne l'est pas, le protocole n'est pas satisfait. |
| 7 | mineur | La formule « Sans frais chez vous » face à ADR-0033 et à I-29. | Corrigé : la formule est gardée ; ADR-0066 D3 écrit que la condition l'accompagne toujours et que « Sans frais » ne s'emploie jamais seul, comme lecture de l'auteur à confirmer. |
| 8 | mineur | ADR-0067 affirme que le nombre de produits « n'est écrit dans aucun document » ; ADR-0064 l'écrit. | Corrigé : la phrase est retirée ; ADR-0067 dit qu'il n'écrit pas ce nombre, et nomme les endroits où ADR-0064 l'écrit. |
| 9 | mineur | ADR-0064 dit « P01 à P41 » à un endroit et « quarante » ou « 40 produits » à quatre autres. | Corrigé par clause de lecture : ADR-0067, « Lecture d'ADR-0064 », traite les cinq endroits un par un (un modifié en place, trois lus autrement, un laissé comme état daté). |
| 10 | mineur | Les ADR amendés ne portent pas la mention « Amendé par ». | Corrigé : ADR-0054 (par ADR-0066), ADR-0055 et ADR-0064 (par ADR-0067) la portent dans leur ligne de statut, selon la forme d'ADR-0042 et d'ADR-0044. |
| 11 | mineur | Des mesures sont périmées par la fusion de #187. | Corrigé : la branche servie est fusionnée dans la branche de travail ; les comptes (fiches portant « par abonnement », champs `a_relire`) sont repris après cette fusion dans ADR-0066 et dans le corps de la pull request. |
| 12 | mineur | Le corps de la pull request dit que la CI n'a pas tourné. | Corrigé dans le corps de la pull request, qui dit l'état relevé après la dernière poussée. |
| 13 | mineur | `P41.v1.yaml` : une limite a « Un agent » pour sujet, et non le produit. | Corrigé : la limite a le produit pour sujet, sous la forme « Ne … pas ». |
| 14 | mineur | « La relève en continu », propre à un lecteur de flux, figure dans une règle commune à tous les produits. | Corrigé : le texte retenu est cité tel quel ; la règle d'ADR-0066 D1 et D109 disent que ce sont des exemples, et que celui-là est celui d'un lecteur de flux. |

## Passe 2

**À faire sur le commit final par un relecteur distinct.** Elle n'a pas eu lieu. Ce dossier n'en invente ni les constats ni le verdict.

Ce qu'elle doit relire au minimum : chaque ligne « Corrigé » du tableau ci-dessus ; la fidélité des citations d'ADR-0066 et d'ADR-0067 aux textes reproduits plus bas ; chaque « lecture de l'auteur », qui n'est pas arbitrée ; les mentions « Amendé par » ajoutées à trois ADR déjà fusionnés.

## Textes retenus par le propriétaire le 2026-11-15

La page de décision n'est pas versionnée. Ces textes sont ceux que l'auteur des corrections a reçus par son mandat ; il n'a pas lu la page. Ils sont reproduits ici pour qu'un lecteur du dépôt puisse confronter les deux ADR à ce qui a été retenu. Les options écartées n'ont pas été transmises.

| Décision | Question posée | Libellé retenu | Conséquence affichée sous ce libellé |
| --- | --- | --- | --- |
| ADR-0066 D1 (D109) | « Fait-on payer le service, ou aussi des fonctions ? » | « Le service seulement » | « Mêmes fonctions partout. On paie l'hébergement géré : synchronisation, relève en continu, sauvegardes. Les limites de l'offre hébergée portent sur ce qui coûte : volume, fréquence, durée d'archive. » |
| ADR-0066 D2 (D110) | « Quels produits ont une offre hébergée ? » | « Ceux qui entrent en développement » | « P02 et P04 aujourd'hui. Chaque nouveau produit dit s'il en a une au moment où il démarre. Les non-objectifs restent vrais. » |
| ADR-0066 D3 (D111) | « Comment le dire sur le site et dans les fiches ? » | « "Sans frais chez vous. Abonnement si nous l'hébergeons." » | « Dit la condition. Conforme à la règle de marque. Vaut pour tous les produits concernés. » |
| ADR-0066 D4 (D112) | « "Par abonnement" dans "À la place de" : on garde ? » | « Nommer le verrou » | « Chaque fiche dit ce que la catégorie fait payer ou enferme. Je propose les six formules sur une prochaine page. » |
| ADR-0067 D1 (D113) | non transmise | « Deux produits » | « P15 garde la capture et le relais ; un nouveau produit porte l'outil de tickets. » |

Le « six » de la quatrième conséquence était une erreur de la page : 25 fiches portaient « par abonnement » sur le commit relu par la passe 1 (`git grep -l "par abonnement" e0c2832 -- 'ecosystem/produits/*.yaml' | wc -l`).

Deux commentaires du propriétaire, écrits le même jour sur une autre page non versionnée, la page de relecture du catalogue, sont cités dans le « Contexte » d'ADR-0066 : l'un sur la fiche de P02, l'autre sur celle de P04. La décision les remplace.

## Ce que ce dossier ne couvre pas

- **La passe 2**, et donc tout verdict sur l'état corrigé.
- **Les sources.** Ni la page de décision ni la page de relecture du catalogue ne sont dans ce dépôt. Un tiers peut confronter les ADR aux textes reproduits ci-dessus ; il ne peut pas confronter ces textes aux pages.
- **Le rapport de la passe 1.** Seuls ses constats sont résumés ici, un par ligne.
- **La version de Bun.** Les contrôles locaux nommés dans le corps de la pull request ont tourné sous une version de Bun qui n'est pas la révision épinglée ; la CI juge sous la révision épinglée.

## Ce qui reste au propriétaire

- **Chaque « lecture de l'auteur »** d'ADR-0066 (ce que « partout » couvre, où un produit déclare son offre hébergée et ce qui vaut avant, la condition qui accompagne « Sans frais ») et d'ADR-0067 (la relecture d'ADR-0055 D2).
- **Le numéro et l'intitulé de P41, l'intitulé de P15**, propositions de l'auteur, et les champs `a_relire` des deux fiches.
- **Les formules de `a_la_place_de`**, que le texte retenu renvoie à une page suivante.
- **L'acceptation de la fusion**, qui vaut signature des deux ADR.
