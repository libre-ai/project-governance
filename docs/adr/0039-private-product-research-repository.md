# ADR-0039 — Recherche produit dans un dépôt administratif privé

- **Statut :** proposed — la fusion revue constitue la signature propriétaire.
- **Date :** 2026-09-11
- **Arbitrage :** le propriétaire a approuvé la conception à deux plans puis demandé l'intégration, la cohérence documentaire, la ratification et la préparation distante.
- **Trace :** Owner-arbitration: 2026-09-11
- **Introduit :** I-31 ; nom canonique `product-research`, rôle `administrative-private`.
- **Amende :** ADR-0008/ADR-0020 sur la topologie et ADR-0009 sur le périmètre du portfolio ; les deux autorités restent inchangées.

## Contexte

Les hypothèses, synthèses assainies et alternatives de recherche doivent être
conservées sans devenir de la doctrine ou des engagements commerciaux. Un dépôt
administratif privé les sépare des autorités publiques et du portfolio produit.

## Décisions

### D1 — Une exception nominative, hors portfolio

`libre-ai/product-research` appartient à l'organisation, reste privé, actif et
transverse, sous le seul rôle `administrative-private`. Il n'a ni fiche
`project.v1.yaml`, ni exposition, ni métrique publique de maturité. Tout autre nom,
rôle privé, couche, cycle de vie ou fiche pour cette catégorie est refusé par
l'inventaire. Les produits du portfolio conservent leur doctrine de visibilité.

L'inventaire public expose uniquement le nom, le rôle, la visibilité et la
frontière d'autorité ; aucun sujet, titre de recherche ou collaborateur n'est
projeté. `active` décrit la responsabilité de ce périmètre, pas une preuve de
création distante. Une entrée privée non observable est explicitement déclarée
non vérifiable par le contrôle public.

### D2 — Recherche et autorité restent distinctes

`governance` conserve doctrine, architecture, noms et index ; `contracts` conserve
les autorités de contrats. Une recherche `supported` reste réfutable. Une
promotion exige un artefact fusionné dans l'autorité concernée, référencé par
repository, chemin et SHA complet ; elle ne donne aucune autorité au dépôt privé.
Les alternatives rejetées sont conservées. Aucune promesse réglementaire,
certification ou rentabilité ne découle de l'existence d'une fiche.

### D3 — GitHub privé sous une frontière de contenu explicite

L'exception GitHub de forge couvre ici seulement des documents de travail
assainis classés `public` ou `internal`. Elle n'autorise ni données d'instance,
données personnelles, coordonnées, verbatims identifiants, documents client,
secrets, informations classifiées ou niveau `confidential`. Une preuve sensible
reste dans un coffre externe, référencée par identifiant opaque et empreinte.
GitHub n'est pas présenté comme un hébergement souverain.

Avant tout premier push privé : gouvernance ratifiée, visibilité et propriété
vérifiées, accès limités aux propriétaires nécessaires et exigence 2FA de
l'organisation vérifiée. Modifier cette exigence organisationnelle reste un acte
distinct car il peut retirer l'accès d'autres comptes. Les forks, issues, wiki,
discussions et Pages restent désactivés. Les tokens Actions sont en lecture ;
les actions sont autorisées par SHA ; les diagnostics n'exposent pas le contenu.
Le secret scanning est une défense supplémentaire lorsqu'il est disponible,
jamais le seul contrôle ni une preuve implicite.

Les contributions nouvelles portent un DCO ; documents et registres relèvent de
CC-BY-4.0, schémas et outillage d'Apache-2.0, sous REUSE. `main` exige une PR et
les contrôles réellement observés, sans suppression, force push ou contournement
administrateur. Le seuil d'approbation humaine est nul tant qu'un seul membre
humain est disponible ; la revue documentée et l'arbitrage restent obligatoires.

### D4 — Contrôles privés exécutés dans leur frontière

Les contrôles publics de contenu, contexte, dépendances, pins et protections
excluent le dépôt privé **avant** tout fetch et consignent l'exemption. Aucun
token transversal de lecture privée n'est ajouté aux workflows publics. Le dépôt
privé exécute ses propres contrôles de contenu, schémas, état, licences, contexte,
dépendances et paramètres distants ; un contrôle non observable reste non prouvé.

### D5 — Portabilité et limites d'acceptation

Markdown, JSON et Git natif gardent la recherche portable. Chaque état promu doit
être exporté en bundle complet chiffré avec manifeste et restauration vérifiée
sur deux supports indépendants dont au moins un stockage UE. La clé appartient
au propriétaire et reste hors GitHub. Un exercice avec une clé jetable ne vaut
pas acceptation de la sauvegarde durable ; cette opération reste à réaliser.

Ce dépôt est privé de manière durable, pas le staging temporaire d'I-30. Aucune
exposition publique n'est autorisée ici. Un changement futur de visibilité exige
une décision distincte et l'application complète d'I-30 avant divulgation.

## Alternatives rejetées

- Faire de `governance` le carnet de recherche : confondrait travail réfutable
  et autorité normative.
- Publier le contenu pour simplifier les contrôles de flotte : élargirait la
  divulgation sans besoin produit.
- Donner un token de lecture privée aux contrôles publics : élargirait leur
  surface d'accès et exposerait potentiellement contenu et logs.
- Chiffrer des documents confidentiels dans GitHub : ne satisfait pas la
  frontière de contenu et déplacerait le risque vers la gestion des clés.

## Preuves et retour arrière

Les tests de l'inventaire refusent chaque forme privée non admise ; les sélecteurs
et les notes d'exemption sont vérifiés. Les gates privés et les paramètres API
doivent être observés avant de déclarer le dépôt opérationnel. La création du
distant et sa sécurisation ne sont pas des faits acquis par cette ratification.

Une fermeture conserve l'historique chiffré et restaurable avant tout retrait.
Supprimer le dépôt, réécrire son historique ou changer sa visibilité exige un
acte explicite ; aucune de ces actions n'est un rollback automatique.
