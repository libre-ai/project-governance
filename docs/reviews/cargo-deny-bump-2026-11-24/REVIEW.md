<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-reservations

# cargo-deny 0.19.5 → 0.22.0 : revue

**Date :** 2026-11-24
**Objet :** la pull request #313, qui monte l'épinglage de cargo-deny de 0.19.5 à 0.22.0 dans `toolchains/cargo-deny.json`, l'installateur de composition, le gabarit `reusable-dependency-policy.yml`, le gate `tools/quality/check-dependency-policy.ts` et le contrôle périodique `tools/security/rust-advisories.ts`.
**Nature :** dossier de revue d'une pull request écrite par un agent. Il rend compte de ce que l'auteur a mesuré et de la passe qui a examiné la pull request ; il n'est pas un arbitrage du propriétaire, et aucun agent n'en écrit.
**Rôle :** deux passes de revue, chacune faite en lecture seule par un sous-agent à contexte neuf, distinct de l'auteur. Ce dossier est tenu par l'auteur, qui y reporte le verdict et les constats que chaque passe lui a rendus.
**Surface gardée touchée :** `deny.toml` et `crates/ecosystem-engine/deny.toml` (la ligne `unmaintained = "all"`, octet pour octet celle de la pull request préparatoire #311) ; `ecosystem/toolchain-freshness-exceptions.v1.yaml`, pour une seule ligne de commentaire (l'exemple de forme citait `held_at: 0.19.5`), sans entrée ajoutée, retirée ni modifiée.

## Les passes

| Passe | Commit relu | Base (`git merge-base`) | Verdict |
| --- | --- | --- | --- |
| 1 | `df943975a6cc249c5c2875067ad02188209d7d8b` | `18e0a468527310590db2f49da15ba697250472a7` | approuvé avec réserves : quatre constats majeurs |
| 2 | `e8204306426966d5e23d67f318593269ac780770` (intervalle depuis `df943975`) | `e8dc16550f9147ff3e2d59f8d7ced0fd143009ee` | approuvé avec réserves : cinq constats majeurs, quatre mineurs |

Le commit qui traite les constats de la passe 2, la fusion de la branche servie qui le précède et cette mise à jour du dossier sont postérieurs à la passe 2. **Aucune passe ne les a relus.**

## Constats de la passe 1, et leur suite

| Gravité | Constat | Suite |
| --- | --- | --- |
| major | Le test « current or previous and no other » de l'installateur restait vert si la tolérance s'élargissait à une troisième version absente de ses exemples : avec `(CARGO_DENY_VERSION, CARGO_DENY_PREVIOUS_VERSION, '0.19.9')`, 10 tests OK. Le dossier annonçait à tort « rien d'autre » et « 0 survivant ». | Corrigé : l'ensemble accepté est une constante, `CARGO_DENY_INSTALLABLE_VERSIONS`, comparée à exactement les deux versions, et le test montre que la validation lit cette constante. Le mutant de la passe rougit (cas 06 ci-dessous). Relu par la passe 2 : deux autres élargissements survivaient (son constat M2). |
| major | Sous 0.22.0 l'absence de `advisories.unmaintained` vaut `workspace`, et le gate des dérogations ne classait comme dérogation qu'une valeur écrite différente de `all` : un `deny.toml` sans la clé perdait des avis sans qu'aucun gate le dise. | Corrigé : un fichier de configuration cargo-deny qui n'écrit pas la clé est refusé (`IMPLICIT-SCOPE`), avec ou sans table `[advisories]`. Mesure sur la flotte ci-dessous. Relu par la passe 2 : le contrôle périodique jetait cette lecture, et rien ne tenait l'étape 2 avant une déclaration (ses constats M3 et M4). |
| major | Rien ne tenait la fin de la tolérance de l'installateur : un commentaire la demandait. | Corrigé : `.github/composition/check-composed-toolchain.py`, exécuté là où `manifest.json` est lu (job « Bun quality »), échoue quand la gouvernance composée déclare déjà la version courante alors que `CARGO_DENY_PREVIOUS_VERSION` existe, et quand elle déclare une version que l'installateur refuse. Relu par la passe 2 : `main()` et la lecture git n'avaient aucun test, et mettre fin à la tolérance rougissait deux tests (ses constats M1, M5, m1). |
| major | cargo-deny charge un `deny.exceptions.toml` voisin du manifeste indépendamment de `--config`, et 0.21.0 ajoute l'emplacement `.config/deny.exceptions.toml`. Aucun gate ne lit ces fichiers. | Vérifié dans la source et mesuré (voir « Non mesuré, non couvert »). Non corrigé ici : issue #318. |
| minor | Le test de bout en bout de `main()` n'exerçait que la fixture de la version précédente. | Corrigé : un second test rejoue le chemin avec une fiche à la version courante. Relu par la passe 2, sans constat propre. |
| minor | Les assertions sur `.config/deny.toml` verrouillent un comportement existant. | Rien à changer : c'était dit. |
| minor | Les fixtures de `tools/security/rust-advisories.test.ts` sont celles enregistrées sous 0.19.5. | Pas de seconde fixture : rejouées sous 0.22.0 sur le même graphe (`smallvec =1.6.0`), exécution signalée et exécution ignorée, les champs que le lecteur emploie, projetés par `jq`, sont identiques à l'octet (`cmp`), et les codes de sortie aussi. Le commentaire du test le dit. |
| minor | « Blast radius » ne disait pas que le check non requis « Index freshness and GitHub reconciliation » est rouge sur la pull request. | Corrigé dans la description. |

## Constats de la passe 2, et leur suite

Chaque constat a été vérifié par l'auteur avant d'être traité ; un seul, m4, s'est révélé sans objet.

| Gravité | Constat | Suite |
| --- | --- | --- |
| major (M1) | `main()` et la lecture git de `check-composed-toolchain.py` n'avaient aucun test : quatre mutants restaient verts (sortie 0 sur entrée illisible, étape git en échec ignorée, `if failures:` neutralisé, rangée d'un autre dépôt lue). La propriété « Never a zero » n'était tenue par rien. | Corrigé : `main(argv, read)` et `read_at(…, git)` reçoivent leur lecteur ; tests de `main()` (commit illisible, rangée absente, manifeste illisible, installateur sans ses lignes, fiche d'un autre outil, échec → code 1) et de `read_at` avec un `git` simulé qui échoue à chacune des quatre étapes. Les quatre mutants rougissent (cas 21 à 24). Non relu. |
| major (M2) | Deux élargissements de l'ensemble installable survivaient : `… and version != '0.19.9'`, et l'appartenance remplacée par un test de préfixe. Le test n'échantillonnait que quatre versions refusées. | Corrigé par deux moyens, chacun tuant les deux mutants à lui seul (cas 11 et 12) : une grille de versions refusées (tout `a.b.c` pour a < 2, b ≤ 40, c ≤ 20, plus chaque préfixe et extension d'une version acceptée, plus de 1 700 valeurs), et un test de forme lu dans la source (`version` liée une fois, comparée une fois, par `not in CARGO_DENY_INSTALLABLE_VERSIONS`, aucun littéral de version dans la fonction). Limites dites dans « Réserves ». Non relu. |
| major (M3) | Le contrôle périodique lisait la portée implicite de chaque `deny.toml` de la flotte et la jetait (`implicitScopes: []`), alors qu'il est le seul chemin qui lit la flotte dès la fusion, et le seul qui lit `square-control`. | Corrigé : la dérogation valide reste valide, et le rapport porte un **échec** nommé par fichier gouvernant à portée implicite (`<dépôt>:<deny.toml>`, `IMPLICIT-SCOPE`, lockfiles concernés), compté dans la ligne de volume. Échec et non note : ce rapport traite déjà chaque constat, dérogation expirée comprise, par `report.check(…, false, …)`. Non relu. |
| major (M4) | Rien ne tient l'étape 2 avant la prochaine génération : la cohérence de génération ne rejoue que `check-bun-manifests.ts`. | Non mécanisé ici, écrit comme précondition de déclaration dans `docs/toolchain/FLEET-BUMP.md` avec sa commande, et issue #320. Mesure et raison dans « La précondition de déclaration ». |
| major (M5) | Mettre fin à la tolérance (`CARGO_DENY_PREVIOUS_VERSION = None`) rougissait deux tests de l'installateur, qui portaient le littéral de la version précédente. | Corrigé : les attendus dérivent des deux constantes. Prouvé en posant `None` dans une copie de travail : une ligne changée, 185 tests de composition verts, et le contrôle de fin de tolérance sort 0 sur une fiche composée à la version courante ; puis restauré. Non relu. |
| minor (m1) | `len(previous) != 1` → `< 1` restait vert : la répétition n'était testée que pour `CARGO_DENY_VERSION`. | Corrigé : deux cas de ligne de version précédente répétée. Cas 18. |
| minor (m2) | Un `deny.toml` sous un répertoire de fixtures portant le marqueur `allow-audit-flag-fixture` devient `IMPLICIT-SCOPE`. | Vrai, et gardé : la règle existante ne lit le marqueur que dans les fichiers qu'aucun lecteur ne réclame par leur nom (`readOtherText`) ; un fichier nommé comme une configuration cargo-deny était déjà jugé avant ce changement. Un test le verrouille (cas 31), la politique le dit, et une fixture qui ne doit pas être jugée porte un autre nom (`deny.toml.fixture`). Aucun fichier de ce dépôt n'est dans ce cas (`git ls-files` : deux `deny.toml`, les deux réels). |
| minor (m3) | Angles morts non écrits : configuration passée par `--config` sous un autre nom ; `Cargo.lock` sans aucun `deny.toml`. | Écrits dans « Non mesuré, non couvert ». |
| minor (m4) | La nouvelle étape de `ci.yml` n'a pas de `if: !cancelled()`. | Sans objet d'après la mesure demandée : aucune des 14 étapes du job `bun-quality` ne porte de `if:`, et `cancelled()` n'apparaît nulle part dans `ci.yml` (`grep -c "cancelled()" .github/workflows/ci.yml` : 0). L'étape suit la convention de ses voisines, qui s'arrêtent au premier rouge. Rien changé. |

