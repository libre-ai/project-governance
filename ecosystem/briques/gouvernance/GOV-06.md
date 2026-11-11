# GOV-06 — Conformité déclarée par dépôt

## Contexte

ADR-0020 §2.3, consigné par D29, remplace la discipline de lot par la discipline de fiche. I-08 l'écrit : chaque dépôt produit trace ses phases, ses critères pondérés et ses preuves datées dans `project.v1.yaml`, vérifiée par le gate de flotte de l'autorité de gouvernance. I-15 fait porter l'échelle de preuve par cette fiche, agrégée et vérifiée par la même autorité. I-14 pose que l'inventaire lisible par machine fait foi : les deux gates cités y prennent la liste des dépôts. Sans GOV-02, la brique ne peut pas nommer un écart : un écart se mesure à une règle, et les règles, I-08 et I-15 compris, sont des lignes du registre que GOV-02 tient. Au 2026-11-11, le schéma `project.v1` n'a aucun champ d'invariant.

## Ce que la brique ferme

- Un avancement saisi à la main : le schéma de fiche n'a pas de champ de pourcentage, et le gate invalide une fiche dont un critère accepté n'a pas de preuve datée, ou dont une preuve porte une date future.
- Une présentation publique qui s'écarte de la fiche : le gate compare la section d'état du README à ce que la fiche génère.
- Une fiche déclarée et absente : c'est un échec, pas un silence.
- Un contexte d'agent qui s'écarte du gabarit de sa couche : le gate de contexte vérifie les sections requises, le plafond de lignes, le lien vers une autorité, le marqueur de couche et l'adaptateur `CLAUDE.md`.

## Ce qu'elle ne fait pas

- Elle ne fixe pas les règles à respecter : c'est GOV-02.
- Elle ne mesure pas la conformité d'un dépôt à un invariant donné : aucune des deux preuves citées ne lit le registre des invariants.
- Elle ne lit pas le contenu d'un dépôt privé depuis un autre dépôt : le gate de contexte exempte une entrée privée, avec la note qu'aucun jeton de lecture entre dépôts n'est accordé.

## Mesure

Preuves citées. `ecosystem/check-fleet-presentation.ts` lit, sur la branche par défaut de chaque dépôt de l'index qui déclare une fiche, cette fiche et le README ; il valide la fiche au schéma et compare le README. Une entrée sans fiche déclarée est signalée et sautée. `ecosystem/check-context-conformance.ts` vérifie le fichier de contexte d'agent de chaque entrée de l'inventaire ; il exempte, en le disant, les entrées privées, les entrées archivées et le profil d'organisation. Elles montrent deux conformités mesurées par dépôt : celle de la fiche d'état et celle du contexte d'agent. Elles ne montrent pas une conformité par invariant, ni un dépôt qui déclare ses écarts.

Prochaine preuve : chaque dépôt déclare sa conformité par invariant dans un fichier typé, et un gate imprime la matrice des dépôts par invariant avec ses échecs nommés.
