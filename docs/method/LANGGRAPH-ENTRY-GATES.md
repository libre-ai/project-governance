# Gates d'entrée LangGraph — gabarits de flotte et vecteur rouge d'egress

- **Portée :** les contrôles qu'un dépôt TypeScript porte dans la pull request qui ajoute
  `@langchain/langgraph` (ADR-0058 §3, conditions 1, 4 et 5). Trois gabarits de gate et un plancher d'avis
  en donnée sont publiés ici ; le vecteur rouge d'egress de la condition 4 ne peut pas l'être, et cette note
  dit pourquoi et ce que chaque consommateur doit écrire. Méthode, pas doctrine : l'obligation vient de
  l'ADR, cette note en fournit l'outillage.
- **Statut :** gabarits livrés pour le ticket `libre-ai/project-governance#139` ; premier consommateur :
  `libre-ai/execution-continuity-evaluator`. Ce dépôt n'ajoute pas `@langchain/langgraph` et n'exécute pas
  ces gates sur lui-même.

## Ce qui est publié

Sous `distribution/templates/langgraph-gates/`, à côté du gabarit Dependabot :

| Fichier | Condition d'ADR-0058 §3 | Ce qu'il refuse |
| --- | --- | --- |
| `check-langsmith-env.ts` | 4, premier mécanisme | tout nom de variable qui commence par le préfixe LangSmith, et les alias `LANGCHAIN_TRACING`, `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, `LANGCHAIN_ENDPOINT`, `LANGCHAIN_CALLBACKS_BACKGROUND`, dans tout fichier texte suivi hors documentation en prose |
| `check-langgraph-persistence.ts` | 5 | `@langchain/langgraph-checkpoint-postgres`, `-redis`, `-mongodb`, `-sqlite` et tout autre paquet sous le préfixe `@langchain/langgraph-checkpoint-`, dans tout `package.json` et tout verrou suivi |
| `check-langgraph-advisory-floor.ts` + `langgraph-advisory-floor.v1.txt` | 1, second instrument | toute version résolue d'un paquet du plancher inférieure à son minimum |
| `langgraph-gates.test.ts` | — | la preuve par mutation des trois gates (voir plus bas) |

Chaque gate est **un fichier autonome** (`node:` et `Bun` seulement) : un consommateur le copie, il n'importe rien
de ce dépôt. Chacun imprime le volume examiné sur une ligne, dont les compteurs somment à l'univers couvert,
imprime ce qu'il ne voit pas, et échoue sur une source déclarée mais illisible (jamais un zéro). Le code de
sortie est `0` (vert), `1` (violation ou source illisible) ou `2` (racine inutilisable, argument inconnu).
La forme reprend `tools/quality/check-advisory-waivers.ts` : énumérer les fichiers suivis (`git ls-files`),
les lire, rapporter ; l'option `--root=<dir>` désigne le dépôt examiné.

### Brancher un gate

Copier les fichiers sous `tools/quality/` du consommateur, puis déclarer les scripts :

```json
{
  "check:langsmith-env": "bun tools/quality/check-langsmith-env.ts --exclude=tools/quality/fixtures",
  "check:langgraph-persistence": "bun tools/quality/check-langgraph-persistence.ts",
  "check:langgraph-advisory-floor": "bun tools/quality/check-langgraph-advisory-floor.ts"
}
```

- `--exclude=<chemin ou dossier>` (répétable) désigne les fixtures **du gate** ; le chemin vit dans le script
  de package pour qu'un relecteur lise ce que le gate ne regarde pas. Les fichiers exclus sont comptés et
  imprimés. Le gabarit et son test ne contiennent aucun nom refusé (ils les assemblent à partir de parties),
  donc ils n'ont pas besoin d'être exclus.
- `--floor=<chemin>` déplace le plancher ; la valeur par défaut est `tools/quality/langgraph-advisory-floor.v1.txt`,
  et le fichier doit être suivi.
- Le test se copie avec les gates. Il s'appuie sur ses voisins (`./check-*.ts`, le plancher) : les copier
  dans le même dossier suffit.

### Le plancher d'avis

Une ligne par couple `<paquet> <version minimale> <identifiant d'avis>`, lignes vides et commentaires `#`
admis. Il est lu, pas figé : un avis publié après la date de relevé est une ligne de plus, éditée et relue
comme toute édition. Il existe parce que l'autre instrument (`osv-scanner` hors ligne) dépend d'une base
tierce : si la base ne porte pas un avis, le plancher le porte.

Règle : toute version résolue d'un paquet du plancher est ≥ son minimum, ordre semver (une préversion du
minimum lui est inférieure). Deux lignes pour un paquet sont deux assertions. Un paquet que le verrou ne
résout pas satisfait sa ligne, mais un plancher dont aucune ligne ne se résout échoue : il a été comparé à
rien, ou au mauvais verrou.

Lignes initiales, relevées le 2026-10-23 : l'union des quatre lignes du ticket et de celles du cahier des
charges du premier consommateur (section 8.4). Source de chaque minimum, rejouable :

```sh
gh api repos/langchain-ai/langgraphjs/security-advisories \
  --jq '.[] | {ghsa_id, v: [.vulnerabilities[] | {p: .package.name, r: .vulnerable_version_range, f: .patched_versions}]}'
gh api repos/langchain-ai/langchainjs/security-advisories   # GHSA-r399-636x-v7f6
```

