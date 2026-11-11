# EXE-05 — Tout en code

## Contexte

I-07 n'autorise une configuration ou un déploiement que « sur un candidat immuable, avec gates locaux et dérives applicables verts » ; ADR-0035 (D41) l'a amendé en ce sens. ADR-0029 §2.4 décrit l'outil de ce dépôt qui compare les checks requis d'une protection de branche à ceux que la CI produit, et son §2.8 interdit de modifier une protection hors de cet outil. ADR-0038 D5 (D44) fait recontrôler un dépôt privé gelé avant sa première exposition ; un programme de ce dépôt en dérive le verdict. I-17 range les « mutations des garde-fous » dans la surface à touche humaine : workflows et protections en sont. Aucun fichier suivi de ce dépôt ne porte `ruleset` dans son nom (`git ls-files | grep -ci ruleset` : 0, au 2026-11-11).

## Ce que la brique ferme

- Le check requis que la CI ne produit plus, ou le check produit que rien n'exige : l'outil compare les deux ensembles, lus l'un et l'autre sur la forge.
- Le contrôle illisible pris pour un contrôle absent : le programme de gel le note nul et en fait un blocage.
- L'état gelé jugé de mémoire : la politique attendue d'un dépôt privé gelé est écrite dans un fichier versionné, clause par clause, et comparée à l'état relu.

## Ce qu'elle ne fait pas

- Elle ne tient en fichiers aucune configuration d'hôte : aucune preuve citée ici ne porte cette part du rôle, ni l'exigence d'I-07.
- Elle ne tient pas en fichier la protection attendue d'une branche : l'outil ne lit aucune déclaration versionnée des checks attendus, il aligne les checks requis sur ceux que la forge rapporte pour un commit.
- Elle n'empêche pas une protection modifiée à la main : ADR-0029 §2.8 l'interdit et fait de l'outil la seule voie autorisée ; l'outil ne verrait qu'un écart entre checks requis et checks produits.
- Elle ne met en fichiers ni identifiant d'hébergement ni secret : ADR-0035 les garde paramètres d'exécution, jamais commités.
- Elle n'élargit pas ce qu'un agent peut modifier : la mutation d'un garde-fou reste à la touche humaine (I-17).
- Elle ne vérifie ni la zone ni le titulaire d'un hôte : c'est EXE-02.
- Elle ne prouve pas que la forge est substituable : c'est GOV-15.

## Mesure

- Preuves citées : l'outil de norme de protection de branche, et le programme qui dérive le verdict de gel d'une relecture du fournisseur. Le premier compare deux états lus, les checks requis par la protection et les checks rapportés sur un commit. Le second juge l'état relu d'un dépôt privé gelé contre une politique attendue écrite en clauses. Ils ne montrent ni configuration d'hôte, ni workflow comparé à une déclaration, ni déclaration des rulesets d'un dépôt en service.
- Prochaine preuve : un fichier versionné qui déclare les rulesets d'un dépôt de la flotte, et un gate qui rougit quand l'état lu en diffère.
