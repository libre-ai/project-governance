Verdict: approve

# Revue, cinquième tour : ADR-0060, les gates s'exécutent depuis la PR qu'ils jugent

**Date :** 2026-10-26
**Objet :** pull request #158, ADR-0060 au statut `proposed` (issue #152), après l'application de Q1 à Q4 (`REVIEW-ROUND-4.md`, verdict `approve` sur `876d64c`), que le propriétaire a demandée avant la fusion.
**Nature :** passe de revue seule, mode `candidate-integration`, cinquième tour, sur un commit immuable. Le relecteur n'est pas l'auteur et n'a rien modifié.

## Enregistrement de la passe

- `reviewPassId` : `rp-adr0060-2bfd7ca36676-candidate-integration-r5`
- rôle et mode : `candidate-integration`, aucun rôle spécialisé du catalogue
- commit revu : `2bfd7ca366761036e89d60398b6e67265bd749db`, tête de `work/adr-proposed-gates-run-from-pr-2026-10-24` (`gh pr view 158 -R libre-ai/project-governance --json headRefOid --jq .headRefOid`)
- dernier head revu, point de départ de la re-revue (ADR-0056 D2) : `876d64cc8a9ad6a7230617124b8da263086451de`
- base : `ac0d68e2ff18e97d83b9c5df7b38343c338bdb74`, tête de `migrate/recover-code`, branche servie (`git ls-remote --symref https://github.com/libre-ai/project-governance HEAD`). Elle est intégrée par la fusion `2bfd7ca`.
- commits revus depuis `876d64c` :
  - `48f0087` ajoute `REVIEW-ROUND-4.md` (196 lignes), seul fichier du commit ;
  - `2cad825` modifie l'ADR (6 insertions, 6 suppressions) ;
  - `2bfd7ca` est la fusion de la base `ac0d68e` (#155).
- diff de la PR contre la nouvelle base (`git diff --stat ac0d68e HEAD`) : 6 fichiers, à savoir l'ADR, les quatre dossiers de revue et `tools/quality/pinned-citations.v1.json`. Aucun fichier sous `tools/` ni `.github/` n'a changé depuis `876d64c` (`git diff 876d64c 2bfd7ca -- tools/ .github/` : 0 ligne).
- SHA-256 (`shasum -a 256 <fichier>`) :
  - `docs/adr/0060-gates-run-from-the-pull-request-they-judge.md` : `9e21f7c859ee2f81f6f93b3d96ce556459371359960c2b855da4f6a7fa694819`
  - `REVIEW-ROUND-4.md` : `8b6fa74a75edc4d6d61a4356e660304f7a68d4ccdd1f1ff3c9aeb3a5dfb30c7e`
- aucun contrat ni vecteur n'est touché
- agent : Claude Code, sous-agent de revue ; modèle `claude-opus-5-5` (Claude Opus 5.5) ; le harnais n'expose pas d'identifiant de session
- clone de lecture propre avant et après la passe (`git status --short` : 0 ligne)

Ce verdict **n'est pas une approbation de promotion par rôle**. Il ne remplace aucun rôle de `contracts/catalog.v1.json` et ne change l'état d'aucune autorité.

## Ce qui a été rejoué, et comment

~~~sh
mkdir -p "$TMPDIR/scratch" && S=$(mktemp -d "$TMPDIR/scratch/x.XXXXXX")
git clone https://github.com/libre-ai/project-governance "$S/pg"
git -C "$S/pg" fetch origin pull/158/head
git -C "$S/pg" checkout --detach FETCH_HEAD       # -> 2bfd7ca36676…
git -C "$S/pg" diff -U0 876d64c 2bfd7ca -- docs/adr/ | grep '^@@'
git -C "$S/pg" diff --word-diff=porcelain 876d64c 2bfd7ca -- docs/adr/
~~~

### (a) Seules les lignes de Q1 à Q4 ont changé

Le diff de l'ADR compte 6 hunks, aux l. 8, 48, 88, 112, 135 et 144, et aucun autre :

| Ligne | Avant | Après |
| --- | --- | --- |
| 8 (Q4) | « 0059 est laissé à l'amendement d'ADR-0056 rédigé en parallèle. » | « 0059 est l'amendement d'ADR-0056, rédigé en parallèle et fusionné par #156. » |
| 48 (Q2) | `…check-audit-delta.ts:121-157` | `…check-audit-delta.ts:121-157,177,207-208` |
| 88 (Q3) | deux commandes sur `origin/migrate/recover-code` | les deux sur `066ef494ff33` |
| 112 (Q1) | « Sa seule extraction » | « La seule extraction de `validate-composition.yml` » |
| 135 (Q3) | deux commandes sur `origin/migrate/recover-code` | les deux sur `066ef494ff33` |
| 144 (Q3) | une commande sur `origin/migrate/recover-code` | sur `066ef494ff33` |

Les l. 120, 143 et 145, que Q3 nommait, ne portent aucune commande. La l. 143 renvoie à la commande ci-dessus, la l. 145 à « même commande ». La l. 120 est la ligne `ci.yml` de la liste des coûts : le Q3 du quatrième tour la citait à tort.

### (b) L'épingle élargie

`066ef494ff33:tools/quality/check-audit-delta.ts:121-157,177,207-208` :

- `:121-157` résout la base et la récupère (`:157`, `git fetch --quiet --depth=1 origin <base>`) ;
- `:177` lit `git rev-parse FETCH_HEAD` ;
- `:207` lit `git show FETCH_HEAD:bun.lock` ;
- `:208` lit `git show FETCH_HEAD:package.json`.

Résolution mécanique des citations locales avec la boucle du second tour : `resolved=106 failed=0`. Le gate local, exécuté avec l'état redirigé sous `$S/home` et Bun 1.4.4, rend `rc=0` : « 226 assertion(s) hold — 27 pinned citation(s) examined … = 23 resolved + 4 exempted (with reason) + 0 failed … 5 exemption(s) declared, 5 matched … local pins …: 161 examined = 160 resolved + 1 exempted (with reason) + 0 failed ».

### (c) Comptages rejoués mot à mot depuis l'ADR

Chaque commande `git log`, `git grep` ou `git show` de l'ADR a été extraite du texte et exécutée telle quelle dans le clone :

| Ligne | Attendu par l'ADR | Obtenu |
| --- | --- | --- |
| 37 | `066ef49` | `066ef49` |
| 72 | 11 | 11 |
| 88 | 146 | 146 |
| 88 | 87 | 87 |
| 135 | 30 | 30 |
| 135 | 19 | 19 |
| 144 | 103 | 103 |
| 145, « même commande » plus les trois chemins | 104 | 104 |
| 167, entrées du registre | 24 | 24 |

~~~sh
F=docs/adr/0060-gates-run-from-the-pull-request-they-judge.md
grep -noE '`git (log|grep|show) [^`]+`( → [^ ;,)]+)?' "$F" \
  | while IFS= read -r line; do
      cmd=$(printf '%s' "${line#*:}" | sed -E 's/^`([^`]+)`.*/\1/')
      bash -c "$cmd"
    done
~~~

Commandes `gh` de comptage rejouées :

| Ligne | Attendu | Obtenu |
| --- | --- | --- |
| 28 | six contextes | 6 |
| 31 | 0 | 0 |
| 33 | `{"false":100}` | `{"false":100}` |
| 37 | 2026-10-23T20:19:37Z | identique, 59 runs en tout |
| 48 | lignes `pull/158/merge` | 4 |
| 112 | 14 | 14 |
| 167 | `{"failure":3,"success":27}` | `{"failure":3,"success":27}` |

Recherche de références mobiles dans les commandes (`origin/…`, `HEAD`, `--branch`, `refs/heads/`) :

- l. 27 : `git ls-remote --symref … HEAD`. Elle figure dans la liste « Faits volatils, à rejouer avant usage », donc ce n'est pas un défaut.
- l. 80-83, 48 : `HEAD:` y décrit le comportement des gates, ce ne sont pas des commandes de comptage.
- l. 83 : un `grep` sur l'arbre de travail (S1).
- l. 33 et 167 : deux fenêtres sur des listes qui avancent (S2).

### (d) `REVIEW-ROUND-4.md` est identique au bloc rendu

Le bloc du quatrième tour, recopié dans le répertoire de travail, et le fichier déposé : 196 lignes et 17 386 octets chacun, `cmp` sans écart. Le fichier contient sept occurrences d'un gabarit de commit entre chevrons, qu'aucun motif de citation du gate ne reconnaît. Le gate passe donc sans nouvelle exemption (b).

### (e) La fusion de la base n'apporte que le fichier de #155

- `git diff --stat a5cd2b4 ac0d68e` et `git diff --stat 2bfd7ca^1 2bfd7ca` : un seul fichier, `skills/pr-body/SKILL.md` (55 insertions, 13 suppressions).
- Arbre recalculé : `git merge-tree --write-tree 2cad825 ac0d68e` donne `fe64da0d9d04…`, identique à l'arbre de `2bfd7ca`.
- Le message porte le trailer `Signed-off-by:`. Le commit n'est pas signé cryptographiquement (`gh api repos/libre-ai/project-governance/commits/2bfd7ca --jq .commit.verification.reason` donne `unsigned`), pas plus que `48f0087` et `2cad825`.
- La skill n'est citée par aucune affirmation de l'ADR.

## Suivi des constats du quatrième tour

| Constat | Gravité, disposition au tour 4 | État | Preuve |
| --- | --- | --- | --- |
| Q1 : « Sa seule extraction » | non-blocking, suggestion | **résolu** | l. 112 (a) |
| Q2 : plage de l'épingle | non-blocking, suggestion | **résolu** | l. 48 (b) |
| Q3 : comptages sur la branche servie | non-blocking, suggestion | **résolu** | l. 88, 135, 144 sur `066ef494ff33` ; rejoués à l'identique (c) |
| Q4 : ligne « Numéro » | non-blocking, suggestion | **résolu** | l. 8 (a) |

La ligne de statut (l. 3) et la ligne d'arbitrage (l. 4) ne sont pas touchées par ce diff. Le jugement du quatrième tour sur `d045e11` reste valable : `tools/quality/pinned-citations.v1.json` n'a pas changé (diff vide sous `tools/`).

## Nouveaux constats

Gravités du protocole ; dispositions selon ADR-0056 D2 (option A).

### S1 : non-blocking, suggestion. Le relevé des lecteurs de flotte lit l'arbre de travail

l. 83 : `grep -lE 'HEAD:|contents/|git/trees|"clone"' ecosystem/check-*.ts ecosystem/fleet-tree.ts | grep -v test` lit les fichiers extraits, et non `066ef494ff33`. Il donne aujourd'hui 11, comme l'ADR. Il cessera de le donner dès qu'un fichier `ecosystem/check-*.ts` changera. La forme épinglée donne le même nombre :

~~~sh
git grep -lE 'HEAD:|contents/|git/trees|"clone"' 066ef494ff33 -- 'ecosystem/check-*.ts' ecosystem/fleet-tree.ts | grep -v test | wc -l   # 11
~~~

### S2 : non-blocking, suggestion. Deux fenêtres glissantes

- l. 33 : « les 100 dernières pull requests fusionnées » (`gh pr list --state merged --limit 100`).
- l. 167 : « les 30 derniers runs `push` » (`gh run list … --limit 30`).

Les deux redonnent aujourd'hui les chiffres de l'ADR, mais leur contenu a changé. Trois runs `push` sont entrés depuis la mesure : `0fb4a46d813c`, `a5cd2b468058` et `ac0d68e2ff18`, tous `success`. La l. 167 cessera de donner trois rouges quand les runs de la fenêtre #141 → #151 en sortiront. Les deux formes bornées à la date de la mesure sont mesurées et rendent les mêmes chiffres :

~~~sh
gh run list -R libre-ai/project-governance --workflow inventory-drift.yml \
  --branch migrate/recover-code --event push --created '<=2026-10-24T08:28:08Z' \
  --limit 30 --json conclusion \
  --jq '[.[]|.conclusion]|group_by(.)|map({(.[0]): length})|add'
# -> {"failure":3,"success":27}, premier run à 066ef494ff33
gh pr list -R libre-ai/project-governance --state merged \
  --search 'merged:<=2026-10-24T08:28:06Z' --limit 100 --json isCrossRepository \
  --jq '[.[]|.isCrossRepository]|group_by(.)|map({(.[0]|tostring): length})|add'
# -> {"false":100}
~~~

La l. 37 (`--limit 200`, tri par date) reste exacte tant que le workflow compte moins de 200 runs : il en a 59.

### R : non-blocking, prêt

Prêt, sur le périmètre revu :

- Q1 à Q4, résolus, sans autre changement dans l'ADR ;
- 106 citations locales résolues, dont l'épingle élargie ;
- tous les comptages rejoués mot à mot redonnent les chiffres de l'ADR ;
- `REVIEW-ROUND-4.md` est identique au bloc rendu ;
- la fusion n'apporte que `skills/pr-body/SKILL.md` ;
- aucune option n'est retenue au nom du propriétaire.

## État de la CI

`gh pr checks 158 -R libre-ai/project-governance` : 13 checks, tous `pass`, sur 12 runs à `2bfd7ca` (`{"success":12}`).

- Les six requis : `composition / validate`, `Composed targets pass the manifest gates of their composed governance`, `Door declaration`, `Bun quality`, `Every pinned code citation of the documents resolves`, `Negatives declaration`.
- Les autres : `Doctrine governance` (deux fois), `Licensing and contribution governance`, `Index freshness and GitHub reconciliation`, `Every repository's AGENTS.md matches its layer's template`, `No private identifiers or machine-local paths`, `Regenerate evidence feeds and fail on drift`.

## Risques résiduels

- **La décision du propriétaire sur P1 n'est vérifiée par aucun instrument de cette revue.** Elle est relayée par la session de coordination. Sa confirmation est la fusion par le propriétaire (`AGENTS.md:73`).
- **L'exemption de `d045e11` couvre toutes les occurrences de son texte dans `REVIEW-ROUND-3.md`** (mesure M3 du quatrième tour).
- **Le vert du check de citations requis dépend d'une donnée que la PR modifie.** C'est la classe mesurée par l'ADR, et la garde reste la revue.
- **`Bun quality` admet toute référence sous `docs/reviews/`, quel que soit son verdict.** C'est l'issue #160.
- **Comportements de GitHub non mesurés.** Deux comportements restent non mesurés, et l'hypothèse sur l'approbation des forks n'est pas vérifiée. C'est la condition que signe la fusion.
- **Absence de signature cryptographique.** Aucun des commits revus n'est signé cryptographiquement. Ils portent un trailer DCO.
- **Mesures volatiles.** Les mesures volatiles datent du 2026-10-26, et S2 décrit lesquelles dérivent.

## Verdict

**`approve`** sur le commit `2bfd7ca366761036e89d60398b6e67265bd749db`.

Motif :

- Q1 à Q4, que le propriétaire a demandées avant la fusion, sont résolues sans autre changement.
- Aucun constat `blocking`, `major` ni `minor` n'est ouvert, et aucune preuve requise ne l'est.
- S1 et S2 sont des suggestions qui ne conditionnent pas la fusion (ADR-0056 D2).

La fusion reste l'acte explicite du propriétaire (protocole, « Candidate integration »).

Ce verdict n'est pas une approbation de promotion par rôle.
