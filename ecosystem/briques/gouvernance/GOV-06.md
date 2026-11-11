# GOV-06 — Conformité déclarée par dépôt

## Contexte

ADR-0020 §2.3, consigné par D29, remplace la discipline de lot par la discipline de fiche. I-08 l'écrit : chaque dépôt produit trace ses phases, ses critères pondérés et ses preuves datées dans `project.v1.yaml`, vérifiée par le gate de flotte de l'autorité de gouvernance. I-15 fait porter l'échelle de preuve par cette fiche, agrégée et vérifiée par la même autorité. I-14 pose que l'inventaire lisible par machine fait foi : les gates y prennent la liste des dépôts. Sans GOV-02, la fiche n'a pas de règle à laquelle se mesurer : I-08 et I-15 sont des lignes du registre. Au 2026-11-11, le schéma `project.v1` n'a aucun champ d'invariant.

## Ce que la brique ferme

- Un avancement saisi à la main : il est calculé depuis les critères acceptés, et un critère accepté porte une preuve datée.
- Une présentation publique qui s'écarte de la fiche : le gate compare la section d'état du README à ce que la fiche génère.
- Une fiche déclarée et absente : c'est un échec, pas un silence.
- Un contexte d'agent qui diverge d'un dépôt à l'autre.

## Ce qu'elle ne fait pas

- Elle ne fixe pas les règles à respecter : c'est GOV-02.
- Elle ne lit pas le contenu d'un dépôt privé depuis un autre dépôt : l'index d'écosystème note qu'aucun jeton de lecture n'est accordé.

## Mesure

Preuves citées. `ecosystem/check-fleet-presentation.ts` lit la fiche de chaque dépôt de l'index qui en déclare une, la valide au schéma et compare le README. `ecosystem/check-context-conformance.ts` vérifie le fichier de contexte d'agent de chaque entrée de l'inventaire. Elles montrent deux conformités mesurées par dépôt. Elles ne montrent pas une conformité par invariant. Une entrée sans fiche déclarée est signalée et sautée.

Prochaine preuve : chaque dépôt déclare sa conformité par invariant dans un fichier typé, et un gate imprime la matrice des dépôts par invariant avec ses échecs nommés.
