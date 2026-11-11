# PUB-04 — Évidence publique

## Contexte

I-20 publie par défaut l'évidence de forge : rapports signés, journal des verdicts, releases liées à leur évidence. Dans `project-governance`, un générateur projette les sources de `distribution/evidence/` en un journal et deux flux sous `distribution/feeds/`. Le contenu est dérivé du journal d'acceptation des gates, des attestations d'adoption, des rapports de souveraineté et des mesures de couverture. Le journal d'acceptation est lui-même rédigé à la main. Aucun instrument ne lie encore une release à son évidence.

## Ce que la brique ferme

- Une évidence que seul trouve celui qui sait où chercher : chaque nouvel élément entre dans les flux sans geste humain (I-20).
- Un flux édité à la main ou en retard sur ses sources : le contrôle de fraîcheur échoue sur tout écart (I-05).
- Une date fabriquée à la génération : chaque date vient de la source, la régénération se compare octet pour octet.

## Ce qu'elle ne fait pas

- Elle ne produit aucune évidence : journal, manifeste et signature viennent de PRV-01, PRV-02 et PRV-03.
- Elle ne fait pas autorité sur un verdict : la source garde la formulation, le flux porte un état court et un lien.
- Elle ne publie pas le détail exploitable d'une défense quand le propriétaire a décidé l'exception d'I-20.

## Mesure

Preuves citées : le générateur des flux et le workflow qui les régénère et échoue sur un écart. Elles montrent que les flux sont dérivés de leurs sources et tenus à jour. Elles ne montrent ni rapport signé, ni release liée à son évidence.

Prochaine preuve : une release d'un dépôt porteur dont l'entrée de flux pointe vers son manifeste signé.
