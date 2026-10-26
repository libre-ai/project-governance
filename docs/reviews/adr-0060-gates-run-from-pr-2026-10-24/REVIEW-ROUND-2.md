Verdict: reject

# Revue, second tour : ADR-0060, les gates s'exécutent depuis la PR qu'ils jugent

**Date :** 2026-10-24
**Objet :** pull request #158, ADR-0060 au statut `proposed` (issue #152), après l'amendement qui suit le premier tour (`REVIEW.md`, verdict `reject` sur `95871c4`).
**Nature :** passe de revue seule, mode `candidate-integration`, second tour, sur un commit immuable. Le relecteur n'est pas l'auteur et n'a rien modifié.

## Enregistrement de la passe

- `reviewPassId` : `rp-adr0060-30beb618257d-candidate-integration-r2`
- rôle et mode : `candidate-integration`, aucun rôle spécialisé du catalogue
- commit revu : `30beb618257d0fcd1b7e86de49e72d0d9ca5fb6e`, tête de la branche `work/adr-proposed-gates-run-from-pr-2026-10-24` (`gh pr view 158 -R libre-ai/project-governance --json headRefOid --jq .headRefOid`)
- dernier head revu, point de départ de la re-revue (ADR-0056 D2) : `95871c4bf486d20702826a48afb734d68f7d3481`
- base : `066ef494ff33261e2c61cd7affe880b503dc3fe5`. C'est la tête de `migrate/recover-code`, branche servie et branche par défaut (`git ls-remote --symref https://github.com/libre-ai/project-governance HEAD` ; `gh api repos/libre-ai/project-governance --jq .default_branch`), et c'est la merge base de la PR.
- diff de la PR contre la base : 2 fichiers, 549 lignes ajoutées (`git diff --stat 066ef494ff33 HEAD`). Diff de ce tour : `git diff 95871c4 HEAD -- docs/adr/`. Le dossier du premier tour a été ajouté tel quel par `3c4dcd0`.
- SHA-256 du fichier revu `docs/adr/0060-gates-run-from-the-pull-request-they-judge.md` : `38fdb7eecf85ee70584e9dac429de064bda1616b3ca051d22fdca72160cf658b` (`shasum -a 256 <fichier>`). Au premier tour, il valait `75b22fbc…f328`.
- SHA-256 du dossier du premier tour tel que porté par la PR : `11392a208f76af80075705596736ebb66ab2f6517b8b948a3c44369ac04c61d5`
- aucun contrat ni vecteur n'est touché
- agent : Claude Code, sous-agent de revue ; modèle `claude-opus-5-5` (Claude Opus 5.5). Le harnais n'expose pas d'identifiant de session.
- arbre de travail propre avant et après la passe (`git status --short` : 0 ligne)

Ce verdict **n'est pas une approbation de promotion par rôle**. Il ne remplace aucun rôle de `contracts/catalog.v1.json` et ne change l'état d'aucune autorité.

## Ce qui a été rejoué, et comment

~~~sh
D=$(mktemp -d)
git clone https://github.com/libre-ai/project-governance "$D/pg"
git -C "$D/pg" fetch origin pull/158/head
git -C "$D/pg" checkout --detach FETCH_HEAD    # -> 30beb618257d…
git -C "$D/pg" ls-remote --symref \
  https://github.com/libre-ai/project-governance HEAD
# -> ref: refs/heads/migrate/recover-code ; 066ef494ff33… HEAD
~~~

Les citations ont été lues à `066ef494ff33` (`git show 066ef494ff33:<chemin>`).

### (a) Épingles

L'ADR porte maintenant 100 épingles distinctes, contre 82 au premier tour. Ce tour en ajoute 19 et en retire 1 (`reusable-work-package-link.test.ts:143-147`, remplacée par `:143-152`).

~~~sh
F=docs/adr/0060-gates-run-from-the-pull-request-they-judge.md
grep -oE '[0-9a-f]{12}:[A-Za-z0-9._/-]+(:[0-9,-]+)?' "$F" | sort -u | wc -l       # 100
git show 95871c4:"$F" \
  | grep -oE '[0-9a-f]{12}:[A-Za-z0-9._/-]+(:[0-9,-]+)?' | sort -u > old
