
# Revue adverse, passe 3 — page vision générée, delta `aa14e78..fa6a085`

## Verdict : `reject`

Rapport rendu en texte par un sous-agent à contexte neuf, reproduit tel quel sous ce titre. Les chemins de sonde qu'il cite sont ceux de son répertoire temporaire : ils ne sont pas dans ce dépôt.

Aucun constat de gravité `blocking`. Le verdict tient à un défaut reproduit que le delta introduit (C-1, `major`) et à la clause 3 d'ADR-0056 D2, qui n'admet aucune « preuve requise » ouverte sous un verdict `approve*`. Cette passe `candidate-integration` n'est pas une approbation de promotion par rôle.

Sondes : `/tmp/claude-502/scratch/revue-vision-3.0UTGl5/` (laissé en place). Copies du clone : `copie/` (commandes de preuve), `mut/` (mutations), `wf/`, `prev/`, `hook/`, `hook-wt/` (clones `git clone --no-hardlinks` pour le job et les sondes git).

## 1. Métadonnées

- **Commit relu** : `fa6a085d7b048343e35d7df5081cc08b4589055b` (`git rev-parse HEAD`).
- **Dernier head revu** : `aa14e787f55d7f6455d964cef665aad85bddb4a8` (`HEAD~1`).
- **Base** : `f806dd8c81863405b6cf1b03bd7ad202af0f9191` (`HEAD~3`).
- **Clone au début** : HEAD `fa6a085…`, `git status --short | wc -l` = 0.
- **Clone à la fin** : HEAD `fa6a085…`, `git status --short | wc -l` = 0.
- **Bun** : local `1.4.4-canary.1+963452075` ; la CI épingle `1.4.0-canary.1+57f349f63` (`.github/workflows/brick-map.yml:49,74`).

Empreintes (`git ls-tree HEAD …`) :

| Fichier | Blob |
| --- | --- |
| `.github/workflows/brick-map.yml` | `33291f35ecaf18666b78849a534b52ac9f270227` |
| `distribution/build-vision.test.ts` | `a7fd9fdc0c97c547a4bed6da2434dc9d90aae86e` |
| `distribution/build-vision.ts` | `765f436e63c4508ccb9389041445bb03439e04dc` |
| `distribution/vision/index.html` | `3812dd9b4e3550c070af57480f25eb7a3bf60055` |
| `distribution/vision/vision.css` | `d8200072235ef6100e32af608d68d292f11e9419` |
| `docs/reviews/vision-page-2026-11-11/REVIEW.md` | `aad927a207ac5f184084b14040f8312d73916b5e` |
| `docs/reviews/vision-page-2026-11-11/evidence/mutations.json` | `964c8329bcf7d2342511c2f83f64beb83798e5b4` |
| `ecosystem/briques.test.ts` | `631447c2c3676c8bb4e22a93e7149a44f1c7a2ee` |
| `ecosystem/briques.ts` | `cafc7dd85bee6d03c0bc66883acf0a3849a40a64` |

Commandes de preuve, lancées dans `copie/` :

| Commande | Résultat |
| --- | --- |
| `bun test distribution/build-vision.test.ts` | pass : 41 pass, 0 fail, 170 expect |
| `bun test ecosystem/briques.test.ts ecosystem/check-briques.process.test.ts` | pass : 205 pass, 0 fail, 318 expect |
| `bun run check:briques` | pass : « 119 assertion(s) hold — 99 brick(s) in 11 of 11 layer file(s) », decrite 26, en_cours 73 |
| `bun run check:doctrine` | pass : « 67 ADR file(s), 54 accepted from 0008 » |
| `bun run build:vision` puis `git diff --stat -- distribution/vision` | pass : diff vide, la page n'a pas été modifiée |
| `bun run check:data-inventory` | pass : « 58 assertion(s) hold — 932 tracked file(s) … 0 undeclared » |
| `bun run lint` | pass : rc 0, 1 avertissement et 15 infos, 0 ligne sur les fichiers du delta (`grep -c "build-vision\|briques\|brick-map" lint.out` = 0) |
| `bun run typecheck` | pass : rc 0 |

## 2. N1 à N8

