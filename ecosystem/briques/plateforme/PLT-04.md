# PLT-04 — Construction reproductible

## Contexte

ADR-0001 exige que le bootstrap et la CI conservent une révision exacte et qualifiée de Bun. ADR-0049 traite la chaîne d'approvisionnement par des garde-fous et non par un invariant : verrou gelé, actions épinglées par SHA, sources `cargo-deny`, âge minimal des versions dans `bunfig.toml` (D71). ADR-0031 donne un foyer unique à tout patch vendorisé (I-28). Les déclarations vivent dans `toolchains/` et les gates de flotte dans `ecosystem/`, dans `project-governance`.

## Ce que la brique ferme

- La version malveillante publiée puis installée avant tout signalement : l'âge minimal la tient hors de la résolution (ADR-0049).
- Le workflow qui installe sa toolchain depuis une autre source que celle de l'autorité, avec un condensat qu'il se donne lui-même.
- Le patch vendorisé copié dans un second dépôt, ou épinglé sur un `rev` orphelin (I-28).
- L'avis de sécurité publié après le dernier changement d'un dépôt et que personne ne lit (I-26).

## Ce qu'elle ne fait pas

- Elle ne prouve pas qu'un binaire se reconstruit à l'octet : aucun instrument ne compare deux constructions.
- Elle ne tient aucun miroir des dépendances : la doctrine n'en décide aucun.
- Elle ne signe rien : PRV-03.
- Elle ne couvre pas le zero-day d'une dépendance, risque accepté par ADR-0049.

## Mesure

- Preuve citée : le gate d'âge des versions, qui lit chaque `bunfig.toml` et chaque racine d'installation des dépôts publics actifs de l'inventaire.
- Preuve citée : le gate de source de toolchain, qui compare l'archive et le condensat déclarés par chaque workflow de la flotte à la déclaration canonique.
- Les deux montrent des entrées épinglées, pas une sortie reproductible.
- Prochaine preuve : deux constructions du même commit sur deux machines, dont un gate compare les condensats.
