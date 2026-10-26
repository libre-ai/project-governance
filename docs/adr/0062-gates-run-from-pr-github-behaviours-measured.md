# ADR-0062 — Les gates s'exécutent depuis la pull request qu'ils jugent : les comportements de GitHub laissés ouverts par ADR-0060, mesurés, et une option recommandée

- **Statut :** proposed — recommande l'option A2 combinée à B restreint à `.github/workflows/` (ci-dessous « A2 + Bw »). Le choix revient au propriétaire ; cet ADR ne retient aucune option. Ce que signe la fusion n'est pas tranché ici : c'est la question Q3 en fin d'ADR. Cet ADR ne modifie aucun workflow, aucun gate, aucun réglage du dépôt.
- **Arbitrage :** aucun à la rédaction.
- **Date de rédaction :** 2026-10-26
- **Origine :** inspection — suite d'ADR-0060 (issue #152, fusionné par #158 le 2026-10-26), qui écarte A1 « tant que deux comportements de GitHub ne sont pas mesurés » et laisse une hypothèse non vérifiée (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:179`).
- **Portée :** celle d'ADR-0060 (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:7`) : les workflows de ce dépôt qui jugent une pull request.
- **Numéro :** 0062. À `4bb07948c7c6`, le dernier numéroté de la branche servie est 0060 (`ls docs/adr | sort | tail -3`). La pull request ouverte #162 réserve 0061, pour un amendement d'ADR-0042 (`gh pr list -R libre-ai/project-governance --state open --json number,title` ; `gh pr diff 162 -R libre-ai/project-governance --name-only`). Les pull requests ouvertes #161 et #163 ne touchent ni `docs/adr/` ni le registre.
- **Registre des décisions :** aucune entrée. ADR-0059, accepté, porte D102 ; ADR-0060, proposé, n'en porte aucune (`grep -c -E '0059|0060' docs/decisions/DECISION-REGISTER.md` → `1`, la ligne D102). Une entrée suivrait le choix d'une option. #162 réserve D103 à D105 (`gh pr diff 162 -R libre-ai/project-governance | grep -E '^\+.*\bD1[0-9]{2}\b'`) : le prochain numéro libre serait D106, à rejouer au moment de l'écrire.
- **Invariants :** aucun invariant modifié.

## Contexte : ce qu'ADR-0060 laisse ouvert

Trois points, cités du texte fusionné :

| # | Ce qu'ADR-0060 suppose ou laisse ouvert | Où |
| --- | --- | --- |
| C1 | « Un check requis est identifié par son nom et par l'application GitHub Actions (`integration_id` 15368) : un job ajouté par une pull request sous le même nom émet un check du même contexte. La façon dont GitHub tranche entre deux checks de même contexte sur le même commit n'a pas été mesurée ici. » Pour A1 : « (i) Une pull request peut ajouter un job `pull_request` portant le même nom qu'un check requis […] et la résolution n'est pas mesurée. » | `docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:54`, `docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:106` |
| C2 | « (ii) Le rattachement d'un run `pull_request_target` au sha de tête, et sa prise en compte pour un contexte requis, ne sont pas mesurés ici. » | `docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:106`, `docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:179` |
| C3 | Hypothèse : « la politique d'approbation des workflows de fork (`first_time_contributors`) ne s'appliquerait pas à `pull_request_target`. Si elle se vérifie, la pull request d'un premier contributeur déclencherait sans approbation un job dans le contexte de la branche par défaut. » | `docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:179`, `docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:106` (v) ; origine : `docs/reviews/adr-0060-gates-run-from-pr-2026-10-24/REVIEW.md:310-312` |

C1 et C2 sont les « deux comportements » dont dépend l'écartement d'A1 ; C3 est l'hypothèse. ADR-0060 prévoyait de les mesurer sur un dépôt jetable. Cet ADR les mesure d'abord avec les instruments qui n'exigent aucun réglage, et écrit le protocole du dépôt jetable pour ce qu'ils ne tranchent pas.

## Mesure du 2026-10-26

Instruments, tous en lecture :

