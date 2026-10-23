# ADR-0055 — Méthode : origine du problème déclarée, dispositions de revue, installation live, registre des refus, négative par tranche

- **Statut :** proposed — la fusion de cette pull request est la signature du
  propriétaire (I-17, `AGENTS.md` : « a doctrine merge is a signature ») ;
  D1 à D5, I-38 et l'entrée D94 entrent en vigueur à la fusion.
- **Arbitrage :** en attente de signature. La consigne « go all » du
  propriétaire du 2026-10-22, sur les options recommandées du drill
  `tt-a1i/archify`, a engagé la rédaction de cet ADR ; elle n'en vaut pas
  adoption. Aucune trace d'arbitrage n'est écrite par la rédaction.
- **Date de rédaction :** 2026-10-22
- **Portée :** forme des pull requests de la flotte (D1, D5), conclusion d'une
  revue (D2), autorisation d'une installation live par un agent (D3), mémoire
  des refus de flotte (D4).
- **Étend :** ADR-0050 D1 (l'échec observé, daté et cité, exigé pour une
  skill) à toute pull request, sous forme déclarative (D1) ; le gate de
  déclaration `Door:` (`tools/quality/check-pr-door.ts`), dont D1 et D5 sont
  la suite (D1, D5) ; ADR-0025 D4 (`skills/.out-of-scope/`) aux refus qui ne
  sont pas des skills (D4).
- **Applique :** I-17 (surface à touche humaine fermée), I-25 (collection de
  skills), I-05 (projection jamais éditée à la main).
- **Invariants :** I-38 candidat (installation live) ; entrée D94 de
  `docs/decisions/DECISION-REGISTER.md`.
- **Autorise :** l'inscription d'I-38 et de D94 ; le registre
  `ecosystem/refusals.v1.yaml` et son amorce de huit entrées ; la section
  « Disposition of each finding » de `docs/reviews/AGENT-REVIEW-PROTOCOL.md` ;
  la ligne du registre des refus dans la carte d'autorité (`docs/README.md`).
- **N'autorise pas :** la modification du gabarit de pull request de
  `libre-ai/.github` ; l'extension d'un gate ; l'installation d'un outil
  étudié ; la reprise verbatim d'un texte amont.
- **Source :** drill du dépôt amont `tt-a1i/archify`
  (https://github.com/tt-a1i/archify, licence MIT, commit
  `25cf37080fc8b1dbe758a4efc3935b55f3327083`, cité sous la forme
  `tt-a1i/archify@25cf370:<chemin>`). Idées seulement : aucun texte n'est repris
  verbatim, aucune obligation MIT n'en découle. La citation de la source sert
  la traçabilité, elle n'est pas une recommandation.

## Contexte — constats du 2026-10-22

Parmi les règles de méthode que le drill a extraites d'Archify, cinq ont un
équivalent absent ou partiel dans la flotte et ne demandent pas de code pour
être écrites. Les étiquettes R2, R5, R6, R7, R13 et R15 reprennent la
numérotation du rapport de méthode du drill, qui n'est pas versionné ici. Les
constats ci-dessous sont datés du 2026-10-22 ; chaque chiffre est suivi de la
commande qui le reproduit, à rejouer avant usage.

1. **L'origine d'un problème n'est déclarée que pour une skill.** ADR-0050 D1
   exige l'échec observé, daté et cité, pour admettre ou modifier une skill.
   Aucune autre pull request ne dit si ce qu'elle corrige a été observé en
   usage, trouvé par lecture, construit pour l'occasion ou seulement proposé.
   Archify le demande à chaque contributeur (« do not present a constructed
   case as a naturally occurring Agent failure »,
   `tt-a1i/archify@25cf370:CONTRIBUTING.md:51`), mais ne vérifie que la
   présence de chaînes dans son gabarit de pull request. La flotte a déjà un
   gate qui lit le corps de la pull request : `check-pr-door`, check requis
   « Door declaration » depuis le 2026-10-14 (en-tête de
   `tools/quality/check-pr-door.ts`).
