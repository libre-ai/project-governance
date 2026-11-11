# GOV-07 — Contrats canoniques et vecteurs

## Contexte

I-03 sépare deux autorités : la doctrine d'un côté, les contrats canoniques de l'autre. Le dépôt `schemas-and-contracts` porte les schémas, les vecteurs et leur catalogue. D08 pose que ces contrats génèrent et valident les frontières Rust et TypeScript. I-08 fait porter le verrou de spécification des contrats par ce dépôt. ADR-0036 a verrouillé onze familles de contrats (D42), et ADR-0047 un jeu de vecteurs (D69).

## Ce que la brique ferme

- Deux définitions d'une même frontière : I-03 garde la règle « un sujet = une autorité unique ».
- Une copie de contrat éditée à la main chez un consommateur : I-05 en fait une projection vérifiée par gate, jamais canonique.
- Un contrat verrouillé modifié sans signature : I-17 range l'amendement d'un verrou parmi les actes du propriétaire.
- Un évaluateur conforme au schéma et faux sur le sens : les vecteurs d'ADR-0047 lient une demande de décision à la politique de son pas.

## Ce qu'elle ne fait pas

- Elle ne décide pas d'un verrouillage. Sans GOV-01, aucun verrou ne se pose ni ne s'amende : le propriétaire signe.
- Elle n'ouvre aucune capacité d'exécution : D42 écrit que le verrou n'en accorde aucune.
- Elle ne rédige pas les spécifications d'application : c'est GOV-08.

## Mesure

Preuves citées, épinglées à un commit de `schemas-and-contracts`. Le catalogue donne à chaque contrat son chemin, ses propriétaires, ses consommateurs et son état de verrou. Le jeu de vecteurs de liaison de décision est celui que D69 nomme. Elles montrent des contrats et des vecteurs tenus sous verrou. Elles ne montrent pas la génération d'une frontière Rust ou TypeScript depuis un contrat.

Prochaine preuve : une frontière Rust ou TypeScript générée depuis un contrat du catalogue, et un gate qui refuse tout écart entre le fichier généré et le fichier suivi.
