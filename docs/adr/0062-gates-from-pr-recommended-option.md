<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# ADR-0062 — Amendement d'ADR-0060 : option recommandée pour les gates exécutés depuis la pull request, et clôture de ce que l'ADR-0060 laisse ouvert

- **Statut :** accepted — arbitrage du propriétaire du 2026-11-09 en chat ; les deux questions de la section « Ce que le propriétaire tranche » ont reçu la réponse recommandée : accident d'un auteur de confiance seulement (D1), et D pour le cas inverse (D2). D1 à D4 sont en vigueur ; D4 est exécuté dans la même pull request (en-tête d'ADR-0060). **Amendé le 2026-11-09, le même jour, après la découverte de la pull request #165** (section « Amendement du 2026-11-09 ») : l'option retenue devient A2 + Bw + D, et la phrase « cette mesure n'a pas été faite depuis » est retirée comme fausse.
- **Arbitrage :** Owner-arbitration: 2026-11-09 — question structurée en chat (ADR-0022/I-24) : « Accident + D » ; ligne écrite par l'agent sur autorisation explicite du propriétaire le même jour. Rédigé par l'agent sur la consigne « go all » du 2026-11-09 ; la recommandation était de l'agent, la décision est du propriétaire. Amendement : Owner-arbitration: 2026-11-09 — seconde question structurée en chat, après restitution des mesures de la pull request #165 et de ses trois options (amender vers A2 + Bw + D en absorbant #165 ; fusionner #165 comme ADR distinct ; laisser 0062 et clore #165) : « Amender 0062 : A2 + Bw + D, absorber #165 ».
- **Date de rédaction :** 2026-11-09
- **Portée :** les six checks requis du ruleset de la branche servie de ce dépôt et les gates de flotte qui lisent ce dépôt. Aucun autre dépôt.
- **Amende :** ADR-0060, section « Ce que la mesure départage, et ce qu'elle laisse au propriétaire » : l'ADR-0060 renvoie le choix « à un ADR ultérieur » qui n'existait pas (dernier numéro 0060, aucun D-xx ne le cite). Celui-ci est cet ADR.
- **Ne modifie pas :** la mesure de l'ADR-0060, qui reste signée ; ADR-0056 et ADR-0059 (bloc de déclaration, chemins gardés) ; les tests des gates existants.
- **Invariants :** aucun invariant modifié.
- **Origine :** inspection, tri des ADR `proposed` du 2026-11-09 (`docs/reviews/adr-proposed-triage-2026-11-09/REVIEW.md`, point 5).

## Contexte

