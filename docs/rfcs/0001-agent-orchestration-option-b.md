# RFC-0001 — Orchestration agentique par contrats, harness isolé et adaptateur Pi

- **Statut :** accepted — Specification Lock contractuel ; runtime non autorisé
- **Portée :** contrats verrouillés préalables à tout orchestrateur ou harness
- **Risque :** critique
- **Autorise une implémentation :** non par le lock ; seul `WP-G2-A01`, simulation-only, peut être ouvert après ses revues de définition

## Contexte

`vision.md` diffère explicitement l’orchestration agentique tant qu’un RFC, des contrats d’exécution et de contrôle, un harness et un work package séparé ne sont pas approuvés. `apps/missions` reste l’autorité du workflow et des preuves, mais la validation technique n’est pas réservée à un humain : le plan puis le résultat d’un agent doivent chacun recevoir deux reviews favorables d’autres agents sur le même digest immuable. Aucun agent ne peut reviewer sa propre contribution, ni merger, releaser ou déployer.

L’étude de `xai-org/grok-build` confirme l’intérêt de plusieurs patterns — plan lecture seule, sous-agents, worktrees, budgets, suivi des changements, sandbox, redaction et harness déterministe — mais son workspace complet n’est pas une base acceptable pour Libre AI : taille et closure de dépendances élevées, couplages xAI/Mixpanel/Sentry/GCS et sémantiques fail-open incompatibles avec la cible.

Source étudiée :

- dépôt public : `xai-org/grok-build` ;
- commit : `98c3b2438aa922fbbe6178a5c0a4c48f85edc8ce` ;
- `SOURCE_REV` : `124d85bc5dc6e7805560215fcc6d5413944920e1` ;
- licence du code principal : Apache-2.0.

Pi couvre déjà l’interaction terminal, les sessions, la compaction, les providers, les skills et l’extensibilité TypeScript. Cette RFC retient Pi comme worker de code remplaçable, jamais comme autorité de mission ou frontière de sécurité.

## Décision proposée

Adopter une architecture à quatre frontières :

```text
Missions (Bun/TypeScript, autorité workflow + quorum)
  └── 2 reviews agents du digest du plan → autorisation d’exécution
      └── Agent Orchestrator (Rust spécialisé, contrôle et budgets)
          └── Agent Harness (Rust système, sandbox et preuves)
              └── adaptateur worker Pi par RPC JSONL
```

1. **Missions** possède proposition, risque, collecte des reviews, calcul du quorum, autorisation d’exécution et validation finale. Deux agents reviewers distincts de l’auteur/exécuteur doivent approuver le même digest ; les jalons humains restent additifs uniquement lorsque la doctrine canonique les impose.
2. **Agent Orchestrator** compile un corps de plan déterministe à partir des contrats approuvables, puis possède l’état d’un run, l’idempotence, les commandes, la consommation monotone des budgets et l’émission d’événements causaux. Il ne peut ni autoriser son propre plan, ni produire une review de quorum.
3. **Agent Harness** possède processus, filesystem, réseau, gateway provider, brokers d’outils privilégiés, secrets éphémères, worktrees et collecte d’évidence. Une isolation exigée mais indisponible refuse le démarrage.
4. **Pi** est lancé comme processus externe derrière un adaptateur RPC versionné. Il ne reçoit que le workspace et les outils autorisés, plus un jeton local court lié au run ; il ne reçoit aucun secret du provider amont.
5. **Proof/Artifact** possèdent les preuves et artefacts content-addressed. Missions et l’orchestrateur ne conservent que leurs références digérées.

Pi ne devient pas une dépendance métier des applications et aucun objet HTTP, session navigateur ou accès DB produit n’entre dans le harness.

## Extension prospective ratifiée : graphe autorisé borné

ADR-0034 et D40 complètent cette direction sans réinterpréter le Specification
Lock existant. Le premier graphe candidat est fini, déterministe, acyclique et
`single-ready-step` : ses résultats et transitions sont fermés, ses retries sont
des tentatives explicites et toute ambiguïté d'effet bloque la lignée.

La carte d'autorité devient explicite pour ce futur incrément :

1. **Missions** autorise le digest du plan et du graphe complets, possède les
   décisions humaines typées et ordonne les transferts one-shot entre runs ;
2. **Agent Orchestrator** possède l'état canonique du graphe, les transitions,
   la causalité, les budgets et la génération d'exécution ;
3. **Agent Harness** revalide chaque invocation et génération, applique les
   capacités et atteste les observations d'effet sans choisir de transition ;
