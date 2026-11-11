
# Revue adverse, passe 3 — delta `6e562e1..2842e67` du gate « carte des briques »

## Verdict : `approve-with-minor-reservations`

Aucun faux vert atteignable sur un checkout de CI n'a été trouvé dans le delta. Les faux verts restants sont locaux. Le delta introduit un faux rouge local (H1) et laisse la classe de G1 ouverte sur cinq sources de doctrine (H2).

## Identité de la passe

- **Commit relu** : `2842e670b997378cf3bcad123df85fe260ab26f6`, identique en fin de passe.
- **Worktree** : `git status --short` rend `?? node_modules` au début et à la fin ; aucun stash.
- **Gate** : exit 0, `Brick map verified: 118 assertion(s) hold — 99 brick(s) in 11 of 11 layer file(s) … 111 tracked entry(ies) … + 0 refused; status derived: decrite 27, en_cours 72, prototypee 0, retiree 0 … proofs held: 48 on this tree, 69 pinned … 22 brick(s) outside the gouvernance layer bound by no invariant … 10 proof target(s) cited by more than one brick`.
- **Suites** : `176 pass / 0 fail / 278 expect() calls`, au début et à la fin.
- **Outils** : Bun `1.4.4-canary.1+963452075`, git `2.56.0`, macOS/APFS. Rien n'a été mesuré sous `1.4.0-canary.1+57f349f63` ni sous Linux.
- **Empreintes SHA-256**, identiques au début et à la fin :

```
9f784b5276b2a70491bcfb69613e1dffe8ece98427d24d03c1a61afcdf03aab6  ecosystem/briques.ts
3afd31c6aa715b9f04223859a22440b4bbe1fcc8c34901b2ed907bdd5300c7a7  ecosystem/check-briques.ts
cf399cb6c28f229832dabfb301cbb6d3f6db2ae789d311c20b879f0fb44165b5  ecosystem/briques.test.ts
1efdd0ab57025fe12e82c129f25642412a3b8c57ec75d0039e5fbfcd1f0aec02  ecosystem/check-briques.process.test.ts
f86452945f16da5b530515b4f0090964f08fde344b93d1497182dab2ce91c9c1  ecosystem/schemas/brique.v1.schema.json
1cbf3b28d248aeacac36152fdc563d2072fe4d0fd8440eec2efa614ce4e6b7cf  docs/adr/0064-brick-map-eleven-layers-derived-status.md
```

