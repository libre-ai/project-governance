# GOV-07 — Contrats canoniques et vecteurs

## Contexte

I-03 sépare deux autorités : la doctrine d'un côté, les contrats canoniques de l'autre. Le dépôt `schemas-and-contracts` porte les schémas, les interfaces, les vecteurs et leur catalogue. D08 pose que ces contrats génèrent et valident les frontières Rust et TypeScript. Un verrou de spécification fige des octets relus : ADR-0036 a verrouillé des familles de contrats (D42), ADR-0047 un jeu de vecteurs (D69). La génération d'un contrat depuis un état typé n'existe pas.

## Ce que la brique ferme

- Deux définitions d'une même frontière : un sujet a une seule autorité (I-03).
- Une copie de contrat éditée à la main chez un consommateur : c'est une projection vérifiée par gate (I-05).
- Un contrat verrouillé modifié sans signature : l'amendement d'un verrou est un acte du propriétaire (I-17).
- Un évaluateur conforme au schéma et faux sur le sens : les vecteurs jugent le comportement (ADR-0047).

## Ce qu'elle ne fait pas

- Elle ne décide pas d'un verrouillage : le propriétaire signe (GOV-01).
- Elle n'ouvre aucune capacité d'exécution : ADR-0036 l'exclut.
- Elle ne rédige pas les spécifications d'application : c'est GOV-08.

## Mesure

Preuves citées, épinglées au commit de la branche servie de `schemas-and-contracts`. Le catalogue des contrats donne à chaque entrée son chemin, ses propriétaires et son verrou. Le jeu de vecteurs de liaison de décision est celui qu'ADR-0047 a verrouillé. Elles montrent des contrats et des vecteurs tenus sous verrou, pas leur génération.

Prochaine preuve : un contrat produit par un générateur depuis un état typé, et un gate qui refuse tout écart entre le fichier généré et le fichier suivi.
