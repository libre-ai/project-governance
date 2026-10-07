# Design — LangGraph comme oracle de questions et de scénarios de panne

- **Date :** 2026-09-09
- **Statut :** design approuvé ; phase 2 ratifiée par ADR-0034/D40 après revues
  et arbitrage propriétaire du 2026-09-09 sur
  `7112cb797f686d70fc055449d781d634eeaa2517` ; phase 3 non ouverte
- **Portée :** méthode d'étude de LangGraph, lacunes de l'orchestration Libre AI et frontières d'une éventuelle réalisation
- **Décision de session :** option C — LangGraph nourrit un catalogue de questions et de scénarios de panne ; il ne devient jamais une autorité ni une spécification implicite
- **Autorité aval :** ADR-0034/D40 borne le premier incrément ; en cas de
  divergence avec les explorations ci-dessous, sa topologie séquentielle sans
  parallélisme, jointure, sous-graphe ni cycle prévaut

## 1. Résultat recherché

Libre AI doit apprendre des capacités et des modes de panne rendus visibles par LangGraph sans adopter son modèle d'exécution comme vérité du système.

Le résultat n'est donc ni une migration vers LangChain/LangGraph, ni un clone généraliste de LangGraph. C'est une discipline d'extraction : chaque pattern observé est reformulé en question neutre, confronté aux quatre autorités Libre AI, menacé, contractualisé si nécessaire, puis testé indépendamment. La source étudiée reste une provenance de recherche ; elle ne détermine aucune sémantique canonique.

Cette séparation conserve une forte réversibilité : un worker utilisant LangGraph pourra être branché ou retiré derrière le protocole du harness sans modifier Missions, le quorum, les autorisations, les budgets, les preuves ou la machine d'état de l'Orchestrateur.

## 2. Contexte vérifié

### 2.1 Autorités déjà fixées

RFC-0001 et ADR-0004 répartissent quatre autorités :

1. **Missions** possède le workflow, le quorum, l'autorisation d'exécution et la validation finale.
2. **Agent Orchestrator** possède l'état du run, le séquencement autorisé, l'idempotence, les budgets et les événements causaux.
3. **Agent Harness** possède les processus, le confinement, les outils privilégiés, les secrets éphémères et les attestations.
4. **Proof/Artifact** possède les preuves et artefacts adressés par contenu.

Le worker est remplaçable. Ses permissions, son stockage, son graphe interne et ses types ne sont jamais une frontière de sécurité. ADR-0018 D4 exige qu'un second worker prouve cette remplaçabilité à la sortie de la vague 3.

Sources : `docs/rfcs/0001-agent-orchestration-option-b.md`, `docs/adr/0004-agent-orchestration-option-b-specification-lock.md`, `docs/adr/0018-wave-3-opening-orchestrator-and-harness.md`.

### 2.2 Lacune structurelle constatée

Le contrat verrouillé `execution-plan-body.v1` lie identité, critères d'acceptation, outils, filesystem, budgets, réseau, egress modèle, harness, workers et destinations de preuve. Il ne contient ni étape, ni nœud, ni arête, ni condition, ni politique de retry. Pourtant la spécification produit de l'Orchestrateur lui demande de « sélectionner la prochaine étape du plan ».

`orchestrator-event.v2` apporte causalité, séquence, tentative et budgets, mais ne nomme pas l'étape, le nœud ou l'invocation worker concernée. Il est donc impossible de prouver sans convention externe quel état du plan a été exécuté, repris ou rejoué.

Sources vérifiées le 2026-09-09 :

- `libre-ai/contracts/contracts/schemas/execution-plan-body.v1.schema.json` ;
- `libre-ai/contracts/contracts/schemas/orchestrator-event.v2.schema.json` ;
- `libre-ai/orchestrator/docs/apps/orchestrator.md:33`.

### 2.3 Lacunes fonctionnelles connexes