**Rejouer** : `cd <espace de sonde>/scripts && bun <script>`.
- Scripts : `a-g1.ts`, `a-rest.ts`, `a-rest2.ts`, `a-g9.ts`, `b-rest.ts`, `diff-heading.ts`, `regex-time.ts`, `mutants.ts` (sortie conservée dans `<espace de sonde>/mutants.out`).
- `full/` est la copie indexée du commit ; `old/` porte `briques.ts` de `6e562e1` pour le différentiel.
- Témoin : une brique `IDN-90` (dépend d'`IDN-02`, cite `I-09`, `ADR-0009`, `D10`) avec sa fiche ; seule, elle sort `exit=0`.
- Les sondes de la passe 2 ont été reconstruites : son espace `probe.iFynf2` n'existe plus.

## Tableau A — réserves G1 à G12

| Réserve | Sonde | Sortie sur ce commit | Classement |
| --- | --- | --- | --- |
| G1 contenu lu sur disque | `bun a-g1.ts` : B1a, B1c, B2a, B2b, B3a, B4, B5, B14, S1b, S3 | 10 fois `exit=1`. Huit portent `its working copy differs from the index`. B14 et B14b (sous-répertoire) : `cites ADR-9999, which docs/adr/ does not hold` | fermé pour les 10 entrées. Résidus : H1, H2, H3 |
| G2 ADR cite une revue absente | `git ls-files docs/reviews \| grep -i brick` ; `grep -rn brick-map-v0` | aucun fichier ; une seule occurrence, `docs/adr/0064-…md:51` | non traité, non déclaré |
| G3 mention invisible | `bun a-rest.ts`, section G3 | N2, N3, N5, N7 : `exit=1`, `the YAML cites IDN-02, I-09, ADR-0009, D10, which the fiche never names`. N9, N6c : `exit=0` | fermé pour N2, N3, N5, N7. N9 et N6c non traités ; « plancher » est dit dans `briques.ts:476`, pas dans le README. Formes restantes : H6 |
| G4 ligne forgée | `bun a-rest.ts`, section G4 : B9b, o1, o2, o3, o5 | 5 fois `exit=1`, 0 ligne commençant par `::`, 0 caractère de contrôle ; `x\x0a::error title=forged::y` imprimé échappé | fermé |
| G5 mutants survivants | `bun mutants.ts`, groupe `passe2` | 23 reconstruits = 12 tués + 11 survivants | partiellement fermé (détail sous « Mutants ») |
| G6 graphies de statut | `bun a-rest.ts`, S1 à S5 | 5 fois `exit=0` | fermé autrement : README ligne 16, exact pour S1, S2, S3, S5. Inexact pour S4 (`<!---> Statut : en_cours. <!-- x -->`) : la valeur y est écrite en toutes lettres, ce n'est pas une graphie |
| G7 titres non comptés | `bun a-rest.ts`, H1 à H5 | 5 fois `exit=0` | fermé autrement, texte exact (README ligne 16). Le delta ajoute deux formes : H4 |
| G8 lecture non linéaire | `bun diff-heading.ts` | ancien lecteur : 15, 224, 3 412 ms pour 5 000, 20 000, 80 000 espaces ; nouveau : 0 ms, et 0 ms à 400 000 | fermé. Même classe rouverte ailleurs par le delta : H7 |
| G9 règles non vérifiées | `bun a-g9.ts` Y18, Y24, Y26 ; `bun a-rest2.ts` Y17, Y25 | Y18, Y24, Y26 : `exit=1`, `proof target cited twice by the same brick`. Y17 (date `0001-01-01`) : `exit=0`. Y25 (README hors suivi) : `exit=0`, `+ 0 README` | cible répétée : fermé. Date : fermé autrement, README ligne 39 exact (l'ADR ligne 57 énonce encore la règle sans dire qu'elle n'est pas vérifiée). README absent : non traité, non déclaré |
| G10 faux rouges | `bun a-rest2.ts` R13, R9, R6, E1, I-100 ; `bun a-g9.ts` Q5 | R13 (`docs/en_cours/x.md`), Q5 (`libre-ai/retiree`), I-100 : `exit=0`. R9, R6, E1 : `exit=1` (E1 : `0 brick(s) in 0 of 11`) | fermé pour R13, Q5 et le motif `I-[0-9]{2,3}`. R9, R6, E1 non traités, non déclarés, échec fermé |
| G11 citation en clair en commentaire | `bun a-rest2.ts`, Y4 | `exit=0`, `IDN-02 — en_cours, 2 proof(s) held` | non traité, **non déclaré** : le README ligne 16 liste trois limites, celle-ci n'en fait pas partie |
| G12 index en conflit | `bun a-g1.ts`, trois étapes sur la fiche | `git diff-files` liste le chemin ; `exit=1`, `its working copy differs from the index` | fermé par le code, pas par une déclaration (le README n'en parle pas) |

Deux annonces de l'auteur sont inexactes : G11 n'est pas déclaré dans le README, et G12 est fermé par `git diff-files` et non déclaré.

## Constats nouveaux

### Bloquant, majeur
Aucun.

### Mineur

**H1 — `git diff-files` sans rafraîchissement de l'index : un fichier au contenu identique est refusé.**
- **Lieu** : `ecosystem/check-briques.ts:97-109`.
- **Commandes** : `bun a-g1.ts` (F2, F3), `bun b-rest.ts` (F9).
- **Entrées et sorties** :
  - F2 : mtime d'une fiche changé, contenu identique : `exit=1`, `IDN-02: fiche …: its working copy differs from the index`. Après `git status`, `exit=0`.
  - F9 : `xattr -w user.sonde 1` sur une fiche (ctime seul) : `exit=1` ; `git status --porcelain` ne liste rien.
  - F3 : `cp -R` d'un arbre propre : `git diff-files --name-only` liste 918 chemins, `git status` 0 ; `exit=1`, les 11 fichiers de couche refusés.
- **Attendu** : `exit=0`, le contenu ne diffère pas.
- **Portée** : locale. Sur le worktree relu, `git diff-files --name-only | wc -l` rend 0. Le workflow `brick-map.yml` ne fait que `checkout` puis `bun install --frozen-lockfile` : pas de faux rouge attendu en CI (inféré, non exécuté sur un runner).
- **Correction** : comparer les octets, pas les stats. `git hash-object --no-filters --stdin-paths` sur les fichiers lus, contre l'oid de `git ls-files --stage`. Vérifié : K0, copie stat-dirty partout, 0 écart.

**H2 — La classe de G1 n'est pas balayée : cinq sources de doctrine sont lues sur disque sans comparaison à l'index.**
- **Lieu** : `ecosystem/check-briques.ts:163`, `:168`, `:182`, `:215-219`.
- **Commandes** : `bun a-g1.ts` (R1, R2), `bun a-rest2.ts` (R3, R5).
- **Entrées et sorties** :
  - R1 : `I-99` ajouté à `INVARIANTS.md` sur disque seulement, cité par une brique indexée : `exit=0`.
  - R2 : `D9999` ajouté à `DECISION-REGISTER.md` sur disque seulement : `exit=0`.
  - R3 : inventaire indexé avec `capability-authorization` privé : `exit=1` (`is private … (I-15)`). Disque rendu public sans `git add` : `exit=0`.
  - R5 : configuration des citations indexée sans `ecosystem/briques/` dans son périmètre : `exit=1`. Disque rétabli sans `git add` : `exit=0`.
- **Inféré, non exécuté** : le contenu d'ADR-0042 (catalogue) et le schéma suivent le même chemin.
- **Attendu** : rouge, comme pour une fiche.
- **Écart de texte** : le README ligne 14 dit « le gate ne répond pas d'un contenu que git ne suit pas » ; c'est faux pour ces sources.
- **Portée** : locale.
- **Correction** : étendre l'ensemble refusé à ces fichiers ; la comparaison par empreinte de H1 les couvre du même coup.

### Non bloquant

- **H3 — Écarts que `git diff-files` ne signale pas** (`check-briques.ts:99`). `bun a-g1.ts`, index mauvais (statut écrit dans la fiche), disque bon, `exit=0` dans les trois cas :
  - F1 : `--assume-unchanged` ou `--skip-worktree` ;
  - F6 : filtre `clean` local posé par `.git/info/attributes` ;
  - F4b : `core.fileMode=false` avec un mode changé.
  - Tous locaux et délibérés. La comparaison par empreinte les voit : K1 et K2, 1 écart chacun.
- **H4 — `headingOf` ne lit plus un titre suivi d'une tabulation** (`briques.ts:460`).
  - Différentiel sur 299 593 lignes, `bun diff-heading.ts` : 12 classes d'écart. `"#\tTitre"` : ancien `titres=["Titre"]`, nouveau `[]`. `"##\tSection"` : ancien `sections=["Section"]`, nouveau `[]`.
  - Effet, `bun a-rest.ts` : H6 (`#\tSecond titre`) et H7 (`##\tCinquième`) sortent `exit=0`.
  - Inféré, non exécuté : le rouge du gate à `6e562e1` sur ces deux fiches, déduit de la règle des sections, inchangée.
  - Le README ligne 16 écrit les deux formes avec une espace, donc le texte couvre ce cas. Aucun test ne fixe le séparateur (mutant H4 survivant).
- **H5 — `readableProse` retire du texte visible** (`briques.ts:481-487`). `bun a-rest.ts`, `exit=1` avec `which the fiche never names` alors que la phrase qui nomme est présente :
  - V8 : la phrase entre un `<` et un `>` de la même ligne ;
  - V9 : une ligne ouverte par `[I-09]: ` suivie de plusieurs mots ;
  - V7 : une phrase après `<!--->` ;
  - V10 : une ligne `# …` dans un bloc de code.
  - Mesure sur la carte : `grep -n "^\s*\[" ecosystem/briques/*/*.md` et `grep -n "<[^>]*>"` rendent 0 ligne. Le caractère visible au rendu est inféré, aucun moteur Markdown n'a été lancé.
- **H6 — Mentions cachées que `readableProse` compte encore** (`briques.ts:485`, `:487`). `bun a-rest.ts`, toutes `exit=0` :
  - V1 : balise sur deux lignes ;
  - V2 : `[//]:# (…)` sans espace après les deux-points ;
  - V3, V3b : définition de lien dont le titre ou la destination est à la ligne suivante ;
  - V4 : étiquette à crochet échappé ;
  - V6 : attribut contenant `>`.
  - Correction : dire dans le README que la règle est un plancher, comme le dit le commentaire du code.
- **H7 — Le motif des balises est quadratique** (`briques.ts:487`). `bun b-rest.ts`, T1 : une ligne de 20 000, 80 000, 320 000 `<` : 139, 1 152, 16 983 ms. Correction mesurée par `bun regex-time.ts` : `/<[^<>\n]*>/g` rend 0 ms à 320 000 et le même résultat sur l'échantillon. Échec fermé par le délai du workflow.
- **H8 — Écarts entre le texte et le code.**
  - README ligne 14, « un fichier de la carte … est refusé » : F8, `ecosystem/briques/README.md` modifié puis supprimé du disque sans `git add`, `exit=0` deux fois.
  - README ligne 50, `git add ecosystem/briques && bun run check:briques` : P1, `ecosystem/briques.ts` modifié, `exit=1`, `FAB-13: proof target ecosystem/briques.ts: its working copy differs from the index`. 42 chemins distincts sont cibles locales, dont `briques.ts`, `check-briques.ts` et le schéma.
  - F4 : `chmod 755` seul sur une cible : `exit=1`.
- **H9 — Deux branches de `localTarget` ne sont plus atteintes** (`check-briques.ts:205`, `:207-209`) : une cible supprimée ou changée de type est refusée avant, par `unstaged`. Le mutant `X-cible-isFile` est devenu équivalent.
- **H10 — `printable` laisse passer U+0085, U+2028 et U+009B** (`briques.ts:493`). `bun a-rest.ts`, o4 : imprimés bruts, 0 ligne commençant par `::` à la découpe LF. Leur lecture comme saut de ligne par un runner est inférée, non exécutée.

## Sondes sans constat

- **Fichier sans rapport** : F7, `README.md` de la racine modifié : `exit=0`.
- **`core.autocrlf`** : F5b, CRLF sur disque et LF dans l'index après `git add` : `exit=0`.
- **ADR supprimé du disque, encore indexé** : R4, `exit=0`, conforme à « ceux que git suit ».
- **Cible répétée sous une autre écriture** : Y19 (`./`), Y20 (`//`), Y21 (`x/../`), Y22 (autre casse) : `exit=1` par les règles de chemin. Y23, même contenu sous un second nom suivi : `exit=0`, deux artefacts.
- **`proseOf` contre le schéma** : les dix champs de prose du schéma y sont tous (`nom`, `role`, `preuve_produite`, `jetable`, `origine.source`, cinq de `charte`). Q6 à Q9 (`role`, `nom`, `origine.source`, `jetable`) : 4 fois `exit=1`, `a field states a status`.
- **`printable`** : `GateReport.violations` dérive de `ok` (`gate-report.ts:68`), aucune violation masquée ; aucun test ne dépend d'un item modifié (176 verts).
- **Temps** : T2 (200 000 lignes `[`), T3 (400 000 espaces puis `[`), T4 (100 000 `<!--`) : 82, 72, 71 ms.
- **Titres de niveau 3, `#x`, `# x ##`, `## C#`** : identiques entre l'ancien et le nouveau lecteur.
- **Non sondé** : dépôt en cours de fusion au-delà des trois étapes de G12 ; `git diff-files` sur un runner Linux.

## Mutants

`mutants : 68 = 39 tués + 29 survivants + 0 en erreur ou motif cassé`, base `176 pass` avant et après.

**Règles du delta : 45 = 27 tués + 18 survivants.**

| Survivant | Règle | Test attendu |
| --- | --- | --- |
| C2 | `git diff-files` en échec ⇒ tout chemin suivi refusé | un cas de processus où git répond à `ls-files` et pas à `diff-files` |
| C4 | un ADR est un fichier direct de `docs/adr/` | quasi équivalent : seul un répertoire `NNNN-x/` le distingue |
| RP7 | définition de lien indentée | un cas `  [x]: …` |
| RP8 | une balise retirée laisse un séparateur | un cas `I-0<b></b>9` |
| PR2 | item rendu imprimable | équivalent aujourd'hui : aucun item ne porte une donnée libre |
| PR4, PR7 | DEL ; ESC, TAB, NUL rendus visibles | les trois cas ne plantent que LF et CR |
| H3, H5 | un titre vide n'est pas un titre | `# #`, `## ##` ; le test « `##` alone » passe par `startsWith("## ")` |
| H4 | un titre exige une espace après les `#` | `#mot`, `### x` |
| PO3, PO5 à PO9 | statut refusé dans `preuve_produite`, `origine.source`, `charte.valeur`, `pour_qui`, `degel`, `abandon` | un cas par champ |
| SC1, SC2 | le schéma admet `I-100`, refuse `I-1000` | deux vecteurs |

**Survivants de la passe 2, reconstruits : 23 = 12 tués + 11 survivants.**
- Tués : `D-lookahead`, `D-casse`, `S-lookbehind`, `S-lookahead`, `N-sans-depend`, `N-avant`, `P-fermeture`, `R-retiree`. `S-textsOf-tableaux` est remplacé par PO10, tué.
- Encore survivants : `S-commentaires`, `N-avant-tiret`, `X-executable`, `X-autre-fichier`, `X-cible-isFile` (devenu équivalent, H9), `X-exemptions`, `X-tolerance-date`, `X-tolerance-zero`.
- Schéma : 3 essayés, 3 survivants (`nom`, `phrase`, `cible` max). `git diff 6e562e1 2842e67 -- ecosystem/fixtures` rend 0 ligne : les 14 autres sont inférés survivants.
- Non reconstruits : `X-config-illisible`, `X-depots-illisibles`.

## Ce que la passe exclut

- Le gate et `Bun.YAML` sous le Bun épinglé de la CI ; Linux ; l'exécution de `brick-map.yml`.
- La résolution réseau des 69 citations épinglées.
- Tout rendu Markdown : « visible » et « invisible » dans H5, H6 et G3 sont inférés.
- Le contenu des fiches, le générateur de page, le code relu à la passe 2 hors des six fichiers.

## Écarts à la consigne

- **Écriture hors de mon espace, annulée.** Un `ln -s` vers un lien existant a créé `node_modules/node_modules` dans `<clone de travail>/node_modules` (répertoire ignoré du clone parent) à 18:49:33 UTC. Retiré à 19:50 CET par `unlinkSync` (`undo-link.ts`), après contrôle du type et de la cible. `git status --short` du clone parent : 0 ligne ; du worktree : `?? node_modules`.
- **Premier passage des mutants invalide.** L'environnement purgé n'avait pas `TMPDIR` : base à `155 pass / 2 fail`. Relancé avec `TMPDIR` ; seuls les chiffres du second passage sont rapportés.
- **Espace de sonde** : `copies/`, `mut*/`, `outside/`, `home/` effacés par `scratch-clean` ; `scripts/`, `full/`, `old/` et `mutants.out` laissés (18 Mo) pour rejouer.

## Modèle

Fable 5.2 (`claude-fable-5-2`).
