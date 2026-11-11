
# Revue adverse du gate « carte des briques » — `libre-ai/project-governance`

## Verdict : `reject`

Trois faux verts exécutés touchent la dérivation de `en_cours`, qui est l'objet du gate (D4) : F1 bloquant, F2 et F3 majeurs. Aucun n'est déclenché par les données actuelles ; le reste est mineur ou non bloquant.

## Identité de la passe

- **Commit relu** : `1436e0f766fe4ba1549b420fab29c16ef03849c8` (`git rev-parse HEAD`, identique en fin de passe).
- **Worktree** : `git status --short | wc -l` rend `1` au début et à la fin ; l'unique ligne est `?? node_modules`, le lien préexistant. Aucun fichier suivi modifié.
- **Empreintes SHA-256**, relevées au début et à la fin, identiques :

```
a651ae7c74ad32fccd47322b90abeee8516cac6baba0e2c9e8e672b447f3703e  ecosystem/briques.ts
78ffbb4274b3c350a2b016d9d92ec6fe9ef7c823be810dcc2dcc30e3f8d6435f  ecosystem/check-briques.ts
b06ec5877eba883968350b2e876c0e50f93e28075c421bdcf77ec43c61398055  ecosystem/schemas/brique.v1.schema.json
559200d24a2c7100279045985d850856d53cda303d5aa54b5273ceb2321f9ac9  ecosystem/briques.test.ts
97f348503fb047c5d5209a5eec1d38d4763562a0ca201f6d72cf15453ac9fc2c  ecosystem/check-briques.process.test.ts
d20fc88aa34029075ebc56bade6cd7ee9658cfe96c1e3e42f2f50c9b19a4a1a6  ecosystem/fixtures/briques/vectors.v1.json
58c1246fe5aefc38d6adeed8faf1557c4d73daaaa2e85ac9e2b28cffb5a9b898  .github/workflows/brick-map.yml
ac3ddee5ba61b37cd78e1b79cf37653130cb8c2fb983fe0b73050c193b3b07b2  package.json
f5a03f82609771595ace64bb1b9a1e7678fb5d21f555f553770da33d7cc58834  tools/quality/pinned-citations.v1.json
6712807ab038f5a88ef85ec6d931c03e19dbe232af08f5742a397963e0151482  tools/quality/check-review-evidence.ts
a27c5e113b8ece93d7d9b4b81aa1d271e8e4513c12766b53dcb7722c8ce39490  tools/quality/check-review-evidence.test.ts
b15382a9ac8d06bc3bcc05b073e1e799300c70362dca03e7b240a3ea07a8b905  tools/quality/check-data-inventory.ts
```

- **`bun ecosystem/check-briques.ts`** sur l'arbre : exit 0. Extrait de sa ligne : `Brick map verified: 118 assertion(s) hold — 99 brick(s) in 11 of 11 layer file(s) … 122 entry(ies) under ecosystem/briques/ = 11 layer file(s) + 11 layer directory(ies) + 99 fiche(s) + 1 README + 0 refused; status derived: decrite 25, en_cours 74, prototypee 0, retiree 0 … proofs held: 48 on this tree, 72 pinned and left to the pinned-citations gate`.
- **`bun test ecosystem/briques.test.ts ecosystem/check-briques.process.test.ts`** : `84 pass / 0 fail / 143 expect() calls`.
- **Bun** : la passe a tourné sous `1.4.4` local (`Bun v1.4.4-canary.1+963452075`). La CI épingle `1.4.0-canary.1+57f349f63` ; le comportement de `Bun.YAML` sous la version CI n'a pas été mesuré.

## Rejouer les sondes

- Espace de sonde : `<espace de sonde>`. Il contient `lib.ts`, `p1-status.ts` à `p8-parsers.ts`, et `full/`, une copie `git archive HEAD` avec `git init` et l'origine posée.
- Chaque sonde se rejoue par `cd <espace de sonde> && bun <script>` ; les libellés (L2, S1, P2…) sont ceux des sorties.
- Les copies lourdes (`fs/`, `mut/`, `gates/`, `base/`) sont effacées ; `p3-fs.ts` et `p5-mutants.ts` les recréent.
- Nettoyage final : l’outil de nettoyage du harnais.
- Sauf mention, l'entrée est une brique `IDN-90` ajoutée en fin de `identite.v1.yaml`, avec sa fiche à quatre sections ; ce témoin seul sort vert (`decrite, 0 proof(s) held`).