- Dans Missions v1, `AnswerDecisionRequest` ne porte aucun identifiant de demande, aucun choix et aucune révision de la demande ; l'état `blocked` reprend simplement en `running`. Une réponse tardive ou portant sur une autre question n'est pas distinguable au niveau domaine (`libre-ai/missions/apps/missions/src/domain/mission.ts:144`, `:293`).
- Le plan autorise une concurrence maximale, mais ne définit ni jointure, ni résolution de conflit, ni ordre déterministe des résultats concurrents.
- Les événements savent compter une tentative globale, pas relier un retry à une étape et à un effet externe précis.
- La pause, le crash et le retry laissent un intervalle critique : un effet peut être commis alors que son résultat ou son événement n'a pas été enregistré.
- Les projections de streaming ne distinguent pas encore explicitement les données métier autorisées des messages internes du worker, prompts, sorties outils et erreurs brutes.

Ces lacunes ne prouvent pas que LangGraph doit être adopté. Elles prouvent qu'il constitue un bon générateur de questions auxquelles Libre AI doit répondre dans ses propres termes.

## 3. Décision

### 3.1 Rôle autorisé de LangGraph

LangGraph est un **oracle de recherche non normatif** :

- inventaire de capacités à examiner ;
- source de scénarios de panne et de reprise ;
- adversaire comparatif pour les tests de remplaçabilité ;
- éventuellement second worker expérimental derrière le RPC du harness, après qualification séparée.

Le mot « oracle » ne signifie ici ni arbitre ni source de vérité. Une sortie de LangGraph, un comportement observé ou une documentation amont ne peut jamais autoriser une action, définir un contrat Libre AI, faire passer une gate ou trancher une divergence.

### 3.2 Rôles interdits

LangGraph, LangChain, LangSmith ou un service associé ne possède jamais :

- l'état canonique d'une mission ou d'un run ;
- une autorisation, un quorum ou une décision humaine ;
- le ledger de budgets ;
- la vérité sur la réussite d'une étape ;
- la preuve canonique d'un effet ;
- les secrets, le contrôle d'egress ou le confinement ;
- un checkpointer dont la restauration serait nécessaire pour reconstruire l'état Libre AI ;
- une sémantique implicite de branchement, retry, interruption, streaming ou mémoire.

LangSmith, Agent Server et les offres managées sont hors cible. Leur exclusion évite une nouvelle autorité de données, une télémétrie de contenu et une dépendance d'exploitation étrangère au modèle souverain.

### 3.3 Conséquence de versionnement

Les contrats `execution-plan-body.v1` et `orchestrator-event.v2` sont verrouillés et `major-versioned`. Ils ne sont pas amendés par ce design.

Si l'étude confirme le besoin d'un graphe autorisé, la voie candidate est :

- un nouveau `execution-graph.v1`, neutre vis-à-vis de tout framework ;
- un `execution-plan-body.v2` qui lie le digest de ce graphe dans sa préimage ;
- un `orchestrator-event.v3` qui identifie étape, tentative et invocation ;
- des contrats séparés de décision humaine, d'invocation de step et d'attestation d'effet.

Ces noms et versions sont des candidats de conception. Leur création exige un ADR, les revues séparées requises, des vecteurs contractuels et un jalon propriétaire ; le présent document ne prononce aucun lock.

## 4. Frontière à trois niveaux

```text
Missions — autorise le plan complet et ses digests
  |
  v
ExecutionPlanBody v2 candidate
  +-- executionGraphDigest ---------------------------+
  +-- capabilities, budgets, egress, harness, proofs  |
                                                       v
Agent Orchestrator — état canonique du graphe autorisé, transitions, budgets
  |
  +-- StepInvocation bornée + capacités atténuées
  v
Agent Harness — confinement, effets, attestations
  |
  +-- RPC worker versionné
  v
Worker remplaçable — boucle interne opaque
  +-- Pi
  +-- worker LangGraph éventuel
  +-- autre worker
```

Deux graphes peuvent donc coexister sans se confondre :

- le **graphe autorisé**, grossier, déterministe et digéré, appartient à l'Orchestrateur ;
- le **graphe de raisonnement interne**, fin et potentiellement dynamique, appartient au worker et reste opaque.

Une décision interne du worker n'a aucun effet tant qu'elle n'est pas exprimée comme une invocation conforme à l'étape autorisée et revalidée par le harness. Le worker peut réfléchir, boucler ou utiliser ses propres checkpoints dans sa sandbox ; il ne peut ni étendre la topologie autorisée, ni restaurer l'état canonique, ni convertir un checkpoint en droit d'agir.

## 5. Méthode d'extraction des patterns

