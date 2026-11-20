<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Exercice de sortie : cible runtime

**Statut : procédure proposée (ADR-0070), jamais exécutée.** Elle n'engage personne tant
qu'ADR-0070 n'est pas accepté.

Entrée couverte : `third-party.runtime-clever-cloud`.

**État à la rédaction.** La cible runtime de la flotte est Clever Cloud Paris/UE. `STATUS.md` écrit que
le provisioning, les secrets, les bases, le DNS et le déploiement sont différés jusqu'à l'intégration
globale, et `infrastructure/README.md` que la configuration est volontairement différée. Il n'y a
donc aujourd'hui ni donnée ni service à sortir de cette cible.

**Question posée :** un service déployé sur la cible se relève-t-il ailleurs, avec ses données, à
partir de ce que la flotte détient ?

## Tant qu'aucune ressource n'existe

1. Relever dans les dépôts de la flotte ce qui lie un service à la cible : variables injectées,
   extensions de base, stockage objet, configuration de déploiement.
2. Pour chaque lien, écrire ce qui le remplace sur un hôte générique.

**Réussite de cette étape :** le relevé existe et chaque lien a son remplaçant, ou est nommé comme
sans remplaçant. Elle ne vaut pas exercice de sortie : la date reste à arbitrer (voir ADR-0070,
acte de signature).

## Dès qu'une ressource existe

1. Exporter la base PostgreSQL et le stockage objet vers un emplacement hors de la cible.
2. Sur un hôte hors de la cible, restaurer ces exports et démarrer le candidat immuable déjà déployé.
3. Lancer le test de fumée du service contre cet hôte.
4. Comparer le volume restauré au volume exporté, et mesurer la durée de l'ensemble.

**Réussite :** le test de fumée passe sur l'hôte hors cible, sans écart de volume. Le relevé donne la
durée mesurée.

## Limites

- L'exercice ne migre aucun service et ne désigne aucun hébergeur de remplacement.
- Un export contient des données de la flotte : il suit les règles de secrets et de données
  personnelles du dépôt, et il est détruit à la fin de l'exercice.

## Enregistrement

Le propriétaire écrit la date dans `last_executed_on` de l'entrée, dans une pull request qui cite
le relevé de l'exercice.
