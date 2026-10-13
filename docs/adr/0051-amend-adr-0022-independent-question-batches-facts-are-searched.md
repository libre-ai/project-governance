# ADR-0051 — Amendement d'ADR-0022 : un lot de questions est indépendant, un fait se cherche, une séance d'interview finit sur une frontière vide

- **Statut :** proposed — soumis à la signature du propriétaire ; la fusion de
  cette pull request constituerait l'arbitrage. Rien de ce qui suit n'est en
  vigueur avant elle.
- **Arbitrage :** aucun sur le contenu à la date de rédaction. Les arbitrages
  propriétaires du 2026-10-13 issus du même drill portent sur d'autres objets
  et ne tranchent pas ce texte.
- **Date de rédaction :** 2026-10-13
- **Portée :** forme des sollicitations adressées au propriétaire (ADR-0022),
  en cours de travail et pendant une séance d'interview dédiée.
- **Amende :** ADR-0022 D4 (un complément) et D5 (le critère de lot) ; ajoute
  D6 (fin de séance d'interview). D1, D2 et D3 restent inchangées : canal
  interactif du harness, 2 à 4 options avec conséquences, sortie libre,
  recommandation seulement si elle est réelle.
- **Invariants :** I-24 amendé, texte historique conservé dans la ligne du
  registre (précédent d'I-05, ADR-0031) ; entrée D74 de
  `docs/decisions/DECISION-REGISTER.md`.
- **Source :** drill du dépôt amont `mattpocock/skills` (licence MIT, HEAD
  `49dd158d` relevé le 2026-10-13), skill `grilling`. Idées seulement, aucun
  verbatim.

## Contexte

La skill amont `grilling` mène une séance d'interview par **rondes**. Sa
**frontière** est l'ensemble des décisions dont les prérequis sont déjà
réglés : une ronde pose toute la frontière, et une question dont la réponse
dépend d'une autre question encore ouverte attend la ronde suivante. Un fait
nécessaire à une question se cherche dans l'environnement, par sous-agent s'il
le faut, sans bloquer les questions qui n'en dépendent pas. La séance finit
quand la frontière est vide.

Comparée à ADR-0022, la skill diverge sur le canal, le volume et la clôture, et
ADR-0022 garde ces trois points (D3 tient : les trois harnais de la flotte ont
un outil de question natif). Mais trois mécanismes manquent à ADR-0022, et le
premier y est écrit à l'envers :

1. **D5 regroupe des questions « étroitement liées ».** Deux questions liées
   sont typiquement deux questions dont l'une dépend de l'autre : les poser
   ensemble force le propriétaire à répondre à la seconde sur une hypothèse
   de réponse à la première. Le bon critère de lot est l'**indépendance**.
2. **D4 ne distingue pas un fait d'une décision.** Rien n'interdit de demander
   au propriétaire un fait que l'agent pouvait lire.
3. **Aucun critère de fin de séance.** D5 interdit la méta-question (« mon
   plan est-il prêt ? ») sans dire ce qui la remplace.

Nature du constat : analytique (comparaison de deux textes), pas un échec de
séance daté. Il est rapporté comme tel.

## Décisions proposées

### D4 — complément : un fait se cherche, seule une décision se pose

Quand une question exige un fait de l'environnement (fichier, outil, API,
historique), l'agent le cherche lui-même ou le fait chercher par un sous-agent,
**sans bloquer** : seules les questions qui dépendent de ce fait attendent son
retour, les autres partent. Ne se pose au propriétaire que ce qu'il est seul à
détenir : une décision, une intention, une préférence, un état qu'aucun outil
de la session n'atteint.

### D5 — remplacé : un lot d'au plus 4 questions indépendantes

Une question à la fois, ou un lot d'au plus 4 questions **indépendantes dont
les prérequis sont réglés**. Une question dont la réponse dépend d'une autre
question encore ouverte attend le lot suivant. Au-delà de 3 décisions
accumulées, prioriser par impact ; le plafond de 4 tient même quand la
frontière est plus large, et le reste de la frontière part au lot suivant.
Aucune méta-question.

### D6 — Fin d'une séance d'interview

Une séance d'interview dédiée (mise à l'épreuve d'un plan, cadrage d'une
spécification) est finie quand la **frontière est vide** : chaque branche de
l'arbre de décision a été visitée et rien n'est supposé en silence. Elle se
clôt sans méta-question : l'agent restitue les décisions prises, chacune avec
la réponse qui la fonde, et nomme toute hypothèse restante comme telle. Le
propriétaire corrige s'il le faut ; la restitution n'est pas une demande de
confirmation.

## Conséquences

- I-24 est amendé (D4, D5, D6) ; son texte historique du 2026-08-11 est
  conservé dans la ligne du registre.
- Le registre des décisions gagne D74.
- Toute skill d'interview chargée par un harness de la flotte (amont,
  machine ou de la collection) reste subordonnée à ADR-0022 pour le canal, la
  forme et le plafond. C'est déjà l'effet d'I-24 ; cet amendement ne le crée
  pas, il le rend explicite.
- Les adaptateurs machine qui répliquent ADR-0022 (patron de
  `docs/method/DOCTRINE-REPLICATION.md`) suivent l'amendement à la fusion ;
  leur mise à jour vit hors de ce dépôt.

## Ce qui n'est pas décidé ici

- Aucun gate ne vérifie ce protocole : ADR-0022 l'écartait déjà, en faire un
  serait une mutation de garde-fou (I-17).
- La limite exacte de l'outil de question de chaque harness n'est pas
  mesurée ; le plafond de 4 est une règle de doctrine, pas une contrainte
  d'outil.