Chaque pattern étudié suit le même pipeline. Sauter une étape interdit sa promotion.

Les dépôts, documentations, issues, traces et exemples amont sont des entrées
non fiables. Ils sont consultés en lecture seule, sous enveloppe de contenu non
trusted, et ne donnent aucune instruction à l'agent de recherche. L'extraction
n'exécute pas le code étudié, n'installe aucune dépendance et ne lui transmet
aucun secret, PII ou contexte privé. Toute consigne incorporée dans une source
est ignorée comme instruction et peut seulement être conservée comme scénario
d'injection neutralisé.

1. **Provenance.** Enregistrer le dépôt, la version ou le commit, la licence et la surface observée. La documentation mouvante n'est jamais citée comme contrat.
2. **Question neutre.** Reformuler le pattern sans nom ni type LangGraph. Exemple : « comment reprendre après une interruption située entre effet externe et écriture de l'événement ? ».
3. **Carte d'autorité.** Identifier l'unique autorité Libre AI de chaque état, commande, preuve et décision impliqués.
4. **Menaces.** Écrire les abus, pannes partielles, races, replays, fuites de contenu et extensions de capacité.
5. **Sémantique indépendante.** Définir transitions, invariants, refus fermés, idempotence et limites sans importer les valeurs par défaut de LangGraph.
6. **Contrats candidats.** Produire JSON Schema/OpenAPI/WIT, préimages de digest et codes fermés dans `contracts`, sous le processus de lock existant.
7. **Vecteurs adversariaux.** Écrire les fixtures positives et négatives avant l'implémentation, avec projections TypeScript/Rust reproductibles.
8. **Réalisation native.** Implémenter le cœur déterministe Libre AI et prouver replay, isolation tenant et comportement fail-closed.
9. **Comparaison worker.** Seulement après les preuves natives, exécuter les mêmes scénarios via un worker alternatif. Un écart est un finding, pas une raison d'imiter automatiquement l'amont.

Le catalogue de recherche vit dans le dépôt produit qui porte l'étude, sous `docs/research/orchestration-patterns/`. Il est explicitement non normatif. La doctrine éventuelle vit dans `governance`, les contrats dans `contracts`, et la réalisation dans le dépôt propriétaire de l'autorité : aucune copie du catalogue ne devient source de vérité par proximité avec le code.

## 6. Matrice initiale de questions

| Pattern rendu visible par LangGraph | Question Libre AI | État actuel | Autorité candidate | Sortie attendue |
| --- | --- | --- | --- | --- |
| Graphe avec nœuds et arêtes | Quelle topologie exacte a reçu quorum et autorisation ? | manquant | Missions autorise le digest ; Orchestrator exécute | `execution-graph.v1` + plan v2 |
| Checkpoint/reprise | Quel état suffit à reconstruire un run sans stockage worker ? | partiel | Orchestrator | replay déterministe d'événements |
| Interruptions humaines | Quelle question, quels choix et quelle révision l'humain a-t-il résolus ? | insuffisant | Missions | décision typée et liée au run/step |
| Retry de nœud | Comment distinguer retry de calcul et répétition d'un effet ? | insuffisant | Orchestrator + Harness | identité d'attempt + attestation d'effet |
| Branches parallèles | Comment joindre des résultats sans ordre d'arrivée implicite ? | manquant | Orchestrator | fan-in déterministe |
| Sous-graphes | Comment empêcher une branche enfant d'étendre capacités et budgets ? | manquant | Orchestrator + Harness | délégation atténuée, budget enfant |
| Streaming | Quelle projection peut être montrée sans exposer prompts, outils ou PII ? | partiel | Missions/produit de projection | événements publics fermés et redacted |
| Time travel/fork | Qu'est-ce qu'une simulation ou un fork sans réécrire l'histoire canonique ? | non requis | Orchestrator | projection read-only séparée, si admise |
| Mémoire longue | Quelle autorité et quelle rétention pour une mémoire hors run ? | volontairement hors Orchestrator | nouveau domaine requis | refus tant qu'aucune autorité n'existe |
| Dynamic routing | Une condition non déterministe peut-elle changer le plan autorisé ? | interdit par défaut | Missions + Orchestrator | nouveau digest et nouveau quorum |

## 7. Sémantique candidate du graphe autorisé

