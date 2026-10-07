# Inventaire des boucles agentiques — critères d'arrêt et modes d'échec

> **Provenance.** Extrait d'un dépôt privé de configuration machine avant sa
> suppression, le 2026-07-26. Les boucles propres à un contexte étanche non
> public ont été retirées de l'inventaire ; seules subsistent celles observées
> sur le périmètre public, décrites de façon autoportante.

Une boucle agentique est tout mécanisme qui **relance un agent, ou relance un
contrôle, sans intervention humaine à chaque tour**. Elles s'accumulent sans
qu'on les inventorie : une session, un fan-out de sous-agents, une revue, une
CI, un planificateur périodique. Le risque n'est pas qu'elles existent — c'est
qu'aucune ne déclare **quand elle s'arrête** ni **à quoi ressemble son échec**.

## Les cinq colonnes obligatoires

Toute boucle décrite dans cet inventaire doit renseigner cinq champs. Un champ
vide est une dette, pas une omission :

| Champ                 | Question à laquelle il répond                                   |
| --------------------- | --------------------------------------------------------------- |
| **Déclencheur**       | qu'est-ce qui lance un tour ?                                   |
| **État observable**   | où lit-on que la boucle tourne, depuis l'extérieur ?            |
| **Critère d'arrêt**   | quelle condition termine la boucle, sans intervention ?         |
| **Échec observable**  | à quoi reconnaît-on qu'elle a mal tourné, sans l'inspecter ?    |
| **Nature de l'échec** | l'échec se rejoue-t-il, ou l'effet a-t-il déjà eu lieu ?        |
| **Reprise**           | comment la relance-t-on après un échec, sans repartir de zéro ? |

La colonne « échec observable » est celle qu'on oublie. Une boucle dont l'échec
est silencieux est indiscernable d'une boucle qui n'a jamais démarré — panne
documentée en détail dans `DOCTRINE-REPLICATION.md`.

**Nature de l'échec : `[rattrapable]` ou `[terminal]`.** Deux échecs qui se
ressemblent dans un journal n'appellent pas la même conduite. Un contrôle porte
sur un travail qu'on peut demander de refaire : le rejouer est la réponse
normale, et la boucle continue. Une **brèche** ne se rejoue pas, parce que
l'effet est déjà produit — l'arbre de travail orphelin existe, la classification
a été contournée, l'écriture non autorisée a eu lieu. Re-prompter l'agent ne
défait rien ; la boucle doit s'arrêter et nommer ce qui a été touché.

Confondre les deux coûte dans les deux sens : on rejoue indéfiniment un échec
que le rejeu ne peut pas résoudre, ou on escalade à l'humain un rouge qu'un
second tour aurait absorbé. Le champ est porté en suffixe de la colonne « échec
observable », faute de place pour une septième colonne lisible.

## Inventaire

