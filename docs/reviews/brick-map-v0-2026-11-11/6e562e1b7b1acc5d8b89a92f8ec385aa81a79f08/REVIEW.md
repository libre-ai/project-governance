
# Revue adverse, passe 2 — gate « carte des briques », `libre-ai/project-governance`

## Verdict : `approve-with-minor-reservations`

Aucun faux vert atteignable sur un checkout de CI n'a été trouvé sur la dérivation de `en_cours`. Les trois faux verts de la première passe (F1, F2, F3) sont refusés par sonde exécutée. Restent cinq constats mineurs (G1 à G5) et sept non bloquants (G6 à G12).

## Identité de la passe

- **Commit relu** : `6e562e1b7b1acc5d8b89a92f8ec385aa81a79f08`, identique en fin de passe.
- **Worktree** : `git status --short` rend `?? node_modules` au début et à la fin ; `git diff --stat` vide, aucun stash.
- **Bun local** : `1.4.4-canary.1+963452075`. Rien n'a été mesuré sous `1.4.0-canary.1+57f349f63` (CI).
- **Gate** : exit 0, `Brick map verified: 118 assertion(s) hold — 99 brick(s) in 11 of 11 layer file(s) … 111 tracked entry(ies) … = 11 layer file(s) + 99 fiche(s) + 1 README + 0 refused; status derived: decrite 25, en_cours 74, prototypee 0, retiree 0 … proofs held: 48 on this tree, 71 pinned`.
- **Suites** : `148 pass / 0 fail / 231 expect() calls`, au début et à la fin.
- **Empreintes SHA-256**, identiques au début et à la fin :

```
e2293d47d8d06d6c90a15152e3b050102989cd7c28fd025a0ceb6bb0061cb939  ecosystem/briques.ts
a7dba1b2cecf4bb85d2d5847bcd89f0855d725c3550159679b7f866897f89591  ecosystem/check-briques.ts
8de3a71cb46439ebcfdeef9e7ff3acb471332e1b87859848367cd3e8872c2380  ecosystem/schemas/brique.v1.schema.json
eac259429a815f4190d5d9e7098a2f13c3e614c65270ccf8d71e1d22c9a4f199  ecosystem/briques.test.ts
b576e705c0a0f5ff9eba0fd18b9cd4050e7bf1a99f42ba5d83c3b499ea0a3339  ecosystem/check-briques.process.test.ts
63eeb95e73616d1dd65b6ccc8ce1385e2f2e4d87fee4068ac8bcc9ba7d7e832b  ecosystem/fixtures/briques/vectors.v1.json
77bd8d000efc630303c5c3ac316ef00caf1faff5419671f2d6f87fe306ecc355  .github/workflows/brick-map.yml
ac3ddee5ba61b37cd78e1b79cf37653130cb8c2fb983fe0b73050c193b3b07b2  package.json
f5a03f82609771595ace64bb1b9a1e7678fb5d21f555f553770da33d7cc58834  tools/quality/pinned-citations.v1.json
6712807ab038f5a88ef85ec6d931c03e19dbe232af08f5742a397963e0151482  tools/quality/check-review-evidence.ts
a27c5e113b8ece93d7d9b4b81aa1d271e8e4513c12766b53dcb7722c8ce39490  tools/quality/check-review-evidence.test.ts
b15382a9ac8d06bc3bcc05b073e1e799300c70362dca03e7b240a3ea07a8b905  tools/quality/check-data-inventory.ts
59249d5cb0d51ca96b1bbecd1ea796613df0cf87439e89578742134627b20f02  .github/workflows/pinned-citations.yml
```

**Rejouer** : `cd <espace de sonde> && bun <script>`.
- Scripts : `lib.ts`, `a1.ts`, `a4.ts`, `b2.ts`, `b3.ts`, `c1.ts`, `o1.ts`, `p1.ts` (argument `F1`, `F3`, `F7` ou `B`), `mutants.ts` (sortie conservée dans `mutants.out`).
- `full/` est la copie indexée ; les copies par sonde sont effacées et se recréent.
- Témoin : une brique `IDN-90` ajoutée à `identite.v1.yaml` avec sa fiche ; seule, elle sort `GREEN decrite, 0 proof(s) held`.
- Nettoyage final : l’outil de nettoyage du harnais.