4. **Proof/Artifact** possède les preuves et artefacts classifiés et digérés ;
5. le worker ne possède aucun état canonique, aucune arête et aucune vérité
   d'effet.

La phase contractuelle suivante peut proposer `execution-graph.v1`,
`execution-plan-body.v2`, `orchestrator-event.v3`, des demandes et réponses de
décision typées, `step-invocation.v1` et `effect-attestation.v1`. Ces familles
ne sont ni spécifiées ni verrouillées par la présente extension. Leur
sérialisation, leurs préimages, leurs codes, leurs vecteurs et leurs projections
relèvent d'un plan contractuel et d'un jalon propriétaire séparés. Les 14
entrées déjà verrouillées conservent leur statut, leurs octets et leur
sémantique ; aucune capacité runtime supplémentaire n'est ouverte.

## Invariants normatifs à verrouiller

### Corps de plan et autorisation d’exécution

Un futur `ExecutionPlanBody v1`, produit par l’orchestrateur sans droit de l’autoriser, doit être canonique, strict et lié par SHA-256 à :

- `tenantId` et `missionId` ;
- handoff planning-only et digest du `SpecPackage` ;
- critères d’acceptation proposés ;
- profil d’outils et chemins autorisés ;
- budgets de durée, appels outils, tokens, processus, fichiers, octets et concurrence ;
- politique réseau `none` ou allowlist d’origines exactes ;
- politique d’egress modèle : finalité, classification autorisée, base d’autorisation, sources et chemins, octets maximaux, région effective, sous-traitants, rétention, exigence ZDR et interdiction d’entraînement/réutilisation ;
- digest du profil de sandbox, manifests worker/extensions/skills et politique provider ;
- destinations Proof/Artifact autorisées.

La préimage et la sérialisation canonique sont définies par le profil du contrat. Elles n’incluent ni review, ni autorisation, ni identifiant de run. Missions soumet le corps et son digest à deux agents reviewers éligibles, puis `MissionRecord v2` conserve ce digest et leurs attestations favorables. Toute review porte sur les mêmes octets et le même digest.

Après quorum, Missions émet une `ExecutionAuthorization v1` séparée qui lie `tenantId`, `missionId`, révision et digest du `MissionRecord v2`, digest du corps de plan, deux attestations de review, expiration et identifiant de révocation. Un jalon humain supplémentaire est référencé lorsque la mission touche un domaine protégé par la doctrine canonique. Le Biscuit de démarrage est atténué aux mêmes faits. Cette séparation évite toute préimage circulaire. L’orchestrateur valide le corps, l’autorisation, le token, l’éligibilité des reviewers et leurs digests avant de créer `runId` et la clé d’idempotence.

Le corps est immuable après autorisation. Toute expansion de capacité, chemin, données, réseau, budget ou provider produit un nouveau digest, invalide les reviews précédentes et exige deux nouvelles reviews puis une nouvelle autorisation. Un `agent-handoff.v1` reste planning-only et ne peut pas être transformé implicitement en droit d’exécution.

### Quorum de reviews agentiques

Un futur `AgentReview v1` atteste une review lecture seule d’un plan ou d’un résultat :

- `subjectType`, digest du sujet et digests des preuves examinées ;
- référence et digest de la lignée `contributorAgentIds`, construite par le harness depuis ses événements attestés de write/hunk/correction, jamais fournie par le worker ;
- `reviewerAgentId` et `reviewerRunId` issus d’identités attestées par le harness ;
- verdict fermé `approve` ou `reject`, résumé borné de codes/sévérités fermés et référence digérée vers les findings détaillés tenant-private ;
- manifest du reviewer, profil d’isolation, claim de blind review, nonce one-shot, expiration et timestamp ;
- digest d’une préimage canonique et signature avec identifiant de clé.

Le seuil canonique est de deux reviews favorables provenant de deux `reviewerAgentId` distincts. Chacun diffère de tout agent de la lignée ayant produit, modifié ou corrigé le digest revu. Les reviewers opèrent dans des worktrees ou projections read-only séparés et ne partagent aucun état mutable avec l’exécution. Missions et le harness masquent toute review sœur jusqu’à soumission irrévocable du verdict ; cette non-disclosure est attestée, jamais confiée au prompt. Un reviewer qui modifie l’objet devient contributeur du nouveau digest et perd son éligibilité à le reviewer.