| # | État | Sonde et sortie |
| --- | --- | --- |
| N1 | **partiellement tenu** | La note 13 nomme `accepted` et `proposé` et dit que « tout autre mot » ne donne aucune page. Le générateur lit un troisième mot : `bun note13.ts` → `proposed -> proposed`. Job rejoué avec le statut `proposed` commité : rc 0, « Vision generated … ADR-0064 proposed » (`wf4.out`). `en vigueur` et `accepté` : rc 1, message nommé. Voir C-3. |
| N2 | **partiellement tenu** | Les trois sites nommés sont corrigés (`publication.v1.yaml:9`, en-tête de `build-vision.ts:4-11`, `FAB-13.md:31`). Le même fichier garde une phrase fausse à la ligne 5, et la ligne 31 neuve en introduit une. Voir C-2 et C-4. |
| N3 | **partiellement tenu** | Les 94 mutations de la liste rougissent toutes (point 3). Mes mutants sur le texte fixe : 16 survivants sur 20 (`own-fixed.out`). Voir C-5. |
| N4 | **tenu** | Page : « au moins une preuve datée est citée et tient : un fichier suivi de ce dépôt, ou une citation épinglée, que le gate des citations résout de son côté ». Conforme à `ecosystem/briques.ts:41-43,785-793`. Mutants E1 à E4 tués. `bun note13.ts` : en_cours 73, dont 40 à preuves épinglées seulement. |
| N5 | **tenu** | `bun replay.ts mut own-briques.json …` : champ posé sur `produit`, sur `harness`, retiré de `gouvernance`, texte changé → 4 tués. Le test neuf est parmi les rouges de P1. |
| N6 | **tenu, avec deux faux verts** | 12 scénarios rouges à raison, 2 verts à raison (`wf2.out`). Faux verts : chemin fabriqué, lien symbolique. Voir point 4 et C-6. |
| N7 | **tenu** | `bun page-lines.ts` : 156 lignes, 99 lignes de brique, 0 ligne à plus d'une brique, 99 commencent par `<details` et finissent par `</details>`. Ligne la plus longue : 5 690 octets (ligne 63). |
| N8 | **tenu** | Légende vraie de la page suivie : 22 cellules admises toutes chiffrées (3 à zéro), 88 refusées toutes en tiret, 11 sur la diagonale, 0 écart avec `LAYERS`. Mutants G1 à G6 tués. Aucun lecteur d'écran lancé. |

## 3. Points 2 à 7 du périmètre

**Point 2 — l'index `docs/reviews/vision-page-2026-11-11/REVIEW.md`.**

Ce qui tient, vérifié contre les deux rapports et par commande :
- Tableau des passes : commits, verdicts et chemins exacts.
- Passe 1 : 1 majeur et 11 autres (C2 à C12) ; 28 survivants sur 57.
- Passe 2 : 8 tenus (C1, C2, C5, C6, C8, C9, C10, C12), 3 partiels (C3, C4, C7), 1 laissé (C11) ; 8 constats nouveaux ; 38 sur 166 ; 7 sur 7 du bloc principal.
- « 40 briques sur 73 » : reproduit.
- Constat hors objet sur le gate de doctrine : reproduit (`bun doctrine-join.ts mut`). Deux lignes jointes → « 55 accepted », rc 0 ; restauré → 54.

Ce qui ne tient pas :
- « un script déposé sous `distribution/vision/` n'était vu par rien » : faux pour `.js`, `.jsx`, `.mjs`, `.cjs`. Voir C-7.
- « la précision 13 dit quel mot le générateur lit » : elle en dit deux, le code en lit trois (C-3).
- « la suite verrouille le texte fixe de la page » : vrai de 11 phrases, faux des titres, en-têtes de colonne et libellés de champ (C-5).
- « Deux sites ne sont couverts par aucune mutation tuée » : le bloc principal en compte deux de plus (C-8).
- « trois phrases de la précision 13 et de la fiche PUB-01 » : l'une des trois est `docs/adr/0064-…md:51` (« douze points »), hors de la note 13 (rapport de passe 1, C3).
- « Le générateur ne lit pas ce verdict ; la page le dit » : la page dit que le gate des citations résout « de son côté », pas que son verdict n'est pas lu.
- « le job de dérive les exerce pour le seul cas où le répertoire courant est la racine » : sur une carte verte, le job n'exerce pas la sortie non nulle.
- Ligne 3, `Verdict: approve-with-minor-reservations`, contre ADR-0056 D2 clause 3 (C-9).

