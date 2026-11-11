
# Revue adverse, passe 2 — page vision générée, delta `ecc75f1..aa14e78`

## Verdict : `approve-with-minor-reservations`

Rapport rendu en texte par un sous-agent à contexte neuf, reproduit tel quel sous ce titre. Les chemins de sonde qu'il cite sont ceux de son répertoire temporaire : ils ne sont pas dans ce dépôt.

Aucun constat `blocking` ni `major` sur `aa14e787`. Les huit constats ci-dessous sont `minor` ou `non-blocking`. Les sondes sont dans `/tmp/claude-502/scratch/revue-vision-2.H79AiB/` (laissé en place), relançables par `bun <fichier>` depuis ce répertoire.

## 1. Métadonnées

- **Commit relu** : `aa14e787f55d7f6455d964cef665aad85bddb4a8` (`git rev-parse HEAD`).
- **Dernier head revu** : `ecc75f1abc6a990308303e792add82b465a06a67` (`HEAD~1`).
- **Base** : `f806dd8c81863405b6cf1b03bd7ad202af0f9191` (`HEAD~2`).
- **Clone au début** : HEAD `aa14e787…`, `git status --short | wc -l` = 0.
- **Clone à la fin** : HEAD `aa14e787…`, `git status --short | wc -l` = 0.
- **Mode** : `candidate-integration`, passe de revue seule, lecture seule sur le clone. Mutations et indexations faites sur une copie (`cp -R`).
- **Bun** : local `1.4.4-canary.1+963452075` ; la CI épingle `1.4.0-canary.1+57f349f63` (`.github/workflows/brick-map.yml:73`).

Empreintes (`git ls-tree HEAD …`) :

| Fichier | Blob |
| --- | --- |
| `.github/workflows/brick-map.yml` | `dc9e549b5ea4bcc1c3b3afdacbd14319ce231d13` |
| `distribution/build-vision.test.ts` | `634ca640b750fc5093198ad5c4ec6712ed76ad3b` |
| `distribution/build-vision.ts` | `24d5bc3ea79319d172a4411b213bbfb0c9862276` |
| `distribution/vision/index.html` | `6c2ff4db9dafc4891df20d4969884dfbb6196aa4` |
| `distribution/vision/vision.css` | `d8200072235ef6100e32af608d68d292f11e9419` |
| `ecosystem/briques.ts` | `f619a42cba2fa34bab4c1824e279cbc9f73fda0f` |
| `tools/quality/check-data-inventory.ts` | `877ad10cc16a937f857b092815881cc69124730f` |

Commandes de preuve :

| Commande | Résultat |
| --- | --- |
| `bun test distribution/build-vision.test.ts` | pass — 25 pass, 0 fail, 120 expect |
| `bun test ecosystem/briques.test.ts ecosystem/check-briques.process.test.ts` | pass — 204 pass, 0 fail, 316 expect |
| `bun run check:briques` | pass — « Brick map verified: 119 assertion(s) hold — 99 brick(s) in 11 of 11 layer file(s) » |
| `bun run build:vision` puis `git diff --stat -- distribution/vision` | pass — diff vide ; `git hash-object` de la page égale le blob suivi |
| `bun run check:data-inventory` | pass — « 58 assertion(s) hold — 928 tracked file(s) … 0 undeclared » |
| `bun run lint` | pass — rc 0 ; 1 avertissement et 15 infos, tous hors des fichiers de la pull request (`biome ci distribution ecosystem/briques.ts tools/quality/check-data-inventory.ts` : aucun diagnostic) |
| `bun run typecheck` | pass — rc 0 |

## 2. Les douze constats de la première passe

