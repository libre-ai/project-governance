# Anatomie d'une skill — doctrine d'écriture

- **Portée :** comment écrire un `SKILL.md` de `governance/skills/` — structure,
  budget, formulation. La gouvernance d'admission (anti-doublon, eval,
  dépréciation, `.out-of-scope/`) est fixée par ADR-0025 ; ce document ne la
  répète pas, il fixe la doctrine d'**écriture**, distincte.

## Le pointeur a un coût double

Renvoyer vers un autre document (« voir X ») semble gratuit — aucun texte
dupliqué, aucune dérive de contenu. Le coût réel est ailleurs, et il est
double :

- **Charge de contexte.** Un agent qui suit le pointeur charge le fichier
  cible en plus du fichier courant — le budget de contexte grossit à chaque
  saut, même quand le document cible est bref.
- **Charge cognitive.** Un pointeur interrompt la lecture linéaire : l'agent
  doit décider s'il suit le lien maintenant, plus tard, ou pas du tout, puis
  reconstituer le fil une fois revenu. Cette décision se prend à chaque
  pointeur rencontré, pas une fois pour toutes.

Un pointeur n'est donc légitime que si le contenu visé est réellement
**hors du chemin le plus fréquent** de la skill — sinon, il s'inline. Une
skill qui pointe vers cinq documents pour une tâche qui les touche presque
toujours n'a rien économisé, elle a seulement déplacé le coût de rédaction
vers un coût de lecture répété à chaque invocation.

