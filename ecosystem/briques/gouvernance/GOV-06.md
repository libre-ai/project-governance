# GOV-06 — Conformité déclarée par dépôt

## Contexte

ADR-0020, consigné par D29, remplace la discipline de lot par la discipline de fiche : chaque dépôt trace ses phases, ses critères pondérés et ses preuves datées dans `project.v1.yaml`. I-08 et I-15 confient la vérification de cette fiche aux gates de flotte de `project-governance`. L'inventaire des dépôts fait foi (I-14). La fiche décrit l'avancement d'un projet. Elle ne déclare pas, invariant par invariant, la conformité du dépôt : ce fichier n'existe pas.

## Ce que la brique ferme

- Un avancement saisi à la main : il est calculé depuis les critères acceptés qui portent une preuve.
- Une présentation publique qui s'écarte de la fiche : le gate compare le README à ce que la fiche génère.
- Un dépôt qui échappe aux contrôles : une fiche déclarée et absente est un échec.
- Un contexte d'agent qui diverge d'un dépôt à l'autre.

## Ce qu'elle ne fait pas

- Elle ne fixe pas les règles à respecter : c'est GOV-02.
- Elle ne lit pas un dépôt privé depuis l'intégration continue, et l'inventaire le dit.
- Elle ne publie pas de matrice : c'est la couche publication.

## Mesure

Preuves citées. `ecosystem/check-fleet-presentation.ts` lit la fiche de chaque dépôt de l'inventaire, la valide au schéma et compare le README. `ecosystem/check-context-conformance.ts` vérifie le fichier de contexte d'agent de chaque dépôt actif. Elles montrent deux conformités mesurées par dépôt, pas une conformité par invariant.

Prochaine preuve : chaque dépôt déclare sa conformité par invariant dans un fichier typé, et un gate imprime la matrice des dépôts par invariant avec ses échecs nommés.
