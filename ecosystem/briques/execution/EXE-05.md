# EXE-05 — Tout en code

## Contexte

I-07 n'autorise une configuration ou un déploiement que « sur un candidat immuable, avec gates locaux et dérives applicables verts » ; ADR-0035 (D41) l'a amendé en ce sens. ADR-0029 §2.8 interdit de modifier une protection de branche hors de l'outil versionné de ce dépôt. ADR-0038 D5 (D44) fait recontrôler un dépôt privé gelé avant sa première exposition ; un programme de ce dépôt en dérive le verdict. I-17 range les « mutations des garde-fous » dans la surface à touche humaine : workflows et protections en sont. Aucun fichier suivi de ce dépôt ne porte `ruleset` dans son nom (`git ls-files | grep -ci ruleset` : 0, au 2026-11-11).

## Ce que la brique ferme

- Le check requis que la CI ne produit plus, ou le check produit que rien n'exige : l'outil compare les deux ensembles.
- Le contrôle illisible pris pour un contrôle absent : le programme de gel le note nul et en fait un blocage.
- La protection modifiée à la main : ADR-0029 fait de l'outil la seule surface autorisée.

## Ce qu'elle ne fait pas

- Elle ne tient en fichiers aucune configuration d'hôte : cette part du rôle n'a pas de preuve.
- Elle n'élargit pas ce qu'un agent peut modifier : la mutation d'un garde-fou reste à la touche humaine (I-17).
- Elle ne vérifie ni la zone ni le titulaire d'un hôte : c'est EXE-02.
- Elle ne prouve pas que la forge est substituable : c'est GOV-15.

## Mesure

- Preuves citées : l'outil de norme de protection de branche, et le programme qui dérive le verdict de gel d'une relecture du fournisseur. Le premier compare les checks requis à ceux que la CI produit. Le second juge une politique attendue contre l'état lu d'un dépôt de staging. Ils ne montrent ni configuration d'hôte ni déclaration des rulesets d'un dépôt en service.
- Prochaine preuve : un fichier versionné qui déclare les rulesets d'un dépôt de la flotte, et un gate qui rougit quand l'état lu en diffère.