2. **La flotte dit quoi regarder en revue, pas comment conclure.** L'ordre des
   axes est fixé (`AGENTS.md:80` : « Security > quality > performance >
   completeness »), et le protocole de revue classe les constats par gravité
   (`docs/reviews/AGENT-REVIEW-PROTOCOL.md:28` : « blocking, major, minor and
   non-blocking findings »). Rien ne distingue un défaut reproduit d'un risque
   supposé : un constat `blocking` non reproduit a la même forme qu'un constat
   prouvé. Archify classe chaque constat selon ce qui est établi, pose
   qu'« an unverified risk is not a reproduced defect »
   (`tt-a1i/archify@25cf370:REVIEWING.md:45`) et fait repartir une re-revue du
   dernier head revu (`:55`).
3. **Aucun invariant ne dit qui autorise une installation live.** Sur la base
   `c466a5c`, une seule ligne d'`INVARIANTS.md` mentionne une installation :
   I-25, qui fait rejouer une vérification de collision quand un plugin est
   installé, sans dire qui autorise l'installation.
   Reproduire : `git show c466a5c:docs/decisions/INVARIANTS.md | grep -ci install`
   → `1`. La consigne « ne pas installer » conclut pourtant plusieurs
   évaluations d'outils : cinq des huit entrées dont le registre de D4 est
   amorcé refusent une installation, chacune d'un outil différent, décidées
   entre le 2026-10-08 et le 2026-10-22. Reproduire :
   `awk '/^  - id:/{id=$3} /^    action: install$/{print id}' ecosystem/refusals.v1.yaml`
   → cinq identifiants (Archify, Agent-Reach, rtk, REA, humanlayer-pi).
   Archify pose la règle dans son propre `AGENTS.md` (« Repository editing,
   testing, reviewing, publishing, or syncing does not authorize
   installation », `tt-a1i/archify@25cf370:AGENTS.md:15` ; installation
   partielle : `:21`).
4. **Les refus de la flotte ne sont écrits que pour les skills.**
   `skills/.out-of-scope/` (ADR-0025 D4) porte deux refus d'idées de skills.
   Les outils écartés à l'issue d'un drill ne sont écrits nulle part dans
   l'autorité : sur la base `c466a5c`, aucun des outils de l'amorce de D4 n'y
   est nommé, sauf `yt-dlp`, cité par ADR-0042 comme moteur de P29 et non comme
   refus. Reproduire :
   `git grep -il -E 'agent-reach|agentcontrolplane|humanlayer|morluto|yt-dlp|\brtk\b|archify' c466a5c -- .`
   → un seul fichier, `docs/adr/0042-product-vision-and-realization-method.md`.
   Une session suivante ne peut donc pas les consulter.
   Archify tient une section « Not planned » de 12 idées refusées, chacune
   motivée. Reproduire :
   `gh api 'repos/tt-a1i/archify/contents/ROADMAP.md?ref=25cf37080fc8b1dbe758a4efc3935b55f3327083' -H 'Accept: application/vnd.github.raw' | awk '/^## Not planned/{f=1} f&&/^\| \*\*/{n++} END{print n}'`
   → `12`.
5. **Une négative déclarée n'est vérifiée par personne.** Archify écrit 16 fois
   dans sa feuille de route qu'une tranche « adds no » schéma, dépendance,
   service hébergé, télémétrie ou surface, et aucun gate ne confronte ces
   phrases au diff. Reproduire : même commande `gh api … ROADMAP.md` suivie de
   `grep -c "adds no\|add no\|retain their existing boundaries"` → `16`. Une
   partie de ces négatives est vérifiable par le diff : manifestes de
   dépendances, schémas, workflows.

## Décisions proposées

### D1 — Toute pull request déclare l'origine de ce qu'elle corrige (R2)

Une pull request déclare l'origine du problème qu'elle traite, par une valeur
d'un vocabulaire fermé :

