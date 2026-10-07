# Choisir un backend d'isolation pour l'exécution d'outils d'agent

> **Provenance.** Extrait d'un dépôt privé d'expérimentation avant sa
> suppression, le 2026-07-26. Évaluation menée le 20 juillet 2026 ; les
> versions citées sont celles réellement inspectées à cette date. Les résultats
> dépendant d'un contexte étanche non public ont été retirés.

Quand un agent exécute du shell, la seule frontière de sécurité réelle est une
**isolation exécutable**. Une expression régulière sur la commande ou un simple
changement de répertoire courant ne satisfont aucune des exigences ci-dessous —
c'est la conclusion qui a motivé cette évaluation.

## Les huit exigences non négociables

Un backend d'isolation acceptable doit :

1. **échouer fermé** si l'isolation ne démarre pas ;
2. **refuser le réseau par défaut** ;
3. rendre le **répertoire personnel et les credentials hôte illisibles** ;
4. n'autoriser l'écriture que dans une **copie jetable** du workspace ;
5. **ne pas proposer de drapeau de désactivation** dans un mode restrictif ;
6. exposer une **attestation** consommable par la garde de politique ;
7. **tuer les processus et supprimer le workspace** à la fin ;
8. ne **jamais journaliser** commandes, prompts, chemins bruts ou contenu.

Les exigences 1 et 5 sont celles qui éliminent le plus de candidats : beaucoup
d'exemples d'intégration laissent le shell local actif en cas d'erreur
d'initialisation, ou exposent une option de contournement.

## Candidats inspectés

| Backend                                                  | Licence                        | Isolation                                     | Verdict                    |
| -------------------------------------------------------- | ------------------------------ | --------------------------------------------- | -------------------------- |
| Micro-VM locale (QEMU)                                   | Apache-2.0                     | machine virtuelle, système de fichiers invité | **spike technique validé** |
| Bac à sable OS (`sandbox-exec` macOS / bubblewrap Linux) | Apache-2.0                     | profil d'isolation du système d'exploitation  | **repli, à réécrire**      |
| Profil OS invoqué directement                            | composant propriétaire de l'OS | profil OS local                               | **non portable, écarté**   |

### Micro-VM locale — retenue pour le spike

Favorable : machine virtuelle locale et système de fichiers invité hors
montage ; outils de l'agent remplacés via leurs opérations structurées ; aucune
donnée envoyée à un service distant ; licence permissive.

Écarts constatés **dans l'exemple d'intégration fourni**, à corriger avant tout
usage :

- le workspace hôte y est monté **en écriture directe** ;
- aucune politique réseau « refus par défaut » n'y est démontrée ;
- l'installation exige une décision explicite (composant système
  supplémentaire).

Correction appliquée : copier une fixture vers un **workspace jetable** plutôt
que monter le projet de travail.

### Bac à sable OS — repli à réécrire, pas à copier

Favorable : disponible sans composant supplémentaire, licence permissive,
configuration explicite du système de fichiers et du réseau.

**Écarts bloquants de l'exemple fourni** :

- plusieurs domaines réseau autorisés par défaut ;
- une option désactive volontairement l'isolation ;
- une erreur d'initialisation **laisse le shell local actif** — c'est
  exactement l'exigence 1 violée.

Conclusion : l'exemple ne doit pas être copié tel quel. Un repli acceptable
remplace ces comportements par réseau vide, erreur fatale, et aucune
désactivation possible en mode restrictif.

## Grille de souveraineté et de conformité

Trois verdicts séparés, jamais fondus en une note globale.

**PASS** — aucun hyperscaler ni stockage distant ; candidats sous licence
permissive ; aucune donnée personnelle nécessaire ; formats et workspaces
locaux.

**WARN** — points acceptés en connaissance de cause, pas ignorés :

- origine extra-européenne d'un des paquets, même si aucun service distant
  n'est utilisé ;
- l'hyperviseur est un composant système supplémentaire sous licence copyleft,
  mais reste un **exécutable séparé non lié** au paquet ;
- une dépendance transitive sous dédicace au domaine public, acceptée par
  exception explicite épinglée par empreinte (voir
  `DEPENDENCY-LICENCE-AUDIT.md`) ;
- la composition doit garantir que l'extension d'isolation est la **première** à
  enregistrer l'outil shell, l'hôte conservant le premier outil homonyme ;
- un point d'entrée natif du protocole de contrôle **contournait le hook**
  d'interception : le lanceur le refuse désormais en amont. Une exécution
  absolue d'un autre module interne par le propriétaire du compte reste **hors
  modèle de menace** — déclaré, pas résolu.

**FAIL** — l'exemple de repli restait fail-open et permissif en réseau ; le
paquet complet est resté non promouvable tant que la garde sans isolation
échouait.

## Résultats des trois runs de frontières

Ce qui a été **effectivement vérifié**, et qui constitue le protocole minimal à
rejouer pour tout autre backend :

- aucun montage hôte, et un canari déposé sur l'hôte reste **invisible** depuis
  l'invité ;
- les écritures dans l'invité fonctionnent ;
- HTTP et HTTPS **bloqués** ;
- **zéro connexion et zéro octet** vers un serveur TCP hôte contrôlé — mesuré
  côté serveur, pas seulement côté client ;
- résolution de noms synthétique ;
- le délai d'expiration ferme le processus de la machine virtuelle et **rejette
  toute exécution suivante**.

Le canari hôte et le serveur TCP contrôlé sont les deux mesures qui comptent :
elles testent l'isolation **depuis l'extérieur**, là où une vérification menée
uniquement depuis l'invité ne prouverait que ce que l'invité veut bien montrer.

## Gain mesuré, et ce qu'il coûte

Sur la fixture évaluée, déporter la tâche dans l'isolation a réduit le contexte
consommé d'environ un ordre de grandeur (≈ 1 300–1 700 jetons contre ≈ 20 900–21 700
pour le contexte natif). Une paire de runs comparant compaction native et
transfert de contexte donne le même sens : les deux réussissent, le transfert
réduisant fortement contexte, jetons et durée.

Ce gain n'est pas gratuit : il suppose un composant système supplémentaire, une
exception de licence tracée, et une composition dont l'ordre d'enregistrement
est vérifié. **Aucune extension d'isolation n'a été configurée globalement** —
l'usage est resté borné à un répertoire d'expérimentation, avec un lanceur
gardé, un manifeste épinglé par empreinte, le refus des points d'entrée directs
et un rollback obligatoire avant toute mise à jour de l'hôte.

## La conclusion à retenir

> Un sandbox valide ne transforme pas une expression régulière en frontière de
> sécurité.

L'isolation et la classification de risque répondent à deux questions
différentes. L'isolation **contient** l'effet ; la classification **explique**
le risque. Substituer l'une à l'autre — dans un sens comme dans l'autre —
produit une fausse assurance.
