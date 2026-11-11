# PRV-08 — Coupe-circuit

## Contexte

Aucun invariant du registre ne porte un budget d'erreur par mission (`grep -ciE "budget d.erreur|error budget" docs/decisions/INVARIANTS.md` : 0, au 2026-11-11). La doctrine borne des voisins. ADR-0034 (D40) borne les tentatives d'une étape et exclut les cycles. ADR-0046 (D67) fait tenir par le harness un arrêt typé quand une même action se répète sans progrès. Les plafonds de ressources relèvent de PAS-03. Le budget d'erreur lui-même est une proposition de l'agent, non arbitrée. La brique dépend de PRV-01 : sans journal, l'arrêt ne peut pas être consigné.

## Ce que la brique ferme

Aucune de ces fermetures n'est réalisée : la brique n'a ni dépôt porteur ni preuve.

- La mission qui échoue en boucle sous ses plafonds de ressources : le budget d'erreur l'arrêterait.
- L'alerte que personne ne lit : le dépassement produirait un arrêt consigné au journal, pas un message.

## Ce qu'elle ne fait pas

- Elle ne détecte pas : la détection est PRV-05.
- Elle ne fixe pas les plafonds de ressources : c'est PAS-03.
- Elle ne décide pas du mécanisme d'arrêt : ADR-0046 confie l'arrêt typé au harness, et aucune décision citée ne dit comment arrêter sur un budget d'erreur.

## Mesure

- Preuve citée : aucune.
- Prochain fait observable : une décision du propriétaire sur le budget d'erreur, puis une mission dont les erreurs dépassent un budget déclaré, arrêtée, avec l'arrêt lisible au journal.
