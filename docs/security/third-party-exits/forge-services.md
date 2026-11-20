<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Exercice de sortie : services de la forge hors git

**Statut : procédure proposée (ADR-0070), jamais exécutée.** Elle n'engage personne tant
qu'ADR-0070 n'est pas accepté. Les commandes viennent de la lecture du dépôt et de l'aide des
outils ; aucune n'a été rejouée comme exercice.

Entrées couvertes : `third-party.forge-github-actions`, `third-party.forge-github-releases`.
La sortie de l'hébergement git lui-même est `verification/sovereignty/forge-restore.ts` (SOV-02).

## GitHub Actions

**Question posée :** sans GitHub Actions, le verdict de la chaîne de contrôle se rend-il encore ?

1. Depuis un clone neuf de la branche servie, sur un poste hors de GitHub Actions, installer le
   Bun épinglé par `toolchains/bun.json` et vérifier son empreinte.
2. Lancer `bun install --frozen-lockfile` puis `bun run check`.
3. Relever les contrôles de `.github/workflows/` qui ne sont pas dans `bun run check` et, pour
   chacun, dire s'il se rejoue hors de GitHub Actions, avec quelle commande.
4. Relever les actions tierces citées par `uses:` et, pour chacune, ce qui la remplace.

**Réussite :** `bun run check` rend son verdict hors de GitHub Actions, et chaque contrôle non
rejouable est nommé. Un contrôle non rejouable n'est pas un échec de l'exercice : c'est son résultat.

**Limite :** l'exercice ne déplace aucune CI et ne nomme aucun service de remplacement (D03).

## GitHub Releases

**Question posée :** sans GitHub Releases, les archives d'outillage épinglées se retrouvent-elles ?

1. Lister les URL d'archives de `toolchains/*.json` servies par `github.com`, avec leur empreinte.
2. Pour chacune, obtenir une copie depuis un emplacement autre que GitHub Releases.
3. Vérifier chaque copie contre l'empreinte épinglée dans `toolchains/`.

**Réussite :** chaque archive a une copie dont l'empreinte est égale à celle du dépôt. Une archive
sans copie est nommée.

**Limite :** l'emplacement de la copie est une décision du propriétaire ; ce document n'en désigne aucun.

## Enregistrement

Le propriétaire écrit la date dans `last_executed_on` de l'entrée, dans une pull request qui cite
le relevé de l'exercice.