- la documentation GitHub, lue le 2026-10-26 entre 11:19 et 11:30 UTC par son API de contenu, `curl -sS "https://docs.github.com/api/article/body?pathname=/en/<page>"` ; chaque citation donne l'URL de la page ;
- les runs et check runs existants, par `gh api`, sur ce dépôt et la flotte ;
- le ruleset et son historique, `gh api repos/libre-ai/project-governance/rules/branches/migrate%2Frecover-code` et `gh api repos/libre-ai/project-governance/rulesets/24161111/history` ;
- quand la flotte n'a aucune occurrence du comportement, des dépôts publics tiers, en lecture seule, nommés à chaque fois. La flotte n'a aucun run `pull_request_target` : 0 sur 33 dépôts (25 de l'organisation, 8 du compte personnel ; `gh api "repos/<dépôt>/actions/runs?event=pull_request_target&per_page=1" --jq .total_count` pour chaque dépôt de `gh repo list <owner> --limit 100`).

Faits volatils rejoués à la tête `4bb07948c7c6` de la branche servie (`git ls-remote --symref https://github.com/libre-ai/project-governance HEAD` → `ref: refs/heads/migrate/recover-code`) :

- les six contextes requis sont inchangés depuis ADR-0060, tous avec `integration_id` 15368 ; ruleset `active`, `bypass_actors: []`, `current_user_can_bypass: never` (`gh api repos/libre-ai/project-governance/rulesets/24161111 --jq '{enforcement,bypass_actors,current_user_can_bypass}'`) ;
- `{"approval_policy":"first_time_contributors"}` (`gh api repos/libre-ai/project-governance/actions/permissions/fork-pr-contributor-approval`) ; `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}` (`…/actions/permissions/workflow`) ;
- 151 pull requests au total, 151 depuis une branche du dépôt et aucune d'un fork, 151 vers `migrate/recover-code`, 151 ouvertes par le compte du propriétaire (`gh pr list -R libre-ai/project-governance --state all --limit 1000 --json isCrossRepository,baseRefName,author`) ;
- dépôt `public` (`gh api repos/libre-ai/project-governance --jq .visibility`).

### C1 — deux checks de même contexte sur le même commit

**Relevé.** Pour la tête de chacune des 151 pull requests, tous les check runs (`gh api "repos/libre-ai/project-governance/commits/<sha>/check-runs?filter=all&per_page=100"`, aucune tête n'en porte plus de 100), groupés par nom : 192 groupes de check runs homonymes sur une même tête. 11 portent un contexte requis avec des conclusions différentes. Dans les 11, l'échec ou l'annulation précède le succès ; aucune tête ne porte, sur un contexte requis, un succès suivi d'un échec.

Quatre de ces pull requests ont été fusionnées avec, sur leur tête, un run en échec d'un contexte requis au moment de la fusion. Pour #77, l'échec et le succès sont deux tentatives d'un même run ; pour les trois autres, ce sont deux runs distincts :

| PR | Contexte requis | Runs sur la tête, par ordre de démarrage | Fusion |
| --- | --- | --- | --- |
| #77, tête `03cbdf403667` | `composition / validate` | `failure` à 18:37:55Z puis `success` à 18:40:59Z, même run 37974614302 (`code-validation.yml`, `pull_request`, tentative 2) | 2026-10-09T18:43:42Z |
| #115, tête `a2a2792cd8ec` | `Door declaration` | `failure` à 10:39:21Z puis `cancelled` à 10:41:05Z, run 38551079215 (`pr-door.yml`, `pull_request`, tentative 2) ; `success` à 10:41:07Z, run 38551282716 (`pr-door.yml`, `pull_request`) | 2026-10-14T10:44:04Z |
| #131, tête `08ea6f80dcf3` | `Bun quality` | `failure` à 08:34:35Z, run 39925613013 ; `success` à 08:40:41Z, run 39926336047 (`ci.yml`, `pull_request`, tous deux) | 2026-10-23T09:04:40Z |
| #142, tête `32d6bd0f55d0` | `Bun quality` | `failure` à 06:22:30Z, run 40069950187 ; `success` à 06:29:04Z, run 40070376176 (`ci.yml`, `pull_request`, tous deux) | 2026-10-24T06:33:45Z |

Commandes : `gh api repos/libre-ai/project-governance/check-runs/<id>` (nom, conclusion, suite, `app.id` = 15368 pour les neuf runs), `gh api "repos/libre-ai/project-governance/actions/runs?check_suite_id=<suite>"` (run, événement, fichier, tentative), `gh pr view <n> --json mergedAt`.

Le ruleset exigeait ces contextes à ces dates. L'historique donne six versions, toutes `active` avec 0 acteur de contournement. `composition / validate` est requis depuis la première, 51244612 (2026-09-29T08:06:08+02:00). `Door declaration` est requis depuis la version 53086956 (2026-10-14T03:00:02+02:00). `Bun quality` l'est depuis la version 53105256 (2026-10-14T06:42:41+02:00). Commande : `gh api repos/libre-ai/project-governance/rulesets/24161111/history/<version> --jq '{enforcement: .state.enforcement, bypass: (.state.bypass_actors|length), req: [.state.rules[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context]}'`.

**Ce que la mesure établit.** Un run en échec d'un contexte requis ne bloque pas la fusion quand un run plus récent du même nom, de la même application, sur le même sha, réussit, et cela entre deux runs distincts d'un même fichier de workflow (#115, #131, #142) comme entre deux tentatives d'un même run (#77). La règle « tout run en échec d'un contexte bloque » est donc exclue.

**Ce qu'elle ne départage pas.** « Le plus récent l'emporte » et « un succès suffit » donnent les mêmes quatre fusions. Le cas qui les sépare, un succès suivi d'un échec sur un contexte requis, n'existe sur aucune des 151 têtes. Le cas de deux **fichiers** de workflow différents qui émettent le même nom n'est pas observé non plus : les quatre paires viennent chacune d'un seul fichier.

**Ce qu'en dit la documentation.** Elle ne donne pas la règle. Elle met en garde : « If you use branch protection rules that require specific status checks, make sure that job names are unique across all workflows. Using the same job name in multiple workflows can cause ambiguous status check results and block pull requests from being merged. » (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches). L'API des check runs filtre par défaut sur `latest`, « Filters check runs by their completed_at timestamp. latest returns the most recent check runs. » (https://docs.github.com/en/rest/checks/runs) : c'est un filtre de lecture, pas la règle du ruleset.

**Piège d'instrument.** Sur la PR ouverte #162, tête `b1c9fa07f301`, les deux runs `Door declaration` (`failure` puis `success`) portent tous deux `isRequired: true`, et `statusCheckRollup.state` vaut `FAILURE` (requête GraphQL `statusCheckRollup { state contexts { … isRequired(pullRequestNumber: 162) } }`). Ce même état agrégé compterait l'échec ancien que les fusions de #77, #115, #131 et #142 montrent sans effet : il ne dit pas le verdict du ruleset. Le protocole ci-dessous lit `mergeStateStatus` et une tentative de fusion, jamais le rollup.

### C2 — rattachement d'un run `pull_request_target`, et prise en compte pour un contexte requis

**Rattachement, mesuré sur des dépôts tiers** (la flotte n'en a aucun) :

| Dépôt, run | Pull request | `head_sha` du run et de sa check suite | Tête de la branche par défaut |
| --- | --- | --- | --- |
| `grafana/grafana`, run 40314769037 « PR automation », suite 109261477903, application 15368 | #135913, branche du même dépôt, tête `c9a4695ef6d2` | `c9a4695ef6d2`, suite rattachée à la PR #135913 | `main` à `e29755d49bc9` |
| `python/cpython`, run 25066296099 « Read the Docs PR preview », suite 66570635197, application 15368 | branche `warsaw/829` du fork `warsaw/cpython` | `77e73c243552`, la tête du fork | `main` à `c436e8d83597` |
| `vercel/next.js`, run 40310670830 « Pull Request Auto-Labeler » | #100719, fork `spokodev/next.js`, tête `1ffe9630e119` | `1ffe9630e119` | — |

Commandes : `gh api repos/<dépôt>/actions/runs/<run>`, `gh api repos/<dépôt>/check-suites/<suite> --jq '{head_sha, pull_requests: [.pull_requests[].number], app: .app.id}'`, `gh api "repos/<dépôt>/commits/<head_sha>/check-runs?filter=all"` (le check run de la suite y figure), `gh api repos/<dépôt>/commits/main --jq .sha`.

Le run `pull_request_target` et sa check suite sont rattachés au sha de tête de la pull request, y compris depuis un fork, et non au dernier commit de la branche par défaut, qui est le `GITHUB_SHA` documenté de l'événement.

**Prise en compte pour un contexte requis : documentée, non mesurée.** « For checks created by workflow jobs to be evaluated for a pull request, the workflow run must be triggered by one of these events: `push`, `pull_request`, `pull_request_review`, `pull_request_target`, `deployment`, `deployment_status` », et un check d'un autre événement ne satisfait pas « a required status check in a branch ruleset » (https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks). Aucun dépôt lu ne requiert un contexte émis par un job `pull_request_target`. Sur 18 dépôts publics tiers examinés, 5 requièrent par ruleset des contextes de l'application 15368 (`gh api repos/<dépôt>/rules/branches/<défaut>`). Sur les trois dernières PR fusionnées de trois d'entre eux, `electron/electron`, `microsoft/TypeScript` et `github/docs`, chaque contexte requis émis par Actions vient d'un run `pull_request` (`checkSuite.workflowRun.event` en GraphQL). La protection de branche classique d'un dépôt tiers n'est pas lisible sans droit d'administration.

### C3 — la politique d'approbation des forks et `pull_request_target`

**Documentation.** « Workflows triggered by `pull_request_target` events are run in the context of the base branch. Since the base branch is considered trusted, workflows triggered by these events will always run, regardless of approval settings. » (https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository, section « Controlling changes from forks to workflows in public repositories »). La page « Approving workflow runs from public forks » ne nomme toujours pas `pull_request_target` (https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks), comme le relevait le second tour (`docs/reviews/adr-0060-gates-run-from-pr-2026-10-24/REVIEW-ROUND-2.md:225`) : l'hypothèse se tranche sur une autre page.

**Runs.** Sur `vercel/next.js`, parmi les 100 dernières pull requests, les 12 premières qui viennent d'un fork et dont l'auteur a `author_association: NONE` portent toutes, sur leur tête, deux runs `pull_request` en `action_required`, c'est-à-dire en attente d'approbation, et un run `pull_request_target` en `completed`/`success`. Exemple, #100719 : runs 40310674346 et 40310674326 (`pull_request`, `action_required`), run 40310670830 (`pull_request_target`, `success`). Commandes : `gh api "repos/vercel/next.js/pulls?state=all&per_page=100"`, puis `gh api "repos/vercel/next.js/actions/runs?head_sha=<sha>&per_page=100"`. La politique d'approbation de ce dépôt n'est pas lisible ; le statut `action_required` montre qu'une approbation était exigée pour cet auteur et ce sha, et le run `pull_request_target` de la même PR ne l'a pas attendue.

Sur ce dépôt, le comportement n'est pas observé : aucune de ses 151 pull requests ne vient d'un fork.

### Trois faits documentés depuis ADR-0060, qui changent A1

Lus sur https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target, le 2026-10-26 :

1. **Une politique par défaut bloque `pull_request_target` dans les dépôts publics.** « For public repositories that do not already have an applicable Actions event policy, GitHub adds a default policy that blocks workflows triggered by `pull_request_target`. » Elle « Currently runs in **evaluate** mode », et « On December 2, 2026, GitHub will enforce the default policy for affected repositories that were using the default `pull_request_target` policy before general availability. » Ce dépôt est public. Ses politiques Actions de dépôt : `{"total_count":0,"policies":[]}` (`gh api repos/libre-ai/project-governance/actions/policies`). Celles de l'organisation sont `unavailable` : la requête répond HTTP 404 et exige la portée `admin:org`. La documentation ne dit pas si la politique par défaut figure dans cette liste : la liste vide ne dit donc pas si elle s'applique ici (inférence). À partir du 2026-12-02, A1 suppose donc une politique d'événements qui autorise explicitement `pull_request_target`, créée par le propriétaire, contre la protection par défaut de GitHub.
2. **Le cache est en lecture seule pour `pull_request_target`.** « workflows triggered by `pull_request_target` have read-only access to the cache in the default branch's scope. These workflows can restore existing cache entries but cannot create or overwrite them ». ADR-0060 écrivait « Le cache d'Actions est partagé avec la branche par défaut » et en tirait un risque d'empoisonnement (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:102`). La documentation donne désormais ce risque pour fermé par défaut, sauf `cache-mode` explicite en écriture (documenté, non mesuré).
3. **`actions/checkout` refuse par défaut la tête d'une PR de fork.** « Setting `allow-unsafe-pr-checkout: true` as an `actions/checkout` input allows checking out pull request head refs from forks. » La même page précise que `git fetch` et `gh pr checkout` ne sont pas couverts. La forme d'A1 récupère la tête dans un dépôt séparé et la lit comme objets (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:98`) : elle devrait soit écrire ce drapeau, soit passer par `git fetch`, que la protection ne voit pas.

Le workflow et l'extraction sans `ref:` viennent toujours de la branche par défaut (« the workflow, and any subsequent `actions/checkout` call that does not specify a `ref`, is taken from the **base repository's default branch** », même page) : documenté, non mesuré, comme dans ADR-0060 (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:104`).

### Un mécanisme hors des options d'ADR-0060, relevé sans être évalué

La documentation Enterprise Cloud décrit une règle de ruleset « Require workflows to pass before merging » : « Ruleset workflows can be configured at the organization or enterprise level », et la règle désigne un dépôt source et un fichier de workflow, non un nom de contexte (https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets). La version non-Enterprise de la même page ne contient pas cette section. L'organisation est au plan `team` (`gh api orgs/libre-ai --jq .plan.name`). Sa disponibilité ici est `unavailable`. Ce serait le seul mécanisme documenté qui désigne le workflow plutôt que le contexte, donc le seul que C1 ne contourne pas. Il n'est pas évalué ici et il n'est pas recommandé : il relève d'un ruleset d'organisation, donc du propriétaire.

### Synthèse

| # | Comportement supposé | Instrument | Résultat | État |
| --- | --- | --- | --- | --- |
| C1a | un job homonyme peut peser sur le contexte requis | check runs des 151 têtes, historique du ruleset | un échec suivi d'un succès du même nom ne bloque pas la fusion (#77, #115, #131, #142), entre runs ou tentatives d'un même fichier | pass |
| C1b | règle complète : succès puis échec, et deux fichiers de workflow distincts | aucun cas sur 151 têtes ; documentation : « ambiguous » | non départagé | unavailable — protocole P1 |
| C2a | le run `pull_request_target` est rattaché au sha de tête | runs et check suites de 3 dépôts publics tiers | rattaché à la tête de la PR, fork compris | pass |
| C2b | ce run compte pour un contexte requis | documentation ; 0 cas observé | documenté seulement | unavailable — protocole P2 |
| C3 | l'approbation des forks ne s'applique pas à `pull_request_target` | documentation ; runs de `vercel/next.js` | « will always run, regardless of approval settings » ; 12 PR de fork sur 12 : `pull_request` en attente, `pull_request_target` exécuté | pass |

## Les options devant la mesure

**A1 — `pull_request_target`.** ADR-0060 lui prêtait un avantage : fermer, pour quatre gates qui jugent du texte, le cas d'un auteur hostile (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:104`). Cet avantage dépend maintenant de C1b et de C2b. Sous A1, une pull request peut ajouter un workflow `pull_request` dont le job porte le nom d'un contexte requis et réussit après le run `pull_request_target`, qui, lui, échoue. Si GitHub tranche entre deux fichiers comme il l'a fait entre deux runs d'un même fichier (C1a), ce job l'emporte. L'auteur maîtrise l'ordre : il peut retarder le job, ou le déclencher par un type d'activité ultérieur (`labeled`, `ready_for_review`). C'est une inférence ; seul P1 la tranche. C2a rend A1 praticable quant au rattachement ; C2b reste à mesurer. C3 ajoute une surface : la PR d'un premier contributeur venu d'un fork lance sans approbation un job dans le contexte de la branche par défaut, ce que `pull_request` ne fait pas sous la politique actuelle. Le premier fait nouveau ajoute un coût : à partir du 2026-12-02, A1 exige que le propriétaire écarte une protection par défaut de GitHub. Le deuxième retire un risque qu'ADR-0060 lui comptait, le cache.

**A2 — outillage de la base sous `pull_request`.** C1 à C3 ne changent ni sa forme ni son coût, 9 fichiers (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:115-125`). C1a précise ce qu'il laisse ouvert. ADR-0060 nommait la réécriture du workflow (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:133`). Il y a une seconde voie : l'ajout d'un workflow dont un job porte le nom d'un contexte requis. Toutes deux passent par `.github/workflows/`.

**A2 + Bw — A2, plus un échec fermé sur `.github/workflows/`** (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:135`). Une pull request qui touche ce répertoire échoue à `Bun quality`, sauf si elle porte l'une des deux preuves que `check-review-evidence.ts` admet déjà : une référence à un artefact sous `docs/reviews/`, ou une ligne `Owner-arbitration:` datée (`4bb07948c7c6:tools/quality/check-review-evidence.ts:21-38`). Les deux voies de contournement que C1a laisse à A2 passent par ce répertoire. Bw les rend donc rouges par défaut.

- Friction, rejouée à `4bb07948c7c6` : 30 des 151 commits de la branche servie depuis le 2026-09-24 touchent `.github/workflows/` (`git log --since=2026-09-24 --format=%H 4bb07948c7c6 -- .github/workflows | wc -l` → 30 ; même fenêtre sans filtre → 151).
- Coût, inféré à la lecture et non mesuré par une implémentation : une entrée dans `GATED_PATH_PATTERNS` et une dans `GATED_PATHSPECS` (`4bb07948c7c6:tools/quality/check-review-evidence.ts:122-165`, `4bb07948c7c6:tools/quality/check-review-evidence.ts:172-199`), la déclaration « declared, not gated » de `.github/workflows/` retirée de l'inventaire (`4bb07948c7c6:tools/quality/check-data-inventory.ts:100-101`, `4bb07948c7c6:tools/quality/check-data-inventory.ts:170-175`), et leurs tests. Aucun workflow, aucun contexte requis nouveau, aucun acte sur le ruleset.
- Apport d'A2 à Bw : avec A2, la surface gardée est lue dans l'outillage de la base. Une pull request ne peut donc plus retirer `.github/workflows/` de la surface dans la pull request même qui modifie un workflow, ce qu'elle peut aujourd'hui (`4bb07948c7c6:tools/quality/check-review-evidence.ts:84-94`).
- Ce qui reste ouvert. Contre un auteur hostile, la ligne `Owner-arbitration:` s'écrit par l'auteur, et toute référence à un artefact existant sous `docs/reviews/` compte, quel qu'en soit le verdict (issue #160) : Bw rend visible, il ne ferme pas. Le pas qui lance le garde vit dans `ci.yml` (`4bb07948c7c6:.github/workflows/ci.yml:222`) : une pull request qui supprime ce pas touche `.github/workflows/`, mais le garde ne tourne plus pour le constater. Ce cas est résiduel et déclaré.

**B — échec fermé sur toute la surface d'un gate.** Friction rejouée : 106 des 151 commits depuis le 2026-09-24, contre 103 sur 146 dans ADR-0060 (même commande que `docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:144`, à `4bb07948c7c6`). L'argument d'ADR-0060 tient : un marqueur exigé sur sept commits sur dix devient routinier et perd son sens d'arbitrage (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:151`).

**C — statu quo documenté.** C1a précise ce qu'un vert ne dit pas. Il ne dit pas que le gate qui l'a émis est celui de la base. Il ne dit pas non plus que le job qui l'a émis est celui du gate : un run plus récent du même nom suffit.

**D — cas inverse.** C1 à C3 ne la concernent pas. Elle reste orthogonale et reste une question du propriétaire (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:186`).

## Recommandation : A2 + Bw

Elle est faite sur les axes, dans l'ordre sécurité, qualité, performance, complétude.

1. **Sécurité.** La population mesurée est celle d'un auteur de confiance : 151 pull requests sur 151 viennent d'une branche du dépôt, ouvertes par le compte du propriétaire, aucune d'un fork, et les trois cas d'ADR-0060 sont accidentels. Contre l'accident, A2 + Bw ferme la classe de bout en bout. A2 retire aux gates déplacés le code et les données de la pull request, c'est-à-dire les cas #141 constat 7 et #142. Bw fait rougir par défaut les deux voies qui défont A2 sans bruit : un workflow modifié, ou un workflow ajouté avec un nom de contexte requis. L'option n'ajoute ni jeton, ni déclencheur, ni dérogation à une protection de GitHub. Contre un auteur hostile, A2 + Bw ne ferme rien. A1 ne le fermerait que si C1b donne une évaluation par fichier de workflow, et que C2b passe. En échange, elle ouvre la surface de C3 et demande, à partir du 2026-12-02, d'écarter la politique par défaut de GitHub.
2. **Qualité.** 30 commits sur 151 auraient exigé une preuve de revue. Ce sont ceux qui modifient les définitions de CI, que l'inventaire déclare être les gates eux-mêmes (`4bb07948c7c6:tools/quality/check-data-inventory.ts:170-175`). B en exigerait 106.
3. **Performance.** Bw n'ajoute aucun job, seulement un motif à une étape existante. A2 ajoute à chaque workflow déplacé une extraction de l'outillage à la base : inféré, non mesuré.
4. **Complétude.** Elle ne couvre ni le cas hostile, ni le cas inverse (D).

Ordre proposé : Bw avant A2. La pull request d'A2 touche 7 workflows et serait alors elle-même sous Bw. Tant qu'A2 n'est pas fusionnée, la surface de Bw reste lue à la tête, avec la limite que son en-tête déclare.

**Ce que la recommandation coûte.** Avec Bw, environ 30 commits sur 151 attendent une preuve de revue. A2 représente 9 fichiers, dont 7 workflows et 2 scripts, plus une entrée facultative dans le contrat de `validate-composition.yml`, appelé par 14 dépôts de la flotte (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:112`). Aucun acte sur le ruleset.

**Ce qu'elle ferme.** L'auto-validation accidentelle d'un gate déplacé. La modification accidentelle, et silencieuse, d'un workflow qui juge une pull request. L'ajout accidentel d'un job homonyme d'un contexte requis.

## Protocoles pour ce qui reste `unavailable`

Les deux protocoles exigent un dépôt neuf et un ruleset : ce sont des actes du propriétaire. Ils ne touchent pas ce dépôt. Les deux se font sur le même dépôt jetable. P2 doit être joué avant le 2026-12-02, ou après la création d'une politique Actions de dépôt qui autorise `pull_request_target`, et le relevé dit laquelle des deux conditions valait.

Mise en place, commune :

1. Créer un dépôt public jetable, branche par défaut `main`, avec un README (`gh repo create <owner>/<nom> --public --add-readme`).
2. Y créer un ruleset de branche sur `main` : `required_status_checks` avec le seul contexte `Gate` et `integration_id` 15368, `strict_required_status_checks_policy: false` ; une règle `pull_request` à 0 approbation ; aucun acteur de contournement.
3. Les jobs ne font aucune extraction : ils lisent le titre de la PR par une variable d'environnement (`env: TITLE: ${{ github.event.pull_request.title }}`), jamais par interpolation dans le script.

Lecture d'un cas, une fois tous ses runs terminés :

- `gh pr view <n> -R <owner>/<nom> --json mergeStateStatus,headRefOid`, premier instrument ;
- la liste des runs : `gh api "repos/<owner>/<nom>/commits/<headRefOid>/check-runs?filter=all" --jq '.check_runs[]|{name,conclusion,started_at,completed_at,suite:.check_suite.id}'` ;
- second instrument, d'un autre chemin : `gh pr merge <n> -R <owner>/<nom> --merge`. Le refus attendu nomme le contexte (« Required status check "Gate" is failing » ou équivalent ; relever le texte tel quel). Une fusion réussie est la preuve.
- Ne jamais conclure sur `statusCheckRollup.state` (piège de C1).

### P1 — résolution entre contextes homonymes (C1b)

Sur `main`, `.github/workflows/real.yml` : `on: pull_request`, `permissions: contents: read`, un job `name: Gate` dont le script attend `$DELAY` secondes, puis échoue si `$TITLE` contient `real-fail`. `DELAY` vaut 120 si le titre contient `real-slow`, 0 sinon. Chaque cas est une PR neuve, qui ajoute `.github/workflows/spoof.yml` (`on: pull_request`, un job `name: Gate`) :

| Cas | Titre de la PR | `real.yml` | `spoof.yml` ajouté par la PR |
| --- | --- | --- | --- |
| K1 | `K1 real-fail` | échoue tout de suite | réussit après `sleep 120` |
| K2 | `K2 real-fail real-slow` | échoue après 120 s | réussit tout de suite |
| K3 | `K3` | réussit tout de suite | échoue après `sleep 120` |
| K4 | `K4 real-fail` | échoue tout de suite | aucun ; un second job `name: Gate` ajouté à `real.yml` par la PR réussit après `sleep 120` (homonymes dans un même fichier) |

Observations attendues, par issue :

- K1 fusionnable, K2 et K3 bloqués : le run terminé le plus tard l'emporte, quel que soit le fichier. A1 ne ferme pas le cas hostile.
- K1, K2 et K3 fusionnables : un succès suffit. A1 ne ferme pas le cas hostile.
- K1, K2 et K3 bloqués, K4 fusionnable : chaque fichier de workflow compte séparément, et dans un fichier le plus récent l'emporte. Le job homonyme d'un autre fichier ne masque pas l'échec : la voie homonyme d'A1 est fermée, sous réserve de P2.
- Toute autre combinaison est relevée telle quelle et n'est pas interprétée.

### P2 — un run `pull_request_target` compte-t-il pour un contexte requis ? (C2b)

Sur `main`, remplacer `real.yml` par `real-prt.yml` : `on: pull_request_target`, `permissions: contents: read`, un job `name: Gate` qui échoue si `$TITLE` contient `real-fail`.

| Cas | Titre | Attendu si C2b passe |
| --- | --- | --- |
| L1 | `L1` | `head_sha` du run égal à `headRefOid` (`gh api "repos/<owner>/<nom>/actions/runs?event=pull_request_target" --jq '.workflow_runs[0].head_sha'`), PR fusionnable |
| L2 | `L2 real-fail` | PR bloquée sur `Gate` |
| L3 | `L3 real-fail`, et la PR ajoute `spoof.yml` (`pull_request`, `name: Gate`, réussit après `sleep 120`) | la forme exacte de la menace C1 contre A1 |

Si L1 reste bloquée, avec le contexte en attente (« Expected »), C2b échoue et A1 est impraticable telle qu'ADR-0060 la décrit. Si L1 et L2 se comportent comme attendu, le résultat de L3 décide si A1 ferme la voie homonyme.

### Retour arrière

Fermer les PR, puis archiver le dépôt jetable (`gh repo archive <owner>/<nom>`) ou le supprimer ; la suppression est un acte du propriétaire. Le ruleset disparaît avec le dépôt. La politique Actions éventuellement créée pour P2 est propre à ce dépôt. Rien n'est modifié dans ce dépôt-ci.

## Ce que signerait la fusion, et ce qui reste au propriétaire

La fusion de cet ADR ne modifie aucun workflow, aucun gate et aucun réglage. Ce qu'elle signe est la question Q3. Les questions sont ordonnées par dépendance : Q1 et Q2 sont indépendantes l'une de l'autre, Q3 dépend de Q1.

1. **Q1, le modèle de menace.** C'est la question 1 d'ADR-0060 (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:185`), toujours ouverte.
   - Si le modèle est l'accident seul : A2 + Bw suffit, et P1 et P2 n'ont pas à être joués.
   - S'il inclut l'auteur hostile : aucune option d'ADR-0060 ne ferme le cas en l'état de la mesure ; A1 ne le pourrait que si P1 et P2 l'y autorisent. P1 et P2 sont à jouer, et la disponibilité de « Require workflows to pass before merging » est à vérifier. Ce sont des actes du propriétaire.
2. **Q2, le cas inverse.** C'est la question 2 d'ADR-0060 (`docs/adr/0060-gates-run-from-the-pull-request-they-judge.md:186`) : D, ou le statu quo avec correction après fusion.
3. **Q3, ce que signe la fusion de cet ADR.** Deux lectures :
   - (a) les mesures C1 à C3 et les trois faits documentés, sans option retenue, sur le précédent de la décision P1 d'ADR-0060 ;
   - (b) les mesures et l'option A2 + Bw retenue. L'ADR deviendrait alors accepté, avec une ligne d'arbitrage et une entrée au registre des décisions.