## Partie A — constats F1 à F19

| Constat | Sonde | Sortie sur ce commit | Classement |
| --- | --- | --- | --- |
| F1 preuve locale par `existsSync` | `bun p1.ts F1` : témoin + 13 cibles (`docs`, `docs/adr`, `ecosystem/briques`, `node_modules/ajv/package.json`, `.git/config`, fiche, fichier de couche, `readme.md`, `agents.md`, lien suivi, chemin traversant un lien suivi, non suivi, vide) | témoin `exit=0` ; 13 fois `exit=1` : `is not a tracked file of this repository`, `is part of the map itself`, `is a symbolic link, and a link is not followed`, `is an empty file` | fermé (résidu local : G1) |
| F2 citation invisible du lecteur | `bun a1.ts`, P2 à P5 | 4 fois `RED … the pinned-citations gate does not read this citation in the text of the layer file` | fermé |
| F3 `ecosystem/briques` en lien | `bun p1.ts F3`, S1, S2, plus répertoire de couche, fichier de couche, README en lien indexé | `exit=1 … : . (link)` ; `identite (link)` ; `identite.v1.yaml (link)` ; `README.md (link)` | fermé (lien non indexé `exit=0` : G1) |
| F4 statut en prose | `bun a1.ts`, 10 formes | préambule, second titre, `Prototypee`, `EN_COURS`, `en\_cours`, `nom`, `role`, `jetable` : RED ; `prototypée`, `en cours` : GREEN | fermé pour 8 ; 2 fermés autrement (ADR ligne 59 les déclare mots du français courant, texte exact) |
| F5 citation exemptée | `bun a1.ts`, S16 | `RED … is exempted in the pinned-citations configuration` | fermé |
| F6 mots de délai | `bun a1.ts`, 14 chartes sur `PRD-03` | « mise à jour », « Le jour où », « toujours » : GREEN ; « du mois », « jours », « semaines », « bientôt », « rapidement » : RED ; « dans un an », « prochain trimestre », « d'ici 2027 », « le temps », « sous 48 h » : GREEN | fermé autrement. Liste = `docs/reviews/product-charters-2026-11-09/REVIEW.md:51`, plus la graphie `bientot` et l'insensibilité à la casse. Le plancher est déclaré dans `briques.ts:222-228` seulement, ni dans l'ADR ni dans le README |
| F7 faux rouges de lecture | `bun a1.ts` F13, F14 ; `bun p1.ts F7` S7 | GREEN, GREEN, `exit=0` | fermé (résidu : G10) |
| F8 coût | `bun b2.ts`, section T ; lecture du workflow | `findCycles` dense 1100 briques : 16 ms ; 400 000 `<!--` non fermés : 0 ms ; `timeout-minutes: 10` (`brick-map.yml:31`) | fermé (résidu : G8) |
| F9 clés dupliquées | `bun a1.ts`, A12, A13 | GREEN deux fois | fermé autrement : README ligne 14. Exact sous Bun 1.4.4 (A13, la dernière gagne) ; non mesuré sous le Bun de la CI |
| F10 grammaire | `bun a1.ts`, P6, P7, P9, P10b | 4 RED | fermé |
| F11 tests | `bun mutants.ts` | `177 = 137 tués + 40 survivants` | partiellement fermé (voir « Mutants ») |
| F12 textes | lecture, plus A8, A9, I9 | (a) `briques.ts:503-507` corrigé, A8 et A9 refusés par `additionalProperties` ; (b) volume « for gouvernance, its dependency half » ; (c) ADR ligne 61, I9 GREEN ; (d) en-tête de `pinned-citations.yml` à jour | fermé autrement, textes exacts |
| F13 caractères de contrôle | `bun a1.ts`, N1 à N5 | 5 RED par `pattern` | fermé pour `nom` et les phrases ; deux autres canaux ouverts (G4) |
| F14 preuve en double | `bun a1.ts`, L23 | `RED … must NOT have duplicate items` | fermé (résidu : G9) |
| F15 divers | `bun b2.ts` Y17 ; `bun a1.ts` L25, I11 ; `bun a4.ts` README | date `0001-01-01` : GREEN ; retrait `D01` : GREEN ; dépendre d'une retirée : `RED depends on IDN-91, which is withdrawn` ; README absent : GREEN, `+ 0 README` | I11 fermé ; les trois autres non traités. Le retrait est déclaré (ADR ligne 58) ; la date et le README ne le sont pas |
| F16 deux fichiers `0042-*` | `bun p1.ts F7`, S15, S15b | `exit=1 … 0 product(s) read from the catalogue table` deux fois | fermé |
| F17 tolérances des lecteurs | `bun a4.ts` | `_Retiré_`, `RETIRÉ`, `**Retiré**` : retiré ; `I-100` lu ; « Hors catalogue » : `[]` ; `P06bis` non lu ; `~~Texte~~ Retiré`, `Abrogé` : en vigueur ; `\| **I-35** \|` non lu | partiellement fermé ; 3 formes non traitées, non déclarées, absentes de l'arbre |
| F18 nom du dépôt | `bun p1.ts F7`, 5 origines | `Project-Governance` : `exit=1 … not a carrier` ; SSH `.git` : `exit=0` ; alias et fork : `exit=1 … could not be derived` | non traité, non déclaré ; échec fermé |
| F19 `persist-credentials` | lecture de `brick-map.yml:36-38` | `persist-credentials: false` | fermé ; workflow non exécuté |

