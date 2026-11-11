
# Revue adverse, passe 4 — page vision générée, delta `fa6a085..3b336dd`

## Verdict : `reject` au sens du protocole, pour la seule licence ouverte ; hors licence, `approve-with-minor-reservations`

Rapport rendu en texte par un sous-agent à contexte neuf, reproduit tel quel sous ce titre. Les chemins de sonde qu'il cite sont ceux de son répertoire temporaire : ils ne sont pas dans ce dépôt.


Verdict au sens du protocole : `reject`
Verdict hors question de licence : `approve-with-minor-reservations`

**Règle appliquée.** ADR-0056 D2 clause 3 (`docs/adr/0056-…md:190-191`) n'admet aucune « preuve requise » ouverte sous `approve` ni `approve-with-minor-reservations`. La licence de la page en est une, déclarée ouverte (`docs/reviews/vision-page-2026-11-11/REVIEW.md:57`) : elle interdit à elle seule l'approbation. Hors licence, aucun constat de cette passe n'est `blocking` ni `major`, et aucun n'est disposé « preuve requise ». Les deux constats disposés « défaut bloquant » sont de gravité `minor` (deux phrases du dossier) ; je lis la clause 1 de D2 (« la gravité garde le poids ») comme les rendant compatibles avec des réserves mineures. Si le propriétaire lit « défaut bloquant » comme conditionnant la fusion quelle que soit la gravité, la seconde ligne devient `reject` jusqu'à correction de ces deux phrases.

Sondes : `/tmp/claude-502/scratch/revue-vision-4.otEcoR/` (laissé en place). Clones à moi : `copie/` (preuves), `prev/` (`fa6a085`), `mut/` (mutations), `amb/` et `amb-wt/` (hook, rebase), `inv/`, `temoins/*`, `wf.*/c*` (job).

## 1. Métadonnées

- **Commit relu** : `3b336dd8a2e0d2e0525113aa626cbc266e2517f6` (`git rev-parse HEAD`).
- **Dernier head revu** : `fa6a085d7b048343e35d7df5081cc08b4589055b` (`HEAD~1`).
- **Base** : `f806dd8c81863405b6cf1b03bd7ad202af0f9191` (`git merge-base HEAD origin/migrate/recover-code`).
- **Clone au début** : HEAD `3b336dd…`, `git status --short | wc -l` = 0, `git ls-files | wc -l` = 933.
- **Clone à la fin** : HEAD `3b336dd…`, 0, 933. Empreinte de `.git/index` identique au début et à la fin : `bed517b7…8550e` (`shasum -a 256 .git/index`).
- **Versions** : Bun local `1.4.4-canary.1+963452075` ; la CI épingle `1.4.0-canary.1+57f349f63` (`.github/workflows/brick-map.yml:49,74`). Git local `2.56.0`.

Empreintes (`git ls-tree HEAD …`) :

| Fichier | Blob |
| --- | --- |
| `.github/workflows/brick-map.yml` | `df38b1723efbc9885f75460dfb545c45cfa464f0` |
| `distribution/build-vision.test.ts` | `01c76a49a99019c7f43827b6183306e588bc4123` |
| `distribution/build-vision.ts` | `13c98e330a9c25222209de9e61a4c7472e9a1258` |
| `distribution/vision/index.html` | `260d0e41ac54d77684c3bb699656f206a7d237ef` |
| `distribution/vision/vision.css` | `d8200072235ef6100e32af608d68d292f11e9419` |
| `docs/adr/0064-brick-map-eleven-layers-derived-status.md` | `d13be75b0fc6210bb7f06683e9ed4b54f06e7ead` |
| `docs/reviews/vision-page-2026-11-11/REVIEW.md` | `37368c40d40873c65f0e2d0bcb5433e50a2697e8` |
| `docs/reviews/vision-page-2026-11-11/evidence/mutations.json` | `5f1258e8eeafdeecd98f2ead9090ba73ddffa08a` |
| `ecosystem/briques.ts` | `cafc7dd85bee6d03c0bc66883acf0a3849a40a64` |

