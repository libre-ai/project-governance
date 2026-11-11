# GOV-10 — Littératie publique

## Contexte

Le positionnement du site public donne à Libre AI la mission d'aider chacun à comprendre, choisir et utiliser l'intelligence artificielle. I-15 n'ouvre une vitrine qu'à partir d'un fait vérifiable. I-29 exige qu'une qualification publique soit adjacente à son mécanisme, sa source, sa date et sa limite (ADR-0033). `project-governance` porte un lecteur à froid : un modèle sans contexte du projet lit les seules surfaces publiques et répond à une grille versionnée. Aucun parcours d'apprentissage destiné au public n'est publié.

## Ce que la brique ferme

- Une surface publique que seuls ses auteurs comprennent : la lecture revient à un lecteur qui ne partage ni leur contexte ni leur fournisseur.
- Une qualification sans mécanisme ni limite (I-29).
- Une promesse de disponibilité qu'aucune preuve ne porte (I-15).

## Ce qu'elle ne fait pas

- Elle ne construit pas le site : c'est la couche publication, et le site reste une projection (I-05).
- Elle ne forme pas des rôles internes : la flotte n'en a pas (GOV-01).
- Elle ne remplace pas un lecteur humain : la grille mesure la présence d'éléments attendus, pas la compréhension d'une personne.

## Mesure

Preuve citée : `verification/adoption/cold-reader/cold-reader.ts`. Cet outil soumet le README de l'organisation et celui de l'autorité à un modèle sans contexte, puis note ses réponses contre la grille. Sans modèle configuré, il rend un verdict en attente. Il montre que la lisibilité se mesure, pas qu'elle est atteinte.

Prochaine preuve : un verdict du lecteur à froid publié dans l'évidence, avec la grille, le modèle employé et les éléments manquants.
