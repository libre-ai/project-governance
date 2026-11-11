# PAS-02 — Classes de données

## Contexte

La doctrine classe les données en plusieurs endroits. I-21 sépare le code, les données d'organisation et les données personnelles. I-10 impose le local d'abord là où la spécification l'exige. Le catalogue des contrats de `schemas-and-contracts` déclare une classe par contrat. Le corps de plan d'exécution verrouillé par ADR-0036 borne la sortie vers un modèle par une classe maximale et une région. Les vocabulaires de ces surfaces diffèrent, et ADR-0063 nomme un ADR « classes et zones » encore à écrire.

## Ce que la brique ferme

- La donnée personnelle envoyée à un service distant : I-21 la garde sur l'appareil de son détenteur.
- La zone hors Union : le plan n'admet que les régions locale, France et Union, et I-07 fixe l'hébergement dans l'Union.
- La sortie sans fondement : dès que le réseau est ouvert, le plan exige une base d'autorisation, ce qu'I-22 demande pour une personne tierce.
- La classe saisie librement : le gate du catalogue refuse toute valeur hors vocabulaire.

## Ce qu'elle ne fait pas

- Elle ne classe pas la fiabilité d'une donnée : le paquet `classification` de `project-governance` réalise cet autre axe, le contrôle K2.
- Elle n'applique pas la classe à l'exécution : c'est PAS-01.
- Elle ne fixe ni rétention ni effacement : c'est GOV-13.

## Mesure

- Preuves citées : le schéma du corps de plan et le gate des contrats, épinglés. Ils montrent des classes et des zones fermées dans des contrats, pas leur application à un appel réel.
- Prochaine preuve : une table unique de classes et de zones adoptée par ADR, et un vecteur rouge qui refuse un plan hors de cette table.