grep -oE '[0-9a-f]{12}:[A-Za-z0-9._/-]+(:[0-9,-]+)?' "$F" | sort -u > new
comm -13 old new    # 19 ajoutées
comm -23 old new    # 1 retirée
~~~

Résolution mécanique des 100 : chacune résout, et sa plage de lignes tient dans le fichier (`resolved=100 (sans lignes: 1) failed=0`). L'épingle sans lignes est `066ef494ff33:ecosystem/repositories.v1.yaml`, captée dans une commande `git show`.

~~~sh
# zsh : ne pas nommer la variable « path », elle est liée à PATH
for p in $(grep -oE '[0-9a-f]{12}:[A-Za-z0-9._/-]+(:[0-9,-]+)?' "$F" | sort -u); do
  sha=${p%%:*}; rest=${p#*:}; fp=${rest%%:*}; ln=""
  [ "$rest" != "$fp" ] && ln=${rest#*:}
  n=$(git show "${sha}:${fp}" 2>/dev/null | wc -l | tr -d ' ')
  # n = 0 -> non résolue ; max(ln) > n -> hors plage
done
~~~

Les 19 nouvelles épingles ont été lues en entier, et aussi les anciennes que les nouvelles phrases citent à nouveau : `run-composition.py:15`, `:23` ; `code-validation.yml:11-16` ; `check-review-evidence.ts:346-358` ; `check-pr-negatives.ts:852-877`, `:115-118` ; `pinned-citations.yml:11-15` ; `reusable-work-package-link.yml:13-20`, `:35-48`, `:81-96`, `:112-119`. Deux écarts de sens sont relevés : N2 et N5.

### (b) Chiffres repris, recalculés

| Chiffre de l'ADR (ligne) | Recalcul | Commande |
| --- | --- | --- |
| 146 commits depuis 2026-09-24 (l. 87) | 146 | C1 |
| 87 sur le code de gate (l. 87, 127) | 87 | C2 |
| 103 avec les données de gate (l. 128) | 103 | C3 |
| 104 avec le code hors `tools/` et `ecosystem/` (l. 129) | 104 | C4 |
| 30 commits sur `.github/workflows` (l. 119) | 30 | C5 |
| 19 commits sur les sept fichiers des checks requis (l. 119) | 19 | C6 |
| 11 workflows `pull_request:` (l. 71) | 11 | C7 |
| 8 extractions qui gardent le jeton (l. 143) | 8 | C8 |
| 11 fichiers lecteurs de flotte (l. 82) | 11 | C9 |
| 24 entrées du registre, 23 autres dépôts (l. 151) | 24 | C10 |
| 27/30 runs `push` verts d'`inventory-drift`, 3 rouges (l. 151) | `{"failure":3,"success":27}` ; rouges `116b22bd6b0e`, `e04890236623`, `0fe0a6371c01` | C11 |
| run `push` sur `066ef494ff33` vert, Dependabot `skipped` (l. 151) | `success` ; 3 étapes `skipped` : Dependabot et les deux étapes d'issue | C12 |
| `pr-negatives.yml` ajouté par `066ef49` (l. 36) | `066ef49` | C13 |
| premier run `pull_request` le 2026-10-23T20:19:37Z (l. 36) | identique, job `Negatives declaration` ; 32 runs en tout, donc `--limit 200` ne tronque pas | C14 |
| ruleset (l. 29) | `{"approvals":0,"thread":true,"type":"pull_request"}`, `{"strict":true,"type":"required_status_checks"}`, `bypass_actors: []` | C15 |
| 0 secret de dépôt, org `unavailable` (l. 30) | `0` ; HTTP 403, « needs the "admin:org" scope » | C16 |
| `{"false":100}` (l. 32) | `{"false":100}` | C17 |
| mergedAt #141, #151, #142, #154, #144 (l. 36, 165) | `06:21:47Z`, `08:18:30Z`, `06:33:45Z`, `08:23:42Z`, `08:28:06Z` | C18 |

~~~sh
R=origin/migrate/recover-code
# C1
git log --since=2026-09-24 --format=%H $R | wc -l
# C2
git log --since=2026-09-24 --format=%H $R -- tools .github 'ecosystem/*.ts' \
  package.json bun.lock bunfig.toml | wc -l
# C3 : C2 + ecosystem/{repositories,fleet-pins,sql-construction-allowlist,
#      web-headers-allowlist,release-age-exceptions}.v1.yaml
# C4 : C3 + crates/ecosystem-engine/scripts 'distribution/*.ts' 'brand/*.ts'
# C5
git log --since=2026-09-24 --format=%H $R -- .github/workflows | wc -l
# C6 : les sept fichiers que nomme l'ADR, l. 119
# C7
git grep -lE '^  pull_request:' 066ef494ff33 -- .github/workflows | wc -l
# C8 : chaque actions/checkout@ des 11 workflows, et validate-composition.yml
for f in $(git grep -lE '^  pull_request:' HEAD -- .github/workflows | sed 's/^HEAD://') \
         .github/workflows/validate-composition.yml; do
  awk -v F="$f" '
    function flush(){ if(open) print F":"line": "(pc?"persist-false":"KEEPS-TOKEN"); open=0 }
    /^ *- / { flush() }
    /^ *(- )?uses: actions\/checkout@/ { flush(); open=1; pc=0; line=NR; next }
    /persist-credentials: *false/ { if(open) pc=1 }
    /^  [a-z_-]+:$/ { flush() }
    END { flush() }' "$f"
done
# -> KEEPS-TOKEN : ci.yml:29, ci.yml:158, context-conformance.yml:50,
#    context-hygiene.yml:24, doctrine-governance.yml:25, feeds-freshness.yml:32,
#    inventory-drift.yml:44, pr-door.yml:32 (8)
#    persist-false : generation-coherence.yml:48, pinned-citations.yml:54,
#    pr-negatives.yml:33, validate-composition.yml:59
# C9
grep -lE 'HEAD:|contents/|git/trees|"clone"' ecosystem/check-*.ts \
  ecosystem/fleet-tree.ts | grep -v test | wc -l
# C10
git show 066ef494ff33:ecosystem/repositories.v1.yaml | grep -c '^  - repository: '
# C11
gh run list -R libre-ai/project-governance --workflow inventory-drift.yml \
  --branch migrate/recover-code --event push --limit 30 --json conclusion,headSha \
  --jq '([.[]|.conclusion]|group_by(.)|map({(.[0]): length})|add),
        ([.[]|select(.conclusion!="success")|.headSha[0:12]])'
# C12
gh run view 40078154723 -R libre-ai/project-governance --json jobs \
  --jq '.jobs[].steps[]|select(.conclusion=="skipped")|.name'
# C13
git log --diff-filter=A --format=%h 066ef494ff33 -- .github/workflows/pr-negatives.yml
# C14
gh run list -R libre-ai/project-governance --workflow pr-negatives.yml --limit 200 \
  --json createdAt,event,headBranch --jq 'sort_by(.createdAt)|.[0]'
# C15 : commande de l'ADR, l. 29, plus rulesets/24161111 --jq .bypass_actors
# C16
gh api repos/libre-ai/project-governance/actions/secrets --jq .total_count
gh api orgs/libre-ai/actions/secrets --jq .total_count
# C17 : commande de l'ADR, l. 32
# C18
gh pr view <n> -R libre-ai/project-governance --json mergedAt,mergeCommit
~~~

Constats du premier tour recalculés eux aussi, hors ADR :

- P1 : 15 ADR `proposed` ou `proposé` à `066ef494ff33`. Pour 12 d'entre eux, la fusion vaut arbitrage ou signature ; les 3 autres (0033, 0035, 0047) citent une approbation déjà rendue (`grep -m1 Statut` sur chaque `docs/adr/[0-9]*.md`).
- Aucune PR de fork : `{"false":150}` sur toutes les PR (`gh pr list --state all --limit 1000 --json isCrossRepository`). Les 150 visent `migrate/recover-code` (`--json baseRefName`).

### (c) CI sur la tête revue

Les 12 runs `pull_request` sur `30beb618` sont verts, plus un run `push` de `Doctrine governance` (`gh run list --branch work/adr-proposed-gates-run-from-pr-2026-10-24 --json workflowName,headSha,conclusion,event`). Sur `95871c4`, `ci` était rouge, à l'étape `check-review-evidence.ts` : « neither the pull request description nor a line the pull request adds to the gated files refer… ». Sur `30beb618`, cette étape répond « 1 candidate signal(s): 1 admissible ». Le signal admis est la référence du corps de PR à `docs/reviews/…/REVIEW.md`, un dossier dont le verdict est `reject` (voir les risques résiduels).

## Suivi des constats du premier tour

| Constat | Gravité, disposition au tour 1 | État | Preuve |
| --- | --- | --- | --- |
| M1 : la prémisse de D est fausse | major, défaut bloquant | **résolu** | l. 151 : le fait périmé est retiré. Le motif réel est donné : le verdict dépend des 23 autres dépôts, 24 entrées (C10). Le 27/30 et les 3 rouges se recalculent (C11, C12). Le commentaire `pinned-citations.yml:11-15` est déclaré périmé et hors du diff. |
| m1 : inventaire incomplet | minor, défaut bloquant | **résolu** | l. 59-71 : trois workflows ajoutés, chacun avec ses épingles (toutes lues), et une couverture de 11 (C7). l. 143 : 8 extractions, les 8 sites nommés concordent avec C8. |
| m2 : A2 tait la perte du manifeste | minor, défaut bloquant | **partiellement résolu** | l. 109 : la perte est dite, et `run-composition.py` doit recevoir le manifeste. Le coût de 7 fichiers (l. 111) ne compte ni l'appelant de ce script ni son autre consommateur : voir N1. |
| P1 : ce que signe la fusion | minor, preuve requise | **ouvert, par construction** | l. 3 inchangée : « proposed — aucune option n'est retenue ». Le corps de PR laisse la question au propriétaire. Voir plus bas. |
| m3 : friction de B sous-comptée | minor, suggestion | **résolu** | l. 125-129, 135, 164 : 87, 103 et 104, recalculés (C2 à C4), chacun avec sa commande. |
| m4 : « position de flotte » | minor, suggestion | **partiellement résolu** | Libellé corrigé (l. 86, 101, 163). Plage du test corrigée en `:143-152`, qui couvre bien le `test.each` jusqu'à sa fermeture. `work-package-ports.test.ts:460-469` est cité. Reste un compte de sites faux, et il vient du premier tour lui-même : voir N2. |
| m5 : attribution à #142 | minor, suggestion | **résolu** | l. 131 : « rend possible ». Le retrait est déclaré « inférence de l'issue #152 ». `refusals-exemptions.v1.json` est bien créé par #142 (`git show --diff-filter=A --name-only --format= e04890236623`). `ecosystem/refusals.v1.yaml` existait avant (`git cat-file -e e04890236623~1:ecosystem/refusals.v1.yaml`), et le texte ne dit pas le contraire. |
| n1 : « non mesuré » mesurable | non-blocking, suggestion | **résolu** | l. 36 : la mesure figure, avec ses commandes (C13, C14). |
| n2 : secrets d'A1 | non-blocking, suggestion | **résolu** | l. 30, 101, 105 (v), 163. L'hypothèse sur l'approbation des forks reste une hypothèse, déclarée comme telle (voir N6). |
| n3 : A2 + B étroit | non-blocking, suggestion | **résolu** | l. 119 : 30 et 19 recalculés (C5, C6). Une précision est en N8. |
| n4 : ruleset | non-blocking, suggestion | **résolu** | l. 29 et 145, recalculés (C15). |
| n5 : « base » et « branche servie » | non-blocking, suggestion | **résolu sur le fond ; l'énoncé contesté est tranché ci-dessous** | l. 47 : la note est ajoutée. |

### Arbitrage de n5 : l'objection de l'auteur

L'auteur objecte que seul `check-audit-delta.ts` lit la tête de la branche cible, et que `check-review-evidence.ts` et `check-pr-negatives.ts` lisent la merge base de `origin/<base>` avec la tête de PR. Les faits :

- `check-audit-delta.ts` fait `git fetch --depth=1 origin <base>` (`:157`) puis lit `FETCH_HEAD:bun.lock` et `FETCH_HEAD:package.json` (`:177`, `:207-208`). Il lit la tête de la branche cible. **L'auteur a raison.**
- `check-review-evidence.ts` diffe `origin/${baseRef}...HEAD` (`:358`). Le diff à trois points part de la merge base. `check-pr-negatives.ts` calcule `git merge-base origin/<base> HEAD` (`:858-861`) et y lit ses règles (`:870-873`). **L'auteur a raison** : l'énoncé du premier tour (« lisent `origin/<base>` …, c'est-à-dire la tête de la branche cible ») confondait les deux lectures pour ces deux gates.
- En revanche, le `HEAD` de ces deux appels n'est pas la tête de la PR : c'est la merge ref. Mesuré dans le run `pr-negatives` 40093348731 sur cette PR : `git checkout --progress --force refs/remotes/pull/158/merge` puis `HEAD is now at 7511ca0 Merge 30beb618… into 066ef494…`. La merge base de `origin/<base>` et de cette merge ref est son parent côté base, c'est-à-dire la tête de la branche cible au moment où GitHub a calculé la merge ref. Ce n'est pas le point de bifurcation de la tête de PR. Démonstration sur un dépôt jetable (`mktemp -d`, base `b1 → b2`, PR bifurquée en `b1`, merge ref `M` = fusion de la PR dans `b2`) : `merge-base(base, tête de PR) = b1`, `merge-base(base, merge ref) = b2`. Sur les 5 PR ouvertes, les deux merge bases coïncident aujourd'hui (`066ef49`), parce qu'aucune n'est en retard sur la base. L'écart n'est donc pas observé sur une PR vivante : il est établi par la mesure sur le dépôt jetable.

Conclusion : l'objection est fondée sur le code. Le libellé qui en est tiré (l. 47, « les deux autres lisent sa merge base avec la tête de la pull request ») est inexact, et sa propre conclusion (« la première lecture est donc aussi une lecture de la branche servie ») ne tient que parce que `HEAD` est la merge ref. Lue littéralement, la tête d'une PR en retard sur sa base donnerait le point de bifurcation, et la conclusion tomberait. Voir N3.

### P1 : preuve requise ouverte

Elle reste ouverte par construction : c'est une décision du propriétaire, que cette revue ne tranche pas. La revendication en cause n'a pas bougé. La ligne de statut (l. 3) ne dit pas ce que signerait la fusion, alors qu'`AGENTS.md:73` pose qu'« a doctrine merge is a signature ». Le recalcul (15 ADR `proposed` ou `proposé`, 12 dont la fusion vaut signature, 3 qui citent une approbation déjà rendue) ne change pas. Le plus petit contrôle qui la trancherait est toujours une ligne de statut qui nomme ce que la fusion signe, ou une consigne du propriétaire qui dit que la PR attend l'arbitrage.

## Nouveaux constats

Gravités du protocole ; dispositions selon ADR-0056 D2 (option A).

### N1 : minor, défaut bloquant. Le coût d'A2 ne compte pas l'appelant de `run-composition.py`

**Déclencheur.** l. 109 : « `run-composition.py` doit donc recevoir le manifeste de la pull request comme donnée, par un argument ». l. 111 : « Coût mesuré. 7 fichiers », liste qui ne contient ni `validate-composition.yml` ni `download-advisory-database.py`.

**Preuve reproduite.**
- Le seul appelant de `run-composition.py` est `066ef494ff33:.github/workflows/validate-composition.yml:74-76` et `:141-143` (`git grep -n "run-composition.py" 066ef494ff33 -- .github/workflows`). C'est donc ce fichier qui devrait passer l'argument. Il est absent de la liste, alors que la ligne du tableau (l. 40) le cite à `:58-65`, `:67-106` et `:138-143`.
- Dans ce job, la seule extraction est celle de l'outillage (`validate-composition.yml:58-65`). Avec `tooling_ref` à la base, rien dans ce job ne porte le manifeste de la PR avant la phase `prepare`. Le fichier doit donc aussi gagner une étape qui l'obtient.
- `066ef494ff33:.github/composition/download-advisory-database.py:16` charge `run-composition.py` comme module et appelle `runner.load_plan(target, revision)` (`:73`), qui lit `HERE / 'manifest.json'` (`run-composition.py:23`). Sans changement de ce fichier ou de la signature de `load_plan`, la base de données d'avis serait choisie sur le manifeste de la base, et la composition sur celui de la PR.

**Impact.** La forme prescrite (« par un argument ») implique au moins 8 fichiers, et 9 si `download-advisory-database.py` transmet l'argument. Le chiffre est présenté comme « mesuré » au propriétaire. C'est le même défaut que m2, que ce tour devait corriger : la correction est incomplète. Elle tient en une phrase et deux noms de fichiers. `validate-composition.yml` est aussi un `workflow_call` : son interface est un contrat.

### N2 : minor, suggestion. « Le seul site du dépôt qui en parle, avec son test »

**Déclencheur.** l. 86, avec la commande citée `git grep -n pull_request_target 066ef494ff33`.

**Preuve reproduite.** La commande renvoie trois fichiers : `.github/workflows/reusable-work-package-link.yml:17`, `tools/quality/reusable-work-package-link.test.ts:143` et `:147`, et `tools/quality/work-package-ports.test.ts:460`. La phrase suivante de l'ADR cite elle-même ce troisième fichier. L'erreur vient du premier tour : le constat m4 écrivait « n'apparaît qu'en deux sites », et l'amendement l'a reprise.

**Impact.** Contradiction interne sans effet sur la conclusion. Écrire « trois fichiers : le gabarit, son test, et un test de forme `pull_request_target` dans `work-package-ports.test.ts` ».

### N3 : non-blocking, suggestion. La merge base est prise avec la merge ref

l. 47 : remplacer « avec la tête de la pull request » par « avec le `HEAD` de l'extraction, la merge ref, c'est-à-dire son parent côté base ». Preuve en « Arbitrage de n5 ». La même précision vaut pour l. 131 (« Lire la surface à la merge base »).

### N4 : non-blocking, suggestion. `doctrine-governance` lit aussi `origin/<base>`

l. 61 : « ne lisent que l'arbre de la pull request avec le code de la pull request ». La ligne `doctrine-governance` du tableau (l. 66) dit pourtant que le workflow lit « le diff et le journal contre `origin/$GITHUB_BASE_REF` » (`doctrine-governance.yml:33-39` : `git fetch origin "$GITHUB_BASE_REF"`, `diff …...HEAD`, `log …..HEAD`). L'introduction est inexacte pour ce workflow, et la note de la l. 47 n'inclut pas cette quatrième lecture de même classe.

### N5 : non-blocking, suggestion. Phrase antérieure, non relevée au premier tour

l. 86 : « un drapeau inconnu ou un `--config=` vide ne l'arrête pas ; seul un répertoire de travail de confiance le fait ». La source dit aussi « a non-empty `--config` does stop it », et « `--no-env-file` alone does not stop the preload » (`066ef494ff33:.github/workflows/reusable-work-package-link.yml:43-46`). Elle retient le répertoire de confiance comme la protection sur laquelle s'appuyer, pas comme la seule qui arrête le `preload`. La phrase était déjà dans `95871c4` (l. 69). Le premier tour a déclaré que les 82 épingles disaient ce que l'ADR leur faisait dire, et c'était faux pour celle-ci. Écrire « le gabarit ne s'appuie que sur un répertoire de travail de confiance ».

### N6 : non-blocking, suggestion. `pull_request_target` s'exécute sur la branche par défaut

La documentation GitHub (« Events that trigger workflows », section `pull_request_target`) dit : « This event runs in the context of the default branch of the base repository ». Elle donne `GITHUB_SHA` = « Last commit on default branch » et `GITHUB_REF` = « Default branch ». L'ADR écrit « contexte de la base » et « lit le workflow de la base » (l. 101, 103). Ici, les deux coïncident : la branche par défaut est `migrate/recover-code`, et les 150 PR la visent. Une PR vers `main`, qui existe (`git ls-remote --heads … main`), serait jugée par le workflow de la branche par défaut. Fait documenté, non mesuré ici. La même consultation ne tranche pas l'hypothèse de la l. 163 : la page « Approving workflow runs from public forks » ne mentionne pas `pull_request_target`. L'hypothèse reste `unavailable` par la documentation, et la mesure sur dépôt jetable reste le contrôle.

### N7 : non-blocking, suggestion. Le relevé des 8 extractions n'est pas rejouable tel quel

l. 143 : « un `awk` cherche `persist-credentials: false` » ne donne pas la commande. Le comptage se reproduit avec celle de C8. Son périmètre, « workflows qui déclarent `pull_request:` », exclut `validate-composition.yml` (`workflow_call`, appelé sur `pull_request`). Son unique extraction (`:59-64`) a `persist-credentials: false` : le chiffre 8 n'en dépend pas.

### N8 : non-blocking, suggestion. A2 + B : « Le garde s'exécuterait toujours depuis la tête »

l. 119. Si B est porté par `check-review-evidence.ts`, qu'A2 déplace vers l'outillage de la base (l. 111), le code du garde s'exécute depuis la base. Ce qui reste à la tête, c'est le fichier de workflow qui l'invoque, et c'est précisément la surface gardée. La conclusion contre l'auteur hostile (l. 164) ne change pas. La phrase devrait dire « le workflow qui lance le garde reste celui de la merge ref ».

### R : non-blocking, prêt

Prêt, sur le périmètre revu :
- M1, m1, m3, m5, n1 à n5 : résolus (tableau de suivi) ;
- les 100 épingles résolvent. Les 19 nouvelles disent ce que l'ADR leur fait dire, sauf N2 ;
- tous les chiffres repris se recalculent à l'identique (tableau (b)) ;
- le texte ne prend toujours aucune décision au nom du propriétaire. Les deux questions finales (l. 167-170) restent indépendantes l'une de l'autre.

## Risques résiduels

- Le check requis `Bun quality` est vert sur `30beb618` parce que le corps de la PR cite un dossier sous `docs/reviews/`. `check-review-evidence.ts` admet toute référence à un artefact sous `docs/reviews/` (`066ef494ff33:tools/quality/check-review-evidence.ts:24-27`), quel que soit son verdict, et le dossier cité rend `reject`. Un vert de ce check ne dit donc pas qu'une revue favorable existe. C'est hors du diff de l'ADR, et c'est l'objet de l'issue #160. La ligne `Verdict:` en tête de ce dossier sert ce suivi.
- Deux comportements de GitHub restent non mesurés, comme l'ADR le déclare : la résolution entre deux checks de même contexte, et le rattachement d'un run `pull_request_target` au contexte requis. L'hypothèse sur la politique d'approbation des forks reste non vérifiée (N6).
- Les secrets d'organisation sont `unavailable` (HTTP 403, portée `admin:org`).
- L'écart entre merge base « tête de PR » et merge base « merge ref » est établi sur un dépôt jetable. Il n'est observé sur aucune PR vivante : les 5 PR ouvertes sont à jour de leur base.
- Les mesures volatiles (runs, ruleset, nombre de commits, PR) datent du 2026-10-24 et sont à rejouer avant tout arbitrage.
- Aucun gate n'a été exécuté localement. Les verdicts de CI cités sont ceux de GitHub Actions.

## Verdict

**`reject`** sur le commit `30beb618257d0fcd1b7e86de49e72d0d9ca5fb6e`.

Motif : la preuve requise P1 reste ouverte. Selon ADR-0056 D2, clause 3, ni `approve` ni `approve-with-minor-reservations` n'admettent une preuve requise ouverte. S'y ajoute un défaut bloquant `minor` ouvert (N1), qui est la correction incomplète de m2. M1, le seul `major` du premier tour, est résolu. Une fois N1 corrigé, l'issue ne dépend plus que de la décision du propriétaire sur P1, puis d'une passe fraîche à partir de ce commit.

Ce verdict n'est pas une approbation de promotion par rôle.
