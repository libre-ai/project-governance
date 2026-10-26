Verdict: reject

# Revue, troisième tour : ADR-0060, les gates s'exécutent depuis la PR qu'ils jugent

**Date :** 2026-10-24
**Objet :** pull request #158, ADR-0060 au statut `proposed` (issue #152). Ce tour vérifie l'amendement qui suit le second tour (`REVIEW-ROUND-2.md`, verdict `reject` sur `30beb61`).
**Nature :** passe de revue seule, mode `candidate-integration`, troisième tour, sur un commit immuable. Le relecteur n'est pas l'auteur et n'a rien modifié.

## Enregistrement de la passe

- `reviewPassId` : `rp-adr0060-6d380eb8202b-candidate-integration-r3`
- rôle et mode : `candidate-integration`, aucun rôle spécialisé du catalogue
- commit revu : `6d380eb8202bc0e94d8042f191b7755b544f699b`, tête de `work/adr-proposed-gates-run-from-pr-2026-10-24` (`gh pr view 158 -R libre-ai/project-governance --json headRefOid --jq .headRefOid`)
- dernier head revu, point de départ de la re-revue (ADR-0056 D2) : `30beb618257d0fcd1b7e86de49e72d0d9ca5fb6e`
- base : `066ef494ff33261e2c61cd7affe880b503dc3fe5`. C'est toujours la tête de `migrate/recover-code`, branche servie et branche par défaut (`git ls-remote --symref https://github.com/libre-ai/project-governance HEAD`), et la merge base de la PR (`baseRefOid`).
- diff de ce tour, `git diff --stat 30beb61 HEAD` : 2 fichiers.
  - `e2cbfac` ajoute `REVIEW-ROUND-2.md` (258 lignes), seul fichier du commit.
  - `6d380eb` ne touche que l'ADR (26 insertions, 11 suppressions).
- SHA-256, par `shasum -a 256 <fichier>` :
  - `docs/adr/0060-gates-run-from-the-pull-request-they-judge.md` : `ba1744463134fda705cd08c3deb1e525929c5de4be07626bee52b3f39bb927ae` (`38fdb7ee…658b` au second tour)
  - `REVIEW.md` : `11392a208f76af80075705596736ebb66ab2f6517b8b948a3c44369ac04c61d5`, inchangé
  - `REVIEW-ROUND-2.md` : `e61674a02983be32b67ce68704d30fb1c9712c97162ebe47ee7c1e2f5f660642`
- aucun contrat ni vecteur n'est touché
- agent : Claude Code, sous-agent de revue ; modèle `claude-opus-5-5` (Claude Opus 5.5) ; le harnais n'expose pas d'identifiant de session
- arbre de travail propre avant et après la passe (`git status --short` : 0 ligne)

Ce verdict **n'est pas une approbation de promotion par rôle**. Il ne remplace aucun rôle de `contracts/catalog.v1.json` et ne change l'état d'aucune autorité.

## Ce qui a été rejoué, et comment

~~~sh
D=$(mktemp -d)
git clone https://github.com/libre-ai/project-governance "$D/pg"
git -C "$D/pg" fetch origin pull/158/head
git -C "$D/pg" checkout --detach FETCH_HEAD    # -> 6d380eb8202b…
git -C "$D/pg" diff --word-diff=porcelain 30beb61 HEAD -- docs/adr/
git -C "$D/pg" diff -U0 30beb61 HEAD -- docs/adr/ | grep '^@@'
~~~

### (a) Rien n'a bougé hors du diff annoncé