| # | État | Sonde et sortie |
| --- | --- | --- |
| C1 | **tenu** | Page suivie, ligne `gouvernance` : « vérifiée par le gate pour sa première moitié seulement ; la seconde est comptée et ne bloque pas ». Les 5 mutants du libellé de règle sont tués. Retirer le champ fait rougir `build-vision.test.ts` et `ecosystem/briques.test.ts:250`. |
| C2 | **tenu, avec réserve N1** | `probe-standing.ts` sur les 67 fichiers de `docs/adr` : 61 `accepted`, 1 `accepted,` → accepted, 3 `proposé` → proposed, 1 `deferred` → null, 1 sans ligne → null. Deux lignes de statut → null. |
| C3 | **partiellement tenu** | Les trois phrases citées sont corrigées et vraies du code. Deux sites de la même classe restent : voir N2. |
| C4 | **partiellement tenu** | `bun mutate.ts` : 166 mutants = 126 tués + 40 survivants + 0 invalide. Tous les mutants nommés par le mandat sont tués. 38 survivants ne sont pas équivalents : voir N3. |
| C5 | **tenu, non verrouillé** | `probe-process.ts` cas 1 : statut passé à `accepted` sur le disque sans indexation → « ADR-0064 proposed », page inchangée (`a45e43833dd7`). Aucun test ne le couvre (N3). |
| C6 | **tenu, non verrouillé** | Générateur lancé depuis le répertoire de sonde, depuis `/` et depuis `distribution/vision/` : rc 0, page écrite dans la copie, sha256 identique `a45e4383…` trois fois, rien écrit ailleurs. Aucun test ne le couvre (N3). |
| C7 | **partiellement tenu** | `probe-inventory.ts`, troisième fichier suivi sous `distribution/vision/` : rc 1 pour `.html`, `.css`, `.svg`, `.json`, `.txt`, `.woff2`, `.png` et `sub/deeper.html` ; rc 0 pour `.js`, `.mjs`, `.ts`, `.md`. Voir N6. |
| C8 | **tenu pour le slug et le statut** | 4 mutants d'échappement tués. Les compteurs restent imprimés bruts : un compteur forcé en chaîne sort brut 3 fois (`probe-page.ts`). Ils sont typés `number` et calculés par le gate, aucun chemin de données ne les atteint. |
| C9 | **tenu** | Page suivie : 87 « Origine : inspection — <source> » pour 87 briques qui en portent une. `jetable` et `retrait` : 0 dans les données, verrouillés par marqueurs (3 mutants tués). |
| C10 | **tenu** | Page : « 22 briques … ne sont liées », « 10 cibles de preuve sont citées », « 21 briques n'ont », « 38 restent ». Légende de la matrice vérifiée contre les données (point 4). L'accord pluriel « ne sont liées » n'est verrouillé par aucun test (N3). |
| C11 | **laissé, comme déclaré** | `REUSE.toml:21` place `distribution/**` sous EUPL-1.2 ; `REUSE.toml:38` place `**/*.md`, donc les fiches, sous CC-BY-4.0. La décision en attente n'est écrite dans aucun fichier suivi : `git grep -i 'licen\|EUPL\|CC-BY'` sur `PUB-01.md`, `distribution/README.md` et la note 13 ne rend que l'en-tête SPDX de l'ADR. |
| C12 | **tenu** | `probe-contrast.ts` : 0 déclaration `display` sur `table`, `thead`, `tbody`, `tr`, `th`, `td`. Page : 3 tables, chacune dans `<section class="defilante" aria-label="…">`. |

## 3. Constats nouveaux

**N1 — minor — preuve requise. L'acceptation que l'ADR prescrit pour lui-même ne donne aucune page.**
- Lieu : `distribution/build-vision.ts:345-353`, `distribution/build-vision.test.ts:413`.
- La ligne de statut d'ADR-0064 dit que le propriétaire « fait passer ce statut de proposé à en vigueur » (`docs/adr/0064-…md:5`). `standingOf` rend `null` sur « en vigueur », et un test l'exige.
- Sonde, `probe-process.ts` cas 3 (statut « en vigueur » indexé) : rc 1, « ADR-0064 does not carry exactly one status line whose first word is accepted, proposé or proposed ».
- L'échec est fermé et son message nomme les mots attendus. Le job `vision-page` rougit dans la pull request d'acceptation.
- Même probe : « accepté » → null, « Accepted » → null.
- Correctif possible : dire dans la note 13 quel mot la page lit (`accepted`, celui des 62 autres ADR), ou lire « en vigueur » comme accepté.

**N2 — minor — défaut bloquant au sens « affirmation fausse du code », classe C3 non balayée.**
- `ecosystem/briques/publication.v1.yaml:9`, rôle de PUB-01, imprimé sur la page : « Génère la page vision depuis les seules sorties du vérificateur […], sans qu'aucun texte y soit saisi. » La fiche `PUB-01.md:5` et la note 13 disent l'inverse depuis ce commit : texte fixe écrit dans le générateur, statut de l'ADR comme seconde source.
- `distribution/build-vision.ts:4-5` : « everything it shows comes from `checkBriques` ». Le statut vient de `git show :docs/adr/0064-…` (ligne 414).
- Sonde : le `git grep -n -i "seules sorties|aucun texte|…"` hors `docs/reviews` rend ces sites ; la ligne 9 du YAML est absente de `git diff HEAD~2 HEAD -- ecosystem/briques/publication.v1.yaml`.
- Site voisin, périmé : `ecosystem/briques/fabrique/FAB-13.md:31` annonce encore la page comme « prochaine preuve ».