| Valeur | Sens | Exigence |
| --- | --- | --- |
| `observed` | une défaillance survenue en usage réel | sa date et sa source (pull request, issue, `chemin:ligne`, note de session) |
| `inspection` | un défaut trouvé en lisant le code, la doctrine ou un outil, sans défaillance constatée | — |
| `synthetic` | un cas construit pour l'occasion : sonde, fixture, vecteur, mutation | — |
| `proposal` | une amélioration sans défaut constaté | — |

Un cas construit n'est jamais présenté comme une défaillance d'usage : une
sonde qui rougit est `synthetic`, même quand elle reproduit un défaut réel. Une
pull request qui en porte plusieurs déclare la plus forte qu'elle peut citer.

Forme proposée : une ligne `Origin:` à côté de `Door:`, en début de ligne, hors
commentaire et hors bloc de code (`Origin: observed 2026-10-07 <source>`,
`Origin: inspection`). ADR-0050 D1 reste plus exigeant pour une skill : une
pull request de skill déclare `observed`.

### D2 — Dispositions de revue : comment conclure (R5, R6)

Chaque constat d'une revue reçoit une disposition, et une seule :

- **défaut bloquant** : porte son déclencheur, son impact et une preuve
  reproduite ;
- **preuve requise** : porte la revendication en cause et le plus petit
  contrôle qui la trancherait ; s'emploie aussi pour une décision de périmètre
  que la revue ne peut pas prendre ;
- **suggestion** : améliore sans conditionner la fusion ;
- **prêt** : rien ne s'oppose à la fusion sur le périmètre revu.

Un risque non vérifié n'est jamais présenté comme un défaut reproduit : faute
de preuve, il est une preuve requise. La disposition dit ce qui est établi ;
la gravité du protocole (`blocking`, `major`, `minor`, `non-blocking`) dit le
poids du constat. Un constat `blocking` sans preuve reproduite est une preuve
requise de gravité `blocking`. Le verdict `approve` ne coexiste avec aucun
défaut bloquant et aucune preuve requise ouverte.

Une re-revue part du dernier head revu et, si la base a bougé, de la base
intermédiaire : un vert antérieur ne prouve rien sur le nouveau diff.

Ces dispositions disent **comment conclure**. L'ordre des axes de la flotte
(sécurité > qualité > performance > complétude) dit **quoi regarder** ; il est
inchangé, et les dispositions ne le remplacent pas. Archify n'a ni la sécurité
ni la souveraineté parmi ses axes de revue : seule sa façon de conclure est
reprise.

### D3 — Installation live : seule une demande explicite l'autorise (R7, I-38)

Éditer, tester, revoir, publier ou synchroniser un dépôt n'autorise jamais
d'installer, de mettre à jour ou de retirer une installation live : skill,
plugin, hook ou outil d'agent, sur un poste ou dans un harnais. Seule une
demande explicite de cette action, à cette portée (source, harnais ou agents
concernés, portée globale ou projet), l'autorise. Une installation partielle se
rapporte comme un échec partiel, jamais comme un succès.

Inscrite comme invariant candidat I-38. Nature du constat : `inspection` (D1),
pas une défaillance datée — aucune installation non autorisée n'est citée ici.
La règle s'écrit avant le premier incident, comme I-35 à I-37 (ADR-0049) ; elle
ne porte aucun gate, faute d'échec observé qui en justifierait un.

### D4 — Registre de flotte des refus (R13)

`ecosystem/refusals.v1.yaml` porte les outils et les idées refusés par la
flotte. Une entrée porte sa date, son motif en constats, sa source publique (URL
de l'outil ou de l'idée, commit amont examiné quand il existe), l'action refusée
(`install`, `depend`, `reuse-code`, `use-service`), l'origine du constat au
vocabulaire de D1, et sa condition de réexamen quand elle en a une. Le format est
décrit en tête du fichier.

