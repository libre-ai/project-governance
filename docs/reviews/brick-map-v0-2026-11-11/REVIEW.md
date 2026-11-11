<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-minor-reservations

# Carte des briques, première implémentation d'ADR-0064 : trois passes de revue de code, deux audits des données

**Date :** 2026-11-11
**Objet :** le gate `ecosystem/check-briques.ts`, sa bibliothèque `ecosystem/briques.ts`, le schéma `ecosystem/schemas/brique.v1.schema.json`, leurs tests, leur câblage, et les données sous `ecosystem/briques/` (onze fichiers de couche, une fiche par brique).
**Nature :** dossier de revue d'une pull request écrite par un agent sur la consigne « go » du propriétaire du 2026-11-11. ADR-0064 reste au statut proposé : ce dossier ne vaut pas arbitrage du propriétaire, il rend compte de ce qui a été relu, par qui, sur quel commit, et de ce qui ne l'a pas été.
**Rôles :** chaque passe est une passe de revue seule (`candidate-integration`), faite par un sous-agent à contexte neuf qui n'a pas écrit ce qu'il relit et n'a pas reçu les conclusions de l'auteur. Aucune n'a modifié un fichier suivi ; les empreintes de début et de fin sont dans chaque rapport. Modèle des cinq passes : `claude-fable-5-2`.

## Les passes

| Passe | Objet | Commit relu | Verdict | Rapport |
| --- | --- | --- | --- | --- |
| 1 | code, revue adverse | `1436e0f766fe4ba1549b420fab29c16ef03849c8` | `reject` | `1436e0f766fe4ba1549b420fab29c16ef03849c8/REVIEW.md` |
| 1 | données, audit de 22 briques | même commit | 5 corrections bloquantes, 9 majeures | `1436e0f766fe4ba1549b420fab29c16ef03849c8/DATA-AUDIT.md` |
| 2 | code, revue adverse | `6e562e1b7b1acc5d8b89a92f8ec385aa81a79f08` | `approve-with-minor-reservations` | `6e562e1b7b1acc5d8b89a92f8ec385aa81a79f08/REVIEW.md` |
| 2 | données, audit de 22 autres briques | même commit | 3 corrections bloquantes, 9 majeures | `6e562e1b7b1acc5d8b89a92f8ec385aa81a79f08/DATA-AUDIT.md` |
| 3 | code, delta depuis la passe 2 | `2842e670b997378cf3bcad123df85fe260ab26f6` | `approve-with-minor-reservations` | `2842e670b997378cf3bcad123df85fe260ab26f6/REVIEW.md` |

Ces trois commits sont des commits de la branche de travail. La fusion par squash ne les garde pas : les rapports citent leurs empreintes de fichiers, qui restent comparables.

## Code : ce que chaque passe a trouvé, et ce qui a suivi