Aucun constat `blocking` dans l'une ou l'autre passe.

## Ce que les passes ont rejoué

Ce que l'auteur en sait par les constats rendus. Passe 1 : la suite de l'installateur contre le mutant de son premier constat (10 tests OK), et la source de cargo-deny aux deux tags. Passe 2 : la suite du contrôle composé contre cinq mutants et celle de l'installateur contre deux, tous verts au commit relu. Le détail de ce qu'elles ont rejoué au-delà ne lui a pas été transmis.

## Ce qui change entre les deux versions, et ce qui en est fait

Lu dans le CHANGELOG amont de 0.19.6 à 0.22.0, puis mesuré avec les binaires `aarch64-apple-darwin` des deux releases (empreintes d'archive égales au champ `digest` de l'API des releases).

| Changement amont | Mesure | Suite dans cette pull request |
| --- | --- | --- |
| 0.20.0 : `--config` devient une option de la commande racine | `check --config <f>` : code 0 sous 0.19.5, code 2 sous 0.22.0. `--config <f> check` : code 2 sous 0.19.5, code 0 sous 0.22.0. Aucune écriture du drapeau ne passe sous les deux. | Le drapeau passe avant `check` dans les deux appelants, dans le même commit que l'épinglage. |
| 0.21.0 : plus d'archive macOS Intel publiée | Les releases 0.21.0 et 0.22.0 listent quatre archives, aucune `x86_64-apple-darwin`. | `darwin-x64` sort de la fiche et de la liste que le parseur exige ; le gate refuse cette plateforme. |
| 0.22.0 : `advisories.unmaintained` vaut `workspace` par défaut au lieu de `all` | Sans la clé, 5 graphes sur 16 perdent un avis `unmaintained` ; avec `unmaintained = "all"`, les 15 graphes lisibles rendent les mêmes codes de sortie et les mêmes identifiants que sous 0.19.5 (tableau dans #311). | La politique de base écrit la clé (mêmes lignes que #311), et le gate des dérogations refuse un fichier qui ne l'écrit pas. |
| 0.21.0 : la configuration est aussi cherchée dans `.config/deny.toml` | 0.22.0 lit ce fichier ; 0.19.5 ne le trouve pas et retombe sur la configuration par défaut. | Le gate des dérogations classe déjà ce chemin par son nom de fichier ; deux assertions le verrouillent, la documentation nomme les quatre emplacements. |
| 0.22.0 : diagnostic `advisory-withdrawn` pour une dérogation visant un avis retiré | Non mesuré : aucun `deny.toml` de la flotte ne porte d'entrée `ignore`. Lu dans la source : gravité `warning`. | Aucune. |
| 0.21.0 : `advisories.ignore-expiry`, `ignore.expiry`, `ignore.allow` | Lu dans la source : absents de la configuration, ils valent « aucun ». | Aucune. |
| 0.20.0 : contrôle `bans.std-replacements`, qui télécharge un jeu de données | Lu dans la source : inactif tant que la clé n'est pas configurée. Les diagnostics de `bans` sont identiques entre versions sur les 15 graphes. | Aucune. |
| 0.20.0 : alias et drapeaux retirés (`ban`, `license`, `-c` sur `check`, `--disable-fetch`, `--allow-git-index`) | `git grep` : aucun n'est employé dans ce dépôt ; `cargo-deny list`, `check bans licenses sources` et `check advisories` sans drapeau sortent au même code sous les deux versions. | Aucune. |

## Verdict requis, sur chaque dépôt

Le gate de cette branche (au commit relu), exécuté depuis la racine de chaque dépôt public non archivé portant un `Cargo.lock`, avec les arguments que le dépôt lui passe aujourd'hui : 12 dépôts, 12 codes 0, chacun avec la ligne `Dependency policy verified … (cargo-deny 0.22.0 downloaded, …)`. Sous 0.19.5, `check bans licenses sources` sort aussi au code 0 sur chacun, avec les mêmes diagnostics.

`schemas-and-contracts` passe quatre manifestes imbriqués avec le `deny.toml` de sa racine. Sans drapeau, cargo-deny retiendrait pour `crates/sdk-rs` le `deny.toml` de ce répertoire, plus proche du manifeste : c'est pourquoi le drapeau reste écrit plutôt que retiré.

## L'installateur et la gouvernance composée

`validate-composition.yml` exécute l'installateur de la génération épinglée par l'appelant, et lui passe la fiche `toolchains/cargo-deny.json` de la gouvernance **composée** par `.github/composition/manifest.json`. Ce jour, la référence composée est `d94081ccc5892c262ba1a0c534b8575a18c48341`, dont la fiche déclare 0.19.5.

| Installateur | Fiche | Résultat de `validate_cargo_deny` |
| --- | --- | --- |
| base (constante 0.19.5) | cette branche (0.22.0) | refusé : `Unexpected cargo-deny version` |
| cette branche | référence composée (0.19.5) | accepté |
| cette branche | cette branche (0.22.0) | accepté |

L'installateur accepte la version courante et la précédente : c'est l'ensemble `CARGO_DENY_INSTALLABLE_VERSIONS`, que le test compare à ces deux versions exactement. Il vérifie que le binaire extrait annonce la version **déclarée**. Installer 0.22.0 à la place de la version déclarée ne marcherait pas : le gate de la gouvernance composée, à qui l'on passe le binaire 0.22.0, répond `digest mismatch … refusing`.

`check-composed-toolchain.py` lit les deux lignes de version de l'installateur et la fiche à la référence composée (`git fetch --depth=1` de ce commit, puis `git show`). Trois issues en échec : la fiche composée déclare une version que l'installateur refuse ; elle déclare la version courante alors que `CARGO_DENY_PREVIOUS_VERSION` vaut encore une version ; une ligne, un fichier ou un commit est illisible. La tolérance prend fin en écrivant `CARGO_DENY_PREVIOUS_VERSION = None` dans la pull request qui déplace la référence composée.

Les huit dépôts qui portent leur propre copie de `check-dependency-policy.ts` ne lisent ni la fiche ni `LIBRE_AI_CARGO_DENY` : la copie épingle 0.19.5 et télécharge son archive. Exécutée telle quelle dans `ai-model-policy` : code 0, `cargo-deny 0.19.5`.

## Le gate des dérogations sur la flotte

Le gate de cette branche, exécuté sur ce dépôt et sur les 19 autres dépôts publics non archivés de l'organisation (têtes des branches servies) :

| Dépôt | Fichier et ligne signalés |
| --- | --- |
| ai-model-policy | `deny.toml:22` |
| ai-work-supervision | `deny.toml:22` |
| artifact-verification | `deny.toml:22` |
| capability-authorization | `deny.toml:22` |
| database-policy-inspector | `deny.toml:22` |
| execution-continuity-evaluator | `deny.toml:22` |
| execution-sandbox | `deny.toml:22` |
| personal-knowledge-workspace | `deny.toml:22` |
| project-website | `deny.toml:22` |
| schemas-and-contracts | `deny.toml:22`, `crates/sdk-rs/deny.toml:4` |
| square-control | `deny.toml:1` (pas de table `[advisories]`) |

20 dépôts examinés = 11 en défaut `IMPLICIT-SCOPE` + 8 sans défaut + 1 où le gate n'a rien à lire (`.github`, « asserted nothing », hors de ce diff) ; 12 fichiers signalés, aucun autre défaut. Ce sont les douze fichiers de l'étape 2. Ce dépôt est sans défaut avec les deux lignes de la politique de base ; sans elles, le gate y signale `deny.toml:22` et `crates/ecosystem-engine/deny.toml:22`.

La version précédente de ce dossier écrivait « 19 dépôts = 11 + 8 » : la boucle de mesure listait les clones par `ls`, qui ne montre pas le dépôt nommé `.github`. Relevé refait avec `ls -A`.

Où ce gate tourne : dans `bun run check` de ce dépôt, et dans l'étape « Advisory waiver discipline » de `validate-composition.yml`, exécutée depuis la génération que l'appelant épingle. Un consommateur n'est donc refusé que lorsqu'il adopte une génération postérieure à cette fusion sans avoir écrit la clé. `square-control` n'est pas une cible de la composition : ce gate ne lui est appliqué par aucun contrôle.

## Le contrôle périodique sur la flotte

`tools/security/check-fleet-advisories.ts` lit chaque dépôt public dès la fusion, `square-control` compris. Pour chaque `deny.toml` qui gouverne un `Cargo.lock` examiné et laisse une portée implicite, il pose maintenant un échec nommé `<dépôt>:<fichier>`. La fonction qui le décide (`implicitScopeFailures`), exécutée sur les 19 clones avec les lockfiles et les fichiers gouvernants que le contrôle retiendrait, sans exécuter cargo-deny : 11 dépôts avec un `Cargo.lock`, 12 fichiers gouvernants signalés, les douze du tableau ci-dessus ; le fichier racine de `schemas-and-contracts` y gouverne trois lockfiles et compte une fois.

Le câblage de cette fonction dans le script (la boucle `report.check` et le compteur) n'a pas de test : le script s'exécute au chargement et n'en a aucun. Le workflow planifié `fleet-advisories` n'a pas été exécuté avec ce changement.

## La précondition de déclaration

L'étape « Advisory waiver discipline » exécute le gate de la génération **déclarée** sur la tête **propre** du consommateur. `check-generation-coherence.py` rejoue autre chose : les gates de la gouvernance **composée** sur les cibles à leurs références **composées**. Ajouter le gate des dérogations à `MANIFEST_GATES` tel quel répondrait donc à une autre question.

Mesure de ce que coûterait un rejeu fidèle : le gate lit les fichiers suivis de la cible comme du texte et ne lance que `git ls-files` (`grep` de `spawnSync`, `Bun.spawn` et `import(` sur le gate et ses imports : une ligne) ; 1,4 s pour 18 clones, clonage exclu. Il n'exécute rien de la cible, à condition d'être lancé depuis la gouvernance avec `--root`. Ce qu'il demande et que le garde n'a pas : la tête servie de chaque cible, que le manifeste n'épingle pas, et les fichiers du gate au commit déclaré plutôt qu'au commit composé. Le verdict d'un check requis sur chaque pull request dépendrait alors de l'état des autres dépôts au jour le jour ; le rejeu n'a de sens qu'en mode `--declaration`. C'est un changement du garde lui-même : issue #320.

En attendant, `docs/toolchain/FLEET-BUMP.md` porte la précondition et sa commande, rejouée telle qu'écrite sur les 16 dépôts du manifeste : 11 `IN DEFECT`, dont ce dépôt lui-même à sa tête servie, qui ne porte pas encore la clé.

## Tests, et leur neutralisation

Une substitution par ligne tenue, rejouée contre le test qui la tient ; un mutant identique à l'original est refusé par `cmp`, et l'arbre est comparé à l'index à la fin.

| # | Substitution | Test | Résultat |
| --- | --- | --- | --- |
| 01 | `--config` remis après `check` (gate) | `check-dependency-policy.test.ts` | rouge |
| 02 | `--config` remis après `check` (contrôle périodique) | `rust-advisories.test.ts` | rouge |
| 03 | `darwin-x64` de nouveau exigé | `check-dependency-policy.test.ts` | rouge |
| 04 | la version précédente retirée de l'ensemble accepté seul | `test_install_toolchains.py` | rouge |
| 05 | l'installateur accepte toute version | `test_install_toolchains.py` | rouge |
| 06 | une troisième version dans l'ensemble accepté (passe 1) | `test_install_toolchains.py` | rouge |
| 07 | la validation lit un tuple en ligne, non la constante | `test_install_toolchains.py` | rouge |
| 08 | le binaire doit annoncer la version courante de l'installateur, non la déclarée | `test_install_toolchains.py` | rouge |
| 09 | le binaire doit annoncer la version précédente | `test_install_toolchains.py` | rouge |
| 10 | l'installateur nomme une version que la fiche ne déclare pas | `test_install_toolchains.py` | rouge |
| 11 | une version de plus admise à côté de la constante, `and version != '0.19.9'` (passe 2) | `test_install_toolchains.py` | rouge |
| 12 | l'appartenance remplacée par un test de préfixe (passe 2) | `test_install_toolchains.py` | rouge |
| 13 | contrôle composé : règle de fin de tolérance neutralisée | `test_check_composed_toolchain.py` | rouge |
| 14 | contrôle composé : règle de la fiche refusée neutralisée | `test_check_composed_toolchain.py` | rouge |
| 15 | contrôle composé : précédente égale à courante acceptée | `test_check_composed_toolchain.py` | rouge |
| 16 | contrôle composé : ligne de version courante répétée acceptée | `test_check_composed_toolchain.py` | rouge |
| 17 | contrôle composé : ligne de version précédente absente acceptée | `test_check_composed_toolchain.py` | rouge |
| 18 | contrôle composé : ligne de version précédente répétée acceptée (passe 2) | `test_check_composed_toolchain.py` | rouge |
| 19 | contrôle composé : fiche d'un autre outil acceptée | `test_check_composed_toolchain.py` | rouge |
| 20 | l'installateur exécute un autre ensemble que celui que le contrôle lit | `test_check_composed_toolchain.py` | rouge |
| 21 | contrôle composé : entrée illisible, sortie 0 (passe 2) | `test_check_composed_toolchain.py` | rouge |
| 22 | contrôle composé : une étape git en échec n'est pas un échec (passe 2) | `test_check_composed_toolchain.py` | rouge |
| 23 | contrôle composé : des échecs trouvés, sortie 0 (passe 2) | `test_check_composed_toolchain.py` | rouge |
| 24 | contrôle composé : la rangée d'un autre dépôt est lue (passe 2) | `test_check_composed_toolchain.py` | rouge |
| 25 | contrôle composé : la branche par défaut est rapatriée au lieu du commit composé | `test_check_composed_toolchain.py` | rouge |
| 26 | gate des dérogations : clé absente non lue | `advisory-waivers.test.ts`, suite adverse | rouge |
| 27 | gate des dérogations : clé absente lue seulement si la table existe | idem | rouge |
| 28 | gate des dérogations : portée implicite lue, jamais signalée | idem | rouge |
| 29 | gate des dérogations : défaut placé ligne 1 au lieu de l'en-tête de table | idem | rouge |
| 30 | gate des dérogations : `.config/deny.toml` non classé | idem | rouge |
| 31 | gate des dérogations : le marqueur de fixture exempte un fichier nommé `deny.toml` | idem | rouge |
| 32 | contrôle périodique : une portée implicite du fichier défait une dérogation valide | `rust-advisories.test.ts` | rouge |
| 33 | contrôle périodique : la portée implicite lue par le gate est jetée (passe 2) | `rust-advisories.test.ts` | rouge |
| 34 | contrôle périodique : aucun échec pour un fichier à portée implicite | `rust-advisories.test.ts` | rouge |
| 35 | contrôle périodique : un lockfile masqué par un workspace nomme son fichier | `rust-advisories.test.ts` | rouge |
| 36 | contrôle périodique : la ligne de volume ne porte pas le compte | `rust-advisories.test.ts` | rouge |
| 37 | l'archive « non épinglée » d'un test construite depuis un littéral périmé | `check-toolchain-source.test.ts` | rouge |

37 cas listés, 37 rouges, 0 refusé. **Ce compte vaut pour ces 37 substitutions, pas pour la classe des mutants possibles** : deux fois ce dossier a annoncé « 0 survivant », et deux fois une passe a trouvé des survivants hors de la liste (un à la passe 1, sept à la passe 2). Les cas 11 et 12 sont tués séparément par chacun des deux tests ajoutés (le test de forme, lancé seul contre chacun : `FAILED (failures=1)`).

Fin de la tolérance, rejouée dans une copie de travail puis restaurée : `CARGO_DENY_PREVIOUS_VERSION = None`, une ligne changée (`git diff --stat` : 1 insertion, 1 suppression) ; les 185 tests de `.github/composition` sont verts ; `main()` du contrôle composé sort 0 quand la fiche composée déclare la version courante, et 1 quand elle déclare 0.19.5.

## Ordre

1. La pull request préparatoire #311 (`unmaintained = "all"` dans la politique de base). Cette pull request porte les mêmes deux lignes : l'ordre entre elle et #311 n'a plus d'effet sur ce dépôt.
2. La même ligne dans les douze `deny.toml` de la flotte, vérifiable par le gate des dérogations de cette branche (tableau ci-dessus).
3. Cette pull request.
4. Avant toute déclaration de génération : la précondition de `docs/toolchain/FLEET-BUMP.md`.

Fusionnée avant l'étape 2, cette pull request rétrécit l'examen du contrôle périodique sur cinq graphes sans qu'aucun fichier n'ait changé chez eux. Le contrôle périodique le dit désormais, par un échec nommé pour chacun des douze fichiers ; les consommateurs, eux, ne le voient qu'en adoptant une génération postérieure. Elle reste en brouillon pour cette raison.

Après la fusion, `ecosystem/check-toolchain-source.ts` (job non requis « Index freshness and GitHub reconciliation ») signale `database-policy-inspector`, dont `ci.yml` déclare en ligne l'archive 0.19.5, jusqu'à ce que ce dépôt reprenne les trois lignes `CARGO_DENY_*`.

## Réserves

- **`square-control` échappe au gate des dérogations.** Il n'est pas composé. Seul le contrôle périodique le nomme, par un échec dans un workflow planifié non requis.
- **Ce que les tests de l'ensemble installable ne peuvent pas attraper.** La grille est finie : une version hors de `0-1.0-40.0-20` et qui n'est ni préfixe ni extension d'une version acceptée n'est pas essayée. Le test de forme lit la fonction `validate_cargo_deny` seule : une comparaison déplacée dans une fonction qu'elle appelle, la constante réaffectée par `globals()` à l'exécution, ou un alias de `version` comparé sous un autre nom lui échappent. Les deux ensemble ferment les deux mutants de la passe 2, pas la classe.
- **La précondition de déclaration est écrite, pas exécutée par un check.** Issue #320.
- **Le marqueur de fixture ne vaut pas pour un `deny.toml`.** Choix gardé de la règle existante ; une fixture nommée `deny.toml` sans la clé est en défaut.
- **`unsound` reste à son défaut, `workspace`, sous les deux versions.** Le gate ne signale pas son absence. `tools/quality/advisory-waivers.test.ts`, test « cargo-deny scope and level keys at their defaults are not waivers », range `unsound = "all"` parmi les défauts, ce qu'il n'est sous aucune version.
- **La fin de la tolérance demande un geste.** Le contrôle échoue sur la pull request qui déplace la référence composée tant que `CARGO_DENY_PREVIOUS_VERSION` n'y est pas mis à `None`.

## Non mesuré, non couvert

- **Fichiers d'exceptions locaux.** cargo-deny charge, indépendamment de `--config`, le premier `deny.exceptions.toml`, `.deny.exceptions.toml`, `.cargo/deny.exceptions.toml` ou `.config/deny.exceptions.toml` trouvé en remontant depuis le manifeste (`src/cargo-deny/check.rs:191-196` et `common.rs:199-230` au tag 0.22.0 ; les trois premiers noms déjà au tag 0.19.5). Mesuré sur un crate dépendant de `smallvec`, configuration explicite à liste de licences vide : `check licenses` sort au code 4 sans fichier, au code 0 avec un `deny.exceptions.toml` voisin du manifeste sous les deux versions, et avec `.config/deny.exceptions.toml` au code 4 sous 0.19.5 et 0 sous 0.22.0. Aucun gate de ce dépôt ne lit ni ne refuse ces fichiers, alors que `licenses` fait partie du verdict requis. Aucun fichier de ce nom dans la flotte publique ce jour (`gh search code --owner libre-ai --filename deny.exceptions.toml` : 0 résultat ; `find` sur les 19 clones et sur ce dépôt : 0). Issue #318.
- **Une configuration passée par `--config` sous un autre nom.** Le gate des dérogations classe les fichiers par leur nom (`deny.toml`, `.deny.toml`). Un workflow ou un script qui appelle `cargo-deny --config policy.toml` fait lire à cargo-deny un fichier que le gate ne lit pas, portée implicite et dérogations comprises. Aucun appel de cette forme dans ce dépôt ; non cherché dans la flotte.
- **Un `Cargo.lock` sans aucun `deny.toml`.** cargo-deny retombe alors sur sa configuration par défaut, `unmaintained = "workspace"` compris, et il n'existe aucun fichier à signaler. Le gate de politique de dépendances refuse ce cas (`deny.toml` illisible) et le contrôle périodique aussi (« no tracked deny.toml governs this lockfile ») ; le gate des dérogations, lui, ne voit rien. Un appel direct de `cargo-deny` hors de ces deux chemins n'est tenu par rien.
- Le commit qui traite les constats de la passe 2 et ce dossier n'ont été relus par aucune passe.
- Le workflow planifié `fleet-advisories` n'a pas été exécuté avec le nouvel échec par fichier ; sa fonction de décision l'a été sur les clones, son câblage dans le script n'a pas de test.
- Les mesures viennent des binaires macOS arm64. Le binaire Linux x64 est celui de la CI : la composition de cette pull request l'installe et exécute le gate de ce dépôt avec lui ; son comportement n'a pas été comparé graphe par graphe.
- `advisory-withdrawn` : une dérogation visant un avis retiré était silencieuse pour le contrôle périodique sous 0.19.5 (`advisory-not-detected`, sans identifiant). Si le diagnostic 0.22.0 porte l'identifiant de l'avis, le contrôle le comptera comme avis non couvert. Aucun cas dans la flotte ce jour ; non mesuré.
- Les clés `expiry` et `allow` d'une entrée `ignore` (0.21.0) ne sont pas lues par le gate des dérogations.
- `check-composed-toolchain.py` n'a pas pu être exécuté contre le réseau dans le bac à sable de l'auteur (git sans jeton y est refusé, comme pour `check-composed-paths.py`) ; sa séquence git a été rejouée à la main sur la référence composée (`tool` `cargo-deny`, `version` `0.19.5`), et c'est la CI qui l'exécute.
- L'installateur n'a été exécuté de bout en bout avec la fiche composée 0.19.5 que par ses tests, qui simulent le téléchargement.
- Les dépôts privés de l'organisation n'ont pas été lus.
