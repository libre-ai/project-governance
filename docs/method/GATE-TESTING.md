# Tester un gate ou un outil de flotte — doublures, table de cas, preuve par mutant

Un outil de flotte (un gate, un outil de balayage, un script qui lit ou écrit une forge) se
teste sans instance et sans jeton : sa suite tourne sur un poste hors ligne et rend le même
verdict qu'en intégration continue. Cette note dit comment, et ce que la suite doit prouver
sur elle-même.

## Portée et statut

- **Portée :** la suite de tests de tout gate et de tout outil de flotte, dans ce dépôt et
  dans ceux qui en copient les gabarits : forme des doublures, environnement du processus
  fils, table de cas, preuve par mutant, déclaration de ce que la suite ne discrimine pas,
  et les deux questions écrites qui accompagnent chaque test. Méthode, pas doctrine : rien ici
  n'est un invariant, et un ADR qui tranche autrement prime.
- **Hors portée :** une doublure par fournisseur (forge, planificateur, machine virtuelle,
  résolution de noms). La note donne le principe ; chaque outil écrit la doublure de la
  dépendance qu'il appelle.
- **Statut :** proposé le 2026-11-17. L'inscription dans la carte d'autorité
  (`docs/README.md`) est une décision de fusion du propriétaire.

## Faux client à état et journal d'appels

Une forge, un registre de paquets, un service tiers sont des dépendances **réellement
externes** au sens de `docs/method/MODULE-DESIGN.md` : l'outil les reçoit comme port
injecté, et la suite fournit l'adaptateur. Le vocabulaire (couture, adaptateur, catégories de
dépendance) est celui de cette note-là et ne se redéfinit pas ici.

L'adaptateur de test est un **faux client à état en donnée** :

- **Un fichier d'état.** Ce que la dépendance renverrait (dépôts, branches, réglages,
  erreurs) est une donnée posée par le cas, pas du code dans la doublure. La
  doublure lit ce fichier pour construire sa sortie et le modifie quand l'outil écrit.
- **Un journal d'appels.** La doublure y ajoute une ligne par appel reçu, avec ses arguments,
  dans l'ordre de réception, lectures comprises.
- **Deux assertions par cas.** Sur l'état final : ce que l'outil a écrit, et ce qu'il a laissé
  intact. Sur le journal : les appels qui doivent y figurer, et ceux qui ne doivent pas y
  figurer. Un outil qui écrit avant d'avoir relu, ou qui écrit après un refus, a un état final
  parfois correct et un journal faux ; seul le journal le montre.
- **Un appel imprévu est un échec.** Une requête que l'état du cas ne décrit pas fait échouer
  la doublure avec un code distinctif ; elle ne rend jamais une sortie vide, qui se
  confondrait avec « la dépendance n'a rien ».

Le faux client prend l'une de deux formes selon la couture de l'outil : un adaptateur en
processus passé au port injecté, ou un exécutable doublure placé sur le chemin d'exécutables
du processus fils (rubrique suivante). Dans les deux cas, aucun cas n'ouvre de connexion
réelle : la suite n'a besoin ni d'un jeton ni d'une instance, et ne les lit pas s'ils existent.

## Exécutables réduits à des doublures et environnement purgé

Un outil lancé comme processus se teste comme processus, dans un environnement que la suite
construit de rien :

- **`PATH` réduit à un dossier de doublures.** Ce dossier, créé par la suite dans un
  répertoire jetable, contient une doublure par exécutable que l'outil peut appeler. Le
  moteur d'exécution se désigne par son chemin absolu, pas par `PATH`.
- **Une doublure appelée à tort échoue avec un code distinctif.** Chaque doublure qu'un cas
  ne prévoit pas d'appeler sort avec un code qui lui est propre et qu'aucun chemin de l'outil
  ne produit ; elle s'inscrit aussi au journal. Un cas qui attend un refus avant tout appel
  distingue ainsi « l'outil a refusé » de « l'outil a appelé, puis échoué ».
- **`HOME` jetable.** Une configuration, un cache ou un identifiant du poste ne décide d'aucun
  verdict, et la suite n'écrit rien chez l'utilisateur.
- **Aucune variable héritée.** L'environnement du fils contient ce que le cas déclare, et rien
  d'autre : une variable ambiante du run d'intégration continue ne peut pas décider d'un
  verdict. Une suite qui hérite de l'environnement mesure le run ambiant, pas son cas.

`spawnClean`, dans `distribution/templates/langgraph-gates/langgraph-gates.test.ts`, est une
instance du `HOME` jetable et de l'environnement construit de rien : le fils reçoit deux
variables, et un test épingle qu'il n'en reçoit pas d'autre. `spawnClean` n'est pas une
instance du `PATH` réduit : il transmet le `PATH` hérité, pour trouver `git`.

## Table de cas

Les cas sont une donnée, pas une suite de fonctions : une ligne par cas, les mêmes colonnes
pour tous, et une seule fonction qui les exécute.

| Nom | État initial | Arguments | Code de sortie attendu | Motif attendu sur la sortie d'erreur | Appels attendus au journal (et appels interdits) |
| --- | --- | --- | --- | --- | --- |
| ce que le cas prouve, en une phrase | le filtre ou le fichier d'état du faux client | les arguments passés à l'outil | un code exact, jamais « non nul » | un motif lu sur la sortie d'erreur ; vide pour un cas vert | les appels requis, puis ceux dont la présence est un échec |

Règles de remplissage :

