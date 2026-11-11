# EXE-05 — Tout en code

## Contexte

I-07 n'autorise un déploiement que sur un candidat immuable, gates verts. I-12 garde la forge canonique sans dépendance de données irréversible. ADR-0029 interdit de modifier une protection de branche hors de l'outil versionné de ce dépôt. ADR-0038 a fait écrire en code la politique attendue d'un dépôt gelé avant sa publication. Les rulesets vivent chez le fournisseur : aucun fichier de ce dépôt ne les déclare.

## Ce que la brique ferme

- L'état d'un hôte ou de la forge qui n'existe que dans une console.
- Le check requis que la CI ne produit plus, ou le check produit que rien n'exige : l'outil compare les deux ensembles.
- Le contrôle illisible pris pour un contrôle absent : la relecture le note nul et en fait un blocage.

## Ce qu'elle ne fait pas

- Elle n'applique aucun ruleset : cet acte reste au propriétaire (I-17).
- Elle ne vérifie ni la zone ni le titulaire d'un hôte : c'est EXE-02.
- Elle ne prouve pas que la forge est substituable : c'est GOV-15.

## Mesure

- Preuves citées : l'outil de norme de protection de branche, et le programme qui dérive le verdict de gel d'une relecture du fournisseur. Le premier compare les checks requis à ceux que la CI produit. Le second juge une politique attendue contre l'état lu d'un dépôt de staging.
- Prochaine preuve : un fichier versionné qui déclare les rulesets d'un dépôt de la flotte, et un gate qui rougit quand l'état lu en diffère.
