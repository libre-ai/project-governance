# Revue — ADR-0060, les gates s'exécutent depuis la PR qu'ils jugent

**Date :** 2026-10-24
**Objet :** pull request #158, ADR-0060 au statut `proposed` (issue #152).
**Nature :** passe de revue seule, mode `candidate-integration`, sur un
commit immuable. Le relecteur n'est pas l'auteur et n'a rien modifié.

## Enregistrement de la passe

- `reviewPassId` : `rp-adr0060-95871c4bf486-candidate-integration`
- rôle et mode : `candidate-integration` (aucun rôle spécialisé du catalogue)
- commit revu : `95871c4bf486d20702826a48afb734d68f7d3481`, tête de la
  branche `work/adr-proposed-gates-run-from-pr-2026-10-24`
  (`gh pr view 158 -R libre-ai/project-governance --json headRefOid`)
- base : `066ef494ff33261e2c61cd7affe880b503dc3fe5`, tête de
  `migrate/recover-code` au moment de la revue, et merge base de la PR
  (`git merge-base HEAD origin/migrate/recover-code`)
- diff revu : un seul fichier, 147 lignes ajoutées
  (`git diff --stat 066ef494ff33 HEAD`)
- SHA-256 du fichier revu
  `docs/adr/0060-gates-run-from-the-pull-request-they-judge.md` :
  `75b22fbc858c6e79b04e42251fc6fc491419c73eb753a003aed769ff3ecaf328`
  (`shasum -a 256 <fichier>`) ; aucun contrat ni vecteur n'est touché
- agent : Claude Code, sous-agent de revue ; modèle `claude-opus-5-5`
  (Claude Opus 5.5) ; identifiant de session non exposé par le harnais
- arbre de travail propre avant et après la passe (`git status --short` :
  0 ligne)

Ce verdict **n'est pas une approbation de promotion par rôle** : il ne
remplace aucun rôle de `contracts/catalog.v1.json` et ne change l'état
d'aucune autorité.

## Ce qui a été rejoué, et comment

Clone neuf, tête de la PR extraite en détaché :

```sh
D=$(mktemp -d)
git clone https://github.com/libre-ai/project-governance "$D/pg"
git -C "$D/pg" fetch origin pull/158/head
git -C "$D/pg" checkout --detach 95871c4bf486d20702826a48afb734d68f7d3481
git -C "$D/pg" ls-remote --symref \
  https://github.com/libre-ai/project-governance HEAD
# -> ref: refs/heads/migrate/recover-code ; 066ef494ff33… HEAD
```

Les citations ont été lues à `066ef494ff33`
(`git -C "$D/pg" checkout --detach 066ef494ff33`).

### (a) Citations épinglées

L'ADR porte 82 épingles distinctes :

```sh
grep -oE '[0-9a-f]{12}:[A-Za-z0-9._/-]+(:[0-9,-]+)?' \
  docs/adr/0060-gates-run-from-the-pull-request-they-judge.md \
  | sort -u | wc -l
```

Les 82 ont été lues, pas seulement échantillonnées. Toutes résolvent, et
chacune dit ce que l'ADR lui fait dire. C'est vrai aussi de celles qui
portent une option ou la recommandation :
`reusable-work-package-link.yml:13-20`, `:35-48`, `:81-96` et `:112-119` ;
son test, `:143-147` ; `check-review-evidence.ts:28-38` et `:94-117` ;
`check-pr-negatives.ts:115-118` ; `code-validation.yml:16` ;
`pinned-citations.yml:11-15` ;
`0fe0a6371c01:tools/quality/check-pr-door.ts:258`.

Exception unique : `066ef494ff33:.github/workflows/pinned-citations.yml:11-15`
est cité fidèlement, mais ce que ce commentaire affirme n'est plus vrai
(constat M1).

### (b) Tableau des six checks requis, recalculé

```sh
gh api repos/libre-ai/project-governance/rules/branches/migrate%2Frecover-code \
  --jq '[.[]|select(.type=="required_status_checks")
        |.parameters.required_status_checks[]]'
```

Six contextes, tous `integration_id` 15368, tous du ruleset `24161111`
(`forge-reviewed-recovery-admission`, `bypass_actors: []`,
`current_user_can_bypass: never`). Recalcul depuis les workflows :

