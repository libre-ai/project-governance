Verdict: approve

# Revue, quatrième tour : ADR-0060, les gates s'exécutent depuis la PR qu'ils jugent

**Date :** 2026-10-26
**Objet :** pull request #158, ADR-0060 au statut `proposed` (issue #152), après la décision du propriétaire sur P1 et l'application d'O1 à O3 (`REVIEW-ROUND-3.md`, verdict `reject` sur `6d380eb`).
**Nature :** passe de revue seule, mode `candidate-integration`, quatrième tour, sur un commit immuable. Le relecteur n'est pas l'auteur et n'a rien modifié.

## Enregistrement de la passe

- `reviewPassId` : `rp-adr0060-876d64cc8a9a-candidate-integration-r4`
- rôle et mode : `candidate-integration`, aucun rôle spécialisé du catalogue
- commit revu : `876d64cc8a9ad6a7230617124b8da263086451de`, tête de `work/adr-proposed-gates-run-from-pr-2026-10-24` (`gh pr view 158 -R libre-ai/project-governance --json headRefOid --jq .headRefOid`)
- dernier head revu, point de départ de la re-revue (ADR-0056 D2) : `6d380eb8202bc0e94d8042f191b7755b544f699b`
- base : `a5cd2b4680584fe040b290c79216dfa7da0e22a2`, tête de `migrate/recover-code`, branche servie (`git ls-remote --symref https://github.com/libre-ai/project-governance HEAD`). Elle est intégrée par la fusion `9295b3f`.
- commits revus depuis `6d380eb` :
  - `e643a1c` ajoute `REVIEW-ROUND-3.md`, seul fichier du commit ;
  - `741954a` modifie l'ADR (4 insertions, 3 suppressions) ;
  - `d045e11` ajoute 5 lignes à `tools/quality/pinned-citations.v1.json` ;
  - `9295b3f` est la fusion de la base ;
  - `876d64c` modifie l'ADR (1 ligne).
- diff de la PR contre la nouvelle base (`git diff --stat a5cd2b4 HEAD`) : 5 fichiers, à savoir l'ADR, les trois dossiers de revue et `pinned-citations.v1.json`.
- SHA-256 (`shasum -a 256 <fichier>`) :
  - `docs/adr/0060-gates-run-from-the-pull-request-they-judge.md` : `21c446a7ac206d24a3c788c65030b131aedbbc466b47f21eac1d823ab77a81fb`
  - `tools/quality/pinned-citations.v1.json` : `882820a2f67c74797c0d77efc74732420776760d8516bc8d33e82918c0b8a4d1`
  - `REVIEW.md` : `11392a20…61d5`, inchangé
  - `REVIEW-ROUND-2.md` : `e61674a0…0642`, inchangé
  - `REVIEW-ROUND-3.md` : `d4b81b23d77e9792a4c57373572d4018da3c93977cb2997bc99dfe96dcebba39`
- aucun contrat ni vecteur n'est touché
- agent : Claude Code, sous-agent de revue ; modèle `claude-opus-5-5` (Claude Opus 5.5) ; le harnais n'expose pas d'identifiant de session
- clone de lecture propre avant et après la passe (`git status --short` : 0 ligne). Les mutations ont été faites dans un worktree séparé, propre après restauration, puis retiré.

Ce verdict **n'est pas une approbation de promotion par rôle**. Il ne remplace aucun rôle de `contracts/catalog.v1.json` et ne change l'état d'aucune autorité.

## Ce qui a été rejoué, et comment

~~~sh
mkdir -p "$TMPDIR/scratch" && S=$(mktemp -d "$TMPDIR/scratch/x.XXXXXX")
git clone https://github.com/libre-ai/project-governance "$S/pg"
git -C "$S/pg" fetch origin pull/158/head
git -C "$S/pg" checkout --detach FETCH_HEAD       # -> 876d64cc8a9a…
git -C "$S/pg" diff 6d380eb HEAD -- docs/adr/0060-gates-run-from-the-pull-request-they-judge.md
git -C "$S/pg" diff --stat a5cd2b4 HEAD
git -C "$S/pg" diff --stat 066ef494ff33 a5cd2b4
~~~

