# ADR-0034 — Graphe d'exécution autorisé borné

- **Statut :** accepted — D1–D6 et D40 sont en vigueur ; cette acceptation
  autorise la conception de contrats candidats, pas leur Specification Lock ni
  une capacité runtime
- **Date :** 2026-09-09
- **Arbitrage :** option A retenue explicitement par le propriétaire en session
  le 2026-09-09. Owner-arbitration: 2026-09-09
- **Proposition revue :** `7112cb797f686d70fc055449d781d634eeaa2517`
- **Portée :** architecture du graphe d'exécution autorisé, autorités, retry, décision humaine typée, fenêtre critique des effets et frontière du premier incrément contractuel.
- **Étend :** RFC-0001, ADR-0004, ADR-0018, ADR-0032 D2/D3/D5, I-03, I-18 et I-19.
- **Étendu par :** ADR-0036, qui autorise séparément le Specification Lock des
  onze autorités revues sans ouvrir de capacité runtime.
- **N'amende aucun Specification Lock, ne crée aucun contrat et n'ouvre aucune capacité runtime.**

## Contexte

`execution-plan-body.v1` autorise capacités, budgets, réseau, harness, workers
et destinations de preuve, mais ne porte aucune topologie. En parallèle,
Orchestrator doit choisir une prochaine étape sans contrat qui nomme cette
étape, ses arêtes, sa tentative ou son invocation worker.

`orchestrator-event.v2` prouve une chaîne causale et des compteurs monotones,
mais ne relie pas un événement à une étape précise. Missions v1 peut bloquer
sur une décision humaine, mais sa réponse ne lie ni demande, ni choix, ni
révision attendue. Enfin, le checkpoint d'un worker ne ferme pas la panne entre
un effet externe et l'enregistrement de son résultat.

ADR-0032 autorise l'étude de ces lacunes et interdit que LangGraph, LangChain,
LangSmith ou leurs comportements deviennent une autorité ou une spécification
implicite. Le catalogue non normatif qui en résulte confirme quatre besoins
immédiats : séquencement prouvable, retry explicite, décision humaine typée et
traitement fail-closed des effets ambigus.

Cette proposition décide si ces besoins justifient un graphe canonique Libre AI
et borne son premier incrément. Elle ne décide pas encore des octets, préimages,
codes ou projections d'un contrat.

## Décisions proposées

### D1 — Admettre un graphe autorisé séquentiel et acyclique

Le premier contrat candidat décrit un graphe orienté, fini et acyclique avec :

- une version de schéma et un identifiant opaques ;
- un nœud d'entrée unique ;
- une collection bornée de nœuds à identifiants uniques ;
- une collection bornée d'arêtes à identifiants uniques ;
- au moins un nœud terminal explicite ;
- chaque nœud accessible depuis l'entrée ;
- chaque nœud capable d'atteindre au moins un terminal ;
- aucune arête sortante depuis un terminal et aucune arête pendante ;
- un digest canonique couvrant la topologie complète et toutes ses références.

Une seule étape peut être prête ou en cours à un instant donné. Chaque nœud non
terminal déclare un ensemble fini de résultats fermés et associe chacun d'eux à
exactement une arête, sans wildcard ni route par défaut. Une sortie validée
sélectionne zéro arête pour un terminal ou exactement l'arête du résultat fermé
pour un nœud non terminal. Résultat inconnu, transition absente, plusieurs
transitions compatibles ou référence divergente bloquent le run avec un code
fermé ; aucun ordre de déclaration ou d'arrivée ne départage l'ambiguïté.

Le parallélisme, le fan-out/fan-in, les jointures, les sous-graphes et les cycles
sont invalides dans `execution-graph.v1`. Le retry d'une étape est une nouvelle
tentative régie par une politique déclarée, pas une arête de retour ni une
boucle implicite. Une future admission du parallélisme ou des cycles exige une
nouvelle décision, un nouveau major et ses propres preuves ; elle ne
réinterprète pas v1.

### D2 — L'autorisation porte sur le graphe complet

Missions autorise le digest du corps de plan complet. Le futur
`execution-plan-body.v2` lie, dans sa propre préimage, le digest du graphe
autorisé et les mêmes bornes de capacités, budgets, réseau, providers, harness,
workers et preuves que le plan existant.

