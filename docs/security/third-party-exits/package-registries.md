<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Exercice de sortie : registres de paquets

**Statut : procédure proposée (ADR-0070), jamais exécutée.** Elle n'engage personne tant
qu'ADR-0070 n'est pas accepté. Les options citées ont été lues dans l'aide des outils
(`bun install --help`, `cargo vendor --help`, `uv run --help`) ; leur effet combiné n'a pas été rejoué.

Entrées couvertes : `third-party.registry-npm`, `third-party.registry-crates-io`,
`third-party.registry-pypi`.

**Question posée :** une fois le registre injoignable, les dépendances verrouillées du dépôt
s'installent-elles depuis une copie détenue par la flotte, avec les mêmes empreintes ?

Chaque exercice part d'un clone neuf de la branche servie, dans un répertoire temporaire.

## npm

1. Remplir un cache vierge : `bun install --frozen-lockfile --cache-dir=<cache>`.
2. Dans un second clone neuf, couper l'accès au registre en désignant une adresse injoignable :
   `bun install --frozen-lockfile --cache-dir=<cache> --registry=<adresse injoignable>`.
3. Lancer `bun run typecheck`.

## crates.io

1. Copier les sources verrouillées : `cargo vendor --locked <copie>`.
2. Dans un second clone neuf, déclarer `<copie>` comme source de remplacement dans une
   configuration Cargo hors du dépôt, puis lancer `cargo build --frozen`.
3. La crate tirée d'un dépôt git par `Cargo.lock` suit le même chemin, et le relevé la nomme.

## Index Python

1. Remplir un cache vierge : `uv run --cache-dir <cache> --no-project --with-requirements tools/licensing/requirements.txt reuse --version`.
2. Rejouer la même commande avec `--offline`.

## Réussite

Les trois installations aboutissent sans joindre le registre, sans modifier `bun.lock` ni
`Cargo.lock`, et `git status --short` reste vide. Un paquet introuvable dans la copie est nommé.

## Limites

- L'exercice prouve qu'une copie suffit à reconstruire ; il ne désigne ni miroir ni fournisseur de
  remplacement.
- Il ne porte que sur les fichiers de verrouillage du dépôt où il tourne, pas sur ceux de la flotte.

## Enregistrement

Le propriétaire écrit la date dans `last_executed_on` de chaque entrée exercée, dans une pull
request qui cite le relevé de l'exercice.