Cette section borne le futur travail contractuel ; elle n'est pas un schéma verrouillé.

### 7.1 Structure

Un graphe autorisé contient au minimum :

- un identifiant opaque et une version de schéma ;
- un nœud d'entrée unique ;
- une collection bornée de nœuds à identifiants uniques ;
- une collection bornée d'arêtes ;
- au moins un état terminal explicite ;
- un digest canonique couvrant l'intégralité de la topologie et de ses références.

Un nœud décrit une unité d'autorisation, pas un prompt :

- type d'opération fermé ;
- digests des schémas d'entrée et de sortie ;
- digest du profil de capacités ;
- tranche maximale de budget ;
- politique de retry fermée ;
- destinations de preuve ;
- références content-addressed vers les instructions nécessaires.

Une arête nomme source, destination, résultat fermé déclencheur et nombre maximal de traversées. Aucun code arbitraire, expression libre, callback, import de module ou fonction sérialisée n'entre dans le contrat.

### 7.2 Déterminisme et boucles

Pour un état canonique et un événement validé donnés, une seule transition est valide. Une absence de transition ou plusieurs transitions compatibles bloque le run avec un code fermé.

Toute boucle possède simultanément :

- un plafond de traversées dans le graphe ;
- un plafond de retry par étape ;
- les plafonds globaux du plan, jamais remis à zéro ;
- une condition de non-progrès mesurable.

Atteindre une limite interdit tout nouvel effet et produit un halt explicable. Aucun sous-graphe, retry, fork ou changement de worker ne recrée du budget.

### 7.3 Parallélisme et jointure

Chaque branche reçoit une allocation enfant dont la somme ne dépasse pas la réservation parente. Les résultats sont indexés par identifiant de branche, jamais par ordre d'arrivée.

Une jointure déclare avant autorisation :

- l'ensemble attendu de branches ;
- la règle fermée `all`, `any-success`, `quorum` ou `first-success` ;
- la règle de traitement des branches encore actives ;
- la fonction de projection déterministe des références de résultats ;
- le comportement sur échec partiel et dépassement de budget.

Une jointure ne fusionne jamais automatiquement des fichiers ou états mutables produits en parallèle. Toute fusion ayant un effet devient une étape distincte, révisable et attestée.

### 7.4 Expansion dynamique

Un worker peut proposer une nouvelle étape ou branche comme artefact de planification. Cette proposition reste sans effet. Si elle élargit topologie, capacité, budget, réseau, données, provider ou preuve, Missions exige un nouveau plan v2, un nouveau digest, deux nouvelles reviews et une nouvelle autorisation.

## 8. Identités minimales d'exécution

Un futur protocole d'exécution doit distinguer :

- `runId` — instance autorisée globale ;
- `stepId` — nœud stable du graphe ;
- `attemptId` — tentative unique de cette étape ;
- `workerInvocationId` — processus ou session worker lancé par le harness ;
- `parentStepId` — lien borné d'une branche ou d'un sous-graphe ;
- `selectedEdgeId` — transition effectivement prise ;
- `effectId` — effet externe idempotent ou attesté ;
- `decisionRequestId` — interruption humaine précise.

Ces identifiants sont opaques, tenant-scoped et liés au digest du plan. Leur présence dans les enregistrements métier n'autorise pas leur copie dans les logs opérationnels ou OTEL.

## 9. Fenêtre critique des effets

Le checkpointing d'un framework ne résout pas la panne située entre un effet externe et l'enregistrement de son résultat. Libre AI doit traiter cette fenêtre comme un protocole explicite :

```text
StepAuthorized
  -> EffectReserved
  -> EffectStarted
  -> EffectCommitted | EffectRejected | EffectStateUnknown
  -> StepResultRecorded
```

Règles candidates :

- `EffectReserved` consomme conservativement le budget avant l'action.
- Un effet possède une clé d'idempotence vérifiée par l'autorité qui l'applique, pas seulement par le worker.
- Après crash, l'absence de `EffectCommitted` ne prouve pas l'absence d'effet.
- Si l'autorité externe ne permet ni lecture de statut ni idempotence prouvée, la reprise produit `EffectStateUnknown` et bloque ; elle ne retry pas.
- Un résultat worker non accompagné de l'attestation harness attendue ne peut faire avancer le graphe.
- Un événement `Committed` dupliqué identiquement est idempotent ; une divergence pour le même `effectId` met le run en quarantaine.