Toute modification d'un nœud, d'une arête, d'une condition, d'une politique de
retry, d'un schéma, d'une référence, d'une capacité ou d'un budget produit un
nouveau digest de graphe et de plan. Elle invalide reviews et autorisation et
exige le quorum Missions prévu par RFC-0001. Une proposition de replanification
worker reste un artefact sans effet tant qu'un nouveau plan n'est pas autorisé.

Une replanification peut être préparée et revue pendant qu'un effet externe du
plan précédent reste non terminal ou inconnu. Avant qu'elle puisse recevoir une
autorisation d'exécution utilisable, une commande Missions one-shot lie le run,
la génération et la révision canoniques courants puis ordonne un transfert de
génération qu'Orchestrator applique atomiquement :

1. il scelle irrévocablement le run prédécesseur contre toute nouvelle étape,
   tentative, réservation ou invocation d'effet ;
2. il inventorie ses effets, y compris `EffectReserved`, `EffectStarted` et
   `EffectStateUnknown`, et exige pour chacun un état terminal autoritatif ;
3. il consomme la génération courante et attribue au seul run successeur une
   nouvelle génération monotone du droit d'exécuter.

Le scellement et toute réservation concurrente sont sérialisés sur la même
révision canonique : soit la réservation précède le scellement et rejoint
l'inventaire bloquant, soit le scellement précède et l'ancienne génération est
refusée. L'autorisation du successeur lie le prédécesseur, la révision scellée,
le digest de l'inventaire terminal et la nouvelle génération. Orchestrator la
revalide au démarrage ; Harness et le broker revalident la même génération avant
chaque effet. État absent, divergent ou périmé bloque.

Seul le détenteur de la génération courante peut être prédécesseur. Deux
transferts concurrents depuis la même génération sont sérialisés : le premier
peut réussir, le second rencontre une génération consommée et est refusé. Un
duplicat byte-identique du même identifiant de transfert est idempotent ; sa
réutilisation divergente met la lignée en quarantaine. Un futur remplacement du
successeur doit sceller ce successeur courant à son tour. Le branchement de deux
runs successeurs depuis un même prédécesseur est invalide en v1.

Un nouveau digest, une nouvelle révision, un nouveau `runId`, l'expiration ou
l'annulation du run précédent ne lève pas cette barrière. Orchestrator possède
l'état canonique du transfert, mais ne peut ni ordonner celui-ci ni autoriser le
successeur : ces deux décisions restent propres à Missions.

Les autorités restent uniques :

1. Missions possède workflow, quorum, autorisation et décisions humaines ;
2. Orchestrator possède état canonique du graphe, transitions, causalité,
   idempotence et budgets ;
3. Harness revalide l'invocation, applique les capacités et observe les effets ;
4. Proof/Artifact possède preuves et artefacts classifiés et digérés.

Un worker ne possède ni l'état canonique, ni le droit de sélectionner une arête,
ni la vérité d'un effet. Son graphe interne, ses messages et ses checkpoints
restent opaques, hostiles et supprimables sans migration du run.

### D3 — Les identités d'exécution sont distinctes et liées

Le protocole candidat distingue au minimum `runId`, `stepId`, `attemptId`,
`workerInvocationId`, `selectedEdgeId`, `effectId`, `effectEmissionId` et
`executionTransferId` et `decisionRequestId`. Chaque identité est opaque, bornée
à une organisation et liée au digest du plan autorisé. Aucune n'est reconstruite
à partir d'un nom worker, d'un ordre d'arrivée, d'un timestamp ou d'un
checkpoint.

Un événement canonique porte l'étape et la tentative concernées, sa cause, le
digest de l'événement précédent et les compteurs monotones. Un duplicat
byte-identique est idempotent. Un identifiant réutilisé avec un contenu
divergent, une cause inconnue, un trou de séquence, une autre organisation ou
un autre digest met le run en quarantaine et ne projette jamais un succès.

Ces identifiants appartiennent aux enregistrements métier privés à
l'organisation. Cette formulation ne crée pas une nouvelle valeur de
classification wire et ne renomme pas `tenant-private` dans les contrats
verrouillés. Le journal opérationnel et OTEL n'en copient aucun sous forme
stable ; ils ne portent que versions, catégories fermées, compteurs agrégés et
corrélation éphémère non réversible.

### D4 — Retry et effets suivent un protocole fail-closed

