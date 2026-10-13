# ADR-0050 — Amendement d'ADR-0025 : une skill entre ou change sur un échec observé, se promeut sur des signes observables, et sa collision se rejoue à chaque plugin

- **Statut :** proposed — soumis à la signature du propriétaire ; la fusion de
  cette pull request constituerait l'arbitrage. Rien de ce qui suit n'est en
  vigueur avant elle.
- **Arbitrage :** aucun sur le contenu à la date de rédaction. Les arbitrages
  propriétaires du 2026-10-13 issus du même drill portent sur d'autres objets
  (désinstallation du plugin machine `mattpocock-skills`, Work Supervision
  comme tracker, forme des pull requests, garde de push en demande de
  confirmation) ; aucun ne tranche ce texte. D7 et D8 sont des options
  ouvertes que la signature doit trancher, ou laisser explicitement ouvertes.
- **Date de rédaction :** 2026-10-13
- **Portée :** admission, modification et promotion d'une skill de
  `governance/skills/` ; vérification de collision avec les plugins machine.
- **Amende :** ADR-0025 D2 (une quatrième condition, la condition 3 rejouée,
  un test de composition nommé, une résolution de plus) et D6 (critère de
  promotion). D1, D3, D4 et D5 restent inchangées.
- **Invariants :** I-25 amendé, texte historique conservé dans la ligne du
  registre (précédent d'I-05, ADR-0031) ; entrée D73 de
  `docs/decisions/DECISION-REGISTER.md`.
- **Source :** drill du dépôt amont `mattpocock/skills` (licence MIT, HEAD
  `49dd158d` relevé le 2026-10-13). Idées seulement : aucun texte n'est repris
  verbatim, aucune obligation MIT n'en découle.

## Contexte — quatre constats du 2026-10-13

1. **La vérification de collision D2.3 n'a jamais été rejouée.** Sa table date
   du 2026-08-18. Le plugin machine `mattpocock-skills` a été installé le
   2026-08-19T03:14Z (`installedAt` de
   `~/.claude/plugins/installed_plugins.json`), version 1.2.3, 25 skills
   déclarées dont 11 chargées en model-invoked (relevé du drill). Aucune n'y
   figure. Les collisions effectives relevées ce jour sont invisibles au gate
   T2, qui ne compare que la collection à elle-même, et pour les deux pires
   elles le seraient même s'il les voyait : score TF-IDF **0.000** entre
   `tdd` et `superpowers:test-driven-development`, et entre `diagnosing-bugs`
   et `superpowers:systematic-debugging` (fonction identique, vocabulaire
   disjoint). S'y ajoutent `code-review` (quatre cibles concurrentes),
   `writing-for-agents` face à `superpowers:writing-skills` et
   `anthropic-skills:skill-creator`, et `grilling` face à
   `superpowers:brainstorming` et à ADR-0022. `writing-for-agents` est en outre
   refusée par la collection (`skills/.out-of-scope/writing-for-agents-as-skill.md`)
   et chargée quand même.
2. **La promotion n'a pas de critère.** D6 dit « usage réel confirmé » sans
   dire ce qui se confirme. `eval.json` porte un seul cas comportemental, que
   D2.2 laisse à la revue sans le noter (`skills/review-fanout/eval.json`) ;
   aucune skill admise n'a quitté `candidate` (`grep -h '^status'
   skills/*/SKILL.md`).
3. **L'admission est mécanique.** Les trois conditions de D2 vérifient la
   forme d'une skill, jamais le besoin : rien n'exige qu'une skill, ou une
   modification de skill, réponde à une panne constatée. L'amont applique une
   barre « échec observé » à toute demande, quelle que soit sa taille
   (`SCOPE.md` amont), et un test de composition à toute skill nouvelle (une
   capacité qui se compose à partir de l'existant n'a pas de skill propre).
   La collection l'applique déjà sans le nommer :
   `skills/.out-of-scope/verify-the-world-as-skill.md` refuse une skill parce
   que deux artefacts admis la couvrent.
4. **D1 reste sans effet faute de canal.** La licence voyage avec le fichier,
   mais aucun fichier ne voyage : la session du 2026-10-13 charge la copie
   machine `~/.claude/skills/biscuit-auth/SKILL.md` (163 lignes, 0 en-tête
   SPDX), pas la version canonique `skills/biscuit-auth/SKILL.md` (93 lignes,
   en-tête SPDX). Reproduire : `wc -l` et `grep -c SPDX` sur les deux
   chemins. L'amont distribue par manifeste de plugin et bloc d'installation
   par harnais, et tient un journal de changements par version.

## Décisions proposées

### D1 — Quatrième condition d'admission : un échec observé, daté, cité

Une skill entre dans la collection, et une skill admise est modifiée, seulement
si le changeset cite un **échec observé** dans une session réelle : la date, ce
qui a été lancé, ce que l'agent a fait, ce qui était attendu, et la source
(`chemin:ligne`, pull request, note de session). Une amélioration hypothétique
(« ce serait mieux si… ») ne la remplit pas. La taille du changement est
indifférente : une correction d'un mot et une réécriture passent la même barre.
Un fait périmé que la skill recopie est un échec observé dès qu'il est daté et
cité.

### D2 — Test de composition, nommé

Avant d'admettre une skill **nouvelle**, le changeset montre que son
comportement ne s'obtient pas en composant ce qui existe déjà : skills admises,
règles du harness, pointeur vers un document de méthode. Une réponse positive
(« ça se compose ») est un refus, consigné sous `skills/.out-of-scope/` (D4).
C'est le raisonnement de `verify-the-world-as-skill.md`, désormais une
condition écrite plutôt qu'un précédent.

### D3 — `working_if` : la promotion se prononce sur des signes observables

`eval.json` gagne un champ `working_if`, une liste d'au moins deux **signes
observables** : chacun se vérifie en lisant une transcription de session ou un
artefact produit, sans interpréter une intention (« la sortie cite le
`chemin:ligne` de chaque gate rejoué », pas « l'agent comprend la
doctrine »). Il complète le cas comportemental de D2.2, qui reste une fixture
de revue.

Le passage `candidate` → `promoted` (D6) exige que le propriétaire ait constaté
ces signes sur un usage réel, cité par date et source dans le changeset de
promotion. La promotion reste un acte propriétaire ; aucun gate ne la fait.
La vérification de forme du champ par T1 (`lint-skill.ts`) est un changement
d'outillage, hors de cette pull request ; tant qu'elle n'existe pas, le champ
est une convention de revue.

### D4 — D2.3 rejouée à chaque installation ou mise à jour d'un plugin machine

La vérification manuelle de collision ne se fait plus seulement à l'admission.
Elle se rejoue à chaque **installation ou mise à jour** d'un plugin machine qui
charge des skills, et à chaque admission. Elle reste un constat humain, jamais
un gate figé sur un inventaire (la raison de D2.3 tient toujours). Son
journal, daté, va dans un sous-répertoire `skills-collisions` du répertoire
de preuves `docs/reviews` (preuve non normative, comme tout ce répertoire ; le
sous-répertoire n'existe pas encore), une entrée par installation ou mise à
jour, avec la source de chaque score cité.

Le constat est complet quand chaque skill model-invoked ajoutée par le plugin a
été comparée par **fonction**, pas seulement par score lexical, aux skills
machine, aux autres plugins et à la collection : un score nul ne prouve pas
l'absence de collision (constat 1).

Première application : le constat du 2026-10-13 ci-dessus. Sa résolution est
l'arbitrage du même jour, qui désinstalle le plugin et vendorise quatre de ses
skills dans les skills machine ; l'exécution vit hors de ce dépôt. La
vendorisation est elle-même un ajout de skills machine : le prochain constat
la couvre.

### D5 — Résolution par invocation namespacée

La table des résolutions de D2.3 gagne une forme : **atteindre par invocation
namespacée** (`/<plugin>:<skill>`). Elle résout une collision de **nom** pour
l'invocation humaine, sans renommer ni fusionner. Elle ne résout pas une
collision de **routage** entre deux skills model-invoked : l'agent choisit sur
la description, pas sur le préfixe, et les deux restent candidates. Une
collision de routage se résout encore par réécriture de description,
restriction de périmètre, désactivation d'une des deux, ou passage en
user-invoked.

### D6 — Ce qui ne change pas

Le seuil T2 (≥ 75 % refusé, ≥ 50 % averti), le plancher de rang 1, la
dépréciation par suppression, `.out-of-scope/` et le budget de corps restent
ceux d'ADR-0025.

## Options soumises à arbitrage, non décidées ici

### D7 — Canal de distribution de la collection

| Option | Contenu | Conséquence |
| --- | --- | --- |
| A | Un manifeste de plugin généré depuis `skills/` : il liste exactement les skills admises, un gate vérifie l'égalité manifeste = collection ; un bloc d'installation par harnais (Claude Code par marketplace, Codex et Pi par copie documentée) | D1 d'ADR-0025 prend effet : la copie installée porte son en-tête SPDX et se compare à la canonique. Un gate de plus, et ce dépôt devient une source d'installation dont la version se suit |
| B | Le bloc d'installation par harnais seulement, sans manifeste | Coût minimal ; la dérive entre copie installée et canonique n'est vue par rien |
| C | Statu quo : pas de canal, les copies machine restent distinctes | D1 d'ADR-0025 reste sans effet, ce qui s'écrit alors comme limite assumée |

Recommandation de la rédaction : A, parce que c'est la seule qui rende D1
mesurable. L'installation reste un acte de harness, hors de ce dépôt, quelle
que soit l'option.

### D8 — Journal de comportement par skill

| Option | Contenu | Conséquence |
| --- | --- | --- |
| A | Un `CHANGELOG.md` par skill, une entrée par changement de comportement, qui cite l'échec observé de D1 | La trace de D1 vit à côté de la skill et voyage avec elle ; un fichier de plus par skill |
| B | Un journal unique pour la collection | Une seule surface à lire ; ne voyage pas avec une skill copiée seule |
| C | Rien : l'historique git et les corps de pull request suffisent | Aucun coût ; la trace ne survit pas à une copie hors dépôt |

Aucune recommandation : le choix dépend de D7 (une distribution par fichier
favorise A).

## Conséquences

- I-25 est amendé (D1 à D5) ; son texte historique du 2026-08-18 est conservé
  dans la ligne du registre, de sorte que toute citation antérieure reste
  vraie.
- Le registre des décisions gagne D73.
- `docs/method/SKILLS-ANATOMY.md` porte, dans la même pull request, la doctrine
  d'écriture issue du même drill ; il ne répète pas ces règles d'admission.
- Restent à faire hors de cette pull request : la vérification de forme de
  `working_if` par T1 ; le gate du manifeste si D7-A est retenue ; le premier
  `working_if` des skills admises, qui passe lui-même la barre D1.

## Ce qui n'est pas décidé ici

- D7 et D8.
- La promotion d'une skill : aucune ne quitte `candidate` par cet ADR.
- Un garde machine qui signalerait une installation ou une mise à jour de
  plugin (décision de harness, hors de ce dépôt) ; D4 dit quand le constat se
  rejoue, pas qui le déclenche.
