<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# ADR-0062 — Amendement d'ADR-0060 : option recommandée pour les gates exécutés depuis la pull request, et clôture de ce que l'ADR-0060 laisse ouvert

- **Statut :** accepted — arbitrage du propriétaire du 2026-11-09 en chat ; les deux questions de la section « Ce que le propriétaire tranche » ont reçu la réponse recommandée : accident d'un auteur de confiance seulement (D1), et D pour le cas inverse (D2). D1 à D4 sont en vigueur ; D4 est exécuté dans la même pull request (en-tête d'ADR-0060).
- **Arbitrage :** Owner-arbitration: 2026-11-09 — question structurée en chat (ADR-0022/I-24) : « Accident + D » ; ligne écrite par l'agent sur autorisation explicite du propriétaire le même jour. Rédigé par l'agent sur la consigne « go all » du 2026-11-09 ; la recommandation était de l'agent, la décision est du propriétaire.
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

**Option retenue sous ce modèle : A2 combinée à D.**

- **A2** : les gates requis s'exécutent depuis la base et lisent la pull request comme donnée. Elle ferme l'auto-validation accidentelle (un gate modifié ne se juge pas lui-même) sans marqueur supplémentaire. Elle est combinable avec D, ce que l'ADR-0060 établit.
- **D** : sur `pull_request`, les gates de flotte qui inspectent ce dépôt lisent l'extraction de la pull request au lieu de la branche servie du distant ; les autres dépôts restent lus à leur branche servie. Elle ferme la classe « vert sur la pull request, rouge après fusion » pour le contenu de ce dépôt.

**Écartées, et pourquoi.**

- **B** (échec fermé sur la surface d'un gate sauf marqueur) : l'ADR-0060 mesure 103 pull requests sur 146 qui auraient porté le marqueur ; il deviendrait routinier et perdrait son sens d'arbitrage. Et une session d'agent n'a pas le droit d'écrire ce marqueur : B bloquerait l'agent sur ses propres corrections de gates ou pousserait à l'écrire.
- **C** (statu quo documenté) : ferme rien mécaniquement ; le défaut s'est produit deux fois le même jour.
- **A1** : écartée par l'ADR-0060 tant que deux comportements de GitHub ne sont pas mesurés ; cette mesure n'a pas été faite depuis. Elle reste un remède possible pour les 3 checks qu'elle couvre, après mesure sur un dépôt jetable.

## Décision proposée

- **D1.** Modèle de menace des checks requis : accident d'un auteur de confiance. Réouverture obligatoire de cet ADR avant la première fusion d'une contribution externe.
- **D2.** A2 est l'option de remède pour les checks requis ; D l'est pour les gates de flotte qui lisent ce dépôt. Les deux s'écrivent dans des pull requests distinctes, chacune avec ses tests rouges puis verts, et une mesure avant/après sur une pull request synthétique qui modifie un gate.
- **D3.** Le contexte requis supplémentaire qu'exige D est un acte du propriétaire (ruleset), à poser après la fusion de la pull request de D, jamais avant.
- **D4.** L'ADR-0060 reçoit, à l'acceptation de celui-ci, une ligne « Amendé par : ADR-0062 » dans son en-tête ; sa mesure n'est pas modifiée.

## Ce que le propriétaire tranche

Les deux questions de l'ADR-0060, dans l'ordre ; la seconde ne dépend pas de la première :

1. Modèle de menace : **accident seulement** (recommandé, D1) ou **aussi auteur hostile**. Si hostile : B plutôt qu'A2, et le coût du marqueur routinier est accepté en connaissance de cause.
2. Cas inverse : **D** (recommandé) ou **statu quo avec correction après fusion**.

Réponses du propriétaire, 2026-11-09, question structurée en chat : 1. accident seulement ; 2. D. La recommandation est retenue telle quelle ; rien n'est réécrit.

## Ce qui n'est pas décidé ici

- La forme du code d'A2 et de D : les pull requests d'implémentation, avec leurs tests.
- La mesure des deux comportements de GitHub qui conditionnent A1.
- Le moment où la flotte accepte une contribution externe (ADR-0038).

## Conséquences

- Si accepté : deux pull requests d'outillage dans ce dépôt (workflows et lecteurs de flotte), un contexte requis de plus (acte propriétaire), aucun jeton nouveau.
- Si renversé : l'option retenue par le propriétaire est écrite ici à la place de la recommandation, et le statut passe de proposé à en vigueur dans la même pull request.

## Retour arrière

Porte à deux sens : annuler la fusion rend l'état antérieur. Les pull requests d'implémentation ont chacune leur revert ; le contexte requis se retire par le même acte qui l'a posé.
