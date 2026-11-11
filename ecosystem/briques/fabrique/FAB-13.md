# FAB-13 — Vérificateur de la carte

## Contexte

ADR-0064, proposé, demande par D5 un vérificateur qui lit les fichiers de couche et les fiches, applique la table des dépendances de D1 et imprime ses compteurs. Ce dépôt le porte en deux moitiés : un module pur pour les règles, un script pour les lectures et le code de sortie. Le script ne va pas sur le réseau. Il dérive aussi le catalogue d'ADR-0042 §1 et imprime combien de produits sont en brique. Un workflow dédié l'exécute ; le rendre requis reste un acte du propriétaire. Au 2026-11-11, git ne suit aucun fichier sous `distribution/vision/` : la page vision qu'ADR-0064 D6 demande n'est pas générée dans ce dépôt.

## Ce que la brique ferme

- Le statut saisi à la main : un champ de statut dans un fichier de couche, ou une de ses valeurs écrite dans une fiche ou un champ de texte, fait échouer le gate ; le statut se dérive des preuves (ADR-0064 D4).
- La dépendance hors table : une brique qui dépend d'une couche non admise, d'un produit, d'une brique retirée ou d'elle-même, ou qui est prise dans un cycle, est refusée (ADR-0064 D1).
- La carte que git ne suit pas : les entrées sont lues dans l'index avec leur mode. Un fichier non indexé n'en fait pas partie, un lien symbolique est refusé sans être suivi, et un fichier de la carte ou une cible de preuve dont la copie de travail diffère de l'index est refusé.
- La preuve épinglée que personne ne résout : la citation doit être trouvée, dans le texte brut du fichier de couche, par le lecteur du gate des citations épinglées, dont le périmètre doit lister la carte ; une citation exemptée là-bas n'est pas tenue.
- La citation sans raison lisible : chaque dépendance, chaque invariant et chaque décision du YAML doit être nommé dans le texte lisible de la fiche, hors titres, commentaires et balises.
- Le décompte codé en dur, qu'I-14 exclut : les nombres de briques, de preuves et de produits du catalogue sont dérivés des fichiers à chaque exécution et imprimés.
- La source illisible lue comme vide : un fichier de couche manquant ou illisible est un échec, comme un registre d'invariants, un registre de décisions, un inventaire ou un catalogue lu vide.

## Ce qu'elle ne fait pas

- Elle ne résout pas une preuve épinglée dans un autre dépôt : le gate des citations épinglées le fait. Elle contrôle la forme de la citation, le dépôt porteur et sa visibilité publique.
- Elle ne juge pas qu'un artefact réalise sa brique : une preuve est tenue dès que sa cible est un fichier suivi, régulier et non vide hors de la carte. Elle refuse une date future, pas une date qui ne serait pas celle du commit.
- Elle ne vérifie pas les règles de couche qui portent sur un comportement : elle les imprime comme déclaratives.
- Elle ne refuse pas une brique qu'aucun invariant ne lie : hors de la couche gouvernance, elle la compte et imprime son identifiant.
- Elle ne refuse pas un nombre recopié dans un document.
- Elle ne modifie pas le registre des invariants. Sans GOV-02, elle n'a pas de registre contre lequel refuser un invariant inconnu ou retiré.

## Mesure

- Preuves citées : `ecosystem/check-briques.ts` et `ecosystem/briques.ts`. La première montre la moitié à effets : lecture de l'index, des copies de travail qui en diffèrent, des fichiers de doctrine et de la configuration du gate des citations, puis impression du volume et sortie non nulle sur toute violation. La seconde montre les règles, dont la table des couches ; sa suite de tests, non citée ici, relit cette table depuis le texte d'ADR-0064.
- Limites que le module ou le README de la carte déclarent : une clé écrite deux fois pour une même brique ne provoque pas d'erreur ; seuls les titres en début de ligne sont lus comme des titres ; aucun instrument ne vérifie une release signée, donc celui des statuts d'ADR-0064 D4 qui en demande une ne peut être atteint.
- Aucune des deux ne montre que le gate est requis sur la branche servie.
- Prochaine preuve : le gate rendu requis sur la branche servie par un acte du propriétaire. La page vision générée depuis la carte que ce gate juge existe depuis le 2026-11-11 ; elle est la preuve de PUB-01, pas de cette brique.
