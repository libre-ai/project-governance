# FAB-01 — Entrées et triage

## Contexte

I-19 fait entrer les besoins externes par une capture. D52 rattache la fabrique au produit zéro d'I-13 et place Work Supervision dans `ai-work-supervision` (ADR-0042 §1). Le dépôt `.github` porte les formulaires d'issue, typés par une étiquette `kind:*`, et `project-governance` le gate qui valide leur forme. `ai-work-supervision` porte la capture d'une idée, sa qualification, puis sa promotion en mission ou son écartement. Ni ce gate ni ce module, lus le 2026-11-11, ne relient une issue de la forge à une idée de Work Supervision.

## Ce que la brique ferme

- La demande en texte libre que rien ne peut lire : une entrée a un type, et un formulaire qui dérive est refusé.
- L'idée qui se perd : elle est capturée comme idée différée, puis qualifiée par un acteur.
- La confusion entre le déjà fait et le déjà refusé : un écartement nomme son motif dans une liste fermée.

## Ce qu'elle ne fait pas

- Elle ne découpe ni n'ordonne une entrée : c'est FAB-03.
- Elle ne conduit pas le travail : une idée promue devient une mission de FAB-04.
- Elle ne promeut ni n'écarte rien seule. Sans GOV-01, rien ne dit que ces deux actes reviennent au propriétaire : le module les refuse à une session d'agent.

## Mesure

- Preuve locale : `tools/quality/check-issue-forms.ts`. Elle montre qu'un formulaire sans type lisible, ou dont un champ requis a dérivé, est refusé. Elle ne montre pas qu'une issue est triée.
- Preuve épinglée : le module de coordination de `ai-work-supervision`. Il porte les règles de capture, de qualification, de promotion et d'écartement. Il est pur : il rend un événement que l'appelant journalise, sans montrer ce journal. L'acteur y est déclaré, non authentifié.
- Prochaine preuve : une entrée réelle, ouverte par un formulaire, retrouvée dans le journal d'une instance, puis promue ou écartée avec son motif.
