# Éventail de spécifications — une spécification par dépôt, en parallèle

- **Portée :** comment produire une spécification par dépôt, sur une liste de
  dépôts, avec un sous-agent par dépôt, sans qu'un rapport d'agent tienne lieu
  de preuve ni qu'une ressource survive à la boucle qui l'a créée. Méthode, pas
  doctrine : elle ne crée ni invariant ni ADR, elle applique ceux qui existent.
- **Statut :** proposé le 2026-11-17. Jamais exécutée sur un dépôt réel : le
  pilote (cinquième étape) attend le contrôleur (troisième étape), renvoyé au
  lot L127.

**Entrées.** Un dossier de travail hors dépôt ; une liste blanche de noms de
dépôts ; un gabarit de sortie, qui est la liste des sections requises de
[SPECIFICATION-STANDARD.md](../specifications/SPECIFICATION-STANDARD.md). Ce
document ne redéfinit pas une spécification : il renvoie à ce standard.

**Sorties.** Une spécification par dépôt de la liste ; un plan consolidé,
jetable, écrit hors de tout dépôt ; un verdict de relecture rendu par un agent
qui n'a rien écrit.

**Règle d'itération.** Toute boucle de la méthode itère sur la liste blanche de
noms de dépôts, écrite en clair dans le mandat ou le script. Jamais sur le
contenu d'un répertoire de worktrees, jamais sur un fichier de base : un
répertoire contient aussi les restes d'une vague précédente, et un fichier de
base périme sans que rien ne le dise. La branche servie de chaque dépôt se lit
au protocole, `git ls-remote --symref`, jamais comme un littéral. Aucun nombre,
aucune branche, aucun sha ne s'écrit en dur : la commande qui le dérive figure
sur la même ligne que lui.

```sh
for depot in depot-a depot-b depot-c; do
  git ls-remote --symref "<forge>/$depot" HEAD \
    | sed -n 's#^ref: refs/heads/\([^[:space:]]*\)[[:space:]]*HEAD$#\1#p'
done
```

## 1. Mesurer l'état réel

Rejouer les mesures de la passation qui a lancé le chantier, au lieu de les
reprendre : une mesure datée périme. Pour chaque dépôt de la liste blanche,
comparer la tête servie (lue par `git ls-remote --symref <url> HEAD`) à la base
sur laquelle la passation a raisonné. Un dépôt dont la tête a bougé repart de
cette étape.

## 2. Worktrees à la tête servie

Un worktree par dépôt de la liste, détaché sur la tête de la branche servie,
elle-même lue par `git ls-remote --symref`. Le worktree vit dans le dossier de
travail, pas dans le dépôt, et la boucle qui le crée le retire dans un bloc
`finally`, échec compris : c'est la règle « le nettoyage appartient à la boucle
qui a créé la ressource » de
[AGENTIC-LOOP-INVENTORY.md](AGENTIC-LOOP-INVENTORY.md), citée et non
redéfinie.

## 3. Gabarit de sortie et contrôleur déterministe

Le gabarit de sortie est la liste des sections requises du standard. Le
contrôleur vérifie une spécification rendue et un mandat assemblé ; il se prouve
par mutants avant qu'on croie son vert. Ce contrôleur est livré par le lot
L127, qui n'existe pas encore : ce document ne décrit ni son interface ni son
comportement, et tant qu'il manque, les étapes suivantes ne se lancent pas.

## 4. Mandats assemblés et lintés

Chaque mandat s'assemble depuis une source par dépôt (le brief durable de ce
dépôt) et les trois blocs communs de la section « Mandat », insérés sans
modification. Le mandat assemblé passe au contrôleur de la troisième étape avant d'être
confié à un agent ; un mandat qui ne passe pas ne part pas.

## 5. Pilote unique sur le plus petit dépôt

Avant tout éventail, un seul agent sur le plus petit dépôt de la liste
(taille relue par `git -C <worktree> ls-files | wc -l`). Quand la sortie du
pilote est fausse, on corrige le mandat, pas la sortie : une sortie retouchée
par l'orchestrateur cache le défaut que tous les agents de la vague reproduiront.

