<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Contribuer à Libre AI

Les règles et outils communs pour vérifier une contribution avant de la partager : versions des outils, licences déclarées, secrets et données personnelles dans les fichiers suivis par Git.

## Essayer les contrôles

Avec la version de Bun indiquée dans `toolchains/` :

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

Les scripts réutilisables sont dans `tools/quality/`. Ils détectent des problèmes définis par leurs règles ; ils ne remplacent pas la revue du code ni des droits de publication.

Le corpus de décisions historiques n'est pas intégralement repris. Les sources importées sont identifiées dans [le relevé de migration](docs/migration/source.json).

[English](README.md)
