# ADR-0043 — Branches inscriptibles de l'autorité : doctrine en attente de signature et branches de session

- **Statut :** proposed — la fusion de cette pull request constitue l'arbitrage propriétaire
- **Arbitrage :** décisions propriétaires du 2026-10-08 : « branche option A », puis l'exclusion des branches de session `work/**`, et enfin le maintien de la branche de doctrine (« option A ») une fois `work/**` ouvert. Les trois modifications de protection ont été exécutées par le propriétaire lui-même. Owner-arbitration: 2026-10-08
- **Applique :** I-17 (surface à touche humaine fermée : registre, ADR et mutations des garde-fous restent sous signature) ; la forme d'ADR-0041 §6 (toute modification de contrôle de protection est nommée, avec son périmètre exact)
- **N'amende pas :** ADR-0041 §6. Son titre « une seule modification de contrôle de protection » décrit le périmètre de l'opération de consolidation du 2026-10-07 — un bypass temporaire sur le profil `libre-ai/.github`, restauré à l'identique — et non une règle permanente qui interdirait toute modification ultérieure. Les trois modifications consignées ici couvrent une autre fenêtre et un autre dépôt
- **Autorise :** l'usage de `doctrine/owner-signature` comme branche de tête des pull requests de doctrine qui attendent la signature du propriétaire ; l'usage d'une branche `work/<session>` par session de travail, supprimée après le merge
- **N'autorise pas :** toute autre modification de ruleset ; la fusion d'une pull request de doctrine sans signature du propriétaire ou son autorisation explicite ; l'usage de `doctrine/owner-signature` pour un changement d'outillage ou de gate ; le partage d'une branche `work/` entre deux sessions

## Contexte

Le ruleset `refoundation-no-bypass-branch` couvre `~ALL` sans acteur de contournement et n'exclut que la branche servie `migrate/recover-code` et `feat/forge-realization`. Cette dernière était donc la seule branche inscriptible du dépôt. Le 2026-10-08, deux sessions y travaillaient pour la première fois en parallèle : une pull request de doctrine en attente de signature (`#16`) occupait la branche, et tout autre travail sur le dépôt devait attendre la signature. Trois issues ont été posées au propriétaire : un second nom de branche exclu du ruleset, une signature rapide, ou la sérialisation acceptée. Il a choisi la première, puis a ouvert le même jour les branches de session `work/**`, qui suppriment la sérialisation pour tout travail. La branche de doctrine a été maintenue ensuite pour la propriété qu'elle seule apporte : son historique ne peut pas être réécrit.

## Décision

Trois modifications de protection, et seulement trois, exécutées par le propriétaire le 2026-10-08 :

1. **Création** du ruleset `doctrine-signature-branch-integrity` (id `24725518`), actif, sans contournement, portant sur la seule ref `refs/heads/doctrine/owner-signature`, avec les règles `deletion` et `non_fast_forward` — le profil exact de `forge-realization-branch-integrity` pour `feat/forge-realization`. Il a été créé **avant** l'exclusion, pour que la branche ne soit jamais sans protection.
2. **Ajout** de `refs/heads/doctrine/owner-signature` aux exclusions de `refoundation-no-bypass-branch` (id `23544600`). Rien d'autre n'a changé : `include: ~ALL`, règles `creation`, `deletion`, `update`, `bypass_actors: []`, `enforcement: active`.
3. **Ajout** de `refs/heads/work/**` aux mêmes exclusions (modification de 15:30:42), sans ruleset d'intégrité : ces branches sont éphémères, donc force-pushables et supprimables. Motif mesuré : la règle `creation` sur `~ALL` ne protégeait pas la branche servie, déjà exclue et gardée par son propre ruleset (`forge-reviewed-recovery-admission` : pull request, check requis `composition / validate`, ni suppression ni non-fast-forward). Les trois branches longues nommées gardent chacune leur ruleset d'intégrité, et son seul effet était de sérialiser le travail parallèle. Sa prémisse — geler les cibles documentaires du 2026-09-16 — ne vaut plus pour l'autorité la plus active de la flotte.

`doctrine/owner-signature` porte les pull requests qui touchent `docs/adr/**`, `docs/decisions/INVARIANTS.md`, `docs/decisions/DECISION-REGISTER.md` ou le LEXICON et qui attendent la signature du propriétaire. Son historique ne peut pas être réécrit : les commits que le propriétaire relit ne peuvent pas être remplacés par un force push avant sa signature. Elle se réaligne sur la base par avance rapide ou par merge signé de `migrate/recover-code`, arbre identique à la base avant le premier commit.

