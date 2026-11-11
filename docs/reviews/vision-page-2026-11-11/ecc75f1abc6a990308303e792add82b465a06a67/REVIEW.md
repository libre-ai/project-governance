
# Revue adverse, passe 1 — page vision générée, commit `ecc75f1`

## Verdict : `reject`

Rapport rendu en texte par un sous-agent à contexte neuf, reproduit tel quel sous ce titre. Les chemins de sonde qu'il cite sont ceux de son répertoire temporaire : ils ne sont pas dans ce dépôt.

Un constat `major` est ouvert : la page suivie affirme une vérification que le gate ne fait pas. Les propriétés (a) à (f) tiennent sur le code d'aujourd'hui ; (g) est faux sur trois phrases. Cette passe `candidate-integration` n'est pas une approbation de promotion par rôle.

## 1. Métadonnées

- Commit relu : `ecc75f1abc6a990308303e792add82b465a06a67`, parent `f806dd8c81863405b6cf1b03bd7ad202af0f9191` (`git rev-parse HEAD HEAD~1`).
- Empreintes (`git ls-tree HEAD <chemins>`) :
  - `.github/workflows/brick-map.yml` : `dc9e549b5ea4bcc1c3b3afdacbd14319ce231d13`
  - `distribution/build-vision.test.ts` : `798a9118cba81306e205648d48a5bc1565e5f0c8`
  - `distribution/build-vision.ts` : `198cb3f26d92f719ff6cd067e8c5d68a9e416786`
  - `distribution/vision/index.html` : `98f100da909b96ce9ee2775a826d350a550e3f85`
  - `distribution/vision/vision.css` : `cea079efe83d15788734e7b635249afef67dab47`
- Début : HEAD `ecc75f1…`, `git status --short | wc -l` = 0. Fin : HEAD `ecc75f1…`, 0. `git hash-object distribution/vision/index.html` = `98f100da…` en fin de passe.
- Bun local `1.4.4-canary.1+963452075` (`bun --revision`) ; la CI épingle `1.4.0-canary.1+57f349f63` (`.github/workflows/brick-map.yml:74`).
- Commandes de preuve :

| Commande | Résultat |
| --- | --- |
| `bun test distribution/build-vision.test.ts` | 18 pass, 0 fail, 49 expect |
| `bun run check:briques` | rc 0, 119 assertions, 99 briques, decrite 26, en_cours 73 |
| `bun run build:vision` puis `git diff --stat -- distribution/vision` | rc 0, diff vide : la page n'a pas été modifiée |
| `bun run check:data-inventory` | rc 0, 57 assertions |
| `bun run lint` | rc 0 ; 1 warning et 15 infos, aucun dans les fichiers du commit (`grep vision` sur la sortie : 0 ligne) |
| `bun run typecheck` | rc 0 |

- Sondes : `/tmp/claude-502/scratch/revue-vision.geODTi/` ; `copy/` y est une copie `cp -R` du clone, seul endroit où des fichiers ont été modifiés.
- Écart à signaler : une commande mal filtrée a lancé `bun test ./` sur toute la suite ; un test (`ecosystem/check-inventory-drift.test.ts`) a tenté `gh api graphql`, qui a échoué. L'arbre est resté propre.

## 2. Constats

**C1 — `major`, défaut bloquant. La page dit « vérifiée par le gate » d'une règle dont le gate ne vérifie que la moitié.**
- Où : `distribution/build-vision.ts:237`, alimenté par `ecosystem/briques.ts:112-113`.
- Ce qui est faux : pour `gouvernance`, la page imprime « seule couche sans dépendance ; toute autre brique cite au moins un invariant — vérifiée par le gate ». La seconde moitié est « counted, not enforced » (`ecosystem/briques.ts:64-66`) ; le volume du gate dit « for gouvernance, its dependency half » (`:1244`), nuance que le générateur perd.
- Sonde : `grep -o 'toute autre brique cite au moins un invariant <span class="regle">[^<]*</span>' distribution/vision/index.html` → `…<span class="regle">vérifiée par le gate</span>`. La même page liste « 22 briques hors de la couche gouvernance ne sont liées par aucun invariant ».
- Aucun test ne lit ce libellé : les mutants « rule verified label swapped » et « constant » survivent (`bun mutants.ts`).
- Correctif : imprimer la portée réelle (moitié vérifiée, moitié comptée), ou refuser un booléen unique pour une règle à deux moitiés ; ajouter un test qui rougit si le libellé s'inverse.

