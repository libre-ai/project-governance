# Carte des briques

La vision Libre AI, en données (ADR-0064). Une **brique** est une unité de la méthode ou un produit : ce qu'elle fait, ce dont elle dépend, les invariants et les décisions qui la lient, les dépôts qui la portent, et les preuves datées qu'elle peut montrer.

## Forme

- `<couche>.v1.yaml` : les champs typés de toutes les briques d'une couche, au schéma `ecosystem/schemas/brique.v1.schema.json`. Onze couches, onze fichiers.
- `<couche>/<ID>.md` : la fiche lisible d'une brique. Son titre est `# <ID> — <nom>`, et elle porte quatre sections, dans cet ordre : « Contexte », « Ce que la brique ferme », « Ce qu'elle ne fait pas », « Mesure ».

Le YAML est la source du vérificateur et de la page vision ; la fiche est la source du lecteur. Une brique présente dans l'un et absente de l'autre est une erreur.

## Ce qui n'est jamais écrit ici

- **Le statut.** Il est dérivé des preuves par `ecosystem/check-briques.ts` : `decrite` (aucune preuve), `en_cours` (au moins une preuve datée dont la cible tient), `retiree` (un retrait décidé au registre). `prototypee` demande une release signée liée à son évidence ; aucun instrument ne la vérifie encore, donc aucune brique ne peut l'être et le compteur vaut zéro. Un champ `statut` dans un YAML fait échouer le gate.
- **Les comptes.** Le nombre de briques, par couche et par statut, est imprimé par le gate à chaque exécution. Aucun n'est recopié dans un document.

## Preuves

Une preuve est un artefact qui réalise ou exerce la brique (un gate, un contrat, un module, un test), daté, jamais un texte qui la mentionne. Sa cible est :

- un chemin de ce dépôt, vérifié sur l'arbre ;
- ou une citation épinglée d'un dépôt porteur public, de la forme `organisation/dépôt@<sha de 40 caractères>:<chemin>`, résolue par le gate des citations épinglées (`tools/quality/check-pinned-citations.ts`), dont le périmètre liste ce répertoire.

Un dépôt privé ne peut pas être cité (I-15) : une brique portée seulement par un dépôt privé reste `decrite`.

Une preuve montre ce que montre son artefact, rien de plus. La section « Mesure » de la fiche dit exactement quoi, et nomme le fait observable qui ferait la preuve suivante. Un même artefact peut être cité par plusieurs briques ; le gate compte ces cibles partagées.

## Invariants

Une brique cite les invariants qui la lient : ceux qu'elle réalise ou qui la contraignent directement. Une brique qu'aucun invariant ne lie le dit par une liste vide. Hors de la couche `gouvernance`, le gate compte ces briques et imprime leurs identifiants : c'est la liste de ce que la doctrine ne porte pas encore.

## Vérifier

```bash
bun run check:briques
```

Le gate imprime ce qu'il a lu : briques par couche, statuts dérivés, preuves tenues, produits du catalogue d'ADR-0042 en brique et hors carte, règles de couche vérifiées et règles seulement déclarées.