Commandes de preuve, lancées dans `copie/` (même HEAD, origine posée sur l'URL GitHub) pour ne rien écrire dans le clone relu :

| Commande | Résultat |
| --- | --- |
| `bun test distribution/build-vision.test.ts` | pass : 43 pass, 0 fail, 201 expect |
| `bun test ecosystem/briques.test.ts ecosystem/check-briques.process.test.ts` | pass : 205 pass, 0 fail, 318 expect |
| `bun run check:briques` | pass : « 119 assertion(s) hold — 99 brick(s) in 11 of 11 layer file(s) », decrite 26, en_cours 73 |
| `bun run check:doctrine` | pass : « 67 ADR file(s), 54 accepted from 0008 » |
| `bun run build:vision` puis `git diff --stat -- distribution/vision` | pass : diff vide, page non modifiée |
| `bun run check:data-inventory` | pass : « 58 assertion(s) hold — 933 tracked file(s) … 0 undeclared » |
| `bun run lint` | pass : rc 0, 1 avertissement, 15 infos ; `grep -c "build-vision\|briques\|brick-map" lint.out` = 0 |
| `bun run typecheck` | pass : rc 0 |

## 2. C-1 à C-11

| # | État | Sonde et sortie |
| --- | --- | --- |
| C-1 | **tenu** | Voir point 2 ci-dessous : 9 combinaisons de variables, hook de worktree lié, deux `rebase --exec` ; index et dépôt témoin inchangés partout. |
| C-2 | **tenu** | `FAB-13.md:5` réécrite ; `git ls-files distribution/vision \| wc -l` = 2 ; la phrase neuve est vraie du code (`build-vision.ts:381-389`, `:438-443`). |
| C-3 | **tenu** | La note 13 nomme `accepted`, `proposé`, `proposed` ; `standingOf` lit ces trois mots (`build-vision.ts:364-365`). |
| C-4 | **tenu** | « produite par PUB-01, dont les preuves sont son générateur et son contrôle de dérive » : `publication.v1.yaml:23-27` cite `distribution/build-vision.ts` et `.github/workflows/brick-map.yml`. |
| C-5 | **tenu sur ce que la passe 3 nomme**, quatre restes | Titres, en-têtes, libellés par champ, F17, F10, S4 : tous tués (point 6). Restent vivants W1, L18, L19, T26 (constat F-5). |
| C-6 | **tenu** | Lien symbolique (mode 120000) et nom fabriqué : rouges (point 3, s03, s03b, s05, s06). |
| C-7 | **tenu** | Dossier ligne 30 : « ni par l'inventaire ni par le job de dérive (`check:source` refuse déjà les quatre extensions JavaScript ; les autres passaient) ». Sonde `inv/` : `.py`, `.sh`, `.ts` suivis sous `distribution/vision/` → `check-data-inventory` rc 0, `check-source-policy` rc 0. |
| C-8 | **laissé et déclaré** | `REVIEW.md:53` déclare quatre sites ; message du commit : « four sites of the main block with no test ». Mes mutants M1 à M4 survivent. |
| C-9 | **tenu** | `REVIEW.md:3` : `Verdict: reject` ; le paragraphe ligne 12 est conforme à la clause 3 de D2. |
| C-10 | **laissé et déclaré** | Note 13 de l'ADR et `REVIEW.md:63`. Rejoué (`bun join-note13.ts mut`) : lignes jointes → « 55 accepted », rc 0 ; restauré → 54. |
| C-11 | **laissé et déclaré** | `REVIEW.md:49`. Le fichier reste hors répertoire de commit ; la déclaration d'inventaire (`check-data-inventory.ts:344-346`) dit toujours « under the commit each one reviewed ». |

## 3. Points 2 à 7

**Point 2 — C-1.**

- **Variables posées à la main** (`bun c1.ts`, suite lancée dans `copie/`, témoin = clone neuf de 933 fichiers par scénario). Pour `GIT_DIR`, `GIT_INDEX_FILE`, les deux, `GIT_WORK_TREE`, `GIT_DIR+GIT_WORK_TREE`, les trois, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY` : « 43 pass, 0 fail », témoin 933 → 933, empreinte d'index identique, `copie/` identique.
- **Contrôle de l'instrument** : même sonde `GIT_DIR` contre la suite de `fa6a085` (`prev/`) → « 41 pass », témoin 933 → 4 entrées, empreinte changée.
- **Hook `pre-commit` d'un worktree lié** (`amb-wt/`). Le hook reçoit `GIT_DIR=…/amb/.git/worktrees/amb-wt` et `GIT_INDEX_FILE=…/worktrees/amb-wt/index`. Suite 43 pass ; index 933 → 933, empreinte `05ee013b…` avant et après ; arbre du commit `8718ef6c…` inchangé.
- **`git rebase --exec`** : clone simple (aucune variable de redirection exportée) et worktree lié (`GIT_DIR` exporté, pas `GIT_INDEX_FILE`). 43 pass, 933 → 933, empreintes identiques dans les deux cas.
- **Autres variables, lecture par `readDecisionRecords`** (`bun env-read.ts copie`, un dépôt « asked » proposé, un dépôt « ambient » accepted). 29 scénarios, 28 lisent « asked ».
  - Aucun effet : `GIT_CEILING_DIRECTORIES`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_NAMESPACE`, `GIT_CONFIG_COUNT`/`KEY`/`VALUE` (`core.worktree`, `core.bare`), `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG`, `GIT_EXEC_PATH=/nonexistent`, les quatre `GIT_*_PATHSPECS`, `GIT_DISCOVERY_ACROSS_FILESYSTEM`.
  - `GIT_SHALLOW_FILE` : lève (`fatal: bad shallow line`), échec fermé.
  - Sans le filtre (`bun env-read.ts prev`) : `GIT_DIR` lit l'autre dépôt ; `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY` lèvent ; `GIT_WORK_TREE` et `GIT_PREFIX` ne changent rien.
  - Hors variable : une ref `refs/replace` dans le dépôt demandé fait rendre « accepted » pour un blob d'index « proposé » (constat F-8).
- **Écriture par la fixture** : elle ne reçoit que `PATH`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM` (`build-vision.test.ts:606-610`) ; aucune variable de l'appelant ne l'atteint (scénarios ci-dessus).
- **Le test qui modifie `process.env`**. Assertion forcée à l'échec dans `mut/`, test sonde ajouté derrière :
  - variables absentes au départ → `hasDir=false hasIndex=false` après l'échec ;
  - variables posées (`/preset/dir`, `/preset/index`) → remises à ces valeurs.
- **Concurrence** : entre l'affectation et le `finally`, le code est synchrone (`execFileSync`), sans `await`. Aucun `concurrent` dans le fichier, `bunfig.toml` ou `package.json`. Aucun autre test du fichier ne peut tourner pendant ce temps. `bun test --rerun-each 2` : 86 pass.

**Point 3 — contrôle des fichiers suivis.** Bloc `run:` extrait par `Bun.YAML` (`bun extract-run.ts`), rejoué par `bash --noprofile --norc -eo pipefail`. Avec `FRESH=1 bun wf.ts …`, les scénarios commités tournent dans un checkout neuf du commit, comme en CI. Compte : 30 rouges attendus, 1 rouge rc 129, 3 verts attendus, 2 écarts (`grep -E "^   rc=" out/wf-fresh.out | sort | uniq -c`).

- **Vert à raison** : rien de changé ; feuille de style éditée et commitée ; fichier non suivi ignoré par `.gitignore`.
- **Rouge à raison** :
  - `.js` et `.py` suivis ; fichier en sous-répertoire ;
  - lien symbolique à la place de la page, de la feuille de style, du répertoire lui-même ;
  - feuille retirée (index et disque, index seul, index seul et ignorée) ;
  - un fichier nommé comme les deux ; nom forgeant la deuxième ligne par un saut de ligne (git l'imprime `"…index.html\n100644 …vision.css"`, avec ou sans `core.quotePath=false`) ;
  - nom avec espace, saut de ligne, guillemet, non ASCII ;
  - page ou feuille exécutable (100755) ; gitlink (160000) à côté ou à la place de la feuille ;
  - conflit de fusion (étapes 1 à 3, ou 2 et 3) : rouge au contrôle de dérive ;
  - fichier neuf non suivi, vide ou non, ou déjà `--intent-to-add` : rouge au contrôle de dérive ;
  - page éditée à la main.
- **Faux rouge** : aucun trouvé.
- **Faux vert en CI** : aucun trouvé.
- **Deux verts hors CI**, sur des états qu'un checkout neuf ne porte pas :
  - s19 : fichier suivi en trop, supprimé du disque seulement → rc 0 (constat F-7) ;
  - s17 : bit local `assume-unchanged` puis édition → rc 0.
- **`--format` de `ls-files`** : l'aide du git local (2.56.0) liste l'option (`git ls-files -h`, ligne 37). Arrivée en 2.38 : de mémoire, non vérifiable hors réseau. Version de git du runner : non mesurée.
- **Git qui ne connaît pas l'option** (git factice rendant 129) : rc 129 sous `-eo pipefail`, rc 129 sous `bash -e`, rc 1 sans `-e` (`tracked` vide ≠ attendu). Échec fermé dans les trois cas. L'erreur dans la substitution de commande arrête donc bien l'étape.
- Le workflow ne déclare pas de `shell:` (`grep -n "shell:"` : rien). Le défaut de GitHub est alors `bash -e {0}` (de mémoire) ; le bloc n'a aucun tube.

**Point 4 — le dossier.**

Ce qui tient :
- Table des passes, récit de la passe 3 (un majeur, dix autres, « 932 à 4 »).
- « 107 mutations, 107 rouges » : `bun replay.ts mut …/mutations.json …` → `TOTAL 107 = killed 107 + survived 0 + inapplicable 0 + identical 0`, 43 pass avant et après ; chaque `find` exactement une fois ; 107 paires distinctes (`jq '[.[]|.find+"\u0000"+.replace]|unique|length'`).
- « les 94 premières » : préfixe identique à la liste de `fa6a085` (même empreinte `cb47c4f84617` des deux côtés).
- « 58 mutants dont 28 survivants » : somme de la table du rapport de passe 3 (7+5+4+6+4+20+6+6 = 58 ; 3+5+1+0+0+16+1+2 = 28).
- Licence, en appliquant la règle du fichier (« the last matching annotation wins », `REUSE.toml:5-6`), aucun en-tête SPDX dans ces fichiers (`git grep -l SPDX-License-Identifier -- ecosystem/briques distribution/vision distribution/feeds` : rien) :
  - `distribution/vision/index.html` → EUPL-1.2 par `distribution/**` ;
  - fiches `ecosystem/briques/**/*.md` → CC-BY-4.0 par `**/*.md` ;
  - `ecosystem/briques/*.v1.yaml` → EUPL-1.2 par `ecosystem/**`.
- Passe 1, C11 : « preuve requise (décision de périmètre) », plus petit contrôle = arbitrage du propriétaire (rapport de passe 1, lignes 103-105).
- `check-briques.ts` et `GIT_DIR` : avec `GIT_DIR` pointé sur un témoin, le générateur rend les violations du témoin (13 pour un témoin de deux fichiers, rc 1). Index et objets du témoin inchangés ; ses trois appels git sont `ls-files --stage`, `hash-object` sans `-w`, `remote get-url`.
- Ligne de verdict et son paragraphe : conformes aux quatre clauses de D2 (`0056-…md:187-193`).
- Rejeu du job par l'auteur (ligne 42) : les huit cas cités se reproduisent.

Ce qui ne tient pas : constats F-1, F-2, F-3.

Non exécuté : `reuse` (`uv run … reuse spdx` → `Failed to initialize cache at ~/.cache/uv … Operation not permitted`, bac à sable). Les licences ci-dessus sont lues dans `REUSE.toml`, pas calculées par l'outil.

**Point 5 — note 13, FAB-13, gate de doctrine.**
- Note 13 : trois mots, vrais du code ; « en vigueur » ne donne aucune page (premier mot `en`, `standingOf` rend `null`).
- « les joindre ferait compter cet ADR comme admis » : reproduit (54 → 55).
- Gate de doctrine : 54.
- FAB-13, deux phrases : vraies du code et de `publication.v1.yaml`.
- Balayage `git grep -n -i -E "page vision|distribution/vision|build-vision|page (générée|n'est|n'existe)" -- ecosystem/briques docs/adr/0064-*.md distribution/README.md vision.md README.md README.fr.md STATUS.md` : aucune phrase ne dit que la page n'existe pas. `distribution/README.md:7` est vrai du code.

**Point 6 — mes mutants.** `bun replay.ts mut own-mutants.json …` → `TOTAL 71 = killed 61 + survived 10`. `own-mutants-2.json` → `TOTAL 30 = killed 23 + survived 7`.

| Cible | Tués | Survivants |
| --- | --- | --- |
| Un libellé par champ (22) | 20 | 2 : paragraphe de rôle d'une couche remplacé par son libellé (L18) ; titre `<h3>` d'une couche en slug (L19) |
| Titres, en-têtes, régions, texte fixe (26) | 25 | 1 : `meta viewport` (T26) |
| Une couche, une brique par ligne (6) | 6 | 0 |
| `readDecisionRecords` (17) | 10 | 7 : quatre noms retirés un à un de la liste (R3 à R6) ; liste réduite à `GIT_DIR` et `GIT_INDEX_FILE` (R14) ; pathspec retiré, équivalent sous le filtre (R11) ; ordre inversé, équivalent pour l'appelant (R17) |
| Libellés du texte courant (25) | 23 | 2 : « La vision Libre AI, en données » (W1) ; fin du résumé « wrote … », déclarée (W22) |
| Bloc principal (5) | 0 | 5 : M1 à M4 déclarés ; impression du résumé en cas de succès (M5) |

**Point 7 — page générée.** À jour (régénération sans diff). `bun page-diff.ts copie HEAD~1 HEAD` : 157 lignes de chaque côté, 1 ligne changée, la 63, qui commence par `<details class="brique" id="FAB-13">` ; les deux textes changés sont les deux phrases de la fiche.

## 4. Constats nouveaux

**F-1 — `minor` — défaut bloquant (affirmation fausse introduite par le delta). Le témoin finit à quatre fichiers, pas trois.**
- Lieu : `docs/reviews/vision-page-2026-11-11/REVIEW.md:38`, « index du témoin remplacé par les trois fichiers de la fixture ».
- Sonde : témoin de deux fichiers, `GIT_DIR` et `GIT_INDEX_FILE` pointés dessus, suite de `fa6a085` (`prev/`) → 41 pass ; `git ls-files` du témoin : `0063-other.md`, `0064-a-second-one.md`, `0064-brick-map.md`, `10064-not-this-one.md`.
- La ligne 34 du même dossier dit « 932 entrées à 4 ».
- Correctif : « quatre », ou la sortie collée.

**F-2 — `minor` — défaut bloquant (affirmation trop large, sur la question laissée au propriétaire). « Celle des flux générés de `distribution/feeds/` » vaut pour deux fichiers générés sur trois.**
- Lieu : `REVIEW.md:57`.
- `git ls-files distribution/feeds` : `changelog.md`, `evidence.atom.xml`, `evidence.json`, tous écrits par `build-feeds.ts:423-425`.
- Par `REUSE.toml`, les deux flux sont EUPL-1.2 ; `changelog.md`, généré lui aussi, est CC-BY-4.0 par `**/*.md` (dernière annotation qui apparie).
- Le delta a retiré la précision que portait la version précédente (« qui reprennent eux aussi des textes sous CC-BY-4.0 »).
- Correctif : dire que la règle existante donne EUPL-1.2 aux deux flux et CC-BY-4.0 au changelog généré du même répertoire.

**F-3 — `non-blocking` — suggestion. « Trois phrases de ce dossier étaient fausses ou trop larges » ne se retrouve pas dans le rapport.**
- Lieu : `REVIEW.md:34`.
- Le rapport de passe 3, point 2, liste huit phrases qui ne tiennent pas. Le récit en reprend quatre à part (deux mots, onze phrases, deux sites, ligne de verdict) ; il en reste quatre : script « vu par rien », « trois phrases de la précision 13 », « la page le dit », « le job de dérive les exerce ».
- Les quatre sont corrigées dans le texte (`git diff --word-diff HEAD~1 HEAD`).

**F-4 — `non-blocking` — suggestion. Quatre des six noms de `GIT_REDIRECTIONS` ne sont tenus par aucun test ni aucune mutation de la liste.**
- Lieu : `distribution/build-vision.ts:46-53` ; `build-vision.test.ts:680-682` ne pose que `GIT_DIR` et `GIT_INDEX_FILE`.
- Sonde : R3 à R6 et R14 survivent.
- Sans filtre, `GIT_COMMON_DIR` et `GIT_OBJECT_DIRECTORY` font lever la lecture (échec fermé) ; `GIT_WORK_TREE` et `GIT_PREFIX` n'ont changé aucune lecture mesurée. `GIT_PREFIX` ne répond pas au commentaire de la ligne 45.
- Plus petit contrôle : un cas par nom, ou réduire la liste à ce qui est mesuré.

**F-5 — `non-blocking` — suggestion. Reste de C-5 : quatre textes de la page vivent encore.**
- Lieu : `build-vision.ts:317` (W1), `:292` (L19), `:294` (L18), `:309` (T26).
- « A change of wording of the page turns the fixed-text test red » (message du commit) ne tient pas pour W1.
- « les titres … sont tenus » (`REVIEW.md:41`) tient pour `<title>`, `<h1>` et les cinq `<h2>`, pas pour les onze `<h3>` de couche.

**F-6 — `non-blocking` — suggestion. Les attentes neuves fixent la forme du balisage, ce que le message du commit ne dit que du libellé.**
- Lieu : `build-vision.test.ts:186-206`, `:466-478`.
- Sonde (`own-mutants-3.json`) : ordre des attributs de `<details>`, une espace entre `</dt>` et `<dd>`, un `id` sur `<h1>`, une classe sur `<thead>` → 4 rouges sur 4, pour un même contenu rendu.
- Le message dit « an equivalent refactor of the renderer keeps the suite green » : vrai d'un refactor à sortie identique seulement.

**F-7 — `non-blocking` — suggestion. Le bloc retire de l'index, avant de le comparer, les entrées dont le fichier manque sur le disque.**
- Lieu : `.github/workflows/brick-map.yml:83` (ligne antérieure au delta), dont dépend le contrôle neuf de la ligne 93.
- Sonde s19 : fichier suivi en trop, commité, puis supprimé du disque → 3 entrées avant le bloc, 2 après, rc 0.
- En checkout neuf, tout fichier suivi est sur le disque (s11 : le gitlink reste, rouge) : pas de faux vert trouvé en CI, seulement en rejeu local.
- Correctif : relever la liste avant `git add --intent-to-add`.

**F-8 — `non-blocking` — suggestion. `git show :chemin` suit une ref `refs/replace`.**
- Lieu : `build-vision.ts:431` ; le commentaire `:416` dit « as the index holds it ».
- Sonde (`env-read.ts`, fin) : avec `git replace <blob proposé> <blob accepted>` dans le dépôt demandé, la fonction rend « accepted » ; avec `GIT_NO_REPLACE_OBJECTS=1`, « proposé ».
- État du dépôt, pas variable d'environnement ; un clone ne rapatrie pas ces refs par défaut.

## 5. Angles non couverts

- **Bun de la CI** (`1.4.0-canary.1+57f349f63`) : non exécuté (archive à télécharger). Vert de la suite et identité de la page sous cette version non mesurés.
- **Git du runner Ubuntu** : version non lue. Si elle précède 2.38, le job échoue fermé (mesuré) ; le plus petit contrôle est le run du workflow sur la pull request.
- **Exécution du workflow sur GitHub, rulesets, check requis, description de la pull request** : hors du clone.
- **`reuse lint` / `reuse spdx`** : refusé par le bac à sable (cache `uv`).
- **`bun run check` entier et `bun test` nu** : non lancés (réseau).
- **Gate des citations épinglées** : réseau, non lancé.
- **Navigateur et lecteur d'écran** : aucun ouvert.
- **Hook `pre-commit` avec `git commit -a` ou par chemins** (index temporaire) : non rejoué ; le cas est couvert par construction, `GIT_INDEX_FILE` étant retiré.
- **Fidélité du rapport de passe 3 recopié** à ce que la passe a rendu : aucune source à comparer.
