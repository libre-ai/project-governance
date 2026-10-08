<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Contributing to Libre AI

Shared rules and tools for checking contributions before sharing them: tool versions, declared licenses, secrets and personal data in Git-tracked files.

## Run the checks

Use the Bun version specified in `toolchains/`:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

Reusable scripts live in `tools/quality/`. Their checks cover defined patterns; they do not replace code review or publication rights review.

The historical decision corpus has not been imported in full. Imported sources are recorded in the [migration record](docs/migration/source.json).

[Français](README.fr.md)

[Install and verify a local repository composition](docs/LOCAL-COMPOSITION.md).

## Product direction and consolidation

[Vision](VISION.md) · [Consolidation decision](docs/adr/2026-09-29-portfolio-consolidation.md) · [Forge design](docs/architecture/forge/README.md)

These documents distinguish accepted direction, design candidates and capabilities still awaiting qualification. Historical authorities remain available during admission.

## Project status

<!-- libre-ai:project-status:begin -->
<!-- Section générée depuis project.v1.yaml — ne pas éditer à la main. -->

- Situation actuelle : Autorité de doctrine et d'outillage de flotte depuis le transfert tracé du 2026-10-07, qui exécute la direction propriétaire du 2026-09-29 : doctrine (41 ADR, LEXICON, registres d'invariants et de décisions), gates d'écosystème, workflows réutilisables et gate de composition multi-dépôts. L'inventaire déclare les 24 dépôts cibles ; le gate de dérive reste rouge tant que les 34 donneurs aux noms courts sont observables, et passera au vert à leur retrait. Le corpus historique de `governance` (docs/reviews, la majorité de docs/superpowers) reste dans l'archive vérifiée, non déclaré supersédé.
- Maturité : usable
- Exposition : usable-verifiable
- Confiance : medium
- Preuves vérifiées le : 2026-09-09
- Avancement : 33,3 % du périmètre actuellement déclaré

<!-- libre-ai:project-status:end -->
