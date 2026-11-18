<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# ADR-0069 — Montées de version bun de ce dépôt : pull requests automatiques avec le jeton éphémère du job

- **Statut :** proposé — l'acceptation est un acte du propriétaire : il ajoute la ligne d'arbitrage datée et remplace ce statut par le littéral `accepted` dans la pull request qu'il fusionne. Tant que ces deux lignes n'ont pas changé, cet ADR n'est pas en vigueur, fusionné ou non, et le workflow `Bun update` n'écrit rien.
- **Arbitrage :** aucun constaté par la rédaction. Le lanceur du lot L126 rapporte une décision du propriétaire du 2026-11-18 : les montées de version bun disponibles sont proposées par pull requests automatiques, écrites avec le jeton éphémère du job. La rédaction n'a pas vu cette décision et ne la consigne pas comme arbitrage. Le propriétaire la confirme, ou non, en signant.
- **Date de rédaction :** 2026-11-18
- **Connexes :** `docs/method/AGENTIC-LOOP-INVENTORY.md` (§ Alerte de récidive, limite 2 ; § Dependabot bun) ; `docs/toolchain/FLEET-BUMP.md` ; `docs/toolchain/BUN-UPDATE.md` ; `ecosystem/check-release-age.ts` ; ADR-0068 (proposé, fusion par un agent : cet ADR n'en dépend pas et n'ouvre aucune fusion).
- **Documents amendés à l'acceptation :** les trois textes de la section « Ce que cet ADR renverse », dans la mesure qu'elle fixe pour chacun.
- **Invariants :** aucun invariant modifié. S'appliquent I-11 (DCO sur chaque commit) et I-17 (l'ADR reste sur la surface à touche humaine).
- **N'autorise pas :** une écriture dans un autre dépôt ; un jeton stocké ; un jeton de flotte ; une montée majeure automatique ; une fusion automatique ; un force push ; une écriture sur la branche servie ; un retour de l'écosystème bun dans Dependabot.

## Vérification empirique

Relevés du 2026-11-18, à rejouer avant de s'en servir.

- **Prémisse :** ce dépôt refuse aujourd'hui qu'un workflow ouvre une pull request.
- **Commande :** `gh api repos/libre-ai/project-governance/actions/permissions/workflow`
- **Sortie relevée :** `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}`. Ce réglage porte dans l'interface le nom « Allow GitHub Actions to create and approve pull requests ». **Conséquence : tant qu'il reste désactivé, le workflow pousse sa branche et ne peut pas ouvrir la pull request.** Le refus par la forge est **inféré** de la documentation : aucun run n'a été lancé.

- **Prémisse :** une pull request ouverte avec `GITHUB_TOKEN` n'exécute pas ses contrôles sans geste humain.
- **Source :** docs.github.com, « Trigger a workflow », section « Triggering a workflow from a workflow », lue le 2026-11-18 : pour `opened`, `synchronize` et `reopened`, « the resulting `pull_request` event creates workflow runs in an approval-required state » ; une personne ayant le droit d'écriture choisit **Approve workflows to run**. Un push fait avec ce jeton ne crée aucun run. Fait **documenté**, non rejoué sur ce dépôt.

- **Prémisse :** les contrôles requis de la branche servie portent sur chaque pull request, sans revue approuvante obligatoire.
- **Commande :** `gh api repos/libre-ai/project-governance/rules/branches/migrate/recover-code --jq '.[]|select(.type=="pull_request" or .type=="required_status_checks")|.parameters'`
- **Sortie relevée :** 7 contrôles requis, `strict_required_status_checks_policy` à `true`, `required_approving_review_count` à `0`.

- **Prémisse :** les manifestes de ce dépôt épinglent des versions exactes.
- **Commande :** `bun tools/fleet/plan-bun-update.ts --root .`
- **Sortie relevée :** `examined: direct=6 up-to-date=3 proposable=3 major-only=0 too-recent=0 not-examined=0 unreadable=0`, puis `proposals: planned=3 prepared=0 failed=0` sans `--out`. Avec `--out`, sur une copie du dépôt, les trois paquets préparés portent chacun une seule ligne de `package.json` modifiée et un `bun.lock` régénéré.