**La formulation du pointeur décide, pas sa cible.** Un pointeur dit ce qu'est
le contenu visé et dans quel cas le lire. Quand un agent ne suit pas un
pointeur dont la cible est indispensable, la première correction porte sur la
formulation (la condition de lecture, le premier mot) ; inliner ne vient
qu'ensuite, si la formulation corrigée ne suffit pas. Un pointeur chargé en
permanence (une description, une ligne d'`AGENTS.md`) porte un déclencheur par
branche réelle : deux synonymes qui nomment le même cas sont une branche
écrite deux fois.

### Pointeur dur, pointeur mou

Deux sortes de dépendance, deux formes de pointeur :

- **Dépendance dure** : sans le document visé, la sortie est **fausse** (un
  identifiant, une liste fermée, une convention que la skill applique).
  Le pointeur est explicite et nomme sa condition : « lire X avant d'écrire
  Y ».
- **Dépendance molle** : sans le document visé, la sortie est seulement moins
  précise (un vocabulaire, un contexte d'ADR). La mention reste vague, ou
  absente ; la skill fonctionne sans.

Écrire un pointeur dur là où la dépendance est molle paie la charge de
contexte sans rien protéger.

## Trois échelons, divulgation progressive

Une skill se charge par paliers, jamais d'un bloc :

1. **Frontmatter** (`name`, `description`) — chargé en permanence par le
   mécanisme de routage du harness, sur toutes les skills admises à la fois.
   C'est l'échelon le plus cher au global (il se charge N fois, une par
   skill, à chaque tâche) et le moins cher par unité (une ligne).
2. **Corps du `SKILL.md`** — chargé une fois la skill déclenchée. Budget
   cible 120 lignes (avertissement CI à 200, jamais un échec — voir
   ADR-0025 D5). Porte le chemin le plus fréquent de la skill : ce qu'une
   invocation sur deux a besoin de lire.
3. **`references/`** — chargé seulement quand la tâche touche réellement la
   branche que ce fichier documente. Jamais préchargé avec le corps.

**Test de coupure : y a-t-il un branchement ?** La question qui décide si un
paragraphe reste au corps ou part en référence n'est pas « est-ce
long ? » mais « existe-t-il, dans le déroulé de la tâche, un point de
décision après lequel ce contenu ne sert plus jamais ? ». `biscuit-auth`
illustre le test : authority/attenuation/policies servent à toute
implémentation Biscuit, rotation/révocation ne servent qu'à la branche
« je change une clé ou je révoque un token » — un branchement net, donc une
scission nette (`references/rotation-revocation.md`). Sans branchement
identifiable, scinder n'économise rien : ça déplace le contenu sans réduire
le nombre de fois où il se charge.

**Co-localisation.** Une fois l'échelon choisi, ce qui va ensemble se range
ensemble : la définition d'un concept, ses règles et ses réserves sous un même
titre, pour que lire l'une amène les autres. Un concept éparpillé en trois
endroits n'est pas dupliqué (chaque fragment n'existe qu'une fois), mais
l'agent qui n'en lit qu'un agit sur un tiers de la règle.

## Quand scinder une skill

Trois coupes, chacune avec son motif ; hors de ces motifs, une scission
dépense de la charge sans rien acheter :

- **Par branche** — le test de coupure ci-dessus : ce que seule une branche
  atteint part en `references/`.
- **Par séquence** — une suite d'étapes dont les étapes suivantes, visibles,
  poussent l'agent à bâcler celle en cours (voir « Critères de fin »). La
  coupe ne vaut qu'à travers une **vraie frontière de contexte** : un
  sous-agent ou une passation. Un appel en ligne laisse les étapes suivantes
  dans le contexte et ne cache rien. À l'inverse, fusionner deux séquences
  expose chaque étape à tout ce qui la suit.
- **Par invocation** — détacher une skill `model-invoked` seulement si un mot
  qu'on emploie réellement doit la déclencher seule, ou si une autre skill
  doit l'atteindre ; chaque description ajoutée se paie à chaque tâche.

## Critères de fin

Chaque étape d'une skill se termine sur un **critère de fin** : la condition
qui dit à l'agent que l'étape est faite. Deux propriétés en font un levier :

- **Netteté** — l'agent sait-il distinguer fait de pas fait ? Une borne floue
  (« la situation est comprise ») invite la **fin prématurée** : les étapes
  restantes, visibles, tirent l'attention vers « avoir fini ». La défense se
  prend dans cet ordre : d'abord rendre la borne vérifiable, ce qui ne coûte
  qu'une phrase ; ensuite seulement, si elle reste floue par nature et que la
  hâte est observée, scinder par séquence.
- **Exigence** — ce que le critère demande. « Chaque fichier du diff nommé
  avec son verdict » force un travail que « produire une liste des
  changements » n'exige pas. L'exigence vaut aussi pour une skill faite
  seulement de référence : « chaque règle appliquée » borne une liste plate
  comme « chaque étape faite » borne une séquence.

Le critère le plus fort est à la fois vérifiable et exhaustif. Un critère de
fin vérifiable est aussi la matière naturelle des signes `working_if` d'un
`eval.json` (ADR-0050 D3, proposé).

## Mots-tête pré-entraînés

Un **mot-tête** est un concept compact que le modèle connaît déjà par son
pré-entraînement, et avec lequel l'agent pense pendant qu'il exécute la skill :
« rouge » pour un gate qui échoue, « frontière » pour les décisions dont les
prérequis sont réglés, « sédiment » pour les couches périmées d'un document.
Répété comme un mot, jamais comme une phrase, il ancre toute une zone de
comportement en quelques jetons, parce qu'il recrute un savoir que le modèle
porte déjà.

- **Préférer un mot existant à un mot forgé.** Un néologisme fonctionne s'il
  est défini, mais il ne recrute rien : sa définition se paie en jetons là où
  un mot pré-entraîné est gratuit.
- **Chercher les reformulations à replier.** Une triade réécrite en trois
  endroits, une phrase qui tourne autour d'une idée : chacune réclame un seul
  mot. « Le gate échoue sur le défaut » devient un état binaire : il est
  rouge, ou il ne l'est pas.
- **Double ancrage.** Dans le corps, le mot ramène le même comportement à
  chaque occurrence ; dans un pointeur, s'il est aussi le mot des prompts, de
  la doctrine et du code, il relie la tâche à la skill.
- **Un mot trop faible est un no-op** (voir « Chasse aux no-ops ») : un mot que
  le comportement par défaut satisfait déjà ne change rien ; la correction est
  un mot plus fort, pas une autre technique.

## Têtes de puce

Le premier mot d'une phrase ou d'une puce porte l'information qui permet de
décider, en le lisant seul, si la suite mérite d'être lue. (Ce document
appelait cette discipline « mot-tête » ; le terme désigne désormais le concept
pré-entraîné de la section précédente.) « Le fichier
`eval.json` doit contenir… » oblige à lire jusqu'au verbe pour savoir que
c'est une exigence ; « Exiger un `eval.json` avec… » le dit dès le premier
mot. Cette discipline compte double dans une skill : le lecteur — humain en
revue, agent en exécution — scanne d'abord les têtes de puces pour décider
où ralentir, il ne lit pas linéairement une liste de quinze items.

## Formulation positive

Une skill qui décrit ce qu'il faut **faire** se lit comme une recette :
l'agent suit la forme donnée, il n'a rien à négocier. Une skill qui décrit
surtout ce qu'il ne faut **pas** faire ouvre une négociation implicite —
face à une contrainte concurrente (aller plus vite, produire plus court),
un agent sous pression discute une liste d'interdits plutôt qu'il ne
recopie une forme positive qu'on lui a donnée toute faite. L'interdiction
reste nécessaire pour un vrai garde-fou de sécurité (une action
irréversible, une fuite de donnée) — mais pour façonner la **forme** d'un
résultat plutôt que d'empêcher une transgression ponctuelle, la recette
positive tient mieux qu'une liste de négations.

## Chasse aux no-ops

Une phrase qui ne change le comportement de l'agent sous **aucune**
branche réelle de la tâche est un no-op — elle occupe le budget de lecture
sans jamais influencer une décision. La chasse aux no-ops se fait à la
relecture, phrase par phrase : « si cette phrase disparaissait, quelle
décision de l'agent changerait ? ». Aucune réponse identifiable, la phrase
part. Deux sources fréquentes de no-ops : la reformulation du frontmatter
dans le corps (la description dit déjà ce que fait la skill, la répéter en
prose n'ajoute rien) ; la prudence générique (« veillez à bien vérifier »)
qui ne dit rien de vérifiable. Le no-op se juge par rapport au comportement
par défaut du modèle, pas par rapport au lecteur : un désaccord sur un no-op
est un désaccord sur ce défaut, et il se tranche en exécutant la skill, pas
par la discussion. Une phrase qui échoue au test part entière ; on ne la
raccourcit pas.

## Sédiment

Ajouter une ligne paraît sûr, en retirer une paraît risqué : sans discipline
d'élagage, un document accumule du **sédiment**, des couches périmées qui se
déposent jusqu'à ce qu'il faille creuser pour trouver ce qui vit encore. Une
ligne perd sa pertinence de deux façons : elle n'a jamais pesé sur la tâche
(exposition, branche qui aurait dû partir en référence), ou le comportement ou
le monde qu'elle décrit a changé. Toute modification d'une skill relit donc
chaque ligne de la section touchée sous la question « pèse-t-elle encore sur
ce que fait la skill ? », et la suppression est la réponse par défaut d'une
ligne qui ne la passe pas. Un document court se garde pertinent plus
facilement ; c'est la raison du budget de corps (ADR-0025 D5).

## L'environnement est la source de vérité

Une skill qui recopie un état externe — la liste des workflows d'un dépôt,
la version d'un outil, le contenu d'un fichier de configuration — fige un
instantané qui dérive dès le lendemain, silencieusement : rien ne signale
que la copie a divergé de sa source. La skill interroge l'environnement
réel au moment de l'exécution (une commande, une lecture de fichier, un
appel d'API) plutôt que de porter une liste recopiée. `context-conformity`
applique la règle directement : elle ne porte aucune liste de gates
attendus, elle lit `package.json` `scripts.check` du dépôt cible.

## `user-invoked` vs `model-invoked`, et la règle de non-cascade

Une skill `model-invoked` (par défaut) se charge quand sa description
correspond à la tâche courante — l'agent décide. Une skill `user-invoked`
(`disable-model-invocation: true`) ne se charge que sur demande explicite
de l'utilisateur — l'agent ne décide jamais seul de la déclencher, quel que
soit à quel point le contexte y ressemble.

**Règle de non-cascade : une skill `user-invoked` n'invoque jamais une
autre skill `user-invoked`.** La restriction `disable-model-invocation`
protège une action que l'utilisateur veut explicitement autoriser à chaque
fois (typiquement une action à effet aval — un déploiement, une
publication). Si une skill `user-invoked` A pouvait déclencher une skill
`user-invoked` B en cascade, l'utilisateur qui invoque A explicitement
autoriserait B implicitement, sans l'avoir demandée — la protection de B
s'évapore dès qu'elle a un appelant qui la précède dans la chaîne. Une
skill `model-invoked` peut être invoquée par une autre skill (`model` ou
`user`) sans violer cette règle : c'est justement la classe de skill dont
le déclenchement n'exige pas une demande utilisateur distincte à chaque
fois. `deploy-clever` (`user-invoked`) le respecte : son pré-vol appelle
des commandes (`git status`, `bun run check`, `clever status`,
`gh run list`), jamais une autre skill `user-invoked`.

La règle est vérifiée par `bun run check:skills-cascade` (T3,
`tools/skills/check-skills-cascade.ts`), maillon de `bun run check` : il
refuse qu'une skill `user-invoked` de `skills/` nomme une autre skill
`user-invoked` sous la forme ``Skill tool with "x"``, `/x` ou « invoke the
x skill ». Son corpus est ce dépôt : une skill installée seulement sur une
machine lui échappe, et il le dit dans le volume qu'il imprime.

### Invoquer une autre skill : la formule opérante

Quand une étape a besoin d'une autre skill, elle le dit dans la forme que le
harness exécute, pas en prose : `Call the Skill tool with "<nom>"`. Nommer une
skill dans une phrase (« appliquer la skill X », « lancer `/x` ») ne la charge
pas de façon fiable ; c'est la panne que l'amont a observée et corrigée en
généralisant cette formule. Trois règles l'accompagnent :

- **Une skill par appel.** Une étape qui en demande deux écrit deux appels,
  jamais un appel portant deux noms.
- **Cible `model-invoked` seulement.** Une skill `user-invoked` n'a pas de
  description atteignable par l'agent : aucune autre skill ne peut l'appeler,
  et la formule pointée vers elle est fausse. L'étape dit alors à l'agent de
  demander à l'utilisateur de la lancer (règle de non-cascade ci-dessus).
- **En anglais**, comme le frontmatter (ADR-0025 D6) : la formule nomme un
  outil du harness, pas une phrase du corps.

## Sources

Les idées de ce document ont été dégagées par l'analyse d'un corpus de
conventions d'écriture de skills sous licence MIT observées à l'admission
des six premières skills de cette collection — notamment les conventions de
divulgation progressive, d'optimisation de la découverte (têtes de puce,
formulation orientée déclencheur) et de mise en forme positive vs
prohibitive documentées dans le patron `superpowers:writing-skills`
(licence MIT). Le 2026-10-13, le drill du dépôt amont `mattpocock/skills`
(licence MIT, HEAD `49dd158d`) a fourni les idées des sections sur la
formulation du pointeur, le pointeur dur ou mou, la co-localisation, la
scission par séquence, les critères de fin, les mots-tête pré-entraînés, le
sédiment et la formule d'invocation (sa skill `writing-for-agents`, son ADR
sur les pointeurs de dépendance, son journal de changements). Aucun texte
n'est repris verbatim ; la structure, les exemples et la reformulation sont
propres à ce document et à ce dépôt. Le refus d'une skill d'écriture
(`skills/.out-of-scope/writing-for-agents-as-skill.md`) tient : cette doctrine
reste un document de méthode, pas une skill.
