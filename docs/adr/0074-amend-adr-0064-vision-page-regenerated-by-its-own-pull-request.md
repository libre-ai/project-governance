<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# ADR-0074 — Amendement d'ADR-0064 D6 : la page vision reste suivie et se régénère par une pull request à part, une fois par lot

- **Statut :** proposé — la fusion de cette pull request vaut signature du propriétaire (ADR-0043).
- **Arbitrage :** Owner-arbitration: 2026-11-23 — deux réponses du propriétaire, en chat, à deux questions structurées à options (ADR-0022/I-24) posées sur la fluidité des fusions de ce dépôt : « Vision hors des PR (Recommandé) », puis « Suivie, régénérée par lot (Recommandé) ». Leurs textes sont cités à la section « Source ».
- **Date de rédaction :** 2026-11-23
- **Portée :** la page vision de ce dépôt (`distribution/vision/index.html`) et le job `vision-page` du workflow `brick-map.yml`. Ne touche ni la carte des briques, ni son vérificateur, ni le générateur, ni la feuille de style.
- **Connexes :** ADR-0064 D6 (la page vision est générée, sous `distribution/vision/`), encore proposé et sans entrée au registre des décisions ; sa conséquence 13, qui décrit le job « régénère et échoue sur un écart » ; ADR-0068 (fusion bornée par un agent), qui n'est pas modifié ; la fiche `ecosystem/briques/publication/PUB-01.md`, dont la preuve cite ce job.
- **Amende :** ADR-0064 D6 et sa conséquence 13 : une pull request ne régénère plus la page ; la page reste un fichier suivi, régénéré par une pull request qui ne change rien d'autre ; le job ne rougit plus sur une page en retard hors de cette pull request. Reste en vigueur : la page est générée, jamais éditée à la main ; aucune page n'est écrite depuis une carte qui a une violation ; `distribution/vision/` ne suit que la page et sa feuille de style.
- **Invariants :** aucun invariant modifié. S'appliquent : I-05 (la projection est l'artefact généré : elle l'est toujours, avec un retard d'au plus un lot) ; I-08 (discipline de preuve : la fiche PUB-01 dit ce que la preuve ne montre plus).

## Vérification empirique

La décision suppose une propriété du checkout d'une pull request dans GitHub Actions : le commit vérifié est le commit de fusion de test, dont le premier parent est la base, si bien que `git diff --name-only HEAD^1 HEAD` liste ce que la pull request change.

- **Prémisse :** le commit de fusion de test d'une pull request a pour parents, dans l'ordre, la base puis la tête de la pull request.
- **Commande :** `m=$(git ls-remote https://github.com/libre-ai/project-governance refs/pull/296/merge | cut -f1); gh api repos/libre-ai/project-governance/commits/$m --jq '[.parents[].sha[0:7]] | join(" ")'`, puis `git ls-remote https://github.com/libre-ai/project-governance refs/pull/296/head`
- **Date de rejeu :** 2026-11-23
- **Sortie attendue :** `034ca75 c961c30` ; la tête de la pull request #296 est `c961c30`, et `034ca75` est un commit de la branche servie (la fusion de #277). La référence de fusion de test est calculée sur la base du moment, qui peut avoir avancé depuis : le premier parent reste un commit de la base.

## Contexte

ADR-0064 D6 veut la page vision générée sous `distribution/vision/`. Le job `vision-page` du workflow `brick-map.yml` la régénère sur chaque pull request et sur chaque tête fusionnée, et échoue sur tout écart avec le fichier suivi. Toute pull request qui change la carte des briques doit donc aussi committer la page régénérée.

Deux propriétés du dépôt se combinent avec cette règle :

- la branche servie exige une pull request à jour (`strict_required_status_checks_policy: true`, lu le 2026-11-23 par `gh api repos/libre-ai/project-governance/rules/branches/migrate/recover-code`) : chaque fusion remet les autres pull requests en retard ;
- la page est un seul fichier généré, que toutes ces pull requests réécrivent.