- **Prémisse :** un commit signé sous l'identité du bot satisfait le contrôle DCO de `.github/workflows/ci.yml`.
- **Mesure :** dépôt jetable, `git commit --signoff` sous `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`, puis la règle du contrôle (`Signed-off-by: %an <%ae>` lu par `git interpret-trailers --parse --no-divider`) : code de sortie 0.

## Contexte

Dependabot ne lit pas `bun.lock` en version 2 : l'écosystème bun en a été retiré le 2026-09-08. Depuis, les avis de sécurité sont suivis chaque semaine par `Fleet advisories`, et les montées de version se font par vagues d'agents. Aucun mécanisme ne propose ce qui est disponible.

## Décision

### D1 — Portée : ce dépôt, avec le jeton du job

Le workflow `.github/workflows/bun-update.yml` n'écrit que dans le dépôt qui l'exécute, avec le `GITHUB_TOKEN` du job. Aucun secret n'est créé. `contents: write` et `pull-requests: write` sont déclarés sur le seul job `propose` ; le niveau du workflow n'accorde rien.

### D2 — Classes de montée

Les versions étant exactes, la classe de la montée décide :

- correctif et mineure : une pull request ;
- majeure : listée dans le résumé du job, jamais appliquée ;
- spécificateur non exact, `file:`, `workspace:`, dépendance de pair, paquet épinglé par `overrides` : nommé et compté comme non examiné.

Lecture de l'auteur, à confirmer à la signature : sous 1.0.0, une mineure compte comme majeure, et sous 0.1.0 un correctif aussi, parce que le versionnage sémantique n'y promet aucune compatibilité.

### D3 — Forme des pull requests

Une pull request par montée, sur une branche `work/bun-update/<paquet>@<version>`, jamais sur la branche servie. Pas de force push : une branche existante n'est jamais réécrite. Pas de fusion automatique. La description ouvre sur `Door: two-way` et `Origin: inspection`.

### D4 — Âge minimal de publication

Une version plus jeune que `MINIMUM_RELEASE_AGE_SECONDS` (`ecosystem/check-release-age.ts`) n'est pas proposée. `minimumReleaseAge` de `bunfig.toml` juge aussi la résolution, et `minimumReleaseAgeExcludes` reste vide.

### D5 — Séparation des deux jobs

Le job `plan` lit le registre et régénère `bun.lock` (`--lockfile-only --ignore-scripts`) avec `contents: read`. Le job `propose` détient le jeton, n'installe rien, et revérifie chaque paquet reçu : une seule ligne de manifeste modifiée, aucun fichier en plus, classe, âge et nom de branche recalculés. Les actions sont épinglées par sha.

### D6 — Signature des commits

Chaque commit porte `Signed-off-by` par `git commit --signoff`, sous l'identité `github-actions[bot]` du jeton.

### D7 — Démarrage des contrôles : un geste humain, assumé

Aucun jeton de flotte ni jeton personnel ne contourne l'état « approval-required ». Une personne ayant le droit d'écriture choisit **Approve workflows to run** sur chaque pull request, puis la relit. La description le lui dit. Le coût est un geste par pull request ; ce geste est aussi la relecture humaine que D3 exige de toute façon.

### D8 — Désactivé jusqu'à l'acceptation

Le workflow se lance à la main seulement (`workflow_dispatch`, sans `schedule`), et le job `propose` sort en code 3 sans rien écrire tant que cet ADR n'est pas au statut `accepted`. La fusion de cette pull request ne change donc rien avant la signature.

## Ce que cet ADR renverse

