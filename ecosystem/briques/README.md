# Carte des briques

La vision Libre AI, en données. Une **brique** est une unité de la méthode ou un produit : ce qu'elle fait, ce dont elle dépend, les invariants et les décisions qui la lient, les dépôts qui la portent, et les preuves datées qu'elle peut montrer.

La carte applique ADR-0064, **encore proposé** : son acceptation est un acte du propriétaire. Les fiches ne le répètent pas ; ce qu'elles lui doivent (les couches, les dépendances admises, le statut dérivé) vaut sous cette réserve.

## Forme

- `<couche>.v1.yaml` : les champs typés de toutes les briques d'une couche, au schéma `ecosystem/schemas/brique.v1.schema.json`. Onze couches, onze fichiers.
- `<couche>/<ID>.md` : la fiche lisible d'une brique. Son titre est `# <ID> — <nom>`, une seule fois, suivi sans autre texte de quatre sections, dans cet ordre : « Contexte », « Ce que la brique ferme », « Ce qu'elle ne fait pas », « Mesure ».

Le YAML est la source du vérificateur et de la page vision ; la fiche est la source du lecteur. Une brique présente dans l'un et absente de l'autre est une erreur.

La carte est ce que git suit : un fichier non indexé n'en fait pas partie, et un lien symbolique est refusé. Un fichier de la carte, ou une cible de preuve, dont la copie de travail diffère de l'index est refusé lui aussi : le gate ne répond pas d'un contenu que git ne suit pas.

Trois limites du lecteur, déclarées : dans un fichier de couche, une clé écrite deux fois pour une même brique ne provoque pas d'erreur, le lecteur YAML garde la dernière ; le gate lit les titres `# ` et `## ` en début de ligne, pas tout ce qu'un moteur Markdown rendrait comme un titre ; il refuse les quatre valeurs de statut écrites en toutes lettres, pas une graphie qui les imiterait.

## Ce que le YAML cite, la fiche le nomme

Chaque dépendance (`depend_de`), chaque invariant et chaque décision du YAML est nommé dans la fiche par son identifiant, avec ce qu'il lie. Le gate refuse une citation que la fiche ne nomme pas.

- Un **invariant** se cite quand la brique le réalise ou qu'il la contraint directement, et la fiche le dit avec les mots de l'invariant. Un invariant voisin, cité par analogie, ne se cite pas. Une brique qu'aucun invariant ne lie le dit par une liste vide. Hors de la couche `gouvernance`, le gate compte ces briques et imprime leurs identifiants : c'est la liste de ce que la doctrine ne porte pas encore.
- Une **décision** se cite quand la fiche s'appuie sur elle. Un ADR encore proposé est dit « proposé » à sa première mention.
- Une **dépendance** se cite quand la brique ne peut pas fonctionner ou être vérifiée sans l'autre. La table d'ADR-0064 D1 borne les dépendances entre couches.

## Ce qui n'est jamais écrit ici

- **Le statut.** Il est dérivé des preuves par `ecosystem/check-briques.ts` : `decrite` (aucune preuve), `en_cours` (au moins une preuve datée dont la cible tient), `retiree` (un retrait décidé au registre). `prototypee` demande une release signée liée à son évidence ; aucun instrument ne la vérifie encore, donc aucune brique ne peut l'être et le compteur vaut zéro. Un champ `statut` dans un YAML fait échouer le gate, comme une de ces quatre valeurs écrite dans une fiche ou dans un champ de texte.
- **Les comptes.** Le nombre de briques, par couche et par statut, est imprimé par le gate à chaque exécution. Aucun n'est recopié dans un document.
- **Une absence non mesurée.** « Aucun dépôt ne porte… » s'écrit avec le périmètre lu et sa date, ou ne s'écrit pas.

## Preuves

Une preuve est un artefact qui réalise ou exerce la brique (un gate, un contrat, un module, un test), daté, jamais un texte qui la mentionne. Sa cible est :

- un chemin de ce dépôt : un fichier suivi par git, régulier, non vide, hors de `ecosystem/briques/`. Sa date est celle du dernier commit du fichier ;
- ou une citation épinglée d'un dépôt porteur public, de la forme `organisation/dépôt@<sha de 40 caractères>:<chemin>`, écrite telle quelle, sans échappement ni caractère à sa suite. Elle est résolue par le gate des citations épinglées (`tools/quality/check-pinned-citations.ts`), dont le périmètre liste ce répertoire ; une citation exemptée dans la configuration de ce gate n'est pas une preuve. Sa date est celle du commit épinglé.

Un dépôt privé ne peut pas être cité : une brique portée seulement par un dépôt privé reste `decrite`. Une même cible ne se cite qu'une fois par brique. Le gate refuse une date future ; il ne vérifie pas qu'une date est bien celle du commit, c'est une règle de rédaction.

Une preuve montre ce que montre son artefact, rien de plus. La section « Mesure » de la fiche dit exactement quoi, et nomme le fait observable qui ferait la preuve suivante. Un même artefact peut être cité par plusieurs briques ; le gate compte ces cibles partagées. `en_cours` veut donc dire « au moins un artefact existe », pas « la brique fonctionne ».

## Origine

`inspection` désigne une brique dont la forme vient d'une vision externe inspectée le 2026-11-09 ; son contenu est réécrit depuis la doctrine de ce dépôt. Cette source est désignée, pas nommée, et un lecteur ne peut pas la consulter : c'est une limite déclarée (ADR-0064, précision 12). `propre` désigne une brique que Libre AI ajoute.

## Vérifier

```bash
git add ecosystem/briques && bun run check:briques
```

Le gate imprime ce qu'il a lu : briques par couche, statuts dérivés, preuves tenues, produits du catalogue d'ADR-0042 en brique et hors carte, règles de couche vérifiées et règles seulement déclarées, briques sans invariant, cibles de preuve partagées.