Invérifiable ici : « Le rendu a été regardé une fois par l'auteur » ; « reproduit tel quel » des deux rapports ; « n'est pas un check requis » (rulesets, réseau).

**Point 3 — preuve de discrimination.**
- `bun replay.ts mut mut/docs/reviews/…/evidence/mutations.json distribution/build-vision.ts distribution/build-vision.test.ts` → `TOTAL 94 = killed 94 + survived 0 + inapplicable 0 + identical 0`.
- 41 pass avant, 41 pass après restauration. Chaque `find` apparaît exactement une fois. 94 paires distinctes (`jq '[.[]|.find+"\u0000"+.replace]|unique|length'` = 94).
- Mutations 33 et 34 : 19 des 20 tests rouges le sont par `TypeError` (le mutant appelle `escapeHtml(undefined)`). La forme sans plantage (J1, J2) est tuée par 1 test.
- Mes mutants (`own-vision.out`, `own-fixed.out`, `own-briques.out`) :

| Cible | Tués | Survivants |
| --- | --- | --- |
| `readDecisionRecords` (7) | 4 | 3 : filtre sans son tiret (R2) ; liste sans `-z` (R4) ; `includes("/0064-")` (R7) |
| Bloc principal (5) | 0 | 5 : racine du cwd, ADR lu dans le cwd, sortie 0, page écrite sous un autre nom, motifs de refus non imprimés |
| Une brique par ligne (4) | 3 | 1 : couches jointes sans saut de ligne (les briques restent une par ligne) |
| Légende (6) | 6 | 0 |
| « en cours » (4) | 4 | 0 |
| Texte fixe hors des 11 phrases (20) | 4 | 16 |
| Règle partielle, `briques.ts` (6) | 5 | 1 : slug saisi en dur, équivalent sous le test neuf |
| Divers (6) | 4 | 2 : fin du résumé « wrote … » ; texte de la date de preuve remplacé par la cible |

**Point 4 — contrôle des fichiers suivis.** Bloc `run:` extrait du YAML (`bun extract-run.ts`), rejoué par `bash --noprofile --norc -eo pipefail` dans un clone neuf par scénario (`bun wf.ts`).
- Rouge à raison : fichier neuf non suivi (par `--intent-to-add`) ; `track.js` suivi ; `sub/deeper.mjs` suivi ; `vision.css` retiré de l'index, avec ou sans le disque ; nom avec espace ; nom avec saut de ligne (imprimé `"distribution/vision/a\nb.html"`) ; nom non ASCII ; fichier ignoré forcé ; gitlink ; page éditée à la main.
- Vert à raison : rien de changé ; `vision.css` édité et commité ; statut `proposed`.
- Faux rouge : aucun trouvé.
- Faux vert 1 (s07b) : un seul fichier suivi nommé `distribution/vision/index.html distribution/vision/vision.css`, les deux vrais retirés, `index.html` ignoré par `.gitignore` → rc 0. `check-data-inventory` le voit (3 assertions rouges).
- Faux vert 2 (t08b, t13b) : `index.html` ou `vision.css` suivi comme lien symbolique vers une cible non suivie → job rc 0, `check-data-inventory` rc 0, `check-briques` rc 0. Le générateur écrit la page dans `distribution/nowhere.html`, non suivi.
- Note de sonde : dans un clone dont `origin` est un chemin local, le générateur rend 33 violations (« the name of this repository could not be derived »). Les scénarios posent donc l'URL d'origine du clone relu.

