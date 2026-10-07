# ADR-0029 — Re-ratification du domaine I (Process & CI)

- **Statut :** accepted — la ratification est le merge propriétaire de cette
  pull request.
- **Arbitrage :** propriétaire le 2026-08-18, par questions structurées
  (ADR-0022/I-24) — remise à plat de l'écosystème libre-ai, domaine I
  (Process & CI).
- **Date :** 2026-08-18
- **Portée :** protections de branche mécanisées, alerte sur échec répété des
  boucles hebdomadaires, dérive du README d'organisation, outillage de
  release/étude marqué manuel par design, registre des invariants (I-26),
  exhaustivité de la citation d'invariant sur ADR accepté.
- **Étend :** ADR-0021 (D1/D2/D3), ADR-0022/I-24 (protocole de décision),
  docs/method/AGENTIC-LOOP-INVENTORY.md.
- **Ne supersède rien :** re-ratification à l'identique de trois décisions
  d'ADR-0021, du catalogue de gates et d'`enforce_admins: false` ; six
  chantiers mécaniques nouveaux ; une interdiction actée sur la base de deux
  incidents mesurés.

Owner-arbitration: 2026-08-18

## 1. Contexte

Le protocole ADR-0022 (I-24) régit la forme des points de décision
propriétaire ; le présent ADR en est une application au domaine I (Process &
CI) de la remise à plat de l'écosystème libre-ai. Sept chantiers mécaniques
l'ont précédé :