**C2 — `minor`, suggestion. `standingOf` ne reconnaît que le mot « accepted », et tout le reste devient « encore proposé ».**
- Où : `distribution/build-vision.ts:297-301`.
- Ce qui est faux : la ligne de statut d'ADR-0064 (`docs/adr/…0064….md:5`) dit que le propriétaire « fait passer ce statut de proposé à en vigueur ». Écrite ainsi, la page continue d'imprimer « encore proposé : son acceptation est un acte du propriétaire ». N'importe quelle ligne du fichier compte, pas seulement la ligne de statut.
- Sonde (`bun probe-misc.ts`) :
  - `en vigueur`, `accepté`, `rejeté`, `retiré par D120`, `superseded`, `deferred` → `proposed`
  - `proposé, not yet accepted` → `accepted`
  - statut `proposé` suivi d'une note « Le statut de cet ADR ne sera accepted qu'après la revue » → `accepted`
- Rejoué de bout en bout dans `copy/` : statut « en vigueur — … » donne `<p class="reserve">Elle applique ADR-0064, <strong>encore proposé</strong>…`.
- Le motif est bien celui du gate de doctrine (`tools/quality/check-doctrine-governance.sh:47`), comme le commentaire le dit.
- Les mutants « any line with accepted », « case-sensitive » et « dot matches newline » survivent.
- Correctif : lire la seule ligne `- **Statut :**`, exiger qu'elle soit unique, ne donner aucune page si sa valeur n'est ni proposée ni acceptée.

**C3 — `minor`, suggestion. Trois phrases du commit sont fausses du code (g).**
- `docs/adr/…0064….md:66` (note 13) : la feuille de style serait la « seule exception à "rien n'y est saisi" ». Le générateur porte des affirmations saisies :
  - `build-vision.ts:54-60` : « aucun instrument ne la vérifie encore, donc aucune brique ne peut l'être » ;
  - `:281` : « faute de charte » ;
  - `:274` : « épinglées à un commit d'un dépôt porteur public ».
- `docs/adr/…0064….md:51` dit encore « sur douze points » alors que la section en compte 13 : `git show HEAD:docs/adr/0064-brick-map-eleven-layers-derived-status.md | grep -c -E '^[0-9]+\. \*\*'` → 13 (12 sur `HEAD~1`).
- `ecosystem/briques/publication/PUB-01.md:9` : « la page n'a qu'une source, la carte ». Le générateur lit aussi le fichier d'ADR-0064 directement (`build-vision.ts:344-353`), hors des sorties du vérificateur.
- Ambigu : note 13, « la page le dit en tête ». L'en-tête dit que l'ADR est proposé ; il ne dit rien de `vision.md` (2 occurrences dans la page, toutes dans le corps).
- Correctif : corriger les trois phrases.

**C4 — `minor`, suggestion. La suite laisse vivre des comptes saisis, contrairement à son en-tête.**
- Où : `distribution/build-vision.test.ts:16-18` (« a count written in the template would fail ») et `:126` (seuil `>= 12`).
- Sonde : `cd /tmp/claude-502/scratch/revue-vision.geODTi && bun mutants.ts` → 57 mutants appliqués, 29 tués, 28 survivants. Survivent notamment :
  - les quatre comptes par statut remplacés par `0`, le compte par couche (deux sites), `cibles_partagees`, `sans_depot_porteur`, `preuves_epinglees` saisi à 5 (la fixture le fixe à 5 quelle que soit la carte) ;
  - « proofs never shown », « charter never shown », « fiche sections dropped », listes d'invariants, de décisions et de dépôts vidées : la page hostile porte 19 sites, le seuil en demande 12 ;
  - l'échappement retiré sur `brick.id` (attribut et texte), `origine.type`, `autonomie`, les identifiants de `sans_invariant`.
- Les « 29 substitution mutants » du message de commit ne sont pas dans le diff : non rejouables.
- Correctif : une assertion par compte après changement de la carte ; un attendu par champ au lieu d'un seuil.

**C5 — `minor`, suggestion. Le statut de l'ADR est lu sur le disque, pas dans l'index.**
- Où : `distribution/build-vision.ts:343-353` ; le commentaire dit « read from what git tracks ».
- Sonde dans `copy/` : statut d'ADR-0064 modifié sans indexation, `bun distribution/build-vision.ts` → rc 0, « ADR-0064 accepted », page réécrite. Le gate refuse un fichier de carte non indexé, pas celui-ci.
- La CI le rattrape par la dérive. Correctif : passer le chemin par le même contrôle que les sources de doctrine.

