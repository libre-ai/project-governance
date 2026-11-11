# EXE-04 — Services de documents

## Contexte

ADR-0054 décide pour la veille documentaire un parseur exécuté comme processus fils isolé, sur tout système d'exploitation (D85). ADR-0042 demande que les connecteurs appellent en processus séparé les briques compatibles. ADR-0063, proposé, écrit en Rust tout composant qui lit ou transforme du contenu. Le catalogue porte aussi un atelier PDF et OCR et un assistant de réunion, qui ont le même besoin. Cette brique en est la méthode commune, pas l'un de ces produits.

## Ce que la brique ferme

- Le document piégé qui fait tomber ou détourne le service appelant : l'analyse vit dans un processus séparé.
- L'injection par le contenu d'un document : I-32 exige une sortie de quarantaine à vocabulaire fermé.
- Le parseur écrit dans un runtime que la pile ne destine pas au contenu (I-06, ADR-0063 proposé).

## Ce qu'elle ne fait pas

- Elle ne confine pas elle-même : le profil appliqué au processus fils est EXE-01.
- Elle n'interprète pas le document et n'appelle aucun modèle.
- Elle ne conserve rien : rétention et effacement restent au produit appelant.

## Mesure

- Preuve citée : aucune. Le dépôt qui porte le parseur de la veille documentaire n'est pas à l'inventaire de la flotte. Une recherche de code du 2026-11-11 n'a trouvé aucun parseur isolé dans les dépôts publics de l'inventaire.
- Prochaine preuve : un parseur en processus fils dans un dépôt public de la flotte, avec un test où un document malformé rend à l'appelant un code d'échec fermé.