Tout autre travail se fait sur une branche **`work/<session>`, une par session, nommée d'après elle**, créée depuis `migrate/recover-code` et supprimée après le merge. Deux sessions ne partagent jamais une branche `work/` : sans règle de non-fast-forward, l'une écraserait l'autre en silence. `feat/forge-realization` reste une branche longue protégée, qu'il n'est plus nécessaire de se passer entre sessions.

Un `PUT` de ruleset remplace l'objet entier : sa charge se dérive de l'état vivant relu immédiatement avant, et l'état après se compare à l'état avant (aucune exclusion retirée), jamais une liste écrite de mémoire.

Ce qui ne change pas : `bypass_actors` reste `[]` sur les six rulesets, et chaque réponse de modification porte `current_user_can_bypass: "never"`. La branche servie garde la pull request et le check requis. Les tags restent intégralement gelés (`refoundation-no-bypass-tag` : `~ALL`, aucune exclusion, aucun bypass). Les trois branches longues nommées — `feat/forge-realization`, `docs/forge-portfolio-consolidation`, `doctrine/owner-signature` — gardent chacune leur ruleset d'intégrité.

La convention `work/<session>` n'est pas une préférence de rangement : elle remplace, dans cet espace, la protection de non-fast-forward sciemment retirée. C'est ce filet qui, le 2026-10-08, a fait refuser un push par-dessus la pull request d'une autre session sur `feat/forge-realization`.

## Conséquences et limites

Une signature en attente ne bloque plus que les autres changements de doctrine, qui de toute façon se sérialisent par l'arbitrage ; tout le reste avance sur les branches de session. Deux pull requests de doctrine simultanées sur `doctrine/owner-signature` restent impossibles ; ce n'est pas un défaut, la signature étant un acte propriétaire unique à la fois.

La fusion vers `migrate/recover-code` reste gardée par `forge-reviewed-recovery-admission` (check requis `composition / validate`, résolution des fils de revue) : la nouvelle branche n'ouvre aucun chemin d'écriture vers la branche servie.

## Preuves

- Ruleset `refoundation-no-bypass-branch` relu après modification et comparé à l'état relevé avant : identique hors exclusions, une exclusion ajoutée, aucune retirée.
- Règles effectives lues par `GET /repos/libre-ai/project-governance/rules/branches/doctrine/owner-signature` : `deletion` et `non_fast_forward`, toutes deux du ruleset `24725518` ; aucune règle de `refoundation-no-bypass-branch`. La même lecture sur `feat/forge-realization` rend le même profil depuis le ruleset `24161114`.
- Le dépôt compte six rulesets : les cinq antérieurs et `doctrine-signature-branch-integrity`.
- Ordre des deux premières modifications : `created_at` de `24725518` = `2026-10-08T15:24:59.545+02:00` ; réponse du `PUT` ajoutant `doctrine/owner-signature` aux exclusions de `23544600` : `updated_at` = `2026-10-08T15:26:42.653+02:00`. La protection existait donc 103 secondes avant que la branche devienne créable, et la branche n'a été créée qu'après.
- Ruleset `refoundation-no-bypass-branch` relu après la troisième modification : exclusions `migrate/recover-code`, `feat/forge-realization`, `doctrine/owner-signature`, `work/**` ; `include: ~ALL`, règles `creation`, `deletion`, `update`, `bypass_actors: []`.
- Mesure par l'acte, faite par la session qui a exécuté la troisième modification (les lectures `rules/branches` ci-dessus sont une mesure distincte, faite par la session qui rédige cet ADR) :

  | Acte | Résultat |
  | --- | --- |
  | `git push origin HEAD:work/proof-of-namespace` | créée |
  | `git push origin HEAD:chore/should-be-refused` | refusée — « Cannot create ref due to creations being restricted » |
  | `git push origin --delete work/proof-of-namespace` | supprimée |

- Le piège du `PUT` a été rencontré et arrêté : une première charge pour la troisième modification portait une liste d'exclusions écrite de mémoire (deux entrées, alors que le vivant en avait trois depuis la deuxième modification) et aurait re-verrouillé `doctrine/owner-signature` ; une assertion « aucune exclusion retirée » l'a refusée avant l'envoi.