Le harness atteste le lancement et les capacités effectivement appliquées. L'Orchestrateur décide la transition canonique. Le worker ne peut déclarer seul ni commit, ni rollback, ni succès.

## 10. Décisions humaines typées

Une interruption humaine est une mutation de Missions, jamais un simple message injecté dans un thread worker.

Une future demande de décision lie au minimum :

- tenant, mission, run, plan digest, `stepId` et `attemptId` ;
- identifiant et digest de la demande ;
- contexte décisionnel borné et références de preuve ;
- deux à quatre choix mutuellement exclusifs, conséquences et éventuelle recommandation motivée ;
- schéma de réponse fermé et rôle requis ;
- révision attendue, expiration et règle en cas de non-réponse.

La réponse porte l'identifiant exact, le choix, l'acteur autorisé, la révision attendue et une clé d'idempotence. Une demande expirée, remplacée, déjà répondue, cross-tenant ou liée à une autre tentative est refusée. La reprise ne restaure aucun budget et ne peut étendre le plan ; un choix qui l'élargit déclenche un nouveau plan et un nouveau quorum.

## 11. Streaming et confidentialité

Le streaming expose des projections dérivées, jamais le flux brut du worker.

Trois classes sont séparées :

1. **Événements métier tenant-private** : transition, code fermé, compteurs, références digérées ; rétention et accès gérés par l'autorité métier.
2. **Preuves tenant-private** : contenu nécessaire à l'audit, stocké par Proof/Artifact avec classification et cycle de vie.
3. **Journal opérationnel sans contenu** : versions, catégories fermées et métriques agrégées ; zéro identifiant stable, prompt, code, chemin, argument outil, sortie, secret ou message d'erreur brut.

Un adaptateur LangGraph ne transmet pas ses événements `messages`, états de checkpoint, traces de nœuds ou données de debug directement à Missions, à Agent Board, aux logs ou à OTEL. Une projection Libre AI validée et redacted est obligatoire.

## 12. Scénarios de panne obligatoires

Le catalogue initial doit au minimum produire des vecteurs pour :

### Autorisation et topologie

- nœud ou arête ajouté après quorum ;
- condition de routage inconnue ou ambiguë ;
- worker demandant une étape absente du graphe ;
- sous-graphe élargissant outil, path, réseau, données, provider ou budget ;
- checkpoint ancien restauré sous un nouveau digest ;
- plan cross-tenant ou graphe substitué par digest divergent.

### Causalité, retry et effets

- crash avant lancement, pendant effet, après commit mais avant événement, après événement mais avant résultat worker ;
- deux workers exécutant le même `attemptId` ;
- retry avec nouvel `attemptId` mais même `effectId` ;
- effet non idempotent dont l'état est inconnu ;
- événement dupliqué divergent, séquence manquante ou cause inconnue ;
- reprise après changement de worker avec compteurs réduits ;
- pause ou cancel concurrent d'un effet en vol.

### Parallélisme

- deux ordres d'arrivée donnant deux résultats de jointure ;
- branche tardive écrivant après `first-success` ;
- somme des budgets enfants supérieure au parent ;
- branches partageant un état mutable ou fusion implicite de fichiers ;
- échec partiel masqué par une branche réussie.

### Décision humaine

- réponse à une demande remplacée, expirée ou d'une autre tentative ;
- double réponse concurrente ;
- acteur, rôle ou tenant incorrect ;
- option libre interprétée comme capacité supplémentaire ;
- reprise automatique sans réponse validée ;
- contenu non trusted de la demande devenant instruction système du worker.

### Confidentialité et souveraineté

- instruction incorporée dans un dépôt, une documentation, une issue, une trace ou un exemple amont et interprétée comme commande par l'agent de recherche ;
- prompt, message, état, chemin, argument outil, PII, secret ou identifiant stable dans logs/OTEL ;
- trace LangSmith ou endpoint managé activé par défaut ou transitivement ;
- checkpoint contenant des données au-delà de leur rétention ;
- restauration ressuscitant un contenu supprimé ;
- dépendance ou plugin téléchargé dynamiquement par le worker.