Une étape déclare une politique de retry fermée, une limite d'attempts et sa
classe `calculation` ou `external-effect`. Chaque retry crée un nouvel
`attemptId`; il ne remet aucun budget à zéro et ne change ni `stepId`, ni plan,
ni capacité. Atteindre une limite interdit toute nouvelle invocation.

Une étape `external-effect` choisit exactement une politique de réémission
fermée, liée au digest du profil de l'exécuteur :

- `retry-with-executor-idempotency` — l'exécuteur déduplique atomiquement le même
  `effectId` et le même digest de requête avant tout effet irréversible ;
- `retry-after-terminal-status-with-fencing` — l'exécuteur fournit des statuts
  terminaux et refuse au point d'effet toute tentative qui ne possède plus le
  fencing actif ;
- `no-retry` — toute issue non terminale ou ambiguë bloque définitivement la
  réémission du même `effectId`.

Ces valeurs gouvernent uniquement le droit de réémettre après une issue ; elles
ne remplacent jamais la protection de chaque émission contre une invocation
dupliquée ou obsolète. Chaque émission possède un `effectEmissionId` one-shot
distinct, lié à `effectId`, `effectRequestDigest`, destination, tentative,
invocation worker et génération d'exécution. L'autorité qui applique l'effet le
consomme atomiquement au point d'effet, ou fournit une déduplication strictement
équivalente : deux livraisons de l'émission active produisent la même
observation et jamais deux effets. Le fencing d'une ancienne tentative ou
génération est complémentaire ; il ne remplace pas cette consommation unique.

`no-retry` n'autorise donc ni livraison transport dupliquée non dédupliquée, ni
exécuteur incapable de consommer l'émission une seule fois. Une capacité
absente, invérifiable ou différente de celle liée au plan refuse l'étape avant
réservation. Orchestrator et Harness ne choisissent pas une politique de reprise
dynamiquement à partir d'une erreur observée.

Un nœud `external-effect` v1 décrit exactement un effet logique et chacune de
ses tentatives peut réserver au plus un `effectEmissionId`. Un second identifiant
d'émission sous le même `attemptId`, même avec le même digest, est une divergence
et ne produit aucun effet. Une nouvelle émission admissible exige une nouvelle
tentative selon la politique fermée ; plusieurs effets voulus sont représentés
par plusieurs nœuds séquentiels, chacun avec ses propres bornes et budgets.

Un effet externe suit la séquence conceptuelle :

```text
StepAuthorized
  -> EffectReserved
  -> EffectStarted
  -> EffectCommitted | EffectRejected | EffectStateUnknown
  -> StepResultRecorded
```

La réservation consomme conservativement le budget avant l'action. `effectId`
identifie l'effet logique stable et lie son `effectRequestDigest`, sa
destination, l'organisation, le plan et l'étape ; il n'identifie aucune
tentative particulière. Chaque émission reçoit son propre `effectEmissionId` et
lie séparément son `attemptId`, son `workerInvocationId` et la génération
d'exécution active. Une nouvelle tentative conserve `effectId`,
`effectRequestDigest` et destination mais reçoit une nouvelle identité
d'émission. Changer la requête ou la destination crée un autre effet et exige
une autorisation compatible ; ce n'est pas un retry.

Une seule tentative et une seule génération possèdent le droit actif d'appliquer
l'effet. Harness et le broker d'effet refusent une invocation dupliquée ou
obsolète avant application, puis l'exécuteur consomme atomiquement
`effectEmissionId` au point d'effet. Le futur protocole doit porter un fencing
monotone ou une garantie équivalente, revalidée au point d'effet ; une simple
lease locale, un timeout ou l'état en mémoire d'Orchestrator ne suffit pas. Si
l'exécuteur externe ne sait pas appliquer ce fencing, il doit garantir
l'idempotence sur `effectId` avant le premier effet irréversible. Dans tous les
cas, il doit aussi dédupliquer la livraison de l'émission active.

Après crash, l'absence de `EffectCommitted` ne prouve jamais l'absence d'effet.
Une lecture de statut autoritative est interprétée ainsi :

- `committed` réconcilie le résultat sans réémettre l'effet ;
- `rejected-final` ou `not-committed-final` n'autorise une nouvelle émission
  non idempotente que si l'exécuteur garantit aussi que l'ancienne invocation
  ne peut plus commettre ;
