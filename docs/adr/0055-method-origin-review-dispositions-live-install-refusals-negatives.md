# ADR-0055 — Méthode : origine du problème déclarée, dispositions de revue, installation live, registre des refus, négative par tranche

- **Statut :** proposed — la fusion de cette pull request est la signature du
  propriétaire (I-17, `AGENTS.md` : « a doctrine merge is a signature ») ;
  D1 à D5, I-38 et l'entrée D94 entrent en vigueur à la fusion, y compris les
  quatre dispositions de D2 et la règle de re-revue. Seule la conciliation des
  dispositions avec la gravité et les verdicts du protocole de revue (D2,
  options A et B) est un point d'arbitrage ; une fusion sans choix explicite
  vaut option B, qui ne change aucune règle de verdict.
- **Arbitrage :** en attente de signature. La consigne « go all » du
  propriétaire du 2026-10-22, sur les options recommandées du drill
  `tt-a1i/archify`, a engagé la rédaction de cet ADR ; elle n'en vaut pas
  adoption. Aucune trace d'arbitrage n'est écrite par la rédaction.
- **Date de rédaction :** 2026-10-22, révisé le 2026-10-23 après deux passes
  de revue à rôle séparé.
- **Portée :** forme des pull requests de la flotte (D1, D5), conclusion d'une
  revue (D2), autorisation d'une installation live (D3), mémoire des projets
  tiers écartés (D4).
- **Étend :** le gate de déclaration `Door:` (`tools/quality/check-pr-door.ts`),
  dont D1 et D5 sont la suite ; ADR-0025 D4 (`skills/.out-of-scope/`) aux
  projets tiers qui ne sont pas des skills (D4). ADR-0050 D1 n'est ni étendu ni
  modifié (D1).
- **Applique :** I-17 (surface à touche humaine fermée), I-25 (collection de
  skills), I-05 (projection jamais éditée à la main).
- **Invariants :** I-38 candidat (installation live) ; entrée D94 de
  `docs/decisions/DECISION-REGISTER.md`.
- **Autorise :** l'inscription d'I-38 et de D94 ; le registre
  `ecosystem/refusals.v1.yaml` et son amorce de neuf entrées ; le renvoi de
  `docs/reviews/AGENT-REVIEW-PROTOCOL.md` vers D2 et la ligne de gravité de
  D5 dans ce protocole ; la ligne du registre des
  refus dans la carte d'autorité (`docs/README.md`).
- **N'autorise pas :** la modification du gabarit de pull request de
  `libre-ai/.github` ; l'extension d'un gate ; l'installation d'un outil
  étudié ; la reprise verbatim d'un texte amont ; un amendement d'ADR-0042.
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
commande qui le reproduit, à rejouer avant usage. Les citations de ce dépôt
sont épinglées sur la base `c466a5c`.

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
   `c466a5c:tools/quality/check-pr-door.ts`).
2. **La flotte dit quoi regarder en revue, pas comment conclure.** L'ordre des
   axes est fixé (`c466a5c:AGENTS.md:80` : « Security > quality > performance >
   completeness »), et le protocole de revue classe les constats par gravité
   (`c466a5c:docs/reviews/AGENT-REVIEW-PROTOCOL.md:28` : « blocking, major,
   minor and non-blocking findings »). Rien ne distingue un défaut reproduit
   d'un risque supposé : un constat `blocking` non reproduit a la même forme
   qu'un constat prouvé. Archify classe chaque constat selon ce qui est établi,
   pose qu'« an unverified risk is not a reproduced defect »
   (`tt-a1i/archify@25cf370:REVIEWING.md:45`) et fait repartir une re-revue du
   dernier head revu (`:55`).
