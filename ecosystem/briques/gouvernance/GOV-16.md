# GOV-16 — Souveraineté des modèles

## Contexte

I-07 fixe la cible d'exécution dans l'Union européenne, chez un hébergeur nommé. ADR-0063 propose Rust partout où du contenu est traité et renvoie l'admission des modèles à un ADR distinct, qui n'est pas écrit. Aucun invariant ne dit quel modèle un produit peut appeler, ni où ce modèle s'exécute. La brique écrit la règle visée : inférence sur le poste ou sur un hôte maîtrisé par défaut, fournisseur distant déclaré par produit. C'est une proposition, que le propriétaire n'a pas arbitrée.

## Ce que la brique ferme

- Un modèle propriétaire entré par défaut dans le plan de données d'un produit.
- Un contenu d'utilisateur envoyé à un fournisseur distant sans déclaration du produit.
- Un fournisseur de modèles sans substitut nommé, donc une dépendance sans sortie.

## Ce qu'elle ne fait pas

- Elle ne tient pas la liste des modèles admis : c'est GOV-04, dont elle dépend.
- Elle ne recense pas les fournisseurs ni leurs substituts : c'est GOV-05.
- Elle ne sert ni ne route aucun modèle : ces actes relèvent des couches exécution et passerelle.
- Elle ne lie personne tant qu'aucun ADR ne la décide.

## Mesure

Preuve citée : aucune. La règle n'a ni invariant propre, ni ADR, ni gate, et aucun dépôt de la flotte ne la porte.

Prochaine preuve : un ADR en vigueur fixe la règle, et un gate refuse un produit dont la fiche déclare un appel à un modèle non admis.
