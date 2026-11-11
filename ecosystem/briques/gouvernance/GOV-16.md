# GOV-16 — Souveraineté des modèles

## Contexte

ADR-0063, proposé, renvoie l'admission des modèles comme gate (poids ouverts, hébergement dans l'Union, signature) à un ADR candidat distinct. Au 2026-11-11, aucun fichier de `docs/adr` ne porte cet ADR, et le registre des invariants ne dit pas quel modèle un produit peut appeler. La brique écrit la règle visée : inférence sur le poste ou sur un hôte maîtrisé par défaut, fournisseur distant déclaré par produit avec son substitut. C'est une proposition de l'agent, non arbitrée.

## Ce que la brique ferme

Ces fermetures sont celles de la règle proposée ; aucune n'est en vigueur.

- Un modèle entré par défaut dans le plan de données d'un produit sans admission.
- Un contenu d'utilisateur envoyé à un fournisseur distant sans déclaration du produit.
- Un fournisseur de modèles sans substitut nommé.

## Ce qu'elle ne fait pas

- Elle ne tient pas la liste des modèles admis. Sans GOV-04, la règle n'a pas de verdict d'admission à opposer.
- Elle ne recense pas les fournisseurs. Sans GOV-05, elle n'a pas de registre des tiers où inscrire un fournisseur.
- Elle ne sert ni ne route aucun modèle : ces actes relèvent des couches exécution et passerelle.
- Elle ne lie personne tant qu'aucun ADR accepté ne la décide.

## Mesure

Aucune preuve n'est citée, et aucun dépôt porteur n'est déclaré. La règle n'a ni invariant ni ADR accepté.

Prochaine preuve : un ADR accepté fixe la règle, et un gate refuse un produit dont la fiche déclare un appel à un modèle non admis.