3. **Aucun invariant ne dit qui autorise une installation live.** Sur la base
   `c466a5c`, une seule ligne d'`INVARIANTS.md` mentionne une installation :
   I-25, qui fait rejouer une vérification de collision quand un plugin est
   installé, sans dire qui autorise l'installation.
   Reproduire : `git show c466a5c:docs/decisions/INVARIANTS.md | grep -ci install`
   → `1`. Deux textes la couvrent en partie, sans rang d'invariant : la skill
   `verify-runtime` (« Aucune dépendance installée ni configuration durable
   modifiée sans autorisation », `c466a5c:skills/verify-runtime/SKILL.md:43`),
   qui ne dit pas qui autorise, et ADR-0050 (« L'installation reste un acte de
   harness, hors de ce dépôt », `c466a5c:docs/adr/0050-amend-adr-0025-observed-failure-working-signs-collision-replay.md:156-157`),
   qui ne vise que la distribution de la collection de skills. La consigne
   « ne pas installer » conclut pourtant plusieurs évaluations d'outils : sept
   des neuf entrées dont le registre de D4 est amorcé refusent une
   installation, chacune d'un outil différent, décidées entre le 2026-10-08 et
   le 2026-10-22. Reproduire :
   `awk '/^  - id:/{id=$3} /^    action: install$/{print id}' ecosystem/refusals.v1.yaml`
   → sept identifiants (Archify, Agent-Reach, claude-watch, golive-skill,
   rtk, REA, humanlayer-pi).
   Archify réserve l'installation à la demande explicite de son utilisateur
   (« only when the user explicitly requests that action. Repository editing,
   testing, reviewing, publishing, or syncing does not authorize
   installation », `tt-a1i/archify@25cf370:AGENTS.md:15` ; installation
   partielle : `:21`).
4. **Aucun registre ne porte les projets tiers évalués puis écartés.** La
   flotte écrit des refus à deux endroits, qui ne couvrent pas ce cas :
   `vision.md` §28 « Non-objectifs » (`c466a5c:vision.md:544-561`, auquel
   renvoie `c466a5c:docs/positioning/non-goals.md:3`) porte les non-objectifs
   de la cible, et `skills/.out-of-scope/` (ADR-0025 D4) deux idées de skills
   refusées. Les projets tiers écartés à l'issue d'un drill ou d'un essai ne
   sont écrits nulle part dans l'autorité : ni sur la base `c466a5c` ni sur la
   tête de la branche servie du 2026-10-23 (`6ffeb40`), aucun des outils de
   l'amorce de D4 n'y est nommé. Reproduire, pour chacun des deux commits :
   `git grep -il -E 'agent-reach|agentcontrolplane|humanlayer|morluto|rtk|archify|claude-watch|claude-video|golive' <commit> -- .`
   → aucune sortie. Une session suivante ne peut donc pas les consulter.
   Archify tient une section « Not planned » de 12 idées refusées, chacune
   motivée. Reproduire :
   `gh api 'repos/tt-a1i/archify/contents/ROADMAP.md?ref=25cf37080fc8b1dbe758a4efc3935b55f3327083' -H 'Accept: application/vnd.github.raw' | awk '/^## Not planned/{f=1} f&&/^\| \*\*/{n++} END{print n}'`
   → `12`.
5. **Une négative déclarée n'est vérifiée par personne.** La feuille de route
   d'Archify porte 16 lignes dont une proposition déclare qu'une tranche
   n'ajoute pas, ou laisse dans ses limites, un schéma ou une dépendance (avec,
   selon la ligne, IR, mise en page, stockage, service hébergé, surface
   mobile), et aucun gate ne confronte ces phrases au diff. Reproduire : même
   commande `gh api … ROADMAP.md`, suivie de
   `grep -n -o -E "(adds no|add no)[^.]*|[^.]*retain their existing boundaries" | grep -E 'schema|dependenc' | cut -d: -f1 | sort -un | wc -l`
   → `16`. Sans le second filtre, la ligne 58 sort deux fois : une fois pour
   « mobile adds no chrome », qui décrit un comportement et non une négative,
   une fois pour une vraie négative (« schema, IR, layout, dependencies […]
   retain their existing boundaries ») ; elle compte donc une fois. Une partie
   de ces négatives est vérifiable par le diff : manifestes de dépendances,
   schémas, workflows.

## Décisions proposées

### D1 — Toute pull request déclare l'origine de ce qu'elle corrige (R2)

Une pull request déclare l'origine du problème qu'elle traite, par une valeur
d'un vocabulaire fermé :

