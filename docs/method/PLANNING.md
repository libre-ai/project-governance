# Planification — cible, phases par dépendances, qualité

- **Portée :** la forme sous laquelle un agent rend un plan, quel que soit le
  travail planifié (outillage de ce dépôt, briques, produits) : ce que le plan
  contient, dans quel ordre, et ce qu'il ne contient jamais. Méthode, pas
  doctrine : rien ici n'est un invariant, et un ADR qui tranche autrement
  prime. Toute estimation est hors de cette méthode.
- **Statut :** proposé le 2026-11-17 ; la fusion de la pull request qui
  l'introduit l'inscrit dans la carte d'autorité (`docs/README.md`).

Un plan d'agent se rend en trois rubriques, dans cet ordre : **Cible**,
**Phases**, **Qualité**. Une quatrième, **Dates imposées**, n'existe que si un
humain a fourni une date. L'agent ne produit aucune grandeur de temps : ni
durée, ni date, ni palier temporel, ni répartition du travail sur un
calendrier.

## Cible

La rubrique décrit l'état d'arrivée, pas le chemin :

- les **composants** qui existent à la fin, chacun avec son interface ;
- les **fonctionnalités** qu'ils rendent, dites du point de vue de l'appelant ;
- les **états attendus**, chacun sous une forme qu'un contrôle peut constater
  (un test vert, un fichier présent, une commande qui répond).

Une cible qui ne peut pas être constatée n'est pas une cible : elle se réécrit
jusqu'à ce qu'un contrôle la distingue de son absence.

## Phases

La séquence se dérive **uniquement des dépendances techniques**. Chaque phase
nomme ce qu'elle consomme, sous la forme « A avant B car B consomme A » ;
l'ensemble forme un graphe de tâches, dont l'ordre d'écriture est un parcours.

- Une phase sans dépendance le dit : elle ne consomme rien, et peut ouvrir le
  plan.
- Deux phases qui ne se consomment pas l'une l'autre sont déclarées
  **indépendantes**. Le plan s'arrête à ce constat : il ne dit ni laquelle
  passe la première, ni qu'elles se mènent de front à une période donnée.
- Aucune phase ne porte de durée, d'échéance ni de rang dans un calendrier.
  L'ordre se justifie par ce qui est consommé, jamais par ce qui presse.

Pour un changement mécanique à large rayon, l'ordre des lots suit
`docs/method/EXPAND-CONTRACT.md` : même principe, appliqué à un refactor.

## Qualité

La rubrique énumère les défauts que le plan tient **sans compromis de
vitesse** : tests à côté du code, validation aux frontières de confiance,
gestion d'erreur qui prévient la perte de données, sécurité, et tout ce que
le dépôt cible exige déjà de ses contributions.

- Si un ordre de phases crée un compromis de qualité, l'agent **refuse cet
  ordre** et propose celui qui préserve la qualité, même s'il compte plus de
  phases.
- Un choix d'architecture se juge sur le **mérite technique** — complexité,
  couplage, résilience, sécurité — et jamais sur l'effectif disponible pour le
  réaliser.

## Dates imposées

Une date vient d'un humain (commanditaire, direction), jamais de l'agent.
Quand elle est fournie :

- elle est **enregistrée telle quelle**, citée entre guillemets, mot pour mot ;
- elle est reprise à l'identique partout où le plan s'y réfère ;
- l'agent ne la conteste pas, ne la reformule pas et ne la remplace par aucune
  estimation ; il n'en déduit aucune échéance intermédiaire.

Si l'ordre des phases issu des dépendances paraît incompatible avec la date,
le plan garde cet ordre, cite la date et signale l'incompatibilité : l'arbitrage
revient à l'humain qui a fixé la date.

## Exemple de plan conforme

Le plan ci-dessous est fictif. Sa date l'est aussi : elle figure ici comme une
date qu'un humain aurait fournie.

### Cible

- Un module d'import qui lit un fichier de relevés et rend des enregistrements
  typés ; une entrée invalide est refusée avec la ligne en cause.
- Un magasin qui persiste ces enregistrements ; un second import du même
  fichier ne crée aucun doublon.
- Une commande de synthèse qui lit le magasin ; elle répond sur un magasin
  vide sans erreur.

### Phases

Contrainte reprise sans modification : « mise en service le 15 mars 2031 ».
L'ordre ci-dessous ne la conteste pas et n'en déduit aucune échéance.

1. Schéma des enregistrements : ne consomme rien, il ouvre le plan.
2. Module d'import, après le schéma car il consomme ses types.
3. Magasin, après le schéma car il consomme ses types ; indépendant du module
   d'import.
4. Commande de synthèse, après le magasin car elle consomme son interface de
   lecture.
5. Parcours de bout en bout, en dernier car il consomme les trois composants.

### Qualité

- Chaque composant arrive avec ses tests, dans la même phase que lui.
- L'entrée du module d'import est validée avant toute écriture au magasin.
- Aucune phase n'est avancée devant sa dépendance pour montrer un résultat
  plus tôt.

### Dates imposées

<!-- planning:imposed-date:fictional -->

- Fournie par le commanditaire de l'exemple, citée telle quelle :
  « mise en service le 15 mars 2031 ».

## Exemple de plan refusé

Le bloc balisé ci-dessous réunit ce qu'un plan ne contient pas. Il est le seul
endroit de ce document où ces formes sont écrites.

<!-- planning:anti-example:start -->

```text
Plan
- Court terme : schéma et module d'import, 2 semaines.
- Moyen terme (T2) : magasin, 3 sprints, livré avant le 2031-02-01.
- Long terme : commande de synthèse, prévue pour avril 2031.
- Les tests du magasin sont reportés après la mise en service pour tenir le délai.
- Architecture : un seul module pour tout, car c'est une petite équipe ;
  le nombre de développeurs ne permet pas de séparer le magasin.
```

<!-- planning:anti-example:end -->

Ce plan est refusé pour les raisons suivantes :

- il chiffre des durées que personne n'a fournies ;
- il écrit des dates que l'agent a calculées, sans qu'un humain les ait
  imposées ;
- il range le travail par paliers temporels au lieu de dire ce que chaque
  phase consomme ;
- il justifie un choix d'architecture par l'effectif, et non par le mérite
  technique ;
- il reporte des tests pour gagner du temps : c'est le compromis de qualité
  que la rubrique Qualité interdit.
