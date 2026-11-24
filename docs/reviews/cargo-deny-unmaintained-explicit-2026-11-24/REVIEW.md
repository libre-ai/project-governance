<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve

# `unmaintained = "all"` écrit dans la politique de base : dossier de mesure

**Date :** 2026-11-24
**Objet :** la pull request qui ajoute `unmaintained = "all"` à la section `[advisories]` de `deny.toml` et de `crates/ecosystem-engine/deny.toml`, sans changer la version de cargo-deny.
**Nature :** dossier de revue d'une pull request écrite par un agent. Il rend compte de ce que l'auteur a mesuré et de la passe qui a examiné la pull request ; il n'est pas un arbitrage du propriétaire, et aucun agent n'en écrit.
**Rôle :** deux passes de revue, chacune faite en lecture seule par un sous-agent à contexte neuf, distinct de l'auteur. Ce dossier est tenu par l'auteur, qui y reporte le verdict et les constats que chaque passe lui a rendus.

## Les passes

| Passe | Commit relu | Base (`git merge-base`) | Verdict |
| --- | --- | --- | --- |
| 1 | `8ddbcb307537507ed261677b440a5e33fb8ed2c5` | `18e0a468527310590db2f49da15ba697250472a7` | approuvé avec réserves : un constat mineur |
| 2 | `67f0b5ccc39cd25b42ee56a2cdf030d279b695fa` | `e8dc16550f9147ff3e2d59f8d7ced0fd143009ee` | approuvé : aucun constat |

La passe 2 a relu le commit qui traite le constat de la passe 1. Le commit qui inscrit la passe 2 dans ce dossier, et la fusion de la branche servie qui le précède, ne changent que ce dossier ; **aucune passe ne les a relus.**

## Constat de la passe 1, et sa suite

| Gravité | Constat | Suite |
| --- | --- | --- |
| minor | Le commentaire ajouté dans les deux `deny.toml` disait que la ligne garde le rapport d'avis « on the whole graph ». Ce n'est vrai que pour `unmaintained` : `unsound` vaut `workspace` par défaut sous les deux versions, et la politique ne l'écrit pas. | Corrigé : le commentaire se borne à `unmaintained` et dit que `unsound` reste à son défaut. Vérifié par l'auteur dans `src/advisories/cfg.rs` aux tags 0.19.5 (lignes 107-108 et 283-284) et 0.22.0 (lignes 288-289 et 447-448). Relu par la passe 2, sans constat. |

Aucun constat `blocking` ni `major` dans l'une ou l'autre passe.

## Ce que la passe 1 a rejoué

Ce que la passe 2 a rejoué n'a pas été transmis à l'auteur.

- L'empreinte de l'archive 0.19.5 `aarch64-apple-darwin`, égale à celle de l'API des releases.
- Sur ce dépôt, sous 0.19.5 : sorties identiques à l'octet avec et sans la ligne.
- Sur `artifact-verification` : 0.19.5 sort au code 1 avec et sans la clé ; 0.22.0 sort au code 0 sans la clé et au code 1 avec.

La passe n'a pas rejoué : les 14 autres graphes du tableau ci-dessous, les 56 exécutions du second relevé, le binaire Linux, les dépôts privés.

## Pourquoi cette ligne

cargo-deny 0.22.0 (publié le 2026-11-19) change la valeur par défaut de `advisories.unmaintained` de `all` à `workspace` : sans la clé, seuls les crates non maintenus dont dépend directement un crate du workspace sont signalés. La flotte est épinglée en 0.19.5, où l'absence de la clé vaut `all`. Écrire la valeur aujourd'hui ne change rien sous 0.19.5 et fixe le périmètre pour la version suivante.

Le verdict requis (`bans`, `licenses`, `sources`) ne lit pas cette clé. Elle agit sur `check advisories`, donc sur le contrôle périodique `tools/security/check-fleet-advisories.ts` et sur l'étape non bloquante du gabarit `reusable-dependency-policy.yml`.

## Ce qui a été mesuré

Binaires `aarch64-apple-darwin` des releases 0.19.5 et 0.22.0, empreintes d'archive égales au champ `digest` de l'API des releases. Dépôts publics non archivés de l'organisation portant un `Cargo.lock` suivi, têtes des branches servies en clone superficiel, plus ce dépôt. Base RustSec au commit `52384ab5581a4487b62c549eef95cf7ba7e8bad5`. Toolchain Rust 1.97.0.

