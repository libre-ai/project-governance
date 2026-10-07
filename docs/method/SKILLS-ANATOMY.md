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

## Mots-tête

Le premier mot d'une phrase ou d'une puce porte l'information qui permet de
décider, en le lisant seul, si la suite mérite d'être lue. « Le fichier
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
qui ne dit rien de vérifiable.

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

## Sources

Les idées de ce document ont été dégagées par l'analyse d'un corpus de
conventions d'écriture de skills sous licence MIT observées à l'admission
des six premières skills de cette collection — notamment les conventions de
divulgation progressive, d'optimisation de la découverte (mots-tête,
formulation orientée déclencheur) et de mise en forme positive vs
prohibitive documentées dans le patron `superpowers:writing-skills`
(licence MIT). Aucun texte n'est repris verbatim ; la structure, les
exemples et la reformulation sont propres à ce document et à ce dépôt.
