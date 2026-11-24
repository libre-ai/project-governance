<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: not-reviewed

# cargo-deny 0.19.5 → 0.22.0 : dossier de mesure

**Date :** 2026-11-24
**Objet :** la pull request qui monte l'épinglage de cargo-deny de 0.19.5 à 0.22.0 dans `toolchains/cargo-deny.json`, l'installateur de composition, le gabarit `reusable-dependency-policy.yml`, le gate `tools/quality/check-dependency-policy.ts` et le contrôle périodique `tools/security/rust-advisories.ts`.
**Nature :** dossier écrit par l'agent auteur de la pull request. Il rend compte de ce que l'auteur a mesuré. **Aucune passe de revue indépendante n'a encore eu lieu** : ce dossier n'en tient pas lieu, et il n'est pas un arbitrage du propriétaire.
**Surface gardée touchée :** `ecosystem/toolchain-freshness-exceptions.v1.yaml`, pour une seule ligne de commentaire (l'exemple de forme citait `held_at: 0.19.5`). Aucune entrée du registre n'est ajoutée, retirée ni modifiée.

## Ce qui change entre les deux versions, et ce qui en est fait

Lu dans le CHANGELOG amont de 0.19.6 à 0.22.0, puis mesuré avec les binaires `aarch64-apple-darwin` des deux releases (empreintes d'archive égales au champ `digest` de l'API des releases).

| Changement amont | Mesure | Suite dans cette pull request |
| --- | --- | --- |
| 0.20.0 : `--config` devient une option de la commande racine | `check --config <f>` : code 0 sous 0.19.5, code 2 sous 0.22.0. `--config <f> check` : code 2 sous 0.19.5, code 0 sous 0.22.0. Aucune écriture du drapeau ne passe sous les deux. | Le drapeau passe avant `check` dans les deux appelants, dans le même commit que l'épinglage. |
| 0.21.0 : plus d'archive macOS Intel publiée | Les releases 0.21.0 et 0.22.0 listent quatre archives, aucune `x86_64-apple-darwin`. | `darwin-x64` sort de la fiche et de la liste que le parseur exige ; le gate refuse cette plateforme. |
| 0.22.0 : `advisories.unmaintained` vaut `workspace` par défaut au lieu de `all` | Sans la clé, 5 graphes sur 16 perdent un avis `unmaintained` ; avec `unmaintained = "all"`, les 15 graphes lisibles rendent les mêmes codes de sortie et les mêmes identifiants que sous 0.19.5. | Aucune ici : la clé est posée par la pull request préparatoire #311, qui porte le tableau des 16 graphes, puis dans chaque dépôt. |
| 0.21.0 : la configuration est aussi cherchée dans `.config/deny.toml` | 0.22.0 lit ce fichier ; 0.19.5 ne le trouve pas et retombe sur la configuration par défaut. | Le gate des dérogations classe déjà ce chemin par son nom de fichier ; deux assertions le verrouillent, la documentation nomme les quatre emplacements. |
| 0.22.0 : diagnostic `advisory-withdrawn` pour une dérogation visant un avis retiré | Non mesuré : aucun `deny.toml` de la flotte ne porte d'entrée `ignore`. Lu dans la source : gravité `warning`. | Aucune. Voir « Non prouvé ». |
| 0.21.0 : `advisories.ignore-expiry`, `ignore.expiry`, `ignore.allow` | Lu dans la source : absents de la configuration, ils valent « aucun ». | Aucune. |
| 0.20.0 : contrôle `bans.std-replacements`, qui télécharge un jeu de données | Lu dans la source : inactif tant que la clé n'est pas configurée. Les diagnostics de `bans` sont identiques entre versions sur les 15 graphes. | Aucune. |
| 0.20.0 : alias et drapeaux retirés (`ban`, `license`, `-c` sur `check`, `--disable-fetch`, `--allow-git-index`) | `git grep` : aucun n'est employé dans ce dépôt ; `cargo-deny list`, `check bans licenses sources` et `check advisories` sans drapeau sortent au même code sous les deux versions. | Aucune. |

Forme JSON des diagnostics : mêmes clés sous les deux versions pour un avis signalé et pour un avis ignoré (note `vulnerability` portant l'identifiant, relevée avec `--log-level info`).

## Verdict requis, sur chaque dépôt

Le gate de cette branche, exécuté depuis la racine de chaque dépôt public non archivé portant un `Cargo.lock`, avec les arguments que le dépôt lui passe aujourd'hui : 12 dépôts, 12 codes 0, chacun avec la ligne `Dependency policy verified … (cargo-deny 0.22.0 downloaded, …)`. Sous 0.19.5, `check bans licenses sources` sort aussi au code 0 sur chacun, avec les mêmes diagnostics.

`schemas-and-contracts` passe quatre manifestes imbriqués avec le `deny.toml` de sa racine. Sans drapeau, cargo-deny retiendrait pour `crates/sdk-rs` le `deny.toml` de ce répertoire, plus proche du manifeste : c'est pourquoi le drapeau reste écrit plutôt que retiré.

## L'installateur et la gouvernance composée

`validate-composition.yml` exécute l'installateur de la génération épinglée par l'appelant, et lui passe la fiche `toolchains/cargo-deny.json` de la gouvernance **composée** par `.github/composition/manifest.json`. Ce jour, la référence composée est `d94081ccc5892c262ba1a0c534b8575a18c48341`, dont la fiche déclare 0.19.5.

| Installateur | Fiche | Résultat de `validate_cargo_deny` |
| --- | --- | --- |
| base (constante 0.19.5) | cette branche (0.22.0) | refusé : `Unexpected cargo-deny version` |
| cette branche | référence composée (0.19.5) | accepté |
| cette branche | cette branche (0.22.0) | accepté |

Sans la seconde ligne, toute génération déclarée après cette fusion échouerait à l'étape d'installation chez chaque consommateur, tant que `manifest.json` ne compose pas une gouvernance postérieure. L'installateur accepte donc la version courante et la précédente, et rien d'autre ; il vérifie que le binaire extrait annonce la version **déclarée**. Installer 0.22.0 à la place de la version déclarée ne marcherait pas non plus : le gate de la gouvernance composée, à qui l'on passe le binaire 0.22.0, répond `digest mismatch … refusing`.

Les huit dépôts qui portent leur propre copie de `check-dependency-policy.ts` ne lisent ni la fiche ni `LIBRE_AI_CARGO_DENY` : la copie épingle 0.19.5 et télécharge son archive. Exécutée telle quelle dans `ai-model-policy` : code 0, `cargo-deny 0.19.5`.

## Tests, et leur neutralisation

Neuf substitutions, une par ligne corrigée, chacune rejouée contre le test qui la verrouille ; un mutant identique à l'original est refusé par `cmp`, et l'arbre est comparé à l'index à la fin.

| Substitution | Test | Résultat |
| --- | --- | --- |
| `--config` remis après `check` (gate) | `check-dependency-policy.test.ts` | rouge |
| `--config` remis après `check` (contrôle périodique) | `rust-advisories.test.ts` | rouge |
| `darwin-x64` de nouveau exigé | `check-dependency-policy.test.ts` | rouge |
| l'installateur refuse la version précédente | `test_install_toolchains.py` | rouge |
| l'installateur accepte toute version | `test_install_toolchains.py` | rouge |
| l'installateur attend du binaire sa version courante, non la déclarée | `test_install_toolchains.py` | rouge |
| le gate des dérogations ne classe plus `.config/deny.toml` | `advisory-waivers.test.ts` | rouge |
| l'archive « non épinglée » d'un test construite depuis un littéral périmé | `check-toolchain-source.test.ts` | rouge |
| l'installateur nomme une version que la fiche ne déclare pas | `test_install_toolchains.py` | rouge |

9 cas, 9 rouges, 0 survivant, 0 refusé.

## Ordre

1. La pull request préparatoire (`unmaintained = "all"` dans la politique de base).
2. La même ligne dans les douze `deny.toml` de la flotte.
3. Cette pull request.

Fusionnée avant l'étape 2, cette pull request rétrécit le rapport du contrôle périodique sur cinq graphes sans qu'aucun fichier n'ait changé chez eux. Elle est ouverte en brouillon pour cette raison.

Après la fusion, `ecosystem/check-toolchain-source.ts` (workflow planifié `inventory-drift`) signale `database-policy-inspector`, dont `ci.yml` déclare en ligne l'archive 0.19.5, jusqu'à ce que ce dépôt reprenne les trois lignes `CARGO_DENY_*`.

## Non relu, non prouvé

- Aucune passe de revue indépendante sur ce diff ni sur ce dossier.
- Les mesures viennent des binaires macOS arm64. Le binaire Linux x64 est celui de la CI : son empreinte d'archive et d'exécutable est relevée, son comportement n'a pas été comparé ici.
- `advisory-withdrawn` : une dérogation visant un avis retiré était silencieuse pour le contrôle périodique sous 0.19.5 (`advisory-not-detected`, sans identifiant). Si le diagnostic 0.22.0 porte l'identifiant de l'avis, le contrôle le comptera comme avis non couvert. Aucun cas dans la flotte ce jour ; non mesuré.
- Les clés `expiry` et `allow` d'une entrée `ignore` (0.21.0) ne sont pas lues par le gate des dérogations.
- L'installateur n'a été exécuté de bout en bout que par ses tests, qui simulent le téléchargement ; la composition de la CI l'exécute sur Linux.
- Les dépôts privés de l'organisation n'ont pas été lus.