Un rejet empêche le quorum. Toute modification du plan, résultat, artefact ou preuve produit un nouveau digest et invalide toutes les reviews antérieures. Missions calcule le quorum à partir de la lignée et des attestations dont signature, clé, nonce, expiration, claim one-shot et isolation sont vérifiés ; toute absence ou divergence refuse le quorum. Ni le worker, ni l’orchestrateur ne peuvent déclarer eux-mêmes `validated`.

Après exécution, le résultat et ses preuves suivent le même protocole. Deux approvals sur le même digest permettent la transition technique `validated`. Pour les missions à risque élevé, la policy peut en plus imposer des pools, runtimes ou familles de modèles distincts. Les domaines protégés — contrats canoniques, auth, migrations, releases et déploiements — conservent le jalon humain exigé par les règles du dépôt.

### Commandes de contrôle

Un futur `OrchestratorControl v1` doit définir `start`, `pause`, `resume` et `cancel` avec :

- `tenantId`, `missionId`, `runId` et digest du plan ;
- identifiant de commande unique et clé d’idempotence ;
- révision attendue ;
- acteur et autorisation atténuée ;
- raison structurée, sans texte utilisateur requis.

`cancel` est monotone et terminal pour le run. Une révision attendue obsolète est signalée mais ne neutralise jamais un `cancel` autorisé visant exactement le même `runId` et le même digest de plan ; elle ne peut pas atteindre un autre run. `pause` interdit tout nouvel appel outil et demande l’arrêt borné des processus en cours. Si cet arrêt échoue, le harness coupe le groupe de processus et ses capacités avant tout événement terminal ; tant que l’absence d’effets ne peut pas être attestée, le run reste bloqué et ne déclare pas sa terminaison. `resume` ne remet aucun compteur à zéro.

### Événements v2

`orchestrator-event.v1` est insuffisant pour une exécution réelle. Un candidat v2 doit ajouter :

- digest du plan et identifiant du run ;
- séquence strictement croissante ;
- identifiant d’événement stable, identifiant de cause et digest de l’événement précédent ;
- commande corrélée, tentative et timestamp ;
- deltas et totaux de budgets monotones ;
- références content-addressed pour toute sortie ;
- raison et catégorie d’erreur fermées, sans message brut.

La répétition d’un événement est idempotente ; une divergence pour le même identifiant ou la même séquence est refusée. Un trou, une cause inconnue, un digest invalide ou un type inconnu est mis en quarantaine et ne peut jamais projeter un succès.

### Harness et sandbox

Un futur `HarnessProfile v1` doit décrire et attester séparément :

- racine du workspace, mounts lecture seule/écriture et chemins interdits ;
- résolution canonique des chemins et politique symlink ;
- isolation processus, UID, ressources et durée ;
- réseau worker désactivé hors Unix socket privé monté dans sa sandbox, ou namespace réseau privé équivalent ; peer OS et jeton de run sont tous deux vérifiés ;
- egress gateway limité à des origines exactes via résolution et connexion contrôlées ;
- secrets conservés hors de l’environnement et du filesystem worker, avec scope et expiration ;
- limites de sortie, journal et artefacts ;
- moteur de sandbox, manifests exécutés et capacités kernel réellement appliquées.

Une sandbox n’est jamais déduite d’un prompt, d’une permission Pi ou d’un worktree. Un profil obligatoire qui ne peut pas être appliqué échoue fermé. Les worktrees isolent les modifications, pas les privilèges. Les fichiers ignorés, répertoires personnels, sockets d’agent et stores de credentials ne sont jamais copiés par défaut.

Une permission shell porte sur un exécutable résolu et ses arguments structurés, jamais sur un simple préfixe de chaîne. Les chaînes, pipes, substitutions, sous-shells et wrappers sont refusés sauf capacité explicite couvrant chaque effet.

Un outil privilégié passe par un broker du harness qui revalide run, plan, outil, arguments, budget, expiration et policy. Le secret est injecté seulement dans le subprocess outil isolé, jamais dans Pi ; la capacité est one-shot et la sortie est redacted ou bloquée avant retour au worker.

### Autorisation

Biscuit reste deny-by-default avec tenant obligatoire :

- un reviewer agent peut soumettre une review pour un digest exact, sans droit d’exécuter ou modifier ce sujet ;
- Missions peut émettre l’autorisation seulement après vérification de deux reviewers éligibles et distincts ;
- l’orchestrateur peut contrôler un run et émettre ses événements ;
- le harness peut invoquer uniquement les outils du plan ;
- le worker peut utiliser une capacité locale atténuée à un run, un outil et une expiration ; le gateway conserve seul le secret provider amont ;
- aucun token individuel d’auteur, worker, reviewer, orchestrateur ou harness ne peut fabriquer le quorum, merger, releaser ou déployer ;
- chaque attestation de review est signée, expirante, one-shot et liée au digest du sujet, des preuves et de la lignée des contributeurs.

