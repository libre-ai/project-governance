# Table de synchronisation de la documentation : nature du changement, documents, contrôle

## Portée et statut

- **Portée :** ce dépôt seul. Chaque ligne de la table est vérifiée dans ce dépôt : la colonne
  « Contrôle » nomme le script `bun run check:…` ou le fichier de gate qui échoue si le document
  n'est pas mis à jour, ou vaut `aucun contrôle`. Une ligne sans contrôle reste dans la table
  pour que l'écart soit visible, pas pour qu'il paraisse couvert. Méthode, pas doctrine : rien ici
  n'est un invariant.
- **Origine :** relevé du projet `shirudo-dev/shirudo` du 2026-11-24 (fichiers `AGENTS.md`,
  `.agents/skills/security-audit/SKILL.md`, `.agents/skills/docs/SKILL.md`). La forme est reprise
  et réécrite ; aucun texte n'est copié.
- **Statut :** proposé le 2026-11-24. Une table dont une ligne se contredit avec un gate prime le
  gate, et la ligne se corrige. L'inscription dans la carte d'autorité (`docs/README.md`) est une
  décision de fusion du propriétaire.

## Table

Tous les documents listés sont mis à jour dans le même commit que le changement.

| Nature du changement | Documents à mettre à jour | Contrôle | Preuve dans le dépôt |
| --- | --- | --- | --- |
| Ajout d'un invariant `I-xx` | `docs/decisions/INVARIANTS.md` ; l'ADR que la ligne cite | `bun run check:doctrine` (la citation d'ADR de la ligne se résout) ; en CI, `check-review-evidence` exige une preuve de revue ou un marqueur `Owner-arbitration:` daté | `tools/quality/check-doctrine-governance.sh:59` (« Invariants register citations resolve ») ; en-tête de `tools/quality/check-review-evidence.ts` (surface gardée : registres et ADR) |
| Retrait d'un invariant | `docs/decisions/INVARIANTS.md` (ligne marquée retirée, jamais effacée) ; tout document qui le cite | `bun run check:threat-model-citations` | `tools/quality/check-threat-model-citations.ts:1-40` : « A mention of a retired row fails » |
| Nouvel ADR | `docs/adr/NNNN-<sujet>.md` ; `docs/decisions/DECISION-REGISTER.md` (présence seulement) | `bun run check:doctrine` | `tools/quality/check-doctrine-governance.sh:38-56` (ligne `Arbitrage`, `I-##` ou « No invariant », numéro unique) ; `tools/quality/check-objectives.ts:15` (le fichier doit exister, son contenu n'est pas lu) |
| ADR qui en amende, remplace ou lève un autre | le nouvel ADR (déclaration en ligne de statut) ; l'en-tête de l'ADR ciblé (`Amendé par` / `Remplacé par`) | `bun run check:adr-supersession` | `tools/quality/check-adr-supersession.ts:21-32` (déclaration et marqueur inverse), `:41` et `:43` (libellés) |
| Nouveau script `check:*` dans `package.json` | `package.json` ; aucun document ne liste les scripts (`AGENTS.md` renvoie à `bun run check`) | aucun contrôle | `grep -rn 'scripts\.check\|scripts\[' tools ecosystem` ne trouve aucun gate qui exige qu'un `check:*` soit câblé dans `check` |
| Nouveau skill | `skills/<nom>/SKILL.md` ; `.claude-plugin/marketplace.json` (listing) | `bun run check:skills-manifest` (et `bun run check:skills`) | `tools/skills/build-skills-manifest.ts:24` (`MANIFEST_PATH`), `:16-17` (`--check` échoue si le manifeste est périmé), `:121` (compte des skills et des entrées listées) |
| Changement d'une fiche `project.v1.yaml` | la fiche : `project.v1.yaml` à la racine, ou `ecosystem/cards/<nom>.project.v1.yaml` | `bun run check:cards` | `ecosystem/validate-cards.ts:17` et `:25` (globs). `check:projection` ne lit que `ecosystem/objects` (`package.json`), pas les fiches |
| Nouveau document sous `docs/security/` citant un invariant | le document ; son entrée `files` dans `tools/quality/threat-model-citations.v1.json` | `bun run check:threat-model-citations` | en-tête de `tools/quality/check-threat-model-citations.ts` : tout fichier suivi sous le périmètre déclaré qui cite un `I-xx` doit être déclaré ; le gate imprime le nombre de fichiers non déclarés lus et combien citent |
| Nouveau nom de dépôt | `docs/decisions/LEXICON.md` (carte canonique, `AGENTS.md:47-48`) | aucun contrôle | `tools/quality/check-retired-repository-names.ts:1-12` : le gate ne porte que les noms retirés, pas les noms nouveaux |

## Ce que la table ne couvre pas

- Une ligne « aucun contrôle » se lit comme une absence mesurée par lecture des gates
  mentionnés, pas comme une preuve de négatif sur tout `tools/` : un gate non lu peut exister.
- Les lignes « nouvel ADR » et « ADR qui en remplace un autre » se cumulent : un ADR qui
  remplace impose les deux contrôles.
