# Évaluer un harness challenger — intégration, challenge, valeur, promotion

> **Provenance.** Extrait d'un dépôt privé d'expérimentation avant sa
> suppression, le 2026-07-26. Les composants dont l'évaluation dépendait d'un
> contexte étanche non public ont été retirés : leurs verdicts ne sont pas
> reproductibles hors de ce contexte et n'auraient aucun sens ici. Ce qui reste
> est la méthode, illustrée par les composants évaluables publiquement.

Un « challenger » est un ensemble de composants (extensions, compétences,
règles) construit pour concurrencer un harness agentique déjà en place. La
question à laquelle cette méthode répond n'est pas « peut-on l'écrire ? » mais
**« fait-il mieux que ce qui existe déjà, et pour quel coût ? »**

## La correction de méthode : quatre paliers, jamais confondus

La première passe d'une expérimentation valide typiquement que les composants
se chargent et passent leurs tests. C'est une réponse à « est-ce
implémentable ? » — pas à « est-ce meilleur ? ». Quatre paliers distincts :

| Palier          | Question                                                  | Preuve exigée                                 |
| --------------- | --------------------------------------------------------- | --------------------------------------------- |
| **Intégration** | le composant se charge et respecte son propre contrat ?   | tests unitaires, chargement hors ligne, smoke |
| **Challenge**   | comparé à l'existant **sur le même corpus** ?             | runs appariés baseline / challenger           |
| **Valeur**      | apporte-t-il un gain que l'existant ne fournit pas déjà ? | écart mesuré, pas supposé                     |
| **Promotion**   | le gain justifie-t-il coût, friction et risques ?         | décision explicite, réversible, datée         |

**« N tests verts » prouve l'intégration et rien d'autre.** C'est l'erreur la
plus fréquente : un tableau de tests verts se lit comme une validation de
valeur alors qu'il ne mesure que la conformité du composant à lui-même.

## Séparer l'état d'implémentation de l'état d'évaluation

Un corpus de cas qui marque un cas comme `implemented` dès qu'un composant
existe **donne une impression de couverture supérieure à la preuve
disponible**. Deux champs indépendants, jamais un seul :

- `implementationStatus` — le composant existe-t-il et se charge-t-il ?
- `evaluationStatus` — a-t-il été **mesuré** ? Valeurs utiles :
  `not-run`, `baseline-pass`, `challenger-pass`, `no-incremental-value`,
  `failed`, `invalidated`, `superseded`.

`no-incremental-value` et `invalidated` sont les deux valeurs qui font le
travail. Sans elles, un corpus ne peut exprimer qu'un succès ou une absence, et
un composant sans gain se lit comme un composant non encore testé.

## Le rapport d'évaluation porte ses propres limites

Chaque rapport est un fichier structuré versionné, qui déclare **ce qu'il ne
prouve pas** :

```json
{
  "component": "policy-gate",
  "executionPolicy": "Classification et décision préalable uniquement ; aucune commande sensible exécutée.",
  "cases": [
    {
      "id": "sensitive-read-indirect",
      "risk": "R2",
      "observe": "allow",
      "confirmTui": "confirm",
      "confirmHeadless": "block",
      "passes": true
    }
  ],
  "result": { "passed": 3, "failed": 0, "allPass": true },
  "limitations": [
    "Ne prouve pas que l'agent s'abstient d'une publication non demandée.",
    "Ne réduit pas le taux de friction des commandes locales génériques.",
    "Ne remplace pas un sandbox ni une frontière de sécurité shell."
  ]
}
```

Le bloc `limitations` n'est pas de la modestie rédactionnelle : c'est ce qui
empêche un rapport vert d'être cité plus tard comme preuve d'une propriété
qu'il n'a jamais testée. Le champ `executionPolicy` déclare ce que le run s'est
autorisé à faire — un rapport de sécurité qui aurait exécuté les commandes
dangereuses qu'il classe ne serait pas une évaluation mais un incident.

## Invalider un run est un résultat, pas un échec de process

Un run mené dans de mauvaises conditions doit être **explicitement invalidé et
conservé comme tel**, jamais silencieusement remplacé. Cas rencontré : une
évaluation avait exécuté du code généré directement sur l'hôte, alors que le
protocole exigeait une exécution isolée. Traitement retenu :

1. le run est marqué `invalidated`, avec le motif ;
2. la commande et le script fautifs sont supprimés ;
3. **aucun résultat de ce run n'est utilisé comme preuve**, même les résultats
   qui semblaient bons ;
4. un run de remplacement est exécuté dans les conditions correctes.

Un statut agrégé mécanique (et non rédigé à la main) recalcule le verdict
global à partir des rapports, invalidations comprises. Sans agrégation
mécanique, les décisions se dispersent et le verdict global devient une
opinion.

## Le résultat le plus utile : le challenger révèle des défauts de l'existant

Contre-intuitif mais mesuré : la valeur principale d'un challenger n'est
souvent **pas** le composant qu'il propose, mais les défauts qu'il expose dans
le harness en place. Exemples réels :

