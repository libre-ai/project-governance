<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: see the candidate-integration pass below

# Revue du gate `check-adr-supersession` et des marqueurs inverses posés sur les ADR

**Date :** 2026-11-17
**Objet :** la branche `work/adr-supersession-gate` : un gate qui exige qu'une ADR modifiée par une ADR en vigueur le dise dans son propre en-tête, ses tests, son câblage dans `bun run check`, et les marqueurs posés sur les ADR qu'il trouve en défaut.
**Protocole :** `docs/reviews/AGENT-REVIEW-PROTOCOL.md`. Rôles séparés : chaque passe est un sous-agent Claude Code en lecture seule qui n'a pas écrit le changement, mandaté pour réfuter ; son rapport est rendu en texte, recoupé au grep par l'orchestrateur, puis consigné ici. La fusion de la pull request reste la signature du propriétaire.
**Base :** `git rev-parse origin/migrate/recover-code` (branche servie : `git ls-remote --symref origin HEAD`).

## Pourquoi ce gate

Un agent lit une ADR isolément. Avant ce changement, ADR-0018 disait `Statut : accepted` sans rien dire de la supersession de son cadre de vagues par ADR-0020 §2.2 ; la déclaration n'existait que dans l'ADR la plus récente. Mesure sur l'arbre de la base, avec le gate final : `ADR supersession failed: 17 of 30 assertion(s) did not hold` — 14 amendements (sur 11 ADR) invisibles depuis l'ADR amendée, et 3 champs aller (ADR-0020, ADR-0023, ADR-0030) qui ne nommaient aucune ADR. Commande : `git stash push -- docs/adr && bun tools/quality/check-adr-supersession.ts; git stash pop`. Sur la base, 9 ADR portaient déjà un marqueur inverse (ADR-0005 dans son statut ; 0042, 0043, 0044, 0049, 0054, 0055, 0060, 0064 sous `Amendé par`), mesure du second relecteur : `grep -l -E "\*\*(Amendé|Supersédé|Remplacé)[^*]*par" docs/adr/*.md`.

## Passes préliminaires sur index non commité — non valides comme verdict

Les deux premières passes ont porté sur l'index, pas sur un commit : le protocole les déclare invalides comme verdict (« reviews a mutable/uncommitted target is invalid »), ce que la seconde a relevé elle-même. Leurs constats sont gardés parce qu'ils ont été corrigés ; le verdict qui fait foi est celui de la passe `candidate-integration` ci-dessous, sur SHA.

### Passe préliminaire 1 — `fail`

Bloquants :

