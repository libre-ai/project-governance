# Expand–contract — un refactor large en lots verts

- **Portée :** comment livrer un changement mécanique dont le rayon d'impact
  traverse un dépôt ou la flotte (renommer un symbole partagé, changer le type
  d'un champ, déplacer une surface d'épinglage) sans jamais laisser une branche
  servie rouge entre deux lots. Méthode, pas doctrine.
- **Statut :** proposé le 2026-10-13, en même temps qu'ADR-0050 et ADR-0051.

## Pourquoi pas une tranche verticale

Un changement ordinaire se découpe en tranches verticales, chacune livrable et
verte. Un **refactor large** ne s'y prête pas : une seule édition casse d'un
coup tous les sites d'appel, et aucune tranche ne passe verte seule. Le forcer
en un lot produit une pull request impossible à relire ; le forcer en tranches
produit des lots rouges.

## Les trois temps

1. **Étendre.** Ajouter la forme nouvelle à côté de l'ancienne, sans rien
   retirer. Rien ne casse : les appelants voient encore l'ancienne forme. Ce
   lot est vert par construction et bloque tous les suivants.
2. **Migrer par lots.** Basculer les sites d'appel vers la forme nouvelle par
   lots dimensionnés au rayon d'impact (un paquet, un répertoire, un dépôt de
   la flotte), chacun sa pull request. Chaque lot reste vert parce que
   l'ancienne forme existe encore.
3. **Contracter.** Supprimer l'ancienne forme quand plus aucun appelant ne
   l'emploie, dans un lot bloqué par tous les lots de migration. Le critère de
   fin se mesure, il ne s'affirme pas : un grep de l'ancienne forme sous
   toutes ses écritures rend zéro site, et un second instrument le confirme
   avant toute suppression irréversible.

Quand même les lots de migration ne peuvent pas rester verts seuls, la
séquence se garde, mais les lots partagent une branche d'intégration qui
bloque un dernier lot « intégrer et vérifier » ; le vert n'est promis que là.

## Le cas de la flotte : les générations d'épinglage

`ecosystem/fleet-pins.v1.yaml` applique déjà ce patron aux révisions de
`project-governance` que la flotte épingle :

- **Étendre** : le commit qui porte le gabarit arrive sur la branche servie,
  puis sa génération est déclarée dans le registre ; l'ancienne génération
  reste admise.
- **Migrer** : chaque dépôt consommateur déplace toutes ses surfaces
  d'épinglage dans sa propre pull request, un lot par dépôt
  (`tools/fleet/bump-plan.ts` calcule l'ensemble d'éditions d'un lot).
- **Contracter** : la génération ancienne est retirée du registre quand plus
  aucun consommateur ne la porte.

La **fenêtre de grâce de deux générations** (`ecosystem/check-fleet-pins.ts`)
borne la durée de la migration : un épinglage plus de deux générations derrière
la plus récente fait rougir le gate. C'est la forme mécanique de la règle
« pas de nouvelle extension tant que les lots de la précédente traînent » : le
registre note lui-même qu'aucune génération de plus n'est déclarée tant que des
consommateurs resteraient au-delà de la fenêtre.

## Sources

Idée dégagée le 2026-10-13 du drill du dépôt amont `mattpocock/skills`
(licence MIT, HEAD `49dd158d`), skill `to-tickets`, qui la décrit comme
l'exception au découpage vertical. Aucun texte n'est repris verbatim.