- Une compétence globale de test routait automatiquement vers un exécuteur de
  tests d'après la seule présence d'un manifeste de paquet, sans lire le
  gestionnaire déclaré ni les lockfiles présents — donc choisissait le mauvais
  exécuteur sur un projet standard d'un autre écosystème. Corrigé en lisant le
  gestionnaire déclaré, les scripts et les lockfiles.
- Plusieurs compétences globales utilisaient une convention de substitution
  d'arguments (`$0`, `$1`) **importée d'un autre harness** et jamais documentée
  par celui en usage, qui ajoute en réalité les arguments au contenu sous une
  forme différente. Convention retirée partout.
- Un champ de déclaration d'outils autorisés était repris d'une convention non
  démontrée, avec une syntaxe (virgules) que l'outil cible n'utilise pas. Le
  champ est en réalité ignoré par la version en usage. Retiré des composants,
  conservé ailleurs uniquement pour compatibilité inter-harness.

Ces trois corrections valent plus que le composant qui les a révélées. **Un
challenge qui ne trouve rien dans l'existant a probablement mal cherché.**

## Verdicts par mécanisme — garder, limiter, rejeter

L'unité de décision est le **mécanisme**, pas le paquet. Un paquet est rarement
bon ou mauvais en bloc :

| Mécanisme                                                    | Valeur face à l'existant                                                           | Verdict                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| Canonisation des chemins et résolution des liens symboliques | renforce réellement un simple test d'inclusion de sous-chaîne                      | **garder comme primitive**                     |
| Classification de risque explicable                          | rend le risque mesurable et explicable                                             | **garder comme UX/télémétrie**                 |
| Expressions régulières shell de sécurité                     | contournable par scripts, options et outils nouveaux                               | **rejeter comme frontière**                    |
| Mode d'observation sans friction                             | mesure sans gêner, mais autorise encore le risque maximal                          | **limiter aux workspaces d'évaluation**        |
| Frontière de contenu non fiable                              | lacune réelle du fichier de doctrine                                               | **garder le principe**, challenger le véhicule |
| Transfert de contexte déterministe, sans appel de modèle     | couverture factuelle égale à la compaction sur fixture ; contexte fortement réduit | **retenir en laboratoire**                     |
| Expurgation du transfert de contexte                         | réduit les fuites évidentes, reste best effort                                     | **garder en défense secondaire**               |
| Observateur supplémentaire                                   | doublon avec tests et revue existants, coût élevé                                  | **rejeté**                                     |
| Auto-création de procédures de vérification                  | muterait les dépôts _pendant_ une vérification                                     | **rejeté**                                     |

Deux composants ont été **rejetés et retirés** après des runs appariés montrant
une couverture identique à l'existant pour un coût supérieur. La règle appliquée :
**une réintroduction exigerait d'abord un échec baseline reproductible.** Sans
cette règle, un composant rejeté revient par conviction plutôt que par mesure.

## Corpus d'évaluation — import de doctrine du 2026-08-04

Première application de cette méthode à un import de **doctrine** plutôt qu'à un
harness challenger : la source confrontée est une fabrique d'agents tierce
(Python, worker Pi, trace SQLite, licence MIT), et rien de son code n'a été
repris — seules des logiques d'architecture, réécrites dans les langages et les
autorités d'ici.

L'écart de nature vaut d'être noté, parce qu'il déplace le palier « challenge ».
Un composant exécutable se compare par runs appariés sur un même corpus. Une
logique de doctrine se compare à ce que l'existant produisait **avant** sur la
même surface : le run apparié devient l'exécution du garde-fou d'avant contre
celui d'après, sur les mêmes cibles.

| Mécanisme importé                                           | Où il a atterri                         | `implementationStatus` | `evaluationStatus` | Ce qui clôt le palier valeur                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------- | ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un gate rend ses preuves ; vacuité déclarée, jamais inférée | `tools/quality/gate-report.ts`          | `merged`               | `challenger-pass`  | **mesuré le 2026-08-04, migration complète** : avant — 3 gates verts sur zéro assertion, 1 compteur ne couvrant qu'un tiers de son gate, et 1 invariant de confidentialité appliqué nulle part (no-transmission, découvert par la migration) ; après — 20 des 25 gates concluent par gate-report, 2 exceptions documentées dans le commit de vague 3, zéro assertion vide |
| Nature de l'échec : rattrapable ou terminal                 | `docs/method/AGENTIC-LOOP-INVENTORY.md` | `merged`               | `not-run`          | une boucle qui cesse de rejouer un échec terminal, observée sur un incident réel                                                                                                                                                                                                                                                                                          |
| Deux régimes de réplication (convergent / divergent)        | `docs/method/DOCTRINE-REPLICATION.md`   | `merged`               | `not-run`          | un objet mal rangé détecté par le test des deux copies                                                                                                                                                                                                                                                                                                                    |
| Journal d'événements rejouable par passe                    | `orchestrator:tools/review/`            | `merged`               | `not-run`          | trois runs réels **sur le mécanisme corrigé** (orchestrator#11) sans contradiction replay/observé — voir la campagne du 2026-08-04 ci-dessous                                                                                                                                                                                                                             |
| Coût itemisé et occupation de fenêtre                       | —                                       | `not-started`          | `not-run`          | conditionné au mécanisme précédent : n'ouvre que si le journal se révèle insuffisant                                                                                                                                                                                                                                                                                      |
| Vérification a posteriori du change-set écrit               | —                                       | `not-started`          | `not-run`          | relève d'une phase B du package challenger, pas de cet import                                                                                                                                                                                                                                                                                                             |