Une panne de révocation, une clé inconnue, un tenant absent ou un digest divergent refuse l’opération. Les octets des tokens ne sont jamais journalisés.

### Budgets

Les compteurs sont monotones et conservés à travers pause, reprise, retry et changement de worker. L’orchestrateur réserve un budget avant l’action et réconcilie le consommé après l’action. Une mesure provider non attestable ne peut qu’augmenter un compteur conservateur, jamais restaurer du budget.

Tout dépassement bloque les nouveaux effets, termine ou bloque le run selon le plan, puis émet une preuve minimale. Aucun retry ne contourne une limite globale.

### Événements, journal et vie privée

Les événements causaux v2 sont des enregistrements métier tenant-private : ils portent les identifiants nécessaires au protocole, suivent l’autorité et la rétention Missions et ne sont pas recopiés comme logs ou attributs OTEL.

Le journal opérationnel contient uniquement versions, catégories fermées, compteurs, décisions de policy et un identifiant de corrélation éphémère non réversible, sans table d’association persistée après le run. Sont exclus par défaut : `tenantId`, `missionId`, `runId` stable, identifiants utilisateur ou agent/reviewer, références d’artefact ou de review, prompts, code, diff, findings, chemins, commandes shell, arguments outils, emails, tokens et messages d’erreur bruts. Sa rétention courte et son niveau de précision temporelle sont fixés par le futur contrat de harness. Les métriques sont agrégées par défaut.

Le contenu nécessaire à une preuve, y compris les findings détaillés de review, est stocké séparément comme artefact privé tenant-scoped, avec classification, digest et classe de cycle de vie approuvée. Cette classe impose vues/exports au besoin d’en connaître, plafond de rétention, suppression/anonymisation et non-résurrection après restore selon `DATA-LIFECYCLE.md`. OpenTelemetry externe reste désactivé par défaut et sans contenu.

## Adaptation sélective de Grok Build

| Source/pattern | Traitement proposé | Gate avant code |
| --- | --- | --- |
| `xai-circuit-breaker` | évaluer un fork Rust renommé | closure licence/advisories + parité des 70 tests |
| `xai-grok-secrets` | extraire des règles de redaction | corpus Libre AI + tests faux positifs/négatifs |
| `xai-fast-worktree` | spike isolé, sans copie des ignored files | benchmark + threat model + remplacement des dépendances xAI |
| `xai-hunk-tracker` | reprendre le modèle d’événements, pas la crate entière | contrat Proof/Artifact distinct |
| sandbox Grok | reprendre profils et fixtures uniquement | sémantique fail-closed obligatoire |
| hashline | ne pas adopter par défaut | benchmark contre l’édition exacte Pi |
| memory/code graph | hors orchestrateur | nouveau package et consommateur approuvés séparément |
| TUI, shell, sampler, MCP hub, média, auth et télémétrie xAI | ne pas porter | hors cible |

Tout code repris conserve licence et notices, marque les modifications et reçoit un SBOM limité à sa closure. Aucun endpoint xAI, Mixpanel, Sentry ou GCS n’entre dans le graphe cible.

## Qualification de Pi

Pi est un adaptateur remplaçable et doit être qualifié avant usage :

- version et source épinglées ;
- licence et closure npm inspectées ;
- télémétrie et checks de mise à jour désactivés dans le profil harness ;
- aucun package projet auto-installé en mode non interactif ;
- extensions et skills chargés depuis un manifeste approuvé et digéré ;
- provider imposé par policy, via un gateway harness vers un endpoint local ou UE autorisé ;
- secret provider amont conservé dans le gateway ; Pi reçoit seulement un jeton local court lié au peer OS, inutilisable hors du run ;
- transport worker→gateway par Unix socket privé ou namespace réseau privé, jamais par loopback host partagé ;
- secrets d’outils conservés dans des brokers et injectés seulement aux subprocess isolés ;
- contenu modèle borné par finalité, base d’autorisation, classification, path scopes, taille, région, sous-traitants et politique de rétention/ZDR/non-réutilisation du plan ;
- RPC JSONL validé, borné en taille et traité comme entrée hostile ;
- aucune confiance accordée aux permissions applicatives Pi comme frontière OS.

