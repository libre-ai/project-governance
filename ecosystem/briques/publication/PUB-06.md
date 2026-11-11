# PUB-06 — Voie balisée pour reconstruire

## Contexte

I-20 publie par défaut l'évidence de forge, et ADR-0009 §7 fait de la méthode elle-même la première démonstration publique. Dans `project-governance`, une boucle de reproduction rejoue un adoptant sans assistance : environnement sans identifiant, clone anonyme, installation depuis le lockfile commité, puis chaîne de référence. Chaque passage écrit une attestation et son journal de friction ; le workflow planifié les dépose en résumé d'exécution et en artefact. Le contenu publié est dérivé d'une exécution, pas d'un guide rédigé. La boucle ne reproduit que ce dépôt. Après la migration d'ADR-0020, son étape de validation d'un contrat a été retirée : les vérificateurs de contrats relèvent de l'autorité des contrats.

## Ce que la brique ferme

- Une méthode publiée que nul ne peut reprendre sans aide privée : la boucle tourne dans un environnement sans identifiant.
- Un prérequis implicite ou une étape non documentée : le journal de friction les consigne, même quand le passage réussit.
- Une chaîne de référence qui s'écarte de son évidence publiée : l'empreinte obtenue est comparée à l'empreinte publiée.

## Ce qu'elle ne fait pas

- Elle ne valide aucun contrat contre ses vecteurs : l'en-tête de la boucle écrit que cette validation relève du dépôt des contrats, que GOV-07 porte, et qu'elle ne reproduit qu'un dépôt par passage. GOV-07 est une brique voisine, dont la boucle ne dépend pas.
- Elle ne projette pas ses attestations dans les flux : c'est PUB-04, voisine elle aussi, qui lit les attestations suivies. Le workflow ne pousse aucune attestation sur la branche servie : il la dépose en résumé d'exécution et en artefact.
- Elle ne reconstruit aucun produit.

## Mesure

Preuves citées : `verification/adoption/reproduce.ts` et le workflow planifié `adoption-proof.yml`. Elles montrent le mécanisme : cloner ce dépôt anonymement, l'installer et rejouer sa chaîne de référence sans identifiant. Elles ne montrent la reconstruction ni d'un contrat validé contre ses vecteurs, ni d'un produit. Au 2026-11-11, le répertoire suivi `distribution/evidence/adoption/` porte une seule attestation datée, celle du 2026-07-24 : elle atteste la reproduction de `libre-ai/libre-ai`, archivé depuis, par la boucle d'avant la migration, étape de contrat comprise. Aucune attestation suivie ne porte sur ce dépôt.

Prochaine preuve : une attestation où la boucle valide, depuis un clone anonyme, un contrat de `schemas-and-contracts` contre ses vecteurs.