## Constats nouveaux

### Bloquant, majeur
Aucun.

### Mineur

**G1 — L'index donne les noms et les modes ; le contenu, la taille et la liste des ADR viennent de la copie de travail.**
- **Lieu** : `ecosystem/check-briques.ts:87-93` et `:186` (`readFileSync`), `:176` (`statSync`, qui suit les liens), `:126` (`readdirSync` de `docs/adr`).
- **Commande** : `bun p1.ts B`, et `bun p1.ts F3` pour S1b et S3.
- **Entrées, toutes `exit=0`** :
  - B1a : fiche indexée avec `Statut : en_cours.`, corrigée sur disque sans `git add` (`git status` : `AM`).
  - B1c : YAML indexé avec `cible: docs/absent.md`, corrigé sur disque seulement.
  - B2a : cible indexée vide (`e69de29…`), non vide sur disque.
  - B2b : cible en `git add -N`.
  - B3a : cible suivie remplacée sur disque par un lien vers `/etc/hosts`.
  - B4 : répertoire parent de la cible remplacé par un lien vers `/etc`.
  - B5 : fiche suivie remplacée par un lien vers un fichier hors arbre.
  - B14 : `docs/adr/9999-fantome.md` non suivi, cité comme `ADR-9999`.
  - S1b, S3 : `ecosystem/briques` ou `ecosystem` remplacé par un lien non indexé.
- **Attendu** : rouge, ou un compteur imprimé des entrées dont la copie de travail diffère de l'index.
- **Portée** : locale seulement. `bun install` ne lance aucun script de cycle de vie (aucun `postinstall` dans `package.json`), donc sur un checkout de CI l'index et le disque coïncident. L'annonce de l'auteur (« lues dans l'index avec leur mode ») est exacte pour les entrées et leur type, pas pour le contenu.
- **Correction** : lire les blobs dans l'index (`git cat-file --batch` sur `:<chemin>`), ou échouer quand `git diff-files --quiet` sur la carte et les cibles répond non ; prendre les numéros d'ADR dans `modes`, pas dans `readdirSync`.