- Le registre se consulte avant toute nouvelle proposition d'outil, de
  dépendance, de service ou d'idée. Rouvrir un refus commence par relire son
  motif et dire ce qui a changé.
- Une entrée dont le motif n'est pas établi ne s'écrit pas. Retirer une entrée,
  ou lever le refus qu'elle porte, est une décision du propriétaire.
- Les refus d'idées de skills restent dans `skills/.out-of-scope/` (ADR-0025
  D4), seule autorité sur ce sujet ; le registre ne les recopie pas.
- Pas de projection générée : le registre jumeau `ecosystem/FORGOTTEN.yaml` se
  lit sans projection, et une projection exigerait un générateur et un gate de
  dérive (I-05) sans lecteur identifié.
- Licence `CC-BY-4.0`, comme `FORGOTTEN.yaml` et `LEGACY-MANIFEST.yaml`
  (`REUSE.toml`).

Amorce : huit entrées, chacune établie par l'évaluation datée qui l'a
décidée — Archify (installation), Agent-Reach (installation), yt-dlp
(dépendance d'un produit), le hook de réécriture de rtk (installation),
REA (installation), Agent Control Plane de HumanLayer (reprise de code),
humanlayer-pi (installation), le service HumanLayer (usage). Reproduire :
`grep -c '^  - id: refusal\.' ecosystem/refusals.v1.yaml` → `8`.

L'entrée `refusal.yt-dlp-dependency` touche une phrase signée : ADR-0042
(« Conséquences et limites ») note que le moteur de P29, `yt-dlp`, n'est pas
sous GPL, sans l'adopter ni le refuser. L'entrée consigne la décision du
2026-10-09 qui l'écarte pour P29 et les connecteurs de P01, au motif des
conditions d'utilisation de YouTube ; signer cet ADR signe aussi cette entrée.

Écartés de l'amorce, faute de pouvoir les étayer dans le dépôt : les décisions
de périmètre de P01 prises le même jour qu'Agent-Reach (pas d'API de recherche
web en v1, sources publiques seulement), dont la seule trace est une
spécification hors dépôt, sans source publique à citer.

### D5 — Négative par tranche (R15)

Une pull request qui ajoute une capacité déclare ce qu'elle **n'ajoute pas**,
dans un vocabulaire fermé : `dependency`, `schema`, `workflow`,
`hosted-service`, `telemetry`, `public-surface`. Les trois premiers se
vérifient par le diff (manifestes et lockfiles, fichiers de schéma, fichiers de
`.github/workflows/`) ; un gate les confrontera au diff. Les trois autres
restent déclaratifs et se lisent en revue (D2).

Archify déclare 16 négatives de ce type et n'en vérifie aucune (constat 5) :
c'est l'écart que la flotte comble. Une négative vérifiable par diff et démentie
par lui est un défaut bloquant, au sens de D2, dès que le gate existe.

## Écartés

- **Le reçu de gate structuré d'Archify** (diagnostics à code stable,
  résumé tronqué compté, prochaine action proposée) : **WATCH**, non refusé.
  L'échec du 2026-10-07 qui le motivait (`check-fleet-pins` annonçant un vert
  sur un arbre vide) est déjà couvert par `tools/quality/gate-report.ts`
  (147 lignes : chaque contrôle enregistré, un gate qui n'a rien affirmé
  échoue, volume imprimé sur la ligne de succès), employé par 49 fichiers
  hors tests, dont `ecosystem/check-fleet-pins.ts`. Reproduire :
  `wc -l < tools/quality/gate-report.ts` → `147` ;
  `git ls-files '*.ts' | grep -v '\.test\.ts$' | xargs grep -l GateReport | grep -v gate-report.ts | wc -l`
  → `49`. Ce qui reste d'Archify n'a ni consommateur ni échec observé
  (ADR-0050 D1). Condition de reprise : un mécanisme qui consomme les verdicts
  de gates en machine.
