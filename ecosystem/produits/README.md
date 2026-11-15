# Catalogue des produits

Ce dossier porte une fiche par produit du catalogue d'ADR-0042 §1. Une fiche dit ce que le produit doit faire, pour qui, ce qu'il ne fait pas, et de quels autres produits il dépend.

C'est la source de données du catalogue. La fiche fait autorité sur `fonction` et `etiquettes` : le site les projette, il ne les définit plus. Le lecteur du site ne vit pas dans ce dépôt. La carte des briques (`ecosystem/briques/`) est prévue pour lire ces fiches et ne les lit pas encore.

Une fiche décrit une intention. Elle ne dit pas que le produit existe ni qu'il est utilisable.

## Forme

Un fichier par produit : `Pnn.v1.yaml`, au schéma `ecosystem/schemas/produit.v1.schema.json`. Le schéma est fermé : un champ qu'il ne déclare pas fait échouer le gate.

Les champs s'écrivent dans cet ordre. Tous sont obligatoires : une absence s'écrit `null` ou `[]`, elle ne s'omet pas.

Aucune valeur ne contient de caractère de contrôle (saut de ligne, échappement, U+0085, U+2028, U+2029 compris). Un texte contient au moins une lettre, un chiffre, un signe de ponctuation ou un symbole : des espaces seuls ne sont pas une valeur. Cinq caractères classés lettre ou symbole et qui n'affichent rien ne comptent pas : U+115F, U+1160, U+3164, U+FFA0 et U+2800.

| Champ | Sens |
| --- | --- |
| `schema_version` | Toujours `libre-ai.produit.v1`. |
| `id` | L'identifiant du produit dans le catalogue d'ADR-0042 §1. C'est aussi le nom du fichier. |
| `nom_public` | Le nom « Libre X » tranché par le propriétaire, ou `null` tant qu'il n'est pas tranché (voir plus bas). |
| `nom_provisoire` | Un nom de travail, ou `null` quand un nom public est décidé. |
| `intitule` | Le produit tel que le catalogue le désigne. |
| `fonction` | Le genre d'outil, en quelques mots. |
| `categorie` | Le domaine du catalogue, sous forme d'identifiant. |
| `promesse` | Ce que le produit doit apporter, en une phrase. |
| `pour_qui` | Les personnes à qui le produit est destiné. |
| `a_la_place_de` | Le genre d'outil que le produit doit remplacer. Aucune marque ni aucun service n'y est nommé. |
| `capacites` | Ce que le produit doit savoir faire. |
| `ne_fait_pas` | Ce que le produit ne fait pas, et les limites qu'il garde. Chaque entrée est écrite comme une limite du produit (voir plus bas). |
| `depend_de` | Les produits dont celui-ci a besoin pour fonctionner, par identifiant (voir plus bas). |
| `realisation` | La forme de la réalisation : `projet autonome`, `intégration`, `contribution à un projet existant`, `bibliothèque` ou `service`. |
| `depot` | Le dépôt porteur qu'une décision désigne, écrit `libre-ai/<nom>`, ou `null` (voir plus bas). |
| `etiquettes` | Trois libellés courts, tous différents. |
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

## `nom_public`

`nom_public` est le nom « Libre X » que le propriétaire a tranché pour le produit (décision du 2026-11-09, consignée dans le dépôt du site).

Le glossaire `docs/decisions/LEXICON.md` ne porte pas encore ces noms. Les y inscrire reste un acte du propriétaire : une fiche ne remplace pas cette entrée.

## `ne_fait_pas`

Chaque entrée de `ne_fait_pas` est écrite comme une limite du produit, à l'indicatif : « Ne… pas », « N'est pas… », « Pas de… ». Une entrée ne décrit pas une action à l'infinitif. Le gate ne lit pas cette forme : c'est une règle de rédaction.

## Le sens de `a_relire`

`a_relire` liste les noms des champs de la fiche dont le contenu est une proposition d'un agent. Le propriétaire ne les a pas encore relus.

Un champ listé n'est pas faux. Il n'est pas encore validé. Quand le propriétaire a relu un champ, son nom sort de la liste. Une liste vide veut dire que toute la fiche est relue.