| Valeur | Sens | Exigence |
| --- | --- | --- |
| `observed` | une défaillance survenue en usage réel ; un fait périmé, daté et cité, en est une (même lecture qu'ADR-0050 D1) | sa date et sa source (pull request, issue, `chemin:ligne`, note de session) |
| `inspection` | un défaut trouvé en lisant le code, la doctrine ou un outil, sans défaillance survenue ni fait périmé cité | — |
| `synthetic` | un cas construit pour l'occasion : sonde, fixture, vecteur, mutation | — |
| `proposal` | une amélioration sans défaut constaté | — |

Un cas construit n'est jamais présenté comme une défaillance d'usage : une
sonde qui rougit est `synthetic`, même quand elle reproduit un défaut réel. Une
pull request dont le problème a plusieurs origines déclare celle qui l'a
déclenchée et cite les autres dans son corps.

Forme proposée : une ligne `Origin:` à côté de `Door:`, en début de ligne, hors
commentaire et hors bloc de code (`Origin: observed 2026-10-07 <source>`,
`Origin: inspection`).

**Articulation avec ADR-0050.** ADR-0050 D1 reste la seule autorité sur
l'admission et la modification d'une skill, et D3 d'ADR-0050 sur sa promotion,
qui se prononce sur des signes de fonctionnement et ne suppose aucune
défaillance. `Origin:` est une déclaration orthogonale : elle dit d'où vient le
problème, elle n'ajoute ni ne retire aucune condition d'admission, et une pull
request de skill la porte comme toute autre.

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
de preuve, il est une preuve requise.

Une re-revue part du dernier head revu, qui fixe le point de départ de la
passe fraîche ; elle n'abolit pas la passe fraîche exigée par
`c466a5c:docs/reviews/AGENT-REVIEW-PROTOCOL.md:32` après tout changement
normatif postérieur à un verdict. Un vert antérieur ne prouve rien sur le
nouveau diff.

Les quatre dispositions, la règle qui les assortit et la règle de re-revue
entrent en vigueur à la fusion, sans condition.

Ces dispositions disent **comment conclure**. L'ordre des axes de la flotte
(sécurité > qualité > performance > complétude) dit **quoi regarder** ; il est
inchangé, et les dispositions ne le remplacent pas. Archify n'a ni la sécurité
ni la souveraineté parmi ses axes de revue : seule sa façon de conclure est
reprise.

**Seul point d'arbitrage du propriétaire — conciliation avec la gravité et les
verdicts du protocole.** Le protocole classe déjà chaque constat par gravité
(`blocking`, `major`, `minor`, `non-blocking`) et rend un verdict parmi
`approve`, `approve-with-minor-reservations` et `reject`
(`c466a5c:docs/reviews/AGENT-REVIEW-PROTOCOL.md:28-29`). La rédaction ne
tranche pas leur articulation avec les dispositions :

| Option | Contenu | Conséquence |
| --- | --- | --- |
| A | (1) la disposition dit comment conclure, la gravité garde le poids ; (2) un constat `blocking` ou `major` ouvert ne peut être classé que « défaut bloquant » ou « preuve requise » ; (3) `approve-with-minor-reservations`, comme `approve`, n'admet aucune « preuve requise » ouverte | Les deux échelles restent, et un verdict favorable ne peut plus couvrir une revendication non tranchée ; une revue ouverte sur une preuve requise rend `reject` ou attend le contrôle |
| B | Les dispositions qualifient seulement la preuve de chaque constat ; la gravité seule conditionne le verdict, comme aujourd'hui | Aucune règle de verdict ne change ; un `approve-with-minor-reservations` peut encore laisser ouverte une preuve requise de gravité `minor` ou `non-blocking` |

Recommandation de la rédaction : A, parce qu'elle seule empêche qu'un verdict
favorable repose sur une revendication non vérifiée. **Une fusion sans choix
explicite du propriétaire vaut option B** : les dispositions s'emploient, et
aucune règle de verdict du protocole ne change.

### D3 — Installation live : seule une demande explicite du propriétaire humain l'autorise (R7, I-38)

Éditer, tester, revoir, publier ou synchroniser un dépôt n'autorise jamais
d'installer, de mettre à jour ou de retirer une installation live : skill,
plugin, hook ou outil d'agent, sur un poste ou dans un harnais. Seule une
demande explicite de la personne humaine propriétaire, pour cette action et à
cette portée (source, harnais ou agents concernés, portée globale ou projet),
l'autorise. Cette demande se fait en conversation, ou par une réponse humaine
à l'invite de permission — jamais par une règle d'autorisation préenregistrée,
un mode automatique ou un hook. Un mandat d'agent, un prompt ou un contenu lu
n'en tient jamais lieu, même quand il affirme relayer une telle demande : un
agent qui reçoit une installation par mandat obtient la demande du
propriétaire par l'un de ces deux canaux. Une installation partielle se
rapporte comme un échec partiel, jamais comme un succès.

Inscrite comme invariant candidat I-38. Nature du constat : `inspection` (D1),
pas une défaillance datée — aucune installation non autorisée n'est citée ici.
Cet ADR n'outille pas la règle : un gate qui la ferait respecter vivrait dans
le harnais, hors de ce dépôt, et n'est pas proposé ici.

### D4 — Registre de flotte des projets tiers écartés (R13)

`ecosystem/refusals.v1.yaml` porte les projets, outils et dépendances
**tiers** que la flotte a évalués (drill, essai) puis écartés. Il ne porte
rien d'autre : les non-objectifs de la cible et des produits, y compris un
choix de stack qui nomme un outil tiers et le refus d'une dépendance d'un
produit, restent dans `vision.md` §28 ; les idées de skills refusées restent
dans `skills/.out-of-scope/` (ADR-0025 D4). Les trois surfaces ne se
recouvrent pas.

Une entrée porte sa date, son motif en constats, sa source publique, le commit
amont examiné quand il existe, l'action refusée, l'origine du constat au
vocabulaire de D1, et sa condition de réexamen quand elle en a une. Les
actions sont `install` (installation live sur un poste ou dans un harnais),
`depend` (dépendance ou outil de l'**outillage de flotte** seulement : gates,
harnais, CI), `reuse-code` (reprise ou déploiement du code) et `use-service`
(service hébergé). Une dépendance refusée pour un produit n'entre pas au
registre : c'est un choix de stack, du ressort de `vision.md` §28. Le format
est décrit en tête du fichier.

- **Critère d'entrée.** Toute entrée porte au moins une preuve publique qui
  établit son motif : citation épinglée `<propriétaire>/<dépôt>@<sha>:<chemin>:<lignes>`,
  ou URL toujours suivie de sa date de consultation. Un constat du motif que la preuve
  publique n'établit pas est marqué comme tel dans l'entrée. Une entrée sans
  preuve publique ne s'écrit pas.
- Le registre se consulte avant toute nouvelle proposition d'un projet, d'un
  outil, d'une dépendance ou d'un service tiers. Rouvrir un refus commence par
  relire son motif et dire ce qui a changé.
- Retirer une entrée, ou lever le refus qu'elle porte, est une décision du
  propriétaire.
- Pas de projection générée : le registre jumeau `ecosystem/FORGOTTEN.yaml` se
  lit sans projection, et une projection exigerait un générateur et un gate de
  dérive (I-05) sans lecteur identifié.
- Licence `CC-BY-4.0`, comme `FORGOTTEN.yaml` et `LEGACY-MANIFEST.yaml`
  (`REUSE.toml`).

Amorce : neuf entrées, chacune avec au moins une preuve publique — Archify
(installation), Agent-Reach (installation), claude-watch (installation),
golive-skill (installation), le hook de réécriture de rtk (installation), REA
(installation), Agent Control Plane de HumanLayer (reprise de code),
humanlayer-pi (installation), le service HumanLayer (usage). Le motif de
claude-watch tient sur l'envoi de l'audio à Groq ou à OpenAI, sans recourir à
`yt-dlp`, et ne touche donc pas ADR-0042. Reproduire :
`grep -c '^  - id: refusal\.' ecosystem/refusals.v1.yaml` → `9` ;
aucune entrée sans preuve :
`grep -c '^    evidence: \[\]' ecosystem/refusals.v1.yaml` → `0`.

Écartés de l'amorce :

- `yt-dlp` : son refus pour P29 et les connecteurs de P01 inverserait une
  phrase signée d'ADR-0042 (« P29 n'a que des clients GPL, mais son backend,
  `yt-dlp`, ne l'est pas », `c466a5c:docs/adr/0042-product-vision-and-realization-method.md:338-341`),
  qui fait de `yt-dlp` le backend de P29. C'est un amendement d'ADR-0042, pas
  une inscription au registre (voir « Ce qui n'est pas décidé ici ») ;
- les décisions de périmètre de P01 prises le même jour qu'Agent-Reach (pas
  d'API de recherche web en v1, sources publiques seulement) : ce sont des
  non-objectifs de produit, hors du registre, et leur seule trace est une
  spécification hors dépôt, sans source publique.

### D5 — Négative par tranche (R15)

Une pull request qui ajoute une capacité déclare ce qu'elle **n'ajoute pas**,
dans un vocabulaire fermé : `dependency`, `schema`, `workflow`,
`hosted-service`, `telemetry`, `public-surface`. Les trois premiers se
vérifient par le diff (manifestes et lockfiles, fichiers de schéma, fichiers de
`.github/workflows/`) ; un gate les confrontera au diff. Les trois autres
restent déclaratifs et se lisent en revue (D2).

Archify déclare de telles négatives sur 16 lignes et n'en vérifie aucune
(constat 5) : c'est l'écart que la flotte comble. Deux cas se distinguent :

- **l'absence de déclaration** n'est pas bloquante tant que le gate de D5
  n'existe pas ;
- **une déclaration démentie par le diff** — une pull request qui déclare ne
  pas ajouter de dépendance, de schéma ou de workflow et en ajoute un — est,
  dès la signature, un défaut bloquant au sens de D2, de gravité `blocking` au
  sens du protocole de revue, constaté en revue. Cette gravité est fixée ici et
  ne dépend pas de l'option retenue en D2.

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
  la requête en 607, la comparaison du digest en 612 ; le module lit deux
  variables d'environnement, en trois endroits, `:135`, `:163` et `:184`, et
  aucune ne désactive la requête). Le contenu du diagramme décide donc d'une
  sortie réseau.

## Conséquences

- I-38 est inscrit au registre des invariants, source « ADR-0055 (candidat,
  signature au merge sous I-17) ».
- Le registre des décisions gagne D94.
- `ecosystem/refusals.v1.yaml` est créé avec neuf entrées ; `REUSE.toml` le
  place sous `CC-BY-4.0` ; la carte d'autorité gagne sa ligne, qui en écrit le
  partage avec `vision.md` §28 et `skills/.out-of-scope/`.
- **Le registre n'a aujourd'hui ni consommateur ni gate** : aucun outil ne le
  lit, aucun contrôle ne vérifie sa forme, et sa consultation avant une
  proposition (D4) n'est tenue que par la revue.
- `docs/reviews/AGENT-REVIEW-PROTOCOL.md` gagne un renvoi vers D2, sans en
  recopier le texte, et la gravité `blocking` d'une négative démentie par le
  diff (D5).
- D1 et D5 sont en vigueur à la signature comme règles de revue : la revue lit
  la ligne `Origin:` et la négative déclarée. Tant que leurs gates n'existent
  pas, l'absence de ces lignes n'empêche aucune fusion, ce qui s'écrit comme
  limite ; une négative démentie par le diff bloque dès la signature (D5).

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
  ISO, au moins une preuve publique, unicité des `id`, vocabulaires fermés)
  dans `bun run check`, et entrée du fichier dans la surface de
  `check-review-evidence`.