**G2 — L'ADR cite une revue absente de l'arbre.**
- **Lieu** : `docs/adr/0064-brick-map-eleven-layers-derived-status.md:51`, « (`docs/reviews/brick-map-v0-2026-11-11/REVIEW.md`) : les points 5, 7 et 10 à 12 portent ses corrections ».
- **Commande** : `git ls-files docs/reviews | grep -i brick`, et `grep -rn "brick-map-v0" .` hors `node_modules`.
- **Sortie** : aucun fichier ; une seule occurrence, la ligne de l'ADR.
- **Attendu** : le fichier présent au commit qui le cite.
- **Correction** : livrer la revue dans la même pull request, ou retirer le renvoi. La rattache du point 12 à cette revue n'a pas pu être vérifiée : le rapport F1 à F19 ne parle pas de l'origine.

**G3 — « La fiche le nomme » est satisfait par une mention qu'un lecteur ne voit pas.**
- **Lieu** : `ecosystem/briques.ts:432-445` (un commentaire non fermé reste du texte), `:587-597`, `:1024-1038`.
- **Commande** : `bun b2.ts`, section N.
- **Entrées, toutes GREEN**, la phrase qui nomme étant retirée :
  - N2 : `<!-- IDN-02 I-09 ADR-0009` non fermé en fin de fiche.
  - N3 : `[//]: # (IDN-02 I-09 ADR-0009)`.
  - N5 : `<span title="IDN-02 I-09 ADR-0009"></span>`.
  - N7 : les identifiants dans `nom`, donc dans le titre.
  - N9 : la décision `D10` du registre « nommée » par « ADR-0042 D10 ».
  - N6c : `IDN-02-bis` nomme `IDN-02`.
- **Témoins rouges** : N0 (rien), N1 (commentaire fermé), N6, N6b, N6d.
- **Attendu** : rouge pour N2, N3, N5.
- **Inféré, non exécuté** : l'invisibilité au rendu (aucun moteur Markdown lancé).
- **Correction** : pour cette règle, retirer aussi les définitions de lien, les balises HTML et un `<!--` non fermé jusqu'à la fin ; sinon dire dans le README que la règle est un plancher.

