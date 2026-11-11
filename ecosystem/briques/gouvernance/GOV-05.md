# GOV-05 — Registre des dépendances et tiers

## Contexte

I-26 confie l'état du monde des avis de sécurité de dépendances à un contrôle de flotte périodique, hébergé par l'autorité de gouvernance, qui notifie sans bloquer une demande de fusion. ADR-0021 en est la source, et D30 le consigne. ADR-0042 §4 fixe les licences admises pour une brique de base (D54). ADR-0056 D4 crée le registre de flotte des projets tiers écartés. `project-governance` porte ce registre, et un inventaire des dépendances par registre de distribution.

## Ce que la brique ferme

- Un avis publié après le dernier changement d'un dépôt, que personne ne lit : I-26 en charge le contrôle de flotte.
- Un outil déjà écarté, reproposé sans son motif : ADR-0056 D4 en garde le motif et la preuve.
- Un canal de distribution dont la flotte dépend sans le savoir : l'inventaire classe chaque paquet par registre.

## Ce qu'elle ne fait pas

- Elle n'admet pas les modèles : c'est GOV-04.
- Elle ne dit pas la juridiction d'un code : l'inventaire mesure la concentration du canal de distribution, et son en-tête l'écrit.
- Elle ne nomme pas le substitut d'un tiers. L'exercice de sortie de la forge est GOV-15.

## Mesure

Preuves citées. `verification/sovereignty/lockfile-inventory.ts` classe chaque paquet des fichiers de verrouillage par registre de distribution. `tools/quality/check-refusals.ts` refuse une entrée du registre des refus sans preuve publique épinglée ou datée. Elles montrent deux registres tenus. Elles ne montrent ni le contrôle des avis d'I-26, ni un contrôle des licences de D54.

Prochaine preuve, proposition de l'agent non arbitrée : un registre en données relie chaque tiers à son origine de distribution, à ses avis et à sa licence, et un gate échoue sur une entrée incomplète.
