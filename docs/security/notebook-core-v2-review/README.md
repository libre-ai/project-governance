# Dossier de revue — Notebook Core v2

> **Statut : Gate A et Gate B approuvées / activation et release bloquées.** Les artefacts Notebook Core v2 sont `locked` après Gate A. Gate B approuve le candidat fixture-only `9ee3f8d` après cinq rôles spécialisés et synthèse ; aucune sauvegarde utilisateur, activation ou release n'est autorisée sans contrôle propriétaire séparé.

## Autorité unique

La sémantique normative est
[`contracts/wit/notebook-core-v2/SEMANTICS.md`](../../../contracts/wit/notebook-core-v2/SEMANTICS.md).
Ce dossier ne la duplique plus. Les copies de revue suivantes DOIVENT rester byte-identiques aux
artefacts catalogués et le checker Gate A vérifie cette identité :

- [`world.wit`](world.wit) ↔ `contracts/wit/notebook-core-v2/world.wit` ;
- [`notebook-backup-seal-request.v2.schema.json`](notebook-backup-seal-request.v2.schema.json) ↔
  `contracts/schemas/notebook-backup-seal-request.v2.schema.json` ;
- [`notebook-backup.v2.schema.json`](notebook-backup.v2.schema.json) ↔
  `contracts/schemas/notebook-backup.v2.schema.json` ;
- [`notebook-core-v2.golden.json`](notebook-core-v2.golden.json) ↔
  `contracts/fixtures/notebook-core-v2/golden-vectors.v1.json`.

Les correctifs qualifiés par Gate A sont notamment : interface WIT autonome `api`, erreurs fermées, identifiant
de sauvegarde/contexte/blocs CSPRNG opaques, retrait de `createdAt`, révisions et exclusions des artefacts clairs, limite plaintext 16 MiB, canonicalisation Context v2 déterministe et unique profil recovery code.

## Pièces du dossier

- [`MIGRATION.md`](MIGRATION.md) motive le major v2 et l'absence d'adaptateur heuristique ;
- [`SOLO-CHALLENGE.md`](SOLO-CHALLENGE.md) consigne les constats Gate S et risques résiduels ;
- [`PERFORMANCE.md`](PERFORMANCE.md) justifie la réduction conservatoire à 16 MiB ;
- [`INDEPENDENT-REVIEW.md`](INDEPENDENT-REVIEW.md) est le procès-verbal Gate A/B finalisé ;
- [`../../reviews/notebook-core-v2/`](../../reviews/notebook-core-v2/) conserve les verdicts par rôle
  sur des commits immuables, y compris les rejets historiques.

Le golden unique contient le scellement/ouverture, dix mutations backup, la canonicalisation Context
v2 avec douze refus adversariaux, les cas limites rejouables profondeur/nœuds/liens/nombres et le seul profil
`libre-ai.recovery-secret-code.v1`. Tout le matériel est
public, déterministe et interdit comme secret, sel, nonce ou identifiant de production.

## Progression

Gate A a permis la validation machine-checkable des artefacts et le propriétaire a autorisé le passage `candidate -> locked`. Les rejets Gate B historiques restent immuables. Le candidat `96934a8` ferme le host produit exact et un vrai `ENOSPC` APFS sur trois moteurs ; le candidat `bfc9e4c` ajoute une matrice physique 32+ Gio fraîche et rend les classes 8/16–24 Gio facultatives sans les déclarer supportées.

L'ADR-0007 classe désormais l'OOM réel du processus comme diagnostic facultatif, car aucun mécanisme sûr et portable n'existe sur les trois moteurs. La reprise bornée après `SIGKILL`/`SIGABRT`, les fautes mémoire internes, les budgets, le stockage et la classe 32+ Gio restent obligatoires sans changer la cryptographie. La passe [`../../reviews/notebook-core-v2/gate-b/9ee3f8d/`](../../reviews/notebook-core-v2/gate-b/9ee3f8d/) ferme Gate B avec cinq verdicts spécialisés `approve`. L'effacement physique RAM/swap/OS n'est pas revendiqué. Les gates produit, données utilisateur, offline et release restent séparées.