## Constats

### Bloquant

**F1 — Une preuve locale « existe » dès que `existsSync` répond vrai.**
- **Lieu** : `ecosystem/check-briques.ts:145` (`existsSync(join(root, path))`), consommé à `ecosystem/briques.ts:531`.
- **Commandes** : `bun p2-proofs.ts` (L…), `bun p3-fs.ts` (S…).
- **Entrées et sorties**, toutes `GREEN`, `en_cours, 1 proof(s) held` :

| Sonde | `cible` | Ce que c'est |
| --- | --- | --- |
| L2, L3, L5 | `docs`, `docs/adr`, `ecosystem/briques` | un répertoire |
| S5 | `docs/link-proof.md` → `/etc/hosts` | un lien vers l'extérieur de l'arbre |
| S5b | `docs/etc-link/hosts`, avec `docs/etc-link` → `/etc` | un chemin qui traverse un lien |
| L8 | `node_modules/ajv/package.json` | non suivi, présent en CI après `bun install` |
| L9 | `.git/config` | non suivi, présent en CI après checkout |
| S6b | `untracked-scratch.txt` | fichier non suivi de l'arbre de travail |
| S6, L7 | `ecosystem/briques/identite/IDN-90.md`, `ecosystem/briques/identite.v1.yaml` | la fiche et le fichier de couche de la brique elle-même |
| S6c | `docs/empty-proof.ts` | fichier vide |
| L15 | `readme.md` | variante de casse, verte sur macOS seulement |

- **Attendu** : rouge. Le README dit « un chemin de ce dépôt, vérifié sur l'arbre » et le mandat « un lien symbolique n'est pas suivi ».
- **Portée** : une seule ligne `cible: docs` fait passer une brique à `en_cours`, sans intention hostile.
- **Correction** : juger la cible contre l'ensemble suivi (`git ls-files`), exiger un fichier régulier par `lstat` sur chaque composant, refuser les cibles sous `ecosystem/briques/`. Ajouter les vecteurs rouges correspondants.

### Majeur

**F2 — Une preuve épinglée peut être invisible du gate à qui elle est déléguée.**
- **Lieu** : `ecosystem/briques.ts:504` (grammaire appliquée à la valeur YAML décodée), délégation affirmée à `:605-612`. Le gate des citations lit le texte brut par segments (`tools/quality/check-pinned-citations.ts:1647`, `scanText`).
- **Commande** : `bun p2-proofs.ts`.
- **Entrées**, avec un sha de 40 zéros et un chemin inexistant :
  - P2 : `cible: "libre-ai\/schemas-and-contracts@0000…0000:no/such/file.ts"`
  - P3 : `"libre-ai/schemas-and-contracts\x40<sha>:…"`
  - P4 : `"libre-\u0061i/…"`
  - P5 : continuation de ligne `\` placée avant le `@`
- **Sortie** : `GREEN`, `en_cours, 1 proof(s) held`, puis `citations gate reads: pinned=[] rejected=[] unqualified=[] candidates=0`.
- **Attendu** : rouge ici, ou lecture là-bas. Le gate imprime « pinned and left to the pinned-citations gate » pour une citation que ce gate ne lit pas.
- **Limite de la mesure** : relevée sur `scanText` ; la résolution réseau n'a pas été lancée.
- **Correction** : passer le texte brut du fichier de couche à `scanText` et exiger que chaque cible épinglée soit exactement une citation `pinned` qu'il rend, sans rejet.

**F3 — `ecosystem/briques` en lien symbolique est suivi.**
- **Lieu** : `ecosystem/check-briques.ts:54-57` (`existsSync(base)` puis `readdirSync`, sans `lstat` de la racine).
- **Commande** : `bun p3-fs.ts`, sondes S1 et S2.
- **Entrées** : S1, `ecosystem/briques` → `briques-real` (répertoire frère) ; S2, `ecosystem/briques` → un répertoire hors de l'arbre.
- **Sortie** : `exit=0`, `Brick map verified: 118 assertion(s) hold — 99 brick(s)…` dans les deux cas. Sur S1 après `git add` : `120000 … ecosystem/briques` et `tracked paths with prefix ecosystem/briques/ : 0`.
- **Conséquence** : le gate des citations ne lit alors aucune des 72 preuves épinglées. Il n'échoue que si tout son périmètre est vide (`check-pinned-citations.ts:1617`), et `docs/` ne l'est pas.
- **Attendu** : rouge.
- **Correction** : `lstatSync` sur `ecosystem` et `ecosystem/briques`, échec nommé si l'un est un lien.

### Mineur

**F4 — L'interdit du statut en prose se contourne (précision 7 de l'ADR).**
- **Lieu** : `briques.ts:411` (le texte avant la première section est jeté), `:403-405` (un second titre `# ` est ignoré), `:215` (sensible à la casse), `:862`.
- **Commande** : `bun p1-status.ts`. Toutes ces entrées sortent `GREEN` :
  - F2 : `**Statut : prototypee**` entre le titre et `## Contexte` ;
  - F3 : un second titre `# Statut : prototypee` ;
  - F4, F5 : `Prototypee`, `EN_COURS` ;
  - F6, F7, F9 : `prototypée`, `en cours`, `en\_cours` ;
  - A14, A15, A16 : la valeur dans `nom`, `role` ou `jetable` du YAML.