- `pending`, `started`, une absence non terminale, une réponse inconnue,
  divergente ou indisponible produit `EffectStateUnknown`, bloque le run et
  interdit toute réémission.

Hors garantie d'idempotence effective ou preuve terminale de non-commit avec
fencing de l'ancienne tentative, aucun retry d'effet n'est admissible. Une
réconciliation ultérieure exige une observation terminale autoritative attestée
par Harness ; elle ne déduit rien d'une sortie worker et ne reçoit aucune
dérogation humaine à cette exigence.

L'exécuteur externe affirme seulement le statut qu'il possède. Harness atteste
l'invocation, le fencing, les capacités effectivement appliquées et
l'observation reçue. Orchestrator valide cette attestation et applique seul la
transition canonique déterminée par le statut terminal sous l'autorisation du
plan existant. Une intervention humaine via Missions peut demander une nouvelle
observation, annuler ou déclencher une replanification ; elle ne peut jamais
affirmer `committed`, `rejected-final` ou `not-committed-final`, ni remplacer une
preuve absente.

Ni Harness ni Orchestrator ne transforme une absence d'erreur en preuve de
commit. Un commit dupliqué identiquement est idempotent ; une divergence pour le
même `effectId` met le run en quarantaine.

Une pause ou annulation interdit tout nouvel effet. Tant qu'un effet en vol
n'est pas résolu en état autoritatif, le run reste bloqué et ne déclare pas de
terminaison mensongère.

`EffectStateUnknown` crée aussi une barrière de continuité attachée à la mission
et à la lignée de ses plans et runs. Cette barrière survit à l'annulation, à la
replanification, au changement d'identifiants et au restore. Le transfert
atomique décrit en D2 interdit d'activer le successeur tant que ses effets
antérieurs ne sont pas terminaux et interdit au prédécesseur scellé d'en créer
de nouveaux. Une décision humaine, un nouvel `effectId` ou un nouveau quorum ne
peut ni effacer ni contourner cette barrière.

La barrière persistante est un enregistrement de sécurité minimal distinct des
contenus et preuves : génération, références opaques de lignée, état fermé et
référence de cycle de vie, sans requête, destination, observation brute ni PII
copiée. Elle reste néanmoins `tenant-private`, pseudonymisée et soumise au besoin
d'en connaître ; un identifiant ou digest n'est jamais réputé anonyme. Un effet
inconnu ne prolonge pas la rétention de ses contenus ou preuves.

Si les preuves expirent, sont supprimées ou deviennent définitivement
indisponibles avant une observation terminale, la lignée passe irréversiblement
dans un refus administratif terminal. Ce refus n'affirme ni commit ni
non-commit, n'autorise aucune réémission et interdit tout plan successeur. Les
contenus suivent leur suppression normale ; le marqueur minimal suit la classe
de rétention des tombstones de suppression. Avant toute réouverture après
restore, le registre de suppressions est rejoué : aucune donnée supprimée ni
lignée refusée n'est ressuscitée. Après suppression définitive de la mission et
expiration de ses backups, aucun état exécutable de cette lignée ne subsiste.

### D5 — La décision humaine est une mutation typée de Missions

Une étape de décision référence un schéma de demande préautorisé ; elle
n'injecte pas un message arbitraire dans le worker. Missions crée et possède la
demande, qui lie au minimum :

- organisation, mission, run et digest du plan ;
- `stepId`, `attemptId`, `decisionRequestId` et digest de la demande ;
- contexte décisionnel borné et références de preuve classifiées ;
- deux à quatre choix mutuellement exclusifs et leurs conséquences ;
- rôle requis, révision attendue, expiration et règle de non-réponse.

La réponse lie la demande exacte, un identifiant de choix fermé, l'acteur
autorisé, la révision attendue et une clé d'idempotence. Un commentaire libre
éventuel est une preuve non autoritative : il ne crée ni choix, ni capacité, ni
transition. Une sortie « autre » n'est admise que comme choix préautorisé qui
retourne vers une nouvelle planification ; elle ne devient jamais une action
libre.

Missions refuse une réponse expirée, remplacée, déjà consommée, cross-
organisation, d'une autre tentative, d'un rôle insuffisant ou d'une révision
obsolète. Orchestrator reprend seulement à partir d'un enregistrement Missions
validé et lié au plan ; la reprise ne restaure aucun budget. Tout choix qui
élargit topologie, capacités, données, réseau, provider, budget ou preuve exige
un nouveau plan et un nouveau quorum.