**N3 — minor — preuve requise. La suite laisse vivre 38 mutants non équivalents, et deux phrases de l'auteur ne tiennent pas contre eux.**
- Commande : `bun mutate.ts` (liste complète dans `mutants.out`). L'affirmation « 65 mutations, toutes tuées » n'est pas réfutable sans la liste ; la mienne en a 166.
- Bloc principal, 7 sur 7 survivent : racine prise dans `process.cwd()`, carte lue dans le cwd, page écrite dans le cwd, ADR lu sur le disque, filtre `0064-` élargi, `process.exit(1)` neutralisé ou passé à 0. Les corrections C5 et C6 n'ont aucun test, et le job de CI ne les voit pas non plus (cwd = racine, disque = index).
- Comptes : `count(11, "couche", "couches")` survit ; le nombre de la diagonale de la matrice mis à 0 survit (la page réelle y porte 11 pour gouvernance). L'en-tête de la suite dit « every count is asserted on a value no template would carry ».
- Texte fixe, 8 sur 11 survivent : légende inversée (« Un tiret : la dépendance est admise »), légende supprimée, sens de `decrite` et de `retiree`, libellés `retirée` et `prototypée`, `noindex`, phrase du chapeau. Le message de commit dit « a change of wording of the page turns them red ».
- Table des couches : colonnes rôle, « Peut dépendre de » et règle propre vidables (6 survivants).
- `renderBody` : séparation de deux paragraphes par une ligne vide, jointure de deux lignes, paragraphe collé à une liste (4 survivants).
- `standingOf` : regex sans ancre, mot `proposed` retiré, `startsWith("accept")` (4 survivants).
- Divers : libellés « aucune » / « aucun » des listes vides (3), `scope` des en-têtes de la matrice (2), accord pluriel « ne sont liées » (1), échappement de `ownRuleVerifiedOnly` (1), libellé d'une couche admise remplacé par son slug (1).
- Deux survivants équivalents, écartés du compte : dépendance vers un id inconnu conservée ; `statuses.length > 1`.

**N4 — non-blocking — preuve requise. Le sens imprimé de « en cours » dépasse ce que vérifie le gate lancé par le générateur, pour 40 briques sur 73.**
- Lieu : `distribution/build-vision.ts:56`, « au moins un artefact daté existe ».
- `probe-pinned.ts` : en_cours 73 ; preuves sur cet arbre 50 ; épinglées 69 ; briques en_cours sans aucune preuve sur cet arbre : 40.
- Le gate de la carte ne résout pas une cible épinglée (`ecosystem/briques.ts:41`) ; il la laisse au gate `pinned-citations`, dont le générateur ne lit pas le verdict.
- Plus petit contrôle : montrer que `pinned-citations` est vert sur le même arbre, ou écrire « au moins une preuve datée est citée ».

**N5 — non-blocking — suggestion. Le volume du gate et la page peuvent diverger sur la règle partielle.**
- Lieu : `ecosystem/briques.ts:1242-1255`. Le commentaire dit « the volume and the page cannot disagree on which rule is partial ».
- `probe-partly.ts`, champ retiré : « for , its dependency half », gate rc 0.
- Champ posé sur `produit` avec un autre texte : le volume dit « its dependency half » pour les deux couches.
- Champ posé sur `harness` (`ownRuleVerified: false`) : le volume range harness parmi les partielles, la page imprime « déclarative, non vérifiée ».

**N6 — non-blocking — suggestion. « Un troisième fichier est une décision » ne vaut pas pour un script.**
- Lieu : `tools/quality/check-data-inventory.ts:257-258`.
- Un `track.js` ou `module.mjs` suivi sous `distribution/vision/` passe l'inventaire (rc 0, source hors univers) et le job de dérive (`probe-process.ts` cas 12 : `git diff` rc 0).
- La page ne le charge pas : seul attribut `href` non fragment = `vision.css`.

**N7 — non-blocking — suggestion. Les 99 briques tiennent sur une seule ligne du fichier suivi.**
- `distribution/vision/index.html` ligne 32 : 357 771 octets sur 370 159.
- Deux pull requests qui touchent deux briques différentes modifient la même ligne. Conflit textuel non reproduit : hypothèse pour la conséquence, mesure pour la longueur.
- Un saut de ligne entre briques (`build-vision.ts:281`) le lèverait.

**N8 — non-blocking — suggestion, hypothèse. La légende de la matrice ne désigne les cellules que par leur aspect.**
- Lieu : `build-vision.ts:178-180`, « encadrée », « en italique ».
- La distinction existe en texte (un nombre pour une dépendance admise, un tiret pour une refusée), mais la légende ne le dit pas. Aucun lecteur d'écran n'a été lancé.

## 4. Ce que j'ai tenté de casser et qui a tenu

