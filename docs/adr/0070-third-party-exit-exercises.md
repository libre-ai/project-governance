<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# ADR-0070 — Chaque tiers de service de la flotte porte un exercice de sortie daté, avec sa procédure

- **Statut :** proposé — l'acceptation est un acte du propriétaire : il porte la ligne d'arbitrage datée et change ce statut dans la pull request qu'il fusionne. Tant que ces deux lignes n'ont pas changé, cet ADR n'est pas en vigueur, fusionné ou non, et aucune date du registre n'engage personne.
- **Arbitrage :** aucun constaté par la rédaction. Le lanceur du lot L111 rapporte une décision de principe du propriétaire du 2026-11-18 : tous les tiers (forge, cible runtime, registres de distribution). La rédaction n'a pas vu cette décision et ne la consigne pas comme arbitrage. Le propriétaire la confirme, ou non, en signant.
- **Date de rédaction :** 2026-11-18
- **Connexes :** I-12 (la forge, seul tiers dont la sortie est aujourd'hui fondée) ; I-07 (cible runtime) ; ADR-0056 D4 (`ecosystem/refusals.v1.yaml`, modèle du registre en données) ; ADR-0023 (surface de revue) ; briques GOV-05 et GOV-15 ; `verification/sovereignty/sovereignty.v1.md` (SOV-02, SOV-03).
- **Amende :** rien.
- **Invariants :** I-12 (appliqué : sa procédure devient une entrée du registre) ; I-07 (appliqué : sa cible devient une entrée du registre) ; I-17 (appliqué : le registre entre sur la surface de revue). Aucun invariant n'est inscrit par cette rédaction ; le texte proposé figure à la section « Acte de signature ».

## Vérification empirique

- **Prémisse :** un seul exercice de sortie existe dans le dépôt, celui de la forge, et il tourne chaque semaine.
- **Commande :** `gh run list -R libre-ai/project-governance --workflow sovereignty-report.yml --limit 5 --json createdAt,conclusion,event`
- **Date de rejeu :** 2026-11-18
- **Sortie attendue :** cinq exécutions `schedule` en `success`, la plus récente créée le `2026-11-11T12:49:10Z`. Le rapport est publié en artefact et n'est pas suivi dans le dépôt : la date de dernière exécution du registre reste donc une saisie.

- **Prémisse :** la flotte dépend, pour ce dépôt, des registres et origines que le registre ouvre.
- **Commande :** `git grep -hoE 'https://[a-zA-Z0-9.-]+' -- 'toolchains/*.json' | sort | uniq -c` puis `grep -c '^source = "registry+https://github.com/rust-lang/crates.io-index"' Cargo.lock`, et `collectInventory` de `verification/sovereignty/run-sovereignty.ts`
- **Date de rejeu :** 2026-11-18
- **Sortie attendue :** `15 https://github.com`, `3 https://nodejs.org`, `3 https://cdn.playwright.dev`, `1 https://libre-ai.fr` (identifiant de schéma, pas un téléchargement) ; 179 crates de crates.io ; 41 paquets npm, 1 crate tirée d'un dépôt git. L'index Python par défaut d'uv et le serveur de distribution de rustup sont **inférés** : le dépôt ne configure aucun index et ne nomme pas ce serveur.

- **Prémisse :** aucune ressource n'existe sur la cible runtime.
- **Commande :** `grep -n 'Clever Cloud provisioning' STATUS.md`
- **Date de rejeu :** 2026-11-18
- **Sortie attendue :** `Clever Cloud provisioning, secrets, databases, DNS and deployment: deferred to global integration.`

## Contexte

**Ce que le dépôt tient.** I-12 pose que les exports git et les artefacts empêchent toute dépendance de données irréversible envers la forge, et `verification/sovereignty/forge-restore.ts` (SOV-02) l'exerce. Aucune ligne de `docs/decisions/INVARIANTS.md` n'étend cette obligation à un autre tiers.

**Ce qui manque.** Les autres tiers sont nommés en prose : cible runtime (I-07), registres de distribution (`sovereignty.v1.md`). Aucun n'a de procédure de sortie, aucun contrôle ne distingue un tiers sans plan de sortie, et rien ne relie un exercice à une échéance. GOV-05 écrit qu'elle ne nomme pas le substitut d'un tiers, et sa prochaine preuve, non arbitrée, porte sur l'origine, les avis et la licence : elle ne couvre pas cette question.

**Ce que cette décision ne dit pas.** Elle ne juge pas qu'un tiers doive être quitté, et elle ne désigne aucun remplaçant. Un exercice mesure qu'une sortie reste possible.

## Décision

**D1 — Obligation.** Chaque tiers de service dont la flotte dépend pour construire, vérifier, distribuer ou faire tourner son code porte une entrée de `ecosystem/third-parties.v1.yaml`, avec un exercice de sortie : une date prévue, une procédure suivie dans le dépôt, la date de la dernière exécution.

**D2 — Ouverture du registre.** Dix entrées l'ouvrent. Les dates et les procédures sont proposées, sauf la procédure de la forge, qui existe déjà.

| Entrée | Classe | Procédure | Date proposée |
| --- | --- | --- | --- |
| `third-party.forge-github-git` | forge | `verification/sovereignty/forge-restore.ts` (existante) | 2027-03-01 |
| `third-party.forge-github-actions` | forge | `docs/security/third-party-exits/forge-services.md` | 2027-03-15 |
| `third-party.forge-github-releases` | forge | `docs/security/third-party-exits/forge-services.md` | 2027-03-15 |
| `third-party.registry-npm` | distribution | `docs/security/third-party-exits/package-registries.md` | 2027-04-05 |
| `third-party.registry-crates-io` | distribution | `docs/security/third-party-exits/package-registries.md` | 2027-04-05 |
| `third-party.registry-pypi` | distribution | `docs/security/third-party-exits/package-registries.md` | 2027-04-05 |
| `third-party.origin-rust-toolchain` | distribution | `docs/security/third-party-exits/toolchain-origins.md` | 2027-05-03 |
| `third-party.origin-nodejs` | distribution | `docs/security/third-party-exits/toolchain-origins.md` | 2027-05-03 |
| `third-party.origin-playwright-cdn` | distribution | `docs/security/third-party-exits/toolchain-origins.md` | 2027-05-03 |
| `third-party.runtime-clever-cloud` | cible runtime | `docs/security/third-party-exits/runtime-target.md` | 2027-09-06 |

**D3 — Contrôle.** `tools/quality/check-third-parties.ts` échoue sur un registre absent, illisible ou vide, sur un exercice absent, sur une date mal formée, sur une procédure qui n'est pas un fichier régulier suivi, et sur une échéance passée sans exécution enregistrée entre la date prévue et le jour du contrôle. Il imprime les entrées examinées, les échéances passées et celles à venir.

**D4 — Surface de revue.** Le registre est gardé par `tools/quality/check-review-evidence.ts` : retirer une entrée ou repousser une date desserre le contrôle.

**D5 — Activation.** Le contrôle se lance par `bun run check:third-parties`. Il n'entre dans `bun run check` qu'à l'acceptation de cet ADR, par la pull request qui l'accepte.

## Conséquences

- Une échéance passée sans exécution rend le contrôle rouge dès son activation : chaque date acceptée est un engagement daté du propriétaire.
- `last_executed_on` est une déclaration : le contrôle ne lance aucune procédure et ne prouve pas qu'un exercice a eu lieu. La preuve reste le relevé cité par la pull request qui écrit la date.
- SOV-02 tourne chaque semaine, mais rien ne reporte ses exécutions dans le registre : l'entrée de la forge reste à `null` tant que le propriétaire n'y écrit pas de date.
- L'exercice de la forge ne couvre que l'historique de `HEAD`, pour ce seul dépôt ; ni les issues, ni les pull requests, ni les rulesets (GOV-15). Actions et Releases ont donc leurs propres entrées.
- La cible runtime n'a aucune ressource à la rédaction : sa date proposée vaudra rouge si aucune ressource n'existe alors et que le propriétaire ne la déplace pas.
- Le registre couvre les tiers relevés dans ce dépôt, pas un inventaire de la flotte. Restent hors de l'ouverture, faute de décision : les bases d'avis de sécurité consultées par cargo-deny et osv-scanner (I-26), les fournisseurs de modèles (GOV-04, GOV-16), le nom de domaine.

## Alternatives rejetées

| Option | Motif du rejet |
| --- | --- |
| Amender GOV-05 au lieu d'écrire un ADR | Une fiche de brique décrit l'existant ; `AGENTS.md` pose que la doctrine vit au registre des invariants, ce qu'un ADR accepté peut fonder |
| Limiter le registre à la forge | Écarté par la décision de principe rapportée : tous les tiers |
| Déclarer le registre non gardé dans `check-data-inventory` | Retirer une entrée desserrerait le contrôle sans preuve de revue |
| Lire le registre dans `bun run check` dès la fusion | Rendrait des dates proposées opposables avant toute signature |
| Exécuter les exercices avant la signature | Les procédures et leurs dates sont d'abord à accepter |

## Acte de signature

À la charge du propriétaire, dans la pull request qu'il fusionne. Rien de ce qui suit n'est en vigueur avant cet acte.

1. Confirmer ou refuser la décision de principe, et arrêter la liste des tiers de D2.
2. Accepter ou corriger chaque date et chaque procédure proposée. Pour la cible runtime, choisir : garder la date, la repousser, ou la lier au premier provisionnement.
3. Trancher le sort des tiers laissés hors de l'ouverture (section « Conséquences »).
4. Porter l'arbitrage daté sur la ligne « Arbitrage » et faire passer le statut au littéral d'acceptation du gabarit ADR.
5. Retirer du registre et des procédures les mentions « proposé » pour ce qui est accepté.
6. Ajouter `bun run check:third-parties` à la chaîne `check` de `package.json`.
7. Ajouter au registre des décisions, au numéro suivant de la série, l'entrée : « Chaque tiers de service de la flotte porte, dans `ecosystem/third-parties.v1.yaml`, un exercice de sortie daté et sa procédure suivie ; une échéance passée sans exécution enregistrée fait échouer le contrôle | ADR-0070 ».
8. Ajouter au registre des invariants, au numéro suivant de la série : « Aucun tiers de service dont la flotte dépend n'est sans exercice de sortie daté et procédure suivie au registre des tiers ».

## Vérification

- `bun run check:third-parties` : sort 0 et imprime `10 entrée(s) examinée(s) = 0 échéance(s) passée(s) + 10 à venir + 0 sans date lisible` tant qu'aucune date proposée n'est échue.
- `bun test tools/quality/check-third-parties.test.ts` : chaque violation du contrôle est exercée.
- `bun run check:data-inventory` : le registre y est compté parmi les fichiers gardés.
