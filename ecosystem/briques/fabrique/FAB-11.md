# FAB-11 — Fil de mission

## Contexte

I-24 interdit de supposer que le propriétaire tient le contenu des documents en mémoire : le contexte se restitue. Dans `ai-work-supervision`, chaque entrée du journal qui nomme une mission alimente sa chronologie, et une commande construit un rapport qui se lit seul. Une session d'agent lancée hors de la fabrique peut se déclarer et se rattacher à une mission. Le rendu du rapport lu ne porte aucune empreinte du contexte donné à l'agent.

## Ce que la brique ferme

- La mission reconstituée à la main depuis des conversations : le rapport donne la demande, le résultat, les preuves, les écarts et la chronologie (I-24).
- Le renvoi vers un fichier de passation : le fil vit dans l'outil, et ses textes sont nommés par leur empreinte (I-08).
- L'écart passé sous silence : un critère sans check, un critère non vérifié ou une simulation apparaissent sous un code d'écart fermé.

## Ce qu'elle ne fait pas

- Elle ne décide rien : les états et les verdicts viennent de la mission, FAB-04.
- Elle ne versionne pas le contexte de l'agent : c'est HAR-08, dont elle doit citer l'empreinte.
- Elle ne garantit pas l'intégrité des entrées qu'elle lit : PRV-01 la porte.

## Mesure

- Preuve citée : le module de rendu du rapport de mission de `ai-work-supervision`, épinglé au commit lu. Il montre qu'un rapport se rend pour un lecteur qui n'a pas suivi l'historique, sans rien ajouter à son contrat JSON.
- Prochaine preuve : le rapport d'une mission réelle qui porte l'empreinte du contexte versionné de sa session, avec la vérification du journal dont il est tiré.