**Point 5 — note 13 et gate de doctrine.**
- Compte du gate rejoué par `git grep -l -i -E 'Statut.*accepted' <rev> -- docs/adr` (`bun doctrine.ts`) : 54 sur `HEAD~3`, `HEAD~2`, `HEAD~1` et `HEAD` ; ADR-0064 jamais compté ; 0 ligne d'ADR-0064 n'apparie le motif. Le script lancé sur `aa14e78` (clone `prev/`) et sur HEAD dit 54.
- « le gate de doctrine tient pour admis tout ADR dont une ligne porte à la fois le nom du champ et le premier de ces mots » : vrai du motif (`check-doctrine-governance.sh:47`), insensible à la casse, champ avant le mot.
- « fait échouer le job de la page » pour « en vigueur » : vrai, rc 1.
- « l'un des deux mots » : faux, trois (C-3).
- Rendu (`Bun.markdown.html`, CommonMark, pas le moteur de GitHub) : 1 `<ol>`, 13 `<li>`, 0 `<pre>`. L'item 13 tient en un seul `<p>`, sans `<br>`, et contient « Les deux mots lus » et « rendu en matrice ». « Deux règles viennent » est hors de la liste. Une fois rendu, « à la ligne suivante » et « sur cette ligne à part » ne désignent plus rien de visible.

**Point 6 — FAB-13 et PUB-01.**
- Sortie de `bun ecosystem/check-briques.ts` sur `aa14e78` et sur HEAD : identique à l'octet (`cmp`, 1 248 octets).
- Rôle de PUB-01 : vrai du code.
- `FAB-13.md:31`, « existe depuis le 2026-11-11 » : vrai (`git log --diff-filter=A -- distribution/vision/index.html` → `ecc75f1`, 2026-11-11).
- `FAB-13.md:31`, « elle est la preuve de PUB-01 » : ne tient pas (C-4). `FAB-13.md:5` : faux (C-2).

**Point 7 — page générée.**
- À jour : régénération sans diff.
- Texte des deux versions sans sauts de ligne, un jeton par balise (`bun page-diff.ts`, puis `diff old.tok new.tok`) : 11 595 jetons de chaque côté, 4 jetons changés.
- Trois sont ceux attendus : sens de « en cours », légende, rôle de PUB-01.
- Le quatrième n'est pas dans la liste du mandat : l'item « Prochaine preuve » de la fiche FAB-13, conséquence du diff de `FAB-13.md`.
- Lignes : 36 → 156. Octets : 370 159 → 370 559.

## 4. Constats nouveaux