Pour chaque couple (dépôt, manifeste), quatre exécutions par contrôle : ancienne et nouvelle version, configuration du dépôt telle quelle et configuration proposée (la même, avec `unmaintained = "all"`). Le fichier de configuration est celui que le contrôle périodique retient : le `deny.toml` suivi le plus proche en remontant depuis le `Cargo.lock`. Sortie `--format json` réduite à la liste triée (gravité, code, identifiant d'avis, crate), comparée octet à octet à celle de 0.19.5 avec la configuration telle quelle.

Colonnes : code de sortie de `check bans licenses sources` (0.19.5 telle quelle / 0.22.0 proposée) ; code de sortie de `check advisories` (0.19.5 telle quelle / 0.22.0 telle quelle / 0.22.0 proposée).

| Dépôt | Manifeste | Requis | Avis | Identifiants sous 0.19.5 | Identifiants sous 0.22.0 sans la clé | Proposée, les deux versions, contre la référence |
| --- | --- | --- | --- | --- | --- | --- |
| ai-model-policy | `Cargo.toml` | 0 / 0 | 0 / 0 / 0 | aucun | les mêmes | identique |
| ai-work-supervision | `Cargo.toml` | 0 / 0 | 1 / 1 / 1 | RUSTSEC-2026-0459, RUSTSEC-2026-0486 | les mêmes | identique |
| artifact-verification | `Cargo.toml` | 0 / 0 | 1 / 0 / 1 | RUSTSEC-2026-0543 (unmaintained) | aucun | identique |
| capability-authorization | `Cargo.toml` | 0 / 0 | 1 / 1 / 1 | RUSTSEC-2026-0387 | les mêmes | identique |
| capability-authorization | `third_party/biscuit-auth-6.0.0/Cargo.toml` | 1 / 1 | 1 / 1 / 1 | sans réponse | sans réponse | illisible |
| database-policy-inspector | `Cargo.toml` | 0 / 0 | 0 / 0 / 0 | aucun | les mêmes | identique |
| execution-continuity-evaluator | `Cargo.toml` | 0 / 0 | 1 / 1 / 1 | RUSTSEC-2026-0543 (unmaintained) | les mêmes | identique |
| execution-sandbox | `Cargo.toml` | 0 / 0 | 1 / 0 / 1 | RUSTSEC-2026-0543 (unmaintained) | aucun | identique |
| personal-knowledge-workspace | `Cargo.toml` | 0 / 0 | 1 / 1 / 1 | RUSTSEC-2024-0370 (unmaintained), RUSTSEC-2026-0346, -0347, -0348, -0349, -0382, -0385, -0386, -0414, -0433, -0592, -0594 | les mêmes moins RUSTSEC-2024-0370 | identique |
| project-governance | `Cargo.toml` | 0 / 0 | 1 / 1 / 1 | RUSTSEC-2026-0387 | les mêmes | identique |
| project-website | `Cargo.toml` | 0 / 0 | 1 / 1 / 1 | RUSTSEC-2026-0592 | les mêmes | identique |
| schemas-and-contracts | `crates/sdk-rs/Cargo.toml` | 0 / 0 | 1 / 1 / 1 | RUSTSEC-2026-0543 (unmaintained) | les mêmes | identique |
| schemas-and-contracts | `tools/quality/build-brief-crypto-oracle/Cargo.toml` | 0 / 0 | 0 / 0 / 0 | aucun | les mêmes | identique |
| schemas-and-contracts | `tools/quality/signalement-receipt-crypto-oracle/Cargo.toml` | 0 / 0 | 0 / 0 / 0 | aucun | les mêmes | identique |
| schemas-and-contracts | `tools/quality/strict-json-oracle/Cargo.toml` | 0 / 0 | 1 / 0 / 1 | RUSTSEC-2026-0543 (unmaintained) | aucun | identique |
| square-control | `Cargo.toml` | 0 / 0 | 1 / 0 / 1 | RUSTSEC-2026-0374 (unmaintained) | aucun | identique |

Couples examinés : 16 = 15 identiques + 0 différent + 1 illisible. Le couple illisible est l'archive vendorisée de `capability-authorization` : cargo refuse de résoudre ce manifeste hors du workspace qui l'englobe, avec le même message sous les deux versions (« current package believes it's in a workspace when it's not »), celui que le contrôle périodique range sous `shadowed`.

Sans la clé, cinq couples changent de sortie sous 0.22.0, chacun en perdant un avis `unmaintained` porté par une dépendance transitive ; quatre passent du code 1 au code 0.

Second relevé, avec le fichier `deny.toml` de cette pull request passé tel quel en configuration aux 14 couples que gouverne une copie de la politique de base (les dix copies de la flotte sont identiques à l'octet à celle de la base avant modification) : 14 couples, deux contrôles, deux versions, 56 exécutions, 56 identiques à la référence.

## Ce que cette pull request ne fait pas

- Elle ne modifie aucun `deny.toml` hors de ce dépôt. Le contrôle périodique lit le fichier de chaque dépôt : tant qu'un dépôt n'a pas repris la ligne, son rapport d'avis rétrécit le jour où la version change. Douze fichiers sont concernés : la copie de base de dix dépôts, `crates/sdk-rs/deny.toml` de `schemas-and-contracts`, et le `deny.toml` de `square-control`, qui n'a pas de section `[advisories]`.
- Elle ne change pas la version de cargo-deny.
- Elle n'écrit pas `unsound = "all"`. `unsound` vaut `workspace` par défaut sous 0.19.5 comme sous 0.22.0 (lu dans la source, non mesuré) : la portée des avis `unsound` ne change donc pas avec la version. L'écrire à `all` pourrait changer des verdicts, ce qui n'a pas été mesuré.

## Réserves

- **`unsound` reste à `workspace`.** La politique de base ne couvre le graphe entier que pour `unmaintained`. Étendre `unsound` est une décision à mesurer à part.
- **Un intitulé de test dit le contraire.** `tools/quality/advisory-waivers.test.ts`, test « cargo-deny scope and level keys at their defaults are not waivers », range `unsound = "all"` parmi les valeurs par défaut ; `all` n'est le défaut de `unsound` sous aucune des deux versions. Non modifié ici.

## Non relu, non prouvé

- L'inscription de la passe 2 dans ce dossier n'a été relue par aucune passe.
- Les 14 graphes autres que ce dépôt et `artifact-verification`, et les 56 exécutions du second relevé, n'ont été mesurés que par l'auteur.
- Les mesures viennent des binaires macOS arm64 ; la CI exécute le binaire Linux x64 de la même release. L'égalité de comportement entre les deux est supposée, pas mesurée.
- Les dépôts privés de l'organisation n'ont pas été lus.
- Le relevé vaut pour la base RustSec et les têtes de branche du jour.
