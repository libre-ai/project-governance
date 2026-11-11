# PUB-07 — Marque ouverte et vérifiable

## Contexte

I-01 fixe le nom, l'organisation et le domaine canonique. I-29 exige qu'une qualification publique reste adjacente à son mécanisme, sa source, sa date de vérification et sa limite, et ne fait des surfaces publiques que des projections. ADR-0033, consigné par D39, donne la sémantique à `project-governance` : `brand/` porte la plateforme verbale, la matrice de preuve et une projection JSON générée depuis elles. La promesse et la matrice sont rédigées à la main ; seule la projection est dérivée, et I-05 la tient pour non canonique. D75 fait de l'oiseau de l'avatar le signe figuratif candidat, et consigne comme un écart non régularisé son affichage avant les contrôles de licence et de similarité.

## Ce que la brique ferme

- Une promesse reformulée par chaque surface : ADR-0033 ne fait du site et du profil d'organisation que des consommateurs de la projection.
- Une projection en retard sur ses sources : le gate la compare à un rendu neuf.
- Une affirmation absolue dans la plateforme : le gate refuse une liste fermée de formules.

## Ce qu'elle ne fait pas

- Elle ne réalise pas le visuel : ADR-0033 donne les jetons, la géométrie et la licence des assets à l'autorité visuelle, rangée sous PLT-09.
- Elle ne donne à un tiers aucun droit sur le nom au-delà de la référence nominative (`LICENSING.md`).

## Mesure

Preuves citées : `brand/build-public-projection.ts` et `tools/quality/check-brand-platform.ts`. Elles montrent que la projection correspond à ses sources, que chaque dépôt de l'index qui porte un produit figure dans la famille, et que les formules interdites sont refusées. Le gate vérifie que les gardes de publication du signe sont écrites, pas qu'elles sont tenues : D75 consigne un écart. Elles ne montrent pas qu'une surface publique consomme la projection à un sha épinglé.

Prochaine preuve : un contrôle qui compare la projection épinglée par `project-website` à celle de ce dépôt.
