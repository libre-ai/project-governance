# ADR-0060 — Les gates s'exécutent depuis la pull request qu'ils jugent : options mesurées

- **Statut :** proposed — aucune option n'est retenue. Cet ADR mesure le problème de l'issue #152 et expose des options chiffrées ; il ne modifie aucun workflow ni aucun gate.
- **Date de rédaction :** 2026-10-24
- **Origine :** inspection — issue #152, relevés de revue de #141 et #142, limite déclarée par #144, incidents corrigés par #151 et #154.
- **Portée :** les workflows de ce dépôt qui jugent une pull request, requis ou non. Les dépôts de la flotte ne sont pas concernés, sauf en tant que contenu lu par les gates de flotte.
- **Numéro :** 0059 est laissé à l'amendement d'ADR-0056 rédigé en parallèle.
- **Invariants :** aucun invariant modifié.

## Contexte

### Le problème, tel que l'issue #152 le pose

Sur `pull_request`, chaque workflow de ce dépôt extrait la merge ref et exécute le code du gate qui s'y trouve. Une pull request peut donc modifier le code ou les données du gate qui la juge, et passer son propre check requis. Trois constats de revue l'ont montré le 2026-10-23/24 :

- #141, premier tour, constat 7 : `pr-door.yml` exécute `check-pr-door.ts` depuis la branche de la pull request ; une pull request peut éditer le gate Door et passer « Door declaration ».
- #142, premier tour : en CI, `check-review-evidence.ts` a imprimé une surface qui incluait le fichier qu'il ajoutait, et a répondu « touches none » pour une pull request qui modifiait `check-review-evidence.ts` lui-même.
- #144 : le gate Not-added lit ses règles à la merge base, mais son code s'exécute depuis la tête, et son en-tête le déclare comme limite.

L'inverse tient aussi : les gates qui lisent la flotte à la tête de la branche servie ne voient rien de la pull request. Le gate SQL était vert sur #141 et rouge sur la branche servie après sa fusion (`exec-non-constant` à `0fe0a6371c01:tools/quality/check-pr-door.ts:258`, corrigé par #151) ; le gate de contexte était vert sur #142 et rouge après sa fusion (`AGENTS.md` à 81 lignes pour un plafond de 80, corrigé par #154).

### Mesure du 2026-10-24

Faits volatils, à rejouer avant usage :