- **Les fixtures reproduisent des défauts mesurés.** Un cas rouge part d'un défaut observé
  (une sortie réelle, une entrée qui a trompé l'outil, un constat de revue) et le dit dans son
  nom. Un cas inventé pour remplir la table vérifie ce que l'auteur a imaginé, pas ce qui
  arrive.
- **Les sorties attendues viennent du contrat.** Code de sortie, motif et appels se tirent de
  la spécification de l'outil, du contrat de la dépendance ou d'un vecteur publié ; jamais de
  la sortie actuelle du code, qu'un tel attendu ne ferait que recopier.
- **Un cas vert imprime son volume.** Le cas vert d'un gate lit les compteurs que le gate
  imprime et vérifie qu'ils somment à l'univers posé par l'état initial.
- **Une source illisible est un cas.** Chaque source que l'outil déclare lire a un cas où elle
  est absente ou illisible, et ce cas attend un échec, pas un zéro.

## Preuve par mutant

Un cas rouge ne prouve rien tant qu'il n'a pas été montré vert sans la garde qu'il vérifie.
Chaque cas rouge est donc rejoué contre un **mutant** de l'outil : une copie dont la ligne
décisive est remplacée par un no-op.

- **Remplacée, jamais supprimée.** La ligne décisive est remplacée par un no-op, jamais
  supprimée. Supprimer une ligne déséquilibre la structure et fait rougir tout, pour la
  mauvaise raison. Le remplacement garde la forme du programme et neutralise la seule
  décision visée.
- **Exactement une occurrence.** Le texte décisif se cherche tel quel dans le fichier. Zéro
  occurrence, ou plusieurs, fait échouer la suite : la mutation ne dit plus quelle garde elle
  neutralise.
- **Trois échecs de la suite, pas du cas.** Un mutant identique à l'original fait échouer la
  suite, car le remplacement ne change rien. Un mutant qui plante fait échouer la suite, car
  il prouve que la mutation casse le programme, pas que le cas vérifie quelque chose. Un
  mutant qui laisse tout vert fait échouer la suite, car aucun cas ne discrimine la garde.
- **La copie seule est mutée.** Le mutant s'écrit dans un répertoire jetable ; le fichier sous
  revue n'est jamais touché.
- **Un cas est une paire.** Le verdict qu'il épingle tient sur l'outil et ne tient pas sur le
  mutant.

La suite tient la table des mutants et la joint à la description de la demande de fusion :

| Identifiant du mutant | Fichier | Texte décisif remplacé et son remplacement no-op | Cas rouge(s) qui le tuent | Équivalence expliquée (vide si tué) |
| --- | --- | --- | --- | --- |
| un nom stable, celui que cite le cas | le fichier muté | le texte exact, puis ce qui le remplace | les noms des cas, tels que dans la table de cas | la raison pour laquelle aucun cas ne peut le tuer |

Un mutant **équivalent** (aucune entrée ne distingue le mutant de l'original) a deux issues :
l'équivalence s'explique dans la dernière colonne, ou elle révèle du code mort, et ce code se
retire.

## Gardes sans mutant (liste non discriminée)

Une garde que la suite ne sait pas neutraliser se déclare ; elle ne se tait pas. La suite
porte une liste « non discriminée », une entrée par garde : le fichier, le texte de la garde
et la raison. Exemple de raison admise : une garde de relecture après réécriture, que rien ne
permet de mettre en défaut sans un point d'injection que l'outil n'a pas.

- Une entrée sans raison est un échec de revue.
- La liste se compte : gardes de l'outil = gardes tuées par un mutant + équivalences
  expliquées + entrées non discriminées. Une garde absente des trois n'est ni mesurée ni
  déclarée.
- Une entrée sort de la liste le jour où un point d'injection existe ; l'ajouter pour cela est
  un changement de l'outil, relu comme tel.

## Les deux questions de chaque test

Neutraliser prouve qu'un test discrimine ; cela ne prouve pas qu'il discrimine la bonne chose.
Pour tout test ajouté ou modifié, la description de la demande de fusion répond par écrit aux
deux questions suivantes.

1. Quelle erreur concrète fait rougir ce test ?
2. Un refactor équivalent, ou un meilleur résultat tout aussi valide, le ferait-il rougir aussi ?

Chacune des deux réponses est obligatoire.

La réponse à la première est le no-op de la table des mutants : la ligne neutralisée et le cas
qui rougit. Si la réponse à la seconde est oui, le test verrouille l'implémentation et non le
comportement : son attendu se réécrit à partir du contrat.

## Instances dans ce dépôt

Chaque instance porte sa propre description ; cette note y renvoie et ne la recopie pas.

- **Gabarits de gates LangGraph.** La section « Preuve par mutation » de
  `docs/method/LANGGRAPH-ENTRY-GATES.md` applique la preuve par mutant et l'environnement
  purgé à trois gates autonomes.
- **Instruments d'attestation.** `tools/attestation/neutralise-check.ts` compte les sites de
  refus, exige un marqueur par site, et classe un mutant qui plante à part d'un mutant tué.
- **Lanceur de mutants.** `tools/quality/mutant.ts` produit et exécute les mutants décrits en
  donnée dans `tools/quality/mutants.v1.json` ; un outil qui y inscrit ses mutants n'écrit pas
  de procédure manuelle.
- **Cette note.** `tools/quality/gate-testing-doc.test.ts` vérifie sa structure, et rejoue
  chacun de ses contrôles contre une copie mutée de la note.