### (a) La fusion de la base est propre et ne change aucune affirmation

- Arbre recalculé : `git merge-tree --write-tree d045e11 a5cd2b4` donne `7f3da4e06dc0…`, identique à l'arbre de `9295b3f`. La fusion n'introduit aucune résolution manuelle. Son message porte le trailer `Signed-off-by:`. Elle n'est pas signée cryptographiquement (`gh api repos/libre-ai/project-governance/commits/9295b3f --jq .commit.verification.reason` donne `unsigned`), comme les quatre autres commits revus.
- La base a bougé de `066ef494ff33` à `a5cd2b4` sur 4 fichiers : ADR-0059, le registre des décisions, `check-audit-delta.ts` et son test.
- #157 retire `--depth=1` du fetch de la base (`066ef494ff33:tools/quality/check-audit-delta.ts:157` devient `a5cd2b4:tools/quality/check-audit-delta.ts:166`). Le gate lit toujours la tête de la branche cible par `FETCH_HEAD` (`a5cd2b4:tools/quality/check-audit-delta.ts:186`, `:216-217`). Les affirmations de l'ADR, « le lockfile de la tête de la branche cible » et « par `FETCH_HEAD` » (l. 44, 48), restent vraies. Les épingles visent `066ef494ff33`, immuable, et se résolvent.
- ADR-0059 (`docs/adr/0059-amend-adr-0056-declaration-block-negatives-citations-required-checks.md`) ne modifie pas ADR-0056 D2 (« Ne modifie pas : … ADR-0056 D2, D3 et D4 », l. 29-30). Les règles de verdict appliquées ici sont donc inchangées.
- Une seule affirmation est devenue périmée : la ligne « Numéro » (l. 8), voir Q4. Les commandes de comptage rejouées sur la branche servie donnent d'autres nombres, voir Q3.

### (b) Épingles

- 106 citations locales distinctes, inchangées depuis le troisième tour. Résolution mécanique : `local resolved=106 failed=0`, avec la boucle du second tour, variable `fp`.
- 4 citations de dépôts de la flotte ajoutées par `741954a`, rejouées par git sur un clone de chaque dépôt (`git clone --filter=blob:none --no-checkout`) :

  | Citation | Commit | Sur la branche servie | Ligne lue |
  | --- | --- | --- | --- |
  | `libre-ai/application-development-toolkit@4e782fd5c5cc:.github/workflows/playwright-guid-diagnostic.yml:35` | résout, tête servie | oui | `ref: 8a27b8f5bf774fad04b8478fa9179eefdba0eaf7` |
  | `…playwright-guid-diagnostic.yml:42,57` | idem | oui | deux `python3 -B tooling/.github/composition/run-composition.py` |
  | `libre-ai/personal-knowledge-workspace@855fee670706:.github/workflows/notebook-webkit-macos.yml:42` | résout, tête servie (elle a avancé depuis `9855f5d`, relevé du troisième tour) | oui | `ref: 75d6ea085b18cb15d450d7f0f5b1ba9d69645800` |
  | `…notebook-webkit-macos.yml:49,77` | idem | oui | deux appels de `run-composition.py` |

~~~sh
git clone -q --filter=blob:none --no-checkout https://github.com/libre-ai/<dépôt> o
git -C o rev-parse <sha>^{commit}
git -C o merge-base --is-ancestor <sha> HEAD && echo "on served branch"
git -C o show <sha>:<chemin> | cat -n | sed -n '<lignes>p'
~~~

### (c) Chiffres repris

- 14 dépôts par la recherche de code : `gh search code --owner libre-ai "project-governance/.github/workflows/validate-composition.yml" --limit 100 --json repository,path --jq '[.[]|select(.path|startswith(".github/workflows/"))|.repository.nameWithOwner]|unique|length'` donne 14.
- Les deux dépôts archivés le sont toujours : `gh api repos/libre-ai/ai-practice-workbench --jq .archived` et la même requête pour `information-feed-filter` donnent `true`. Le 16 du second instrument vient de T4 du troisième tour, reprise sans changement.
- Comptages de commits : voir Q3.