- `git diff --stat 066ef494ff33 HEAD` liste 3 fichiers : l'ADR, `REVIEW.md` et `REVIEW-ROUND-2.md`. Aucun workflow, gate, contrat ni vecteur n'est touché.
- `REVIEW.md` a le même SHA-256 qu'au second tour.
- Les hunks de l'ADR sont aux lignes 47, 61, 86, 101, 103, 109, 111 (élargie à 111-126), 134, 146, 158 et 178. Ils correspondent un à un à N1 à N8.
- La ligne de statut (l. 3) est inchangée.
- `REVIEW-ROUND-2.md` porte la ligne `Verdict: reject`, le `reviewPassId` `-r2`, la commande C8 (`# C8 : …`, l. 105) et la section « Arbitrage de n5 » (l. 174). Il ne contient pas la section « Hors fichier ».
- La base n'a pas bougé (`066ef494ff33`). Les citations épinglées visent donc toujours le même arbre.

### (b) Épingles

L'ADR porte 106 épingles distinctes (100 au second tour). Ce tour en ajoute 6 et n'en retire aucune :

- `066ef494ff33:.github/composition/download-advisory-database.py:16`
- `066ef494ff33:.github/composition/download-advisory-database.py:73`
- `066ef494ff33:.github/composition/run-composition.py:21-23`
- `066ef494ff33:.github/composition/test_run_composition.py` (dans la commande `git grep -n load_plan`)
- `066ef494ff33:.github/workflows/validate-composition.yml:74-76`
- `066ef494ff33:.github/workflows/validate-composition.yml:141-143`

Résolution mécanique, avec la même boucle qu'au second tour (C0 de `REVIEW-ROUND-2.md`, variable `fp` et non `path` sous zsh) : `resolved=106 failed=0`.

Les 6 nouvelles épingles ont été lues :

- `:16` charge `run-composition.py` comme module `runner` ;
- `:73` appelle `runner.load_plan(target, revision)` ;
- `run-composition.py:21-23` est `def load_plan(target, revision)` puis la lecture de `HERE / 'manifest.json'` ;
- `validate-composition.yml:74-76` et `:141-143` sont les deux appels de `run-composition.py`.

Les anciennes épingles que les phrases modifiées citent à nouveau ont été relues : `doctrine-governance.yml:33-39`, `reusable-work-package-link.yml:35-48`, `validate-composition.yml:58-65`, `check-review-evidence.ts:346-358`, `check-pr-negatives.ts:852-877` et `check-audit-delta.ts:121-157`.

### (c) Chiffres recalculés

| Chiffre de l'ADR (ligne) | Recalcul | Commande |
| --- | --- | --- |
| 146 / 87 / 103 / 104 (l. 87, 140-144) | 146 / 87 / 103 / 104 | C1 à C4 du second tour |
| 30 / 19 (l. 134) | 30 / 19 | C5, C6 du second tour |
| 11 workflows `pull_request:` | 11 | C7 du second tour |
| 11 lecteurs de flotte, 24 entrées | 11, 24 | C9, C10 du second tour |
| 27/30 runs `push` verts d'`inventory-drift` | `{"failure":3,"success":27}` | C11 du second tour |
| `{"false":100}` | `{"false":100}` | C17 du second tour |
| six checks requis | 6 | C15 du second tour |
| le run 40093348731 extrait `refs/remotes/pull/158/merge` (l. 47) | 4 lignes du journal correspondent | T1 |
| 9 fichiers, dont 7 workflows et 2 scripts (l. 113-123) | 9 dans la liste, 7 `.yml` et 2 `.py` | lecture de la liste |
| 5 appels de `load_plan` dans `test_run_composition.py` (l. 125) | 5 (`:17`, `:33`, `:53`, `:93`, `:261`) | T2 |
| `validate-composition.yml` appelé par 14 autres dépôts, épinglé à un sha (l. 111) | recherche de code : 14 ; arbre des branches servies : **16**, dont 14 non archivés, les 16 épinglés à un sha complet | T3, T4 |

~~~sh
# T1
gh run view 40093348731 -R libre-ai/project-governance --log | grep -c 'pull/158/merge'
# T2
git grep -n load_plan 066ef494ff33 -- .github/composition
# T3 : premier instrument, celui de l'ADR
gh search code --owner libre-ai "project-governance/.github/workflows/validate-composition.yml" \
  --limit 100 --json repository,path \
  --jq '[.[]|select(.path|startswith(".github/workflows/"))|.repository.nameWithOwner]|unique|length'
