# ADR-0032 — LangGraph comme oracle de patterns et de pannes, jamais comme autorité

- **Statut :** accepted — ratification propriétaire par merge de `14b88be` le 2026-09-09, après revues à rôles séparés ; D1–D5 et D38 sont en vigueur
- **Date :** 2026-09-09
- **Arbitrage :** propriétaire, session du 2026-09-09 — option C retenue parmi trois positions : adoption comme cœur, simple benchmark ponctuel, ou oracle de recherche non normatif fortement réversible.
- **Portée :** méthode d'étude de LangGraph/LangChain, frontière d'autorité d'un éventuel worker LangGraph et conditions préalables à toute évolution contractuelle.
- **Étend :** ADR-0004 (quatre autorités et worker remplaçable), ADR-0018 D4 (preuve par un second worker), I-03 (une autorité par sujet), I-18 (noyau de sécurité des boucles) et I-19 (dogfooding avant généralisation).
- **N'amende aucun contrat verrouillé et n'ouvre aucune capacité runtime.**

## Contexte

Le contrat verrouillé `execution-plan-body.v1` lie l'identité du plan, ses
critères, outils, chemins, budgets, règles réseau et modèle, profils de harness,
workers et destinations de preuve. Il ne décrit aucune topologie : pas de
nœud, étape, arête, condition, jointure ou politique de retry. En parallèle,
la spécification produit de l'Orchestrateur lui demande de sélectionner la
prochaine étape du plan (`libre-ai/orchestrator`,
`docs/apps/orchestrator.md:33`).

`orchestrator-event.v2` apporte séquence, causalité, tentative et budgets mais
ne lie pas un événement à une étape, une tentative d'étape ou une invocation
worker. Missions v1 sait bloquer sur `HumanDecisionRequested`, mais sa commande
`AnswerDecisionRequest` ne porte ni l'identifiant de la demande, ni le choix,
ni la révision attendue ; la transition reprend directement en `running`
(`libre-ai/missions`, `apps/missions/src/domain/mission.ts:144,293`).

LangGraph rend ces besoins visibles par ses graphes, checkpoints,
interruptions, retries, branches, sous-graphes et streams. Cette couverture ne
fait cependant pas de ses choix une spécification Libre AI : son état interne
n'est pas lié au quorum Missions, son checkpointer n'est pas une preuve
d'effet, et ses services de déploiement ou de traces introduiraient une
nouvelle autorité de données.

Le design approuvé
`docs/superpowers/specs/2026-09-09-langgraph-pattern-mining-design.md`
formalise la réponse : apprendre des questions et des scénarios de panne sans
adopter le framework comme cœur.

## Décisions

### D1 — LangGraph est une source de recherche non normative

Les capacités, incidents et comportements observés sont reformulés en questions
neutres et scénarios adversariaux. Une sortie amont ne décide jamais d'une
sémantique Libre AI.

Le catalogue de recherche vit avec le produit qui mène l'étude, sous une
bannière explicite `research-non-normative`. Sa suppression ne change aucune
mission, aucun run, aucun contrat et aucune preuve. Un gate peut vérifier sa
forme, sa provenance et l'absence de fuite d'un nom de framework vers un
contrat candidat ; il ne peut pas certifier la justesse d'un constat amont ni
l'intérêt d'un pattern.

Tout dépôt, documentation, issue, trace ou exemple amont est une entrée non
fiable, consultée en lecture seule et traitée comme donnée, jamais comme
instruction pour l'agent de recherche. L'extraction n'exécute aucun code amont,
n'installe aucune dépendance et n'expose aucun secret, PII ou contexte privé à
la source étudiée. Une consigne incorporée dans le contenu amont est ignorée et
devient, si elle est pertinente, un scénario d'injection à tester.

### D2 — Aucune autorité ni dépendance implicite

Missions, Orchestrator, Harness et Proof/Artifact conservent leurs autorités.
Aucun type LangGraph/LangChain/LangSmith n'entre dans un contrat canonique.

Un comportement observé, une valeur par défaut, une trace, un checkpoint ou
une documentation amont ne peut ni autoriser une action, ni déterminer un
refus, ni faire passer une gate, ni résoudre une divergence Libre AI. Les
contrats, événements et préimages restent formulés indépendamment et
vérifiables sans installer le framework.

### D3 — Deux graphes séparés

Un éventuel graphe autorisé, grossier et digéré, appartient à l'Orchestrateur ;
le graphe interne d'un worker reste opaque et sans droit d'étendre le plan.

Missions autorise le digest du plan complet. L'Orchestrateur possède les
transitions, budgets et événements du graphe autorisé. Le harness revalide
chaque invocation et atteste ses effets. Le worker peut raisonner, boucler ou
checkpoint son état interne dans sa sandbox, mais cet état ne reconstruit
jamais le run canonique et ne confère aucune capacité.

Tout élargissement de topologie, outil, path, réseau, données, provider, budget
ou destination de preuve produit un nouveau plan, un nouveau digest, deux
nouvelles reviews et une nouvelle autorisation Missions.

