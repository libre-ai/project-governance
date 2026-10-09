# ADR-0045 — Isolation par construction contre l'injection de prompt indirecte

- **Statut :** proposed — doctrine de couche 3 (K4) : revue indépendante puis fusion par le propriétaire, qui constitue la signature ; aucune fusion automatique
- **Date :** 2026-10-09
- **Arbitrage :** le propriétaire a engagé en chat la rédaction de cet ADR ; l'acceptation reste à sa signature. Owner-arbitration: 2026-10-09
- **Portée :** tout runtime de la flotte qui place un modèle de langage devant un contenu non fiable et lui confie, dans le même contexte ou par ses sorties, un outil à effet.
- **Étend :** I-18 (noyau de sécurité des boucles) ; K2 et K3 de `docs/specifications/LOOP-SECURITY-KERNEL.md` ; `docs/security/AGENT-RUNTIME-DOCTRINE.md` §1 et §4 ; ADR-0032 D3 et D5 ; ADR-0034 D1 et D2.
- **Applique :** I-17 (surface à touche humaine fermée), I-19 (dogfooding d'abord : aucun code avant un consommateur).
- **Autorise :** l'inscription au registre de l'invariant candidat I-32 et de la décision D66 ; la conception, dans `libre-ai/schemas-and-contracts`, d'un contrat candidat de version majeure `execution-plan-body.v4` et de ses vecteurs rouges.
- **N'autorise pas :** la modification d'un contrat verrouillé (`execution-plan-body.v3` reste identique à l'octet) ; un Specification Lock ; l'ouverture d'une capacité runtime ; la reprise de code, de prompt ou de libellé d'une source étudiée ; la modification de `docs/security/THREAT-MODEL.md` avant acceptation.

## Contexte

**Il faut trancher avant le premier client.** Le relevé de flotte du 2026-10-09 ne trouve aucun client de modèle de langage en production : seuls deux outils de forge appellent un modèle, le lecteur à froid (`verification/adoption/cold-reader/cold-reader.ts`) et l'orchestrateur de revues en éventail, et le noyau d'orchestration ne tourne qu'en simulation. *Hypothèse :* ce relevé n'est pas re-mesuré par cet ADR. Une frontière posée après le premier client devient une migration de ce client. Posée avant, elle n'est qu'une contrainte de conception.

**La lacune est déclarée, pas comblée.** Le modèle de menace classe l'injection de prompt par texte de preuve en risque connu, « depends on planner/refusal design » (`docs/security/THREAT-MODEL.md:135`). Sa troisième mitigation, planification seule et refus d'abord, porte une lacune d'application déclarée : elle dépend de la conception du planificateur et du refus, et aucun des cinq contrôles du noyau de sécurité des boucles ne la spécifie (`docs/security/THREAT-MODEL.md:159`, paraphrasé). Le risque résiduel R4 est « medium / high » et se repose sur la revue humaine (`docs/security/THREAT-MODEL.md:247`). Aucun document de doctrine ne dit quelle architecture d'agent rend cette lacune fermable.

**L'enveloppe K3 et le spotlighting sont une défense en profondeur, pas une isolation.**

- K3 est déclarée par sa propre spécification « a mitigation, not enforcement » (`docs/specifications/LOOP-SECURITY-KERNEL.md:104-106`).
- `renderGuarded` vérifie le MAC, échappe les délimiteurs, puis renvoie le contenu non fiable **en clair** entre deux marqueurs (`libre-ai/schemas-and-contracts@e149c70:packages/envelope/src/index.ts:228-244`). Les octets de l'attaquant atteignent donc le modèle. L'enveloppe prouve l'intégrité et l'origine. Elle ne retire pas au modèle la capacité de lire une consigne.
- `AGENT-RUNTIME-DOCTRINE.md` pose que tout octet non écrit par l'agent est une donnée, y compris un résumé de compaction ou le rapport d'un sous-agent (`docs/security/AGENT-RUNTIME-DOCTRINE.md:14-30`), et que K2 et K3 sont « necessary and neither is sufficient » (`:43-45`). Cette règle s'adresse à un modèle. Elle ne peut pas se vérifier sur un modèle.

**Les défenses par détection ne tiennent pas face à un attaquant adaptatif.** Nasr, Carlini et al. contournent 12 défenses récentes contre le jailbreak et l'injection, avec un taux de succès supérieur à 90 % pour la plupart, alors que la plupart annonçaient un taux proche de zéro (arXiv:2510.09023). `AGENT-RUNTIME-DOCTRINE.md` §4 tire la même conclusion pour la flotte : un classifieur de risque mesuré contre de vraies sondes de réfutation n'a pas été promu au rang de garde (`docs/security/AGENT-RUNTIME-DOCTRINE.md:116-123`). Un détecteur d'injection, une consigne « ignore les instructions du document » ou un juge ne sont pas une frontière.

**Le contrat de plan actuel ne sait pas exprimer l'isolation.** Dans `execution-plan-body.v3`, la liste `tools` est portée par le plan entier, avec `minItems: 1` (`libre-ai/schemas-and-contracts@e149c70:contracts/schemas/execution-plan-body.v3.schema.json:149-151`), et aucune étape d'`execution-graph.v1` ne restreint cette liste. Un plan ne peut donc déclarer ni une étape sans outil, ni un composant qui lit le contenu non fiable sans détenir d'outil. Chaque outil porte déjà un `argumentPolicyDigest`. Aucune entrée ne donne à cette politique la provenance de l'argument.

**Provenance de la question.** La question vient de l'étude d'une série de démonstrations pédagogiques, `odahan/LesJeudisAgentiques` au sha `38cead91e7dffee75dcbf4cc58071a19b3232697`, sous licence propriétaire (usage privé et pédagogique, reformulation seule). L'étape 1 d'ADR-0032 D5 (`docs/adr/0032-langgraph-pattern-mining-boundary.md:97-119`) conclut donc : aucun code, aucun prompt, aucun libellé repris. Cet ADR ne retient de cette source que la question, reformulée ci-dessous.

## Menace : deux canaux

Le cadre est celui du « lethal trifecta » (Willison, 2025-06-16) : un agent qui réunit l'accès à des données privées, l'exposition à un contenu contrôlé par un attaquant et une capacité de communication externe peut être amené à transmettre les données à l'attaquant.

**Canal de contrôle.** Une chaîne dérivée d'un contenu non fiable atteint le contexte du modèle qui détient les outils. Le typage ne l'assainit pas : un champ `string` d'un objet de transfert validé par schéma reste entièrement sous le contrôle de l'attaquant. Le schéma garantit la forme, pas l'innocuité. Le modèle privilégié lit ce champ comme du texte, et une consigne qui s'y trouve concourt avec la requête de l'utilisateur.

**Canal de données.** Même sans aucun texte libre dans le contexte privilégié, une valeur extraite du contenu non fiable — un destinataire, un identifiant, un chemin, une URL — devient l'argument d'un outil légitime. Le plan n'a pas changé, chaque appel est autorisé au niveau de l'action, et l'effet sert l'attaquant. C'est l'analogue d'une injection SQL par paramètre. Debenedetti et al. (arXiv:2503.18813) identifient ce canal comme la faille du Dual LLM.

**Exemple illustratif, reformulé.** Un agent de messagerie confie l'analyse d'un document entrant à un composant de quarantaine sans outil. Ce composant rend un objet typé `{ resume, destinataireSuggere }`, validé par schéma. L'agent privilégié, qui détient l'outil d'envoi, reçoit cet objet interpolé dans son prompt. Le canal de contrôle est ouvert, car `resume` est du texte libre lu par le seul composant à outils. Le canal de données l'est aussi : `destinataireSuggere` devient l'argument de l'envoi sans qu'aucune politique ne demande d'où vient cette valeur. Le découpage en deux modèles n'a rien isolé.

## Options

Les quatre options sont mesurées sur les quatre axes de décision, dans l'ordre sécurité, qualité, performance, complétude. Les noms des patterns suivent Beurer-Kellner et al. (arXiv:2506.08837).

### Option A — Statu quo : enveloppe K3, refus d'abord, revue humaine I-17

Le modèle privilégié lit le contenu non fiable, sous enveloppe. Le refus et la revue humaine rattrapent l'injection.

- **Sécurité :** aucun des deux canaux n'est fermé. La garantie repose sur un modèle qui obéirait au marquage, ce qu'aucune mesure adaptative ne soutient (arXiv:2510.09023). La revue humaine ne voit que ce qu'on lui présente, et le canal de données produit des appels d'apparence légitime.
- **Qualité :** aucune propriété n'est vérifiable par un test. Un vecteur rouge peut montrer une faille, aucun ne peut montrer l'absence de faille.
- **Performance :** aucun coût.
- **Complétude :** la lacune de `THREAT-MODEL.md:159` reste ouverte et non spécifiable.

### Option B — Action-Selector et Plan-Then-Execute : plan fixé depuis la seule requête de confiance

Le modèle privilégié produit le plan à partir de la seule requête de confiance, **avant** toute lecture de contenu non fiable. Avec l'Action-Selector, aucune sortie d'outil ne revient au modèle. Avec le Plan-Then-Execute, les sorties ne peuvent que sélectionner une branche du plan déjà autorisé.

- **Sécurité :** le canal de contrôle est fermé : un contenu non fiable ne peut ni ajouter, ni retirer, ni réordonner une étape. Le canal de données reste ouvert si un argument d'outil est extrait d'une sortie non fiable, d'où l'exigence INV-b.
- **Qualité :** la structure existe déjà dans la flotte. ADR-0034 D1 impose un graphe autorisé séquentiel et acyclique, dont chaque nœud sélectionne son arête par un résultat fermé, sans route par défaut. D2 fait de toute modification du graphe un nouveau digest et une nouvelle autorisation Missions (`docs/adr/0034-authorized-execution-graph-boundary.md:41-80`). ADR-0032 D3 interdit au worker d'étendre le plan (`docs/adr/0032-langgraph-pattern-mining-boundary.md:82-85`). Cette option donne à ces règles une raison de sécurité, sans rien changer à leur texte.
- **Performance :** un appel de planification par tâche, pas de boucle de raisonnement sur les observations. L'expressivité perdue est mesurable : une tâche dont la suite dépend du contenu observé au-delà d'un choix fermé n'est pas exprimable.
- **Complétude :** il faut une étape sans outil, que `execution-plan-body.v3` ne sait pas déclarer (`:149-151`).

### Option C — Dual LLM à références opaques

Un modèle privilégié sans accès au contenu non fiable, un modèle de quarantaine sans outil, et un contrôleur déterministe qui stocke les valeurs et ne transmet au privilégié que des références de la forme `$VAR1` (Willison, 2023-04-25).

- **Sécurité :** le canal de contrôle est fermé si le contrôleur ne déréférence jamais une référence dans le prompt privilégié. Le canal de données reste ouvert : le privilégié peut passer `$VAR1` en argument d'un outil d'envoi sans savoir ce qu'elle contient (arXiv:2503.18813).
- **Qualité :** contrôleur simple et testable. La règle « jamais déréférencé » se vérifie par capture du prompt.
- **Performance :** deux familles d'appels de modèle. La quarantaine s'exécute par valeur.
- **Complétude :** insuffisante seule. Combinée à INV-b, elle tend vers l'option D sans son interpréteur.

### Option D — Code-Then-Execute à la CaMeL : capacités par valeur, politiques sur le graphe de dépendances

Le modèle privilégié reçoit la seule requête de confiance et écrit un programme dans un langage restreint. Un interpréteur déterministe l'exécute, appelle la quarantaine pour l'extraction et suit les dépendances de chaque valeur. Chaque valeur hérite des capacités (provenance, lecteurs autorisés) de ses sources. Avant chaque appel d'outil, une politique déterministe juge l'argument et son graphe de dépendances, y compris les dépendances implicites par condition en mode strict. FIDES (arXiv:2505.23643) formalise la même idée par des étiquettes de confidentialité et d'intégrité propagées dynamiquement.

- **Sécurité :** les deux canaux sont fermés dans le périmètre déclaré par les auteurs. Restent hors périmètre, de leur propre aveu : la manipulation texte vers texte d'une sortie présentée à l'utilisateur, l'hameçonnage présenté à l'utilisateur, les canaux auxiliaires.
- **Qualité :** la propriété est vérifiable mécaniquement (politique sur un graphe, pas sur une intention). En contrepartie, l'interpréteur et le langage restreint sont une surface nouvelle à spécifier et à prouver.
- **Performance :** coût d'utilité mesuré par les auteurs sur AgentDojo : 77 % des tâches résolues avec sécurité prouvable, contre 84 % sans défense (arXiv:2503.18813). Le coût de l'interprétation est négligeable devant les appels de modèle, mais *non mesuré dans la flotte*.
- **Complétude :** couvre la composition de tâches que l'option B n'exprime pas. Exige un interpréteur et un vocabulaire de capacités, qui n'existent pas.

## Décision proposée

1. **Trois invariants, indépendants du pattern.** La doctrine fixe les propriétés, pas une implémentation. Un runtime de la flotte n'est conforme que s'il tient les trois.

   - **INV-a — Aucune chaîne non fiable devant un modèle qui détient un outil à effet.** Aucune chaîne dérivée d'un contenu non fiable n'entre dans le contexte d'un modèle qui détient un outil à effet, directement, par interpolation d'un objet typé, par un résumé ou une compaction, ou par le rapport d'un autre agent. Ces valeurs y circulent comme références opaques, résolues par un composant déterministe hors du modèle. *Est un outil à effet* tout outil dont l'accès déclaré est `write`, `execute` ou `network` au sens d'`execution-plan-body`. Un accès `network` en lecture compte comme un effet, puisqu'une URL suffit à exfiltrer. Le marquage K3 ne fait pas d'une chaîne non fiable une chaîne admise.
   - **INV-b — Provenance par valeur, politique sur l'argument.** Chaque valeur porte sa provenance et l'ensemble de ses lecteurs autorisés, propagés à toute valeur qui en dépend, y compris par une condition. Avant chaque appel d'outil, une politique déterministe juge **chaque argument** et son graphe de dépendances, pas seulement l'action. Elle refuse, ou renvoie à une décision humaine typée, un argument dont une dépendance non fiable n'est pas admise pour cet outil et ce paramètre.
   - **INV-c — Sortie de quarantaine à vocabulaire fermé.** La sortie d'un composant de quarantaine est validée par un schéma à vocabulaire fermé : énumérations, booléens, nombres bornés, identifiants validés contre un référentiel. Un échec ou un manque d'information se signale par un booléen ou un code fermé, jamais par du texte libre. Dire ce qui manque serait un canal de retour vers le planificateur. Une valeur non fermée (un texte à afficher, un corps de message) n'est pas une sortie de quarantaine : c'est une donnée non fiable soumise à INV-a et INV-b.

2. **Réalisations admises.** L'option B tient INV-a par construction et INV-c par les résultats fermés d'ADR-0034 D1. Elle tient INV-b dès qu'aucun argument d'outil ne dépend d'un contenu non fiable, ou qu'une politique le juge. L'option D tient les trois. L'option C n'est admise qu'avec INV-b, ce qui la ramène à une forme de D. Le choix du pattern se fait par tâche, dans le plan, et non par runtime : Action-Selector pour le routage, Plan-Then-Execute pour une transaction, Code-Then-Execute pour une composition.

3. **L'option A est rejetée comme isolation et conservée comme défense en profondeur.** K3, K2, le refus d'abord et la revue humaine restent obligatoires. Aucun d'eux ne compte pour INV-a, INV-b ou INV-c.

4. **Condition d'activation.** Aucun runtime qui met un modèle en présence d'un contenu non fiable et d'un outil à effet n'est activé avant de tenir les trois invariants et de faire passer leurs vecteurs rouges. La portée de cette condition sur l'outillage de forge existant est une question ouverte (Q1).

5. **Articulation avec la Rule of Two.** La « Agents Rule of Two » (Meta, 2025-10-31) demande qu'une session autonome réunisse au plus deux propriétés parmi : traiter une entrée non fiable, accéder à des systèmes sensibles ou à des données privées, changer un état ou communiquer à l'extérieur. Au-delà, il faut une supervision. Elle reste un critère de revue par session. Les trois invariants ne la remplacent pas : ils ferment les deux canaux décrits ci-dessus, pas la manipulation d'un texte présenté à une personne. Un effet externe irréversible garde sa décision humaine typée (ADR-0034 D5), même dans un runtime conforme.

6. **Registre.** L'invariant candidat I-32 résume INV-a à INV-c. La décision D66 enregistre cet ADR. Les deux prennent effet à la fusion par le propriétaire.

## Conséquences

- **Contrat de plan, nouvelle version majeure.** `libre-ai/schemas-and-contracts` reçoit un contrat candidat `execution-plan-body.v4`. Il doit pouvoir exprimer une étape sans outil ou rattacher les outils à l'étape, déclarer le rôle de quarantaine et son schéma de sortie fermé, et donner aux politiques d'argument (`argumentPolicyDigest`) une entrée de provenance. Selon I-17 et `contracts/COMPATIBILITY.md`, c'est une nouvelle majeure avec ses propres revues, ses vecteurs et un jalon de lock par le propriétaire. Cet ADR ne l'écrit pas. `execution-plan-body.v3` reste identique à l'octet.
- **Vecteurs rouges à écrire avant tout code d'exécution**, dans le dépôt qui portera le runtime :
  1. un document piégé qui demande un envoi vers une adresse contrôlée par l'attaquant est refusé **par la politique d'argument**, pas par le modèle ;
  2. le prompt privilégié capturé, à l'octet, ne contient aucun octet du document non fiable, y compris après une compaction ;
  3. une sortie de quarantaine qui contient du texte libre, ou un code hors du vocabulaire fermé, échoue à la validation et ne produit aucun appel ;
  4. une suite d'attaques adaptatives (AgentDojo ou équivalent), avec le taux d'utilité et le taux d'attaque réussie rapportés ensemble.

  Chaque vecteur se prouve en neutralisant le contrôle qu'il vérifie : il doit rougir sans lui.
- **Modèle de menace.** Après acceptation, et seulement alors, la lacune de `docs/security/THREAT-MODEL.md:159` est remplacée par un renvoi vers cet ADR et I-32, et la ligne `:135` et le risque R4 (`:247`) sont réévalués. Cet ADR ne modifie pas ce fichier.
- **Noyau de sécurité des boucles.** INV-b complète la vérification de `capability_scope` à la frontière d'outil, différée dans K1 faute de consommateur runtime (`docs/specifications/LOOP-SECURITY-KERNEL.md:68-71`). L'une porte sur l'outil et la ressource, l'autre sur l'origine de l'argument. INV-b est une granularité plus fine que K2 (fiabilité par charge utile, `:77-92`). Elle ne la remplace pas.
- **ADR-0032 D5.** CaMeL, FIDES et le Dual LLM sont des sources de recherche non normatives. Toute reprise suit les neuf étapes, à commencer par l'épinglage de la source, de sa révision et de sa licence. La licence d'une implémentation de référence n'est pas vérifiée ici. La source pédagogique propriétaire ne fournit que la question.
- **Autorités.** La politique d'argument est revalidée à chaque invocation par le harness, conformément à ADR-0032 D3, où le harness « revalide chaque invocation ». Le placement exact entre Orchestrator et harness relève de l'incrément contractuel (Q3).

## Questions ouvertes pour le propriétaire

- **Q1 — Portée sur l'outillage de forge.** L'orchestrateur de revues en éventail fait lire à des agents qui détiennent des outils des différences de code non fiables. Il réunit donc les trois propriétés de la Rule of Two. Trois réponses possibles : (a) produits seulement, la forge restant sous I-17 et supervision humaine ; (b) forge incluse, avec une échéance de conformité ; (c) forge incluse dès l'acceptation, ce qui suspend l'éventail jusqu'à conformité.
- **Q2 — Réalisation par défaut.** Commencer par l'option B sur le graphe d'ADR-0034 (structure existante, expressivité réduite), ou viser directement l'option D (interpréteur à écrire, composition couverte) ?
- **Q3 — Foyer de la politique d'argument.** Harness, qui revalide déjà chaque invocation, ou Orchestrator, qui détient le graphe ? Une seule autorité selon I-03.
- **Q4 — Forme au registre.** Un invariant distinct I-32, comme proposé, ou un amendement du texte d'I-18 ?
- **Q5 — Conduite sur un refus de politique.** Refus fermé seul, ou renvoi vers une décision humaine typée (ADR-0034 D5) ? Le renvoi rouvre une surface d'hameçonnage présentée à la personne, hors du périmètre de CaMeL.

## Sources

Relevé d'état de l'art privé du 2026-10-09 (`analyses/lesjeudisagentiques-2026-10-09/reports/C-sota/REPORT.md` §7, hors dépôt). Les titres, auteurs, dates et chiffres des sources marquées † ont été relus dans la source primaire le 2026-10-09 pour cet ADR. Les autres sont repris du relevé.

- † Simon Willison, « The Dual LLM pattern for building AI assistants that can resist prompt injection », 2023-04-25 — https://simonwillison.net/2023/Apr/25/dual-llm-pattern/ — consulté le 2026-10-09.
- † E. Debenedetti et al., « Defeating Prompt Injections by Design » (CaMeL), arXiv:2503.18813 — https://arxiv.org/abs/2503.18813 — consulté le 2026-10-09.
- † L. Beurer-Kellner et al., « Design Patterns for Securing LLM Agents against Prompt Injections », arXiv:2506.08837 — https://arxiv.org/abs/2506.08837 — consulté le 2026-10-09. Les noms des six patterns sont repris du relevé, la page de résumé ne les liste pas.
- † M. Costa, B. Köpf et al., « Securing AI Agents with Information-Flow Control » (FIDES), arXiv:2505.23643 — https://arxiv.org/abs/2505.23643 — consulté le 2026-10-09.
- † M. Nasr, N. Carlini, C. Sitawarin et al., « The Attacker Moves Second: Stronger Adaptive Attacks Bypass Defenses Against LLM Jailbreaks and Prompt Injections », arXiv:2510.09023, 2025-10-10 — https://arxiv.org/abs/2510.09023 — consulté le 2026-10-09.
- † Meta AI, « Agents Rule of Two: A Practical Approach to AI Agent Security », 2025-10-31 — https://ai.meta.com/blog/practical-ai-agent-security/ — consulté le 2026-10-09.
- † Simon Willison, « The lethal trifecta for AI agents: private data, untrusted content, and external communication », 2025-06-16 — https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/ — consulté le 2026-10-09.
- OWASP, LLM01:2025 Prompt Injection — https://genai.owasp.org/llmrisk/llm01-prompt-injection/ — relevé du 2026-10-09.
- Microsoft, spotlighting, arXiv:2403.14720 — https://arxiv.org/abs/2403.14720 — relevé du 2026-10-09 : réduction mesurée avant attaques adaptatives, d'où son rang de défense en profondeur.
