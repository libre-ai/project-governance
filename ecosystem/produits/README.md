# Catalogue des produits

Ce dossier porte une fiche par produit du catalogue d'ADR-0042 §1. Une fiche dit ce que le produit doit faire, pour qui, ce qu'il ne fait pas, et de quels autres produits il dépend.

C'est la source de données du catalogue. Le site et la carte des briques (`ecosystem/briques/`) sont prévus pour la lire. Aucun des deux ne la lit encore.

Une fiche décrit une intention. Elle ne dit pas que le produit existe ni qu'il est utilisable.

## Forme

Un fichier par produit : `Pnn.v1.yaml`, au schéma `ecosystem/schemas/produit.v1.schema.json`. Le schéma est fermé : un champ qu'il ne déclare pas fait échouer le gate.

Les champs s'écrivent dans cet ordre. Tous sont obligatoires : une absence s'écrit `null` ou `[]`, elle ne s'omet pas.

| Champ | Sens |
| --- | --- |
| `schema_version` | Toujours `libre-ai.produit.v1`. |
| `id` | L'identifiant du produit dans le catalogue d'ADR-0042 §1. C'est aussi le nom du fichier. |
| `nom_public` | Le nom décidé pour le public, ou `null` tant qu'il n'est pas décidé. |
| `nom_provisoire` | Un nom de travail, ou `null` quand un nom public est décidé. |
| `intitule` | Le produit tel que le catalogue le désigne. |
| `fonction` | Le genre d'outil, en quelques mots. |
| `categorie` | Le domaine du catalogue, sous forme d'identifiant. |
| `promesse` | Ce que le produit doit apporter, en une phrase. |
| `pour_qui` | Les personnes à qui le produit est destiné. |
| `a_la_place_de` | Le genre d'outil que le produit doit remplacer. Aucune marque ni aucun service n'y est nommé. |
| `capacites` | Ce que le produit doit savoir faire. |
| `ne_fait_pas` | Ce que le produit ne fait pas, et les limites qu'il garde. |
| `depend_de` | Les autres produits sur lesquels celui-ci s'appuie, par identifiant. |
| `realisation` | La forme de la réalisation : `projet autonome`, `intégration`, `contribution à un projet existant`, `bibliothèque` ou `service`. |
| `depot` | Le dépôt porteur, écrit `libre-ai/<nom>`, ou `null`. |
| `etiquettes` | Trois libellés courts. |
| `a_relire` | Les champs de cette fiche qui restent à relire (voir plus bas). |

Chaque valeur de `categorie` correspond à un domaine d'ADR-0042 §1 :

| Domaine de l'ADR | `categorie` |
| --- | --- |
| Connaissance | `connaissance` |
| Bureautique et données | `bureautique-donnees` |
| Collaboration | `collaboration` |
| Création et publication | `creation-publication` |
| Médias et jeu | `medias-jeu` |
| Maîtrise des outils et des accès | `outils-acces` |
| Pédagogie collective | `pedagogie` |
| Poste de travail | `poste-de-travail` |

Cette correspondance est écrite une fois, dans `ecosystem/produits.ts`. Un test la compare à l'ADR et au schéma.

## Le sens de `a_relire`

`a_relire` liste les noms des champs de la fiche dont le contenu est une proposition d'un agent. Le propriétaire ne les a pas encore relus.

Un champ listé n'est pas faux. Il n'est pas encore validé. Quand le propriétaire a relu un champ, son nom sort de la liste. Une liste vide veut dire que toute la fiche est relue.

Le gate compte ces champs et imprime le total à chaque exécution.

## `depot`

`depot` nomme le dépôt qui porte le produit. Ce dépôt doit figurer à l'inventaire `ecosystem/repositories.v1.yaml`.

`null` veut dire que l'inventaire ne contient pas de dépôt porteur pour ce produit. Cela ne veut pas dire qu'aucun travail n'existe ailleurs.

## `depend_de`

`depend_de` relie des produits entre eux. Ce n'est pas un ordre de construction : deux produits peuvent se citer l'un l'autre. Une fiche ne se cite pas elle-même.

## Ce que le gate vérifie

```bash
git add <ce que tu as modifié> && bun run check:produits
```

Le gate lit ce que git suit. Un fichier non indexé ne fait pas partie du catalogue. Un lien symbolique est refusé. Une fiche modifiée sur le disque et non indexée est refusée aussi.

Ses règles :

- chaque fiche respecte le schéma ;
- `id` est égal au nom du fichier ;
- les fiches et le catalogue d'ADR-0042 §1 désignent exactement les mêmes produits. Un produit du catalogue sans fiche est un échec. Une fiche hors catalogue est un échec. Un identifiant déclaré par deux fichiers est un échec ;
- `categorie` correspond au domaine que l'ADR donne au produit ;
- un seul de `nom_public` et `nom_provisoire` est renseigné ;
- chaque identifiant de `depend_de` désigne une fiche qui existe, et pas la fiche elle-même ;
- `depot`, s'il est renseigné, est un dépôt de l'inventaire ;
- `etiquettes` compte exactement trois entrées ;
- chaque nom de `a_relire` est un champ du schéma.

La liste des produits n'est écrite nulle part dans le code. Le gate la lit dans l'ADR à chaque exécution. Un produit ajouté à l'ADR sans fiche fait donc échouer le gate.

Une source illisible est un échec, jamais un zéro : ADR absent, tableau du catalogue introuvable, inventaire absent, dossier sans fiche.

Le gate imprime ses compteurs, en succès comme en échec :

- produits du catalogue = produits avec fiche + produits sans fiche ;
- fiches lues = fiches valides + fiches en violation, avec le nombre de fiches hors catalogue ;
- fiches avec dépôt + fiches sans dépôt + fiches dont le schéma ne tient pas = fiches lues ;
- nombre de champs `a_relire`, et nombre de fiches qui en portent.

Limites du lecteur, déclarées :

- une clé écrite deux fois dans une fiche ne provoque pas d'erreur : le lecteur YAML garde la dernière ;
- le gate ne vérifie pas l'ordre des champs ;
- le gate ne lit pas le sens des textes. Il ne détecte pas une marque dans `a_la_place_de` ni une phrase qui présenterait un produit comme disponible. C'est une règle de rédaction.

## Ce que ce dossier ne fait pas

- **Aucun état d'avancement.** Une fiche n'a pas de champ pour dire où en est un produit. L'état d'un produit se lit dans la fiche `project.v1.yaml` de son dépôt porteur.
- **Aucune charte.** La charte d'un produit (valeur, dégel, abandon, refus) vit dans la carte des briques, `ecosystem/briques/produit.v1.yaml`.
- **Aucune source ni référence à un outil tiers.** Les sources d'une fiche et les outils qui ont servi de référence ne sont pas publiés ici.
- **Aucun compte recopié.** Le nombre de produits, de fiches et de champs à relire est imprimé par le gate. Il n'est écrit dans aucun document.
