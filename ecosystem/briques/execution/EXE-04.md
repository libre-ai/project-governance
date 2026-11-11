# EXE-04 — Services de documents

## Contexte

ADR-0054 §1 décide pour P02, la veille documentaire, un parseur exécuté comme processus fils isolé, sur tout système d'exploitation (D85). ADR-0042 §3 fait des connecteurs des adaptateurs qui appellent en processus séparé des briques compatibles. I-06 réserve Rust aux « moteurs spécialisés », ce qu'est un parseur. ADR-0063, encore proposé, écrirait en Rust tout composant qui lit ou transforme du contenu. Le catalogue d'ADR-0042 §1 porte aussi un atelier PDF et OCR et un assistant de réunion. Faire de cette brique leur méthode commune est une proposition de l'agent, non arbitrée. La brique dépend d'EXE-01 : sans profil de confinement, le processus fils est séparé, pas isolé.

## Ce que la brique ferme

Aucune de ces fermetures n'est réalisée dans un dépôt de l'inventaire.

- Le document piégé qui fait tomber ou détourne le service appelant : l'analyse vit dans un processus séparé.
- Le parseur écrit dans un runtime que la pile ne destine pas aux moteurs spécialisés (I-06).

## Ce qu'elle ne fait pas

- Elle ne confine pas elle-même : le profil appliqué au processus fils est EXE-01.
- Elle ne rend pas fiable le texte qu'elle extrait. I-32, voisin et non cité, traite comme non fiable toute chaîne dérivée d'un contenu non fiable.

## Mesure

- Preuve citée : aucune. ADR-0054 §2 donne à P02 le dépôt dédié `libre-ai/information-watch`, absent de l'inventaire de ce dépôt au 2026-11-11 (`grep -c information-watch ecosystem/repositories.v1.yaml` : 0). Le même ADR relève, à sa date, que le parseur isolé de P02 est dans une pull request brouillon non fusionnée de `personal-knowledge-workspace`.
- Prochaine preuve : un parseur en processus fils dans un dépôt public de la flotte, avec un test où un document malformé rend à l'appelant un code d'échec fermé.
