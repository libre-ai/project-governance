# PRV-07 — Modèle de menace par produit

## Contexte

Ce dépôt porte un modèle de menace consolidé, par surface de confiance, avec un registre des risques résiduels. Chaque menace y cite l'invariant qui la porte, ou dit qu'aucun ne la porte. Un gate vérifie que chaque invariant cité existe au registre et n'en est pas retiré. ADR-0049 a trié les menaces sans invariant : I-36, I-37 et l'élargissement d'I-10 en viennent (D71). Le modèle est écrit par surface, pas par produit, et aucun produit du catalogue n'a le sien.

## Ce que la brique ferme

- La menace rattachée à un invariant inexistant ou retiré : le gate refuse la citation.
- Le document de sécurité hors de vue : tout fichier du périmètre qui cite un invariant doit être déclaré au gate.
- La menace connue sans porteur : elle est écrite comme telle, puis triée par décision (D71).
- L'ouverture d'une vague d'agents sans analyse : I-18 fait du noyau de sécurité une condition d'entrée.

## Ce qu'elle ne fait pas

- Elle ne juge pas qu'un invariant cité est le bon pour la menace : cela reste une affaire de revue.
- Elle n'essaie aucune défense : les sondes sont PRV-06.
- Elle ne porte pas l'état des contrôles du noyau, qui se lit dans sa spécification.

## Mesure

- Preuves citées : le gate des citations du modèle de menace et le modèle lui-même, dans ce dépôt. Elles montrent un modèle par surface dont les citations d'invariants sont vérifiées.
- Prochain fait observable : le modèle de menace d'un produit du catalogue, étendu à ses agents, déclaré au gate et vert.