## 13. Qualification d'un worker LangGraph éventuel

Un worker LangGraph n'est étudié qu'après mise au vert des contrats et du cœur natif. Sa qualification exige :

- version et source épinglées, licence MIT et closure complète auditées, notices conservées ;
- aucune dépendance runtime de Missions, de l'Orchestrateur, du harness ou des contrats vers des types LangGraph/LangChain ;
- aucun LangSmith, Agent Server, télémétrie, auto-update ou téléchargement dynamique ;
- checkpointing désactivé ou borné au stockage éphémère de la sandbox ; son contenu n'est jamais une source de reprise canonique ;
- réseau coupé hors gateway autorisé, secrets absents de l'environnement et du filesystem worker ;
- entrées et sorties RPC strictement validées et bornées ;
- état interne, messages et erreurs traités comme données hostiles ;
- même suite E2E et mêmes scénarios de panne que le worker Pi ;
- test de retrait : supprimer l'adaptateur et rejouer les runs canoniques sans migration de Missions ni des événements.

Le package LangGraph ne devient une dépendance admise que si cette qualification démontre une valeur propre par rapport à un worker plus petit. Son adoption pour « bénéficier de l'écosystème » sans capacité mesurée serait du sur-engineering et doit être refusée.

## 14. Ordre de réalisation après approbation

Le travail est cross-repo et architectural ; il exige un plan écrit séparé avant code. L'ordre suivant est séquentiel sur les autorités, même si les recherches et fixtures peuvent être préparées en parallèle.

### Phase 1 — Recherche non normative

- créer le catalogue versionné de patterns dans le dépôt `orchestrator` ;
- épingler les sources amont et leur licence ;
- produire la matrice complète questions/autorités/menaces/refus ;
- exclure explicitement les patterns sans besoin Libre AI démontré.

**Gate :** aucune entrée ne contient de type framework dans une proposition de contrat ; chaque entrée possède au moins un scénario adverse.

### Phase 2 — Acte architectural

- rédiger un ADR qui décide ou refuse le graphe autorisé, ses autorités et son impact sur les locks ;
- mettre à jour RFC/specifications et registre uniquement après approbation propriétaire ;
- borner le premier incrément à séquencement, retry, décision typée et effets — sans mémoire longue, time travel ou UI de graphe.

**Gate :** revues architecture, sécurité et vie privée séparées ; jalon propriétaire explicite.

**Statut :** franchie le 2026-09-09 par ADR-0034/D40. Cette ratification fixe
la frontière architecturale et autorise seulement la conception ultérieure de
contrats candidats.

### Phase 3 — Contrats candidats, tests d'abord

**Statut :** ouverte par choix propriétaire explicite le 2026-09-09 pour la
rédaction des onze candidats définis dans
`2026-09-09-authorized-execution-contracts-design.md`, selon le plan
`../plans/2026-09-10-authorized-execution-contracts.md`. Cette ouverture
n'autorise ni leur promotion, ni un producteur, ni une capacité runtime ; la
review de lock et son jalon propriétaire restent distincts.

- écrire fixtures positives et négatives ;
- proposer `execution-graph.v1`, plan v2, événement v3, décision, invocation et attestation d'effet ;
- définir JCS/préimages, codes de refus et règles de compatibilité ;
- générer et comparer les projections TypeScript/Rust.

**Gate :** validation stricte, corpus adverse, cross-language et review de lock verts. Aucun contrat v1/v2 verrouillé existant n'est modifié en place.

### Phase 4 — Cœur natif de l'Orchestrateur

**Statut :** Phase 4A pure ouverte par ADR-0037/D43 et `WP-G3-O02` après
l'acte propriétaire du 2026-09-10. Cette ouverture rend exécutables les
décisions déterministes verrouillées ; elle n'ouvre ni la sérialisation
transactionnelle, ni l'idempotence/fencing d'un exécuteur réel, ni les logs
runtime sans PII, ni la rétention/suppression/restore. Ces quatre preuves
restent bloquantes et séparées sous la future frontière de run `WP-G3-O01`.

- implémenter des fonctions pures de validation et de transition ;
- prouver replay déterministe, routage fermé, budgets monotones, stale decisions et refus cross-tenant ;
- injecter les crashes aux cinq frontières du protocole d'effet.

