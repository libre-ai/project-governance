# EXE-01 — Confinement par tâche

## Contexte

ADR-0018 ouvre une première capacité réelle : un processus local confiné, sans réseau ni secret. ADR-0042 place ce confinement dans `execution-sandbox`, après la qualification C0 (D52). Le dépôt porte une bibliothèque Rust : profil, contrôles, politique de chemins, plan de confinement, attestation signée. Au commit cité, l'exécution attestée refuse de démarrer un processus : le moteur n'impose aucun mode réseau du contrat.

## Ce que la brique ferme

- Le confinement affirmé sans être appliqué : un contrôle que l'hôte ne peut pas tenir est un refus, jamais un avertissement.
- Le contenu non fiable lu à côté d'un outil à effet : il est traité dans la tâche confinée (I-32).
- L'observation sans ancre : I-33 n'admet qu'un document signé par la clé liée à l'attestation de harness du run.
- L'écriture hors du périmètre déclaré, installation live comprise (I-38).

## Ce qu'elle ne fait pas

- Elle ne dit pas qui agit : l'identité du run vient d'IDN-04.
- Elle n'ordonne pas les tâches et ne tient aucun budget.
- Elle ne crée ni ne retire l'espace de travail de la mission : c'est EXE-07.
- Elle ne délègue aucune décision au processus confiné.

## Mesure

- Preuves citées : le module de plan de confinement et son test, dans `execution-sandbox`. Ils montrent qu'une prescription sans mécanisme disponible est refusée par un code fermé, pas qu'une tâche a tourné confinée.
- Prochaine preuve : une exécution attestée sur un hôte Linux, dont l'attestation signée énumère les contrôles appliqués, réseau compris.