**C6 — `minor`, suggestion. La carte est lue dans `process.cwd()`, la page écrite à côté du script.**
- Où : `distribution/build-vision.ts:342` et `:358`.
- Sonde : depuis le clone (carte verte), `bun <copy>/distribution/build-vision.ts` alors que la carte de `copy/` est rouge → rc 0, page écrite dans `copy/`, message « wrote distribution/vision/index.html ».
- Par `bun run build:vision` les deux racines coïncident. Correctif : une seule racine.

**C7 — `non-blocking`, suggestion. Un troisième fichier suivi sous `distribution/vision/` n'est vu par rien.**
- Où : `tools/quality/check-data-inventory.ts:257-262`, `.github/workflows/brick-map.yml:83-84`.
- Sonde (`bun probe-inventory.ts`) : avec `distribution/vision/tracking.html`, `old/page.html` et `extra.css` ajoutés à la liste suivie, `undeclared=0` ; `app.js` est hors univers. Le générateur ne nettoie ni n'énumère le répertoire.
- « ni script ni style en ligne » ne vaut donc que pour `index.html`. Correctif : déclarer les deux chemins exacts.

**C8 — `non-blocking`, suggestion. Trois familles de valeurs sont imprimées sans échappement.**
- Où : `layer.slug` (`build-vision.ts:156, 234, 244`), `brick.statut` (`:205`), tous les compteurs (`:229, :238, :268, :274, :281`).
- Aucune n'est une donnée aujourd'hui (constante, union dérivée, nombres calculés).
- Sonde (`bun probe-inject2.ts`, dernières lignes) : slug hostile → `a[href,onmouseover]` ; statut hostile → `span[class,onmouseover]` ; compteur hostile → `img[onerror,src]`.

**C9 — `non-blocking`, suggestion. La page omet des champs que la carte porte.**
- `origine.source` est présent sur 87 briques (`git grep -h 'source:' -- 'ecosystem/briques/*.v1.yaml' | wc -l`) ; la page imprime 87 fois « inspection » et 0 fois la source.
- Une brique retirée n'afficherait ni sa décision ni sa date ; `jetable` n'est pas imprimé (`bun probe-misc.ts`).

**C10 — `non-blocking`, suggestion. Accords et légende.**
- `bun probe-misc.ts` : « 1 briques en 11 couches », « 1 épinglées », « 1 produits ».
- La légende dit « Un nombre : la dépendance est admise » alors qu'une cellule refusée peut porter un nombre (`build-vision.ts:153`) ; état inatteignable par `projectVision`, le gate refusant une telle carte.

**C11 — `non-blocking`, preuve requise (décision de périmètre). Licence de la page.**
- `REUSE.toml:21` place `distribution/**` sous EUPL-1.2 ; les 99 fiches reprises sont sous CC-BY-4.0 par `**/*.md` (`REUSE.toml:38`), où `brand/projections/**` est rangé explicitement.
- Plus petit contrôle : l'arbitrage du propriétaire sur la licence de `distribution/vision/index.html`. `bun run check:reuse` non lancé.

**C12 — hypothèse. Tableaux en `display: block` sous 40rem.**
- `distribution/vision/vision.css:269-272` : selon le navigateur, cela peut retirer la sémantique de tableau et créer une zone défilante non atteignable au clavier. Aucun navigateur ouvert.

## 3. Tenté de casser, et qui a tenu

