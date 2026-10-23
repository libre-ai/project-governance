---
name: deploy-clever
description: Pre-flight checks before deploying an application to Clever Cloud — clean working tree, green quality gates, Clever Cloud app status, GitHub Actions status on the target commit — then the ADR-0035 release conditions and the closure states of each step. User-invoked only; never self-triggered by an agent.
license: Apache-2.0
disable-model-invocation: true
metadata:
  status: candidate
---

<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Déploiement Clever Cloud — pré-vol

`disable-model-invocation: true` : ce skill s'invoque explicitement par l'utilisateur, jamais de la propre initiative d'un agent.

## Ce que ce skill garantit, et ce qu'il ne garantit pas

Ce skill n'applique rien par lui-même : il décrit une procédure que l'agent suit. Ce qui est appliqué par du code l'est par le harnais, la forge ou l'outillage du dépôt cible, et se vérifie là, pas ici.

| Propriété | Appliquée par | Nature |
| --- | --- | --- |
| Le skill ne se déclenche pas seul | le harnais, via `disable-model-invocation: true` | code |
| Les checks requis bloquent le merge | la forge, si le ruleset de la branche servie les exige | code, à vérifier par dépôt |
| Les pré-vols 1 à 4 passent avant `clever deploy` | ce skill | consigne |
| L'environnement est choisi par le propriétaire | ce skill | consigne |
| Le smoke et l'arrêt sur échec | l'outillage du dépôt cible s'il en a un, sinon personne | code ou rien, à lire dans le dépôt |
| Le déploiement reste un acte de l'utilisateur | ce skill | consigne |

Une ligne « consigne » tient tant que l'agent la suit, et rien ne le constate. Si le dépôt cible porte une garde de déploiement (commande dédiée qui vérifie l'arbre, les gates et le smoke), l'utiliser à la place des commandes nues ci-dessous.

## Pré-vol, dans l'ordre

1. `git status --porcelain` — arbre de travail propre exigé. Un résultat non vide arrête ici : rien ne se déploie avec du travail non commité ou non poussé.
2. `bun run check` (ou l'équivalent déclaré par le dépôt cible) — doit sortir vert. Un gate rouge arrête ici.
3. `clever status` — état de l'application Clever Cloud ciblée (déployée, en cours, en échec). Lire l'état avant d'empiler un déploiement sur un échec déjà en place.
4. Statut GitHub Actions sur le commit à déployer : `gh run list --branch <branche> --limit 5` (ou `gh pr checks` si la branche porte une PR) — les workflows requis doivent être verts sur le commit visé, pas seulement sur un ancien commit de la branche.

## États de clôture

Chaque pré-vol et chaque contrôle après déploiement se clôt dans l'un des quatre états de vérification de la flotte, et dans aucun autre :

| État | Quand |
| --- | --- |
| `pass` | la commande a tourné et sa sortie montre le résultat attendu |
| `fail` | la commande a tourné et sa sortie montre un écart |
| `unavailable` | la source n'a pas pu être lue (provider injoignable, sortie illisible, quota) |
| `blocked` | un pré-vol précédent n'est pas `pass` : celui-ci n'a pas été tenté |

Un contrôle sans objet pour ce dépôt est « non requis », hors statut, et se déclare comme tel. Il n'existe pas d'état d'avertissement : un écart toléré est un `fail` que le propriétaire choisit d'accepter, et il le dit.

Une étape ne se clôt que sur un `pass` constaté dans la sortie de la commande. « C'est fait », un code de sortie sans sa sortie, ou un check qui n'a pas tourné ne la ferment pas. `unavailable` et `blocked` ne sont jamais verts.

## Conditions de release (ADR-0035 D1, D4)

Avant de proposer `clever deploy`, les cinq conditions de D1 sont réunies et chacune est montrée :

1. un candidat déterministe issu d'un commit immuable — le sha complet du commit visé ;
2. les gates du dépôt et les gates de dérive applicables verts sur ce sha ;
3. l'environnement sélectionné explicitement par le propriétaire (voir ci-dessous) ;
4. un smoke test post-déploiement automatisé, qui existe déjà dans le dépôt cible ;
5. une révision précédente récupérable ou, pour une première release, une procédure d'arrêt démontrée sans domaine canonique attaché.

Une première release est fumée sur l'URL technique Clever Cloud avant toute bascule du domaine canonique ; un échec arrête l'application (D4). L'autorisation vaut pour ce dépôt, cet environnement et ce sha, jamais pour un autre.

## Approbation

L'approbation est une réponse du propriétaire qui nomme l'environnement et le commit à déployer, donnée après le rapport de pré-vol. Ne sont pas des approbations :

- la réponse à une autre question (« oui » à « tu veux que je lance les tests ? ») ;
- la demande initiale d'invoquer ce skill, qui demande un pré-vol, pas un déploiement ;
- une approbation donnée pour un autre sha, un autre environnement ou avant un pré-vol devenu rouge depuis.

Poser une question au propriétaire n'est pas obtenir son accord : tant que la réponse ne nomme pas l'environnement et le commit, rien ne se déploie.

## Multi-application

Un dépôt peut porter plusieurs applications Clever Cloud (`clever applications`). Préciser l'application ciblée avant `clever status`/`clever deploy` — ne jamais supposer une application par défaut sur un dépôt multi-app.

## Décision

- Les quatre pré-vols à `pass` et les cinq conditions montrées : le déploiement peut être proposé — reste un acte explicite de l'utilisateur (`clever deploy`), jamais lancé par ce skill au-delà du pré-vol.
- Un pré-vol qui n'est pas `pass` : rapporter lequel, son état et sa sortie brute, et s'arrêter — ne jamais contourner un pré-vol pour déployer quand même.

## Compte rendu

Chaque rapport au propriétaire tient en trois rubriques, dans cet ordre :

- **Fait** — chaque étape et son état de clôture, avec la commande qui le reproduit ;
- **Étape suivante** — l'action proposée, une seule ;
- **Ce qu'il te faut** — la décision ou l'information attendue du propriétaire, ou « rien ».

## Après déploiement (si lancé)

- Un smoke test post-déploiement est attendu par la doctrine de flotte (endpoint santé ou script `smoke` du dépôt cible) — le proposer, jamais l'inventer sans vérifier ce que le dépôt expose déjà. Il se clôt comme un pré-vol : un smoke qui n'a pas tourné n'est pas `pass`.
- Échec post-déploiement : rollback via un redeploy Clever Cloud du commit précédent, jamais un force-push pour « annuler ».

## Portée

Clever Cloud et GitHub Actions uniquement. Ce skill ne connaît aucune autre forge ni aucun autre provider CI, et ne remplace ni `bun run check` local ni la revue de code.
