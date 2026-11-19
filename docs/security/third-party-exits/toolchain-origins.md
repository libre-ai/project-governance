<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Exercice de sortie : origines de la chaîne d'outils

**Statut : procédure proposée (ADR-0070), jamais exécutée.** Elle n'engage personne tant
qu'ADR-0070 n'est pas accepté.

Entrées couvertes : `third-party.origin-rust-toolchain`, `third-party.origin-nodejs`,
`third-party.origin-playwright-cdn`.

**Question posée :** une fois l'origine injoignable, l'outil épinglé s'installe-t-il depuis une
copie détenue par la flotte, à l'identique ?

## Chaîne Rust

`rust-toolchain.toml` épingle le canal, et rustup le télécharge. Que rustup passe par son serveur
de distribution par défaut est **inféré** : le dépôt ne nomme pas ce serveur.

1. Conserver les composants du canal épinglé, cibles et composants de `rust-toolchain.toml` compris.
2. Sur un poste sans cette chaîne, l'installer depuis la copie en orientant rustup vers elle. Le
   réglage à employer se vérifie dans la documentation de rustup au moment de l'exercice.
3. Lancer `cargo build --locked` et comparer `rustc --version` au canal épinglé.

## Node

1. Conserver l'archive nommée par `node.archiveUrl` de `toolchains/notebook-qualification.json`.
2. Vérifier sa copie contre `node.archiveSha256`.
3. Extraire la copie et comparer `node --version` à la version épinglée.

## Navigateurs Playwright

1. Pour chaque moteur de `playwright.engines`, conserver l'archive et la vérifier contre son
   `archiveSha256`.
2. Sur un poste vierge, installer les navigateurs depuis la copie. Le réglage à employer se vérifie
   dans la documentation de Playwright au moment de l'exercice.
3. Comparer le contenu installé à `playwright.browsersJsonSha256` et aux `executables` du fichier.

## Réussite

Chaque outil s'installe sans joindre son origine, et chaque empreinte est égale à celle du dépôt.
Un outil sans copie, ou dont l'installation exige l'origine, est nommé.

## Limites

- L'emplacement des copies est une décision du propriétaire ; ce document n'en désigne aucun.
- `toolchains/notebook-qualification.json` porte ses empreintes pour une plateforme de preuve : une
  autre plateforme demande d'autres archives, à relever pendant l'exercice.

## Enregistrement

Le propriétaire écrit la date dans `last_executed_on` de chaque entrée exercée, dans une pull
request qui cite le relevé de l'exercice.
