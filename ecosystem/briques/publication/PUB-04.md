# PUB-04 — Évidence publique

## Contexte

I-20 publie par défaut l'évidence de forge : rapports signés, journal des verdicts, releases liées à leur évidence. ADR-0009 §7 en est la source. Dans `project-governance`, un générateur projette les sources de `distribution/evidence/` en trois surfaces suivies sous `distribution/feeds/` : un journal en Markdown et deux flux. Le contenu est dérivé du journal d'acceptation des gates, des attestations d'adoption, des rapports de souveraineté et des mesures de couverture. Le journal d'acceptation est lui-même un tableau Markdown, saisi ligne par ligne.

## Ce que la brique ferme

- Une évidence que seul trouve celui qui sait où chercher : chaque nouvel élément entre dans les flux à la régénération (I-20).
- Un flux édité à la main ou en retard sur ses sources : le contrôle de fraîcheur échoue sur tout écart, et I-05 tient le flux pour une projection.
- Une date fabriquée à la génération : chaque date vient de la source, et la régénération se compare au fichier suivi.

## Ce qu'elle ne fait pas

- Elle ne lie pas une release à son évidence. Sans PRV-02, elle n'a pas de manifeste à publier pour cette clause d'I-20.
- Elle ne signe aucun rapport. Sans PRV-03, elle n'a pas de rapport signé à publier.
- Elle ne fait pas autorité sur un verdict : la source garde la formulation, le flux porte un état court et un lien.
- Elle ne publie pas le détail exploitable d'une défense quand le propriétaire a décidé l'exception d'I-20.

## Mesure

Preuves citées : `distribution/build-feeds.ts` et le workflow `feeds-freshness.yml`, qui régénère les flux et échoue sur un écart. Elles montrent que les flux sont dérivés de leurs sources et comparés à chaque pull request. Elles ne montrent ni rapport signé, ni release liée à son évidence.

Prochaine preuve : une release d'un dépôt porteur dont l'entrée de flux pointe vers son manifeste signé.