# T4 : second instrument, l'arbre de la branche servie de chaque dépôt du registre
#      (protocole git, sans quota ; le clone suit le HEAD distant)
git show 066ef494ff33:ecosystem/repositories.v1.yaml \
  | grep -E '^  - repository: ' | sed 's/.*repository: //' > repos.txt   # 24
for r in $(cat repos.txt); do
  n=${r#libre-ai/}; [ "$n" = project-governance ] && continue
  git clone -q --depth=1 --filter=blob:none --sparse "https://github.com/$r" "fleet/$n"
  git -C "fleet/$n" sparse-checkout set .github/workflows
done
grep -lE 'project-governance/\.github/workflows/validate-composition\.yml@' \
  fleet/*/.github/workflows/*.y*ml | wc -l                                     # 16
grep -hoE 'validate-composition\.yml@[^ ]+' fleet/*/.github/workflows/*.y*ml \
  | sed 's/.*@//' | awk 'length($0)==40 && /^[0-9a-f]+$/' | wc -l              # 16
grep -lE 'composition/run-composition\.py' fleet/*/.github/workflows/*.y*ml     # 2 fichiers
gh api repos/libre-ai/<dépôt> --jq '"\(.archived) \(.visibility)"'
~~~

Les 23 clones ont réussi. Le relevé T4 se décompose ainsi :

- 16 dépôts portent un `uses: libre-ai/project-governance/.github/workflows/validate-composition.yml@<sha>`, chacun dans `.github/workflows/code-validation.yml:13`.
  - 14 sont épinglés à `75d6ea085b18…` : ce sont exactement les 14 de la recherche de code.
  - 2 sont épinglés à `7c2238d6185e…` : `ai-practice-workbench` et `information-feed-filter`, tous deux `archived=true`, `visibility=public`.
- Les 7 autres dépôts n'en portent aucun : `signalement`, `square-control`, `pi-evidence`, `pi-harness-challenger`, `.github`, `product-research`, `libre-ai`.
- Deux dépôts appellent **directement** `run-composition.py` depuis leurs propres workflows :
  - `application-development-toolkit/.github/workflows/playwright-guid-diagnostic.yml:42`, `:57`, outillage extrait à `8a27b8f5bf77…` ;
  - `personal-knowledge-workspace/.github/workflows/notebook-webkit-macos.yml:49`, `:77`, outillage à `75d6ea085b18…`.

  Les fixtures de ce dépôt en gardent la trace, par exemple `066ef494ff33:tools/fleet/fixtures/application-development-toolkit-9/after/.github/workflows/playwright-guid-diagnostic.yml.fixture:42`, `:57`.

### (d) CI sur la tête revue

Les 12 runs `pull_request` sur `6d380eb` sont `completed`/`success`, plus le run `push` de `Doctrine governance` (`gh run list --branch work/adr-proposed-gates-run-from-pr-2026-10-24 --json workflowName,headSha,conclusion,event,status`).

## Suivi des constats du second tour

| Constat | Gravité, disposition au tour 2 | État | Preuve |
| --- | --- | --- | --- |
| N1 : le coût d'A2 ne compte pas l'appelant de `run-composition.py` | minor, défaut bloquant | **résolu** | l. 111-126 : `validate-composition.yml` est ajouté, avec l'étape qui obtient le manifeste ; `download-advisory-database.py` aussi. Le coût est de 9 fichiers, 8 au minimum, 10 si `load_plan` prend un paramètre obligatoire (5 appels de test, T2). Le chiffre 14 se vérifie pour les dépôts non archivés, voir O2. Une précision de portée reste à faire, voir O1. |
| N2 : « le seul site » | minor, suggestion | **résolu** | l. 86 : « Trois fichiers du dépôt en parlent », et les trois sont nommés. |
| N3 : merge base prise avec la merge ref | non-blocking, suggestion | **résolu** | l. 47 : le `HEAD` est la merge ref, mesuré (T1) ; la merge base est le parent côté base. l. 146 reprend la précision. Une épingle est mal placée, voir O3. |
| N4 : `doctrine-governance` lit `origin/<base>` | non-blocking, suggestion | **résolu** | l. 47 et l. 61. |
| N5 : « seul un répertoire de confiance » | non-blocking, suggestion | **résolu** | l. 86 : les quatre cas de la source (`reusable-work-package-link.yml:40-46`) sont repris : drapeau inconnu, `--config=` vide, `--no-env-file` seul, `--config` non vide. |
| N6 : `pull_request_target` et la branche par défaut | non-blocking, suggestion | **résolu** | l. 101, 103, 178 : « branche par défaut », marqué documenté et non mesuré ; le cas d'une PR vers `main` est dit. L'hypothèse sur l'approbation des forks reste ouverte, déclarée comme telle. |
| N7 : relevé des 8 extractions non rejouable | non-blocking, suggestion | **résolu** | l. 158 renvoie à la C8 du dossier du second tour, présente à sa l. 105. `validate-composition.yml` est couvert. |
| N8 : « le garde s'exécuterait toujours depuis la tête » | non-blocking, suggestion | **résolu** | l. 134. |

Les constats du premier tour résolus au second (M1, m1, m3, m5, n1 à n5) ne sont pas rouverts par ce diff : aucun hunk ne touche leurs phrases. m2 est résolu, puisque N1 l'est. m4 est résolu, puisque N2 l'est.

### P1 : preuve requise, ouverte par construction

Elle n'est pas tranchée ici : c'est une décision du propriétaire. La ligne de statut (l. 3) est inchangée : « proposed — aucune option n'est retenue ». `AGENTS.md:73` pose qu'« a doctrine merge is a signature ». Le plus petit contrôle qui la trancherait n'a pas changé : une ligne de statut qui nomme ce que la fusion signe, ou une consigne du propriétaire qui fait attendre la PR.

## Nouveaux constats

Gravités du protocole ; dispositions selon ADR-0056 D2 (option A).

### O1 : minor, suggestion. « Son seul appelant » ne vaut que pour ce dépôt

**Déclencheur.** l. 111 : « son seul appelant est `validate-composition.yml` », prouvé par `git grep -n run-composition.py 066ef494ff33 -- .github/workflows`, c'est-à-dire sur les seuls workflows de ce dépôt.

**Preuve reproduite.** Sur les branches servies de la flotte (T4), deux dépôts appellent `run-composition.py` en ligne de commande, chacun deux fois : `application-development-toolkit` (outillage `8a27b8f5bf77…`) et `personal-knowledge-workspace` (outillage `75d6ea085b18…`).

**Impact.** Le compte de fichiers d'A2 ne change pas : il porte sur ce dépôt. Mais la condition de contrat que l'ADR pose pour `validate-composition.yml` vaut aussi pour la ligne de commande de `run-composition.py`. Le nouvel argument doit y être facultatif, et son absence doit garder le manifeste de l'outillage ; sinon ces deux dépôts cassent au prochain relèvement de leur épingle. Le scénario à 10 fichiers (paramètre obligatoire de `load_plan`) reste compatible si le défaut est posé au niveau de la ligne de commande. Il suffit d'écrire « son seul appelant dans ce dépôt » et d'ajouter la contrainte sur la ligne de commande. Disposition `suggestion` et non `défaut bloquant` : aucun chiffre de l'ADR n'est faux, et le principe énoncé pour l'interface voisine s'applique tel quel.

### O2 : non-blocking, suggestion. 14 dépôts non archivés, 16 en tout

l. 111 : « appelé par 14 autres dépôts de la flotte ». Le second instrument (T4) en trouve 16. Les 2 dépôts que la recherche de code ne voit pas sont archivés (`ai-practice-workbench`, `information-feed-filter`, épinglés à `7c2238d6185e…`). Un dépôt archivé n'exécute plus de workflow, donc la conclusion sur le contrat ne change pas. Le texte gagnerait à dire « 14 dépôts non archivés, 16 avec les deux archivés ». « Épinglé à un sha » se vérifie pour les 16 : sha complet de 40 caractères.

### O3 : non-blocking, suggestion. Épingle mal rattachée dans la note de la l. 47

La parenthèse qui suit « `check-review-evidence.ts` et `check-pr-negatives.ts` lisent la merge base … avec le `HEAD` de l'extraction » cite aussi `check-audit-delta.ts:121-157`. Or ce gate lit la tête par `FETCH_HEAD`, objet de la phrase précédente. Il faudrait déplacer l'épingle après « `check-audit-delta.ts` lit cette tête ».

### R : non-blocking, prêt

Prêt, sur le périmètre revu :

- N1 à N8, résolus ;
- les 106 épingles, qui résolvent ; les 6 nouvelles disent ce que l'ADR leur fait dire ;
- tous les chiffres repris, qui se recalculent (tableau (c)), le 14 compris pour les dépôts non archivés ;
- aucun changement hors du diff annoncé ;
- aucune décision n'est prise au nom du propriétaire.

## Risques résiduels

- `Bun quality` reste vert parce que le corps de la PR cite des dossiers sous `docs/reviews/` dont le verdict est `reject`. `check-review-evidence.ts` admet toute référence à un artefact sous `docs/reviews/` (`066ef494ff33:tools/quality/check-review-evidence.ts:24-27`), quel que soit son verdict. C'est l'objet de l'issue #160.
- La preuve « HEAD = merge ref » (l. 47) repose sur le journal d'un run, que GitHub ne conserve que pour une durée limitée. La démonstration sur dépôt jetable, elle, se rejoue.
- Deux comportements de GitHub restent non mesurés : la résolution entre deux checks de même contexte, et le rattachement d'un run `pull_request_target` au contexte requis. L'hypothèse sur l'approbation des forks reste non vérifiée.
- Les secrets d'organisation sont `unavailable` (HTTP 403).
- T4 lit les branches servies du 2026-10-24. Les épingles de la flotte bougent à chaque relèvement.
- Aucun gate n'a été exécuté localement. Les verdicts de CI cités sont ceux de GitHub Actions.

## Verdict

**`reject`** sur le commit `6d380eb8202bc0e94d8042f191b7755b544f699b`.

Motif : la preuve requise P1 reste ouverte. Selon ADR-0056 D2, clause 3, ni `approve` ni `approve-with-minor-reservations` n'admettent une preuve requise ouverte. Aucun autre constat n'est bloquant. O1 à O3 sont des suggestions, et aucun constat `blocking` ou `major` n'est ouvert.

### Verdict selon la façon dont le propriétaire tranche P1

1. **La fusion signe la mesure et l'écartement conditionnel d'A1, sans option retenue.**
   - La ligne de statut doit le dire. C'est un changement normatif postérieur à ce verdict, qui exige une passe fraîche (`AGENT-REVIEW-PROTOCOL.md:32`) à partir de ce commit.
   - Si cet amendement ne change que la ligne de statut et ne contredit pas le reste du texte, P1 est close et seules O1 à O3 restent ouvertes. Je rendrais alors **`approve-with-minor-reservations`**, les réserves étant O1 à O3.
   - Ce verdict deviendrait **`approve`** si O1 à O3 sont appliquées dans le même amendement.
   - La fusion exige en plus le jalon explicite du propriétaire (protocole, « Candidate integration »).
2. **La PR attend l'arbitrage d'une option.**
   - P1 reste ouverte jusqu'à ce que le propriétaire choisisse. Sur ce contenu, le verdict reste **`reject`** (clause 3).
   - L'option retenue changera l'ADR de façon normative (statut, section de décision), et ce texte devra passer une revue fraîche. Aucun verdict favorable n'est possible avant que l'arbitrage soit écrit dans l'ADR et revu.

Ce verdict n'est pas une approbation de promotion par rôle.