| Contexte | Job, fichier | Extraction garde le jeton | Exécute la PR |
| --- | --- | --- | --- |
| `composition / validate` | `composition` → `validate` | non (`:64`) | oui |
| `Composed targets…` | `coherence`, generation-coherence | non (`:51`) | oui |
| `Door declaration` | `door`, pr-door | **oui** (`:32`) | oui |
| `Bun quality` | `bun-quality`, ci | **oui** (`:158`) | oui |
| `Every pinned code…` | `pinned-citations` | non (`:56`) | oui |
| `Negatives declaration` | `negatives`, pr-negatives | non (`:38`) | oui |

Les colonnes « lu à la base » et « lu à la branche servie » de l'ADR
(ADR-0060, l. 39-44) se vérifient ligne à ligne. Les constats 1 à 3 qui en
découlent (l. 48-50) sont exacts. Le décompte « neuf gates sur
`pull_request` » (l. 62) se vérifie : `inventory-drift.yml:72-134` porte neuf
étapes `bun ecosystem/check-*.ts`, et Dependabot est gardé par
`github.event_name == 'schedule' || … 'workflow_dispatch'` (`:155`).

Mesures de contexte rejouées à l'identique :

- `gh api repos/libre-ai/project-governance/actions/permissions/workflow` →
  `default_workflow_permissions: read`,
  `can_approve_pull_request_reviews: false`
- `…/actions/permissions/fork-pr-contributor-approval` →
  `{"approval_policy":"first_time_contributors"}`
- ruleset, règle `pull_request` : `required_approving_review_count: 0`

### (e) Chiffres porteurs

| Chiffre de l'ADR | Recalcul | Commande |
| --- | --- | --- |
| 146 commits depuis 2026-09-24 | 146 | C1 |
| 87 touchent la surface d'un gate | 87 | C2 |
| 100/100 PR depuis une branche du dépôt | `{"false":100}` | C3 |
| 11 fichiers lecteurs de flotte | 11 | C4 |
| #141 06:21Z, #151 08:18Z | `06:21:47Z`, `08:18:30Z` | C5 |
| #142 06:33Z, #154 08:23Z | `06:33:45Z`, `08:23:42Z` | C5 |

```sh
# C1
git log --since=2026-09-24 --format=%H origin/migrate/recover-code | wc -l
# C2
git log --since=2026-09-24 --format=%H origin/migrate/recover-code -- \
  tools .github 'ecosystem/*.ts' package.json bun.lock bunfig.toml | wc -l
# C3
gh pr list -R libre-ai/project-governance --state merged --limit 100 \
  --json isCrossRepository \
  --jq '[.[]|.isCrossRepository]|group_by(.)
        |map({(.[0]|tostring): length})|add'
# C4 (à 066ef494ff33)
grep -lE 'HEAD:|contents/|git/trees|"clone"' \
  ecosystem/check-*.ts ecosystem/fleet-tree.ts | grep -v test | wc -l
# C5
gh pr view <n> -R libre-ai/project-governance --json mergedAt
```

Mesure complémentaire : sur toutes les PR du dépôt, et pas seulement les 100
dernières fusionnées, aucune ne vient d'un fork, `{"false":149}`
(`gh pr list -R libre-ai/project-governance --state all --limit 1000
--json isCrossRepository`).