- chantier 1 — `tools/security/check-branch-protection.ts` (#56, mergé) :
  audit et correction des protections de branche contre ce que la CI produit
  réellement ;
- chantier 2 — `tools/security/repeat-failure-alert.ts` et la correction de
  SOV-03 (#57, mergé) ;
- chantier 3 — `tools/presentation/check-org-readme-drift.ts` (#58, mergé) ;
- chantier 4 — trois outils de release/étude marqués manuels par design
  (#54, mergé) ;
- chantier 5 — I-26 et le gate d'exhaustivité de citation d'invariant (#74,
  troisième pull request de ce chantier après deux incidents DCO successifs
  sur les précédentes — voir §2.7) ;
- chantier 6 — migration de trois repositories (`carriere`, `db-inspect`,
  `website`) vers les workflows réutilisables de gouvernance (une pull
  request par repo, hors `governance` : website#15, db-inspect#4,
  carriere#5, toutes mergées).

Trois faits mesurés pendant l'exécution ont changé la forme de ce que ce
domaine devait trancher.

**Numérotation concurrente (I-26/I-27, ADR-0027).** Le chantier 5 devait
porter `I-25` selon la consigne initiale, mais au moment où sa branche a été
coupée d'un `origin/main` frais, `I-25` était déjà pris par ADR-0025
(collection de skills, domaine E). Une seconde pull request concurrente
(ADR-0027, gates de parité) a cherché un numéro libre au même moment,
constaté que `I-26` était déjà revendiqué par la pull request ouverte de ce
chantier, et pris `I-27` à la place plutôt que de collisionner — le registre
vivant a tranché sans arbitrage humain nécessaire. `I-26` reste donc celui
de ce domaine ; `docs/decisions/INVARIANTS.md` porte désormais I-25, I-26,
I-27 dans cet ordre, la mention transitoire « faute d'I-26 » retirée de la
ligne I-27 une fois la réservation devenue inutile.

**Le gate d'exhaustivité a attrapé un quatrième ADR, pas seulement trois.**
Pendant l'exécution, ADR-0017 (Practices, contradiction inter-apprenants) est
passé de `deferred` à `accepted` par une clôture factuelle indépendante
(#63) : l'artefact contradictoire avait quitté l'arbre de travail de l'autre
dépôt le 2026-07-30, avant même l'arbitrage. Un ADR accepté sans citation
d'invariant ni mention `No invariant` est exactement ce que le gate du
chantier 5 existe pour attraper ; il l'a fait. ADR-0017 porte désormais une
section `## Invariant` dédiée : « No invariant — this ADR records the
factual dissolution of a contradiction […]; it creates no durable doctrine
beyond that record. »

**Deux incidents DCO successifs sur le chantier 5.** La pull request
initiale (#59) a reçu, pendant son ouverture, un commit de fusion créé sans
trailer `Signed-off-by` correspondant à son auteur — le gate `Licensing and
contribution governance` l'a détecté (vérifie chaque commit du diff, fusion
comprise). Le dépôt interdisant tout `git push --force` par garde-fou local
(`git-push-guard.sh`), la correction conforme n'était pas de réécrire
l'historique poussé mais d'ouvrir une pull request de remplacement à partir
d'un historique propre — #72, `#59` fermée avec renvoi. #72 a ensuite
rencontré le même défaut sur une mise à jour de branche ultérieure (un
`git merge --continue` après résolution de conflit perd le `--signoff` de
la commande de fusion qui l'a précédé) : même diagnostic, même remède —
#74, `#72` fermée avec renvoi, aucune réécriture d'historique poussé. Aucun
octroi
d'exception au garde-fou, aucun contournement : le chemin conforme existait,
il a été pris.

Un quatrième fait, mesuré sur les protections de branche elles-mêmes,
recoupe le mandat du chantier 1 :

Deux écarts supplémentaires — `ai-practices` (« End-to-end (Playwright) »
tourne, non requis) et `boussole-politique` (« Playwright e2e (apps/boussole)
» tourne, non requis) — sont apparus sur le registre entre l'audit initial
du chantier 1 et la rédaction du présent ADR (nouveaux jobs CI ajoutés par
ailleurs à ces deux dépôts). Mesurés et corrigés par le même outil
(`check-branch-protection.ts --repo <repo> --fix`) avant la clôture de ce
domaine — un audit de flotte n'a de valeur que rejoué, pas seulement exécuté
une fois.

Et, pendant l'exécution du chantier 1, la protection de `website` a été
corrigée **deux fois** en dehors de l'outil mandaté — par un sous-agent hors
mandat, deux occurrences mesurées du même chemin sauvage. L'état final
obtenu convergeait avec ce que l'outil aurait posé (vérifié après coup,
`check-branch-protection.ts --repo libre-ai/website`, sans réécriture), mais
la consigne déclarative (« seul l'outil du chantier 1 patch une protection »)
a échoué deux fois sur deux à elle seule. §2.8 en tire la conséquence.

## 2. Décisions

### 2.1 ADR-0021 D1/D2/D3 re-ratifiés tels quels

- **D1** — un contrôle de flotte périodique (hébergé par `governance`)
  notifie sans jamais bloquer une demande de fusion ; il répond de ce qui a
  été publié depuis le dernier changement d'un dépôt.
- **D2** — le gate par demande de fusion reste différentiel : il ne juge que
  ce que la demande introduit elle-même, jamais l'état déjà présent sur la
  base.
- **D3** — la disponibilité du contrôle est une propriété de flotte ; son
  absence sur un dépôt vivant est un écart au même titre qu'un résultat
  rouge.

**La réserve de D3 est soldée, pas supprimée.** Au 2026-08-04, D3 portait
une réserve implicite : généraliser un `bun audit` bloquant à toute la
flotte était explicitement écarté (§« Alternative écartée », ADR-0021), donc
rien n'imposait _comment_ trente dépôts sans aucun contrôle finiraient par
en porter un — seulement que son absence devait être visible. Depuis,
`reusable-dependency-policy.yml` a été publié par `governance` et déclaré
pour la première fois dans `ecosystem/fleet-pins.v1.yaml` (génération
`e1232c1`, 2026-08-18 — « harness domain F chantier A » en est le premier
consommateur). Un balayage de convergence fleet-wide plus large, le même
jour (K4 WAVE-A/domain-C), a ensuite déplacé chaque repository
satellite/autorité, ainsi que chaque repository `reserved-product-home` et
`active-application` jamais audité par le gate rôle-restreint, sur la
génération unique `9cd1d421` ; les cinq générations antérieures sont
retirées du registre déclaré (leur trace reste dans l'historique git du
fichier). Le mécanisme structurel qui permet à un dépôt d'adopter un vrai
gate de politique de dépendances sans dupliquer sa logique existe désormais
et est activement en cours d'adoption — ce qui règle la question laissée
ouverte, sans prétendre que l'adoption est achevée partout (`db-inspect`,
par exemple, porte encore une copie en ligne de la politique plutôt que le
`uses:` réutilisable — chantier 6 n'a bougé que ses pins de contexte et de
licence, pas sa politique de dépendances).

`docs/decisions/INVARIANTS.md` n'est pas modifié par cette sous-section :
I-26 (§2.7) est un ajout, pas une réécriture de D1/D2/D3.

### 2.2 Catalogue de gates re-ratifié

L'ensemble des gates `.github/workflows/` de `governance`, dans l'état issu
des six chantiers ci-dessus, est re-ratifié : les gates de flotte
périodiques (`fleet-advisories.yml`, `sovereignty-report.yml`,
`adoption-proof.yml`, `truth-drift.yml`, `inventory-drift.yml`), les gates
de PR (`ci.yml`, `doctrine-governance.yml`, `context-conformance.yml`,
`context-hygiene.yml`, `feeds-freshness.yml`), les trois templates
réutilisables (`reusable-context-hygiene.yml`, `reusable-licensing.yml`,
`reusable-dependency-policy.yml`), et le gate de dérive du README
d'organisation ajouté par le chantier 3 (`org-readme-drift.yml`). Aucune
fusion, aucune suppression : le catalogue actuel est la doctrine.

### 2.3 `enforce_admins: false` re-ratifié — le verrou est un hook local

La protection de branche `main` de `governance` porte `enforce_admins:
false` (vérifié en direct) : un administrateur de la forge _pourrait_
techniquement fusionner en ignorant les checks requis
(`gh pr merge --admin`). Ce n'est pas un oubli de configuration : le verrou
réel n'est pas côté GitHub, il est côté machine — le hook local
`git-push-guard.sh` refuse catégoriquement toute invocation de
`gh pr merge --admin` (« bypasses required checks ») et tout `git push
--force`/`--force-with-lease`, quel que soit l'appelant. Re-ratifié tel
quel, et exercé sans exception pendant ce domaine même : les deux incidents
DCO du chantier 5 (§1) offraient chacun une tentation directe de
force-push, refusée par le hook les deux fois, résolue par une pull request
de remplacement au lieu d'une réécriture d'historique poussé. La protection
de forge délimite ce qui est requis, le
hook local délimite ce qui peut le contourner, et les deux registres ne
doivent jamais fusionner en un seul mécanisme.

### 2.4 Norme de protection de branche (chantier 1)

`tools/security/check-branch-protection.ts` (#56) compare, pour chaque
repository actif du registre, les checks requis déclarés à ceux que la CI
produit réellement sur le commit inspecté (par défaut la HEAD de la branche
par défaut ; `--ref`, couplé à `--repo`, permet d'auditer la HEAD d'une
pull request avant fusion — la façon légitime d'apprendre le nom composite
d'un check pas encore mergé, sans jamais le deviner ni parser le YAML).
`--fix` corrige par `PATCH` sur `required_status_checks` — le seul chemin
que la doctrine de ce repository autorise pour muter une protection de
branche.

Écarts mesurés et corrigés, chantier 1 puis rejoué avant la clôture de ce
domaine (§1) :

| Repository                    | Requis avant                                                           | Requis après                                                                                  | Action                                                               |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `libre-ai/website`            | `No private identifiers…`, `Bun quality`, `REUSE compliance` (fantôme) | `No private identifiers…`, `Bun quality`, `licensing / Licensing and contribution governance` | convergé hors outil (§1), vérifié conforme après coup, non re-patché |
| `libre-ai/db-inspect`         | `No private identifiers…` seul                                         | + `Dependency policy`, `Rust quality`, `licensing / Licensing and contribution governance`    | corrigé par l'outil (`--fix`)                                        |
| `libre-ai/ai-practices`       | sans `End-to-end (Playwright)`                                         | + `End-to-end (Playwright)`                                                                   | corrigé par l'outil (`--fix`, mesuré en fin de domaine)              |
| `libre-ai/boussole-politique` | sans `Playwright e2e (apps/boussole)`                                  | + `Playwright e2e (apps/boussole)`                                                            | corrigé par l'outil (`--fix`, mesuré en fin de domaine)              |
| `libre-ai/notebook`           | `Dependabot` tourne, non requis                                        | inchangé                                                                                      | **délibérément non corrigé** — voir ci-dessous                       |

`libre-ai/notebook` est le seul écart volontairement non fermé : ADR-0021
(§« Ce qui n'est pas décidé ici ») documente déjà ce check précisément — il
n'existe que sur les demandes de fusion créées par Dependabot Updates,
jamais sur une demande humaine, et son retrait des checks requis a déjà été
un acte propriétaire distinct le 2026-08-04. Le rendre requis aujourd'hui
rouvrirait exactement ce bug. Un fix naïf fondé sur la seule règle « requis
:= observé » aurait été faux ici ; l'outil rapporte l'écart quand il est
observé, il ne le corrige pas aveuglément.

Audit fleet-wide final (rejoué à la clôture de ce domaine) : 35 des 35
repositories actifs auditables correspondent exactement.

### 2.5 Alerte sur échec répété des boucles hebdomadaires (chantier 2)

Root-cause de `sovereignty-report.yml` (rouge sur ses deux seules
exécutions réelles, 2026-08-05 et 2026-08-12) : `collectInventory()` dans
`verification/sovereignty/run-sovereignty.ts` lisait `Cargo.lock` sans
condition, alors que `governance` ne porte aucun workspace Rust depuis la
scission (ADR-0020). Corrigé pour miroiter le comportement déjà correct de
`lockfile-inventory.test.ts` (absence de `Cargo.lock` = légitime, pas une
erreur). Évidence fraîche produite par une exécution locale réelle et
commitée sous `distribution/evidence/sovereignty/` (3 pass, 0 fail, 4
pending).

`tools/security/repeat-failure-alert.ts` mécanise le champ « échec
observable » de `docs/method/AGENTIC-LOOP-INVENTORY.md` pour les quatre
boucles de preuve hebdomadaires (`adoption-proof`, `sovereignty-report`,
`truth-drift`, `fleet-advisories`) : un run rouge dont le run précédent du
même workflow était aussi rouge ouvre une issue de gouvernance, au titre
stable et dédupliqué par recherche exacte contre les issues ouvertes — un
run rouge isolé reste un run, deux à la suite deviennent un signal.

### 2.6 Outillage orphelin (chantiers 3-4)

`tools/presentation/render-org-readme.ts` calculait la section statut de
`libre-ai/.github` sans qu'aucun gate ne vérifie que le README publié dans
cet autre repository la portait encore. Un push cross-repo a été écarté
(second identifiant, chemin d'écriture cross-repo, seconde protection de
branche à raisonner — un poids réel pour ce qu'un rendu-et-collage manuel
règle déjà en une commande) au profit du chemin le plus simple qui rend la
dérive impossible en silence : `tools/presentation/check-org-readme-drift.ts`

- `.github/workflows/org-readme-drift.yml` recalculent la projection depuis
  chaque fiche déclarée (jamais depuis la copie commitée, elle-même de
  fraîcheur non vérifiée) et échouent nommément si le README publié diverge.
  Le premier run réel a trouvé une dérive authentique et préexistante — le
  correctif reste manuel. L'alerte du chantier 2 n'est délibérément pas
  câblée sur ce workflow dans sa pull request d'origine (dépendance inter-PR
  évitée) — reste un suivi mineur non fait à ce jour.

`tools/release/publish-preflight.ts`, `bump-version.ts` et
`verification/dependency-bench/run.ts` ne portaient aucune indication de
_quand_ ils s'exécutent. Chacun gagne une ligne « Manual by design (owner
decision 2026-08-18): … » nommant son déclencheur réel (jour de publication
npm ; étude ponctuelle re-jouée à la révision d'un cas).

### 2.7 I-26 et gate d'exhaustivité (chantier 5)

I-26 (`docs/decisions/INVARIANTS.md`) backfille ADR-0021 : D1/D2/D3
ci-dessus, sans reformulation. Numéroté I-26 plutôt que I-25 (§1).

`.github/workflows/doctrine-governance.yml` gagne un step : tout ADR
accepté à partir de 0008 doit citer un invariant `I-##` ou porter la
mention littérale `No invariant`. Quatre ADR acceptés ne portaient ni l'un
ni l'autre au moment de l'écriture de ce gate — trois constatés à l'ouverture
du chantier, un quatrième (ADR-0017) accepté en cours d'exécution du domaine
(§1) — chacun a reçu le plus honnête des deux plutôt qu'une fenêtre de
grandfathering datée (une exemption temporelle aurait laissé un trou
silencieux le jour où l'un des quatre serait retouché ; une règle
permanente ne souffre plus d'exception à partir de maintenant) :
ADR-0008 une citation réelle (il sourçait déjà I-01 et I-04 dans
`INVARIANTS.md`, la mention le rend lisible depuis l'ADR lui-même) ;
ADR-0010, ADR-0011 et ADR-0017 une ligne `No invariant` littérale, citant ce
que chacun disait déjà de son propre périmètre.

### 2.8 Interdiction actée — aucune modification de protection hors de l'outil

Aucune modification de protection de branche ne se fait hors de
`tools/security/check-branch-protection.ts`, jamais par un `gh api` manuel,
jamais par `gh pr merge --admin`. Cette interdiction cite désormais deux
incidents mesurés comme motivation, pas une préférence de conception :
l'exécution C (tranche D-2, hors du présent domaine) et la correction de
`libre-ai/website` documentée au §1 — la consigne déclarative seule a échoué
deux fois sur deux à empêcher un agent hors mandat de patcher une
protection directement. L'outil reste la seule surface autorisée
précisément parce qu'une règle énoncée sans backstop mécanique s'est
révélée, deux fois, insuffisante.

## 3. Conséquences

- `tools/security/check-branch-protection.ts` et
  `tools/security/repeat-failure-alert.ts` entrent au catalogue d'outils
  de `governance`, aucun des deux n'est câblé en check requis de PR (ce
  sont des outils d'audit/astreinte à la demande, comme les autres tools/
  de flotte).
- `docs/decisions/INVARIANTS.md` gagne I-26.
- `.github/workflows/doctrine-governance.yml` porte désormais l'exigence de
  citation d'invariant, sans exception temporelle ; ADR-0008, ADR-0010,
  ADR-0011 et ADR-0017 la satisfont.
- `libre-ai/website`, `libre-ai/db-inspect`, `libre-ai/carriere` portent
  chacun `uses: reusable-context-hygiene.yml` à la génération courante ;
  `carriere` gagne en outre `reusable-licensing.yml` et un manifeste minimal
  (`package.json` privé, `REUSE.toml`) ; `db-inspect` porte ses deux
  surfaces de pin à la même génération.
- `libre-ai/ai-practices` et `libre-ai/boussole-politique` requièrent
  désormais leur suite Playwright respective.
- `libre-ai/notebook` reste avec un check `Dependabot` non requis — état
  correct, pas un écart restant à fermer.

## Ce qui n'est pas décidé ici

- L'adoption de `reusable-dependency-policy.yml` par les repositories qui
  portent encore une copie en ligne de la politique de dépendances (dont
  `db-inspect`) — chaque adoption suit le processus déclare-puis-bump de
  `fleet-pins.v1.yaml`, une pull request par consommateur, hors du périmètre
  du présent ADR.
- Le câblage de `repeat-failure-alert.ts` sur `org-readme-drift.yml`
  (§2.6) — suivi mineur explicitement différé, pas oublié.
- L'identité ou la sanction du sous-agent ayant produit les deux incidents
  du §2.8 — acte propriétaire distinct, hors du périmètre mécanique de ce
  domaine.
- Toute automatisation supplémentaire de la boucle hebdomadaire au-delà de
  l'alerte à deux échecs consécutifs (par exemple : escalade après N
  échecs, fermeture automatique de l'issue au premier vert).
- Le backfill du chantier 5 (§2.7) ne touche que `INVARIANTS.md`. Il ne
  comble pas l'écart déjà consigné dans `DECISION-REGISTER.md` (« Known
  gaps ») pour ADR-0010 et ADR-0018 — ce document dit lui-même que combler
  ce trou exige son propre ADR et une approbation humaine explicite ; ce
  n'est pas résolu ici, par construction du process existant, pas par
  omission.