**G4 — Deux canaux de données impriment encore une ligne forgée.**
- **Lieu** : `ecosystem/briques.ts:495-501` (`renderSchemaError` imprime le nom de la clé inconnue), `:761` (chemin d'une entrée refusée).
- **Commandes** : `bun p1.ts B` (B9b), `bun o1.ts`.
- **Entrées** : un fichier suivi `ecosystem/briques/x⏎::error title=forged::…` ; une clé YAML `"x\n::error title=forged::…": 1` dans une brique.
- **Sortie** : `exit=1`, et dans les deux cas une ligne de sortie commençant par `::error title=forged::` (`lignes de sortie commençant par « :: » : 1`).
- **Attendu** : aucune ligne commençant par `::`, ce que la description de `phrase` dans le schéma annonce.
- **Inféré, non exécuté** : la lecture de cette ligne comme commande par le runner.
- **Correction** : échapper les caractères de contrôle en un seul point, au moment où une valeur de données entre dans une note, plutôt que champ par champ dans le schéma.

**G5 — 36 mutants non équivalents survivent** : détail sous « Mutants ». Le test nommé « what the YAML cites, the fiche names — a dependency, an invariant, a decision » (`briques.test.ts:685`) n'exerce aucune dépendance.

### Non bloquant

- **G6 — Formes de statut que la règle ne voit pas** (`briques.ts:234`). `bun b2.ts`, section S, toutes GREEN :
  - `en&#95;cours`, `en<b>_</b>cours`, `en_` suivi d'U+200B ;
  - `<!---> Statut : en_cours <!-- x -->` ;
  - `en-cours`, `en__cours`, `en*_*cours`, homoglyphe cyrillique.
  - Le rendu identique à la valeur est inféré, non exécuté.
- **G7 — Titres rendus que le gate ne compte pas** (`briques.ts:457-463`). `bun b3.ts`, H1 à H5, toutes GREEN : section derrière une clôture indentée de 4 espaces, `##` indenté d'un espace, titres setext de niveau 1 et 2, `<h2>`. Le README annonce « une seule fois » et « quatre sections ».
- **G8 — `parseFiche` n'est pas linéaire** (`briques.ts:463`). `bun b2.ts`, section T : titre `# x` suivi de n espaces puis `x` : 15 ms pour 5 000, 234 ms pour 20 000, 3 571 ms pour 80 000. Échec fermé par le délai du workflow.
- **G9 — Règles énoncées, non vérifiées, non déclarées comme telles.**
  - « Sa date est celle du dernier commit » (README lignes 34-35, ADR ligne 57) : Y17, date `0001-01-01`, GREEN.
  - Même cible deux fois avec deux dates : Y18, `2 proof(s) held`.
  - README absent du suivi : GREEN.
- **G10 — Faux rouges, tous fermés.**
  - R9 : clôture de 4 accents graves contenant une clôture de 3, lue comme fermée.
  - R6 : fiche avec BOM.
  - R13, Q5 : `textsOf` balaie aussi `cible` et `depots`, donc `docs/en_cours/x.md` ou un dépôt `libre-ai/retiree` sont refusés comme statut ; aucun chemin suivi ne porte ces mots aujourd'hui (`git ls-files | grep` : 0).
  - E1 : lancé depuis `ecosystem/`, `exit=1`, `0 brick(s) in 0 of 11` (`process.cwd()` au lieu de la racine git).
  - Le schéma admet `I-[0-9]{2}` alors que `parseInvariants` lit `I-100`.
- **G11 — Citation en clair seulement dans un commentaire YAML** (`briques.ts:683`). Y4 : valeur écrite `"libre-\u0061i/…"`, citation en clair dans un commentaire de la même couche : GREEN. La même chaîne est bien lue par le gate des citations ; l'écart est avec le README ligne 35, « écrite telle quelle, sans échappement ».
- **G12 — Index en conflit accepté.** B8b : trois étapes non fusionnées sur la fiche, la dernière en `100644` : `exit=0`.

## Sondes sans constat

- **Index** : 12 rouges — mode `120000` simulé sur fiche et sur cible, sous-module sous la carte et en cible, conflit dont la dernière étape est un lien, nom à espace, nom à guillemet, fichier de couche absent du disque, fiche non suivie, `.git` absent, lien et fichier sous le lien (refusé par git lui-même). Cible au nom non ASCII suivie : GREEN, légitime.
- **Disque** : 3 rouges — fiche mauvaise sur disque, cible devenue répertoire, cible supprimée.
- **YAML et lecteur de citations** : 15 — ancre et alias, scalaire plié, littéral, autre citation en commentaire, date non citée, `!!str` : GREEN légitimes ; preuve échappée parmi deux, citation dans la fiche seulement, suffixe de lignes, sha de 7, forme action, dépôt privé, `@main` en prose, document double, organisation en autre casse : RED.
- **Recomptage indépendant** : `preuves épinglées dans le YAML décodé: 71; citations pinned lues par scanText: 71; rejetées: 0; preuves absentes de scanText: 0`.
- **Dépendances et retrait** : 7, dont vivante vers retirée RED et retirée vers retirée GREEN.
- **Statut saisi dans le YAML** : clé à la racine, `Statut`, `statut_derive`, `phase` : 4 RED.
- **Compteurs** : `briques=99` égal aux quatre ventilations ; `preuves déclarées=119 tenues=119` ; `assertions=118 = 6 + 1 + 11 + 99 + 1` ; carte rouge `114 = 11 + 99 + 1 + 3 refused`.
- **Injection** : 5 sondes à 0 ligne forgée (YAML invalide, ESC dans un titre et dans une cible, CR dans un titre de section, `couche`).
- **Environnement** : `GIT_INDEX_FILE` inexistant et `GIT_DIR` d'un autre dépôt : `exit=1`.
- **Câblage**, sur la copie indexée :
  - `Data-file inventory verified: 56 assertion(s) hold` ;
  - `Dead code verified: 3 assertion(s) hold` ;
  - `biome ci` sur 6 fichiers : aucune correction ;
  - `tsc --noEmit` : aucune sortie ;
  - `check-review-evidence.test.ts` : `64 pass / 0 fail` ;
  - `bun run check:briques` : exit 0 ;
  - schéma présent dans les deux listes de la surface gardée ; `check:briques` absent de la chaîne `check`.
- **Sondes sans valeur** : B13 et Q3, écrites sans effet, non comptées.

## Mutants

`mutants: 177 = 137 tués + 40 survivants + 0 en erreur + 0 motif cassé`.

**Survivants de la première passe.** Tués : N03, M30, M30c, M32, M33, N09, N05, N07, N08, M48, N20, N21. Encore survivant : M51 (tolérance de date). Devenu équivalent : M15c. Schéma : 17 survivants sur 42 essayés.

**Équivalents, 4** : `E-filtre-epingle`, `E-sha-majuscules` (le rouge vient du lecteur de citations, sonde Q1), `R-statut-declare`, `X-git-echec`.

**Survivants, 36** — règle neutralisée, puis test qui aurait dû rougir :

| Mutant | Règle | Test attendu |
| --- | --- | --- |
| `D-lookahead`, `D-casse` | borne droite et casse des mots de délai | `charte.%s … names a delay` : aucun cas « Bientôt », aucun mot prolongé |
| `S-lookbehind`, `S-lookahead` | bornes du statut en prose | `a fiche that writes a status %s is refused` : aucun cas `indecrite`, `en_cours_de` |
| `S-commentaires-dans-prose` | retrait des commentaires avant statut et nommage | aucun test d'un statut ou d'un identifiant dans un commentaire fermé |
| `S-textsOf-tableaux` | statut dans un tableau du YAML (`refus`, `preuve`) | aucun |
| `N-sans-depend` | dépendance non nommée | `what the YAML cites, the fiche names` |
| `N-avant`, `N-avant-tiret` | borne gauche de `names` | même test : seul `D01` contre `D013` est exercé |
| `P-fermeture-meme-cloture` | une clôture se ferme par la même | `fiche: a heading inside a fenced code block is not a heading` |
| `R-retiree-sans-exception` | une retirée peut dépendre d'une retirée | `a brick does not depend on a withdrawn brick` |
| `X-autre-fichier`, `X-executable` | modes `160000` et `100755` | suite de processus : aucun |
| `X-cible-isFile` | cible suivie devenue autre chose qu'un fichier | `a proof target that is %s does not hold` |
| `X-exemptions-lues`, `X-config-illisible`, `X-depots-illisibles` | lecture des exemptions ; configuration ou inventaire illisible | suite de processus : aucun |
| `X-tolerance-date`, `X-tolerance-zero` | borne « demain » | suite de processus : aucun |
| 17 du schéma | `nom` min et max ; `phrase` max ; `cible` min et max ; unicité de `depend_de`, `decisions`, `depots`, `refus` ; `refus` non vide ; `retrait` et `charte` requis et fermés ; racine requise et fermée ; origine `inspection` fermée | `the schema vectors` : aucun vecteur invalide par contrainte |

## Ce que la passe exclut

- Le gate et `Bun.YAML` sous le Bun épinglé de la CI : clés dupliquées, échappements, dates non citées.
- L'exécution des deux workflows sur GitHub Actions.
- La résolution réseau des 71 citations (`check:pinned-citations` non lancé).
- Tout rendu Markdown : les mentions « invisible » ou « rendu » de G3, G6, G7 sont inférées.
- Linux : liens, casse et noms de fichiers sondés sur macOS/APFS.
- Le contenu rédactionnel des fiches, le générateur de page, `check-pinned-citations.ts` au-delà de `scanText`, `exemptionKey`, `validateCitedPath`, `validateConfig`.

## Écarts à la consigne

- `o1.ts` a été créé par un heredoc shell et non par Write.
- L'espace de sonde est laissé en place avec ses scripts et `full/` ; `copies/` et `outside-map/` sont effacés par `scratch-clean`.
- Un répertoire `Library/` y est apparu, `HOME` des processus fils étant redirigé vers cet espace.

## Modèle

Fable 5.2 (`claude-fable-5-2`).
