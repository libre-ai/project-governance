# PRV-08 — Coupe-circuit

## Contexte

Aucun invariant ne porte un budget d'erreur par mission. La doctrine borne déjà des voisins. ADR-0034 borne les tentatives d'une étape et refuse les cycles (D40). ADR-0046 fait tenir par le harness un arrêt typé quand une même action se répète sans progrès (D67). Les plafonds de jetons et d'énergie relèvent de PAS-03. Il manque la borne sur les erreurs elles-mêmes : rien n'arrête une mission dont les échecs s'accumulent ou se propagent.

## Ce que la brique ferme

- La mission qui échoue en boucle sous ses plafonds de ressources : le budget d'erreur l'arrête.
- La panne en cascade : une brique en échec cesse d'être appelée au lieu d'entraîner celles qui en dépendent.
- L'alerte que personne ne lit : le dépassement produit un arrêt consigné au journal, pas un message.
- L'agent arrêté qui agit encore : l'arrêt passe par la révocation par agent d'I-18.

## Ce qu'elle ne fait pas

- Elle ne détecte pas : elle compte ce que PRV-05 et le journal PRV-01 lui donnent.
- Elle ne modifie ni le plan ni les capacités d'une mission (I-33).
- Elle ne fixe pas les plafonds de ressources : c'est PAS-03.
- Elle ne relance rien : la reprise est une décision.

## Mesure

- Preuve citée : aucune. Aucun dépôt de la flotte ne porte de budget d'erreur ni d'arrêt sur son dépassement.
- Prochain fait observable : une mission dont les erreurs dépassent un budget déclaré, arrêtée par révocation, avec l'arrêt lisible au journal.