Mesure du 2026-11-23 : quatre pull requests ouvertes en même temps régénéraient la page (#277, #278, #283, #284). Après la fusion de #277, #284 est entrée en conflit sur `distribution/vision/index.html`, et la résolution a demandé une régénération sur l'arbre fusionné, puis un nouveau passage complet de la CI. Chaque fusion d'une telle pull request oblige à régénérer la suivante à la main.

## Décision

### D1 — La page reste suivie

`distribution/vision/index.html` reste un fichier suivi par git, généré par `distribution/build-vision.ts`, jamais édité à la main. `distribution/vision/` ne suit que la page et sa feuille de style.

### D2 — Une pull request ne régénère pas la page

Une pull request qui change la carte des briques, le générateur ou quoi que ce soit d'autre ne committe pas la page. Sur chaque pull request, le job construit la page (le générateur n'écrit rien depuis une carte qui a une violation) et n'exige pas qu'elle égale le fichier suivi.

### D3 — La régénération est une pull request à part, une fois par lot

La page se régénère par une pull request qui ne change que `distribution/vision/` : `bun run build:vision` sur la base, puis le seul résultat. Le job refuse une pull request qui change la page et autre chose, et refuse une pull request de régénération dont la page diffère de ce que construit la carte. Elle est ouverte après un lot de fusions qui ont changé la carte, et l'agent la prépare. Comme les autres, sa fusion revient au propriétaire.

### D4 — Une page en retard sur la branche servie est un signal

Sur une tête fusionnée, une page en retard sur la carte donne un avertissement du job, pas un échec. Elle appelle la pull request de D3.

## Conséquences

- Les pull requests qui changent la carte ne se disputent plus la page : la classe de conflits décrite au contexte disparaît.
- La page suivie est en retard d'au plus un lot sur la carte. La preuve de PUB-01 ne montre plus qu'à chaque instant la page égale la carte ; la fiche le dit.
- Ce changement ne supprime pas le passage en série imposé par la branche servie : chaque fusion remet toujours les autres pull requests en retard, et chacune repasse sa CI avant de fusionner.
- Les pull requests ouvertes avant cette décision et qui régénèrent la page la portent encore. Après la fusion de celle-ci, elles retirent leur version de la page (restauration du fichier de la base) avant de fusionner.
- Retour arrière : `git revert` du commit de fusion de cette pull request ; le job retrouve la comparaison stricte sur chaque pull request.

## Alternatives rejetées

| Option | Motif |
| --- | --- |
| Page non suivie, déposée en artefact de CI | Rejetée par le propriétaire le 2026-11-23 : la page n'est plus lisible dans l'arbre, et D6 est plus fortement amendé. |
| Page non suivie, publiée par GitHub Pages | Rejetée par le propriétaire le 2026-11-23 : elle ajoute un service hébergé et une permission `pages: write`. |
| File de fusion GitHub (merge queue) | Non retenue à ce stade par le propriétaire : sans la présente décision, les conflits sur la page la cassaient encore. Elle reste possible après. |
| Garder la règle et régénérer à chaque fusion | État antérieur : une régénération à la main par pull request en attente. |

## Source

Décision du propriétaire, en chat, le 2026-11-23, en deux réponses à deux questions structurées à options posées par l'agent qui tient cette pull request. La première question exposait deux causes de lenteur : la branche servie exige une pull request à jour, et la page vision générée est commitée dans les pull requests. Réponse « Vision hors des PR (Recommandé) », dont le texte était :

> La page n'est plus commitée par les PR mais régénérée sur la branche servie après fusion ; la CI de PR vérifie seulement qu'elle se construit. Fait disparaître toute la classe de conflits. Touche `.github/` (chemin gardé) et un ADR, donc ta fusion. Réversible.

La seconde question portait sur le lieu de la page. Réponse « Suivie, régénérée par lot (Recommandé) », dont le texte était :

> Les PR ne touchent plus la page ; leur CI vérifie seulement qu'elle se construit. La dérive sur la branche servie devient un signal, plus un rouge de PR. Une PR de régénération par lot (préparée par l'agent, fusionnée par toi, ajoutable en fin de train). Amendement minimal d'ADR-0064 D6 ; page lisible dans l'arbre ; en retard entre deux lots.

## Vérification

- `git grep -n "ADR-0074" docs/adr/0064-brick-map-eleven-layers-derived-status.md` répond sur la ligne de statut d'ADR-0064.
- `grep -n "^| D122 " docs/decisions/DECISION-REGISTER.md` répond une ligne qui cite ADR-0074.
- Sur une pull request qui ne change pas la page, le job `vision-page` passe et imprime « This pull request does not change the page ». Sur une pull request qui change la page et un autre fichier, il échoue.