Les deux incidents du cas inverse se vérifient en CI. Pour #141 → #151, le
run `push` d'`inventory-drift` sur `0fe0a6371c01` est rouge sur la seule
étape « No raw-SQL construction outside the reviewed allowlist », et le run
`pull_request` sur la tête de #141 est vert. Pour #142 → #154,
`context-conformance` est rouge en `push` sur `e04890236623` et vert sur la
tête de #142. `AGENTS.md` y compte 81 lignes (`git show e04890236623:AGENTS.md
| wc -l`).

## Constats

Gravités du protocole. Les dispositions suivent ADR-0056 D2 (option A,
arbitrée le 2026-10-23).

### M1 — major — défaut bloquant : la prémisse de l'option D est fausse

**Déclencheur.** ADR-0060, l. 128 : « le reste de `inventory-drift` est rouge
en connaissance de cause et ne peut pas être requis », avec pour seule preuve
le commentaire `pinned-citations.yml:11-15`.

**Preuve reproduite.** Le run `push` d'`inventory-drift` sur `066ef494ff33`,
le commit même que l'ADR épingle, est vert : ses neuf étapes `pull_request`
sont en `success`, et Dependabot est `skipped` (`gh run view 40078154723
--json jobs`). Sur les 30 derniers runs `push` de la branche servie, 27 sont
verts et 3 rouges (`gh run list --workflow inventory-drift.yml --branch
migrate/recover-code --event push --limit 30 --json conclusion`). Les 3
rouges sont `0fe0a6371c01`, `e04890236623` et `116b22bd6b0e`, soit la
fenêtre #141 → #151 : le défaut que D traite, et non un rouge connu. La PR
#158 elle-même est verte sur ce job.

**Impact.** L'option D écarte la solution « rendre `inventory-drift` requis
tel quel » sur un fait daté qui ne tient plus. Elle ne donne pas le vrai
motif de ne pas le requérir : son verdict dépend des branches servies de 23
autres dépôts, qu'aucune PR de ce dépôt ne contrôle. Les conclusions de D
peuvent survivre avec ce motif, mais le texte doit le dire et retirer le
fait périmé. Le commentaire `pinned-citations.yml:11-15` est périmé lui
aussi : il relève de la même classe, hors du diff de cette PR.

### m1 — minor — défaut bloquant : inventaire incomplet pour la portée déclarée

**Déclencheur.** Portée de l'ADR : « les workflows de ce dépôt qui jugent une
pull request, requis ou non » (l. 6). Le commit `95871c4` s'intitule « cites
every checkout that keeps its token ».

**Preuve reproduite.** Trois workflows tournent sur `pull_request` et
n'apparaissent nulle part dans l'ADR :
`066ef494ff33:.github/workflows/context-hygiene.yml:13` (« No private
identifiers or machine-local paths »,
`bash tools/quality/check-context-hygiene.sh`, `:27`),
`066ef494ff33:.github/workflows/doctrine-governance.yml:14` (numérotation et
arbitrage des ADR, `:48`) et
`066ef494ff33:.github/workflows/feeds-freshness.yml:17`. Les trois
extraient sans `persist-credentials: false` (`context-hygiene.yml:24`,
`doctrine-governance.yml:25`, `feeds-freshness.yml:32`). Parmi les
workflows `pull_request`, 8 extractions gardent le jeton et l'ADR en cite 5
(l. 120). Relevé : un `awk` sur chaque `actions/checkout@` des
`.github/workflows/*.yml`, avec recherche de `persist-credentials: false`
avant l'étape suivante.

**Impact.** Pour les checks requis, aucune conclusion ne change : les trois
workflows omis sont non requis, en `contents: read`. Mais l'en-tête et le
commit revendiquent l'exhaustivité. Le garde de contexte, qui sert à
l'isolement, est lui-même modifiable par la PR qu'il juge. L'ADR doit soit
ajouter ces trois lignes, soit restreindre sa portée.

### m2 — minor — défaut bloquant : A2 tait la perte du manifeste de la PR

**Déclencheur.** ADR-0060, l. 92 : pour `composition / validate`,
« `tooling_ref` vaut le sha de base au lieu de `github.sha` ».

**Preuve reproduite.** `run-composition.py` lit `manifest.json` à côté de
son script (`066ef494ff33:.github/composition/run-composition.py:15`,
`:23`), donc dans l'outillage. Avec `tooling_ref` à la base, ce check compose
les autres dépôts aux refs du manifeste **de la base** : une PR qui change
`manifest.json` n'est plus composée telle qu'elle la déclare. Le tableau de
l'ADR énonce lui-même cette lecture (l. 39). Pour `generation-coherence.yml`,
A2 précise « manifeste de la pull request lu comme donnée » (l. 94), mais
rien d'équivalent n'est dit pour `code-validation.yml`.

**Impact.** Telle qu'elle est écrite, A2 rouvrirait dans ce check la classe
de D : la modification de la PR n'est plus vue. La correction tient en une
phrase, avec un fichier de plus : `run-composition.py` doit recevoir le
manifeste de la PR comme donnée.

### P1 — minor — preuve requise : ce que signe la fusion de cet ADR

**Revendication en cause.** Le statut porte « proposed — aucune option n'est
retenue » (l. 3). Or `AGENTS.md:73` pose qu'« a doctrine merge is a
signature ». À `066ef494ff33`, 15 ADR portent le statut `proposed` ou
`proposé` (`grep -m1 Statut` sur chaque `docs/adr/*.md`). Pour 12 d'entre
eux, la ligne de statut dit que leur fusion vaut arbitrage ou signature.
Les 3 autres (0033, 0035, 0047) citent une approbation du propriétaire déjà
rendue. Aucun n'est fusionné « sans option retenue ». ADR-0056 a été
arbitré en place avant sa fusion (« Options arbitrées le 2026-10-23 »).
ADR-0060 ne dit pas ce que signerait sa fusion. Ce peut être la mesure
seule et la mise à l'écart conditionnelle d'A1 (l. 140), ou rien, auquel
cas la PR attend l'arbitrage et l'ADR est amendé.

**Plus petit contrôle qui trancherait.** Une ligne de statut qui nomme ce
que la fusion signe, ou une consigne du propriétaire. C'est une décision de
périmètre que cette revue ne peut pas prendre. Le corps de la PR annonce un
`Bun quality` rouge « until the owner decides », ce qui penche pour la
seconde lecture.

### m3 — minor — suggestion : la friction de B est sous-comptée

La surface de B (l. 104) inclut « les `ecosystem/*.ts` et leurs données »,
mais le décompte 87/146 ne compte pas ces données. En ajoutant les cinq
fichiers de données de gate d'`ecosystem/` (`repositories.v1.yaml`,
`fleet-pins.v1.yaml`, `sql-construction-allowlist.v1.yaml`,
`web-headers-allowlist.v1.yaml`, `release-age-exceptions.v1.yaml`), on
obtient **103/146**. En ajoutant aussi le code de gate hors de `tools/` et
d'`ecosystem/` (`crates/ecosystem-engine/scripts`, lancé par
`check:vendored` et `check:patch-rev` ; `distribution/*.ts`, lancé par
`feeds-freshness.yml` ; `brand/*.ts`, lancé par `check:brand`), on obtient
**104/146** (même `git log` avec ces chemins). Ce décompte renforce la
conclusion de l'ADR au lieu de l'affaiblir. Il reste à aligner le libellé
sur la commande, ou la commande sur la surface décrite.

### m4 — minor — suggestion : « position de flotte » surestime la portée

L'argument pèse dans la mise à l'écart d'A1 (l. 69, 84, 140). À
`066ef494ff33`, `pull_request_target` n'apparaît qu'en deux sites, et le
second n'est que le test du premier (`git grep -n pull_request_target
066ef494ff33`) : le commentaire du gabarit réutilisable du lien de work
package, et son test. Ce test vérifie que le gabarit ne déclare pas
lui-même `pull_request_target`, et pas davantage `pull_request` ni `push`
(`reusable-work-package-link.test.ts:146-150`). Il ne teste aucune position
de flotte. Le refus visant les appelants n'est qu'un commentaire. Par
ailleurs, `066ef494ff33:tools/quality/work-package-ports.test.ts:460-469`
teste déjà une extraction « de forme `pull_request_target` ». La
recommandation tient sur ses deux autres motifs : les deux comportements
non mesurés et l'exécution dans le contexte de la base. Le libellé devrait
dire « position du gabarit du lien de work package ».

### m5 — minor — suggestion : attribution à #142 trop forte

L. 108 : « une pull request peut retirer un chemin de la surface dans la
même pull request qui modifie ce chemin, ce que #142 a observé ». Ce que
#142 montre, c'est une surface lue à la tête : elle **ajoute**
`ecosystem/refusals.v1.yaml` et `tools/quality/refusals-exemptions.v1.json`
à `GATED_PATH_PATTERNS` (`git show e04890236623 --
tools/quality/check-review-evidence.ts`). Le retrait est une inférence,
formulée par l'issue #152. Écrire « ce que #142 rend possible » serait
exact.

### n1 — non-blocking — suggestion : un « non mesuré » peut devenir mesuré

L. 35 : « le fichier de workflow lui-même est lu à cette merge ref
(comportement documenté par GitHub, non mesuré ici) ». La mesure existe dans
ce dépôt. `pr-negatives.yml` a été ajouté par #144, fusionnée le
2026-10-24T08:28:06Z
(`git log --diff-filter=A -- .github/workflows/pr-negatives.yml`).
Il a pourtant tourné en `pull_request` dès 2026-10-23T20:19:37Z sur
`work/pr-negatives-gate-2026-10-23`, avant d'exister à la base
(`gh run list --workflow pr-negatives.yml --limit 200 --json
createdAt,event,headBranch`). Le même fait montre la moitié du constat 3 :
un job ajouté par une PR émet un check de contexte requis.

### n2 — non-blocking — suggestion : mesurer les secrets exposés par A1

A1 évoque « ses secrets » (l. 84). Le dépôt porte 0 secret Actions
(`gh api repos/libre-ai/project-governance/actions/secrets --jq
.total_count` → `0`). Les secrets d'organisation restent `unavailable` : la
même requête au niveau de l'organisation répond HTTP 403 avec ce jeton.
Seuls `org-readme-drift.yml` et `fleet-bump.yml` lisent `secrets.`, et aucun
des deux ne tourne sur `pull_request`. Une **hypothèse**, non vérifiée ici
faute d'accès à la documentation : la politique d'approbation des forks ne
s'appliquerait pas à `pull_request_target`. Elle est à ajouter aux deux
mesures prévues sur le dépôt jetable.

### n3 — non-blocking — suggestion : une combinaison non chiffrée, A2 + B étroit

A2 laisse le contournement délibéré passer par `.github/workflows/`, que
l'ADR dit « visible au diff » (l. 100). Un B restreint à ce seul répertoire
le rendrait fermé par défaut, pour une friction de 30 commits sur 146
(`git log --since=2026-09-24 … -- .github/workflows | wc -l`), et de 19 sur
146 pour les sept fichiers des checks requis. Les options gagneraient à
chiffrer cette combinaison.

### n4 — non-blocking — suggestion : précisions sur le ruleset

L. 29 : `strict_required_status_checks_policy` appartient à la règle
`required_status_checks`, pas à la règle `pull_request`. La règle
`pull_request` porte aussi `required_review_thread_resolution: true`, ce
qui concerne directement l'option C, « la revue humaine comme seule garde ».

### n5 — non-blocking — suggestion : « base » et « branche servie »

`check-review-evidence.ts:346-358`, `check-pr-negatives.ts:852-877` et
`check-audit-delta.ts:121-157` lisent `origin/<base>` au moment du run,
c'est-à-dire la tête de la branche cible. Ils ne lisent pas
`pull_request.base.sha`, que lisent `generation-coherence.yml:73` et
`ci.yml:233`. Pour une PR vers `migrate/recover-code`, la colonne « lu à la
base » est donc aussi une lecture de la branche servie. Une note sous le
tableau suffirait.

### R — non-blocking — prêt

Sont prêts, sur le périmètre revu :

- (a) les citations ;
- (b) le tableau des six checks et ses trois constats ;
- (e) les chiffres porteurs, hors m3 ;
- (c) la mise en garde sur `pull_request_target`. Elle est complète sur
  l'essentiel : contexte de la base, élévation possible du jeton, exécution
  de contenu de la PR (installation, scripts, `preload` de `bunfig.toml`,
  `.env`), cache partagé, rayon d'impact du gate de citations. Elle sépare
  bien le documenté du mesuré ;
- (d) aucune décision n'est prise au nom du propriétaire. Les deux
  questions finales sont indépendantes l'une de l'autre et ne présupposent
  pas leur réponse.

## Risques résiduels

- Deux comportements de GitHub restent non mesurés, et l'ADR le déclare
  honnêtement : la résolution entre deux checks de même contexte, et le
  rattachement d'un run `pull_request_target` au contexte requis. Tant qu'ils
  ne sont pas mesurés, aucune option ne peut être réputée fermer le cas
  hostile.
- Les mesures volatiles (runs, ruleset, nombre de commits) datent du
  2026-10-24 et sont à rejouer avant tout arbitrage.
- Les secrets d'organisation sont `unavailable` (HTTP 403).
- Cette revue a lu les 82 épingles mais n'a exécuté aucun gate localement :
  les verdicts de CI cités sont ceux de GitHub Actions.

## Verdict

**`reject`** sur le commit `95871c4bf486d20702826a48afb734d68f7d3481`.

Motif : un constat `major` ouvert (M1, défaut bloquant) et une preuve
requise ouverte (P1). Selon ADR-0056 D2, clauses 2 et 3, aucun
`approve-with-minor-reservations` n'est alors possible. Corriger M1, m1 et
m2 tient en quelques phrases de l'ADR. P1 relève du propriétaire. Après
amendement, une passe fraîche part de ce commit.

Ce verdict n'est pas une approbation de promotion par rôle.