### D6 — Les contrats existants restent fermés et byte-identiques

La phase contractuelle suivante peut proposer, sans garantie de promotion :

- `execution-graph.v1` ;
- `execution-plan-body.v2` ;
- `orchestrator-event.v3` ;
- des demandes et réponses de décision typées ;
- `step-invocation.v1` ;
- `effect-attestation.v1`.

Leur nom final, leurs champs, leurs codes, leurs limites, leur sérialisation
canonique, leurs préimages, leurs vecteurs et leurs projections TypeScript/Rust
appartiennent au plan de phase 3. Aucun document de cette liste n'existe comme
autorité par le seul effet du présent ADR. Cette phase doit notamment rendre
explicites la lignée des plans et runs successeurs, la barrière de continuité
d'effet, l'identité one-shot du transfert, la génération, l'identité one-shot
d'émission et leurs cycles de vie canoniques.

`execution-plan-body.v1`, `orchestrator-event.v2`, Missions v1 et toutes les
autres autorités existantes du Specification Lock restent byte-identiques et ne
reçoivent aucun alias ni champ implicite. Un producteur v1 ne devient pas
compatible avec le graphe par convention. La promotion de nouveaux majors
exige le processus de lock, les revues architecture/sécurité/vie privée, le
corpus adverse cross-language et un jalon propriétaire séparé.

## Frontière du premier incrément

Sont inclus dans la seule conception contractuelle de phase 3 :

- topologie séquentielle finie et acyclique ;
- routage par résultats fermés ;
- retry borné par étape et budgets monotones ;
- décision humaine typée ;
- protocole d'effet et blocage sur état inconnu ;
- replay causal et identités non ambiguës.

Restent explicitement hors cible :

- parallélisme, fan-in, quorum de branches et budgets enfants ;
- sous-graphes, cycles, boucles de non-progrès et replanification dynamique ;
- mémoire longue, time travel, fork canonique et UI de graphe ;
- nouveau streaming de contenu ou exposition du flux worker brut ;
- LangGraph, LangChain, LangSmith, Agent Server, checkpointer externe ou
  dépendance framework dans un runtime, contrat ou SDK ;
- processus, filesystem, réseau, provider, secret ou mission réelle avant les
  work packages runtime dédiés.

Ces exclusions ne sont pas une dette cachée. Chacune nécessite un besoin Libre
AI démontré et sa propre décision ; la parité fonctionnelle avec un framework
n'est pas un critère d'admission.

## Sécurité, vie privée et souveraineté

- Toute topologie, sortie worker, attestation et décision reçue est une entrée
  hostile validée strictement avant transition.
- Un plan ou run successeur présenté pendant un effet antérieur inconnu est
  refusé à l'activation, même avec un nouveau digest, un nouveau quorum ou un
  nouvel `effectId`.
- Une réservation de l'ancien run concurrente au scellement rejoint
  l'inventaire bloquant ou est refusée par sa génération périmée ; elle ne peut
  jamais apparaître après activation du successeur.
- Deux transferts depuis la même génération ou deux identités d'émission sous la
  même tentative sont refusés ; un identifiant one-shot ne peut pas être
  remplacé pour contourner sa consommation.
- Une politique `no-retry` présentée comme substitut à la déduplication ou au
  fencing de l'émission initiale, ou un exécuteur qui applique deux fois le même
  `effectEmissionId`, est refusé avant réservation.
- Les refus et journaux utilisent des codes fermés sans message brut, prompt,
  choix libre, chemin, argument outil, sortie, secret ou PII.
- Le contexte de décision et les observations d'effet sont minimisés, classés,
  privés à l'organisation et adressés par références digérées lorsque leur
  contenu doit devenir preuve. Cette formulation ne crée aucun enum de
  classification implicite.
- Proof/Artifact applique accès au besoin d'en connaître, rétention, suppression
  et non-résurrection après restore. Un checkpoint worker n'est jamais inclus
  comme source canonique de reprise.
- Orchestrator applique les mêmes exigences aux métadonnées minimales de
  barrière et de lignée. L'expiration ou la suppression des preuves ferme la
  lignée sans prétendre résoudre l'effet ; le restore rejoue d'abord les
  suppressions et ne transforme jamais une absence en autorisation.
- Aucun service managé ou transfert hors de l'infrastructure souveraine admise
  n'est nécessaire à cette architecture.

