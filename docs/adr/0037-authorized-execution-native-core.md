# ADR-0037 — Cœur natif d'exécution autorisée

- **Statut :** accepted — arbitrage propriétaire du 2026-09-10
- **Arbitrage :** recommandation A approuvée par le propriétaire en session par
  « oui ». Owner-arbitration: 2026-09-10
- **Étend :** ADR-0032 D38, ADR-0034 D40 et ADR-0036 D42
- **Applique :** I-08 (phases, critères et preuves), I-17 (acte propriétaire
  pour une surface à touche humaine) et I-21 (frontière code/données et zéro
  donnée personnelle dans le repository)
- **Autorise :** `WP-G3-O02` dans le crate pur
  `libre-ai-agent-orchestrator`
- **N'autorise pas :** persistance, horloge, logs, secrets, réseau, processus,
  intégration réelle avec Harness ou Missions, effet réel, déploiement ou
  dépendance à un framework

## Contexte et payoff

ADR-0036 a verrouillé onze familles de contrats d'exécution autorisée. Ce lock
stabilise les octets wire et les refus fermés ; il ne prouve pas qu'un runtime
les interprète correctement. Laisser la sémantique uniquement sous forme de
prose et d'un oracle TypeScript contraindrait chaque futur store, harness ou
worker à reconstruire ses propres choix de routage, replay, décision et
récupération d'effet.

Le cœur natif rend cette constitution exécutable sans devenir une seconde
autorité. À faits verrouillés identiques, il doit produire la même décision
fermée et reconstruire le même état en mémoire. La persistance et les
adaptateurs futurs auront ainsi une obligation plus petite : sérialiser ou
appliquer des décisions déjà définies, sans pouvoir les réinterpréter.

## Décision

### D1 — Étendre le crate pur existant

Orchestrator implémente indépendamment les sémantiques verrouillées après
validation stricte par le registre embarqué de SDK Rust. Contracts reste la
seule autorité des schémas, préimages, résultats sémantiques et vecteurs ; SDK
Rust reste une projection jetable. Les types internes du domaine ne sont ni
des contrats wire, ni une surface persistée.

Le crate existant conserve sa frontière sans effet. Il ne lit ni processus,
fichier, socket, environnement, thread, horloge, secret, store ou service. Le
temps et les observations autoritatives sont des entrées explicites. Le cœur
propose des applications, mais n'effectue aucune I/O.

### D2 — Refuser toute observation manquante et tout verdict préclassé

Une indisponibilité de causalité, collision, décision, lignée, statut
d'exécuteur, profil ou fencing refuse fermée. L'appelant fournit les faits
bruts observés ; il ne peut pas fournir un verdict déjà classé « exact »,
« divergent », « qualifié » ou « autorisé ». Le cœur compare lui-même les
identités, digests, générations, séquences, révisions et compteurs avec une
arithmétique vérifiée.

Les erreurs publiques contiennent uniquement des codes constants. Aucun objet
rejeté, identifiant, digest, prompt, payload, erreur brute ou donnée
personnelle ne peut entrer dans `Display`, `Debug`, les preuves ou une API de
log. Cette phase n'ajoute d'ailleurs aucune API de log.

### D3 — Prouver la sémantique indépendamment

L'acceptation requiert l'exécution Rust indépendante des 54 cas du document
sémantique Contracts épinglé : 11 graph, 9 causal, 11 decision, 11 effect,
4 authority et 8 transfer. Les attentes restent les chaînes littérales du
corpus ; l'implémentation ne peut ni appeler ni porter l'oracle TypeScript.

La preuve couvre aussi le replay déterministe, le routage fermé indépendant de
l'ordre de déclaration, les budgets monotones, les graphes maximaux bornés,
les substitutions cross-organization, et chaque observation indisponible. Un
benchmark reproductible mesure validation, routage et replay sans seuil CI
dépendant du matériel et sans nouvelle dépendance.

### D4 — Traiter l'état d'effet inconnu comme barrière de continuité

Cinq points de crash sont injectés contre un faux harness et un faux exécuteur
sans capacité réelle. Après un commit externe sans événement terminal,
`state-unknown` bloque la lignée tant qu'une observation terminale
autoritative n'est pas disponible. L'absence d'erreur n'est jamais assimilée
à un commit, et aucune reprise n'autorise une réémission aveugle. Chaque
scénario prouve au plus un commit externe factice.