**Une seule ligne a atteint `challenger-pass`, et par la mesure, pas par
l'usage** : la migration complète des gates a compté les assertions vides avant
et après — c'est le run apparié de ce mécanisme, exécuté le jour même. Les
trois autres restent `not-run` : leurs suites vertes prouvent l'intégration et
rien d'autre. Un mécanisme dont l'`evaluationStatus` reste `not-run` après
plusieurs mois d'usage n'est pas validé par l'habitude : il est candidat au
retrait.

### Campagne rétro-K4 du 2026-08-04 — l'instrument jugé par sa première sortie

Huit invocations réelles du fan-out (`orchestrator:tools/review/fanout.ts`,
`openai-codex/gpt-5.6-terra:xhigh`), en revue K4 rétroactive : les six commits
gate-report de ce dépôt (#7, #16, #21, #22, #24, #25) et le commit journal
d'orchestrator (#4), rôles architecture + security. Enregistrements complets —
plans, journaux par tentative, verdict — sous `docs/reviews/retro-k4-gate-report/`
et `docs/reviews/retro-k4-review-journal/`.

**Sortie brute :** 1 verdict enregistré (architecture sur `30ade3b` : **reject**,
3 findings majeurs), 2 verdicts rejetés par validation (`/mode`), 13 passes
tuées par la limite d'usage du compte Codex. Les tentatives échouées sont
conservées telles quelles (`events-attempt*-*.jsonl`), jamais remplacées.

**Valeur produite — quatre défauts d'instrument, trouvés et corrigés le jour
même** (orchestrator#10, #11), conformes au constat central de ce document :

- le prompt n'énonçait pas les littéraux exigés par la validation croisée —
  2/2 verdicts par ailleurs complets rejetés sur `/mode` (#10) ;
- le replay certifiait une passe dont la clôture avait échoué après
  l'enregistrement du verdict (`pass_end.ok` ignoré) (#11) ;
- la réconciliation replay/observé matchait par rôle sur un journal
  append-only inter-tentatives — fausse contradiction observée en live (#11) ;
- une ligne déchirée en fin de journal abortait tout replay ultérieur du même
  répertoire (#11).

Les trois derniers sont les findings du verdict reject — l'unique passe
aboutie a jugé l'instrument qui la portait, et l'a rejeté à raison.

**Palier valeur : non atteint.** Zéro run n'a encore exercé le mécanisme
corrigé ; les huit runs pré-correction n'ont jamais montré de contradiction
replay/observé, mais le replay qu'ils exerçaient est celui dont la revue a
prouvé qu'il pouvait certifier à tort. `evaluationStatus` reste `not-run`.
Reprise : 13 passes en attente d'une fenêtre d'usage Codex ou d'un provider
alternatif (décision propriétaire).

### Ce que l'import a révélé de l'existant

Conformément au constat de ce document — la valeur principale d'un challenger
est souvent dans les défauts qu'il expose — la confrontation a trouvé trois
gates verts qui n'assertaient rien, sur une même classe de défaut :

- `ecosystem/check-migration-drift.ts` (K4 AUTH-05), **déjà corrigé** avant cet
  import et devenu le modèle de référence interne : il portait localement la
  règle que l'import ne fait que généraliser.
- `tools/quality/check-specification-lock.ts` : vidait sa propre liste
  d'applications depuis la ventilation ADR-0020, puis affichait `verified: 13` —
  la longueur de la liste écartée, pas du travail fait. Zéro spécification
  inspectée, compteur à treize.
- `tools/quality/check-retired-names.ts` : affichait `verified: 0` depuis que
  les familles `apps/`, `crates/` et `packages/` ont quitté ce dépôt.

S'y ajoute une variante : `tools/quality/check-objectives.ts` comptait ses
fichiers requis sans rien dire de son scan de motifs interdits ni du corpus
vision — un glob qui cesse de matcher y rendait muets deux tiers du gate sans
changer sa sortie.

Ces quatre constats valent plus que les mécanismes qui les ont révélés.

## Ce que la méthode n'autorise pas

- **Promouvoir parce que c'est implémenté.** Aucune capacité n'est promue au
  motif qu'elle fonctionne.
- **Conclure sans run apparié.** Comparer un composant à un souvenir de
  l'existant n'est pas un challenge.
- **Élargir la surface de détection pour faire passer un gate.** Quand un gate
  de friction échoue, élargir les motifs de reconnaissance pour réduire le taux
  de confirmation revient à truquer la mesure : le gate mesurait précisément le
  fait que la reconnaissance textuelle ne suffit pas.
- **Agréger les décisions à la main.** Le verdict global est recalculé
  mécaniquement depuis les rapports, ou il n'est pas fiable.
