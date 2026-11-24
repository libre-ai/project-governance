# Constat de revue : cinq éléments, réfutation avant rapport

## Portée et statut

- **Portée :** ce qui fait un constat dans un rapport de revue d'agent, et la passe de
  réfutation qui le précède. Méthode, pas doctrine : rien ici n'est un invariant, et le
  protocole de revue ([AGENT-REVIEW-PROTOCOL.md](../reviews/AGENT-REVIEW-PROTOCOL.md)) prime
  sur cette note.
- **Origine :** relevé du projet `shirudo-dev/shirudo` du 2026-11-24 (fichiers `AGENTS.md`,
  `.agents/skills/security-audit/SKILL.md`, `.agents/skills/docs/SKILL.md`). Ces formes sont
  reprises et réécrites ; aucun texte n'est copié.
- **Statut :** proposé le 2026-11-24. L'inscription dans la carte d'autorité
  (`docs/README.md`) est une décision de fusion du propriétaire.

## Les cinq éléments d'un constat

Un constat nomme les cinq éléments suivants. S'il en manque un, ce n'est pas un constat.

1. **Qui agit, et ce qu'il contrôle** : une entrée, un fichier, un appel, une commande
   interrompue.
2. **Le contrôle qui devrait l'arrêter** : le garde, la validation ou le test censé
   intervenir, cité par `fichier:ligne`.
3. **La frontière franchie** : la limite que l'action traverse (un périmètre, un droit, un
   état partagé, une donnée qui sort).
4. **L'objectif cassé, ou le bien atteint** : ce que la défaillance empêche, ou ce qui tient
   malgré la tentative.
5. **Le résultat observé**, borné à ce qui a été vu. Une passe qui a lu un extrait ne conclut
   pas à l'absence d'un contrôle situé ailleurs.

## Réfutation avant rapport

Avant qu'un constat entre dans le rapport, la passe le réfute. Les étapes se font dans cet
ordre.

1. **Reformuler en une phrase** portant les cinq éléments. Un élément vague ou absent renvoie
   le constat à la rédaction.
2. **Remonter vers l'entrée** pour chercher un contrôle en amont, et **descendre vers l'effet**
   pour un contrôle en aval. Chaque garde trouvé est cité par `fichier:ligne`, lu pendant cette
   passe. Une page, un nom de test, un sujet de commit ou le souvenir d'une passe précédente ne
   sont pas des preuves.
3. **Faire l'arithmétique d'une borne** avec les limites que le code impose (taille maximale,
   délai, nombre de tours). Une borne se calcule ; elle ne s'estime pas.
4. **Donner le constat à un lecteur qui ne l'a pas trouvé**, avec le code et l'affirmation,
   sans l'argument, pour qu'il cherche à le réfuter. Un constat qui ne tient que par
   l'argument de celui qui l'a trouvé tombe.
5. **Déclarer l'absence de second lecteur.** Si aucun second lecteur n'a tourné, le rapport
   le dit en une ligne.

## Ce qui tombe

Un constat réfuté reste dans le rapport, avec son motif : le contrôle trouvé (`fichier:ligne`),
ou le calcul de la borne. Le retirer en silence fait disparaître la trace de ce qui a été
examiné.

## En-tête du rapport

Le rapport déclare en tête le modèle et le niveau d'effort de la passe, et l'identifiant de
session quand le harnais l'expose. Un modèle plus petit peut localiser du code (trouver un
`fichier:ligne`) ; il ne le juge pas. Un rapport produit par un modèle de localisation ne porte
donc pas de verdict de sécurité ni de correction.

## Articulation avec `skills/review-fanout`

Ce que la note lit dans ce dépôt :

- `skills/review-fanout/SKILL.md` se déclare pointeur : le protocole
  `docs/reviews/AGENT-REVIEW-PROTOCOL.md` reste l'unique autorité, et il se lit en entier avant
  toute passe (lignes 14 et 32).
- Le skill décrit un verdict par passe, une enveloppe `review-verdict.v0.1` prenant exactement
  une valeur parmi `approve`, `approve-with-minor-reservations` et `reject` (ligne 27). Le
  milestone de contrôle humain reste propriétaire (ligne 38).
- Le protocole fixe ce qu'un dossier de revue enregistre : les constats par sévérité
  (bloquant, majeur, mineur, non bloquant) et les risques résiduels (« Attributable review
  record », ligne 28), et une disposition par constat, définie par ADR-0056 (« Disposition of
  each finding », lignes 34 à 36).

Articulation : la sévérité et la disposition disent quoi faire d'un constat ; les cinq éléments
disent ce qui en fait un. Ils s'écrivent à l'intérieur de chaque constat du dossier et ne
remplacent ni l'enveloppe, ni la sévérité, ni la disposition, ni le protocole. Cette note ne
modifie pas `skills/review-fanout`.
