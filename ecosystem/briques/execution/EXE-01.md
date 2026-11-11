# EXE-01 — Confinement par tâche

## Contexte

ADR-0018 D2 ouvre une première capacité réelle : un processus local confiné par le harness, sans réseau ni secret, qui produit une attestation signée. ADR-0030 (D36) fixe le patron de refus : un profil qui prescrit un contrôle que le moteur ne peut pas tenir est refusé à la résolution, jamais approximé ni attesté. ADR-0042 §1 (D52) promet le confinement dans `execution-sandbox` « quand ses scénarios de qualification C0 passent ». Aucun document de ce dépôt ne consigne que C0 est passée (`grep -rn -w C0 docs`, au 2026-11-11). Le dépôt porteur contient une bibliothèque Rust : profil, contrôles, politique de chemins, plan de confinement, attestation. Aucun invariant du registre ne lie la brique : I-32, I-33 et I-38 portent sur le contexte d'un modèle, l'observation des appels d'outil et l'installation live, et ne sont pas cités. La brique dépend d'IDN-04 : sans identité de run, l'attestation ne dit pas quel agent a tourné.

## Ce que la brique ferme

- Le confinement affirmé sans être appliqué : une prescription que l'hôte ne peut pas tenir est un refus à code fermé, jamais un avertissement.
- L'identité de processus partagée avec l'hôte : le plan refuse `root` comme identité dédiée, et refuse la prescription sans le mécanisme qui change d'identité.

## Ce qu'elle ne fait pas

- Elle ne borne pas l'écriture hors du périmètre déclaré. Au commit cité, le moteur ne borne pas les appels système du worker : le confinement du système de fichiers n'est pas une capacité du moteur (`src/host/run.rs` du dépôt porteur).
- Elle ne tient aucun mode réseau : au même commit, l'exécution attestée refuse de démarrer le processus pour ce motif.
- Elle ne dit pas qui agit : l'identité du run vient d'IDN-04.
- Elle ne crée ni ne retire l'espace de travail de la mission : c'est EXE-07.

## Mesure

- Preuves citées : le module de plan de confinement et son test, dans `execution-sandbox`. Ils montrent qu'une prescription de processus sans mécanisme disponible est refusée par un code fermé. Ils ne montrent pas qu'une tâche a tourné confinée.
- Prochaine preuve : une exécution attestée dont l'attestation signée énumère les contrôles appliqués, système de fichiers et réseau compris.