| Texte | Ce qu'il dit | Effet à l'acceptation |
| --- | --- | --- |
| `docs/method/AGENTIC-LOOP-INVENTORY.md`, § Dependabot bun, ligne « Filet pendant la suspension » (décision du 2026-09-08) | « les montées de version bun se font par vagues d'agents, jamais en silence » | **Renversé pour ce dépôt seulement.** Les autres dépôts de la flotte restent aux vagues d'agents. « Jamais en silence » reste vrai : chaque montée est une pull request relue. |
| `docs/toolchain/FLEET-BUMP.md`, § « Apply stays local: no fleet write token in CI » (décision du 2026-10-14) | aucun jeton d'écriture de flotte en CI | **Maintenu sur le fond, précisé.** Cet ADR ne crée aucun jeton de flotte et `FLEET_BUMP_TOKEN` reste non créé. Il ajoute un cas que cette décision ne visait pas : une écriture en CI limitée au dépôt courant, par un jeton qui expire avec le job. |
| En-tête de `.github/dependabot.yml` (décision du 2026-09-08) | « No bun entry, on purpose » ; « bumped by agent waves » | **« No bun entry » reste entier.** « Bumped by agent waves » cesse de décrire ce dépôt seul. Le fichier n'est pas édité : c'est la copie à l'octet près d'un gabarit commun à la flotte (`ecosystem/check-dependabot-conformance.test.ts`), et l'éditer ferait dériver chaque dépôt pour une phrase qui reste vraie chez eux. |

## Limites

- Le réglage de forge relevé plus haut bloque l'ouverture des pull requests tant que le propriétaire ne l'active pas. Sans lui, le job finit en rouge, nomme le réglage et donne l'URL de comparaison : une personne ouvre alors la pull request, et ses contrôles démarrent sans approbation.
- Activer ce réglage autorise aussi un workflow à **approuver** une pull request. Aucun workflow de ce dépôt ne le fait aujourd'hui, et la branche servie n'exige aucune revue approuvante ; le risque est à peser à la signature.
- Les pull requests touchent toutes `bun.lock` : la fusion de l'une met les autres en conflit. Un conflit se règle en fermant la pull request, en supprimant sa branche et en relançant le workflow. Une branche restée sans pull request est signalée en échec, jamais réécrite.
- Une dépendance illisible ou un paquet non préparé arrête le run avant le job `propose` : aucune pull request n'est ouverte sur un relevé incomplet.
- Le job `plan` s'exécute sans jeton d'écriture mais résout des dépendances tierces ; sa sortie est traitée comme une donnée à revérifier. La revérification ne relit pas le contenu de `bun.lock` au-delà de la présence de la version visée : ce contenu reste à la charge de la relecture et des contrôles.
- Le paramètre `require_extra_approval_for_unattributed_changes` de la branche servie est à `true` ; son effet sur un commit de bot n'a pas été mesuré.
- Aucun run réel n'a eu lieu : le câblage est prouvé par des tests de structure, la logique par des fixtures sans réseau.

## Acte de signature

À la charge du propriétaire, dans la pull request qu'il fusionne. Rien de ce qui suit n'est en vigueur avant cet acte.

1. Confirmer ou refuser la décision rapportée, et la lecture de D2 sur les versions inférieures à 1.0.0.
2. Porter l'arbitrage daté sur la ligne « Arbitrage » et faire passer le statut au littéral `accepted`.
3. Décider du réglage « Allow GitHub Actions to create and approve pull requests » : l'activer (pull requests ouvertes par le job, approbation des runs à chaque fois), ou le laisser désactivé (branches poussées par le job, pull requests ouvertes par une personne).
4. Ajouter au registre des décisions, au numéro suivant de la série, l'entrée : « Les montées de version bun correctif et mineure de `libre-ai/project-governance` sont proposées par pull requests automatiques, avec le jeton éphémère du job, sous les bornes d'ADR-0069 ; aucun jeton de flotte, aucune fusion automatique ».
5. Remplacer, dans la ligne « Filet pendant la suspension » de l'inventaire, la mention de proposition par le texte en vigueur, et faire de même dans `docs/toolchain/FLEET-BUMP.md`.
6. Pour une exécution planifiée, ajouter ensuite un `schedule` dans une pull request distincte : `tools/security/scheduled-loop-alerting.test.ts` exige alors les deux étapes d'alerte et `issues: write`.

## Vérification

- `bun test tools/fleet/plan-bun-update.test.ts tools/fleet/propose-bun-update.test.ts tools/quality/bun-update-workflow.test.ts`
- `bun tools/fleet/plan-bun-update.ts --root .` : lecture seule, n'écrit rien sans `--out`.
