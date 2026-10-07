# ADR-0022 — Le contexte se restitue, la décision se présente en options

- **Statut :** accepted — la ratification est le merge propriétaire de cette
  pull request.
- **Arbitrage :** propriétaire, consigne du 2026-08-11 — la directive est
  édictée pour les harness de la flotte et appliquée le même jour aux harness
  machine du propriétaire ; la présente pull request la fait entrer dans la
  doctrine versionnée.
- **Date de rédaction :** 2026-08-11
- **Portée :** protocole d'interaction entre un agent et le propriétaire à
  tout point de décision — restitution du contexte décisionnel, présentation
  des choix, garde-fou de sollicitation. Tout harness opérant sur la flotte
  est concerné (Claude Code, Pi, Codex ou successeur).
- **Étend :** I-17 (surface à touche humaine fermée — le présent protocole
  régit la _forme_ des sollicitations adressées à cette surface, sans
  l'étendre ni la réduire), I-13 (la méthode est le produit zéro — le
  protocole d'interaction en fait partie).
- **N'amende aucun contrat verrouillé.**

## Contexte — l'hypothèse implicite qui produit les recadrages

L'hypothèse implicite d'un agent est que son interlocuteur partage sa mémoire
de travail : qu'il a relu le fichier cité, qu'il se souvient d'une décision
antérieure, qu'il porte le contexte d'un échange passé. Cette hypothèse est
fausse par construction — le propriétaire arbitre de nombreuses sessions et ne
tient aucun contenu de document en mémoire de travail. Elle produit deux
pannes récurrentes, constatées à l'usage :

- **Le renvoi au lieu de la restitution.** « C'est dans le fichier X »,
  « voir la doc », « comme décidé précédemment » obligent le propriétaire à
  rouvrir des sources pour reconstruire un contexte que l'agent avait sous les
  yeux. Le coût de la décision est déplacé vers la partie la plus contrainte.
- **L'hypothèse silencieuse au point de décision.** Devant une ambiguïté
  réelle (périmètre, architecture, dépendance), l'agent choisit une
  interprétation et continue. L'erreur se découvre tard et se recadre cher —
  le recadrage type est une hypothèse d'architecture non validée, interceptée
  après coup au prix d'un volume de session multiplié.

## Décisions

### D1 — L'hypothèse par défaut est corrigée

Le propriétaire ne tient pas le contenu des documents en mémoire de travail.
Un agent ne suppose jamais qu'il a relu un fichier, qu'il se souvient d'une
décision antérieure, ou qu'il a le contexte d'un échange passé.

### D2 — Restituer, ne pas pointer

Quand une information nécessaire à la décision se trouve dans un fichier, un
log, une décision passée ou le code :

- l'agent extrait et présente l'élément inline : extrait court, ou synthèse
  décisionnelle de 2 à 4 lignes (ce qui change la décision), puis la source
  au format `chemin:ligne` ;
- sont interdits sans reproduction de l'élément : « c'est dans le fichier X »,
  « voir la doc », « comme décidé précédemment » ;
- si l'élément est long, la synthèse prime sur le renvoi.

### D3 — Trancher par choix structurés, pas par supposition

À chaque point de décision, au lieu de choisir une hypothèse et de continuer,
l'agent utilise le mécanisme de question interactive de son harness —
`AskUserQuestion` (Claude Code), `ask_question` (Pi), question de
clarification native (Codex) — pour présenter 2 à 4 options mutuellement
exclusives :

- chaque option porte un libellé court et sa conséquence (coût, risque,
  réversibilité, effet aval) ;
- l'option recommandée vient en premier UNIQUEMENT s'il existe une vraie
  recommandation, motivée ;
- une sortie libre (« Autre » / saisie) reste toujours offerte ;
- le contexte nécessaire à la décision est fourni AVANT la question (D2),
  pour que le propriétaire tranche sans rouvrir de fichier.

### D4 — Déclencheurs, et non-déclencheurs

Une question se pose quand :

- choix de périmètre, d'architecture, de dépendance, de réversibilité ;
- ambiguïté sur l'intention, la vérité terrain, ou le critère de réussite ;
- décision à effet aval, coûteuse à défaire, ou touchant la sécurité ou la
  conformité ;
- plusieurs interprétations plausibles de la demande.

Une question ne se pose pas — l'agent décide seul et l'indique d'une ligne —
quand :

- le détail est inférable du contexte ou du code ;
- une convention est déjà établie dans le projet ;
- le choix est trivial, réversible, sans effet aval ;
- la demande est déjà explicite et n'appelle qu'une reformulation.

### D5 — Garde-fou anti-sur-sollicitation

Une question à la fois, ou un lot d'au plus 4 questions étroitement liées.
Au-delà de 3 décisions accumulées, regrouper et prioriser par impact. Aucune
méta-question (« mon plan est-il prêt ? ») : la validation d'un plan passe
par le mécanisme de revue du harness, pas par une question.

## Conséquences

- Le registre des invariants gagne I-24, sourcé par le présent ADR ; le
  registre des décisions gagne D31.
- La directive s'applique à tout harness opérant sur la flotte. Sa
  réplication dans les surfaces d'instructions concrètes (fichiers
  d'instructions machine, `AGENTS.md` là où pertinent) suit le patron de
  `docs/method/DOCTRINE-REPLICATION.md` : une source canonique — le présent
  ADR — et des adaptateurs, jamais des copies éditées à la main.
- Les harness machine du propriétaire portent déjà la directive (application
  du 2026-08-11, hors du périmètre de ce dépôt) ; le présent ADR en devient
  la source canonique.

## Ce qui n'est pas décidé ici

- Aucun gate machine ne vérifie la conformité comportementale à ce
  protocole : c'est une directive d'exécution, pas un contrôle exécutable.
  En établir un serait une mutation de garde-fou — acte propriétaire (I-17).
- La liste exacte des surfaces d'instructions répliquant la directive n'est
  pas figée ici ; chaque dépôt l'adopte lors de sa prochaine passe de
  doctrine.
- Rien n'est changé aux mécanismes de revue et de merge : un merge de
  doctrine reste une signature propriétaire.
