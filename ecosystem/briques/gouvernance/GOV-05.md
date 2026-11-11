# GOV-05 — Registre des dépendances et tiers

## Contexte

I-26 confie à un contrôle de flotte périodique l'état du monde des avis de sécurité, sans bloquer une demande de fusion. I-28 donne à un patch vendorisé un foyer unique. ADR-0042 §4 fixe les licences admises pour une brique de base (D54). ADR-0056 crée le registre des projets tiers évalués puis écartés. `project-governance` porte ces pièces, et un inventaire des dépendances par registre de distribution. Aucun registre unique ne relie un tiers à son substitut.

## Ce que la brique ferme

- Un avis publié après le dernier changement d'un dépôt, que personne ne lit (I-26, D30).
- Une seconde copie d'un patch vendorisé dans un autre dépôt (I-28, D37).
- Un outil déjà écarté, reproposé sans son motif (ADR-0056).
- Une dépendance sous une licence refusée (D54).

## Ce qu'elle ne fait pas

- Elle n'admet pas les modèles : c'est GOV-04.
- Elle ne dit pas la juridiction d'un code : l'inventaire mesure la concentration du canal de distribution, et son rapport le précise.
- Elle ne nomme pas encore le substitut de l'hébergeur ni celui de la forge. L'exercice de sortie de la forge est GOV-15.

## Mesure

Preuves citées. `verification/sovereignty/lockfile-inventory.ts` classe chaque paquet des fichiers de verrouillage par registre de distribution. `tools/quality/check-refusals.ts` refuse une entrée du registre des refus sans preuve publique épinglée ou datée. Elles montrent deux registres tenus, pas un registre unique.

Prochaine preuve : un fichier de données liste chaque tiers avec son substitut, et un gate échoue sur un tiers sans substitut déclaré.
