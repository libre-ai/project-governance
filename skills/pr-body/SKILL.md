---
name: pr-body
description: Write a pull request description in the fleet template format — summary by its smallest visual, before/after evidence, a Door one-way or two-way reversibility declaration, blast radius, plus Second-instrument and Owner-arbitration lines when they apply. Use when opening a pull request or rewriting its description.
license: Apache-2.0
metadata:
  status: candidate
---

<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Corps de pull request (format de flotte)

Le format est celui du gabarit de flotte, `.github/pull_request_template.md` du dépôt `libre-ai/.github`. Le lire au moment d'écrire (`gh api repos/libre-ai/.github/contents/.github/pull_request_template.md --jq .content | base64 -d`), jamais de mémoire : si le gabarit a bougé, c'est lui qui fait foi, pas ce fichier.

## Entrées à résoudre avant d'écrire

1. Branche servie : `git ls-remote --symref origin HEAD`. Jamais `main` supposé.
2. Fichiers touchés : `git diff --name-only origin/<servie>...HEAD`.
3. Preuves déjà produites dans la session : sorties rouges puis vertes des tests ajoutés, sortie brute du check agrégé du dépôt (`package.json` `scripts.check` ou équivalent), lancé **après** `git add`. Une preuve absente se déclare absente ; elle ne se reconstitue pas.

## Sections

- **Summary** — le plus petit visuel qui porte le changement : un tableau avant/après, ou la liste des fichiers qui bougent, ou un seul schéma. Un tableau plutôt qu'un paragraphe.
- **Evidence** — avant/après, par test ajouté : la sortie rouge sur le code non corrigé, puis la verte. La commande qui rejoue chaque chiffre.
- **Door** — une ligne, une valeur :
  - `Door: two-way` si annuler le merge rend l'état antérieur ;
  - `Door: one-way` sinon : suppression de dépôt ou de branche protégée, release ou paquet publié, modification de ruleset, migration de données, force push, message envoyé hors du dépôt. Dans le doute, `one-way`.
- **Blast radius** — qui est atteint : dépôts consommateurs, branches, utilisateurs, flotte entière.
- **Second-instrument** — obligatoire si `one-way` : la mesure indépendante prise avant l'acte, par un instrument **différent** de celui qui a produit le vert (autre API, autre protocole, autre chemin de données), et son résultat. Dire aussi ce que le premier instrument exclut par construction.
- **Owner-arbitration** — voir ci-dessous.

Forme exacte, lue par des gates : chaque clé en début de ligne, hors bloc de code et hors commentaire HTML (`Door: two-way`, `Second-instrument: …`, `Owner-arbitration: 2026-10-13 …`). La ligne non remplie du gabarit (`Door: one-way | two-way`) est refusée par le gate.

## Chemins gardés et `Owner-arbitration:`

Dans `libre-ai/project-governance`, la liste des chemins gardés est `GATED_PATH_PATTERNS` de `tools/quality/check-review-evidence.ts`. La lire **sur la base** (`git show origin/<servie>:tools/quality/check-review-evidence.ts`), jamais la recopier, puis la confronter aux fichiers touchés.

- Un fichier touché correspond : ajouter `Owner-arbitration: <date ISO de l'arbitrage> <où il a été donné>`, ou citer un artefact `docs/reviews/…`. La date est celle d'un arbitrage **réel** du propriétaire dans la session ou un document ; ne jamais en écrire une pour faire passer le gate. Sans arbitrage, s'arrêter et poser la question au propriétaire (choix structuré, contexte restitué).
- Autre dépôt : chercher son équivalent (`grep -rln "Owner-arbitration" tools .github`). Aucun gate : aucune ligne.

## Vérification avant `gh pr create`

Dans `project-governance`, rejouer le gate sur le corps écrit :

```sh
jq -Rs '{pull_request:{number:0,body:.}}' body.md > event.json
GITHUB_EVENT_NAME=pull_request GITHUB_EVENT_PATH=event.json bun tools/quality/check-pr-door.ts
```

Créer la PR avec `--body-file`, jamais en interpolant le corps dans la commande.

## Interdits

- Aucun secret, aucune donnée personnelle, aucun chemin absolu machine-local dans le corps.
- Pas d'appréciation du travail (« propre », « robuste ») : des faits et leurs chiffres.

## Provenance

Idée adaptée du skill `pr` de `mattpocock/skills` (MIT) : porte et rayon d'impact déclarés par l'auteur. Aucun texte repris ; le menu de visuels de l'amont n'est pas repris.
