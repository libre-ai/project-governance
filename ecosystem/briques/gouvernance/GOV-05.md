# GOV-05 — Registre des dépendances et tiers

## Contexte

I-26 confie l'état du monde des avis de sécurité de dépendances à un contrôle de flotte périodique, hébergé par l'autorité de gouvernance, qui notifie sans bloquer une demande de fusion. ADR-0021 en est la source, et D30 le consigne. ADR-0042 §4 fixe les licences admises pour une brique de base (D54). ADR-0056 D4 crée le registre de flotte des projets tiers écartés, `ecosystem/refusals.v1.yaml`. `project-governance` porte ce registre et le gate de sa forme, ainsi qu'un inventaire qui classe par registre de distribution les paquets de ses propres fichiers de verrouillage.

## Ce que la brique ferme

- Un refus inscrit sans motif ni preuve publique : le gate cité exige de chaque entrée son motif et au moins une preuve épinglée ou datée, comme ADR-0056 D4 le demande.
- Un registre des refus vidé ou illisible, lu comme « rien n'a été refusé » : le gate échoue sur un registre absent, illisible ou vide.
- Un canal de distribution dont ce dépôt dépend sans le savoir : l'inventaire classe par registre chaque paquet des deux fichiers de verrouillage de la racine, et liste les sources hors des registres habituels.

## Ce qu'elle ne fait pas

- Elle ne lit pas les avis de sécurité : I-26 en charge un contrôle de flotte périodique, qu'aucune preuve citée ici n'exerce.
- Elle n'inventorie pas les dépendances des autres dépôts de la flotte : l'inventaire cité lit les fichiers de verrouillage du dépôt où il tourne.
- Elle n'oblige pas à consulter le registre des refus avant une proposition : ADR-0056 écrit que cette consultation n'est tenue que par la revue.
- Elle ne contrôle pas les licences de D54.
- Elle n'admet pas les modèles : c'est GOV-04.
- Elle ne dit pas la juridiction d'un code : l'inventaire mesure la concentration du canal de distribution, et son en-tête l'écrit.
- Elle ne nomme pas le substitut d'un tiers. L'exercice de sortie de la forge est GOV-15.

## Mesure

Preuves citées. `verification/sovereignty/lockfile-inventory.ts` classe par registre de distribution chaque paquet des fichiers `bun.lock` et `Cargo.lock` qu'il reçoit ; le rapport de souveraineté lui donne ceux de ce dépôt. `tools/quality/check-refusals.ts` vérifie la forme du registre des refus et refuse une entrée sans preuve publique épinglée ou datée ; son en-tête écrit qu'il ne vérifie ni qu'une preuve établit le motif, ni qu'une citation épinglée se résout. Elles montrent un inventaire calculé pour un dépôt et un registre des refus dont la forme est tenue. Elles ne montrent ni le contrôle des avis d'I-26, ni un contrôle des licences de D54, ni un inventaire des dépendances de la flotte.

Prochaine preuve, proposition de l'agent non arbitrée : un registre en données relie chaque tiers de la flotte à son origine de distribution, à ses avis et à sa licence, et un gate échoue sur une entrée incomplète.