L'ADR-0060 mesure quatre options (A1, A2, B, C, D), écarte A1 sous condition, ne retient rien et pose deux questions au propriétaire : le modèle de menace (accident d'un auteur de confiance, ou aussi auteur hostile), et le traitement du cas inverse (D ou statu quo). Depuis le 2026-10-24, aucune décision n'a été prise, aucun D-xx ne cite l'ADR-0060, et le défaut mesuré reste : un check requis vert sur une pull request qui touche un gate est émis par le code de cette pull request, et un gate de flotte vert sur la pull request peut rougir sur la branche servie après la fusion (cas #141 → #151 et #142 → #154).

Une question laissée ouverte sans date ni porteur est un garde-fou muet : rien ne la rappelle. Cet ADR la ferme en proposant une réponse, que le propriétaire peut retenir ou renverser.

## Recommandation

**Modèle de menace retenu : accident d'un auteur de confiance.** Mesure de l'ADR-0060 : les trois cas observés sont accidentels ; les 100 dernières pull requests fusionnées venaient toutes d'une branche du dépôt, aucune d'un fork ; le ruleset n'admet aucun contournement. Le cas « auteur hostile » suppose une contribution externe, que la flotte n'accepte pas encore (ADR-0038, privé d'abord ; décision du propriétaire du 2026-11-09). Le jour où une contribution externe est acceptée, le modèle de menace change et cet ADR est à rouvrir : c'est une condition écrite, pas un oubli.

**Option retenue sous ce modèle : A2 + Bw + D** (A2 combinée à D à l'acceptation ; Bw ajoutée par l'amendement du 2026-11-09).

- **A2** : les gates requis s'exécutent depuis la base et lisent la pull request comme donnée. Elle ferme l'auto-validation accidentelle (un gate modifié ne se juge pas lui-même) sans marqueur supplémentaire. Elle est combinable avec D, ce que l'ADR-0060 établit. Ce qu'elle laisse ouvert, mesuré par #165 (C1a) : une pull request peut modifier un workflow, ou ajouter un workflow dont un job porte le nom d'un contexte requis ; un run plus récent du même nom, de la même application, sur le même sha, l'emporte sur un échec. Les deux voies passent par `.github/workflows/`.
- **Bw** : B restreinte à `.github/workflows/`. Une pull request qui touche ce répertoire échoue à `Bun quality`, sauf si elle porte l'une des deux preuves que `check-review-evidence.ts` admet déjà : une référence à un artefact sous `docs/reviews/`, ou une ligne `Owner-arbitration:` datée. Elle rend rouges par défaut les deux voies que C1a laisse à A2. Friction mesurée par #165 à la tête `4bb07948c7c6` : 30 des 151 commits de la branche servie depuis le 2026-09-24 touchent ce répertoire, contre 106 pour B entière. Coût inféré, non mesuré par une implémentation : une entrée dans les motifs et les pathspecs gardés de `check-review-evidence.ts`, la déclaration « declared, not gated » de `.github/workflows/` retirée de `check-data-inventory.ts`, et leurs tests ; aucun workflow, aucun contexte requis nouveau, aucun acte sur le ruleset. Avec A2, la surface gardée est lue dans l'outillage de la base : une pull request ne peut plus retirer `.github/workflows/` de la surface dans la pull request même qui modifie un workflow.
- **D** : sur `pull_request`, les gates de flotte qui inspectent ce dépôt lisent l'extraction de la pull request au lieu de la branche servie du distant ; les autres dépôts restent lus à leur branche servie. Elle ferme la classe « vert sur la pull request, rouge après fusion » pour le contenu de ce dépôt.

**Écartées, et pourquoi.**

- **B entière** (échec fermé sur toute la surface d'un gate sauf marqueur) : l'ADR-0060 mesure 103 pull requests sur 146 qui auraient porté le marqueur, #165 en rejoue 106 sur 151 ; il deviendrait routinier et perdrait son sens d'arbitrage. Et une session d'agent n'a pas le droit d'écrire ce marqueur : B bloquerait l'agent sur ses propres corrections de gates ou pousserait à l'écrire. Bw retient la seule surface où ces deux objections pèsent peu : 30 commits sur 151, ceux qui modifient les définitions de CI, que l'inventaire déclare être les gates eux-mêmes.
- **C** (statu quo documenté) : ferme rien mécaniquement ; le défaut s'est produit deux fois le même jour. C1a précise ce qu'un vert ne dit pas : ni que le gate qui l'a émis est celui de la base, ni que le job qui l'a émis est celui du gate.
- **A1** : écartée par l'ADR-0060 tant que deux comportements de GitHub ne sont pas mesurés. La pull request #165 les a mesurés le 2026-10-26 pour partie (section « Amendement du 2026-11-09 ») : le rattachement d'un run `pull_request_target` au sha de tête passe (C2a), la non-application de l'approbation des forks passe (C3), mais la prise en compte d'un tel run pour un contexte requis (C2b) et la règle complète entre contextes homonymes (C1b) restent `unavailable`, et trois faits documentés depuis ADR-0060 lui ajoutent un coût : politique par défaut de GitHub qui bloque `pull_request_target` dans les dépôts publics, appliquée à partir du 2026-12-02 ; cache en lecture seule ; `actions/checkout` qui refuse par défaut la tête d'un fork. Sous le modèle « accident », A1 n'a pas d'objet. Elle ne redevient candidate que si cet ADR est rouvert (D1), et seulement si les protocoles P1 et P2 de #165, actes du propriétaire sur un dépôt jetable, l'y autorisent.

## Décision proposée

- **D1.** Modèle de menace des checks requis : accident d'un auteur de confiance. Réouverture obligatoire de cet ADR avant la première fusion d'une contribution externe.
- **D2.** A2 + Bw est l'option de remède pour les checks requis (amendé le 2026-11-09 : A2 seule à l'acceptation) ; D l'est pour les gates de flotte qui lisent ce dépôt. Les trois s'écrivent dans des pull requests distinctes, chacune avec ses tests rouges puis verts, et une mesure avant/après sur une pull request synthétique qui modifie un gate. Ordre : **Bw avant A2**, parce que la pull request d'A2 touche 7 workflows et doit elle-même passer sous Bw ; tant qu'A2 n'est pas fusionnée, la surface de Bw reste lue à la tête de la pull request, limite que son en-tête déclare (issue #152).
- **D3.** Le contexte requis supplémentaire qu'exige D est un acte du propriétaire (ruleset), à poser après la fusion de la pull request de D, jamais avant.
- **D4.** L'ADR-0060 reçoit, à l'acceptation de celui-ci, une ligne « Amendé par : ADR-0062 » dans son en-tête ; sa mesure n'est pas modifiée.

## Ce que le propriétaire tranche

Les deux questions de l'ADR-0060, dans l'ordre ; la seconde ne dépend pas de la première :

1. Modèle de menace : **accident seulement** (recommandé, D1) ou **aussi auteur hostile**. Si hostile : B plutôt qu'A2, et le coût du marqueur routinier est accepté en connaissance de cause.
2. Cas inverse : **D** (recommandé) ou **statu quo avec correction après fusion**.

Réponses du propriétaire, 2026-11-09, question structurée en chat : 1. accident seulement ; 2. D. La recommandation est retenue telle quelle ; rien n'est réécrit.

## Amendement du 2026-11-09 : mesures de la pull request #165, absorbées

**Défaut qui motive l'amendement.** Cet ADR a été rédigé et accepté le 2026-11-09 sans consulter les pull requests ouvertes du dépôt. La pull request #165 (branche `work/adr-gates-run-from-pr-measured-2026-10-26`, ouverte le 2026-10-26, proposant un ADR numéroté 0062 lui aussi) avait déjà mesuré les comportements de GitHub qu'ADR-0060 laissait ouverts et recommandait A2 + Bw. La phrase « cette mesure n'a pas été faite depuis » de la version acceptée était donc fausse. Le propriétaire a tranché par question structurée : amender cet ADR, absorber #165, la clore sans fusion. La mesure complète (relevés par pull request, commandes, protocoles) reste lisible dans la pull request #165 close ; cette section en reprend ce qui change la décision.

**Instruments de #165, tous en lecture (2026-10-26, tête `4bb07948c7c6` de la branche servie)** : documentation GitHub par son API de contenu ; runs et check runs de ce dépôt par `gh api` ; ruleset `24161111` et son historique ; dépôts publics tiers nommés quand la flotte n'a aucune occurrence du comportement (0 run `pull_request_target` sur 33 dépôts de l'organisation et du compte personnel).

| # | Comportement supposé | Instrument | Résultat | État |
| --- | --- | --- | --- | --- |
| C1a | un job homonyme peut peser sur le contexte requis | check runs des 151 têtes de pull request, historique du ruleset | un échec suivi d'un succès du même nom, même application, même sha, ne bloque pas la fusion (#77, #115, #131, #142), entre deux runs ou deux tentatives d'un même fichier de workflow ; les quatre ont été fusionnées avec un run requis en échec sur leur tête | pass |
| C1b | règle complète : succès puis échec, et deux fichiers de workflow distincts | aucun cas sur 151 têtes ; documentation : « ambiguous status check results » | non départagé | unavailable — protocole P1 de #165 |
| C2a | le run `pull_request_target` est rattaché au sha de tête | runs et check suites de trois dépôts publics tiers (`grafana/grafana`, `python/cpython`, `vercel/next.js`) | rattaché à la tête de la pull request, fork compris, et non au dernier commit de la branche par défaut | pass |
| C2b | ce run compte pour un contexte requis | documentation ; 0 cas observé sur 18 dépôts tiers examinés | documenté seulement | unavailable — protocole P2 de #165 |
| C3 | l'approbation des forks ne s'applique pas à `pull_request_target` | documentation ; runs de `vercel/next.js` | « will always run, regardless of approval settings » ; 12 pull requests de fork sur 12 : runs `pull_request` en `action_required`, run `pull_request_target` exécuté | pass |

**Trois faits documentés depuis ADR-0060** (page « Securely using pull_request_target », lue le 2026-10-26) : une politique par défaut bloque `pull_request_target` dans les dépôts publics, en mode `evaluate` aujourd'hui, appliquée le 2026-12-02 (ce dépôt est public, ses politiques Actions de dépôt sont vides, celles de l'organisation ne sont pas lisibles sans `admin:org`) ; le cache est en lecture seule pour `pull_request_target`, ce qui ferme le risque d'empoisonnement qu'ADR-0060 comptait à A1 ; `actions/checkout` refuse par défaut la tête d'une pull request de fork (`allow-unsafe-pr-checkout`).

**Piège d'instrument relevé par #165** : `statusCheckRollup.state` compte l'échec ancien que les fusions de #77, #115, #131 et #142 montrent sans effet ; il ne dit pas le verdict du ruleset. Toute mesure future lit `mergeStateStatus` et une tentative de fusion, jamais le rollup.

**Mécanisme hors options, relevé sans être évalué** : la règle de ruleset « Require workflows to pass before merging » (Enterprise Cloud) désigne un fichier de workflow et non un nom de contexte ; seul mécanisme documenté que C1 ne contourne pas. L'organisation est au plan `team` : disponibilité `unavailable`, acte du propriétaire s'il est un jour évalué.

**Ce que l'amendement change** : l'option retenue (A2 + Bw + D au lieu d'A2 + D), D2 (ordre Bw avant A2), la ligne d'écartement d'A1 (mesurée pour partie, non « non mesurée »), et la liste de ce qui n'est pas décidé. D1, D3 et D4 ne changent pas. La ligne « Amendé par » d'ADR-0060 est mise à jour dans la même pull request.

## Ce qui n'est pas décidé ici

- La forme du code de Bw, d'A2 et de D : les pull requests d'implémentation, avec leurs tests.
- C1b et C2b : les protocoles P1 et P2 de la pull request #165 (dépôt public jetable, ruleset avec le seul contexte `Gate`, cas K1-K4 et L1-L3, lecture par `mergeStateStatus` et tentative de fusion) sont des actes du propriétaire. Sous le modèle « accident » (D1), ils n'ont pas à être joués ; ils le deviennent à la réouverture de cet ADR. Si P2 est joué, il l'est avant le 2026-12-02 ou après la création d'une politique Actions de dépôt qui autorise `pull_request_target`, et le relevé dit laquelle des deux conditions valait.
- Le moment où la flotte accepte une contribution externe (ADR-0038).

## Conséquences

- Si accepté : trois pull requests d'outillage dans ce dépôt, dans l'ordre Bw (motifs et pathspecs de `check-review-evidence.ts`, inventaire, tests ; environ 30 commits sur 151 auraient attendu une preuve de revue), A2 (7 workflows et 2 scripts, plus une entrée facultative dans le contrat de `validate-composition.yml`, appelé par 14 dépôts de la flotte) et D (lecteurs de flotte) ; un contexte requis de plus pour D (acte propriétaire), aucun jeton nouveau, aucune dérogation à une protection de GitHub.
- Si renversé : l'option retenue par le propriétaire est écrite ici à la place de la recommandation, et le statut passe de proposé à en vigueur dans la même pull request.

## Retour arrière

Porte à deux sens : annuler la fusion rend l'état antérieur. Les pull requests d'implémentation ont chacune leur revert ; le contexte requis se retire par le même acte qui l'a posé.