`a_relire` ne nomme que des champs de contenu. `schema_version`, `id` et `a_relire` lui-même n'y figurent pas : le gate les refuse.

Le gate compte ces champs et imprime le total à chaque exécution.

## `depot`

`depot` nomme le dépôt qu'une décision désigne comme porteur du produit. Ce dépôt doit figurer à l'inventaire `ecosystem/repositories.v1.yaml`.

`null` veut dire qu'aucune décision ne désigne de dépôt porteur pour ce produit. C'est vrai même quand l'inventaire contient un dépôt du même domaine : un dépôt voisin n'est pas un dépôt porteur tant qu'une décision ne l'a pas dit. Cela ne veut pas dire qu'aucun travail n'existe ailleurs.

## `depend_de`

`depend_de` liste les produits dont CE produit a besoin pour fonctionner. Un produit qu'il sert ou qu'il alimente n'y figure pas : c'est la fiche de cet autre produit qui cite celui-ci.

Ce n'est pas un ordre de construction : deux produits peuvent se citer l'un l'autre. Une fiche ne se cite pas elle-même.

## Outils tiers

Un outil tiers n'est nommé dans une fiche que dans deux cas : le produit s'y intègre, et c'est alors son objet ; ou l'outil est une plateforme d'exécution. Les outils qui ont servi de référence et les concurrents ne sont pas nommés.

## Ce que le gate vérifie

```bash
git add <ce que tu as modifié> && bun run check:produits
```

Le gate lit ce que git suit, dans le dépôt où il est lancé. Les variables qui redirigent git vers un autre dépôt (`GIT_DIR`, `GIT_INDEX_FILE` et les autres) ne sont pas transmises à ses appels.

Ces règles valent pour les fiches et pour les trois sources du gate (l'ADR-0042, l'inventaire `ecosystem/repositories.v1.yaml`, le schéma) :

- un fichier non indexé n'est pas lu. Une fiche non indexée ne fait pas partie du catalogue. Une source non indexée est un échec ;
- un lien symbolique est refusé. Le gate ne suit jamais un lien ;
- un fichier modifié sur le disque et non indexé est refusé ;
- une fiche en conflit de fusion n'est pas lue. Elle est comptée à part.

Ses règles :

- chaque fiche respecte le schéma ;
- `id` est égal au nom du fichier ;
- les fiches et le catalogue d'ADR-0042 §1 désignent exactement les mêmes produits. Un produit du catalogue sans fiche est un échec. Une fiche hors catalogue est un échec. Un identifiant déclaré par deux fichiers est un échec ;
- `categorie` correspond au domaine que l'ADR donne au produit ;
- un seul de `nom_public` et `nom_provisoire` est renseigné ;
- chaque identifiant de `depend_de` désigne une fiche qui existe, et pas la fiche elle-même ;
- `depot`, s'il est renseigné, est un dépôt de l'inventaire ;
- `etiquettes` compte exactement trois entrées ;
- chaque nom de `a_relire` est un champ de contenu du schéma.

Chaque contrainte du schéma a un vecteur dans `ecosystem/fixtures/produits/vectors.v1.json`. Un test retire les contraintes une par une : si aucun vecteur ne change de verdict, le test échoue.

La liste des produits n'est écrite nulle part dans le code. Le gate la lit dans l'ADR à chaque exécution. Un produit ajouté au tableau du catalogue sans fiche fait donc échouer le gate.

La section du catalogue va de son titre au prochain titre de même niveau ou de niveau supérieur. Un sous-titre ne la ferme pas : un tableau placé sous un sous-titre fait partie du catalogue.

Dans cette section, toute ligne qui contient une barre verticale est une ligne du tableau. Le gate en accepte trois formes :

- la ligne d'en-tête `| Domaine | Produits |` ;
- la ligne de séparation ;
- une ligne de produits lue en entier. Elle commence par `|` en première colonne, compte deux cellules et se termine par `|`. Sa première cellule est un domaine de la table de correspondance. Dans la seconde, les produits sont séparés par `·`, et chacun commence par son identifiant : `P`, deux chiffres, puis un espace ou la fin.