- **L'installation d'Archify comme outil : refusée**, entrée
  `refusal.archify-install`. Un nœud de diagramme qui porte
  `brand: {url, sha256}` déclenche un GET vers l'hôte nommé à chaque rendu,
  avant la vérification du digest, sans variable qui le coupe
  (`tt-a1i/archify@25cf370:archify/renderers/shared/brand-marks.mjs:607-612` :
  la requête en 607, la comparaison du digest en 612). Le contenu du diagramme
  décide donc d'une sortie réseau.

## Conséquences

- I-38 est inscrit au registre des invariants, source « ADR-0055 (candidat, en
  attente de signature) ».
- Le registre des décisions gagne D94.
- `ecosystem/refusals.v1.yaml` est créé avec huit entrées ; `REUSE.toml` le
  place sous `CC-BY-4.0` ; la carte d'autorité gagne sa ligne.
- `docs/reviews/AGENT-REVIEW-PROTOCOL.md` gagne la section « Disposition of each
  finding » (D2).
- D1 et D5 sont en vigueur à la signature comme règles de revue : la revue lit
  la ligne `Origin:` et la négative déclarée. Tant que leurs gates n'existent
  pas, leur absence n'empêche aucune fusion, ce qui s'écrit comme limite.

## Suites nommées, après signature

Aucune n'est livrée par cette pull request :

- **Gate de D1** : extension de `tools/quality/check-pr-door.ts` à une ligne
  `Origin:` (une seule, valeur du vocabulaire fermé, date ISO et source pour
  `observed`), avec le même traitement des auteurs implicites que `Door:`
  (`IMPLICIT_TWO_WAY_AUTHORS`).
- **Gate de D5** : confrontation des négatives `dependency`, `schema` et
  `workflow` au diff de la pull request, refus fermé sur un diff illisible,
  volume imprimé.
- **Gabarit de pull request** de `libre-ai/.github` : lignes `Origin:` et
  négative, à côté de `Door:`.
- **Contrôle de forme** de `ecosystem/refusals.v1.yaml` (champs requis, dates
  ISO, URL `https://`, unicité des `id`, vocabulaires fermés) dans
  `bun run check`, et entrée du fichier dans la surface de
  `check-review-evidence`.

Chaque suite est une mutation de garde-fou (I-17) et passe par sa propre pull
request.

## Ce qui n'est pas décidé ici

- La forme exacte de la ligne de négative de D5 (nom de la ligne, séparateur) :
  elle se décide avec le gate qui la lit.
- Si la ligne de D5 est exigée de toute pull request ou des seules pull
  requests qui ajoutent une capacité : un gate ne sait pas ce qu'est une
  capacité, et la suite tranchera.
- Les autres règles extraites par le drill : elles ne sont ni adoptées ni
  refusées par cet ADR.

## Numérotation

ADR-0055 et D94, et non ADR-0054 et D81 que donneraient les derniers numéros de
la base `c466a5c` : la pull request ouverte #130 réserve ADR-0054 et D81 à D93,
et le gate de doctrine refuse deux ADR de même numéro. Reproduire sur la base :
`git ls-tree --name-only c466a5c docs/adr/ | sed 's#docs/adr/##' | grep -oE '^[0-9]{4}-[a-z]' | cut -c1-4 | sort -n | tail -1`
→ `0053` (le filtre `-[a-z]` écarte `2026-09-29-portfolio-consolidation.md`,
qu'un simple `^[0-9]{4}` compte comme le numéro 2026) ;
`git show c466a5c:docs/decisions/DECISION-REGISTER.md | grep -oE '^\| D[0-9]+' | tail -1`
→ `| D80`. I-38 suit I-37
(`git show c466a5c:docs/decisions/INVARIANTS.md | grep -oE '^\| I-[0-9]+' | tail -1`
→ `| I-37`) ; #130 amende I-06 sans ajouter d'invariant. Un conflit de numéro à
la fusion se résout par renumérotation, jamais par réutilisation.
