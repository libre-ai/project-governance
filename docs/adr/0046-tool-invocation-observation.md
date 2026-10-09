# ADR-0046 — Observation attestée des appels d'outil, pour une garde d'absence de progrès

- **Statut :** proposed — doctrine de couche 3 (K4) : revue indépendante puis fusion par le propriétaire, qui constitue la signature ; aucune fusion automatique
- **Date :** 2026-10-09
- **Arbitrage :** le propriétaire a retenu en chat l'option « contrat d'observation dans `schemas-and-contracts` », et accepte de rouvrir partiellement l'opacité d'ADR-0032 D3 par une décision de cette autorité. Option arbitrée en chat ; acceptation à la signature. Les sous-décisions de conception (§ Décision proposée, questions Q1 à Q6) restent à sa signature. Owner-arbitration: 2026-10-09
- **Portée :** ce que l'Orchestrateur et un évaluateur pur peuvent observer des appels d'outil faits par un worker à l'intérieur d'une invocation, et sous quelle forme.
- **Précise :** ADR-0032 D3 (deux graphes séparés), sans en modifier le texte : la boucle interne du worker reste opaque, sauf une projection attestée par le harness et définie ici.
- **Étend :** I-18 (noyau de sécurité des boucles : données `operational` jamais autorité) ; ADR-0034 (graphe d'exécution autorisé).
- **Applique :** I-17 (surface à touche humaine fermée), I-03 (une autorité par sujet), I-19 (dogfooding d'abord : aucun code avant un consommateur).
- **Autorise :** l'inscription au registre de la décision D67 et de l'invariant candidat I-33 ; le contrat candidat `tool-invocation-observation-v1` dans `libre-ai/schemas-and-contracts` (PR #17) ; après acceptation, l'écriture d'un évaluateur pur dans `libre-ai/execution-continuity-evaluator`.
- **N'autorise pas :** la modification d'un contrat verrouillé (`execution-plan-body.v3`, `step-invocation.v1`, `orchestrator-event.v3` et `effect-attestation.v1` restent identiques à l'octet) ; un Specification Lock ; l'ouverture d'une capacité runtime ; la circulation d'un argument, d'un résultat ou d'un identifiant métier hors du harness ; la reprise de code, de prompt ou de libellé d'une source étudiée.

## Contexte

**Le trou.** Les répétitions au niveau des étapes sont bornées : un graphe autorisé avec cycle est refusé (`cycle-forbidden`), et chaque étape porte `maximum_attempts` dans `1..=32` (`libre-ai/execution-continuity-evaluator@60c33eb:src/authorized_execution/graph.rs:304,358`). À l'intérieur d'une étape, seul le total compte : l'évaluateur de budget compare `budgetTotal.toolCalls` au plafond du plan et à rien d'autre (`src/budget.rs:19-28`). Un worker qui appelle N fois le même outil avec les mêmes arguments et obtient le même résultat passe donc, tant que N reste sous `maxToolCalls`, qui peut valoir 100 000 (`libre-ai/schemas-and-contracts@e149c70:contracts/schemas/orchestrator-event.v3.schema.json:25`).

**Aucun contrat observé ne porte un appel d'outil individuel**, mesuré le 2026-10-09 dans `libre-ai/schemas-and-contracts@e149c70` :

- `step-invocation.v1` lie une étape à une invocation de worker (`stepId`, `workerInvocationId`, `inputArtifactRef`), sans outil ;
- `orchestrator-event.v3` ne porte que des compteurs agrégés, dont `budgetCounters.toolCalls` (`:11-25`) ;
- `argumentPolicyDigest` dans `execution-plan-body.v3` (`:164`) est l'empreinte de la **politique** d'arguments d'un outil déclaré, pas l'empreinte d'un argument d'appel ;
- `effect-attestation.v1` atteste des effets externes à émission unique (`effectEmissionId`), pas des appels d'outil.

**La cause est structurelle.** ADR-0032 D3 rend opaque le graphe interne du worker : « le harness revalide chaque invocation et atteste ses effets » et l'état du worker « ne reconstruit jamais le run canonique » (`docs/adr/0032-langgraph-pattern-mining-boundary.md:72-85`). L'Orchestrateur ne voit que des compteurs, et c'était voulu.

**Le phénomène est mesuré ailleurs.** *Repris du relevé, non re-mesuré ici :* sur 1 642 traces annotées, l'étape répétée compte pour 15,7 % des pannes et l'ignorance de la condition d'arrêt pour 12,4 % (MAST, arXiv:2503.13657). Les SDK d'agents relevés le 2026-10-09 bornent les itérations ou les appels, et aucun ne détecte l'absence de progrès.

**Forme recommandée par l'état de l'art.** Une empreinte `(outil, JCS RFC 8785(arguments))` appariée à l'empreinte du résultat. Le même couple vu k fois sur une fenêtre w signale l'absence de progrès. Une scrutation dont le résultat change ne déclenche rien. La réaction est graduée : signal, retrait de l'outil, arrêt typé.

**Provenance de la question.** Le motif vient de l'étude d'une série de démonstrations pédagogiques, `odahan/LesJeudisAgentiques` au sha `38cead91e7dffee75dcbf4cc58071a19b3232697`, sous licence propriétaire (usage privé et pédagogique). En application de l'étape 1 d'ADR-0032 D5, seule la question est retenue, reformulée ici. Aucun code, aucun prompt et aucun libellé n'en est repris.

## Ce qui devient observable, et ce qui reste opaque

Observable, et seulement sous la forme du contrat candidat :

- pour chaque fenêtre d'appels consécutifs d'une invocation de worker, la liste des couples distincts `(nom d'outil, empreinte d'arguments, empreinte de résultat, issue)`, avec leur nombre d'occurrences et l'intervalle de numéros d'appel où ils apparaissent ;
- l'issue fermée de chaque couple : `ok`, `empty`, `error`.

Reste opaque :

- les arguments, les résultats et les messages d'erreur, qui ne quittent jamais le harness ;
- le raisonnement du worker, son état interne, ses checkpoints, l'ordre exact des appels à l'intérieur d'une fenêtre et leur horodatage individuel ;
- toute corrélation entre deux runs : la clé des empreintes est propre au run et détruite à sa fin.

Répartition des rôles, conforme à D3 et à I-03 :

- **le harness émet et atteste**, puisqu'il voit déjà chaque appel pour le revalider. Le worker ne produit aucun document d'observation, et aucun compteur fourni par le worker n'est une entrée ;
- **l'Orchestrateur et l'évaluateur pur comparent** des empreintes sans détenir la clé, sans pouvoir les recalculer ni les inverser ;
- **personne n'acquiert d'autorité.** Un verdict d'absence de progrès est un effet observé, au sens où l'évaluateur relie l'état enregistré aux observations disponibles. Ce qu'il déclenche relève du graphe autorisé et du plan, signés par Missions. Il n'étend ni ne modifie aucun plan.

## Menaces

1. **Fuite de PII par dictionnaire.** Un argument à faible entropie (adresse, identifiant court, numéro) se retrouve par essai exhaustif sur une empreinte non salée. *Contre-mesure :* HMAC-SHA-256 sous une clé de 256 bits tirée par run, identifiée par `keyId`, jamais transmise, détruite à la fin du run. Hors du harness, aucune empreinte n'est testable. Après destruction, elle n'est plus liable à rien, ce qui sert aussi l'effacement. La séparation de domaine (`…:args` et `…:result`) et la liaison au nom d'outil empêchent de confondre une empreinte d'argument avec une empreinte de résultat, ou deux outils entre eux.
2. **Canal auxiliaire temporel.** Un horodatage par appel révélerait la cadence et la durée de chaque outil. *Contre-mesure :* aucun horodatage par appel, et une heure de clôture de fenêtre à la minute, alignée sur la précision minimale de `harness-profile.v2`.
3. **Volume.** Jusqu'à 100 000 appels par run, selon la borne du schéma. Un événement par appel pèse jusqu'à 100 000 documents signés. *Contre-mesure :* agrégat par fenêtre de taille w ≤ 1 024, soit au plus `ceil(100 000 / w)` documents par invocation. Une boucle sur un seul couple produit une seule entrée par fenêtre.
4. **Falsification par le worker.** Un worker qui ment sur ses appels, ou qui omet les répétitions. *Contre-mesure :* seul le harness produit et signe le document (Ed25519, clé liée à l'attestation de harness du run par `harnessAttestationDigest`). La somme des occurrences doit couvrir exactement l'intervalle déclaré. Sur une invocation, elle doit égaler le compteur `toolCalls` reçu par l'Orchestrateur : c'est une mesure par un second instrument.
5. **Rejeu, omission, réordonnancement.** *Contre-mesure :* chaque document est lié à l'organisation, au run, au plan, au graphe, à l'étape, à la tentative et à l'invocation, dans une préimage RFC 8785 signée. Il porte un numéro de fenêtre et l'empreinte de préimage de la fenêtre précédente, et la dernière fenêtre est marquée `final`. Un document d'une autre invocation, une fenêtre sautée ou un flux sans fin sont des verdicts distincts.
6. **Évasion.** Un worker qui fait varier un argument à chaque appel, ou un outil aux résultats non déterministes, échappe à la garde. *Limite assumée :* la garde détecte une absence de progrès, pas un adversaire. `maxToolCalls` et les autres budgets restent la borne dure.

## Options

Mesurées sur les quatre axes, dans l'ordre sécurité, qualité, performance, complétude.

### Option A — Un document attesté par appel

- **Sécurité :** expose le plus de métadonnées : séquence complète des outils et ordre exact. Une signature par appel multiplie la surface de clé active.
- **Qualité :** sémantique la plus simple. Un évaluateur pur peut appliquer une fenêtre glissante exacte.
- **Performance :** jusqu'à 100 000 documents signés par run, et une signature par appel sur le chemin chaud du harness.
- **Complétude :** couvre la détection à cheval sur deux fenêtres, que l'option B manque.

### Option B — Un agrégat attesté par fenêtre (proposée)

- **Sécurité :** même contenu que A, moins l'ordre et le temps à l'intérieur d'une fenêtre. Une signature par fenêtre. Le chaînage des préimages détecte l'omission et le rejeu.
- **Qualité :** l'évaluateur reste pur et rejouable. La complétude se vérifie (somme des occurrences égale à l'intervalle, égale au compteur `toolCalls`).
- **Performance :** au plus `ceil(N / w)` documents. Une boucle se compresse en une entrée.
- **Complétude :** une répétition à cheval sur deux fenêtres n'atteint pas k dans l'une ou l'autre et n'est pas détectée par l'évaluateur (Q2).

### Option C — Détection locale au harness, seul le verdict remonte

- **Sécurité :** exposition minimale : aucune empreinte ne quitte le harness.
- **Qualité :** le verdict n'est pas re-vérifiable. Le harness devient juge unique et l'évaluateur n'a rien à rejouer, ce qui contredit la mesure par un second instrument.
- **Performance :** la meilleure, sans flux d'observation.
- **Complétude :** la réaction à l'intérieur de l'étape est immédiate. Le paramétrage (k, w) se trouve dans le harness, hors du plan signé, sauf à l'y déclarer.

## Décision proposée

1. **Contrat.** L'option B est portée par le contrat candidat `tool-invocation-observation-v1` (`libre-ai/schemas-and-contracts`, PR #17) : une fenêtre par document, entrées agrégées par couple distinct, empreintes HMAC-SHA-256 sous clé de run sur les formes canoniques RFC 8785, attestation Ed25519 du harness, chaînage des préimages.
2. **Réaction.** La garde dans la boucle est tenue par le harness, qui revalide déjà chaque invocation. Il la fait sur fenêtre glissante, ce qui couvre le cas à cheval, avec des paramètres déclarés dans le plan signé (Q1). La réaction est graduée :
   - au deuxième doublon, un signal factuel ;
   - au k-ième, le retrait de l'outil pour le reste de l'invocation ;
   - au-delà, un arrêt typé `no-progress`, qui devient un résultat fermé de l'étape au sens d'ADR-0034 D1.
3. **Re-vérification.** L'évaluateur pur rejoue les documents et rend un verdict fermé, dans cet ordre : `attestation-invalid`, `observation-replayed`, `observation-chain-broken`, `observation-incomplete`, `tool-undeclared`, `no-progress`, `progress`. Un désaccord entre la réaction du harness et ce verdict est lui-même un constat.
4. **Invariants vérifiables**, résumés au registre comme I-33 candidat :
   - **OBS-a — Aucun contenu.** Aucun argument, résultat, message d'erreur, horodatage par appel ni identifiant métier ne quitte le harness. Tout objet du contrat est fermé (`additionalProperties: false`). *Vérification :* vecteurs rouges du contrat, qui doivent rougir dès qu'un objet est ouvert.
   - **OBS-b — Empreinte à clé de run.** Toute empreinte d'argument ou de résultat est un HMAC-SHA-256 sous une clé propre au run, jamais transmise et détruite à sa fin. Aucune empreinte non clée n'est admise. *Vérification :* `digestKey.algorithm` et `digestKey.scope` sont des constantes du schéma, et des vecteurs de digest sont reproduits sous une clé de test publiée.
   - **OBS-c — Le harness atteste, le worker n'émet pas.** Seul un document signé par la clé liée à l'attestation de harness du run est une observation. Un compte fourni par le worker n'est jamais une entrée. *Vérification :* le verdict `attestation-invalid` sur un document modifié après signature.
   - **OBS-d — Comparer n'est pas autoriser.** Un verdict d'observation n'élargit aucune capacité et ne modifie aucun plan. Il ne déclenche que des réactions déclarées dans le graphe autorisé. *Vérification :* l'évaluateur ne reçoit ni clé, ni plan modifiable, et ne rend qu'un code fermé.
   - **OBS-e — Complétude prouvée.** Sur une invocation, les occurrences couvrent exactement les numéros d'appel `1..n`, la dernière fenêtre est `final`, et `n` égale le compteur `toolCalls` reçu. Tout écart est `observation-incomplete`, jamais une correction du compteur.
5. **Registre.** D67 enregistre cet ADR. I-33 résume OBS-a à OBS-e. Les deux prennent effet à la fusion par le propriétaire.

## Articulations

- **ADR-0045 (PR #76, proposé).** Son INV-b exige une provenance par valeur et une politique sur chaque argument d'appel d'outil. Ce n'est pas le même objet : ADR-0045 juge un argument **avant** l'appel, et ses valeurs restent dans le runtime. Cet ADR observe **après** l'appel, sous forme d'empreinte. Une empreinte d'argument ne porte aucune provenance et ne peut pas servir à la politique d'INV-b. À l'inverse, aucune provenance d'ADR-0045 n'entre dans un document d'observation. Les deux partagent un point : le harness, qui revalide chaque invocation, est le lieu naturel des deux contrôles, sous réserve de la question Q3 d'ADR-0045.
- **ADR-0032 D5.** La reprise du motif suit les neuf étapes : source épinglée, question reformulée, autorités attribuées, menaces écrites, sémantique fermée, vecteurs rouges et contrat candidat (PR #17). Restent, après acceptation : le cœur natif, un second worker qualifié contre les mêmes invariants, et la démonstration de son retrait.
- **I-17.** Cet ADR, D67, I-33 et le contrat candidat sont sous signature. Promouvoir le contrat au statut `locked` est un acte propriétaire distinct, après les passes de revue nommées par son dossier (architecture, sécurité, vie privée, cryptographie).
- **`harness-profile.v2`.** Sa télémétrie n'admet que des catégories et compteurs fermés, sans contenu (`contentFieldsAllowed: false`). Le document d'observation n'est pas de la télémétrie : c'est une preuve attestée, comme `effect-attestation.v1`. Il respecte pourtant la même frontière de contenu et la même précision temporelle.

## Conséquences

- **Contrat.** `tool-invocation-observation-v1` est candidat dans `libre-ai/schemas-and-contracts` (PR #17). Il comprend : schéma, sémantique, 4 vecteurs valides, 35 invalides, 5 vecteurs d'empreinte sous clé de test publiée, et 9 vecteurs sémantiques, un par verdict fermé. Il est inscrit au registre des ajouts post-verrou, avec empreinte re-épinglée. Les contrats verrouillés restent identiques à l'octet.
- **Évaluateur pur, à écrire après acceptation** dans `libre-ai/execution-continuity-evaluator`, sur le modèle de `evaluate_budget_event` : une fonction sans état possédé, qui reçoit les documents, les noms d'outils du plan et k, et rend un code fermé. Les 9 vecteurs sémantiques lui servent de suite de conformité, puisque leur verdict attendu n'est exécuté par aucun code aujourd'hui.
- **Vecteurs rouges, à exiger avant tout code d'exécution :**
  1. une boucle identique est arrêtée à k ;
  2. des arguments aux clés permutées donnent la même empreinte ;
  3. une scrutation dont le résultat change n'est pas bloquée ;
  4. un document modifié après signature est refusé ;
  5. une fenêtre d'une autre invocation est refusée ;
  6. une somme d'occurrences différente du compteur `toolCalls` est refusée.

  Chaque vecteur se prouve en neutralisant le contrôle qu'il vérifie : il doit rougir sans lui.
- **Harness.** La production du document et la garde sur fenêtre glissante sont un travail du harness, sans consommateur aujourd'hui (I-19). Rien n'est activé par cet ADR.
- **Extension future.** Si le propriétaire retient une clé par organisation (Q4), ou l'option A, le contrat candidat change avant toute promotion. C'est une nouvelle révision du candidat, pas une majeure, tant qu'il n'est pas verrouillé.

## Questions ouvertes pour le propriétaire

- **Q1 — Foyer des paramètres (k, w).** Dans le plan signé, par outil (nouvelle majeure d'`execution-plan-body`, à coordonner avec la v4 d'ADR-0045), dans le profil de harness, ou en constantes de flotte ? Le plan rend le seuil auditable et signé, alors que le profil le laisse hors du digest du plan.
- **Q2 — Cas à cheval sur deux fenêtres.** Accepter la limite de l'évaluateur, puisque le harness détecte en glissant ; faire chevaucher les fenêtres de k − 1 appels ; ou basculer vers l'option A ?
- **Q3 — Option.** Confirmer B, ou préférer A (fidélité, volume) ou C (exposition minimale, verdict non re-vérifiable) ?
- **Q4 — Portée de la clé.** Par run, comme proposé (aucune corrélation entre runs, effacement par destruction), ou par organisation (détection de boucles entre tentatives et entre runs, mais une clé longue vivante à protéger et à faire tourner) ?
- **Q5 — Réaction.** Graduée comme proposé, ou arrêt typé seul ? Le retrait d'outil à l'intérieur d'une étape modifie-t-il l'invocation au sens d'ADR-0032 D3, qui interdit au worker d'étendre le plan mais ne dit rien d'une restriction ?
- **Q6 — Forme au registre.** Un invariant distinct I-33, comme proposé, ou un amendement du texte d'I-18 ? La question est la même que Q4 d'ADR-0045, et gagne à être tranchée une fois pour les deux.

## Ordre de fusion

- **Avec ADR-0045 (PR #76).** Aucune dépendance de fond : les deux ADR se lisent séparément. Les deux pull requests ajoutent une ligne en fin de `DECISION-REGISTER.md` (D66, D67) et de `INVARIANTS.md` (I-32, I-33) au même endroit. La seconde fusionnée aura donc un conflit textuel trivial : il faut garder les deux lignes, dans l'ordre numérique. Ordre recommandé : #76 d'abord, puis celle-ci, réalignée par merge signé de la base. Si celle-ci passe la première, D67 et I-33 précèdent temporairement l'existence de D66 et I-32, sans effet de fond, et #76 se réaligne de la même manière.
- **Avec le contrat (SC PR #17).** Cet ADR d'abord, puis le contrat, qui le cite par son numéro. Si le propriétaire amende la décision, le candidat est régénéré avant sa fusion.

## Sources

Relevé d'état de l'art privé du 2026-10-09 (`analyses/lesjeudisagentiques-2026-10-09/reports/C-sota/REPORT.md` §1 et §10, hors dépôt). Les valeurs ci-dessous sont reprises du relevé, sans relecture dans la source primaire pour cet ADR.

- MAST, « Why Do Multi-Agent LLM Systems Fail? », arXiv:2503.13657 v3 — https://arxiv.org/abs/2503.13657 — relevé du 2026-10-09.
- RFC 8785, JSON Canonicalization Scheme — https://www.rfc-editor.org/rfc/rfc8785 — relevé du 2026-10-09.
- RFC 2104, HMAC — https://www.rfc-editor.org/rfc/rfc2104 — relevé du 2026-10-09.
- OpenTelemetry, conventions sémantiques GenAI, span `execute_tool` : arguments et résultats en opt-in, contenu non capturé par défaut — https://github.com/open-telemetry/semantic-conventions-genai — relevé du 2026-10-09, statut Development.
- Documentation des plafonds de boucle d'agent (Microsoft.Extensions.AI `FunctionInvokingChatClient`, OpenAI Agents SDK `max_turns`, LangGraph `recursion_limit`, Pydantic AI `UsageLimits`, Vercel AI SDK) — relevé du 2026-10-09 : des plafonds d'itérations ou d'appels, aucune détection d'absence de progrès.