- **`standingOf` sur les lignes réelles** : 66 lignes de statut, aucune lue à tort (`probe-standing.ts`).
- **Générateur depuis un autre répertoire** : trois cwd, même sha256, écriture dans le dépôt du script.
- **ADR modifié sur le disque sans indexation** : page inchangée (cas 1). Indexé `accepted` : page « accepté », `git diff` rc 1 (cas 2).
- **Carte rouge ou statut illisible** (cas 4 à 8 : `deferred`, deux fichiers `0064-`, ADR retiré de l'index, YAML invalide indexé, YAML différent de l'index) : rc 1 à chaque fois, page inchangée.
- **Job de dérive rejoué** : page éditée à la main et indexée → rc 1 ; `index.html` retiré de l'index et du disque → rc 1 ; fichier neuf non suivi → rc 1 par `--intent-to-add` ; générateur modifié sans régénération → rc 1 ; fiche modifiée sans régénération → rc 1 ; `vision.css` modifié non indexé → rc 1 ; `vision.css` modifié et indexé → rc 0, attendu pour un fichier écrit à la main.
- **Déclencheurs du workflow** : `pull_request` sans filtre de chemins ; « à chaque pull request » (`PUB-01.md:21`) est vrai du fichier.
- **Injection de balisage** (`probe-parse.ts`, analyse par `HTMLRewriter`) : 34 champs hostiles, dont `origine.source`, `origine.date`, `jetable`, `retrait.decision`, `retrait.date`, `ownRuleVerifiedOnly`, libellé, rôle et règle de couche. La page hostile porte les mêmes 33 éléments et 11 noms d'attributs que la page suivie, aucun de plus.
- **Liens** : chaque `href` de donnée est préfixé par `#`, donc aucun `javascript:` possible.
- **Rien de saisi** (`probe-page.ts`, `probe-fiches.ts`, YAML relus sans le gate) : 99 briques, 26 / 73 / 0, 119 preuves, 10 cibles partagées, 21 sans dépôt, 22 sans invariant (liste identique), comptes par couche des 11 titres : tous égaux. 1 426 lignes de fiche et 1 488 scalaires YAML cherchés dans la page : 0 manquant. 396 sections `##` = 396 `h4` de fiche.
- **Matrice** : somme des cellules 96 = 96 entrées `depend_de` ; 22 cellules `admise` = 22 selon la table D1 relue dans le fichier de l'ADR ; 0 écart de cellule ; colonne « Peut dépendre de » : 0 écart sur 11.
- **Ni script ni style en ligne** : aucun `<script>`, `<style>`, attribut `style`, gestionnaire `on*`, ni référence `http(s)` dans la page ; 0 `url(` et 0 `@import` dans la feuille.
- **Accessibilité statique** : 46 `th` sur 46 avec `scope` ; h1 1, h2 5, h3 11, h4 497, aucun niveau sauté ; 115 `id` sans doublon ; 140 fragments tous résolus ; 3 régions nommées ; 1 `caption` pour 3 tables.
- **Contrastes** (`probe-contrast.ts`) : 20 paires calculées, 0 sous son seuil, en clair et en sombre. Les plus bas : bord `.admise` sur `pastille-fond` 4,62 (seuil 3) ; `.statut-prototypee` 5,19 (seuil 4,5). `.interne`, `.refusee`, `.regle` : 7,69 clair, 8,44 sombre.
- **Commentaire sur `tabindex`** (`build-vision.ts:79-81`) : vrai. Avec `tabindex="0"`, `biome ci distribution/vision/index.html` rend rc 1, `lint/a11y/noNoninteractiveTabindex` trois fois (`probe-tabindex.ts`).
- **Point (g)** : la sortie de `bun ecosystem/check-briques.ts` avec `ecosystem/briques.ts` de `HEAD~2` indexé dans la copie est identique à l'octet à celle de HEAD (`cmp`, 1 248 octets).
- **Phrases de la note 13, de `PUB-01.md` et du README** : vraies du code, sauf les deux sites de N2 qui sont hors de ces trois textes. La dépendance non déclarée vers FAB-13 est dite dans `PUB-01.md:15`.

## 5. Angles non couverts

- **Bun de la CI** : le binaire `1.4.0-canary.1+57f349f63` est une archive linux-x64 à télécharger, non exécutée ici. L'identité de la page sous cette version n'est pas mesurée.
- **Résolution des 69 citations épinglées** : demande le réseau, non lancée (lié à N4).
- **« Le workflow n'est pas un contrôle requis »** et **« aucun site ne sert cette page »** : état des rulesets et de GitHub Pages non lu. Localement, aucun workflow de publication de site dans `.github/workflows/`.
- **Rendu réel** : aucun navigateur ni lecteur d'écran ouvert ; défilement au clavier, en-têtes verticaux et mode sombre non observés.
- **Description de la pull request** et sa déclaration de négatifs (ADR-0056 D5), **dossier de preuve de revue** exigé par `check-review-evidence` : non lus, la pull request n'est pas dans le clone.
- **Qualité rédactionnelle des fiches** et **`ecosystem/check-briques.ts`** : hors périmètre par mandat.