1. `docs/adr/0001-…md:4` — le marqueur « Amendé par : ADR-0035 (décision 11 et conséquence de D16 relative au provisioning) » attribuait à ADR-0001 une clause qu'il ne porte pas : `grep -n "D16" docs/adr/0001-*.md` ne trouvait que le marqueur ; ADR-0035:11 amende « ADR-0001 décision 11, I-07 et la conséquence de D16 », trois objets distincts.
2. ADR-0030 → ADR-0018 D2 — amendement réel (titre « Amendement d'ADR-0018 D2 ») non vu : le champ aller ne nommait aucune ADR et le gate rangeait ces champs dans un compteur sans échec ; la fixture de la « forme ADR-0030 » ne correspondait pas au vrai ADR-0030.

Non bloquants : libellé parasite (`**Rust** (axum…) … : **renversé**` dans ADR-0063 avalait ADR-0058 et ADR-0032 ; `le **worker** :` dans ADR-0058) ; renvoi détecté sur le seul littéral `voir §` ; libellés `Lève` (ADR-0052) et `Rend caduque` (ADR-0009) non lus ; D3 divergent entre ADR-0020 et ADR-0018 ; « ADR-0039 (topologie) » imprécis ; « §2.2 » ambigu ; nom de liste d'exemptions hors du recensement de `check-data-inventory.ts` ; espace manquante dans `package.json` ; fixture contredisant une exemption ; chiffre d'en-tête décrivant l'état après le diff ; un mutant survivant.

### Passe préliminaire 2 — `fail`

Toutes les corrections de code de la passe 1 vérifiées, 7 mutants rejoués avec les comptes annoncés. Bloquants :

1. `docs/adr/0041-…md:4` — le marqueur « ADR-0042 (préambule « N'autorise pas », pour le seul domaine Connaissance, §7) » couvrait les quatre interdits du préambule d'ADR-0041:10, quand le champ aller d'ADR-0042:7 n'en amende qu'un : « aucun transfert d'autorité au-delà des transferts tracés ».
2. Protocole — revue d'un index non commité (ci-dessus).

Non bloquants : « §7 » sur ADR-0041 et « D1 » d'ADR-0039 cités sans le numéro de leur ADR ; marqueur d'ADR-0018 plus affirmatif que sa source (« passe à » contre « est le candidat qui remplace ») ; trois mutants survivants (déclaration de champ sans comparaison de libellé, `INVERSE_LABEL` sans « par », `isInForce` sans ancre) ; recensement daté de `check-data-inventory.ts` non mis à jour ; commentaire d'en-tête du gate sans `Lève` ni `Rend caduque` ; fixture « a mandate, gone since » trompeuse. Pour information du propriétaire : le diff réécrit le champ aller d'ADR acceptées (0020, 0023, 0030), au-delà de l'ajout de marqueurs, et édite l'en-tête d'ADR-0056, dont ADR-0059 dit « Le texte d'ADR-0056 n'est pas édité ».

## Dispositions (ADR-0056 D2)

| Constat | Disposition | Ce qui a été fait |
| --- | --- | --- |
| P1-B1 — D16 sur ADR-0001 | blocking defect, corrigé | Le marqueur ne porte plus que « décision 11 ». |
| P1-B2 — ADR-0030 → ADR-0018 D2 | blocking defect, corrigé | Tout champ aller sans ADR échoue, sauf déclaration nominative dans `EXEMPT_NON_ADR_FIELDS` (0008 et 0042 `Remplace`, 0048 `Amende`, 0009 `Rend caduque`, chacune avec ce qu'elle modifie à la place). Le champ d'ADR-0030 nomme ADR-0018 D2 ; ADR-0018 porte « Amendé par : ADR-0030 (D2 …) ». La fixture reprend le vrai libellé. |
| P2-B1 — ADR-0041 trop large | blocking defect, corrigé | « dans le préambule « N'autorise pas », le seul interdit « aucun transfert d'autorité au-delà des transferts tracés », pour le seul domaine Connaissance ; détail en ADR-0042 §7 ». |
| P2-B2 — index non commité | blocking defect, corrigé | Travail commité, arbre propre, passe `candidate-integration` sur le SHA ci-dessous. |
| Libellé parasite | suggestion, appliquée | Un libellé commence par une majuscule et ne contient ni deux-points ni parenthèse. Sur le corpus, l'ancien motif lit exactement 2 libellés de plus que le nouveau, `worker` (0058) et le fragment d'ADR-0063 (passe 2 : 467 contre 465 sur l'index, 450 contre 448 sur la base ; aucun autre libellé perdu). |
| Renvoi `voir §` seulement | sans objet | La notion de renvoi est retirée : tout champ aller sans ADR échoue (test sur `voir §2`, `cf. §2` et un texte libre). |
| `Lève`, `Rend caduque` | suggestion, appliquée | Ajoutés aux libellés aller. `Étend`, `Généralise`, `Précise`, `Élargit`, `Confirme`, `Applique` restent hors du gate : ils ajoutent à leur cible sans rendre faux ce qu'elle dit. |
| D3, « ADR-0039 », « §2.2 », « §7 » | suggestion, appliquée | ADR-0020 dit « ADR-0018 (cadre de vagues ; D3) » ; les marqueurs écrivent « ADR-0039 D1 », « détail en ADR-0020 §2.2 », « ADR-0023 §2.2 », « détail en ADR-0042 §7 ». |
| Marqueur d'ADR-0018 affirmatif | suggestion, appliquée | « `harness-profile.v2` est le candidat qui remplace `harness-profile-v1`, par successeur majeur, jamais en place ». |
| Mutants survivants (passes 1 et 2) | required evidence, fournie | Trois tests ajoutés ; voir les mutants ci-dessous. |
| Recensement des exemptions | suggestion, appliquée | `EXEMPT_NOT_AMENDMENTS`, `EXEMPT_NON_ADR_FIELDS` (radical `EXEMPT`) ; ajoutées, datées, au recensement de `check-data-inventory.ts`. |
| `package.json`, fixtures, commentaires | suggestion, appliquée | Espace, fixtures 0055 et 0042 remplacées par des numéros qu'aucune exemption ne porte, en-tête du gate citant la base (17/30) et les cinq libellés. |
| ADR-0002 modifiée via D16 par ADR-0035 | ouvert, propriétaire | Le registre ne nomme pas la source de D16 (hypothèse du relecteur : ADR-0002). Hors gate tant qu'ADR-0035 ne nomme pas ADR-0002. |
| « ADR 0013 à 0017 » dans ADR-0023 | ouvert, propriétaire | 0013 à 0016 portent « Requalifié `deferred` par ADR-0023 » sous une forme que le gate ne lit pas ; ADR-0017 dit encore `accepted` alors qu'ADR-0023 §2.5 le requalifie. |
| K4 d'ADR-0009 §6 redéfini par ADR-0023 §2.4 sous « Étend » | ouvert, propriétaire | Le gate lit le libellé que l'ADR source déclare ; requalifier « Étend » en « Amende » est un acte de doctrine. |
| ADR-0065, 0066, 0067 fusionnées au statut « proposé » | ouvert, propriétaire | `isInForce` exige `accepted`. Si elles passent `accepted`, le gate exigera « Amendé par : ADR-0065 » sur ADR-0042. |
| Libellé inverse « Amendé par » face à « Supersède de manière bornée » (ADR-0023 → 0009, 0020) | ready | Le titre d'ADR-0023 §2.2 dit « ADR-0009/ADR-0020 amendés » ; le gate accepte tout libellé inverse. |
| Édition d'en-têtes d'ADR acceptées, dont ADR-0056 | ouvert, propriétaire | Précédent : ADR-0042 et ADR-0055 portent déjà « Amendé par » sur leur statut, ADR-0063 le prescrit pour ADR-0042 ; ADR-0059 dit ne pas éditer le texte d'ADR-0056, ce diff n'en touche que l'en-tête. La fusion tranche. |

## Preuves sur l'arbre commité

- Tests : `bun test tools/quality/check-adr-supersession.test.ts` → `28 pass`, `0 fail`.
- Gate : `bun tools/quality/check-adr-supersession.ts` → `ADR supersession verified: 35 assertion(s) hold — 68 numbered ADR(s) read (62 in force; proposed and deferred ones bind nothing yet); 24 forward field(s): 28 pair(s) marked on the target, 3 declared non-amendment pair(s), 4 declared field(s) amending no ADR; 1 file(s) without an NNNN- number, not checked: docs/adr/2026-09-29-portfolio-consolidation.md`.
- Mutants (ligne décisive remplacée par substitution, tests relancés, original restauré et comparé par `cmp`) : inverse jamais vérifié → 3 échecs ; champ sans ADR jamais signalé → 1 ; ADR proposées lues en vigueur → 1 ; exemption de paire périmée ignorée → 1 ; ancien motif de libellé → 2 ; exemption de champ périmée ignorée → 1 ; `Lève`/`Rend caduque` non lus → 1 ; déclaration de champ sans comparaison de libellé → 1 ; `INVERSE_LABEL` sans « par » → 1 ; `isInForce` sans ancre → 1. Aucun survivant connu.
- Suite complète : `check:toolchain`, `check:attestation` et 8 tests de `bun test` échouent à l'identique sur la base (Bun local 1.4.4 contre 1.4.0 épinglé ; `mktemp` refusé sous `/var/folders` par le bac à sable ; GraphQL injoignable). Tous les autres maillons de `bun run check` rendent 0.

## Passe candidate-integration sur SHA

Consignée dans le commit qui suit le commit revu.