- **Injection par chaque champ et par le corps d'une fiche** : 682 cas (22 champs × 31 charges : rupture d'attribut, spans de code, entités déjà échappées, `$1`/`$&`, NUL, ESC, U+2028, U+202E, BOM, CRLF), lus avec `HTMLRewriter` → `markup: 0; not verbatim: 0` (`bun probe-inject2.ts`).
- **Fiche hostile par `parseFiche` puis `renderBody`** : seules `h4`, `p`, `code`, `ul`, `li` sortent (`bun probe-inject.ts`, lignes `fiche →`).
- **Frontière du schéma** : `id`, `depend_de`, `invariants`, `decisions`, `depots`, `preuve.date` hostiles sont refusés ; `nom`, `role`, `preuve.cible`, `origine.source` sont admis et échappés. Le schéma admet aussi U+2028, U+202E et les C1 ; la page suivie n'en contient aucun (`bun probe-page.ts` : 0).
- **Carte rouge** : fiche modifiée non indexée dans `copy/` → rc 1, violations imprimées, empreinte de `index.html` inchangée (`6773d83a…` avant et après).
- **Zéro ou deux fichiers d'ADR-0064** : `projectVision` refuse (mutants « zero » et « two ADR files accepted » tués). Fichier suivi absent du disque → `ENOENT` non rattrapé, rc 1 : échec fermé, sans message nommé.
- **Projection (a)** : 99 `details` pour 99 briques ; pastilles par statut 26/73/0/0 égales aux compteurs ; matrice de 121 cellules, somme 96 égale aux dépendances déclarées, 0 cellule refusée chiffrée (`bun probe-page.ts`).
- **Ni script ni style en ligne (d)** : 0 `script`, 0 `style`, 0 attribut `on*`, un seul `link` vers `vision.css` ; `vision.css` : 0 `content:`, 0 `url(`, 0 `@import` (`bun probe-contrast.ts`).
- **Déterminisme** : régénération identique au blob suivi, deux passes identiques, même sha256 `6773d83a…` sous `TZ=Pacific/Kiritimati LC_ALL=tr_TR.UTF-8` et `TZ=Pacific/Pago_Pago LC_ALL=C`.
- **Dérive, dans `copy/`** :
  - page différente de sa régénération → `git diff --stat --exit-code` rc 1 ;
  - `index.html` édité à la main ou supprimé du disque → régénéré, rc 0 ;
  - `vision.css` supprimé du disque → rc 1 ; supprimé de l'arbre suivi, c'est `check-data-inventory` qui le voit (`staleExtensions`).
- **Structure** : h1 1, h2 5, h3 11, h4 497, 0 saut de niveau ; 46 `th`, 0 sans `scope` ; 115 `id`, 0 doublon ; 140 liens, 0 pendant ; 119 `time`, tous `AAAA-MM-JJ` ; 1 légende pour 3 tableaux.
- **Contraste** : 24 paires de texte et de contour de focus, en clair et en sombre, toutes au-dessus du seuil ; minimum texte 5,19:1 (`prototypee` sur `surface`, clair), minimum non-texte 4,62:1. Les bordures `trait` sont à 1,36–1,57:1 ; ce sont des séparateurs (`bun probe-contrast.ts`).
- **Temps** : 10⁶ accents graves 1 ms, 2·10⁵ lignes de liste 21 ms.
- **Markdown non rendu** : 0 lien, 0 liste numérotée, 0 tableau, 0 bloc clôturé dans les 99 fiches ; le seul `**` est dans `apps/**`, en span de code.
- **PUB-01 et note 13, hors C3** : dates de preuve égales à celle du dernier commit des deux cibles (`git log -1 --date=short` → 2026-11-11) ; « n'écrit rien si la carte a une violation » et « à chaque pull request » tiennent.

## 4. Angles non couverts

- **`git add --intent-to-add` suivi de `git diff --exit-code`** : non exécuté, mon mandat interdit `git add`, y compris en copie. Mesuré : sans cette étape, un fichier neuf non suivi donne rc 0. Le cas « fichier neuf » et « `index.html` absent du commit » reposent donc sur la lecture du workflow.
- **Bun 1.4.0 de la CI** : aucune exécution. Les deux versions divergent sur des API voisines : `tools/quality/work-package-policy.test.ts:498` (`Bun.YAML.parse`) et `distribution/templates/langgraph-gates/langgraph-gates.test.ts` (`Bun.semver.order`) échouent en local. L'identité d'octets de la page sous la version épinglée n'est pas mesurée. Ces deux rouges n'ont pas été rejoués sur la base (`checkout` interdit) ; le second fichier date de `b720a2c`, 2026-10-23.
- **« Le workflow n'est pas un contrôle requis »** (PUB-01) : état des rulesets non lu, pas de réseau.
- **Rendu réel** : aucun navigateur, aucun lecteur d'écran ; rotation des en-têtes de la matrice et C12 non observés.
- **Exécution du workflow sur GitHub**, preuve de revue exigée par la surface gardée, négatifs déclarés de la pull request : hors du commit.
- **Qualité rédactionnelle des fiches** et **bibliothèque `briques.ts` / `check-briques.ts`** : hors objet, lues seulement pour savoir ce que le générateur reçoit.