- **Attendu** : rouge au moins pour F2, F3, F4, F5.
- **Correction** : scanner la fiche entière et les champs texte du YAML, sans tenir compte de la casse.

**F5 — Une citation exemptée compte comme preuve tenue.**
- **Lieu** : `briques.ts:605` (seul `scope` est lu).
- **Commande** : `bun p3-fs.ts`, sonde S16.
- **Entrée** : preuve épinglée au sha de 40 zéros, plus une entrée `exemptions` pour ce fichier dans la copie de `pinned-citations.v1.json`.
- **Sortie** : `exit=0`, `100 brick(s)`, `en_cours 75`. Une exemption signifie « ne résout pas » dans le gate des citations.
- **Portée** : le fichier de configuration est dans la surface gardée, d'où le classement.
- **Correction** : refuser une preuve épinglée dont le couple (fichier, citation) figure dans `exemptions`.

**F6 — La liste de mots de délai refuse des faits et laisse passer des délais.**
- **Lieu** : `briques.ts:210`, `:788-795`.
- **Commande** : `bun p4-deps.ts`.
- **Faux rouges** : D1 « Une mise à jour signée du contrat est publiée… » → `names a delay (« jour »)` ; D2 « Le jour où la release signée… » → idem ; D3 « Le rapport de souveraineté du mois… » → `(« mois »)`.
- **Faux verts** : D4 « dans un an », D5 « au prochain trimestre », D6 « d'ici 2027 », D7 « quand nous aurons le temps », D10 « sous 48 h ».
- **Correction** : en faire un compteur imprimé, comme la précision 8, ou viser les formes « dans/sous/d'ici + durée ».

**F7 — Faux rouges de lecture.**
- **Lieu** : `briques.ts:402` et `check-briques.ts:57`.
- **Commandes** : `bun p1-status.ts` (F13, F14), `bun p3-fs.ts` (S7).
- F13 : un bloc de code clôturé contenant `## deuxième commentaire` → `fiche sections are « Contexte | deuxième commentaire | … »`.
- F14 : `## Contexte ##` → refusé.
- S7 : un `.DS_Store` non suivi sous la carte → `exit=1`, `.DS_Store (file)`.
- **Correction** : ignorer les blocs clôturés ; lister les entrées par `git ls-files` ou compter à part les non suivies.

**F8 — Coût non borné sur une entrée du dépôt, et workflow sans délai.**
- **Lieu** : `briques.ts:475-495` (parcours par chemin, sans mémo), `:401` (`/<!--[\s\S]*?-->/g`), `.github/workflows/brick-map.yml:28-31` (pas de `timeout-minutes` ; `pinned-citations.yml` en porte 15).
- **Commandes** : `bun p7-cost.ts`, `bun p6-misc.ts`.
- **Sorties** :
  - couche acyclique dense : `26 bricks: 826 ms`, `28 bricks: 3429 ms`, `30 bricks: 14347 ms`, pour un seul départ ;
  - rangs de 3 briques à 3 dépendances : `12 ranks: 7 ms`, `14 ranks: 66 ms` ;
  - `parseFiche, 40000 unterminated '<!--': 2507 ms`, `80000: 9810 ms`.