### (d) Gate de citations rejoué localement, et preuve que l'exemption discrimine

Exécution depuis le worktree, état redirigé (`HOME` et `XDG_CACHE_HOME` sous `$S/home`), Bun local 1.4.4.

~~~sh
bun tools/quality/check-pinned-citations.ts
~~~

Sur la tête, le gate rend `rc=0` : « 224 assertion(s) hold — 25 pinned citation(s) examined … = 21 resolved + 4 exempted (with reason) + 0 failed … 5 exemption(s) declared, 5 matched … local pins …: 161 examined = 160 resolved + 1 exempted (with reason) + 0 failed ».

Mutations, chacune restaurée par `git checkout -- .` :

| Mutation | Code de sortie | Sortie |
| --- | --- | --- |
| M0 : exemption de `d045e11` retirée (`jq 'del(.exemptions[] \| select(.file==".../REVIEW-ROUND-3.md"))'`) | 1 | `REVIEW-ROUND-3.md:115 …validate-composition.yml@<sha>: invalid-citation: '<sha>' is not a sha` |
| M1 : même texte ajouté à `REVIEW-ROUND-2.md` | 1 | `REVIEW-ROUND-2.md:260 …@<sha>: invalid-citation` |
| M2 : autre texte `…/ci.yml@<sha>` ajouté à `REVIEW-ROUND-3.md` | 1 | `REVIEW-ROUND-3.md:206 …ci.yml@<sha>: invalid-citation` |
| M3 : même texte, seconde occurrence dans `REVIEW-ROUND-3.md` | 0 | « 5 exempted (with reason) » |

## Suivi des constats du troisième tour

| Constat | Gravité, disposition au tour 3 | État | Preuve |
| --- | --- | --- | --- |
| P1 : ce que signe la fusion | minor, preuve requise | **tranchée par le propriétaire, telle que relayée** | l. 3 : « la fusion de cette pull request signe la mesure et l'écartement conditionnel d'A1, tant que les deux comportements de GitHub qu'il suppose ne sont pas mesurés. Aucune option n'est retenue ; le choix d'une option se fera par un ADR ultérieur. » l. 4 : arbitrage du propriétaire du 2026-10-24, « Signe la mesure ». Le corps de la PR porte la même décision. |
| O1 : « son seul appelant » | minor, suggestion | **résolu** | l. 112 : « son seul appelant dans ce dépôt ». Les deux appelants de la flotte sont épinglés et se résolvent (b). La ligne de commande de `run-composition.py` doit rester facultative. Il reste un défaut de lecture, voir Q1. |
| O2 : 14 et 16 | non-blocking, suggestion | **résolu** | l. 112 : les deux instruments, les deux dépôts archivés et l'épinglage à un sha complet. Recalculé en (c). |
| O3 : épingle mal rattachée | non-blocking, suggestion | **résolu** | l. 48 : l'épingle suit « `check-audit-delta.ts` lit cette tête, par `FETCH_HEAD` ». La plage peut être précisée, voir Q2. |

La ligne de statut dit ce que le propriétaire a décidé, sous la forme relayée par la session de coordination : la mesure et l'écartement conditionnel d'A1 sont signés, aucune option n'est retenue, et un ADR ultérieur choisira. Elle n'ajoute rien d'autre. La condition qu'elle énonce (« tant que les deux comportements … ne sont pas mesurés ») reprend celle de la l. 179. La phrase « Cet ADR ne modifie aucun workflow ni aucun gate » existait déjà, et reste vraie pour l'ADR. La date de l'arbitrage est passée du 2026-10-25 au 2026-10-24 (`876d64c`). Le message de `741954a` garde l'ancienne date, comme l'auteur le déclare, et sa correction réécrirait un historique déjà poussé.

## Jugement sur `d045e11` : une donnée de gate requis changée dans la PR qu'il juge

