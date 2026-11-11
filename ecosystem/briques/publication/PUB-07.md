# PUB-07 — Marque ouverte et vérifiable

## Contexte

I-01 fixe le nom, l'organisation et le domaine canonique. I-29 exige qu'une qualification publique reste adjacente à son mécanisme, sa source, sa date de vérification et sa limite. ADR-0033 donne la sémantique à `project-governance` : `brand/` porte la plateforme verbale, la matrice de preuve et une projection JSON générée depuis elles. La promesse, la table des noms publics et les dates de la matrice sont rédigées, sous arbitrage du propriétaire : seule la projection est dérivée. Le signe figuratif reste candidat (D75).

## Ce que la brique ferme

- Une promesse reformulée par chaque surface : le site et le profil d'organisation ne reçoivent qu'une projection (I-29, I-05).
- Une qualification publiée sans mécanisme, source, date ou limite.
- Un signe figuratif publié avant ses deux contrôles, licence acceptée et similarité archivée.

## Ce qu'elle ne fait pas

- Elle ne crée aucune preuve : l'état d'un produit vient de sa fiche, par PUB-02.
- Elle ne réalise pas le visuel : jetons, géométrie et licence des assets relèvent du design system, PLT-09.
- Elle ne donne à un tiers aucun droit sur le nom au-delà de la référence nominative.

## Mesure

Preuves citées : le générateur de la projection publique et le gate de marque. Ils montrent que la projection correspond à ses sources, que tout produit de l'inventaire figure dans la famille et que les affirmations absolues interdites sont refusées. Ils ne montrent pas qu'une surface publique consomme cette projection à un sha épinglé.

Prochaine preuve : un contrôle qui compare la projection épinglée par `project-website` à celle de ce dépôt.