La base globale (`gh api /advisories/<GHSA>`) ne porte que `GHSA-r399-636x-v7f6` des six : les cinq autres
n'y répondent pas (404), leur seule source est la liste de sécurité du dépôt de l'éditeur.

### Ce que les gates ne voient pas

- **Télémétrie.** Un nom construit à l'exécution (concaténation, gabarit de chaîne, clé calculée), un nom écrit
  en prose (`.md`, `.mdx`, `.txt`, `.rst`, `.adoc` : comptés, non balayés), un fichier non suivi. Une activation
  par l'option d'un client (un paramètre passé au constructeur, non une variable d'environnement).
- **Persistance.** Une couche de persistance écrite à la main ; l'import d'un paquet qu'aucun manifeste ne déclare.
- **Plancher.** Une version à éviter : l'avis `GHSA-432w-3h3v-2pv4` liste aussi `@langchain/langgraph-sdk` 2.0.0
  sans version corrigée, et aucune ligne de plancher ne l'exprime. Le plancher est un minimum, pas une exclusion ;
  l'instrument pour cela est la base de vulnérabilités.

Un gate qui ne voit pas une classe de défaut le dit à chaque exécution ; ce n'est pas une raison d'élargir
silencieusement son motif.

## Le vecteur rouge d'egress que chaque consommateur écrit

ADR-0058 §3, condition 4, demande deux mécanismes, tous deux requis. Le premier est le gate textuel ci-dessus.
Le second est la politique réseau du plan d'exécution, appliquée par le harness, **prouvée par un vecteur rouge
écrit avant l'activation du worker** : une tentative de connexion vers un hôte de télémétrie de l'éditeur,
depuis le worker, est refusée par le harness et comptée dans ses événements. Un harness qui ne produit pas ce
refus n'active pas le worker.

**Pourquoi aucun gate textuel ne le remplace.** Le gate textuel empêche d'*écrire* l'activation ; il ne peut pas
empêcher qu'elle *aboutisse* quand elle est écrite là où il ne regarde pas (les trois angles morts de la section
précédente), ni quand le paquet s'active par un chemin que sa liste de noms ne couvre pas. Mesure du
2026-10-23 sur la source du paquet `langsmith` 0.11.1 (dépendance transitive de `@langchain/core`) :
`npm pack langsmith@0.11.1`, puis grep des noms de variable lus : le SDK lit les noms de la condition (le préfixe
LangSmith, `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, `LANGCHAIN_ENDPOINT`) et d'autres qu'elle ne liste pas
(`LANGCHAIN_BASE_URL`, `LANGCHAIN_PROJECT`, `LANGCHAIN_SESSION`, `LANGCHAIN_CUSTOM_HEADERS`, `LANGCHAIN_LOG`,
`LANGCHAIN_REVISION_ID`). Une liste de noms est un instrument qui périme ; la politique réseau ne dépend pas
du nom.

**Ce que le consommateur écrit.** Un vecteur dans la suite du harness du consommateur, avec ces propriétés :

1. **Cible.** L'hôte par défaut du SDK, `api.smith.langchain.com`, et au moins un hôte régional
   (`eu.api.smith.langchain.com`) ; les deux figurent dans la source de `langsmith` 0.11.1. Les hôtes se
   relèvent au même endroit à chaque montée de version, ils ne sont pas figés ici.
2. **Précondition.** Le plan du worker ne déclare aucun hôte de l'éditeur dans ses règles réseau.
3. **Action.** Le worker tente une connexion sortante vers chaque hôte cible, avec la variable d'activation posée
   **par construction dynamique du nom** (donc invisible au gate textuel) : c'est ce qui sépare ce vecteur du gate.
4. **Verdict.** Pour chaque tentative : refus **décidé par le harness** (le code du refus est celui du harness,
   pas une erreur de résolution ou de réseau de la sandbox), un événement compté dans les événements du harness
   (le nombre d'événements égale le nombre de tentatives), et aucun octet n'a quitté la sandbox.
5. **Neutralisation.** Le vecteur est prouvé en neutralisant ce qu'il vérifie : avec la règle réseau qui admet
   l'hôte, ou le refus désactivé, il devient rouge. Sans cette preuve, un vecteur qui passe avec et sans la
   politique est une assertion sur rien.
6. **Condition d'activation.** Le vecteur est rouge-avant-vert dans la pull request qui active le worker ; un
   harness qui ne produit pas le refus compté n'active pas le worker (ADR-0058 §3.4).

Ce gabarit ne fournit pas ce vecteur : son verdict est un fait du harness du consommateur (ses règles réseau, ses
événements), que ce dépôt ne détient pas.

## Preuve par mutation

`bun test distribution/templates/langgraph-gates` rejoue chaque cas rouge contre un **mutant** du gate : la
condition décisive est remplacée par un no-op (jamais une ligne supprimée, qui déséquilibrerait la structure et
rougirait tout pour la mauvaise raison). Un cas est une paire : le verdict qu'il épingle tient sur le gate et
ne tient pas sur le mutant. Une mutation qui ne trouve aucune occurrence, plusieurs, ou ne change rien, fait
échouer la suite ; un mutant qui plante au lieu de changer le verdict aussi (il prouve que la mutation casse le
programme, pas que le cas vérifie quelque chose). L'environnement du processus fils est construit à partir de
rien (`PATH`, un `HOME` jetable) : une variable ambiante du run de CI ne peut pas décider d'un verdict.