Chaque suite est une mutation de garde-fou (I-17) et passe par sa propre pull
request.

## Ce qui n'est pas décidé ici

- L'option de conciliation des dispositions de D2 avec la gravité et les
  verdicts du protocole (A ou B) : seul point d'arbitrage du propriétaire ; une
  fusion sans choix explicite vaut B. Les dispositions et la règle de re-revue
  ne sont pas dans ce point : elles entrent en vigueur à la fusion.
- Le refus de `yt-dlp` pour P29 et les connecteurs de P01 : candidat à un
  amendement d'ADR-0042 par le propriétaire, la phrase signée citée à D4
  faisant de `yt-dlp` le backend de P29.
- La forme exacte de la ligne de négative de D5 (nom de la ligne, séparateur) :
  elle se décide avec le gate qui la lit.
- Si la ligne de D5 est exigée de toute pull request ou des seules pull
  requests qui ajoutent une capacité : un gate ne sait pas ce qu'est une
  capacité, et la suite tranchera.
- Les autres règles extraites par le drill : elles ne sont ni adoptées ni
  refusées par cet ADR.

## Numérotation

ADR-0055, D94 et I-38 suivent les derniers numéros de la branche servie, où
la pull request #130 a fusionné ADR-0054 et D81 à D93. Reproduire, sur la tête
de la branche servie :
`git ls-tree --name-only origin/migrate/recover-code docs/adr/ | sed 's#docs/adr/##' | grep -oE '^[0-9]{4}-[a-z]' | cut -c1-4 | sort -n | tail -1`
→ `0054` (le filtre `-[a-z]` écarte `2026-09-29-portfolio-consolidation.md`,
qu'un simple `^[0-9]{4}` compte comme le numéro 2026) ;
`git show origin/migrate/recover-code:docs/decisions/DECISION-REGISTER.md | grep -oE '^\| D[0-9]+' | tail -1`
→ `| D93` ;
`git show origin/migrate/recover-code:docs/decisions/INVARIANTS.md | grep -oE '^\| I-[0-9]+' | tail -1`
→ `| I-37` (#130 amende I-06 sans ajouter d'invariant). Mesures du
2026-10-23, tête `6ffeb40`. Un conflit de numéro à la fusion se résout par
renumérotation, jamais par réutilisation.