| Boucle                                                                     | Déclencheur                                   | État observable                                                                                                                          | Critère d'arrêt                                                                                                                              | Échec observable                                                                                                                          | Reprise                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Session assistée (idéation → plan → implémentation → revue)                | brief humain                                  | fichier de plan, todos, transcriptions                                                                                                   | plan approuvé ; gates verts ; fin du jalon (une session = un jalon)                                                                          | gates rouges, recadrage humain `[rattrapable]`                                                                                            | mémoire + plan rechargés en session neuve                              |
| Fan-out de sous-agents                                                     | ≥ 2 tâches indépendantes identifiées          | notifications de tâche, fichiers de sortie                                                                                               | rapport rendu par chaque agent ; l'orchestrateur ne fusionne qu'après re-vérification locale                                                 | rapport contredisant le code — dérive connue → rejouer les gates `[rattrapable]`                                                          | relance ciblée du seul agent fautif                                    |
| Revue adversariale (producteur ≠ relecteur)                                | livrable sémantique non couvert par les gates | rapports de findings gradués                                                                                                             | verdict rendu ; findings bloquants corrigés puis re-vérifiés                                                                                 | finding bloquant non corrigeable → escalade humaine `[terminal]`                                                                          | nouvelle passe sur le diff corrigé                                     |
| Récurrence pilotée (exécution périodique d'un prompt)                      | demande explicite                             | réveils planifiés                                                                                                                        | arrêt explicite ; expiration de la tâche récurrente                                                                                          | réveil silencieux répété (rien à faire) → resserrer ou stopper `[rattrapable]`                                                            | relance avec le même prompt                                            |
| Fan-out de revues versionné                                                | commande de revue                             | arbres de travail détachés éphémères                                                                                                     | N relecteurs terminés ; arbres retirés dans un bloc `finally`                                                                                | arbres orphelins accumulés (filet : purge périodique) `[terminal]`                                                                        | relance de l'orchestrateur                                             |
| Orchestration par contrats                                                 | work package                                  | contrats versionnés, verdicts, vecteurs de référence                                                                                     | gates de contrats verts + vote humain de verrouillage                                                                                        | dérive de contrat détectée en CI `[rattrapable]`                                                                                          | amendement de contrat tracé                                            |
| Garde de politique d'outils                                                | évaluation d'un appel d'outil                 | verdicts explicables, attestations                                                                                                       | fail-closed : refus par défaut ; attestation à TTL borné                                                                                     | contournement de classification, attestation expirée `[terminal]`                                                                         | ré-attestation sous contrôle humain                                    |
| Contrôle de dérive périodique                                              | planificateur local                           | journal horodaté + notification                                                                                                          | terminal à chaque run (pas de boucle interne)                                                                                                | ligne non-`ok` dans le journal, **ou absence de ligne récente** `[rattrapable]`                                                           | régénérer puis re-vérifier                                             |
| Contrôle de dérive planifié en CI (7 workflows, voir § Alerte de récidive) | planificateur hebdomadaire + dispatch manuel  | historique des runs ; issue `<workflow>: two consecutive failed runs` ouverte au 2e rouge, fermée au 1er vert                            | terminal à chaque run                                                                                                                        | run rouge, **ou absence de run récent** ; 2 rouges consécutifs = issue ouverte (pas de 2e issue tant qu'elle est ouverte) `[rattrapable]` | corriger, relancer (dispatch) : le run vert ferme l'issue avec son URL |
| Garde-fou d'hygiène en CI                                                  | push / demande de fusion                      | statut de check de la forge                                                                                                              | terminal par run ; bloquant au merge                                                                                                         | check rouge = motif interdit présent `[rattrapable]`                                                                                      | retrait du motif, ou exemption déclarée                                |
| Contrôle d'advisories de flotte (ADR-0021 D1)                              | planificateur hebdomadaire + dispatch manuel  | historique des runs du workflow, rapport par dépôt                                                                                       | terminal à chaque run (un passage = un verdict par dépôt vivant ; manifeste sans dépendance = « nothing to audit », affirmé)                 | run rouge = advisory sur un dépôt vivant, **ou absence de run récent** ; 2 rouges = issue `[rattrapable]`                                 | relance manuelle du workflow                                           |
| Auto-guérison du README d'organisation                                     | run rouge de `Org README drift`               | artefact `org-readme-healed` ; PR `heal/org-readme` dans `libre-ai/.github` ; ligne `skipped: secret ORG_README_HEAL_TOKEN absent` sinon | terminal : PR ouverte (ou réutilisée), ou skip nommé                                                                                         | run rouge sans ligne « pull request » ni ligne « skipped » ; sentinelles absentes/dupliquées = pas de fix mécanique `[rattrapable]`       | coller l'artefact, ou configurer le secret puis relancer               |
| Conformité Dependabot de flotte (étape du job `Inventory drift`)           | planificateur hebdomadaire + dispatch manuel  | rapport par dépôt (variante attendue, première ligne divergente) ; issue de récidive du workflow                                         | terminal à chaque run (un verdict par dépôt non archivé ; archivé = exempt affirmé ; injoignable = « unable to verify », jamais « missing ») | dépôt sans copie octet-exacte de sa variante `distribution/templates/dependabot/`, **ou absence de run récent** `[rattrapable]`           | coller la variante dans `.github/dependabot.yml` du dépôt, relancer    |

## Alerte de récidive et auto-guérison — contrat (2026-09-07)

Décision propriétaire du 2026-09-07 : « le gate ouvre la PR de fix quand le
correctif est mécanique ; sinon issue assignée avec notification ». Constat
qui l'a déclenchée : l'alerte de récidive (`tools/security/repeat-failure-alert.ts`)
était câblée dans quatre workflows planifiés et oubliée dans trois autres ;
`Org README drift` a été rouge les 24/08, 31/08 et 07/09 sans qu'aucune
issue ne s'ouvre — la « ligne récente absente » de la colonne ci-dessus, en
vrai. Le contrat est désormais le suivant.

**Alerte partout.** Chaque workflow à déclencheur `schedule` porte deux
étapes : `repeat-failure-alert.ts` sur `failure()` (issue au 2e run rouge
consécutif, dédupliquée par titre exact) et `repeat-failure-alert.ts --resolve`
sur `success()` (ferme l'issue ouverte pour ce workflow, commentaire avec
l'URL du run vert ; idempotent). Les deux étapes ne comptent que les runs
propres à la boucle (`schedule`, `workflow_dispatch`) : un run `push` ou
`pull_request` d'un workflow mixte appartient au garde-fou de CI, jamais à la
boucle. Câblés : `adoption-proof`, `context-conformance`, `fleet-advisories`,
`inventory-drift`, `org-readme-drift`, `sovereignty-report`, `truth-drift`.
Le garde-fou contre le retour de la dérive est
`tools/security/scheduled-loop-alerting.test.ts` : il énumère lui-même les
workflows à `schedule` et échoue si l'un d'eux n'a pas les deux étapes, la
bonne identité (`WORKFLOW_NAME` = `name:` du fichier, `WORKFLOW_FILE` = son
nom) ou la permission `issues: write`.

**Auto-guérison mécanique — `Org README drift`.** Le correctif est un
collage entre sentinelles dans `libre-ai/.github` (`profile/README.md`),
mais deux limites GitHub documentées interdisent de le faire avec le jeton
par défaut :

1. « The token's permissions are limited to the repository that contains
   your workflow » — docs.github.com, page concept `GITHUB_TOKEN` : un run
   de `governance` ne peut rien écrire dans `.github`.
2. « When a workflow using GITHUB_TOKEN creates or updates a pull request,
   the resulting pull_request event creates workflow runs in an
   approval-required state » et un push fait avec lui « will not run » de
   workflow — docs.github.com, « Trigger a workflow », section « Triggering
   a workflow from a workflow ». `main` de `.github` exige deux checks
   (`REUSE compliance`, `No private identifiers or machine-local paths`) :
   une PR ouverte avec ce jeton resterait non fusionnable tant qu'un humain
   n'approuve pas ses runs.

Le chemin honnête est donc gaté sur un secret dédié. Sans secret, l'étape
`heal-org-readme.ts` écrit quand même le README guéri dans l'artefact
`org-readme-healed` et imprime `skipped: secret ORG_README_HEAL_TOKEN absent`
(log + résumé de job) — jamais un vert silencieux, le run étant rouge par
l'étape de dérive. Avec le secret : branche fixe `heal/org-readme` dans
`.github` (recréée depuis `main` quand aucune PR n'est ouverte, complétée
sinon), un commit par l'API Contents (auteur = identité du jeton, trailer
`Signed-off-by` assorti), une PR trouvée par branche de tête, jamais
dupliquée.

**Action propriétaire requise** (aucun secret n'existe sur `governance` au
2026-09-07) :

- créer un _fine-grained personal access token_ (ou une GitHub App) —
  propriétaire de ressource `libre-ai`, accès « Only select repositories » →
  `.github` uniquement, permissions minimales **Contents : Read and write**,
  **Pull requests : Read and write** (Metadata : Read, implicite) ; aucune
  autre permission, aucun autre dépôt ;
- le déposer comme secret de dépôt `ORG_README_HEAL_TOKEN` sur
  `libre-ai/governance` (Settings → Secrets and variables → Actions).

Points que seul le premier run rouge avec le secret prouvera : le chemin
API n'est pas testé unitairement ; si `.github` porte un check DCO,
l'adresse `noreply` de l'identité du jeton doit être celle que l'API
attribue au commit (l'auteur et le trailer sont posés à l'identique).

**Ce qui reste manuel.** Une projection `ecosystem/projections/fleet-status.v1.json`
périmée est un fix dans _ce_ dépôt (`bun ecosystem/render-fleet-status.ts`,
nommé par le gate depuis le 2026-09-07) : non automatisé, la même limite 2
s'appliquant à une PR ouverte ici avec le jeton par défaut.

## Dependabot bun — suspendu le 2026-09-08

Décision propriétaire du 2026-09-08 : « retirer le bloc bun du gabarit
Dependabot, garder github-actions + cargo ». Le gabarit publié la veille
(#88) déclarait un écosystème `bun` sur tout dépôt portant un
`package.json` ; son premier run sur `governance` (run 34139635260, job
« bun in /. ») a échoué avec :

```
Dependabot::DependencyFileNotSupported — Unsupported bun.lock
'lockfileVersion' 2 in /bun.lock. The bun version Dependabot runs
supports up to 1.
```

Tous les lockfiles de la flotte sont écrits par bun 1.4 (format v2). Le bloc
`bun` était donc une boucle dont chaque tour échoue et n'ouvre aucune PR : un
garde-fou muet, indiscernable d'un garde-fou qui ne tourne pas — exactement
la panne que cet inventaire existe pour nommer. Le gabarit ne porte plus que
`github-actions.yml` et `cargo.yml` ; le test
`ecosystem/check-dependabot-conformance.test.ts` affirme qu'aucune variante
ne déclare `package-ecosystem: bun`, de sorte qu'un retour passe par une
décision et non par une édition.

| Champ                           | Valeur                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Filet pendant la suspension** | `Fleet advisories` (hebdomadaire, `bun audit` sur chaque lockfile vivant, `tools/security/check-fleet-advisories.ts`) pour les advisories ; les montées de version bun se font par vagues d'agents, jamais en silence.                                                                                                                                                                                                                                                                                                               |
| **Condition de retour**         | dependabot-core lit `bun.lock` lockfileVersion 2. Suivi amont : [dependabot/dependabot-core#16026](https://github.com/dependabot/dependabot-core/issues/16026) (« Bun 1.4 uses lockfile v2 which dependabot currently does not support », ouverte au 2026-09-08, `help-wanted`).                                                                                                                                                                                                                                                     |
| **Comment vérifier**            | ne jamais rétablir sur la flotte sur la foi du changelog : ajouter un bloc `bun` au `.github/dependabot.yml` d'**un seul** dépôt (branche de PR d'essai), déclencher « Check for updates » dans l'onglet Insights → Dependency graph → Dependabot, et lire le journal du job `bun in /.` : un run qui ouvre une PR (ou conclut « no updates ») prouve la lecture v2, une erreur `DependencyFileNotSupported` reconduit la suspension. Puis rétablir la variante dans `governance` et laisser la vague de conformité porter la copie. |
| **Échec observable**            | une PR Dependabot `bun` ouverte sur un dépôt alors que le gabarit ne déclare pas l'écosystème = copie non conforme ; le gate `check-dependabot-conformance` la nomme à la première ligne divergente `[rattrapable]`.                                                                                                                                                                                                                                                                                                                 |

## Critères d'arrêt manquants — dette assumée

Ces boucles tournent sans borne formelle. Elles sont listées parce qu'une dette
nommée se surveille, alors qu'une dette tacite se découvre en incident.

1. **Fan-out de sous-agents : pas de plafond de coût explicite par vague.**
   Le harness borne la concurrence et le total, mais la décision « combien de
   relecteurs pour ce diff » reste du jugement. Règle pratique appliquée :
   dimensionner sur la demande — vérification rapide = 1-2 agents, audit = 3-5
   avec votes.

2. **Re-fusion sous branche mouvante : pas de borne au nombre de tentatives.**
   Quand la branche cible avance pendant la CI d'une demande de fusion, chaque
   mise à jour relance la CI, qui peut à nouveau être invalidée. Règle
   pratique : 3 itérations, puis passage en fusion automatique différée (file
   d'attente de la forge) ou escalade humaine.

3. **Boucles de récurrence pilotée : l'arrêt dépend d'un humain qui s'en
   souvient.** Une expiration par défaut est le seul mécanisme qui garantit
   qu'une boucle oubliée finit par mourir.

## Quatre règles tirées de l'inventaire

**Une boucle sans critère d'arrêt déclaré est un incident en attente.** Si le
critère ne peut pas être écrit en une phrase vérifiable, la boucle n'est pas
prête à tourner sans surveillance.

**Un rapport d'agent n'est pas une preuve.** Dans le fan-out de sous-agents, le
critère d'arrêt est le rapport rendu, mais la condition de fusion est la
**re-vérification locale** par l'orchestrateur. Un rapport peut contredire le
code qu'il décrit ; la seule sortie qui fait foi est celle des gates rejoués.

**Le nettoyage appartient à la boucle qui a créé la ressource.** Un fan-out qui
crée des arbres de travail éphémères les retire dans un bloc `finally`, y
compris en cas d'échec. Une purge périodique externe est un filet, jamais une
dispense : sans nettoyage à la source, les ressources orphelines s'accumulent
par centaines avant qu'on les remarque.

**Un échec terminal ne se rejoue pas ; il se nomme et il arrête.** Le réflexe
d'une boucle devant un rouge est de retenter, et il est bon tant que l'échec
porte sur un travail refaisable. Il devient nuisible dès que l'effet est déjà
produit : rejouer ne défait pas un contournement de classification et ne
supprime pas un arbre orphelin, cela ne fait qu'en produire un second. Une
boucle qui ne distingue pas les deux natures d'échec convertit une brèche en
série de brèches — d'où le champ `[rattrapable]` / `[terminal]`, obligatoire
comme les cinq autres.
