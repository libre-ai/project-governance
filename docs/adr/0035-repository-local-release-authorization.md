# ADR-0035 — Autorisation de release locale au repository

- **Statut :** proposed — direction approuvée par le propriétaire en session le
  2026-09-10 ; le merge signé sous I-17 reste l'acte d'adoption doctrinale.
- **Date :** 2026-09-10
- **Portée :** configuration, provisioning et déploiement des applications de la
  constellation sur Clever Cloud Paris/UE.
- **Amende :** ADR-0001 décision 11, I-07 et la conséquence de D16 relative au
  provisioning.
- **Décision :** D41.

## Contexte

ADR-0001 a différé toute configuration Clever Cloud à la phase globale
d'intégration/déploiement alors envisagée. Le registre a condensé ce report sous
la formule « configuration et provisioning seulement en G4 » dans I-07, et D16
a également reporté le choix et le provisioning du fournisseur OIDC à G4.

ADR-0020 a ensuite remplacé G3, G4 et G5 par l'activation générale
multi-repository, puis a clos le jalon γ sans créer de nouvelle phase centrale.
Chaque repository porte désormais ses phases, critères et preuves dans
`project.v1.yaml`. Le report vers G4 désigne donc une condition qui ne peut plus
survenir : il interdit toute release sans définir le contrôle qui pourrait
l'autoriser.

Le premier cas concret est `website`, une projection statique sans compte,
tracking, donnée personnelle, secret runtime ni add-on. Son déploiement ne doit
ni ouvrir implicitement les capacités d'une application avec état, ni contourner
les contrôles de sécurité et de données qui lui seraient propres.

## Décisions

### D1 — Le repository possède son gate de release

La configuration, le provisioning et le déploiement ne dépendent plus d'une
phase globale. Ils sont autorisables repository par repository, pour une cible
nommée, seulement lorsque l'autorité locale fournit ensemble :

1. un candidat déterministe issu d'un commit immuable ;
2. les gates du repository et les gates de dérive applicables verts ;
3. une sélection explicite de l'environnement par le propriétaire ;
4. un smoke test post-déploiement automatisé ;
5. une révision précédente récupérable ou, pour une première release, une
   procédure d'arrêt démontrée sans domaine canonique attaché.

L'autorisation vaut pour le périmètre prouvé par ces éléments, jamais pour un
autre repository, environnement, service ou add-on.

### D2 — Clever Cloud Paris/UE reste la cible

I-07 conserve Clever Cloud Paris/UE comme cible runtime. Un repository choisit
le runtime Clever Cloud le plus étroit qui réalise sa capacité. Une projection
statique utilise le runtime statique ; elle n'introduit pas un serveur
applicatif pour homogénéiser artificiellement la flotte.

Les identifiants d'organisation et d'application, domaines et secrets restent
des paramètres runtime. Ils ne sont ni devinés, ni journalisés, ni commités.

### D3 — L'identité demeure un contrôle séparé

D16 conserve la frontière OIDC provider-neutre. La disparition de G4 retire
seulement son pointeur temporel mort : sélectionner ou provisionner un
fournisseur OIDC exige les contrôles d'identité, de données, de sécurité et de
release du repository consommateur. Le déploiement d'une surface sans identité
ne sélectionne aucun fournisseur et n'active aucune capacité OIDC.

### D4 — Une release et une adoption doctrinale restent deux actes

Le merge de cet ADR est l'acte propriétaire qui répare la doctrine. Il ne
constitue pas à lui seul une autorisation d'environnement. Chaque release garde
son propre point de contrôle explicite, après preuve verte sur le commit exact.

Une première release est fumée sur l'URL technique Clever Cloud avant toute
bascule du domaine canonique ; un échec arrête l'application. Les releases
suivantes conservent la révision immuable précédente comme cible de rollback.

## Conséquences

- I-07 devient applicable dans la topologie multi-repository actuelle.
- D16 n'attend plus une phase retirée, sans relâcher ses contrôles.
- une application statique et une application manipulant identité ou données ne
  partagent pas artificiellement le même gate ;
- aucun provisioning global, compte, base de données, fournisseur OIDC ou
  secret n'est autorisé par cet ADR ;
- l'état réel d'une release reste porté par le repository qui la produit ;
- un domaine canonique ne pointe jamais vers une première release non fumée.

## Rejeté

### Conserver le texte G4 comme synonyme informel de « plus tard »

Rejeté : un invariant doit être opposable. Une condition définitivement retirée
est un interdit accidentel, pas un gate.

### Autoriser toutes les releases dès que leurs tests sont verts

Rejeté : des tests verts ne sélectionnent ni un environnement, ni une cible
externe, ni un rollback. Cela supprimerait le contrôle propriétaire au lieu de
remplacer le pointeur mort.

### Créer une nouvelle phase de déploiement centrale

Rejeté : ADR-0020 a précisément déplacé l'état et les phases dans chaque
repository. Restaurer un calendrier global recréerait une seconde autorité.

## Retour arrière

Une release applicative revient à sa révision précédente selon la procédure
prouvée par son repository ; cela n'annule pas cet ADR. Réintroduire un gate
central ou changer de cible runtime demande un nouvel ADR et une nouvelle
signature propriétaire.