**Passe 1, `reject`.** Trois faux verts exécutés sur la dérivation du statut : une preuve locale « existait » dès que `existsSync` répondait vrai (un répertoire, un lien vers un fichier hors de l'arbre, un fichier non suivi, la fiche de la brique elle-même) ; une citation épinglée écrite avec un échappement YAML était acceptée par le gate et invisible du gate des citations, à qui sa résolution est déléguée ; `ecosystem/briques` en lien symbolique était suivi. Seize autres constats, mineurs ou non bloquants.

Suite : la carte et les cibles de preuve sont lues dans l'index git, avec leur mode ; une citation épinglée doit être lue par le lecteur du gate des citations (`scanText`) dans le texte brut du fichier de couche et ne pas y être exemptée ; le statut en prose est cherché dans toute la fiche et dans les champs de prose du YAML ; une règle nouvelle, « ce que le YAML cite, la fiche le nomme » ; `findCycles` linéaire ; des vecteurs de schéma par contrainte.

**Passe 2, `approve-with-minor-reservations`.** Les trois faux verts de la passe 1 sont refusés par sonde exécutée. Cinq réserves mineures : l'index donnait les noms et les modes, le disque le contenu, donc un fichier corrigé sur le disque sans être indexé était jugé vert (local seulement) ; l'ADR citait ce dossier, alors absent ; « la fiche le nomme » était satisfait par une mention dans un commentaire ou une balise ; deux canaux imprimaient une ligne forgée par une donnée ; 36 mutants non équivalents survivaient.

Suite : un fichier lu dont le contenu n'est pas celui de l'index est refusé ; la règle de nommage lit une prose d'où titres, commentaires, définitions de lien et balises sont retirés ; chaque item et chaque note passent par un point unique qui rend visibles les caractères de contrôle ; des tests pour les mutants des règles principales.

**Passe 3, `approve-with-minor-reservations`.** Aucun faux vert atteignable sur un checkout de CI. Deux réserves mineures, locales : la comparaison par `git diff-files` refusait un fichier dont seuls les horodatages avaient changé ; cinq sources de doctrine (invariants, registre, inventaire, configuration des citations, catalogue) étaient lues sur le disque sans comparaison à l'index. Huit constats non bloquants.

Suite, **non relue par une passe indépendante** : la comparaison se fait par contenu (`git hash-object` contre l'objet de l'index) et couvre les sources de doctrine et le README de la carte ; le motif des balises et la lecture d'un titre sont linéaires ; un titre suivi d'une tabulation est lu ; les caractères C1 et les deux séparateurs de ligne Unicode sont rendus visibles ; le README déclare les limites du lecteur. Preuve de ce dernier delta : les deux suites (`bun test ecosystem/briques.test.ts ecosystem/check-briques.process.test.ts`, 204 verts) et une campagne de 45 mutations par substitution, une règle neutralisée à la fois, qui font toutes rougir au moins un test, le code étant restauré à l'identique ensuite (`git diff` vide).

## Données : ce que les audits ont mesuré

Les 99 briques ont été écrites par neuf sous-agents, une couche chacun, puis corrigées en deux tours par quatre sous-agents à contexte neuf.

| Mesure | Audit 1 (22 briques, avant correction) | Audit 2 (22 autres briques, après le premier tour) |
| --- | --- | --- |
| Briques avec au moins un défaut de fond | 18 sur 22 | 7 sur 22 |
| Liens d'invariant voisins ou sans rapport | 24 sur 59 | 4 sur 33 |
| Décisions déformées | 5 corrections bloquantes | 0 sur 80 |
| Fiche contredite par sa propre preuve | 2 | 1 |

Les deux échantillons sont disjoints et choisis par rang d'identifiant, pas au hasard. Le classement « lie » ou « voisin » d'un invariant est un jugement de lecture appuyé sur la phrase citée de l'invariant, pas une mesure.

Après l'audit 2, le second tour a appliqué ses corrections et relu à fond, preuve ouverte contre fiche, les 55 briques qu'aucun audit n'avait lues. **Aucun audit indépendant n'a relu la carte après ce second tour.** Ce que le gate garantit sur l'état final est mécanique (schéma, dépendances, existence des cibles, nommage dans la fiche) ; la justesse de chaque phrase repose sur ces deux tours.

État final, à rejouer par `bun run check:briques` avant de s'en servir : le gate imprime le nombre de briques par couche et par statut, les preuves tenues, et les identifiants des briques hors `gouvernance` qu'aucun invariant ne lie. Les 69 citations épinglées de l'état final ont été résolues une fois par un second instrument, la récupération du commit par git et le test du chemin à ce commit (65 cibles distinctes sur 14 commits de dépôts, 65 résolues) ; le gate des citations épinglées les résout en CI.

## Ce qui reste ouvert, déclaré

- **Mutants survivants.** La passe 3 en compte 29 sur 68 reconstruits, dont 18 sur les règles de son delta : bornes de longueur du schéma, tolérance de date, modes `160000` et `100755`, lecture des exemptions. Plusieurs ont reçu un test depuis ; le compte n'a pas été refait par un relecteur.
- **Le gate lit du texte, pas un rendu Markdown.** Titres setext, balises sur deux lignes, graphies qui imitent une valeur de statut : limites déclarées dans `ecosystem/briques/README.md`.
- **`prototypee` n'est pas atteignable** : aucun instrument ne vérifie une release signée liée à son évidence (ADR-0064, précision 6).
- **Huit règles de couche sur onze sont déclaratives.** Le gate les imprime comme telles.
- **Rien n'a tourné sous le Bun épinglé de la CI** pendant les passes (`1.4.0-canary.1` en CI, `1.4.4-canary.1` en local) : la CI de la pull request est le premier instrument sous cette version.
- **Le workflow `brick-map.yml` n'est pas un check requis.** Le rendre requis est un acte du propriétaire (ADR-0064, « Retour arrière »).

## Ce que la revue a trouvé hors de son objet

Relevés par les sous-agents pendant la lecture des preuves, non corrigés ici :

- le contrôle planifié de dérive du README d'organisation (`org-readme-drift.yml`) est en échec sur ses quatre dernières exécutions planifiées (relevé du 2026-11-11 par l'API des runs) ;
- `brand/README.md` et la projection de marque listent encore un dépôt que D80 a sorti de l'inventaire, et le gate de marque ne vérifie l'inventaire que dans un sens ;
- la ligne de statut d'ADR-0065 dit encore « proposé — la fusion de cette pull request vaut signature », alors que le fichier est fusionné et que ses décisions sont au registre ;
- `tools/security/keygen-ceremony.ts` chiffre la clé privée sous une phrase de passe d'attente écrite dans le code quand aucune variable d'environnement ne la fournit, et son fichier de test n'importe pas l'outil ;
- `ecosystem/check-fleet-presentation.ts` écrit « at `main` » dans son en-tête et ses messages alors que son code lit la branche par défaut.
