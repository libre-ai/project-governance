# PUB-02 — Catalogue à statut dérivé

## Contexte

Le catalogue d'applications est la table d'ADR-0042 §1 (D52). ADR-0064, proposé, garde ce catalogue comme source et fait de la carte sa projection vérifiée ; sa décision D4 dérive le statut d'une brique de ses preuves. I-15 fait porter l'échelle de preuve d'un projet par sa fiche `project.v1.yaml`. Dans `project-governance`, un module calcule l'avancement affiché de chaque dépôt depuis cette fiche, et le profil d'organisation publie la table qui en sort. La fiche elle-même est un fichier saisi dans son dépôt : seul l'avancement en est calculé. Sans GOV-03, la liste n'est pas arrêtée : l'entrée d'un produit, son gel et son retrait sont ses décisions.

## Ce que la brique ferme

- Un avancement déclaré à la main : la projection ne porte que des valeurs calculées, et aucun pourcentage n'y est saisi.
- Un nombre de produits ou de dépôts écrit dans une page : I-14 exclut tout décompte codé en dur.
- Une table publiée qui s'écarte de sa source en silence : I-05 en fait une projection, et le contrôle la compare à un rendu neuf.

## Ce qu'elle ne fait pas

- Elle ne décide ni le gel ni le dégel d'un produit : c'est GOV-03.
- Elle ne publie pas les rapports et les verdicts : c'est PUB-04.

## Mesure

Preuves citées : `ecosystem/render-fleet-status.ts`, qui calcule l'avancement de chaque dépôt depuis sa fiche, et `tools/presentation/check-org-readme-drift.ts`, qui compare le README d'organisation publié à un rendu neuf. Elles montrent que l'avancement est dérivé et qu'un écart est détecté. Elles ne montrent pas que la table publiée est à jour. Relevé du 2026-11-11 par l'API Actions de la forge, workflow `org-readme-drift.yml`, événement `schedule` : les quatre dernières exécutions, du 2026-10-19 au 2026-11-09, sont en échec.

Prochaine preuve : ce contrôle vert sur la branche servie, puis un catalogue par produit généré depuis la carte.
