# GOV-07 — Contrats canoniques et vecteurs

## Contexte

I-03 sépare deux autorités : la doctrine d'un côté, les contrats canoniques de l'autre. Le dépôt `schemas-and-contracts` porte les schémas, les vecteurs et leur catalogue. D08 pose que ces contrats génèrent et valident les frontières Rust et TypeScript. I-08 fait porter le verrou de spécification des contrats par ce dépôt. ADR-0036 a verrouillé onze familles de contrats (D42), et ADR-0047 un jeu de vecteurs (D69).

## Ce que la brique ferme

- Deux définitions d'une même frontière : I-03 garde la règle « un sujet = une autorité unique », et le catalogue cité donne à chaque contrat un identifiant, un chemin et ses propriétaires.
- Un état de verrou supposé : le catalogue porte l'état de chaque contrat, `locked` ou `candidate`.
- Un évaluateur conforme au schéma et faux sur le sens : les vecteurs d'ADR-0047 donnent, pour une demande de décision et la politique de son pas, le verdict attendu.

## Ce qu'elle ne fait pas

- Elle ne décide pas d'un verrouillage. Sans GOV-01, aucun verrou ne se pose ni ne s'amende : I-17 range l'amendement d'un verrou parmi les actes du propriétaire.
- Elle ne vérifie pas les copies tenues par un consommateur : I-05 en fait des projections vérifiées par gate, jamais éditées à la main, jamais canoniques, et aucune preuve citée ici n'est ce gate.
- Elle n'ouvre aucune capacité d'exécution : D42 écrit que le verrou n'en accorde aucune.
- Elle ne rédige pas les spécifications d'application : c'est GOV-08.

## Mesure

Preuves citées, épinglées à un commit de `schemas-and-contracts`. Le catalogue donne à chaque contrat son chemin, ses propriétaires, ses consommateurs et son état de verrou ; à ce commit, des contrats y sont `locked` et d'autres `candidate`. Le jeu de vecteurs de liaison de décision est celui que D69 nomme : l'empreinte SHA-256 du fichier épinglé commence et finit comme celle que D69 consigne. Elles montrent des contrats catalogués avec leur état de verrou, et un jeu de vecteurs aux octets consignés. Elles ne montrent ni le contrôle qui refuse la modification d'un contrat verrouillé, ni la génération d'une frontière Rust ou TypeScript depuis un contrat, ni un gate de dérive chez un consommateur.

Prochaine preuve : une frontière Rust ou TypeScript générée depuis un contrat du catalogue, et un gate qui refuse tout écart entre le fichier généré et le fichier suivi.