- branche servie : `git ls-remote --symref https://github.com/libre-ai/project-governance HEAD` → `ref: refs/heads/migrate/recover-code`, tête `066ef494ff33261e2c61cd7affe880b503dc3fe5` (fusion de #144). Toutes les citations épinglées ci-dessous visent ce commit.
- checks requis : `gh api repos/libre-ai/project-governance/rules/branches/migrate%2Frecover-code --jq '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context]'` → `["composition / validate","Composed targets pass the manifest gates of their composed governance","Door declaration","Bun quality","Every pinned code citation of the documents resolves","Negatives declaration"]`, six contextes. L'issue en nommait cinq ; « Negatives declaration » a été ajouté depuis.
- émetteur des six contextes : `gh api repos/libre-ai/project-governance/rules/branches/migrate%2Frecover-code --jq '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].integration_id]|unique'` → `[15368]`, l'application GitHub Actions pour les six.
- règle `pull_request` du même ruleset (`forge-reviewed-recovery-admission`) : `required_approving_review_count: 0`, `strict_required_status_checks_policy: true`, aucun acteur de contournement (`gh api repos/libre-ai/project-governance/rulesets/24161111 --jq .bypass_actors` → `[]`).
- jeton par défaut des workflows : `gh api repos/libre-ai/project-governance/actions/permissions/workflow` → `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}`.
- forks : `gh api repos/libre-ai/project-governance/actions/permissions/fork-pr-contributor-approval` → `{"approval_policy":"first_time_contributors"}` ; sur les 100 dernières pull requests fusionnées, `gh pr list -R libre-ai/project-governance --state merged --limit 100 --json isCrossRepository --jq '[.[]|.isCrossRepository]|group_by(.)|map({(.[0]|tostring): length})|add'` → `{"false":100}` : aucune ne venait d'un fork.

#### Les six checks requis

Sur `pull_request`, `actions/checkout` sans `ref:` extrait la merge ref, et le fichier de workflow lui-même est lu à cette merge ref (comportement documenté par GitHub, non mesuré ici). Le relevé `code-validation.yml` le rend visible : il passe `github.sha` comme révision de l'outillage.

| Check requis | Workflow, déclencheur | Permissions | Exécuté depuis la pull request | Lu à la base | Lu à la branche servie |
| --- | --- | --- | --- | --- | --- |
| `composition / validate` | `066ef494ff33:.github/workflows/code-validation.yml:3-7` (`push`, `pull_request`, `workflow_dispatch`), appel de `066ef494ff33:.github/workflows/validate-composition.yml:5-19` | `contents: read` (`066ef494ff33:.github/workflows/code-validation.yml:8-9`, `066ef494ff33:.github/workflows/validate-composition.yml:21-22`) | tout l'outillage : `tooling_ref` et `target_ref` valent `github.sha` (`066ef494ff33:.github/workflows/code-validation.yml:11-16`), l'outillage est extrait à cette révision (`066ef494ff33:.github/workflows/validate-composition.yml:58-65`), ses tests, `run-composition.py`, `install-toolchains.sh` et `check-advisory-waivers.ts` en sont exécutés (`066ef494ff33:.github/workflows/validate-composition.yml:67-106`, `066ef494ff33:.github/workflows/validate-composition.yml:138-143`) ; données : `manifest.json` lu à côté du script (`066ef494ff33:.github/composition/run-composition.py:15`, `066ef494ff33:.github/composition/run-composition.py:23`) ; la cible `project-governance` est composée à la merge ref | rien | rien ; les autres dépôts sont composés aux refs que `manifest.json` de la pull request épingle |
| `Composed targets pass the manifest gates of their composed governance` | `066ef494ff33:.github/workflows/generation-coherence.yml:18-33` (`push` filtré par chemins, `pull_request`, `workflow_dispatch`) | `contents: read` (`066ef494ff33:.github/workflows/generation-coherence.yml:35-36`) | `check-generation-coherence.py` et `added-generations.ts` (`066ef494ff33:.github/workflows/generation-coherence.yml:63-64`, `066ef494ff33:.github/workflows/generation-coherence.yml:81`) ; il installe chaque cible aux refs du manifeste de la pull request et exécute le gate de manifeste de la gouvernance composée (`066ef494ff33:.github/composition/check-generation-coherence.py:13-23`) | le registre `ecosystem/fleet-pins.v1.yaml` à `pull_request.base.sha` (`066ef494ff33:.github/workflows/generation-coherence.yml:72-73`, `066ef494ff33:tools/fleet/added-generations.ts:70`) | rien |
| `Door declaration` | `066ef494ff33:.github/workflows/pr-door.yml:16-18` (`pull_request`, dont `edited`) | `contents: read` (`066ef494ff33:.github/workflows/pr-door.yml:20-21`) ; extraction sans `persist-credentials: false` (`066ef494ff33:.github/workflows/pr-door.yml:32`) | `bun run check:pr-door` (`066ef494ff33:.github/workflows/pr-door.yml:44`), donc le script de `066ef494ff33:package.json:53` et `check-pr-door.ts` de la pull request ; la description est lue dans le payload (`066ef494ff33:tools/quality/check-pr-door.ts:848-854`) | rien | rien |
| `Bun quality` | `066ef494ff33:.github/workflows/ci.yml:3-15` (`push`, `pull_request`, `workflow_dispatch`), job `066ef494ff33:.github/workflows/ci.yml:152-153` | `contents: read` (`066ef494ff33:.github/workflows/ci.yml:17-18`) ; extraction sans `persist-credentials: false` (`066ef494ff33:.github/workflows/ci.yml:158-160`) | tout : `bun install --frozen-lockfile`, `bun run check` (`066ef494ff33:.github/workflows/ci.yml:174-175`), puis chaque gate de `066ef494ff33:.github/workflows/ci.yml:178-242` ; la surface gardée de `check-review-evidence.ts` est écrite dans son code (`066ef494ff33:tools/quality/check-review-evidence.ts:94-117`) | le lockfile de la tête de la branche cible (`066ef494ff33:tools/quality/check-audit-delta.ts:121-131`, `066ef494ff33:tools/quality/check-audit-delta.ts:157`) ; le diff des fichiers gardés contre `origin/<base>` (`066ef494ff33:tools/quality/check-review-evidence.ts:346-358`) ; le manifeste à `pull_request.base.sha` (`066ef494ff33:.github/workflows/ci.yml:231-234`) | rien de ce dépôt hors du cas `pull_request` (`066ef494ff33:tools/quality/check-audit-delta.ts:128-142`) |
| `Every pinned code citation of the documents resolves` | `066ef494ff33:.github/workflows/pinned-citations.yml:24-35` (`push`, `pull_request`, `schedule`, `workflow_dispatch`) | `contents: read` **et `issues: write` au niveau du workflow** (`066ef494ff33:.github/workflows/pinned-citations.yml:37-42`) ; aucun jeton n'est passé à l'étape du gate, extraction sans identifiants (`066ef494ff33:.github/workflows/pinned-citations.yml:54-56`) | `bun run check:pinned-citations` (`066ef494ff33:.github/workflows/pinned-citations.yml:68`, `066ef494ff33:package.json:47`) ; données : `pinned-citations.v1.json` de la pull request — seuil, exemptions, propriétaires admis (`066ef494ff33:tools/quality/check-pinned-citations.ts:1894`) | rien | la branche servie du dépôt distant, pour exiger qu'une épingle locale y soit (`066ef494ff33:tools/quality/check-pinned-citations.ts:1233-1253`) |
| `Negatives declaration` | `066ef494ff33:.github/workflows/pr-negatives.yml:17-19` (`pull_request`, dont `edited`) | `contents: read` (`066ef494ff33:.github/workflows/pr-negatives.yml:21-22`), extraction sans identifiants (`066ef494ff33:.github/workflows/pr-negatives.yml:33-38`) | `bun run check:pr-negatives` (`066ef494ff33:.github/workflows/pr-negatives.yml:53-55`, `066ef494ff33:package.json:54`) ; le code du gate vient de la tête, son en-tête le dit (`066ef494ff33:tools/quality/check-pr-negatives.ts:115-118`) | les règles `pr-negatives.v1.json` à la merge base (`066ef494ff33:tools/quality/check-pr-negatives.ts:852-877`) | rien |

Trois constats tirés du tableau :

1. **Les six checks exécutent le code de la pull request**, et le fichier de workflow est celui de la merge ref. Trois lisent une donnée à la base (`Bun quality`, `Composed targets…`, `Negatives declaration`) ; aucun n'y lit son code.
2. **Trois checks ont pour objet l'exécution de code** : `Bun quality` exécute les tests et les gates de la pull request, `composition / validate` compose la pull request et exécute ses vérifications, `Composed targets…` installe les cibles aux refs que la pull request déclare. Leur code ne peut pas être « lu comme donnée ». Les trois autres (`Door declaration`, `Negatives declaration`, `Every pinned code citation…`) et l'étape `check-review-evidence.ts` de `Bun quality` ne jugent que du texte et un diff.
3. **Un check requis est identifié par son nom et par l'application GitHub Actions** (`integration_id` 15368) : un job ajouté par une pull request sous le même nom émet un check du même contexte. La façon dont GitHub tranche entre deux checks de même contexte sur le même commit n'a pas été mesurée ici.

#### Le check non requis du même workflow

Le job `Licensing and contribution governance` (`066ef494ff33:.github/workflows/ci.yml:25-150`, DCO et REUSE) s'exécute depuis la pull request comme les autres, mais il **n'est pas requis** : le relevé des contextes ci-dessus ne le contient pas.

#### Les gates non requis qui lisent la branche servie

Deux workflows s'exécutent sur `pull_request` avec le code et les données de la pull request, mais lisent le contenu de chaque dépôt de la flotte — **y compris ce dépôt** (`066ef494ff33:ecosystem/repositories.v1.yaml:32`) — à la tête de sa branche servie :

| Workflow, déclencheur | Permissions | Exécuté depuis la pull request | Lu à la branche servie |
| --- | --- | --- | --- |
| `066ef494ff33:.github/workflows/inventory-drift.yml:16-25` (`push`, `pull_request`, `schedule`, `workflow_dispatch`) | `contents: read`, `issues: write` (`066ef494ff33:.github/workflows/inventory-drift.yml:27-31`) ; `GH_TOKEN` posé dans l'environnement du job, donc visible de chaque étape (`066ef494ff33:.github/workflows/inventory-drift.yml:41-42`) ; extraction sans `persist-credentials: false` (`066ef494ff33:.github/workflows/inventory-drift.yml:44`) | neuf gates sur `pull_request` (`066ef494ff33:.github/workflows/inventory-drift.yml:72-134`) ; le dixième, Dependabot, ne tourne qu'en `schedule` et `workflow_dispatch` (`066ef494ff33:.github/workflows/inventory-drift.yml:155-158`) ; données : `repositories.v1.yaml` et les listes d'autorisation, par exemple `066ef494ff33:ecosystem/check-sql-construction.ts:279` | le gate SQL par un clone superficiel de la branche servie (`066ef494ff33:ecosystem/check-sql-construction.ts:28`, `066ef494ff33:ecosystem/check-sql-construction.ts:195-203`) ; `action-pins`, `release-age` et `web-headers` par `HEAD:<chemin>` en GraphQL via `066ef494ff33:ecosystem/fleet-tree.ts:95-107` ; `fleet-pins` par `HEAD:` (`066ef494ff33:ecosystem/check-fleet-pins.ts:706-709`) |
| `066ef494ff33:.github/workflows/context-conformance.yml:26-35` (`push`, `pull_request`, `schedule`, `workflow_dispatch`) | `contents: read`, `issues: write` (`066ef494ff33:.github/workflows/context-conformance.yml:37-41`) ; `GH_TOKEN` dans l'environnement du job (`066ef494ff33:.github/workflows/context-conformance.yml:47-48`) | `bun run check:context-conformance` (`066ef494ff33:.github/workflows/context-conformance.yml:65`) ; données : `repositories.v1.yaml` de la pull request (`066ef494ff33:ecosystem/check-context-conformance.ts:692`) | `AGENTS.md` et `CLAUDE.md` de chaque dépôt par `HEAD:` (`066ef494ff33:ecosystem/check-context-conformance.ts:495-499`) |

Ces gates cumulent les deux défauts : une pull request peut changer leur code et leurs listes d'autorisation, et ils ne voient pas ce qu'elle change dans ce dépôt. Fichiers de `ecosystem/` qui portent une lecture `HEAD:`, `contents/`, `git/trees` ou `clone` de la flotte : 11 (`grep -lE 'HEAD:|contents/|git/trees|"clone"' ecosystem/check-*.ts ecosystem/fleet-tree.ts | grep -v test`). Les workflows `truth-drift`, `org-readme-drift`, `fleet-advisories`, `sovereignty-report` et `adoption-proof` lisent aussi la flotte, mais ne tournent qu'en `schedule` et `workflow_dispatch` : ils ne jugent aucune pull request.

#### Deux faits qui pèsent sur toutes les options

- **La doctrine de flotte refuse aujourd'hui `pull_request_target`.** Le workflow réutilisable du lien de work package l'écrit (`066ef494ff33:.github/workflows/reusable-work-package-link.yml:13-20`) et son test l'affirme (`066ef494ff33:tools/quality/reusable-work-package-link.test.ts:143-147`). Le même fichier consigne une mesure sur la révision de Bun épinglée : un `bunfig.toml` de l'espace de travail exécute son `preload` à chaque `bun <script>`, un drapeau inconnu ou un `--config=` vide ne l'arrête pas ; seul un répertoire de travail de confiance le fait (`066ef494ff33:.github/workflows/reusable-work-package-link.yml:35-48`). Le motif d'outillage extrait à un sha fixe dans `$RUNNER_TEMP` et exécuté depuis ce répertoire y est écrit (`066ef494ff33:.github/workflows/reusable-work-package-link.yml:81-96`, `066ef494ff33:.github/workflows/reusable-work-package-link.yml:112-119`).
- **La surface d'un gate change souvent.** Commits de la branche servie depuis le 2026-09-24 : `git log --since=2026-09-24 --format=%H origin/migrate/recover-code | wc -l` → 146 ; parmi eux, ceux qui touchent `tools/`, `.github/`, `ecosystem/*.ts`, `package.json`, `bun.lock` ou `bunfig.toml` : `git log --since=2026-09-24 --format=%H origin/migrate/recover-code -- tools .github 'ecosystem/*.ts' package.json bun.lock bunfig.toml | wc -l` → 87.

## Options

Le coût est compté en fichiers de workflow touchés, mesurés sur l'arbre de `066ef494ff33`. Aucune option n'est appliquée par cet ADR.

### Option A — Exécuter le gate depuis la base, lire la pull request comme donnée

#### A1 — `pull_request_target`

**Forme.** Déclencheur `pull_request_target` avec les mêmes `types:` ; `permissions: contents: read` au niveau du job, rien d'autre ; extraction de `github.event.pull_request.base.sha` pour `tools/` et les données ; tête de la pull request récupérée dans un dépôt git séparé, lue seulement comme objets (`git diff base...head`, `git cat-file`) ; description lue dans le payload. Aucun `bun install`, aucun `bun run` résolu depuis le `package.json` de la pull request, aucun processus Bun dont le répertoire de travail est un arbre de la pull request.

**Coût mesuré.** Applicable à 3 des 6 checks requis : `pr-door.yml`, `pr-negatives.yml`, `pinned-citations.yml`, plus l'étape `check-review-evidence.ts` extraite de `ci.yml` vers un workflow neuf. Total : 4 fichiers modifiés ou créés, 5 si l'on compte `ci.yml` amputé, et un contexte requis de plus dans le ruleset, acte du propriétaire. `pinned-citations.yml` doit en outre perdre son `issues: write` de niveau workflow au profit d'un job séparé pour `schedule` et `workflow_dispatch`. Inapplicable à `Bun quality`, `composition / validate` et `Composed targets…`, dont l'objet est d'exécuter du code (constat 2).

**Sécurité.** Le risque classique de `pull_request_target` : le job tourne dans le contexte de la base, avec ses secrets et son jeton, au-dessus d'une tête que son auteur contrôle. Le jeton par défaut du dépôt est en lecture (mesure ci-dessus), mais un workflow peut l'élever, et une seule étape qui exécute un contenu de la pull request — installation, script `package.json`, `preload` d'un `bunfig.toml`, `.env` lu par Bun — devient une exécution de code dans le contexte de la base. Le cache d'Actions est partagé avec la branche de base (documenté par GitHub, non mesuré ici) : une étape qui y écrit à partir de données de la pull request l'empoisonne. Le gate `pinned-citations` passe du texte écrit par l'auteur à git ; il est durci (`066ef494ff33:tools/quality/check-pinned-citations.ts:145-155`), mais son rayon d'impact monte avec le contexte. Enfin l'option renverse une position de flotte écrite et testée (fait ci-dessus).

**Ce qu'elle ferme.** Pour ces quatre gates : la pull request ne peut plus modifier ni leur code, ni leurs données, ni leur fichier de workflow, ni le script `package.json` qui les lance, puisque `pull_request_target` lit le workflow de la base.

**Ce qu'elle laisse ouvert.** (i) Une pull request peut ajouter un job `pull_request` portant le même nom qu'un check requis ; les deux sont émis par GitHub Actions (constat 3), et la résolution n'est pas mesurée. (ii) Le rattachement d'un run `pull_request_target` au sha de tête, et sa prise en compte pour un contexte requis, ne sont pas mesurés ici. (iii) Les trois checks qui exécutent du code restent entiers. (iv) Une pull request qui corrige un de ces gates est jugée par l'ancien ; son nouveau comportement n'est vu qu'après la fusion, ce qui déplace l'angle mort inverse à l'intérieur de ces gates.

#### A2 — variante sans changer de déclencheur : outillage de la base sous `pull_request`

**Forme.** On garde `pull_request`. On extrait l'outillage à `github.event.pull_request.base.sha` dans `$RUNNER_TEMP` et on l'exécute depuis ce répertoire, selon le motif de `066ef494ff33:.github/workflows/reusable-work-package-link.yml:81-96`, en lisant l'espace de travail de la pull request par son chemin absolu. Pour `composition / validate`, `tooling_ref` vaut le sha de base au lieu de `github.sha` (`066ef494ff33:.github/workflows/code-validation.yml:16`).

**Coût mesuré.** 6 fichiers : `pr-door.yml`, `pr-negatives.yml`, `pinned-citations.yml`, `ci.yml` (étapes `check-review-evidence`, `check-audit-delta`, monotonie des refs, chemins composés), `generation-coherence.yml` (script de la base, manifeste de la pull request lu comme donnée), `code-validation.yml`. `bun run check` reste celui de la pull request : ce sont ses propres tests.

**Sécurité.** Aucun changement de jeton ni de contexte : tout reste en lecture, comme aujourd'hui.

**Ce qu'elle ferme.** La modification accidentelle du code ou des données d'un gate qui passe son propre check — les cas #141 constat 7 et #142 — pour les gates déplacés.

**Ce qu'elle laisse ouvert.** Le fichier de workflow reste celui de la merge ref : une pull request peut réécrire le workflow pour exécuter son propre outillage. Le contournement délibéré reste possible, mais il doit passer par `.github/workflows/`, une surface plus petite et visible au diff. Comme A1, le gate modifié par une pull request est jugé par l'ancien.

### Option B — Échec fermé sur la surface d'un gate, sauf `Owner-arbitration:`

**Forme.** Une pull request qui modifie le code ou les données d'un gate — `.github/workflows/`, `.github/composition/`, `tools/`, les `ecosystem/*.ts` et leurs données, `package.json`, `bun.lock`, `bunfig.toml` — échoue sur ce gate, sauf si sa description ou une ligne qu'elle ajoute porte `Owner-arbitration: AAAA-MM-JJ`, sur le modèle de `check-review-evidence` (`066ef494ff33:tools/quality/check-review-evidence.ts:28-38`, surface `066ef494ff33:tools/quality/check-review-evidence.ts:94-117`).

**Coût mesuré.** 0 workflow si la surface est ajoutée à `check-review-evidence.ts`, déjà lancé par `066ef494ff33:.github/workflows/ci.yml:222` ; 1 si c'est un gate distinct. Friction : 87 des 146 commits de la branche servie depuis le 2026-09-24 touchent cette surface (mesure ci-dessus), et chacun aurait exigé le marqueur.

**Sécurité.** Aucun jeton nouveau. Le marqueur est une convention de texte écrite par l'auteur de la pull request, et le gate le dit lui-même (`066ef494ff33:tools/quality/check-review-evidence.ts:28-38`) : quiconque ouvre la pull request peut l'écrire. Sous `pull_request`, le garde s'exécute depuis la tête : une pull request peut retirer un chemin de la surface dans la même pull request qui modifie ce chemin, ce que #142 a observé. Lire la surface à la merge base, comme `pr-negatives` lit ses règles (`066ef494ff33:tools/quality/check-pr-negatives.ts:115-118`), le réduit sans le fermer : le code reste celui de la tête.

**Ce qu'elle ferme.** L'auto-validation silencieuse : une pull request qui touche un gate rougit ou porte un marqueur, et le propriétaire le voit à la fusion.

**Ce qu'elle laisse ouvert.** Le contournement délibéré (éditer le garde ou le workflow). À 87 sur 146, le marqueur deviendrait routinier, ce qui en vide le sens d'arbitrage. Et une session d'agent qui modifie `tools/` n'a pas le droit d'écrire ce marqueur sans arbitrage réel : chacune de ses pull requests attendrait le propriétaire.

### Option C — Statu quo documenté, la revue humaine comme seule garde

**Forme.** Aucun changement de workflow ; la limite est écrite dans l'en-tête de chaque gate requis, comme `066ef494ff33:tools/quality/check-pr-negatives.ts:117-118` le fait déjà.

**Coût mesuré.** 0 workflow ; 6 en-têtes de gate, ou ce seul ADR accepté.

**Sécurité.** Inchangée. État mesuré : le code de la pull request s'exécute avec `contents: read` dans les six checks requis ; `inventory-drift` et `context-conformance` exposent un `GH_TOKEN` portant `issues: write` à chaque étape, donc au code de la pull request pour une branche du dépôt ; `Door declaration`, `Bun quality`, le job non requis `Licensing and contribution governance`, `inventory-drift` et `context-conformance` laissent le jeton de l'extraction dans `.git/config` (`066ef494ff33:.github/workflows/pr-door.yml:32`, `066ef494ff33:.github/workflows/ci.yml:158-160`, `066ef494ff33:.github/workflows/ci.yml:29-31`, `066ef494ff33:.github/workflows/inventory-drift.yml:44`, `066ef494ff33:.github/workflows/context-conformance.yml:50-52`). Une pull request de fork reçoit un jeton en lecture seule (documenté par GitHub, non mesuré ici), et la politique d'approbation vise les premiers contributeurs.

**Ce qu'elle ferme.** Rien mécaniquement. La garde est la fusion par le propriétaire : le ruleset n'exige aucune approbation et n'admet aucun contournement.

**Ce qu'elle laisse ouvert.** Tout ce que décrit l'issue : un check requis vert ne dit pas que le gate qui l'a émis est celui de la base.

### Option D — Cas inverse : les gates de branche servie lisent aussi l'arbre de la pull request

**Forme.** Sur `pull_request`, quand le dépôt inspecté est ce dépôt-ci, les gates de flotte lisent l'extraction de la pull request au lieu de `HEAD:` du distant ; les autres dépôts restent lus à leur branche servie, ce qui est correct pour eux. Cette partie « ce dépôt » devient un job à part, requérable parce qu'il ne dépend que de la pull request ; le reste de `inventory-drift` est rouge en connaissance de cause et ne peut pas être requis (`066ef494ff33:.github/workflows/pinned-citations.yml:11-15`).

**Coût mesuré.** 2 workflows (`inventory-drift.yml`, `context-conformance.yml`) ou 1 workflow neuf ; 11 fichiers de lecture de flotte à faire passer par un lecteur qui sait servir l'extraction locale ; un contexte requis de plus, acte du propriétaire.

**Sécurité.** Aucun jeton nouveau : lire l'extraction, c'est lire une donnée de la pull request avec le code de la pull request, comme aujourd'hui.

**Ce qu'elle ferme.** La classe #141 → #151 et #142 → #154 : un gate vert sur la pull request et rouge sur la branche servie après la fusion, pour le contenu de ce dépôt.

**Ce qu'elle laisse ouvert.** Le premier défaut, car ces gates s'exécutent toujours depuis la pull request. D est orthogonale : elle se combine avec A2, B ou C, et avec A1 si le code du gate vient de la base et l'extraction n'est lue que comme donnée.

## Ce que la mesure départage, et ce qu'elle laisse au propriétaire

- **Elle écarte A1 comme premier remède, tant que deux comportements de GitHub ne sont pas mesurés.** A1 ne couvre que 3 des 6 checks requis plus une étape ; ce qu'elle promet de fermer pour eux repose sur deux points non mesurés (le contexte homonyme émis par la même application, et le rattachement d'un run `pull_request_target` au contexte requis) ; et elle renverse une position de flotte écrite et testée en ajoutant le risque d'exécution dans le contexte de la base. Les deux mesures se font sur un dépôt jetable, avant tout arbitrage qui retiendrait A1.
- **Elle ne départage pas A2, B et C.** Le choix dépend du modèle de menace, qui est une décision. Ce que la mesure apporte : les trois cas observés sont accidentels (deux constats de revue et une limite déclarée), et les 100 dernières pull requests fusionnées venaient toutes d'une branche du dépôt, aucune d'un fork. Contre l'accident, A2 ferme le cas pour les gates déplacés sans friction de marqueur ; B le rend visible au prix d'un marqueur sur 87 commits sur 146 ; C ne ferme rien. Contre un auteur hostile, aucune option qui garde `pull_request` ne ferme le cas, puisque le workflow est lu à la merge ref.
- **D ne concurrence aucune autre option.** Le défaut qu'elle traite s'est produit deux fois le 2026-10-24 (#141 fusionnée à 06:21Z, #151 à 08:18Z ; #142 à 06:33Z, #154 à 08:23Z, horodatages de `gh pr view <n> --json mergedAt`). Son coût en lecteurs est le plus élevé des options.

Questions à poser au propriétaire, indépendantes l'une de l'autre :

1. Le modèle de menace retenu pour les gates requis : accident d'un auteur de confiance seulement, ou aussi auteur hostile.
2. Le traitement du cas inverse : D, ou le statu quo avec correction après fusion comme pour #151 et #154.
