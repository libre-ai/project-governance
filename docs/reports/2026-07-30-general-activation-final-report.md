# Rapport de cohérence final — activation générale (γ 3.7)

Livrable 11 de la mission d'activation (ADR-0020, design §7.3). Chaque
constat est mesuré à la date du rapport ; les commandes sont rejouables.

## Chiffres du jalon

- **34 dépôts** dans l'organisation, réconciliés avec l'inventaire par le
  gate `inventory-drift` (vert en continu).
- **33 fiches d'état** `project.v1.yaml` sous le gate de flotte
  `check-fleet-presentation` : 33 vérifiées, 1 sans fiche déclarée
  (`.github`, profil d'organisation), **0 divergence** présentation↔fiche.
- **Index de migration : 88 entrées** ; après les deux vagues de retrait
  γ 3.7, le hub est à sa forme d'archive (**50 fichiers trackés**) et le
  gate d'orphelins mesure **50/50 chemins rendus compte, 0 orphelin**.
- **Toolchain Bun re-hébergé** sous ce dépôt (§5.4.3), byte-identique
  (SHA256 contre-prouvé par re-téléchargement) ; adopté ici, la flotte
  bascule à ses bumps de génération.
- Revues K4 role-separated sur chaque PR structurante du jalon ; les
  fenêtres de rouge sont nommées avec leurs bornes dans le
  gate-acceptance-log (aucune masquée).

## Les sept contrôles du livrable

1. **Affirmations sans preuve** : les sections d'état des README sont
   générées depuis les fiches (sentinelles) et le gate de flotte échoue
   sur divergence — une affirmation d'état non prouvée ne peut pas
   persister sur une surface générée. Les surfaces rédigées (README org,
   bannière du hub) ont été vérifiées en revue K4 contre les registres.
2. **Pourcentages non calculables** : 1 sur 33 (`carriere`), affiché
   honnêtement (« Avancement non calculable — périmètre à clarifier »),
   conforme au design §6.3. Aucun pourcentage manuel nulle part.
3. **Phases sans critère de sortie** : 0 — le schéma exige
   `exit_criteria` non vide par phase, le validateur est bloquant.
4. **Projets sans utilisateur/résultat** : 0 — le schéma exige le
   `statement` complet (for/who_faces/enables/producing/without) ;
   33/33 fiches valides.
5. **Divergences présentation↔code** : 0 au gate de flotte ; les copies
   vendorées de contrats restent sous gates byte-exacts par repo.
   **Rectificatif du 2026-08-03.** Ce point affirmait que « le gate de
   dérive de migration asserte les doubles présences restantes (38
   adaptations déclarées) ». C'est faux, et ça l'était déjà à la
   publication. Exécuté, le gate imprimait `0 paths asserted
byte-identical, 0 listed adaptations` et sortait en 0 : son
   `SKIP_PREFIXES` couvrait exactement les familles restées des deux
   côtés, et il lisait la copie de l'index figée à γ 3.3 dans ce dépôt
   (56 entrées, toutes `pending`) au lieu de l'index d'autorité du hub
   (88 entrées, 5 `pending`).

   Ce que le gate aurait trouvé, mesuré le 2026-08-03 en forçant la
   fenêtre ouverte et sans aucun skip — méthode : comparer, pour chaque
   entrée `pending`, les blobs du hub à ceux de la destination.

   | Catégorie                                                   | Compte |
   | ----------------------------------------------------------- | ------ |
   | Fichiers présents des deux côtés avec des octets différents | **12** |
   | — dont déclarés dans `ADAPTED_FILES`                        | 4      |
   | — dont registres propres à l'archive (`ecosystem/`)         | 3      |
   | — dont non déclarés                                         | 5      |
   | Chemins du hub absents chez `libre-ai/contracts`            | **23** |

   Les 12 divergences sont toutes légitimes, mais pas pour la même
   raison : trois gates ont rétréci côté archive avec l'arbre qu'ils
   inspectaient, deux copies d'ici ont au contraire **grandi** de
   capacités flotte (`check-toolchain.ts` résout aussi depuis la git-dep
   épinglée, `check-secret-scan.ts` ignore les workspaces imbriqués), et
   les trois `ecosystem/` sont les registres que l'archive possède en
   propre — comparer sa carte d'état à la nôtre n'a pas de sens.

   Les 23 absences sont la catégorie la plus nombreuse et l'argument le
   plus fort de l'arbitrage retenu : `libre-ai/contracts` ne porte que
   le sous-ensemble d'auto-vérification et **consomme** le reste de
   l'outillage au lieu de le dupliquer. Rétrécir `SKIP_PREFIXES` les
   ferait toutes remonter en `missing at destination` et exigerait 23
   déclarations pour du contenu délibérément non dupliqué.

   Le gate lit désormais l'autorité, refuse de rendre vert un passage
   qui n'asserte rien tant que la fenêtre est ouverte, et déclare la
   fenêtre close depuis l'archivage plutôt que de se faire passer pour
   une vérification. Le retirer ou le réaffecter reste une décision
   propriétaire — non tranchée ici, et à porter au registre de décision
   plutôt qu'à la seule ligne de log du chemin vert.

6. **Preuves obsolètes** : `freshness.last_verified_on` ∈
   {2026-07-29, 2026-07-30} sur les 33 fiches au jour du rapport ; le
   champ est re-daté à chaque re-vérification et le validateur refuse
   les dates futures.
7. **Dépendances non documentées** : chaque fiche déclare ses
   dépendances avec leur raison et leur mécanisme de pin ; les pins
   réels sont surveillés par `check-fleet-pins` contre le registre des
   générations.

## Reliquats ouverts, nommés (aucun silencieux)

- **Arbitrage floor/round — TRANCHÉ (propriétaire, 2026-07-30)** :
  l'affichage montre la valeur mesurée exacte à une décimale (« 62,5 % »),
  gardes conservés ; l'arbitrage est dissous, plus aucun arrondi
  directionnel (`displayPercent`, test du cas historique inclus).
- **Amendement LEXICON §2 (couches manquantes)** : produit et signé par
  merge sous le GO propriétaire explicite du 2026-07-30 (§9 du LEXICON —
  six briques cartographiées, quatre couches déclarées, un outil nommé).
- **CL36-03** : le tableau généré du README d'organisation n'a pas encore
  son gate de dérive dédié (seule surface générée non gardée) — suivi
  routé depuis la clôture 3.6.
- **CL36-06** : la table générée du profil est monolingue (français) dans
  les deux langues du README d'organisation.
- **Adoption d'URL toolchain par la flotte** : les workflows des 32
  autres dépôts pointent encore la release du hub (archivé, les releases
  restent servies) ; bascule à chaque bump de génération.
- **Deny-list doctrine sans famille « stacks abandonnées »** : le balayage
  exhaustif post-activation (358 fichiers, 2026-07-30) n'a trouvé aucune
  prescription vivante de stack abandonnée — mais rien ne l'empêche
  machinalement à l'avenir. Ajouter une famille de motifs est une décision
  de conception de gate sur surface doctrinale (≈15 exclusions de citeurs
  légitimes, contrainte anti-motifs-inertes). **TRANCHÉ (propriétaire,
  2026-07-30) : statu quo — s'appuyer sur les revues**, le balayage
  exhaustif ayant montré zéro occurrence vivante ; ré-ouvrable si un cas
  réel apparaît.
- **Retraits `pending` restants** : les entrées d'archive à double
  présence volontaire (registres, chaîne minimale, toolchain) restent
  `pending` par construction jusqu'à l'archivage ; le gate d'orphelins
  les couvre nominativement.

## Lecture à trois niveaux (design §7.4)

- **Comprendre** : profil d'organisation + page d'accueil website
  (tableau d'état calculé) + fiche par dépôt.
- **Évaluer** : fiches (maturité ≠ avancement ≠ confiance, dépendances,
  non-objectifs), comparaisons datées et sourcées.
- **Vérifier** : gate-acceptance-log, index de migration, gates de
  flotte rejouables (`inventory-drift`), chaînes `bun run check` par
  dépôt, archive du hub clonable.
