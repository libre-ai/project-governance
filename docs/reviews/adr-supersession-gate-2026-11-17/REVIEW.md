<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-minor-reservations (candidate-integration pass `adr-supersession-gate-cir-2`, below)

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

1. `docs/adr/0001-…md:4` (ligne de l'index revu par cette passe ; le marqueur est en ligne 3 depuis cir-1 M1) — le marqueur « Amendé par : ADR-0035 (décision 11 et conséquence de D16 relative au provisioning) » attribuait à ADR-0001 une clause qu'il ne porte pas : `grep -n "D16" docs/adr/0001-*.md` ne trouvait que le marqueur ; ADR-0035:11 amende « ADR-0001 décision 11, I-07 et la conséquence de D16 », trois objets distincts.
2. ADR-0030 → ADR-0018 D2 — amendement réel (titre « Amendement d'ADR-0018 D2 ») non vu : le champ aller ne nommait aucune ADR et le gate rangeait ces champs dans un compteur sans échec ; la fixture de la « forme ADR-0030 » ne correspondait pas au vrai ADR-0030.

Non bloquants : libellé parasite (`**Rust** (axum…) … : **renversé**` dans ADR-0063 avalait ADR-0058 et ADR-0032 ; `le **worker** :` dans ADR-0058) ; renvoi détecté sur le seul littéral `voir §` ; libellés `Lève` (ADR-0052) et `Rend caduque` (ADR-0009) non lus ; D3 divergent entre ADR-0020 et ADR-0018 ; « ADR-0039 (topologie) » imprécis ; « §2.2 » ambigu ; nom de liste d'exemptions hors du recensement de `check-data-inventory.ts` ; espace manquante dans `package.json` ; fixture contredisant une exemption ; chiffre d'en-tête décrivant l'état après le diff ; un mutant survivant.

### Passe préliminaire 2 — `fail`

Toutes les corrections de code de la passe 1 vérifiées, 7 mutants rejoués avec les comptes annoncés. Bloquants :

1. `docs/adr/0041-…md:4` (ligne de l'index revu par cette passe ; le marqueur est en ligne 3 depuis cir-1 M1) — le marqueur « ADR-0042 (préambule « N'autorise pas », pour le seul domaine Connaissance, §7) » couvrait les quatre interdits du préambule d'ADR-0041:10, quand le champ aller d'ADR-0042:7 n'en amende qu'un : « aucun transfert d'autorité au-delà des transferts tracés ».
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
| « ADR 0013 à 0017 » dans ADR-0023 | corrigé (cir-1 m4) | Le champ aller d'ADR-0023 ne nomme plus que ADR-0009 et ADR-0020, comme son §2.2 ; la requalification des ADR 0013 à 0017 reste au §2.5 et dans le champ « Portée ». Ces ADR portent déjà la trace de l'arbitrage (0013 à 0015 « Requalifié `deferred` par ADR-0023 », 0016 `deferred`, 0017 l'arbitrage au fond du 2026-08-18 en §Résolution), sous une forme que le gate ne lit pas. |
| K4 d'ADR-0009 §6 redéfini par ADR-0023 §2.4 sous « Étend » | ouvert, propriétaire | Le gate lit le libellé que l'ADR source déclare ; requalifier « Étend » en « Amende » est un acte de doctrine. |
| ADR proposées, dont 0065, 0066, 0067 fusionnées au statut « proposé » | ouvert, propriétaire | `isInForce` exige `accepted`. Sonde de cir-1 lisant « proposé » comme en vigueur : `failed: 5 of 44` — ADR-0042 changée par ADR-0063, ADR-0064 et ADR-0065 ; ADR-0058 et ADR-0032 changées par ADR-0063. Chaque acceptation exigera ces marqueurs dans la même pull request. |
| Libellé inverse « Amendé par » face à « Supersède de manière bornée » (ADR-0023 → 0009, 0020) | ready | Le titre d'ADR-0023 §2.2 dit « ADR-0009/ADR-0020 amendés » ; le gate accepte tout libellé inverse. |
| Édition d'en-têtes d'ADR acceptées, dont ADR-0056 | ouvert, propriétaire | Précédent : ADR-0042 et ADR-0055 portent déjà « Amendé par » sur leur statut, ADR-0063 le prescrit pour ADR-0042 ; ADR-0059 dit ne pas éditer le texte d'ADR-0056. Depuis cir-1 M1, chaque marqueur s'écrit sur la dernière ligne existante du statut et aucune ligne d'ADR ne bouge (`git diff --numstat` : `+N −N` sur chacune des 15 ADR). La fusion tranche. |
| cir-1 M1 — 27 citations `chemin:ligne` décalées d'une ligne | blocking defect, corrigé | Marqueurs écrits en ligne sur le statut, en-tête d'ADR-0023 ramené à deux lignes. Mesure : les 20 citations distinctes vers les 15 ADR modifiées couvrent 114 lignes, toutes identiques entre la base et la branche ; le même instrument sur `a8ab128` en trouvait 114 sur 114 différentes. Commande : `git grep -hoE` des citations vers les fichiers de `git diff --name-only`, puis `sed -n "${n}p"` sur `git show <base>:<f>` et sur l'arbre. Le gate le dit dans son commentaire d'en-tête. |
| cir-1 m1 — partie CLI non testée, 5 mutants survivants | required evidence, fournie | La construction du rapport est une fonction pure, `buildReport`, testée : chaque catégorie de défaut est un échec, et seulement elles. Tests ajoutés pour la ligne vide et la citation `>` qui ferment une puce. |
| cir-1 m2 — marqueur d'ADR-0056 plus large que la source | suggestion, appliquée | « D5, « un gate les confrontera au diff » et l'absence de déclaration précisés, la gravité `blocking` d'une négative démentie inchangée ». |
| cir-1 n1 — « checked in both directions » | suggestion, appliquée | Le commentaire dit que seul le sens aller → inverse est exigé. |
| cir-1 n2 — toute mention dans un champ inverse vaut marqueur | suggestion, appliquée | Les ADR nommées entre parenthèses (les clauses) ne comptent plus ; test sur la forme d'ADR-0064. |
| cir-1 n3 — « §5 » sur ADR-0008 | suggestion, appliquée | « point 5 ». |
| cir-1 n5 — « one ADR out of 69 » | suggestion, appliquée | « 9 of 69 ADRs already carried an inverse marker ». |
| cir-1 n4 — chiffre de Google non vérifié par le relecteur | ready | DNS refusé dans le bac à sable du relecteur ; l'article a été lu par l'orchestrateur en début de session (« 41% chase closed dead ends »). |

## Passe candidate-integration `adr-supersession-gate-cir-1` — `reject`

- **reviewedCommit :** `a8ab128ff5955b5355393577925437f20cc91bae` ; **base :** `67ca6d146f709ec3d37c06558398422bbec28dd9` ; modèle `claude-opus-5-5`, autres identifiants non exposés.
- Ce verdict n'est pas une approbation de promotion par rôle.
- **Major M1** : les marqueurs ajoutaient une ligne d'en-tête à 14 ADR et décalaient 27 citations `chemin:ligne` dans quatre ADR acceptées (ADR-0059 vers ADR-0056 et ADR-0050, ADR-0058, ADR-0045 et ADR-0046 vers ADR-0032) ; `check-pinned-citations` ne le voit pas. Exemple : ADR-0058:7 cite `0032…md:41` pour « D1 » ; sur `a8ab128` la ligne 41 est vide.
- **Minor** m1 à m4, **non-blocking** n1 à n5 : voir le tableau des dispositions.
- Vérifiés : toutes les dispositions des passes préliminaires, sauf « aucun survivant connu » (faux, m1), la ligne ADR 0013 à 0017 (m4), la ligne des ADR proposées (m3) et la ligne d'édition d'en-tête (conséquence M1 non dite) ; marqueurs exacts sauf m2 ; `check-data-inventory` à 42 ; sécurité, performance, souveraineté : rien ne s'y oppose. `bun test` complet : 5277 pass / 8 fail, les 8 rejoués sur la base, mêmes noms.

## Preuves sur l'arbre commité

- Tests : `bun test tools/quality/check-adr-supersession.test.ts` → `32 pass`, `0 fail`.
- Gate : `bun tools/quality/check-adr-supersession.ts` → `ADR supersession verified: 35 assertion(s) hold — 68 numbered ADR(s) read (62 in force; proposed and deferred ones bind nothing yet); 24 forward field(s): 28 pair(s) marked on the target, 3 declared non-amendment pair(s), 4 declared field(s) amending no ADR; 1 file(s) without an NNNN- number, not checked: docs/adr/2026-09-29-portfolio-consolidation.md`.
- Mutants (ligne décisive remplacée par substitution, tests relancés, original restauré et comparé par `cmp`) : inverse jamais vérifié → 3 échecs ; champ sans ADR jamais signalé → 1 ; ADR proposées lues en vigueur → 1 ; exemption de paire périmée ignorée → 1 ; ancien motif de libellé → 2 ; exemption de champ périmée ignorée → 1 ; `Lève`/`Rend caduque` non lus → 1 ; déclaration de champ sans comparaison de libellé → 1 ; `INVERSE_LABEL` sans « par » → 1 ; `isInForce` sans ancre → 1. Après cir-1 : ligne vide qui ne ferme plus la puce → 1 ; `>` qui ne ferme plus la puce → 1 ; puce non marquée rapportée en succès → 1 ; champ sans ADR rapporté en succès → 1 ; exemptions périmées rapportées en succès → 1 ; mentions entre parenthèses comptées → 1. Les mutants énumérés ici sont tous tués ; ce n'est pas une preuve qu'il n'en existe pas d'autres.
- Citations : 20 citations distinctes vers les 15 ADR modifiées, 114 lignes, toutes identiques entre la base et la branche (0 sur 114 sur `a8ab128`).
- Suite complète : `check:toolchain`, `check:attestation` et 8 tests de `bun test` échouent à l'identique sur la base (Bun local 1.4.4 contre 1.4.0 épinglé ; `mktemp` refusé sous `/var/folders` par le bac à sable ; GraphQL injoignable). `check:pinned-citations` est `unavailable` dans ce bac à sable, sur la base comme sur la branche : `hardenedGitEnvironment` ne transmet pas les variables de proxy au git fils, d'où `repository-unreachable` sur 256 des 297 assertions, alors qu'un `git ls-remote` lancé directement répond ; la CI en est l'instrument. Tous les autres maillons de `bun run check` rendent 0.

## Passe candidate-integration `adr-supersession-gate-cir-2` — `approve-with-minor-reservations`

- **reviewedCommit :** `1b47f615768316d0374b7082316673b669991800` ; **base :** `67ca6d146f709ec3d37c06558398422bbec28dd9` ; modèle `claude-opus-5-5`, autres identifiants non exposés.
- Ce verdict n'est pas une approbation de promotion par rôle.
- Aucun blocking defect, aucune required evidence ouverte.
- Dispositions de cir-1 : M1, m1, m2, m4, n1, n2, n3 et n5 tenus ; m3 tenu et ouvert au propriétaire ; n4 vérifié par le relecteur (page lue, « 41% chase closed dead ends, 57% trigger scope creep »).
- Mesures du relecteur :
  - tests du gate : 32 pass ;
  - gate : 35 assertions sur le commit revu, `failed: 17 of 30` sur l'arbre de la base ;
  - citations : 21 citations distinctes, 117 lignes, 0 différente (117 sur `a8ab128`) ;
  - 9 mutants, dont 8 tués ;
  - `bun run check` maillon par maillon : rouges identiques sur la base (`check:toolchain`, `check:attestation`, 8 tests aux mêmes noms), 36 autres maillons à 0 ;
  - `check:pinned-citations` `unavailable` des deux côtés.
- Risques laissés au propriétaire, inchangés : édition d'en-têtes d'ADR acceptées dont ADR-0056 (le relecteur la juge dans le périmètre : précédents sur 0042, 0044, 0049, 0054, 0055, 0060, et aucun invariant d'immuabilité), ADR proposées (« 5 of 44 »), ADR-0002 et D16, K4 sous « Étend ».

| Constat cir-2 | Disposition | Suite |
| --- | --- | --- |
| S1 — plancher `Math.max(0, depth - 1)` de `outsideParentheses` non testé, mutant survivant | suggestion, appliquée | Test « a stray closing parenthesis does not let the next clause count as a marker ». Sans le mutant : `33 pass`, `0 fail`. Avec le mutant `depth = depth - 1` : `32 pass`, `1 fail`, sur ce test. Le gate est restauré à l'identique (`cmp`, puis `git diff --exit-code` sur le gate). |
| S2 — `0001…md:4` et `0041…md:4` cités par les passes préliminaires, lignes déplacées depuis M1 | suggestion, appliquée | Les deux citations précisent qu'elles visent l'index revu par la passe, et que le marqueur est en ligne 3. |

Le commit qui consigne ce verdict ne touche que ce fichier et `tools/quality/check-adr-supersession.test.ts` (un test ajouté) : aucun changement normatif après le verdict (`AGENT-REVIEW-PROTOCOL.md`, « Any normative change after a verdict makes affected approval stale »). Le gate et les ADR sont ceux du commit revu : `git diff 1b47f61 HEAD --stat` le montre.
