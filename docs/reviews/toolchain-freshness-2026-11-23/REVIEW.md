<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-reservations

# Contrôle de fraîcheur de la toolchain : revue

**Date :** 2026-11-23
**Objet :** la pull request #301, qui ajoute `tools/fleet/check-toolchain-freshness.ts`, le workflow planifié `.github/workflows/toolchain-freshness.yml` et le registre d'exceptions `ecosystem/toolchain-freshness-exceptions.v1.yaml`. Le contrôle compare chaque épinglage de toolchain de ce dépôt à la dernière version publiée en amont.
**Nature :** dossier de revue d'une pull request écrite par un agent, sur la consigne du propriétaire de porter dans la flotte la mesure du retard de sa toolchain (2026-11-23). Cette consigne ne tranche ni l'entrée du registre ni son échéance. Ce dossier rend compte des passes qui ont examiné la pull request ; il n'est pas un arbitrage du propriétaire, et aucun agent n'en écrit.
**Rôle :** deux passes de revue, chacune faite en lecture seule par un sous-agent à contexte neuf, distinct de l'auteur et distinct de l'autre passe. Aucun des deux n'a écrit ce qu'il relit.

## Les passes

| Passe | Commit relu | Base (`git merge-base`) | Verdict |
| --- | --- | --- | --- |
| 1 | `879702ada0ff25ce80ebebf45ec25c4ca6532b51` | `034ca750b5248f0413de32beff07e6a08d38c119` | approuvé avec réserves : deux constats majeurs |
| 2 | `601fbb05d9c09b59246455eccecd75e2830d944c` | `034ca750b5248f0413de32beff07e6a08d38c119` | approuvé avec réserves : un constat majeur |

Le troisième commit, `c8a181b6ab78148562c7fedd26125d76c0c5bd56`, traite les constats de la passe 2. **Aucune passe ne l'a relu.**

## Constats de la passe 1, et leur suite

| Gravité | Constat | Suite |
| --- | --- | --- |
| major | Un épinglage stable au-dessus de la dernière version publiée, ou retiré de l'index crates.io, sortait `up-to-date`. | Corrigé au commit 2 : il sort `unreadable`. Vérifié par la passe 2 sur quatre entrées construites. |
| major | Le contrôle restait rouge tant que Bun est tenu sur sa pré-version, et l'alerte, dédupliquée par titre, ne signalait plus rien après la première issue. | Corrigé au commit 2 par un registre d'exceptions en donnée et un état `held`. Vérifié par la passe 2. Le rouge demeure pour six autres épinglages : voir « Réserves ». |
| minor | Une date de publication future sortait `too-recent`. | Corrigé au commit 2 ; effet de bord relevé par la passe 2, corrigé au commit 3. |
| minor | Le jeton par défaut, lu dans l'environnement, n'était exercé par aucun test. | Corrigé au commit 2, vérifié par la passe 2. |
| minor | La garde de somme de la ligne de volume était inatteignable ; le nombre de sites lus n'était pas imprimé. | Corrigé au commit 2, vérifié par la passe 2. |
| minor | La documentation annonçait la lecture de tous les sites suivis ; plusieurs ne l'étaient pas. | Corrigé au commit 2 : 33 sites déclarés et lus, les autres nommés. Vérifié par la passe 2. |
| minor | Le jeton de l'étape qui lit l'amont pouvait écrire des issues ; checkout sans `persist-credentials: false`. | Corrigé au commit 2 : job de lecture en `contents: read` seul. Vérifié par la passe 2 sur lecture. |

## Constats de la passe 2, et leur suite

| Gravité | Constat | Suite |
| --- | --- | --- |
| major | Les trois conditions du workflow qui portent l'alerte n'étaient verrouillées par aucun test : neutralisées une à une, la suite restait verte. | Traité au commit 3 : la suite évalue ces conditions sur chaque résultat du job de lecture. Non relu. |
| minor | Le jour d'une release Rust, l'épinglage sortait `unreadable` au lieu de `too-recent`. | Traité au commit 3. Non relu. |
| minor | Le registre acceptait des clés inconnues et des clés YAML écrites deux fois, la dernière gagnant. Aucun vert indu n'en découlait. | Traité au commit 3 : registre fermé, lu aussi ligne à ligne. Non relu. |
| minor | `until` n'a pas de plafond. | Non traité : le plafond est un nombre que le propriétaire choisit. La documentation dit qu'il n'y en a pas. |
| minor | Hors crates.io, une pré-version retirée au-dessus de la dernière version sort `up-to-date`. | Documenté au commit 3, comportement inchangé. |

Aucun constat `blocking` dans l'une ou l'autre passe.

## Ce que les passes ont rejoué

- Passe 1 : la suite du contrôle (72 tests au commit 1), une exécution réelle contre l'amont, et trois neutralisations, dont deux survivaient ; ce sont deux des constats ci-dessus.
- Passe 2 : la suite du contrôle (112 tests au commit 2), les deux suites voisines, une exécution réelle contre l'amont, quinze entrées construites pour vérifier les corrections, et six neutralisations, dont trois survivaient ; c'est le constat majeur ci-dessus.
- Les deux passes ont trouvé la sortie réelle identique, ligne à ligne, à celle que la description cite pour le commit relu.

## Réserves

- **L'entrée du registre et son échéance.** Le registre tient Bun à sa pré-version jusqu'au 2026-12-31, motif tiré du `releasePolicy` de `toolchains/bun.json`. La date a été choisie par l'agent orchestrateur pour que le contrôle ne naisse pas rouge sur une tenue déjà décidée. Ce fichier est sur la surface gardée : sa fusion est une décision du propriétaire, qui peut changer la date.
- **Le contrôle sera rouge à son premier run.** Six épinglages sont en retard et aucun n'est tenu. Tant que ce rouge dure, un épinglage de plus qui prend du retard ne produit pas de signal nouveau.
- **Le workflow n'a jamais tourné.** Un `workflow_dispatch` exige le fichier sur la branche servie. Le comportement de `always()` et de `needs.<job>.result` y est inféré de la documentation de la forge, pas mesuré.

## Non relu

- Le commit 3 et ce dossier n'ont été relus par aucune passe.
- Les décomptes de neutralisation annoncés par l'auteur (53, puis 90, puis 16) ne sont pas rejouables : son harnais n'est pas dans le dépôt. Les passes ont fait leurs propres neutralisations.
- `lint`, `tsc` et la suite entière n'ont pas été rejoués par les passes ; leur verdict vient de la CI.
