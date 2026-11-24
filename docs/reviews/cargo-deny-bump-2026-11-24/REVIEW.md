<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-reservations

# cargo-deny 0.19.5 → 0.22.0 : revue

**Date :** 2026-11-24
**Objet :** la pull request #313, qui monte l'épinglage de cargo-deny de 0.19.5 à 0.22.0 dans `toolchains/cargo-deny.json`, l'installateur de composition, le gabarit `reusable-dependency-policy.yml`, le gate `tools/quality/check-dependency-policy.ts` et le contrôle périodique `tools/security/rust-advisories.ts`.
**Nature :** dossier de revue d'une pull request écrite par un agent. Il rend compte de ce que l'auteur a mesuré et de la passe qui a examiné la pull request ; il n'est pas un arbitrage du propriétaire, et aucun agent n'en écrit.
**Rôle :** une passe de revue, faite en lecture seule par un sous-agent à contexte neuf, distinct de l'auteur. Ce dossier est tenu par l'auteur, qui y reporte le verdict et les constats que la passe lui a rendus.
**Surface gardée touchée :** `deny.toml` et `crates/ecosystem-engine/deny.toml` (la ligne `unmaintained = "all"`, octet pour octet celle de la pull request préparatoire #311) ; `ecosystem/toolchain-freshness-exceptions.v1.yaml`, pour une seule ligne de commentaire (l'exemple de forme citait `held_at: 0.19.5`), sans entrée ajoutée, retirée ni modifiée.

## La passe

| Passe | Commit relu | Base (`git merge-base`) | Verdict |
| --- | --- | --- | --- |
| 1 | `df943975a6cc249c5c2875067ad02188209d7d8b` | `18e0a468527310590db2f49da15ba697250472a7` | approuvé avec réserves : quatre constats majeurs |

Les commits qui traitent ces constats, la fusion de la branche servie qui les précède et cette mise à jour du dossier sont postérieurs à la passe. **Aucune passe ne les a relus.**

## Constats de la passe, et leur suite

| Gravité | Constat | Suite |
| --- | --- | --- |
| major | Le test « current or previous and no other » de l'installateur restait vert si la tolérance s'élargissait à une troisième version absente de ses exemples : avec `(CARGO_DENY_VERSION, CARGO_DENY_PREVIOUS_VERSION, '0.19.9')`, 10 tests OK. Le dossier annonçait à tort « rien d'autre » et « 0 survivant ». | Corrigé : l'ensemble accepté est une constante, `CARGO_DENY_INSTALLABLE_VERSIONS`, comparée à exactement les deux versions, et le test montre que la validation lit cette constante. Le mutant de la passe rougit (cas 06 ci-dessous). Non relu. |
| major | Sous 0.22.0 l'absence de `advisories.unmaintained` vaut `workspace`, et le gate des dérogations ne classait comme dérogation qu'une valeur écrite différente de `all` : un `deny.toml` sans la clé perdait des avis sans qu'aucun gate le dise. | Corrigé : un fichier de configuration cargo-deny qui n'écrit pas la clé est refusé (`IMPLICIT-SCOPE`), avec ou sans table `[advisories]`. Mesure sur la flotte ci-dessous. Non relu. |
| major | Rien ne tenait la fin de la tolérance de l'installateur : un commentaire la demandait. | Corrigé : `.github/composition/check-composed-toolchain.py`, exécuté là où `manifest.json` est lu (job « Bun quality »), échoue quand la gouvernance composée déclare déjà la version courante alors que `CARGO_DENY_PREVIOUS_VERSION` existe, et quand elle déclare une version que l'installateur refuse. Non relu. |
| major | cargo-deny charge un `deny.exceptions.toml` voisin du manifeste indépendamment de `--config`, et 0.21.0 ajoute l'emplacement `.config/deny.exceptions.toml`. Aucun gate ne lit ces fichiers. | Vérifié dans la source et mesuré (voir « Non mesuré, non couvert »). Non corrigé ici : issue #318. |
| minor | Le test de bout en bout de `main()` n'exerçait que la fixture de la version précédente. | Corrigé : un second test rejoue le chemin avec une fiche à la version courante. Non relu. |
| minor | Les assertions sur `.config/deny.toml` verrouillent un comportement existant. | Rien à changer : c'était dit. |
| minor | Les fixtures de `tools/security/rust-advisories.test.ts` sont celles enregistrées sous 0.19.5. | Pas de seconde fixture : rejouées sous 0.22.0 sur le même graphe (`smallvec =1.6.0`), exécution signalée et exécution ignorée, les champs que le lecteur emploie, projetés par `jq`, sont identiques à l'octet (`cmp`), et les codes de sortie aussi. Le commentaire du test le dit. |
| minor | « Blast radius » ne disait pas que le check non requis « Index freshness and GitHub reconciliation » est rouge sur la pull request. | Corrigé dans la description. |

Aucun constat `blocking`.

## Ce que la passe a rejoué

Ce que l'auteur en sait par les constats rendus : la suite de l'installateur contre le mutant du premier constat (10 tests OK), et la lecture de la source de cargo-deny aux deux tags pour les constats 2 et 4. Le détail de ce que la passe a rejoué au-delà ne lui a pas été transmis.

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

Le gate de cette branche, exécuté sur ce dépôt et sur les 18 autres dépôts publics non archivés de l'organisation (têtes des branches servies) :

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

19 dépôts examinés = 11 en défaut + 8 sans défaut ; 12 fichiers signalés, tous `IMPLICIT-SCOPE`, aucun autre défaut. Ce sont les douze fichiers de l'étape 2. Ce dépôt est sans défaut avec les deux lignes de la politique de base ; sans elles, le gate y signale `deny.toml:22` et `crates/ecosystem-engine/deny.toml:22`.

Où ce gate tourne : dans `bun run check` de ce dépôt, et dans l'étape « Advisory waiver discipline » de `validate-composition.yml`, exécutée depuis la génération que l'appelant épingle. Un consommateur n'est donc refusé que lorsqu'il adopte une génération postérieure à cette fusion sans avoir écrit la clé. `square-control` n'est pas une cible de la composition : aucun contrôle ne lui applique ce gate.

## Tests, et leur neutralisation

Une substitution par ligne tenue, rejouée contre le test qui la tient ; un mutant identique à l'original est refusé par `cmp`, et l'arbre est comparé à l'index à la fin.

| # | Substitution | Test | Résultat |
| --- | --- | --- | --- |
| 01 | `--config` remis après `check` (gate) | `check-dependency-policy.test.ts` | rouge |
| 02 | `--config` remis après `check` (contrôle périodique) | `rust-advisories.test.ts` | rouge |
| 03 | `darwin-x64` de nouveau exigé | `check-dependency-policy.test.ts` | rouge |
| 04 | la version précédente n'est plus installable | `test_install_toolchains.py` | rouge |
| 05 | l'installateur accepte toute version | `test_install_toolchains.py` | rouge |
| 06 | une troisième version dans l'ensemble accepté (mutant de la passe) | `test_install_toolchains.py` | rouge |
| 07 | la validation lit un tuple en ligne, non la constante | `test_install_toolchains.py` | rouge |
| 08 | le binaire doit annoncer la version courante de l'installateur, non la déclarée | `test_install_toolchains.py` | rouge |
| 09 | le binaire doit annoncer la version précédente | `test_install_toolchains.py` | rouge |
| 10 | l'installateur nomme une version que la fiche ne déclare pas | `test_install_toolchains.py` | rouge |
| 11 | contrôle composé : règle de fin de tolérance neutralisée | `test_check_composed_toolchain.py` | rouge |
| 12 | contrôle composé : règle de la fiche refusée neutralisée | `test_check_composed_toolchain.py` | rouge |
| 13 | contrôle composé : précédente égale à courante acceptée | `test_check_composed_toolchain.py` | rouge |
| 14 | contrôle composé : ligne de version répétée acceptée | `test_check_composed_toolchain.py` | rouge |
| 15 | contrôle composé : ligne de version précédente absente acceptée | `test_check_composed_toolchain.py` | rouge |
| 16 | contrôle composé : fiche d'un autre outil acceptée | `test_check_composed_toolchain.py` | rouge |
| 17 | l'installateur exécute un autre ensemble que celui que le contrôle lit | `test_check_composed_toolchain.py` | rouge |
| 18 | gate des dérogations : clé absente non lue | `advisory-waivers.test.ts`, suite adverse | rouge |
| 19 | gate des dérogations : clé absente lue seulement si la table existe | idem | rouge |
| 20 | gate des dérogations : portée implicite lue, jamais signalée | idem | rouge |
| 21 | gate des dérogations : défaut placé ligne 1 au lieu de l'en-tête de table | idem | rouge |
| 22 | gate des dérogations : `.config/deny.toml` non classé | `advisory-waivers.test.ts` | rouge |
| 23 | contrôle périodique : une portée implicite du fichier défait une dérogation valide | `rust-advisories.test.ts` | rouge |
| 24 | l'archive « non épinglée » d'un test construite depuis un littéral périmé | `check-toolchain-source.test.ts` | rouge |

24 cas, 24 rouges, 0 survivant, 0 refusé. La première version de ce dossier annonçait 9 cas sans survivant ; la passe en a trouvé un dixième qui survivait, le cas 06.

## Ordre

1. La pull request préparatoire #311 (`unmaintained = "all"` dans la politique de base). Cette pull request porte les mêmes deux lignes : l'ordre entre elle et #311 n'a plus d'effet sur ce dépôt.
2. La même ligne dans les douze `deny.toml` de la flotte, vérifiable par le gate des dérogations de cette branche (tableau ci-dessus).
3. Cette pull request.

Fusionnée avant l'étape 2, cette pull request rétrécit le rapport du contrôle périodique sur cinq graphes sans qu'aucun fichier n'ait changé chez eux, et rien ne le dit tant que ces dépôts n'ont pas adopté une génération postérieure. Elle reste en brouillon pour cette raison.

Après la fusion, `ecosystem/check-toolchain-source.ts` (job non requis « Index freshness and GitHub reconciliation ») signale `database-policy-inspector`, dont `ci.yml` déclare en ligne l'archive 0.19.5, jusqu'à ce que ce dépôt reprenne les trois lignes `CARGO_DENY_*`.

## Réserves

- **`square-control` échappe au gate des dérogations.** Il n'est pas composé ; sa clé ne sera écrite que si quelqu'un l'écrit.
- **`unsound` reste à son défaut, `workspace`, sous les deux versions.** Le gate ne signale pas son absence. `tools/quality/advisory-waivers.test.ts`, test « cargo-deny scope and level keys at their defaults are not waivers », range `unsound = "all"` parmi les défauts, ce qu'il n'est sous aucune version.
- **La fin de la tolérance demande un geste.** Le contrôle échoue sur la pull request qui déplace la référence composée tant que `CARGO_DENY_PREVIOUS_VERSION` n'y est pas mis à `None`.

## Non mesuré, non couvert

- **Fichiers d'exceptions locaux.** cargo-deny charge, indépendamment de `--config`, le premier `deny.exceptions.toml`, `.deny.exceptions.toml`, `.cargo/deny.exceptions.toml` ou `.config/deny.exceptions.toml` trouvé en remontant depuis le manifeste (`src/cargo-deny/check.rs:191-196` et `common.rs:199-230` au tag 0.22.0 ; les trois premiers noms déjà au tag 0.19.5). Mesuré sur un crate dépendant de `smallvec`, configuration explicite à liste de licences vide : `check licenses` sort au code 4 sans fichier, au code 0 avec un `deny.exceptions.toml` voisin du manifeste sous les deux versions, et avec `.config/deny.exceptions.toml` au code 4 sous 0.19.5 et 0 sous 0.22.0. Aucun gate de ce dépôt ne lit ni ne refuse ces fichiers, alors que `licenses` fait partie du verdict requis. Aucun fichier de ce nom dans la flotte publique ce jour (`gh search code --owner libre-ai --filename deny.exceptions.toml` : 0 résultat ; `find` sur les 19 dépôts clonés : 0). Issue #318.
- Les commits de correction et ce dossier n'ont été relus par aucune passe.
- Les mesures viennent des binaires macOS arm64. Le binaire Linux x64 est celui de la CI : la composition de cette pull request l'installe et exécute le gate de ce dépôt avec lui ; son comportement n'a pas été comparé graphe par graphe.
- `advisory-withdrawn` : une dérogation visant un avis retiré était silencieuse pour le contrôle périodique sous 0.19.5 (`advisory-not-detected`, sans identifiant). Si le diagnostic 0.22.0 porte l'identifiant de l'avis, le contrôle le comptera comme avis non couvert. Aucun cas dans la flotte ce jour ; non mesuré.
- Les clés `expiry` et `allow` d'une entrée `ignore` (0.21.0) ne sont pas lues par le gate des dérogations.
- `check-composed-toolchain.py` n'a pas pu être exécuté contre le réseau dans le bac à sable de l'auteur (git sans jeton y est refusé, comme pour `check-composed-paths.py`) ; sa séquence git a été rejouée à la main sur la référence composée (`tool` `cargo-deny`, `version` `0.19.5`), et c'est la CI qui l'exécute.
- L'installateur n'a été exécuté de bout en bout avec la fiche composée 0.19.5 que par ses tests, qui simulent le téléchargement.
- Les dépôts privés de l'organisation n'ont pas été lus.