### D4 — Services managés exclus

LangSmith, Agent Server, télémétrie de contenu et checkpointer externe sont hors
cible. Un worker expérimental reste local, confiné et remplaçable.

Aucun prompt, message, sortie outil, checkpoint, chemin, secret, PII ou
identifiant stable n'est envoyé à une surface de traces ou de déploiement
amont. Le streaming traverse une projection Libre AI fermée et redacted ; le
flux brut du worker reste une donnée hostile dans le périmètre du harness.

### D5 — Promotion par preuves indépendantes

Toute promotion suit provenance, question neutre, carte d'autorité, menace,
sémantique indépendante, contrats candidats, vecteurs adversariaux, réalisation
native et test de retrait du worker. Les locks existants restent immuables.

La séquence obligatoire est :

1. épingler source, revision et licence ;
2. reformuler le pattern sans types framework ;
3. attribuer chaque état et décision à une autorité unique ;
4. écrire menaces, pannes partielles, races, replay et fuites ;
5. définir une sémantique Libre AI fermée ;
6. écrire les vecteurs rouges et les nouveaux contrats major-versioned ;
7. implémenter et dogfooder le cœur natif ;
8. qualifier un second worker contre les mêmes invariants ;
9. démontrer son retrait sans migration de Missions ni de l'historique des
   runs.

Un écart avec LangGraph est un finding à analyser, jamais une obligation de
copier l'amont. L'adoption d'un package runtime exige en plus une closure de
dépendances et de licences qualifiée, un pin de source, zéro téléchargement
dynamique et une valeur propre mesurée face à un worker plus petit.

## Compatibilité et locks

`execution-plan-body.v1`, `orchestrator-event.v2` et les autres autorités du
Specification Lock restent byte-identiques. Cet ADR ne crée aucun alias, champ
optionnel interprété par convention ou document compagnon implicitement requis.

Si les recherches confirment le besoin, l'évolution passe par de nouvelles
autorités candidates — notamment un graphe neutre, un nouveau major du plan et
un nouveau major de l'événement — selon `contracts/COMPATIBILITY.md`. Leurs
noms, formes, préimages et statuts sont décidés dans l'incrément contractuel,
avec revues architecture/sécurité/vie privée, vecteurs TypeScript/Rust et
jalon propriétaire de lock. Ce futur incrément n'est pas autorisé par le seul
merge de cet ADR.

## Conséquences

- LangGraph peut être étudié immédiatement comme provenance de recherche,
  sans dépendance runtime et sans valeur normative.
- Le catalogue initial doit couvrir au minimum topologie, replay, décision
  humaine, retry d'effet, fan-in, budgets enfants, streaming, fork read-only,
  mémoire longue et routage dynamique.
- Les patterns de fork canonique, mémoire longue dans l'Orchestrateur, traces
  managées et replanification sans nouveau quorum sont refusés.
- Un éventuel adaptateur LangGraph arrive après les contrats et le cœur natif,
  comme second worker de preuve ; il n'est jamais le premier producteur de la
  sémantique.
- Aucune implémentation de contrat, SDK, Missions, Orchestrator runtime ou
  harness ne commence avant ratification de cet ADR et plan écrit de
  l'incrément concerné.
- Le présent ADR reçoit une entrée D38 au registre. Aucun nouvel invariant
  n'est créé : I-03 porte déjà l'unicité d'autorité, I-18 la sécurité de boucle
  et I-19 le dogfooding ; D1–D5 bornent leur application à cette source
  d'inspiration précise.

## Alternatives rejetées

### LangGraph comme cœur d'orchestration

Rejeté : son état et ses defaults deviendraient une seconde autorité derrière
des contrats pourtant indépendants. Le coût de retrait toucherait Missions,
replay, budgets et preuves, en contradiction directe avec ADR-0004.

### Benchmark ponctuel sans catalogue ni gate

Rejeté : fortement réversible mais non cumulatif. Les mêmes modes de panne
seraient redécouverts sans provenance, sans refus stabilisé et sans moyen de
voir un nom de framework glisser vers une autorité candidate.

### Réimplémentation exhaustive de LangGraph

Rejetée comme sur-engineering : mémoire longue, studio, time travel, service de
traces et parité d'API n'ont pas de besoin Libre AI admis. Seuls les patterns
qui ferment une lacune prouvée suivent D5.

## Gate de ratification

Avant merge propriétaire :

- revue architecture séparée sur autorités, compatibilité et retrait ;
- revue sécurité séparée sur injection, effets ambigus, tenant, replay et logs ;
- revue vie privée séparée sur streaming, checkpoint, rétention et restore ;
- `bun run check` vert sur le commit proposé ;
- restitution propriétaire du SHA exact et des verdicts.

Le merge ratifie D1–D5 et D38. Il ne prononce aucun Specification Lock et
n'ouvre aucune capacité runtime.
