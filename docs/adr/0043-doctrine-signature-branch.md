# ADR-0043 — Une branche réservée aux pull requests de doctrine en attente de signature

- **Statut :** proposed — la fusion de cette pull request constitue l'arbitrage propriétaire
- **Arbitrage :** décision propriétaire du 2026-10-08 (« branche option A »), prise par question structurée (ADR-0022/I-24) ; les deux modifications de protection ont été exécutées par le propriétaire lui-même. Owner-arbitration: 2026-10-08
- **Applique :** I-17 (surface à touche humaine fermée : registre, ADR et mutations des garde-fous restent sous signature), ADR-0041 §6 (une modification de contrôle de protection est nommée, avec son périmètre exact)
- **Autorise :** l'usage de `doctrine/owner-signature` comme branche de tête des pull requests de doctrine qui attendent la signature du propriétaire
- **N'autorise pas :** toute autre modification de ruleset ; la fusion d'une pull request de doctrine sans signature du propriétaire ; l'usage de cette branche pour un changement d'outillage ou de gate

## Contexte

Le ruleset `refoundation-no-bypass-branch` couvre `~ALL` sans acteur de contournement et n'exclut que la branche servie `migrate/recover-code` et `feat/forge-realization`. Cette dernière était donc la seule branche inscriptible du dépôt. Le 2026-10-08, deux sessions y travaillaient pour la première fois en parallèle : une pull request de doctrine en attente de signature (`#16`) occupait la branche, et tout autre travail sur le dépôt devait attendre la signature. Trois issues ont été posées au propriétaire : un second nom de branche exclu du ruleset, une signature rapide, ou la sérialisation acceptée. Il a choisi la première.

## Décision

Deux modifications de protection, et seulement deux, exécutées par le propriétaire le 2026-10-08 :

1. **Création** du ruleset `doctrine-signature-branch-integrity` (id `24725518`), actif, sans contournement, portant sur la seule ref `refs/heads/doctrine/owner-signature`, avec les règles `deletion` et `non_fast_forward` — le profil exact de `forge-realization-branch-integrity` pour `feat/forge-realization`. Il a été créé **avant** l'exclusion, pour que la branche ne soit jamais sans protection.
2. **Ajout** de `refs/heads/doctrine/owner-signature` aux exclusions de `refoundation-no-bypass-branch` (id `23544600`). Rien d'autre n'a changé : `include: ~ALL`, règles `creation`, `deletion`, `update`, `bypass_actors: []`, `enforcement: active`.

`doctrine/owner-signature` porte les pull requests qui touchent `docs/adr/**`, `docs/decisions/INVARIANTS.md`, `docs/decisions/DECISION-REGISTER.md` ou le LEXICON et qui attendent la signature du propriétaire. `feat/forge-realization` reste la branche de l'outillage, des gates et de tout changement qui n'attend pas de signature. Les deux branches se réalignent sur la base de la même façon : merge signé de `migrate/recover-code`, arbre identique à la base avant le premier commit.

## Conséquences et limites

Une signature en attente ne bloque plus que les autres changements de doctrine, qui de toute façon se sérialisent par l'arbitrage. Deux pull requests de doctrine simultanées restent impossibles ; ce n'est pas un défaut, la signature étant un acte propriétaire unique à la fois.

La fusion vers `migrate/recover-code` reste gardée par `forge-reviewed-recovery-admission` (check requis `composition / validate`, résolution des fils de revue) : la nouvelle branche n'ouvre aucun chemin d'écriture vers la branche servie.

## Preuves

- Ruleset `refoundation-no-bypass-branch` relu après modification et comparé à l'état relevé avant : identique hors exclusions, une exclusion ajoutée, aucune retirée.
- Règles effectives lues par `GET /repos/libre-ai/project-governance/rules/branches/doctrine/owner-signature` : `deletion` et `non_fast_forward`, toutes deux du ruleset `24725518` ; aucune règle de `refoundation-no-bypass-branch`. La même lecture sur `feat/forge-realization` rend le même profil depuis le ruleset `24161114`.
- Le dépôt compte six rulesets : les cinq antérieurs et `doctrine-signature-branch-integrity`.
