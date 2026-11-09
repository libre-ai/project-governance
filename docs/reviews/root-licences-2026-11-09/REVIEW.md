<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: measured

# Inventaire : licence racine détectée sur les 23 dépôts actifs de l'organisation

**Date :** 2026-11-09
**Objet :** ce que GitHub (et tout outil qui lit `LICENSE` à la racine) détecte comme licence de chaque dépôt actif de `libre-ai`, avant toute ouverture publique au sens d'I-30.
**Nature :** mesure seule, lecture seule, instrument unique (API REST `repos/{owner}/{repo}/license`). Elle fonde l'ADR-0061 (`docs/adr/0061-root-license-carries-the-default-licence-text.md`). Aucun fichier modifié dans un dépôt de la flotte.

## Pourquoi mesurer

`LICENSING.md:3-5` pose que la licence d'un fichier est portée par ses métadonnées SPDX ou `REUSE.toml`, et que « the root `LICENSE` is only a human-readable summary ». Un lecteur extérieur, GitHub, un scanner SPDX ou un agrégateur ne lisent pas cette politique : ils lisent `LICENSE`. Si ce fichier est un résumé, la licence détectée est `NOASSERTION` ; s'il est absent, aucune. I-11 exige des licences différenciées et la conformité REUSE ; I-20 veut l'évidence lisible par défaut. Une licence que personne ne détecte n'est lisible pour personne.

## Instrument et commande

~~~sh
gh repo list libre-ai --limit 100 --json name,isArchived --jq '.[] | select(.isArchived|not) | .name' | sort > repos.txt
while read -r r; do
  out=$(gh api "repos/libre-ai/$r/license" --jq '[.license.spdx_id, .name, .size] | @tsv' 2>/dev/null) || out="ABSENT"
  printf '%s\t%s\n' "$r" "$out"
done < repos.txt
~~~

`ABSENT` est un 404 de l'API : aucun fichier de licence détectable à la racine. `NOASSERTION` est un fichier `LICENSE` présent dont le texte ne correspond à aucune licence connue.

## Résultat (2026-11-09)

| Dépôt | Détection | Taille de `LICENSE` (octets) |
| --- | --- | --- |
| ai-work-supervision | EUPL-1.2 | 13792 |
| information-watch | EUPL-1.2 | 13792 |
| signalement | EUPL-1.2 | 13792 |
| square-control | EUPL-1.2 | 13792 |
| database-policy-inspector | Apache-2.0 | 10280 |
| pi-harness-challenger | Apache-2.0 | 11324 |
| ai-model-policy | NOASSERTION | 1045 |
| game-lab | NOASSERTION | 475 |
| learning-session-facilitation | NOASSERTION | 1158 |
| personal-knowledge-workspace | NOASSERTION | 1028 |
| project-governance | NOASSERTION | 669 |
| project-website | NOASSERTION | 955 |
| schemas-and-contracts | NOASSERTION | 669 |
| .github | ABSENT | — |
| application-development-toolkit | ABSENT | — |
| artifact-verification | ABSENT | — |
| capability-authorization | ABSENT | — |
| collaborative-data-sync | ABSENT | — |
| execution-continuity-evaluator | ABSENT | — |
| execution-sandbox | ABSENT | — |
| organization-data-lifecycle | ABSENT | — |
| pi-evidence | ABSENT | — |
| product-research | ABSENT | — |

Comptes, sortie de `awk -F'\t' '{print $2}' licences.tsv | sort | uniq -c` :

~~~text
  10 ABSENT
   2 Apache-2.0
   4 EUPL-1.2
   7 NOASSERTION
~~~

23 dépôts actifs = 6 détectés + 7 non assertés + 10 absents.

## Lecture

- Les quatre dépôts détectés EUPL-1.2 ont le même fichier (13792 octets) : le texte intégral de la licence. C'est la forme qui marche.
- Les sept `NOASSERTION` portent un **pointeur** (475 à 1158 octets) vers `LICENSING.md` ou `REUSE.toml`. `project-governance` et `schemas-and-contracts` partagent le même pointeur de 669 octets. Cette forme est conforme à REUSE et invisible pour tout le reste.
- Sur trois des dix dépôts `ABSENT`, sondés par `gh api repos/libre-ai/<r>/contents/LICENSES --jq '[.[].name]|join(",")'`, le dossier `LICENSES/` existe (`.github` : CC-BY-4.0 ; `execution-sandbox` : Apache-2.0, CC-BY-4.0, EUPL-1.2 ; `product-research` : Apache-2.0, CC-BY-4.0, MIT). Les textes sont là, au seul endroit où GitHub ne les cherche pas. Les sept autres dépôts absents n'ont pas été sondés : hypothèse, même forme.
- Le job `Licensing and contribution governance` (`.github/workflows/ci.yml:26`) vérifie la conformité REUSE de ce dépôt. Il n'est pas dans la liste des checks requis du ruleset `24161111` (lue par `gh api repos/libre-ai/project-governance/rulesets/24161111 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'` : `composition / validate`, `Composed targets pass the manifest gates of their composed governance`, `Door declaration`, `Bun quality`, `Every pinned code citation of the documents resolves`, `Negatives declaration`). Un rouge de licence ne bloque donc aucune fusion. Et aucun gate de flotte ne mesure ce que cet inventaire mesure.

## Ce que l'instrument exclut par construction

- Un seul instrument : la détection de GitHub (bibliothèque `licensee`). Un autre détecteur (scancode, un agrégateur de paquets) peut lire autrement ; la convergence sur « texte intégral à la racine » est le seul cas où tous s'accordent.
- Les dépôts archivés sont exclus (filtre `isArchived`). Les dépôts privés sont inclus : l'API répond avec le jeton de l'organisation.
- La mesure ne dit pas quelle licence **devrait** être détectée pour chaque dépôt ; c'est `LICENSING.md` et le `REUSE.toml` de chacun qui le disent. L'ADR-0061 demande un gate qui compare les deux.

## Suite

L'ADR-0061 propose la décision ; le présent dossier n'en prend aucune. Pour rejouer : les deux commandes ci-dessus, puis comparer les comptes.