**Disposition : prêt.**

- **Motif.** `REVIEW-ROUND-3.md:115` écrit la forme d'une ligne `uses:` avec un `<sha>` littéral. Le gate de citations lit tout `docs/` et la refuse (M0). Ce marqueur vient de ma propre écriture au troisième tour.
- **Alternative écartée.** Réécrire le dossier va contre « Historical reject verdicts remain immutable audit records » (`docs/reviews/AGENT-REVIEW-PROTOCOL.md:81`) et contre la pratique de dépôt textuel des trois dossiers.
- **Mécanisme.** C'est celui que le gate prévoit pour un gabarit, une exemption « for the file it is written in, with a written reason » (`tools/quality/check-pinned-citations.ts:136`). Il a un précédent dans la même donnée : l'entrée d'ADR-0056 sur `tt-a1i/archify@25cf370:<chemin>`.
- **Étroitesse.**
  - Une entrée, avec son motif (`tools/quality/pinned-citations.v1.json:36-40`).
  - Elle est indexée sur le couple fichier et texte exact (`exemptionKey`, `tools/quality/check-pinned-citations.ts:182-183`).
  - Une exemption inutilisée échoue (`:1805-1810`).
  - M1 et M2 montrent qu'un autre texte, ou le même texte dans un autre fichier, reste rouge.
  - Limite mesurée : la clé couvre toutes les occurrences de ce texte dans ce fichier (M3). Elle ne pourrait servir qu'en éditant un dossier immuable, ce qui serait une modification visible au diff.
- **Classe.** C'est exactement la classe que mesure ADR-0060 : le vert du check requis « Every pinned code citation of the documents resolves » sur cette PR dépend d'une donnée que la PR modifie. L'auteur le déclare dans le message du commit et dans le corps de la PR. Sous le statu quo (option C), la garde est la revue humaine : cette passe a vérifié que le changement est minimal et qu'il discrimine.

## Nouveaux constats

Gravités du protocole ; dispositions selon ADR-0056 D2 (option A).

### Q1 : non-blocking, suggestion. « Sa seule extraction » a perdu son référent

l. 112 : depuis l'insertion d'O1, la phrase « Sa seule extraction est l'outillage (`066ef494ff33:.github/workflows/validate-composition.yml:58-65`) » suit des phrases sur la ligne de commande de `run-composition.py` et sur le compte de fichiers. Il suffit d'écrire « La seule extraction de `validate-composition.yml` ».

### Q2 : non-blocking, suggestion. La plage de l'épingle déplacée par O3

l. 48 : « lit cette tête, par `FETCH_HEAD` (`066ef494ff33:tools/quality/check-audit-delta.ts:121-157`) ». La plage couvre la résolution de la base et le fetch (`:157`), mais pas les lectures `FETCH_HEAD` (`066ef494ff33:tools/quality/check-audit-delta.ts:177`, `:207-208`). Il faudrait les ajouter.

### Q3 : non-blocking, suggestion. Les comptages de commits ne se rejouent plus à l'identique

Les commandes des l. 88, 120, 135 et 141-145 nomment `origin/migrate/recover-code`. La base ayant avancé à `a5cd2b4`, elles donnent maintenant d'autres nombres : C1 148, C2 88, C3 104 au lieu de 146, 87 et 103. Les comptes C5 et C6 restent à 30 et 19. Les mêmes commandes sur `066ef494ff33` redonnent exactement les chiffres de l'ADR. La mesure est datée et son commit est nommé (l. 23-27), donc rien n'est faux. Nommer `066ef494ff33` dans les commandes les rendrait rejouables tant que l'ADR existe.

~~~sh
for ref in 066ef494ff33 origin/migrate/recover-code; do
  git log --since=2026-09-24 --format=%H $ref | wc -l
  git log --since=2026-09-24 --format=%H $ref -- tools .github 'ecosystem/*.ts' \
    package.json bun.lock bunfig.toml | wc -l
done
# 066ef494ff33 : 146, 87 ; origin/migrate/recover-code (a5cd2b4) : 148, 88
~~~