Le corpus adverse de phase 3 couvre au minimum la double livraison d'une
émission encore active, la réservation concurrente au scellement, l'ancien run
rejoué après transfert, deux successeurs concurrents depuis la même génération,
deux émissions distinctes sous la même tentative, et l'effet définitivement
inconnu suivi d'une expiration ou suppression puis d'un restore. Chacun doit
échouer fermé sans conserver de contenu au-delà de son cycle de vie.

## Compatibilité et rollback

Avant toute promotion contractuelle, le rollback est le revert atomique de cet
ADR et de ses amendements documentaires : aucun code, schéma verrouillé, donnée
ou mission n'exige de migration.

Après une éventuelle promotion, les nouveaux majors coexistent comme autorités
distinctes ; ils ne modifient pas les octets ni la sémantique des anciens. Leur
activation runtime exige une feature boundary explicite et la qualification
simultanée de tous les producteurs et consommateurs. Aucun mode mixte implicite
n'est autorisé.

La suppression future d'un adaptateur worker ne modifie ni Missions, ni le
graphe, ni les événements canoniques. Un worker qui exige son propre checkpoint
pour restaurer le run échoue la qualification de remplaçabilité.

## Alternatives rejetées par la proposition

### Conserver le plan plat sans topologie

Rejet proposé : cette position évite de nouveaux contrats mais laisse la
« prochaine étape » dépendre d'une convention externe non digérée. Le replay ne
peut alors prouver quelle étape, tentative ou décision a produit une transition.

### Admettre parallélisme, cycles et sous-graphes dès v1

Rejet proposé comme sur-engineering et élargissement de l'attaque : jointures,
annulation de branches tardives, budgets enfants, état partagé et
non-progrès exigent des sémantiques supplémentaires sans être nécessaires aux
quatre lacunes immédiates. Une admission ultérieure par nouveau major reste
possible sans affaiblir v1.

### Déléguer la topologie au worker ou à LangGraph

Rejet proposé : cette solution recrée une autorité implicite, rend le replay
dépendant d'un checkpoint worker et fait du retrait du framework une migration
du système. Elle contredit ADR-0004 et ADR-0032.

## Conséquences

- La phase 3 peut concevoir des contrats candidats contre une frontière plus
  petite que la sémantique exploratoire du design initial.
- La topologie complète devient révisable et autorisable avant exécution ; un
  worker ne peut plus inventer la prochaine étape.
- Les retries de calcul restent possibles ; les retries d'effet ambigus
  deviennent explicitement bloquants.
- La disponibilité est volontairement sacrifiée lorsqu'un effet reste inconnu :
  même un plan successeur approuvable fonctionnellement ne peut s'exécuter avant
  résolution terminale de la lignée d'effets.
- Le transfert entre runs scelle le prédécesseur avant d'ouvrir le successeur ;
  il n'existe jamais deux générations habilitées à réserver un effet pour la
  même lignée.
- L'expiration des preuves d'un effet inconnu ferme définitivement la lignée au
  lieu de conserver les contenus indéfiniment ou d'autoriser sur absence.
- La décision humaine devient une autorité Missions liée au run et non un texte
  injecté dans une conversation worker.
- Le coût conceptuel est l'introduction de nouveaux majors et identités. Ce coût
  est justifié par la fermeture des ambiguïtés de replay, pas par une recherche
  de parité avec LangGraph.
- Les besoins de parallélisme ou de boucle restent refusés jusqu'à preuve et
  décision séparées.

## Gate de ratification

La gate a été satisfaite sur la proposition exacte
`7112cb797f686d70fc055449d781d634eeaa2517` :

- revue architecture séparée : `approve`, aucun finding ;
- revue sécurité séparée : `approve`, aucun finding ;
- revue vie privée/souveraineté séparée : `approve`, aucun finding ;
- `git diff --check` et `bun run check` verts sur le commit proposé exact :
  913 tests, zéro échec et 1 598 assertions ;
- restitution inline du SHA, des décisions et des verdicts, suivie du choix
  propriétaire explicite A le 2026-09-09.

L'acceptation propriétaire autorise uniquement les amendements documentaires de
ratification puis la conception de contrats candidats sous un nouveau plan.
Elle ne prononce aucun Specification Lock, n'autorise aucun runtime et ne
préautorise aucun futur major, worker ou service.
