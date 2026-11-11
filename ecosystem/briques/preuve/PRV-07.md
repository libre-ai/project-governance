# PRV-07 — Modèle de menace par produit

## Contexte

Ce dépôt porte un modèle de menace consolidé, par surface de confiance, avec un registre des risques résiduels. Chaque menace y cite l'invariant qui la porte, ou dit qu'aucun ne la porte. Un gate vérifie que chaque invariant cité existe au registre et n'en est pas retiré. ADR-0049 (D71) a trié les menaces sans invariant : I-36, I-37 et l'élargissement d'I-10 en viennent. Ces invariants couvrent des menaces ; aucun ne demande qu'un modèle de menace existe, et aucun n'est cité ici. Le modèle est écrit par surface : il ne nomme aucun produit du catalogue par son numéro (`grep -cE 'P[0-9]{2}\b' docs/security/THREAT-MODEL.md` : 0, au 2026-11-11).

## Ce que la brique ferme

- La menace rattachée à un invariant inexistant ou retiré : le gate refuse la citation.
- Le document de sécurité hors de vue : tout fichier du périmètre qui cite un invariant doit être déclaré au gate.
- La menace connue sans porteur : elle est écrite comme telle, puis triée par décision (D71).

## Ce qu'elle ne fait pas

- Elle ne tient pas de modèle par produit : cette part du rôle n'a pas de preuve.
- Elle ne juge pas qu'un invariant cité est le bon pour la menace : le gate laisse ce jugement à la revue.
- Elle n'essaie aucune défense : les sondes sont PRV-06.

## Mesure

- Preuves citées : le gate des citations du modèle de menace et le modèle lui-même, dans ce dépôt. Elles montrent un modèle par surface dont les citations d'invariants sont vérifiées.
- Prochain fait observable : le modèle de menace d'un produit du catalogue, déclaré au gate et vert.