**C-1 — `major` — défaut bloquant. La suite neuve écrit dans l'index du dépôt ambiant quand `GIT_DIR` est posé.**
- Lieu : `distribution/build-vision.test.ts:562-576` (`git init`, `git add --all` sans environnement nettoyé) et `distribution/build-vision.ts:412-413` (`execFileSync` hérite de l'environnement).
- Déclencheur mesuré : hook `pre-commit` lancé depuis un worktree lié. Le hook reçoit `GIT_INDEX_FILE=…/.git/worktrees/hook-wt/index` et `GIT_DIR=…/.git/worktrees/hook-wt`.
- Impact mesuré (`hook-wt/`) : suite « 41 pass, 0 fail » ; index 932 → 4 entrées ; le commit qui suit enregistre un arbre de 4 fichiers, ceux de la fixture (`docs/adr/0063-other.md`, `0064-a-second-one.md`, `0064-brick-map.md`, `10064-not-this-one.md`).
- Même effet avec `GIT_DIR` seul (`bun ambient.ts` : 932 → 4, 936 changements indexés, suite verte).
- Ce qui ne déclenche pas : hook `pre-commit` dans un clone simple (`GIT_INDEX_FILE=.git/index`, relatif, `GIT_DIR` absent) → 932 → 932. La CI non plus. Aucun hook n'est suivi par le dépôt.
- Introduit par le delta : sur `aa14e78`, les quatre cas laissent 928 → 928.
- Les tests voisins nettoient l'environnement et disent pourquoi (`ecosystem/check-briques.process.test.ts:30-45`).
- Correctif : environnement déclaré (`PATH`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`) pour les `git` de la fixture, et `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE` retirés dans `readDecisionRecords`.

**C-2 — `minor` — défaut bloquant (affirmation fausse, classe N2 non balayée). La page dit d'elle-même qu'elle n'est pas générée.**
- Lieu : `ecosystem/briques/fabrique/FAB-13.md:5`, imprimé à `distribution/vision/index.html:63`.
- Texte : « Au 2026-11-11, git ne suit aucun fichier sous `distribution/vision/` : la page vision qu'ADR-0064 D6 demande n'est pas générée dans ce dépôt. »
- Sonde : `git ls-files distribution/vision | wc -l` → 2. La ligne 31 du même fichier, changée par ce commit, dit que la page « existe depuis le 2026-11-11 ».
- Correctif : retirer ou réécrire la phrase, régénérer.

**C-3 — `minor` — défaut bloquant (affirmation fausse introduite par le delta). La note 13 dit deux mots, le générateur en lit trois.**
- Lieu : `docs/adr/0064-brick-map-eleven-layers-derived-status.md:66-67` ; `distribution/build-vision.ts:356` ; message du commit, N1.
- Sonde : `standingOf("- **Statut :** proposed — x")` → `proposed` ; job vert avec ce mot. Le test `build-vision.test.ts:548-550` et la mutation 83 de la liste verrouillent ce troisième mot.
- Correctif : nommer `proposed` dans la note, ou retirer sa lecture.

**C-4 — `minor` — défaut bloquant (affirmation fausse introduite par le delta). « Elle est la preuve de PUB-01 ».**
- Lieu : `ecosystem/briques/fabrique/FAB-13.md:31`, imprimé sur la page.
- PUB-01 cite deux preuves, et la page n'en est pas : `ecosystem/briques/publication.v1.yaml:23-27` → `distribution/build-vision.ts` et `.github/workflows/brick-map.yml`. `PUB-01.md:21` dit la même chose.
- Correctif : « elle est produite par PUB-01 », ou citer la page parmi les preuves de PUB-01.

**C-5 — `minor` — preuve requise. « A change of wording of the page turns the fixed-text test red » ne tient que pour 11 phrases.**
- Lieu : message du commit ; index, section « Ce que chaque passe a trouvé » ; `distribution/build-vision.test.ts:425-444`.
- Sonde : `bun replay.ts mut own-fixed.json …` → 20 = 4 tués + 16 survivants.
- Survivent : `<h1>`, `<title>`, trois titres de section (dont « Statuts dérivés des preuves » réécrit en « Statuts saisis »), trois en-têtes de colonne (dont « Rôle » et « Peut dépendre de » échangés), « Cette page est écrite à la main » à la place de la phrase de génération.
- Survivent aussi trois mutants qui ne sont pas du libellé : valeurs de « Décisions » et de « Dépôts porteurs » échangées (F17), libellés de charte « dégel » et « abandon » échangés (F10), date de preuve remplacée par la cible (S4). Le test des marqueurs vérifie qu'un champ est imprimé, pas sous quel libellé.
- Plus petit contrôle : une assertion `<dt>libellé</dt><dd>marqueur du champ` par champ, les titres et en-têtes dans la liste du texte fixe ; ou restreindre la phrase aux 11 phrases tenues.

**C-6 — `minor` — preuve requise. Le contrôle « liste exacte » compare des noms joints par des espaces, pas des entrées d'index.**
- Lieu : `.github/workflows/brick-map.yml:90-91`.
- Sondes : s07b (chemin fabriqué, rc 0, rattrapé par `check-data-inventory`) ; t08b et t13b (lien symbolique, mode 120000, rc 0 sur les trois gates lancés).
- Les deux demandent un commit délibéré, visible dans un diff. Aucun site ne sert la page.
- Plus petit contrôle : comparer `git ls-files -s distribution/vision` à deux lignes de mode `100644`, ou `git ls-files -z` avec un compte exact.

**C-7 — `minor` — défaut bloquant (affirmation fausse du dossier). Un script `.js` sous `distribution/vision/` était déjà refusé.**
- Lieu : index, « n'était vu par rien » ; commentaire `.github/workflows/brick-map.yml:88-89`.
- Sonde : `track.js` suivi sur `aa14e78` (clone `prev/`), `bun tools/quality/check-source-policy.ts` → « distribution/vision/track.js: forbidden JavaScript source », échec. Même sortie sur HEAD pour `.js` et `.mjs`. `check-source-policy.ts:9` : `[".js", ".jsx", ".mjs", ".cjs"]`. Ce fichier n'est pas touché par la pull request.
- Le constat N6 de la passe 2 nommait deux gates et reste vrai d'eux ; l'index l'a généralisé.
- Correctif : « n'était vu ni par l'inventaire ni par le job de dérive ; `check:source` refuse déjà les quatre extensions JavaScript ».

**C-8 — `non-blocking` — suggestion. Le bloc principal a quatre sites sans test, l'index en déclare deux.**
- Lieu : `distribution/build-vision.ts:420-431`.
- Non déclarés : le chemin d'écriture (M4, que le job de dérive rattrape) et l'impression des motifs de refus (M5, que rien ne rattrape).

**C-9 — `minor` — preuve requise (décision de périmètre). La première ligne du dossier porte un verdict que la doctrine n'admet pas avec ce qu'il déclare ouvert.**
- Lieu : `docs/reviews/vision-page-2026-11-11/REVIEW.md:3` et `:39`.
- La ligne 39 déclare la licence « preuve requise au sens d'ADR-0056 D2 », ouverte. Le rapport de passe 2 classait N1, N3 et N4 « preuve requise » sous le même verdict.
- `docs/adr/0056-…md:190-191` : « `approve-with-minor-reservations`, comme `approve`, n'admet aucune « preuve requise » ouverte ». ADR-0056 est `accepted`.
- `AGENT-REVIEW-PROTOCOL.md:32` rend aussi ce verdict périmé pour `fa6a085` ; le corps du dossier le dit, pas sa ligne 3.
- À trancher : requalifier la licence en décision du propriétaire hors disposition, ou changer la ligne de verdict.

**C-10 — `non-blocking` — suggestion. La séparation en deux lignes de la note 13 tient à la mise en lignes du source.**
- Lieu : `docs/adr/0064-…md:66-67`.
- Sonde : joindre les deux lignes → gate de doctrine rc 0, « 55 accepted », ADR-0064 compté.
- Aucun formateur Markdown n'est configuré dans le dépôt (`grep prettier\|markdownlint\|dprint\|remark package.json biome.json` : rien).
- Ancrer le motif du gate sur la ligne de statut lèverait la dépendance ; le dossier le déclare hors objet.

**C-11 — `non-blocking` — suggestion. Emplacement de `evidence/mutations.json`.**
- La déclaration d'inventaire qui le couvre dit « frozen evidence of past reviews, under the commit each one reviewed » (`tools/quality/check-data-inventory.ts:344-346`).
- Le fichier est à la racine du dossier, hors d'un répertoire de commit, et l'index dit qu'il périme dès que le générateur change.

## 5. Angles non couverts

- **Bun de la CI** (`1.4.0-canary.1+57f349f63`) : archive à télécharger, non exécutée. L'identité de la page et le vert de la suite neuve sous cette version ne sont pas mesurés.
- **Gate des citations épinglées** : demande le réseau, non lancé. Le vert dont dépend le sens de « en cours » pour 40 briques n'est pas mesuré.
- **`bun run check` entier** et `bun test` nu : non lancés. Lancés à part : `check:licenses`, `check:context-hygiene`, `check:personal-data`, `check:source`, `check:secret-scan`, tous « verified » sur 932 fichiers.
- **Rulesets, check requis, exécution du workflow sur GitHub, description de la pull request, dossier `check-review-evidence`** : hors du clone.
- **Rendu GitHub de la note 13** : mesuré avec `Bun.markdown`, pas avec le moteur de GitHub.
- **Navigateur et lecteur d'écran** : aucun ouvert ; N8 est jugé sur le texte.
- **`sort` et `tr` GNU du runner** : rejoués avec ceux de macOS, `LC_ALL=C.UTF-8`.
- **`git rebase --exec` et autres contextes qui exportent `GIT_DIR`** : non mesurés. C-1 est mesuré sur un hook de worktree lié et sur la variable posée à la main.
- **Fidélité des deux rapports recopiés** à ce que les passes ont rendu : aucune source à comparer.
