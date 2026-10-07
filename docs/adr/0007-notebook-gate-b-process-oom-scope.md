# ADR-0007 — Portée de la preuve OOM processus pour Notebook Gate B

- **Statut :** accepted
- **Date :** 2026-07-18
- **Portée :** Notebook Core v2 Gate B, fautes du host navigateur et sécurité de la qualification
- **Décision propriétaire solo :** l'OOM réel du processus navigateur devient un diagnostic facultatif ; Gate B exige la reprise bornée après faute processus, sans exiger une saturation mémoire dangereuse ou non portable

## Contexte

Les campagnes du host produit exact prouvent sur Chromium, Firefox et WebKit la reprise après terminaison abrupte et crash injecté, l'absence d'artefact partiel, le nettoyage du staging chiffré, la relance du même profil et l'utilisation d'un worker neuf. Les campagnes internes qualifient séparément le refus de `memory.grow`, une allocation Rust de 600 Mio contre le plafond WASM de 512 Mio, les fautes d'allocation `serde_json`/JCS/Argon2id, les traps, panic et timeouts.

Un diagnostic Chromium supplémentaire observe un renderer identifié et un vrai marqueur `V8 javascript OOM`, puis une reprise réussie. Il repose toutefois sur un cap V8 logiciel et ne possède pas d'équivalent sûr dans Firefox et WebKit. Aucune primitive commune aux trois moteurs ne permet de provoquer un OOM réel attribuable sans limite artificielle ni pression globale sur RAM ou swap.

Maintenir cette cause précise comme condition Gate B encouragerait un test dangereux, non portable et difficilement reproductible, alors que le comportement produit attendu après disparition du processus est déjà exercé. Renommer un signal injecté ou un refus d'allocation en OOM resterait trompeur.

## Décision

1. L'OOM réel du processus navigateur est classé `optional-diagnostic`. Son absence ne bloque plus Gate B et sa présence future ne remplace aucune preuve obligatoire.
2. Gate B conserve comme preuves processus obligatoires, dans les trois moteurs épinglés : terminaison abrupte, crash, watchdog borné, absence d'artefact partiel, nettoyage du staging, reprise du même profil et worker neuf après relance.
3. Les preuves mémoire internes restent obligatoires : plafond WASM 512 Mio, refus `memory.grow`, allocation Rust au-delà du plafond, failpoints d'allocation, traps/panic/timeouts et destruction de l'instance jetable.
4. Un résultat obtenu par cap V8, `ulimit`, cgroup, VM, throttling ou autre limite logicielle reste explicitement diagnostic-only. Il ne peut pas être présenté comme un OOM physique ou comme une qualification matérielle.
5. L'épuisement global de la RAM ou du swap de l'hôte, ainsi que toute allocation non bornée visant à faire tomber le système, sont interdits. La sécurité de l'hôte prévaut sur la complétude de cette observation.
6. Les paramètres Argon2id/AES-GCM, la limite plaintext 16 Mio, le plafond WASM, les budgets p95/RSS, la classe matérielle 32+ Gio et les trois moteurs restent inchangés.
7. Le diagnostic Chromium existant est conservé avec `promotableEvidence:false`. Une future preuve OOM sûre et attribuable sera additive et ne modifiera le support qu'après revue.
8. Cette décision ne prononce pas à elle seule le verdict Gate B. Le candidat exact doit encore recevoir les passes architecture, sécurité, cryptographie runtime, vie privée France/UE, performance/classes et candidate-integration.
9. Un éventuel `APPROVE` Gate B qualifie uniquement le composant et le host fixture-only examinés. Il n'active pas la feature, n'autorise aucune donnée utilisateur, production, release, infrastructure, offline/Service Worker ou revendication d'effacement physique.

Cette ADR remplace uniquement l'interprétation de l'OOM processus comme blocker dans les ADR-0005/0006 et les anciens rapports. Elle ne réécrit pas leurs constats historiques.

## Conséquences

- Gate B peut être évaluée sur les comportements de faute contrôlables et reproductibles plutôt que sur une cause de terminaison non portable ;
- le risque résiduel d'un OOM moteur réel reste documenté, sans faux crédit ;
- aucune campagne ne doit mettre l'hôte ou ses autres processus en danger pour fermer une case de qualification ;
- les preuves `SIGKILL`/`SIGABRT` gardent leur libellé exact et ne deviennent pas rétrospectivement des preuves OOM ;
- toute modification ultérieure de cette politique exige une nouvelle décision propriétaire et des revues fraîches.

## Alternatives rejetées

- **Saturer une machine dédiée jusqu'à un OOM physique :** rejeté, car le périmètre processus n'est pas garanti et le test peut affecter l'OS, le swap et les autres processus.
- **Promouvoir le cap V8 Chromium :** rejeté, car il est logiciel, mono-moteur et n'exerce pas l'opération produit exacte.
- **Assimiler `SIGKILL`, `SIGABRT`, `RangeError` ou refus `memory.grow` à un OOM navigateur :** rejeté, car la cause ne serait pas démontrée.
- **Supprimer tout suivi OOM :** rejeté ; le diagnostic reste utile comme observation additive et risque résiduel.
