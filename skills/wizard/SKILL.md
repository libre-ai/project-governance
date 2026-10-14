---
name: wizard
description: Write an interactive bash script that a human runs to perform the steps only they can do — setting GitHub Actions secrets and variables, Clever Cloud environment variables, or dashboard actions — with a confirmation before every write and secret values typed on stdin, never seen by the agent. User-invoked only.
license: Apache-2.0
disable-model-invocation: true
metadata:
  status: candidate
---

<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Assistant de configuration humain (script bash)

`disable-model-invocation: true` : ce skill ne se déclenche que sur demande explicite de l'utilisateur. Il sert quand une étape exige l'humain — une valeur secrète qu'il est seul à détenir, un tableau de bord derrière sa session. L'agent écrit le script ; l'humain le lit, puis l'exécute. L'agent ne l'exécute jamais.

Périmètre : GitHub (secrets et variables Actions, via `gh`) et Clever Cloud (variables d'environnement, via `clever`). Tout autre fournisseur est hors périmètre : le dire, ne pas improviser.

## Ce que l'agent lit, et ce qu'il ne lit jamais

- **Jamais** le contenu d'un fichier `.env` ou `.env.*` (valeurs comprises, même pour « vérifier »). Jamais une valeur secrète demandée dans la conversation.
- Les noms requis, uniquement par leurs références :
  - workflows : `grep -rhoE '\$\{\{ *(secrets|vars)\.[A-Za-z0-9_]+' .github/workflows | sort -u` ;
  - `.env.example`, noms de clés seulement : `grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' .env.example | tr -d =` (si la lecture est refusée par le harness, demander la liste des noms à l'humain).
- Le dépôt et l'application cibles : `gh repo view --json nameWithOwner --jq .nameWithOwner`, `clever applications` (noms seulement). Plusieurs applications Clever : faire choisir, ne jamais supposer.

## Propriétés obligatoires du script

1. `#!/usr/bin/env bash`, `set -euo pipefail`, `umask 077`.
2. **`trap` de nettoyage** sur `EXIT INT TERM` : tout fichier intermédiaire vit dans un répertoire `mktemp -d` que le `trap` retire ; la variable qui a porté une valeur est `unset` après usage.
3. **`confirm` avant chaque écriture** (`gh secret set`, `gh variable set`, `clever env import-vars`, écriture de `.env`) : la question nomme la cible exacte (dépôt ou application, nom de la clé), réponse par défaut **non**.
4. **Secrets par stdin, jamais en argv** (un argument se lit dans la liste des processus) :
   - saisie : `read -r -s -p "<NOM> : " value` ;
   - GitHub : `printf '%s' "$value" | gh secret set "<NOM>" --repo "$repo"` (sans `--body`, `gh` lit stdin) ;
   - Clever Cloud : `NOM="$value" clever env import-vars NOM --app "$app"` (valeur prise dans l'environnement du seul processus fils). **Interdits** : `clever env set` (valeur en argv) et `clever env import` (remplace toutes les variables de l'application).
5. **`.env` local** (seulement si demandé) :
   - garde d'abord : `git check-ignore -q .env || { echo ".env n'est pas ignoré par git : arrêt" >&2; exit 1; }` ;
   - puis `touch .env && chmod 600 .env`, **sans condition**, y compris sur un `.env` existant dont le mode serait plus large ;
   - une clé déjà présente n'est remplacée qu'après `confirm`, via un fichier du répertoire temporaire, suivi d'un nouveau `chmod 600`.
6. **Étape de tableau de bord** : afficher l'URL et l'action attendue, puis `confirm "Fait ?"` ; pas de saisie de valeur dans le terminal pour une action qui se fait dans le navigateur.
7. **Vérification finale par noms seulement** : `gh secret list --repo "$repo"` et, côté Clever, `clever env --app "$app" --format json | jq -r '.[].name'`. Ne jamais afficher une valeur.
8. Chaque étape est rejouable : une étape déjà faite se détecte (nom présent) et se propose en saut, pas en écrasement.

## Remise à l'humain

- Écrire le script hors du dépôt (`mktemp -d`), jamais dans un chemin suivi par git.
- Le passer à `bash -n`, et à `shellcheck` s'il est installé ; rendre la sortie.
- Montrer le script en entier, puis donner la commande exacte : `bash <chemin>`.
- Après exécution, l'humain rapporte le résultat (noms posés, étapes sautées) ; l'agent ne lit pas de fichier produit par le script.

## Provenance

Idée adaptée du skill `wizard` de `mattpocock/skills` (MIT), réécrite : aucun texte ni code du gabarit amont. Écarts corrigés par rapport à l'amont : lecture de `.env` par l'agent, mode d'un `.env` existant conservé, absence de `git check-ignore`, de `trap` et de confirmation avant chaque écriture de secret.