### D5 — Maintenir la frontière avec le futur runtime

`WP-G3-O01` reste le package séparé de frontière de run. La Phase 4A ne prouve
ni la sérialisation transactionnelle PostgreSQL, ni l'idempotence ou le fencing
au point d'effet d'un exécuteur réel, ni les logs runtime allow-listés sans
PII, ni la rétention, les tombstones de suppression ou le replay de restore.
Ces quatre affirmations restent bloquantes avant toute exécution réelle.

### D6 — Garder LangGraph non normatif et supprimable

LangGraph reste un oracle de questions et de scénarios de panne. Il n'entre ni
dans les dépendances, ni dans les contrats, ni dans le checkpoint, ni dans la
machine d'état, ni dans l'autorité de transition. Un éventuel worker futur doit
être comparé aux mêmes comportements observables et pouvoir être retiré sans
modifier Missions ou Orchestrator.

## Sécurité et vie privée

La validation de schéma précède toute normalisation. Les structures qui
portent des valeurs wire ne dérivent pas un `Debug` révélateur ; les sorties de
diagnostic sont réduites aux codes et compteurs non sensibles. Les fixtures
sont synthétiques. Le gate de capacité existant reste bloquant et doit prouver
qu'aucune nouvelle primitive I/O, horloge, secret, store, provider ou
framework n'entre sous `src/`.

Cette frontière réduit l'attaque par injection : aucun texte libre, résultat
de modèle ou état interne de worker ne peut sélectionner une transition en
dehors du couple autorisé `(stepId, outcomeCode)`. Elle ne prétend toutefois
pas protéger un runtime réel tant que ses quatre preuves résiduelles ne sont
pas apportées.

## Performance et qualité

Chaque logique non triviale suit un cycle TDD rouge-vert-refactor. Les suites
Rust, clippy sans warning, gates Bun de capacité/secret/données personnelles,
licences, REUSE, CI de branche et CI post-merge sont obligatoires. Le crate
passe en `0.2.0` avec inventaires exhaustifs de symboles et codes publics ; les
API control et budget existantes gardent leurs signatures et comportements.

Le benchmark standard-library utilise les maxima contractuels de 256 steps et
512 edges ainsi qu'une longue chaîne d'événements. Il produit une baseline
comparable, pas une permission de dégrader un chemin chaud.

## Compatibilité et rollback

Le changement est additif et ne modifie aucun octet contractuel ni schéma
d'état persisté. Avant tout futur consommateur, le rollback est le revert des
commits Governance et Orchestrator de Phase 4A. Après consommation, le futur
adaptateur peut pinner la révision Orchestrator antérieure ; aucun événement
canonique n'a besoin de migration.

## Alternatives rejetées

### Créer un second crate pur

Rejeté : cela scinderait une seule autorité de décision entre deux crates sans
ajouter de frontière de sécurité. Le crate existant possède déjà la frontière
pure et les gates de capacité nécessaires.

### Ouvrir immédiatement la frontière de run

Rejeté : assembler simultanément le réducteur déterministe, la sérialisation
transactionnelle et les effets externes confondrait trois preuves
indépendantes. Une réussite E2E pourrait alors masquer une faiblesse de
causalité, de store ou d'exécuteur.

### Adopter LangGraph comme implémentation de référence

Rejeté : son comportement deviendrait une spécification implicite et son
retrait créerait une migration de l'autorité. Sa valeur reste celle d'un oracle
de recherche externe et contradictoire.

## Gate d'acceptation

`WP-G3-O02` n'est accepté que si une même révision Orchestrator immuable porte :

1. les pins exacts SDK Rust et Contracts, vérifiés depuis le checkout ;
2. les 54 vecteurs et leur inventaire exact, tous verts indépendamment ;
3. le replay byte-identique de la projection de test, le routage fermé et les
   observations indisponibles fail-closed ;
4. les cinq crashes sans retry aveugle, faux succès ou second commit factice ;
5. le benchmark reproductible, les snapshots `0.2.0`, la documentation API et
   le rollback ;
6. tous les gates locaux, les revues architecture/sécurité/vie privée séparées,
   la CI de branche et la CI post-merge vertes.

Tout finding Blocking ou Major invalide les preuves de la révision concernée.
La clôture de Phase 4A n'autorise ni Phase 4B, ni service, ni déploiement.
