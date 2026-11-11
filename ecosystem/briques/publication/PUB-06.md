# PUB-06 — Voie balisée pour reconstruire

## Contexte

I-20 publie par défaut l'évidence de forge, et ADR-0009 §7 fait de la méthode elle-même la première démonstration publique. Dans `project-governance`, une boucle de reproduction rejoue un adoptant sans assistance : environnement sans identifiant, clone anonyme, installation depuis le lockfile commité, puis chaîne de référence. Chaque passage écrit une attestation et son journal de friction ; le workflow planifié les dépose en résumé d'exécution et en artefact. Le contenu publié est dérivé d'une exécution, pas d'un guide rédigé. La boucle ne reproduit que ce dépôt. Après la migration d'ADR-0020, son étape de validation d'un contrat a été retirée : les vérificateurs de contrats relèvent de l'autorité des contrats.

## Ce que la brique ferme

- Une méthode publiée que nul ne peut reprendre sans aide privée : la boucle tourne dans un environnement sans identifiant.
- Un prérequis implicite ou une étape non documentée : le journal de friction les consigne, même quand le passage réussit.
- Une chaîne de référence qui s'écarte de son évidence publiée : l'empreinte obtenue est comparée à l'empreinte publiée.

## Ce qu'elle ne fait pas

- Elle ne définit ni les contrats ni leurs vecteurs. Sans GOV-07, la voie n'a ni contrat ni vecteur à faire valider par un tiers.
- Elle ne projette pas ses attestations dans les flux. Sans PUB-04, une attestation reste un fichier que seul trouve celui qui sait où chercher.

## Mesure

Preuves citées : `verification/adoption/reproduce.ts` et le workflow planifié `adoption-proof.yml`. Elles montrent le mécanisme : cloner ce dépôt anonymement, l'installer et rejouer sa chaîne de référence sans identifiant. Elles ne montrent la reconstruction ni d'un contrat validé contre ses vecteurs, ni d'un produit. Le répertoire suivi `distribution/evidence/adoption/` porte une attestation datée, celle du 2026-07-24.

Prochaine preuve : une attestation où la boucle valide, depuis un clone anonyme, un contrat de `schemas-and-contracts` contre ses vecteurs.