- **Portée** : échec fermé par délai, pas un faux vert.
- **Correction** : parcours en profondeur à trois couleurs avec ensemble visité ; retrait des commentaires par balayage linéaire ; `timeout-minutes`.

**F9 — Clés YAML dupliquées acceptées, la dernière gagne.**
- **Lieu** : `briques.ts:662`.
- **Commande** : `bun p1-status.ts`.
- A12 : `autonomie: modify` puis `autonomie: govern` → `GREEN`.
- A13 : un premier `preuve:` vers une cible absente, puis `preuve: []` → `GREEN`.
- **Correction** : refuser les clés dupliquées par un contrôle du texte, ou le dire dans le README.

**F10 — Divergences de grammaire avec le gate des citations, hors F2.**
- **Commande** : `bun p2-proofs.ts`.
- P6, P7 : `…catalog.v1.json.` et `"…catalog.v1.json!"` → verts ici ; le gate des citations résout `…catalog.v1.json`, donc un autre chemin que celui enregistré.
- P9, P10b : scalaire entre apostrophes et liste en style flux → verts ici, `rejected` là-bas (rouge croisé, fermé).
- **Correction** : la même que F2.

**F11 — Des tests ne verrouillent pas la règle qu'ils nomment.**
- **Méthode** : substitution no-op dans une copie, puis les deux suites.
- **Commandes et sorties** : `bun p5-mutants.ts` → `mutants: 70 = 49 killed + 21 survived + 0 broken pattern` ; `bun p5b-mutants.ts` → `mutants: 22 = 13 killed + 8 survived + 1 skipped`.
- **Survivants porteurs** :
  - N03 : le test « …and « toujours » is not « jours » » (`briques.test.ts:594`) passe avec `jours?` retiré de la liste ;
  - M30, M30c : `abandon` n'est pas scanné ; seul « mois » est exercé ;
  - M32, M33 : dates futures de `retrait` et d'`origine` ;
  - N09 : YAML invalide rendu vert ;
  - N05, N07, N08 : fichier de couche, répertoire de couche ou README lus quel que soit leur type (seule la fiche-lien est testée) ;
  - M55 à M63 : neuf contraintes du schéma retirées sans rouge, sur dix essayées ;
  - M48, N20 : drapeaux `ownRuleVerified` ;
  - M51 : tolérance de date ;
  - M15c : sha en majuscules ;
  - N21 : registre illisible, côté processus.
- **Équivalents** : M47 (toute carte verte donne le même statut), M02 et M19b (le rouge est donné par une autre règle).
- **Correction** : un vecteur invalide par contrainte du schéma et un cas rouge par survivant.

**F12 — Écarts entre le code et ce que disent l'ADR, le README et le code lui-même.**
- **(a)** `briques.ts:439` annonce « at any depth » ; le contrôle ne lit que les clés directes d'une brique. A8, A9 et A17 sont refusés par `additionalProperties`, pas sous le nom D4.
- **(b)** `briques.ts:95-96` et `:947` impriment `3 verified (gouvernance, fabrique, produit)` ; la seconde moitié de la règle `gouvernance` est seulement comptée (précision 8).
- **(c)** La précision 9 motive les deux briques produit par « un ADR de sortie de gel et une charte » ; le gate n'exige que la charte. I9 (`PRD-03`, charte saisie, `decisions: []`) sort `GREEN`.
- **(d)** L'en-tête de `pinned-citations.yml` dit encore « of docs/ » alors que le périmètre liste `ecosystem/briques/` (hors diff).

**F13 — Du texte de données est imprimé tel quel sur un run rouge.**
- **Lieu** : schéma `nom`, lignes 74-78 (pas de motif), `briques.ts:845`.
- **Commande** : `bun p6-misc.ts`, sonde N1.
- **Entrée** : `nom: "Sonde\n::error file=ecosystem/briques.ts::forged annotation"`.
- **Sortie** : `printed lines starting with '::' : 1`.
- **Inféré, non exécuté** : l'interprétation de cette ligne comme commande de workflow par le runner.
- **Correction** : motif sans caractère de contrôle sur `nom`, ou `JSON.stringify` des valeurs dans les messages.

### Non bloquant

