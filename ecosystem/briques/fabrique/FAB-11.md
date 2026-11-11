# FAB-11 — Fil de mission

## Contexte

I-24, posé par ADR-0022 (D31), interdit de supposer que le propriétaire tient le contenu des documents en mémoire : le contexte se restitue. Le jalon B′ d'ADR-0042 §3 exclut tout fichier de passation hors de l'outil. `ai-work-supervision` rend un rapport de mission pour un lecteur qui n'a pas suivi l'historique. Une session d'agent peut s'y déclarer, et le rapport la présente comme déclarée, non vérifiée. Le module de rendu lu ne porte aucune empreinte du contexte donné à l'agent.

## Ce que la brique ferme

- La mission reconstituée à la main depuis des conversations : le rapport donne la demande, le résultat, les preuves, les décisions et la chronologie (I-24).
- Le renvoi vers un fichier de passation : le fil vit dans l'outil, et le rapport nomme le commit, la preuve et les artefacts par leur empreinte.
- L'écart passé sous silence : le rapport imprime les codes d'écart de son contrat et marque comme simulation une mission du faux agent.

## Ce qu'elle ne fait pas

- Elle ne décide rien. Sans FAB-04, elle n'a ni états ni verdicts à rapporter.
- Elle ne garantit pas l'intégrité des entrées qu'elle lit. Sans PRV-01, sa chronologie n'est pas vérifiable.
- Elle ne dit pas sous quel contexte la session a travaillé : versionner ce contexte est l'objet de HAR-08.

## Mesure

- Preuve citée : le module de rendu du rapport de mission de `ai-work-supervision`, épinglé au commit lu. Il montre qu'un rapport se rend pour un lecteur qui n'a pas suivi l'historique, sans rien ajouter à son contrat JSON. Il ne montre ni la construction de ce rapport, ni le vocabulaire de ses codes d'écart.
- Prochaine preuve : le rapport d'une mission réelle, avec la vérification du journal dont il est tiré.