## 6. Vague A : les transverses

Un agent par question transverse : contrat de version, code mort, README. Leurs
sorties sont relues et validées avant d'alimenter la vague B ; une sortie
transverse non validée ne se propage pas.

## 7. Fusion des demandes vertes par le propriétaire

Chaque demande de fusion issue de la vague A passe une revue adversariale, puis
le propriétaire la fusionne. L'état fusionné se relit à l'API de la forge ; un
rapport d'agent qui l'affirme ne compte pas.

## 8. Vague B : un agent par dépôt

Un agent par dépôt de la liste blanche, chacun avec son mandat enrichi des
sorties validées de la vague A. Chaque rapport rendu est re-vérifié localement
par l'orchestrateur avant d'entrer dans la consolidation : c'est la règle « un
rapport d'agent n'est pas une preuve » de l'inventaire des boucles.

## 9. Consolidation puis relecture indépendante

Les spécifications rendues se consolident dans un plan jetable, hors dépôt. Un
agent qui n'a rien écrit relit la consolidation : on lui donne les fichiers et
le mandat, jamais la conclusion, pour que son verdict ne reprenne pas celle de
l'auteur.

## Mandat

Tout mandat de sous-agent porte sept rubriques, dans cet ordre. Une rubrique
vide se déclare, elle ne s'omet pas.

1. **Rôle** — une phrase.
2. **Périmètre** — répertoire de travail épinglé, cibles, ce qui est hors
   périmètre, et le brief durable : comportement actuel vers comportement voulu.
3. **Contraintes** — lecture seule ou non, répertoire propre à l'agent, bloc
   outils, budget d'appels d'outils, liste des projets lisibles.
4. **Faits volatils** — la commande qui dérive chaque fait, jamais sa valeur.
5. **Format de sortie** — la structure exigée, chaque chiffre porteur suivi de
   la commande qui le reproduit.
6. **Critère de fin** — ce qui rend le travail terminé, et ce que l'agent rend
   s'il ne l'atteint pas.
7. **Délégation** — oui ou non, et la profondeur maximale ; par défaut aucune.

Trois blocs communs s'insèrent tels quels dans chaque mandat :

- **Bloc a — dépôts privés hors périmètre :** ni lecture, ni listage, ni appel
  d'API sur un dépôt privé.
- **Bloc b — outils :** pour chaque commande interdite, l'outil qui la
  remplace, recopié en entier et pas seulement la liste des interdits.
- **Bloc c — délégation de profondeur nulle :** l'agent ne lance aucun
  sous-agent.

## Invariants

- **Écritures de forge par le seul propriétaire.** Les agents ne font que des
  lectures (`GET`) ; ni push, ni demande de fusion, ni issue.
- **Dépôts privés hors périmètre.** Aucun agent ne les lit, ne les liste ni ne
  les interroge.
- **Rien ne fusionne sans pipeline vert.** L'état `merged` se relit à l'API de
  la forge, jamais dans un rapport.
- **Relecteur d'une autre famille de modèle que l'auteur.** Un relecteur de la
  même famille partage les angles morts de l'auteur.

## Leçons

- **Budget d'appels et liste des projets lisibles dans le mandat.** Un pilote
  sans budget a fait bien plus d'appels d'outils que son dépôt ne compte de
  fichiers ; le mandat borne donc les appels et nomme les projets lisibles.
- **Confinement par discipline, aucun bac à sable de lecture.** Un worktree
  isole les écritures, pas les lectures : rien n'empêche un agent de lire un
  dépôt voisin. Le confinement tient au mandat et à sa vérification, il n'est
  pas garanti par l'outillage.
- **Un inventaire écrit dans chaque dépôt est du code mort.** Ce qui dure est
  la commande de scan ; le rapport consolidé est jetable et vit hors dépôt ;
  chaque action qu'il propose porte sa preuve sur sa propre ligne.

## Hors périmètre

- Le contrôleur de la troisième étape et sa preuve par mutants : lot L127.
- Les mandats des autres méthodes et les vagues réelles : ce document décrit la
  méthode, il ne lance rien.
- Toute écriture de forge : elle reste au propriétaire.