### Q4 : non-blocking, suggestion. La ligne « Numéro » est périmée

l. 8 : « 0059 est laissé à l'amendement d'ADR-0056 rédigé en parallèle ». ADR-0059 est fusionné (#156, `docs/adr/0059-amend-adr-0056-declaration-block-negatives-citations-required-checks.md`). Le corps de la PR le dit déjà, l'ADR peut le dire aussi.

### R : non-blocking, prêt

Prêt, sur le périmètre revu :

- O1 à O3, résolus ;
- la ligne de statut et la ligne d'arbitrage, conformes à la décision relayée ;
- `d045e11`, justifié et étroit ;
- la fusion de la base, propre et sans effet sur les affirmations de l'ADR ;
- 106 citations locales et 4 citations de la flotte, résolues ;
- aucune option n'est retenue au nom du propriétaire.

## État de la CI

`gh pr checks 158 -R libre-ai/project-governance` : 13 checks, tous `pass`, sur 12 runs à `876d64c`.

- Les six requis : `composition / validate`, `Composed targets pass the manifest gates of their composed governance`, `Door declaration`, `Bun quality`, `Every pinned code citation of the documents resolves`, `Negatives declaration`.
- Les autres : `Doctrine governance` (en `push` et en `pull_request`), `Licensing and contribution governance`, `Index freshness and GitHub reconciliation`, `Every repository's AGENTS.md matches its layer's template`, `No private identifiers or machine-local paths`, `Regenerate evidence feeds and fail on drift`.

La liste des contextes requis n'a pas changé (6, `gh api repos/libre-ai/project-governance/rules/branches/migrate%2Frecover-code`).

## Risques résiduels

- **La décision du propriétaire sur P1 n'est vérifiée par aucun instrument de cette revue.** Elle est relayée par la session de coordination, et inscrite par l'auteur à la l. 4 et dans le corps de la PR. La fusion par le propriétaire en est la confirmation (`AGENTS.md:73`, « a doctrine merge is a signature ») : une revue ne peut pas produire cette preuve à sa place.
- **L'exemption de `d045e11` couvre toutes les occurrences de son texte dans `REVIEW-ROUND-3.md`** (M3). Pour l'exploiter, il faudrait éditer un dossier immuable.
- **Le vert du check de citations requis dépend d'une donnée que la PR modifie.** C'est la classe mesurée par l'ADR, et la garde reste la revue.
- **`Bun quality` admet toute référence sous `docs/reviews/`, quel que soit son verdict** (`066ef494ff33:tools/quality/check-review-evidence.ts:24-27`). C'est l'issue #160.
- **Comportements de GitHub non mesurés.** Deux comportements de GitHub restent non mesurés : la résolution entre deux checks de même contexte, et le rattachement d'un run `pull_request_target`. L'hypothèse sur l'approbation des forks reste non vérifiée. C'est précisément la condition que signe la fusion.
- **Absence de signature cryptographique.** Les commits revus ne sont pas signés cryptographiquement (`unsigned`). Ils portent un trailer DCO.
- **Mesures volatiles.** Les mesures volatiles (runs, têtes de la flotte, comptages sur la branche servie) datent du 2026-10-26.

## Verdict

**`approve`** sur le commit `876d64cc8a9ad6a7230617124b8da263086451de`.

Motif :

- La preuve requise P1 est close par la décision du propriétaire telle qu'elle est relayée, sous la forme 1 du troisième tour : la fusion signe la mesure et l'écartement conditionnel d'A1, sans option retenue.
- O1 à O3 sont appliqués dans le même amendement, et le troisième tour annonçait alors `approve`.
- Aucun constat `blocking`, `major` ni `minor` n'est ouvert. Q1 à Q4 sont des suggestions qui ne conditionnent pas la fusion (ADR-0056 D2).

Les mêmes conditions valent pour le jalon du propriétaire : la fusion reste son acte explicite (protocole, « Candidate integration »).

Ce verdict n'est pas une approbation de promotion par rôle.