**Gate :** tests unitaires, property-based si approprié, intégration avec stores indisponibles et E2E contre faux harness ; zéro capacité runtime supplémentaire.

### Phase 5 — Intégration des autorités

- Missions porte la décision typée et l'autorisation du digest complet ;
- le runtime Orchestrator persiste l'état causal ;
- le harness porte `StepInvocation` et les attestations d'effet ;
- Proof/Artifact reçoit uniquement les objets classifiés et digérés.

**Gate :** E2E réel borné, RLS/cross-tenant, pause/cancel, crash/reprise, suppression/rétention et rollback automatique vérifiés.

### Phase 6 — Preuve de remplaçabilité

- qualifier un second worker ;
- exécuter le même corpus via Pi et ce worker ;
- comparer uniquement les contrats observables, jamais leurs états internes ;
- démontrer le retrait d'un worker sans migration des autorités.

**Gate :** parité des invariants de sécurité et de causalité, pas parité de traces internes. Un worker qui nécessite son propre store pour restaurer le run échoue.

## 15. Definition of Done du programme

Le programme est complet lorsque :

- aucune autorité canonique ne dépend de LangGraph, LangChain ou LangSmith ;
- chaque transition d'un run est reconstructible à partir des contrats et événements Libre AI ;
- le digest autorisé couvre la topologie complète ;
- décisions, steps, attempts, invocations et effets ont des identités non ambiguës ;
- les pannes avant/après effet ne provoquent ni retry aveugle ni faux succès ;
- le graphe v1 reste séquentiel et `single-ready-step`, avec routage fermé et
  budgets monotones ;
- les projections de streaming contiennent zéro donnée interdite ;
- les suites TypeScript/Rust et E2E vérifient explicitement chaque scénario de panne admis ;
- un second worker passe les mêmes invariants puis peut être retiré sans changer Missions ;
- docs API, exemples, ADR, audits et preuves de lock accompagnent le code correspondant.

## 16. Non-objectifs

- reproduire l'API, les abstractions ou toutes les fonctionnalités de LangGraph ;
- introduire LangChain comme couche applicative générale ;
- construire une mémoire longue, un studio de graphes, du time travel ou un service de traces ;
- rendre les prompts, messages ou checkpoints canoniques ;
- autoriser une replanification dynamique sans nouveau quorum ;
- modifier les contrats verrouillés existants dans ce design ;
- ouvrir réseau, secrets, provider, persistance réelle ou données tenant sans work-package et revue dédiés.

## 17. Sources de recherche, non normatives

Les sources ci-dessous servent uniquement à découvrir des questions et des modes de panne. Elles ne sont pas incorporées par référence dans les contrats Libre AI.

- LangGraph.js, dépôt MIT : <https://github.com/langchain-ai/langgraphjs>
- Graph API : <https://docs.langchain.com/oss/javascript/langgraph/graph-api>
- Persistence : <https://docs.langchain.com/oss/javascript/langgraph/persistence>
- Functional API : <https://docs.langchain.com/oss/javascript/langgraph/functional-api>
- Streaming : <https://docs.langchain.com/oss/javascript/langgraph/streaming>
- LangSmith self-hosting, explicitement hors cible : <https://docs.langchain.com/langsmith/self-hosted>

## 18. Auto-revue de cohérence

- **Sécurité :** le framework ne reçoit aucune autorité ; checkpoints et streaming sont traités comme données hostiles ; les fenêtres d'effet, cross-tenant, replay et fuites sont couvertes.
- **Qualité :** les contrats candidats sont versionnés au lieu d'amender les locks ; chaque notion possède une autorité unique et une sémantique testable.
- **Performance :** aucune dépendance ni allocation n'entre dans un path chaud à ce stade ; le replay, les réservations d'effet et les transferts de génération devront être benchmarkés avant promotion du runtime.
- **Complétude :** recherche, ADR, contrats, projections, cœur, intégration, E2E, audit et preuve de retrait sont inclus dans la DoD du scope demandé.
- **Anti-gold-plating :** mémoire longue, time travel, UI de graphe, service de traces et parité fonctionnelle complète sont explicitement exclus.
- **Réversibilité :** les types de framework restent derrière l'adaptateur worker ; aucune migration d'autorité n'est requise pour son retrait.
