# PAS-02 — Classes de données

## Contexte

La doctrine classe les données en plusieurs endroits. I-21, issu d'ADR-0012, sépare le code, les données d'organisation et les données personnelles, et veut que « les données concernant une personne physique restent sur le device de leur détenteur ». I-10 impose le « local-first où la spec l'exige ». Le catalogue des contrats de `schemas-and-contracts` déclare une classe par contrat. Le corps de plan d'exécution, verrouillé par ADR-0036 (D42), borne la sortie vers un modèle par une classe maximale et une région. Les deux vocabulaires diffèrent : six classes dans le gate du catalogue, quatre dans le schéma du plan. ADR-0063, encore proposé, nomme un ADR « classes et zones » à écrire. La brique dépend de GOV-07 : sans l'autorité des contrats canoniques, ces vocabulaires n'ont pas de source unique.

## Ce que la brique ferme

- La donnée envoyée hors de l'Union : le plan borne la région à `local`, `france` ou `eu`.
- La sortie sans fondement : dès que le réseau est ouvert, le plan exige une base d'autorisation prise dans une liste fermée.
- La classe saisie librement : le gate du catalogue refuse toute valeur hors vocabulaire.

## Ce qu'elle ne fait pas

- Elle ne garde pas la donnée personnelle sur l'appareil : le plan admet la classe `personal` en sortie vers un modèle quand le réseau est ouvert. Ce contrat ne réalise pas la clause d'I-21.
- Elle ne classe pas la fiabilité d'une donnée : le paquet `classification` de ce dépôt réalise cet autre axe, le contrôle K2 du noyau de sécurité.
- Elle n'applique pas la classe à l'exécution : c'est PAS-01.
- Elle ne fixe ni rétention ni effacement : c'est GOV-13.

## Mesure

- Preuves citées : le schéma du corps de plan et le gate des contrats, épinglés. Ils montrent des classes et des régions fermées dans des contrats. Ils ne montrent ni table commune aux deux vocabulaires, ni application à un appel réel, ni règle qui garde la classe `personal` dans la région `local`.
- Prochaine preuve : une table unique de classes et de zones adoptée par ADR, et un vecteur rouge qui refuse un plan où la classe `personal` sort de la région `local`.