- **F14** — `preuve` n'a pas `uniqueItems` : L23, la même preuve deux fois → `2 proof(s) held`.
- **F15** — L19, date `0001-01-01` acceptée. L25, n'importe quelle décision du registre (`D01`) rend `retiree`. I11, une brique retirée reste dépendance admise. README absent : `GREEN — + 0 README`.
- **F16** — `check-briques.ts:109` : `find` prend le premier `0042-*` dans l'ordre du répertoire. S15, deux fichiers `0042-*` → `exit=0`. Le cas où le second est lu en premier est inféré, non exécuté.
- **F17** — Tolérances des lecteurs (`bun p8-parsers.ts`) :
  - `parseInvariants` tient pour « en vigueur » `_Retiré_`, `~~…~~ Retiré`, `RETIRÉ`, `Abrogé` ;
  - il ne lit pas `I-100` ni une ligne `| **I-35** |` ;
  - `parseCatalogue` lit un titre « Hors catalogue d'applications » et `P06bis`.
  - Aucune de ces formes n'existe dans l'arbre.
- **F18** — Dérivation du nom du dépôt, faux rouges fermés : origine `…/Project-Governance` → toutes les preuves locales « not a carrier » ; alias SSH et fork → « could not be derived ».
- **F19** — `brick-map.yml` lance `bun install` sans `persist-credentials: false` ; 6 workflows voisins le portent.

## Sondes sans constat

- **Statut saisi dans le YAML** : 15 formes refusées — A1 à A11, A17, A18, K1, K2 (casse, `État`, clé à espace, imbriqué, `<<` direct et par alias, clé de tête, second document, `__proto__`, `constructor`).
- **Table D1** : `pairs judged: 110 = 110 agree with the ADR table + 0 disagree`, la table étant relue de l'ADR par un lecteur indépendant. `produit → produit` rouge.
- **Cycles** : 5 formes, dont un cycle masqué par un autre, plus une boucle entre couches : chacune nomme au moins un cycle.
- **Preuves locales refusées** : 12 — absente, `docs/`, absolue, `..`, `..` interne, `./`, antislash, date future, date impossible, porteur absent, retrait avec preuve fausse, lien pendant.
- **Preuves épinglées refusées** : 15 — P8, P11 à P24 (suffixe de ligne, sha court, majuscules ou suivi d'un caractère, sans chemin, sans deux-points, branche, organisation ou dépôt en autre casse, `.git`, forme action, dépôt privé, non porteur, ce dépôt, `..`).
- **Disque et code de sortie** : 11 cas en `exit=1` — S3, S4, S8, S8b (EACCES non rattrapé), S8c, S11 (via `bun run check:briques`), S12, S12b, S13, S14, S14b.
- **Origine** : 12 formes d'URL, 5 vertes qui nomment toutes ce dépôt, 7 rouges ; aucune dérivation fausse vers un vert.
- **Classement des entrées** : 12 entrées étrangères, toutes refusées.
- **Compteurs** : `entries=122 parts=122` ; sur une carte rouge `entries=124 parts=124` ; `briques=99` égal aux quatre ventilations ; `proofs declared=120 held=120` ; `assertions=118`.
- **Doctrine** : 7 refus — I1 (I-35 retiré), I2, I3, I5, I6, I7, I10.
- **YAML** : document multiple refusé (`/: must be object`) ; alias imbriqués sur 22 niveaux → `YAML Parse error: Excessive aliasing`.
- **Câblage**, sur une copie indexée :
  - `Data-file inventory verified: 56 assertion(s) hold … 0 undeclared` ;
  - biome sur les 6 fichiers relus : exit 0 ;
  - `tsc --noEmit` : exit 0 ;
  - `Dead code verified: 3 assertion(s) hold` ;
  - `check-review-evidence.test.ts` : `64 pass / 0 fail` ;
  - schéma présent dans les deux listes de la surface gardée ; `pinned-citations.v1.json` déjà gardé.

## Ce que la passe exclut

- L'exécution réelle du workflow sur GitHub Actions, et le gate sous le Bun épinglé de la CI.
- La résolution réseau des 72 citations épinglées (`check:pinned-citations` non lancé).
- Le contenu rédactionnel des fiches et la pertinence des preuves citées.
- `tools/quality/check-pinned-citations.ts` au-delà de sa grammaire de lecture.
- Tout générateur de page.
- Linux : les sondes de liens et de casse ont tourné sur macOS/APFS.

## Modèle

Fable 5.2 (`claude-fable-5-2`).