Toute autre ligne du tableau fait échouer le gate, qui la nomme avec son numéro de ligne et la raison (« catalogue line(s) not read »). C'est le cas d'une ligne indentée, d'un domaine inconnu, d'une ligne sans identifiant, et d'un identifiant d'une autre forme comme `P 41`, `P100`, `p41`, `P-41`, `P41bis` ou `P4`.

Hors du tableau, le gate échoue quand une ligne de la section nomme un produit qu'aucune ligne du tableau ne liste. Une phrase qui cite un produit déjà présent dans le tableau est acceptée.

Le catalogue est lu deux fois : par ce gate, et par le lecteur de la carte des briques (`ecosystem/briques.ts`). Ce second lecteur ferme la section à n'importe quel titre et lit tout identifiant d'une ligne. Quand les deux lecteurs ne lisent pas les mêmes produits, le gate échoue et nomme la ligne. Un tableau sous un sous-titre fait donc échouer le gate tant que le lecteur de la carte des briques ne lit pas la section de la même façon.

Une source illisible est un échec, jamais un zéro : ADR absent, tableau du catalogue introuvable, inventaire absent, dossier sans fiche, schéma absent, vide, mal formé ou remplacé par un dossier. Quand le schéma est illisible, aucune fiche n'est jugée valide, et le gate imprime quand même ses compteurs.

Le gate imprime ses compteurs, en succès comme en échec :

- produits du catalogue = produits avec fiche + produits sans fiche ;
- fiches lues = fiches valides + fiches en violation, avec le nombre de fiches hors catalogue ;
- fiches avec dépôt + fiches sans dépôt + fiches dont le schéma ne tient pas = fiches lues ;
- nombre de champs `a_relire`, et nombre de fiches qui en portent ;
- chemins suivis sous `ecosystem/produits/` = fiches lues + README + chemins refusés + chemins en conflit de fusion.

Limites du lecteur, déclarées :

- une clé écrite deux fois dans une fiche ne provoque pas d'erreur : le lecteur YAML garde la dernière ;
- le gate ne vérifie pas l'ordre des champs ;
- le gate ne lit pas le sens des textes. Il ne détecte pas une marque dans `a_la_place_de`, un outil tiers nommé à tort, une dépendance écrite dans le mauvais sens, ni une phrase qui présenterait un produit comme disponible. Ce sont des règles de rédaction ;
- hors du tableau, le gate ne reconnaît un produit qu'à son identifiant de forme exacte. Une phrase ou une liste qui annonce un produit sous une autre forme (`P 41`, `p41`) et sans barre verticale n'est pas vue ;
- un caractère invisible sans largeur (U+200B par exemple) n'est pas un caractère de contrôle. Seul, il ne fait pas une valeur ; au milieu d'un texte, il est accepté. Il en va de même du caractère d'inversion du sens d'écriture U+202E et des caractères à usage privé : refusés seuls, acceptés au milieu d'un texte ;
- la liste des caractères invisibles classés lettre ou symbole est courte et fermée (U+115F, U+1160, U+3164, U+FFA0, U+2800). Un autre caractère de ces classes qui n'afficherait rien n'est pas reconnu, et ces cinq-là sont acceptés au milieu d'un texte.

## Ce que ce dossier ne fait pas

- **Aucun état d'avancement.** Une fiche n'a pas de champ pour dire où en est un produit. L'état d'un produit se lit dans la fiche `project.v1.yaml` de son dépôt porteur.
- **Aucune charte.** La charte d'un produit (valeur, dégel, abandon, refus) vit dans la carte des briques, `ecosystem/briques/produit.v1.yaml`.
- **Aucune source, aucun outil de référence, aucun concurrent.** Les sources d'une fiche ne sont pas publiées ici. Les outils qui ont servi de référence et les concurrents ne sont pas nommés. Un outil tiers n'apparaît que dans les deux cas décrits plus haut.
- **Aucun compte recopié.** Le nombre de produits, de fiches et de champs à relire est imprimé par le gate. Il n'est écrit dans aucun document.