L’adaptateur ne dépend pas des types internes de Pi. Un changement de worker ne modifie ni les contrats Missions, ni le plan, ni les événements.

## Menaces et refus minimaux

Les futurs vecteurs doivent couvrir au minimum :

- handoff planning-only utilisé comme autorisation d’exécution ;
- plan, résultat, preuve ou review substitué après signature ;
- auteur/exécuteur reviewant son propre digest, contributeur omis de la lignée, deux reviews du même agent ou reviewer autodéclaré ;
- review sans signature valide, nonce rejoué, attestation expirée ou verdict frère divulgué avant soumission ;
- ancien quorum réutilisé après modification du digest ;
- commande rejouée ou à révision obsolète ;
- événement dupliqué divergent, séquence manquante ou cause inconnue ;
- run cross-tenant ;
- extension de tool/path/network par sous-agent ;
- traversal, symlink et fichier ignoré contenant un secret ;
- chaîne shell autorisée par préfixe mais contenant un second effet ;
- sandbox indisponible ou attestation mensongère ;
- autre processus local tentant d’utiliser le gateway ou un jeton de run ;
- worker lisant un secret provider ou outil dans son environnement/filesystem ;
- DNS rebinding, redirect vers adresse spéciale et loopback hébergé ;
- retry après dépassement de budget ;
- token expiré/révoqué ou revocation store indisponible ;
- tenant, mission, run stable, prompt, code, chemin, commande, PII ou secret dans logs/OTEL ;
- preuve privée conservée au-delà de sa classe de rétention ou ressuscitée après restore ;
- worker déclarant un succès sans preuves digérées ;
- tentative d’auto-validation, fabrication de quorum, merge, release ou déploiement.

## Contrats requis par le lock

Cette RFC a conduit, après revues favorables, à un incrément contractuel séparé qui verrouille :

1. `execution-plan-body.v1.schema.json` ;
2. `agent-review.v1.schema.json`, préimage/signature, lignée attestée et règles de quorum à deux reviewers distincts ;
3. `execution-authorization.v1.schema.json` ;
4. `orchestrator-control.v1.schema.json` ;
5. `orchestrator-event.v2.schema.json` ;
6. `harness-profile.v1.schema.json` ;
7. `mission-record.v2.schema.json` et `missions.v2.yaml`, sans modifier les autorités v1 ;
8. une politique Biscuit dédiée aux auteurs, reviewers et runs, sans droit individuel de fabriquer un quorum ;
9. fixtures positives et négatives pour chaque invariant, séparation d’identités, non-disclosure, signature, expiration et replay ;
10. projections TypeScript/Rust reproductibles ;
11. dossier de revues architecture, sécurité et vie privée France/UE.

Les 14 entrées de catalogue sont verrouillées uniquement après les verdicts séparés, la candidate-integration remédiée, la passe de promotion et l’instruction propriétaire scoped. `WP-G2-A01` est ensuite ajouté pour le seul cœur de contrôle simulation-only ; ses `writePaths` sont exclusifs et ne couvrent ni Missions, ni harness runtime, ni adaptateur Pi.

## Non-objectifs

- implémenter l’orchestrateur, le harness ou une extension Pi dans cette RFC ;
- autoriser une mission réelle, un provider, un secret, une persistance ou du réseau ;
- créer un marketplace, une mémoire agentique ou un moteur agentique généraliste ;
- donner à un agent individuel des droits de quorum, merge, release, migration ou déploiement ;
- modifier `agent-handoff.v1`, `MissionRecord v1` ou l’API Missions v1 en place ; une famille v2 candidate est requise ;
- importer l’historique Git ou le workspace Grok Build.

## Gates de passage franchies

Le passage à l’écriture puis au verrouillage des contrats a exigé que :

- architecture confirme les quatre frontières et l’absence de seconde autorité Missions ;
- sécurité approuve le modèle fail-closed, les budgets, l’atténuation et la non-collusion minimale du quorum ;
- vie privée France/UE approuve journal, preuves, rétention et provider policy ;
- la qualification supply-chain de Pi est définie sans modifier le lockfile racine ;
- chaque ambiguïté de contrôle, causalité et comptage reçoit une sémantique testable.

Le Specification Lock contractuel n’autorise pas l’implémentation. Celle-ci reste bloquée jusqu’à un work package borné, une revue de conformité dédiée et le contrôle produit requis par la doctrine canonique.
