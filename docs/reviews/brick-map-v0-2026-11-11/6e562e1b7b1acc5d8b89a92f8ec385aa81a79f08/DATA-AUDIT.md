
Audit en lecture seule. `git status --short` dans le worktree ne montre que `?? node_modules`, déjà présent avant mes commandes. Répertoire temporaire effacé (`scratch-clean` : 1 sur 1).

- **Commit audité** (`git rev-parse HEAD`) : `6e562e1b7b1acc5d8b89a92f8ec385aa81a79f08`
- **Ligne de volume du gate** (`bun ecosystem/check-briques.ts`, rc 0) : `Brick map verified: 118 assertion(s) hold — 99 brick(s) in 11 of 11 layer file(s) (gouvernance 16, fabrique 13, harness 12, identite 5, passerelle 4, execution 7, preuve 12, plateforme 9, exploitation 12, publication 7, produit 2); 111 tracked entry(ies) under ecosystem/briques/ = 11 layer file(s) + 99 fiche(s) + 1 README + 0 refused; status derived: decrite 25, en_cours 74, prototypee 0, retiree 0 (…); proofs held: 48 on this tree, 71 pinned, …; products: 40 … = 2 as bricks + 38 outside the map; layer rules: 3 verified (…), 8 declarative, …; origin: 87 inspection, 0 observed, 12 propre; autonomy: 37 discover, 62 modify, 0 govern; 21 brick(s) without a carrier repository, 0 transitional; 19 brick(s) outside the gouvernance layer bound by no invariant (FAB-02, PAS-01, PAS-03, EXE-01, EXE-07, PRV-01, PRV-04, PRV-07, PRV-08, PRV-09, PRV-10, PRV-11, PLT-05, PLT-07, PLT-08, EXP-02, EXP-06, EXP-07, EXP-09); 10 proof target(s) cited by more than one brick`
- **ADR non acceptés** (`grep -L 'Statut.*accepted' docs/adr/00*.md`) : 0016 (`deferred`), 0063, 0064, 0065.

Les comptes sur YAML passent par `yq -o=json '.' ecosystem/briques/*.v1.yaml | jq -s '[.[]|.couche as $c|.briques[]|.+{couche:$c}]'`, noté `J` (99 briques, 119 preuves, 135 liens d'invariant).

## Partie A — balayage des 99 briques

| # | Contrôle | Commande | Occurrences | Détail |
|---|---|---|---|---|
| 1 | Identifiant externe entre accents graves | ``grep -rnE '`(pb\|[gfhipesx])-[A-Za-z0-9][^`]*`' ecosystem/briques`` | 0 | Témoin positif : 2 lignes sur 2. Forme sans accents graves : 0. |
| 2 | Chemin machine-local | `grep -rnE '/Users/\|/tmp/\|/private/\|~/\|\$HOME\|/var/folders\|/home/' ecosystem/briques` | 0 | `grep -rn '~'` : 0. |
| 3 | Propriétaire, poste, harnais personnel | `grep -rniF 'propriétaire'` (72 occurrences), puis `grep -rnwiE 'postes?\|machines?…'`, `harnais`, `session` | 1 nette, 2 limites | Voir A3. |
| 4 | Délai, effort, appréciation | `grep -rnoiwE` sur les listes du premier audit, élargies | 0 délai planifié, 0 éloge | Voir A4. |
| 5 | ADR non accepté cité sans le dire | première phrase nommant `ADR-00NN` par fiche (`awk`) | 0 sur 30 premières mentions | ADR-0063 : 14 sur 14 disent « proposé ». ADR-0064 : 14 sur 14. ADR-0065 : 2 sur 2 disent « fusionné, statut non clos ». ADR-0016 : cité par 0 brique. |
| 6 | Invariant nommé en fiche, absent du YAML | `grep -oE 'I-[0-9]{2}'` par fiche, comparé à `.invariants` de `J` | 18 liens, 10 fiches | 18 sur 18 présentés comme voisin, absence ou dérogation ; 0 comme liant. Voir A6. |
| 7 | Absence sans périmètre ni date | `awk` par phrase sur `aucun\|rien\|n'existe\|absent\|pas encore…` : 281 phrases, dont 34 datées | 20 phrases | Voir A7. |
| 8 | Chiffre sans source dans la phrase | `awk` par phrase, identifiants, dates, `§`, versions retirés | 32 phrases à chiffre, 120 à nombre en lettres ; 4 résiduelles | Voir A8. |
| 9 | Cible de preuve partagée | `jq '[.[]\|.id as $i\|.preuve[]\|{c:.cible,i:$i}]\|group_by(.c)\|map(select(length>1))' J` | 10 cibles | 6 distinctes, 4 où deux fiches disent le même fait. Voir A9. |

**A3.**
- Occurrence nette : `plateforme.v1.yaml:124` (rôle de PLT-08) : « Livre les outils du poste d'où le propriétaire pilote les agents comme des binaires signés ».
- Limites :
  - `harness.v1.yaml:74` (rôle de HAR-05) : « Donne au propriétaire les surfaces où il voit les missions et les sessions d'agents et où il décide ».
  - `preuve.v1.yaml:62` (rôle de PRV-04) : « la clé privée ne quittant jamais la machine de son détenteur ».
- FAB-08:5 (« première utilisation réelle de la boucle documentaire par le propriétaire ») reprend ADR-0042 §3.
- Zéro pour un harnais personnel, une session du propriétaire, Claude, Codex, Cursor. « pi » n'apparaît que dans les noms de dépôt `pi-harness-challenger` et `pi-evidence`.
- Les autres occurrences de « propriétaire » désignent celui qui décide ou signe.

**A4.**
- Délai : GOV-03:16 « délai » (objet du contrôle) ; FAB-05:11 et PRD-02:16 « trop tôt » ; « échéance » 5 fois (expiration de jeton, IDN-02, IDN-05, `identite.v1.yaml:84`) ; PAS-03:17 « moins coûteux » (coût d'un modèle). Zéro pour bientôt, rapidement, prochainement, à terme, facile, semaine, mois.
- Appréciation : GOV-02:5 « exhaustive » (ADR-0008 point 7) ; HAR-12:5 « critique » (ADR-0011 D4) ; EXE-04:17 « ne rend pas fiable » ; « non fiable » 5 fois (terme d'I-32) ; « complet » 4 fois (termes d'I-06, I-27, I-28). Zéro pour robuste, puissant, simple, honnête, élégant.

**A5, hors contrôle.** Deux commentaires YAML nomment ADR-0064 sans statut à leur première mention du fichier : `gouvernance.v1.yaml:3` et `publication.v1.yaml:3`.

**A6.** EXE-01 (I-32, I-33, I-38) ; EXE-04 (I-32) ; PAS-01 (I-32, I-33) ; PAS-03 (I-33) ; PRV-01 (I-09 par dérogation, I-20) ; PRV-06 (I-34) ; PRV-07 (I-10, I-36, I-37) ; PRV-09 (I-11, I-21) ; PRV-10 (I-10) ; PRV-11 (I-09, I-18). Sens inverse : 0 invariant du YAML non nommé en fiche sur 135.

**A7.**
- Sans périmètre ni date (8) :
  - EXP-08:22 « Aucun artefact n'exerce les quatre points ci-dessus. »
  - EXP-09:9 « aucun artefact ne les exerce. »
  - PLT-03:21 « Aucun artefact n'exerce les trois points ci-dessus. »
  - FAB-07:9, HAR-09:12, HAR-11:11 « que rien ne réalise encore. »
  - PRV-12:9 « aucun code MLS ne les réalise » (périmètre et date donnés ligne 5).
  - HAR-03:5 « Le registre des outils admis n'est pas écrit. » (périmètre et date dans la phrase suivante).
- Périmètre sans date (12) :
  - EXE-04:9 « Aucune de ces fermetures n'est réalisée dans un dépôt de l'inventaire. »
  - FAB-13:5 « le générateur de la page vision n'existe pas dans ce dépôt ».
  - PLT-07:23 « `docs/apps/` en est absent ».
  - PLT-05:23 « où aucun gate ne la lit ».
  - « Aucune de ces fermetures n'est réalisée : la brique n'a ni dépôt porteur ni preuve. » à la ligne 9 de EXE-03, IDN-03, PAS-01, PAS-04, PRV-08, PRV-09, PRV-10, PRV-11.

**A8.** Résiduelles :
- PLT-07:21 « la note de 1 Mio du corpus » : aucune source.
- HAR-10:22 « 54 cas, comptés au commit lu » : pas de commande.
- GOV-08:10 « le gate exige au moins trois codes de refus distincts » : gate non nommé.
- PUB-03:5 « trois sources » : contredit par la preuve citée (partie B).
- Rejoué : HAR-01:5 et HAR-03:5 « 103 schémas » ; `gh api …/git/trees/ce464c21…?recursive=1` compte 103 fichiers `contracts/schemas/*.schema.json`, aucun nom ne contient `regist`.

**A9.**

| Cible | Briques | Verdict |
|---|---|---|
| `.github/workflows/reusable-licensing.yml` | FAB-09, PUB-05 | distinct |
| `ecosystem/check-context-conformance.ts` | GOV-06, HAR-08 | distinct |
| `ecosystem/check-inventory-drift.ts` | GOV-03, PLT-06 | même fait (archivage constaté), limites propres |
| `tools/quality/check-pr-door.ts` | EXP-11, FAB-06 | distinct |
| `tools/quality/check-review-evidence.ts` | FAB-12, GOV-01 | même chose : FAB-12 ne dit pas ce que le gate montre d'une décision tenue comme donnée |
| `verification/sovereignty/forge-restore.ts` | EXP-04, GOV-15 | même fait, limites propres |
| `ai-work-supervision@7a0afef5:…/coordination.rs` | FAB-01, HAR-07 | distinct |
| `execution-continuity-evaluator@02ff8561:…/graph.rs` | FAB-10, HAR-09 | même fait ; chacune dit qu'il ne montre pas l'usage par l'autre côté |
| `…@02ff8561:src/tool_observation.rs` | EXP-01, HAR-03, PRV-05 | EXP-01 et PRV-05 : même phrase ; HAR-03 distinct (`tool-undeclared`) |
| `schemas-and-contracts@ce464c21:…/execution-plan-body.v2.schema.json` | PAS-02, PAS-03 | distinct |

## Partie B — 22 briques

Légende : (1) invariants ; (2) ADR et registre ; (3) preuves locales ; (4) preuves épinglées ; (5) « ferme » contredit ; (6) invérifiable ; (7) dépendances. Les 24 dates de preuve de l'échantillon égalent la date du commit (`git log -1 --format=%cs` ou `gh api repos/…/commits/<sha>`).

**GOV-03**
1. I-14 lie (« l'inventaire machine-lisible fait foi ») ; I-17 lie (« activations ») ; I-27 lie par contrainte (« ne s'évalue jamais avant que le jalon dogfooding… soit atteint »), exercé par aucune preuve.
2. Conformes : ADR-0042 §1 et §3, D53, D76, D80, D94, ADR-0064 D2. La levée pour P02 est dans ADR-0054 (`0054:37` et `:69`) ; D89 consigne le dépôt dédié.
3. `check-inventory-drift.ts` réalise le constat d'archivage dans les deux sens. Mesure exacte, y compris « non vérifiable » pour une entrée privée et active (en-tête, lignes 16-26).
4. Aucune.
5. Non. Deux puces sur trois ne sont montrées par aucune preuve ; la Mesure le dit pour les faits de dégel.
6. Aucune.
7. GOV-01 fondée.

**GOV-04**
1. Liste vide.
2. Conformes : ADR-0042 §1 (`0042:39`), ADR-0063 (`0063:49`).
3. Aucune.
4. `evaluator.rs` réalise le verdict : `approverId != proposedBy`, `actorKind = human` (lignes 171-190), `unknown` → `indeterminate` ou `ineligible`. La fiche du dépôt porteur écrit « historical evidence is not qualification of this tree ». Écart de mot : la fiche dit que l'évaluateur « refuse » une source future ou trop ancienne ; le module classe la règle `unknown`.
5. Non.
6. Aucune.
7. GOV-01 fondée.

**GOV-16**
1. Liste vide.
2. ADR-0063 conforme (`0063:49`). « aucun fichier de `docs/adr` ne porte cet ADR » rejoué.
3. Aucune.
4. Aucune.
5. Non (« aucune n'est en vigueur »).
6. Aucune ; la règle est dite proposition de l'agent.
7. GOV-04 et GOV-05 fondées.

**FAB-03**
1. I-08 lie : le workflow de doctrine écrit « apps/** touched without a WP-… reference … (invariant I-08) » (`doctrine-governance.yml:44`).
2. ADR-0042 §3 (« Ordre de réalisation, par dépendances », `0042:85`) et D53 conformes. Cet ordre porte sur les produits ; la fiche l'applique aux tranches.
3. `prd-model.ts` réalise la lecture fermée de la table des lots. Mesure exacte.
4. `outline.rs` réalise : dépendance inconnue, dupliquée ou cyclique refusée, `demonstrates` vide refusé (lignes 137-172). Mesure exacte.
5. Non. « Une tranche attend celles dont elle dépend » n'est pas montré ; la Mesure le dit.
6. Une, au YAML : `preuve_produite` décrit un plan où « chaque tranche porte ses critères, son périmètre, sa commande de vérification et ses dépendances ». La table des lots (`WORK-PACKAGES.md`) n'a pas de colonne de dépendance ; `Slice` n'a que `key`, `demonstrates`, `after`. Aucun artefact n'a cette forme, et le rôle ajoute « par les preuves qui manquent ».
7. FAB-01 fondée.

**FAB-04**
1. I-13 lie (D52) ; I-21 lie (ADR-0042 §5 : « le dépôt ne contient aucune donnée d'instance »).
2. D52, D53, D55, ADR-0042 §1, §3, §5 conformes.
3. Aucune.
4. `model.rs` réalise : 11 états, `RealAgentForbiddenUntilC0`, refus d'un résultat sans commit, évidence ou résumé. Mesure exacte.
5. Non.
6. Aucune.
7. HAR-02 et PRV-01 fondées.

**HAR-03**
1. I-32 voisin : il porte sur « un modèle qui détient un outil à effet » et sur la « politique déterministe » d'argument, pas sur un registre. I-38 voisin : cité dans « Ce qu'elle ne fait pas » (« Elle n'installe rien »).
2. ADR-0045 (`0045:26` : « Chaque outil porte déjà un `argumentPolicyDigest` »), ADR-0046 et D67, ADR-0056 D4 conformes.
3. Aucune.
4. `tool_observation.rs` rend `tool-undeclared` (lignes 343, 506-511) et déclare « It blocks nothing ». La Mesure écrit qu'il ne montre « ni un registre, ni une empreinte par outil, ni une classe de données, ni un refus avant l'appel », soit aucun élément du rôle. Preuve voisine, Mesure exacte.
5. Non contredit, mais non montré : les trois puces sont à l'indicatif, sans la réserve que portent huit autres fiches.
6. Aucune. `grep -rlniE "registre d.outils|tool registry"` hors carte : 0.
7. GOV-05 faible : contrôle croisé, pas une condition de fonctionnement.

**HAR-04**
1. I-32 lie (« une politique déterministe juge chaque argument d'appel d'outil… et refuse fermé ») ; I-17 lie (« mutations des garde-fous »).
2. ADR-0045 et D66 conformes.
3. Aucune.
4. `policy.mjs` et son test réalisent le classement R0 à R3 ; `DEFAULT_MODE` vaut `observe` (test ligne 28). Mesure exacte.
5. Non. Le garde cité ne bloque pas par défaut ; la Mesure le dit.
6. Aucune ; le taux de faux positifs est dit proposition.
7. HAR-03 fondée.

**IDN-03**
1. I-09 voisin : la fiche écrit que la racine « ajouterait une séparation cryptographique au "tenant obligatoire" d'I-09 » et que ce tenant « est porté par IDN-02 ».
2. D15, D55, D61, ADR-0042 §5 conformes. « Dans chaque jeton interne » vient de D15 ; ADR-0002 §1 ne parle que de l'espace personnel côté serveur.
3. Aucune.
4. Aucune.
5. Non (réserve écrite).
6. Aucune.
7. IDN-02 fondée.

**IDN-04**
1. I-18 lie ; I-09 lie (sous-composant « identité agent »).
2. ADR-0018 (`0018:12`), K1 conformes. Les deux contrats sont `locked` au catalogue du commit cité (`catalog.v1.json`).
3. Aucune.
4. `authority-v2.datalog` et `agent-runs-v2.datalog` réalisent. Mesure exacte. Le test de refus entre flottes existe à la tête de `capability-authorization` (`tests/authz.rs:1401`). « deux workflows » rejoué : 2.
5. Non.
6. Aucune.
7. IDN-02 fondée.

**PAS-03**
1. Liste vide.
2. ADR-0034 (`0034:155`, `:202`), D40, D42, ADR-0046 (`0046:58`) conformes.
3. Aucune.
4. Le schéma porte les huit bornes ; `budget.rs` rend `plan-budget-exceeded`. Mesure exacte.
5. Non.
6. Aucune ; l'énergie est dite sans source.
7. GOV-07 fondée.

**PAS-04**
1. I-21 lie par contrainte.
2. D52, D99 (`0058:51`), ADR-0063 (`0063:11`) conformes. Inventaire : « model selection under explainable policy ».
3. Aucune.
4. Aucune.
5. Non (réserve écrite).
6. Aucune.
7. PAS-01, PAS-02, GOV-04 fondées.

**EXE-03**
1. I-21 lie ; I-07 lie pour la variante hébergée ; I-10 voisin : son sujet est le cycle de vie des données, la fiche l'étend à la disponibilité hors ligne d'une inférence.
2. ADR-0065 (`0065:52`) et ADR-0063 conformes. Omission : `0063:50` écrit que ce choix et la forme de la passerelle « relèvent de la couche `passerelle` » ; la brique est en couche `execution` et la fiche ne le dit pas.
3. Aucune.
4. Aucune.
5. Non.
6. Aucune. Absence rejouée : `gh api search/code?q=filename:<mot>+org:libre-ai` rend 0 pour les six mots.
7. PAS-04 faible : un serveur sert sans routeur ; la liste des admis vient de GOV-04, et la table D1 n'admet pas `execution` → `gouvernance`.

**EXE-04**
1. I-06 lie (« Rust pour moteurs spécialisés »).
2. ADR-0054 §1 (`0054:31`), D85, ADR-0042 §3, ADR-0054 (`:22`) conformes.
3. Aucune.
4. Aucune.
5. Non.
6. Une : « Aucune de ces fermetures n'est réalisée dans un dépôt de l'inventaire. », sans date ni commande.
7. EXE-01 fondée.

**PRV-03**
1. I-20 lie (« rapports signés »).
2. D57, D98, ADR-0042 §8, ADR-0057 §4 conformes.
3. Aucune.
4. `index.ts` réalise (Ed25519, `LineageIntegrityError`, clé en paramètre) ; `signer.ts` réalise (`ssh-keygen -Y sign`). Mesure exacte.
5. Non.
6. Aucune.
7. PRV-04 fondée.

**PRV-04**
1. Liste vide.
2. ADR-0028 §2.7, D35, ADR-0046 conformes.
3. `keygen-ceremony.ts` réalise génération et chiffrement. La Mesure dit « écrits et testés » ; le test écrit « NO test seals or unseals private keys » et n'importe pas l'outil (deux imports, `bun:test` et `node:crypto`).
4. Aucune.
5. Oui. « L'outil ne l'écrit sur disque que scellée » : hors `--dev-key`, la phrase de passe est `process.env.KEYGEN_TEST_PASSPHRASE || "placeholder-passphrase-replace-with-yours"`, sans saisie. Le mode opératoire renvoie à `--reseal-with-passphrase` (ligne 136) ; l'outil ne lit que `--dev-key` et `--public-key-only` (lignes 91-92).
6. Aucune ; `git ls-files | grep -c signing-keys` rejoué : 0.
7. Aucune dépendance.

**PLT-03**
1. I-12 lie (« GitHub = forge canonique ») ; I-20 lie (« releases liées à leur évidence »).
2. ADR-0042 §8 (`0042:226-229`), D81, D98, ADR-0064 D7 conformes.
3. Aucune.
4. Aucune.
5. Non.
6. Aucune. Rejoué : `gh api repos/libre-ai/<dépôt>/releases --jq length` rend 0 pour les trois dépôts.
7. PLT-04 et PRV-03 fondées.

**PLT-04**
1. I-28 lie (« épinglée par SHA complet, jamais une branche ») ; la fiche dit qu'aucune preuve ne l'exerce.
2. ADR-0001 point 3, ADR-0049 (`0049:41-43`), D71, D37 conformes.
3. `check-release-age.ts` et `check-toolchain-source.ts` réalisent. Mesure exacte.
4. Aucune.
5. Non.
6. Aucune.
7. Aucune dépendance.

**EXP-03**
1. I-18 lie (« données `operational` jamais autorité »).
2. ADR-0011 D6 (`0011:49-65`) et D32 conformes. `orchestrator-event.v3` est `locked` et porte sept compteurs, sans énergie.
3. Aucune.
4. Aucune.
5. Non.
6. Aucune.
7. PAS-03, PRV-01, EXP-07 fondées par le rôle ; l'énergie n'a pas de source de doctrine, la fiche le dit.

**EXP-04**
1. I-12 lie ; I-20 lie (rapport en artefact et en résumé de job, `sovereignty-report.yml:46-52`).
2. ADR-0001 point 10, D03, ADR-0041 §3 (`0041:46-47`), D48 conformes.
3. `forge-restore.ts` réalise (`bundle create … HEAD`, `clone`, comparaison du commit et de l'arbre) ; le workflow planifié l'exécute (`cron: "23 5 * * 3"`). Mesure exacte.
4. Aucune.
5. Non.
6. Aucune.
7. Aucune dépendance.

**EXP-12**
1. I-11 lie (REUSE) ; I-21 lie (« garde-fou exécutable »).
2. ADR-0004 point 5, D23, ADR-0012 D1 et D4 conformes.
3. `check-personal-data-boundary.ts` réalise le refus ; il déclare ne pas reconnaître un nom en prose. Mesure exacte.
4. Aucune.
5. Non.
6. Aucune.
7. PAS-02 fondée.

**PUB-03**
1. I-05, I-15, I-29, I-37 lient. La Mesure écrit que l'application d'I-15 et l'assertion d'I-37 ne sont pas montrées.
2. ADR-0033 (`0033:106`, `:116`) et ADR-0035 conformes.
3. Aucune.
4. `build-site.ts` et `website.e2e.ts` réalisent. Mesure exacte (`brand: brandProjection.copy.fr` ; aucun `csp` dans la suite ; décision 0003 du dépôt porteur : « Le site diverge de son autorité »).
   - Contexte inexact : « trois sources ». Le générateur vérifie aussi des copies de licences (lignes 47-66) et un document de déploiement (lignes 68-82), puis lit les présentations.
5. Non.
6. Aucune.
7. PUB-02 et PUB-07 fondées.

**PUB-04**
1. I-20 lie ; I-05 lie.
2. ADR-0009 §7 conforme.
3. `build-feeds.ts` et `feeds-freshness.yml` réalisent. Mesure exacte.
4. Aucune.
5. Non.
6. Aucune.
7. PRV-02 et PRV-03 décoratives : le rôle écrit (un journal et deux flux) fonctionne sans elles, et les preuves le montrent.

### Synthèse

| Brique | Invariants (lie / voisin / sans rapport) | Décisions (conforme / déformée) | Preuves (réalise / mentionne / gonflée) | « Ferme » contredit | Invérifiables | Dépendances (fondée / décorative) |
|---|---|---|---|---|---|---|
| GOV-03 | 3 / 0 / 0 | 10 / 0 | 1 / 0 / 0 | non | 0 | 1 / 0 |
| GOV-04 | 0 / 0 / 0 | 2 / 0 | 1 / 0 / 0 | non | 0 | 1 / 0 |
| GOV-16 | 0 / 0 / 0 | 1 / 0 | aucune | non | 0 | 2 / 0 |
| FAB-03 | 1 / 0 / 0 | 2 / 0 | 2 / 0 / 0 | non | 1 (champ YAML) | 1 / 0 |
| FAB-04 | 2 / 0 / 0 | 4 / 0 | 1 / 0 / 0 | non | 0 | 2 / 0 |
| HAR-03 | 0 / 2 / 0 | 4 / 0 | 0 / 0 / 0, 1 voisine | non | 0 | 0 / 1 |
| HAR-04 | 2 / 0 / 0 | 2 / 0 | 2 / 0 / 0 | non | 0 | 1 / 0 |
| IDN-03 | 0 / 1 / 0 | 5 / 0 | aucune | non | 0 | 1 / 0 |
| IDN-04 | 2 / 0 / 0 | 2 / 0 | 2 / 0 / 0 | non | 0 | 1 / 0 |
| PAS-03 | 0 / 0 / 0 | 5 / 0 | 2 / 0 / 0 | non | 0 | 1 / 0 |
| PAS-04 | 1 / 0 / 0 | 5 / 0 | aucune | non | 0 | 3 / 0 |
| EXE-03 | 2 / 1 / 0 | 3 / 0 (1 omission) | aucune | non | 0 | 0 / 1 |
| EXE-04 | 1 / 0 / 0 | 4 / 0 | aucune | non | 1 | 1 / 0 |
| PRV-03 | 1 / 0 / 0 | 5 / 0 | 2 / 0 / 0 | non | 0 | 1 / 0 |
| PRV-04 | 0 / 0 / 0 | 3 / 0 | 1 / 0 / 1 | oui | 0 | aucune |
| PLT-03 | 2 / 0 / 0 | 6 / 0 | aucune | non | 0 | 2 / 0 |
| PLT-04 | 1 / 0 / 0 | 5 / 0 | 2 / 0 / 0 | non | 0 | aucune |
| EXP-03 | 1 / 0 / 0 | 2 / 0 | aucune | non | 0 | 3 / 0 |
| EXP-04 | 2 / 0 / 0 | 4 / 0 | 2 / 0 / 0 | non | 0 | aucune |
| EXP-12 | 2 / 0 / 0 | 3 / 0 | 1 / 0 / 0 | non | 0 | 1 / 0 |
| PUB-03 | 4 / 0 / 0 | 2 / 0 | 2 / 0 / 0 (Contexte inexact) | non | 0 | 2 / 0 |
| PUB-04 | 2 / 0 / 0 | 1 / 0 | 2 / 0 / 0 | non | 0 | 0 / 2 |
| **Totaux** | **29 / 4 / 0** (33) | **80 / 0** | **23 / 0 / 1**, 1 voisine (24 : 10 locales, 14 épinglées) | **1** | **2** | **24 / 4** (28) |

## Taux résiduel

Briques de l'échantillon portant au moins un défaut de fond : **7 sur 22**. Les deux étages ne se somment pas sans le dire.

- Mesuré contre une source ou un artefact : 4.
  - PRV-04 : « ferme » contredit et Mesure gonflée.
  - PUB-03 : décompte contredit par la preuve citée.
  - EXE-04 : absence sans date ni commande.
  - FAB-03 : champ `preuve_produite` sans artefact de cette forme.
- Classement de lecture, invariant voisin gardé : 3 (HAR-03, IDN-03, EXE-03).

Premier audit, d'après son tableau de synthèse (au moins un voisin, un sans rapport, un invérifiable ou une liste « ferme » contredite) : **18 sur 22**. Les quatre sans défaut au tableau sont GOV-02, IDN-01, IDN-02, PLT-02. Son tableau n'a pas de colonne de décisions ; en ajoutant les déformations de son texte pour IDN-01 et IDN-02, 20 sur 22.

Liens d'invariant voisins ou sans rapport : 4 sur 33 ici, 24 sur 59 au premier audit.

## Corrections recommandées

**Bloquant** (contredit par la source ou par la preuve citée)
1. **PRV-04**, Mesure. « Il montre une génération et un scellement écrits et testés. » → « Il montre une génération et un chiffrement écrits. Son fichier de test n'importe pas l'outil et déclare ne sceller aucune clé. »
2. **PRV-04**, « Ce que la brique ferme », 1re puce. « …et l'outil ne l'écrit sur disque que scellée. » → « …et l'outil ne l'écrit sur disque que chiffrée. Au commit lu, hors mode de test, la phrase de passe est une valeur d'attente écrite dans le code, et l'option de rescellement que le mode opératoire nomme n'est pas lue par l'outil. »
3. **PUB-03**, Contexte. « le générateur dérive les pages de trois sources : … » → « le générateur dérive les pages de copies épinglées, refusées si elles s'écartent de leurs empreintes (fiches de projet, fichiers de licences, document de déploiement), de la projection de marque et du portefeuille de l'autorité ».

**Majeur**
4. **HAR-03**, YAML `invariants` : retirer I-32 et I-38. Fiche : « Aucun invariant du registre ne lie la brique : I-32 porte sur le modèle qui détient un outil à effet, I-38 sur l'installation live ; ils sont voisins et ne sont pas cités. »
5. **HAR-03**, champ `preuve` : retirer `tool_observation.rs`, ou ouvrir « Ce que la brique ferme » par « Aucune de ces fermetures n'est réalisée ». Le statut dérivé changerait avec le retrait.
6. **IDN-03**, YAML `invariants` : retirer I-09. Avec HAR-03, le compteur « bound by no invariant » passerait de 19 à 21.
7. **EXE-03** :
   - retirer I-10 du YAML ;
   - ajouter au Contexte « ADR-0063 renvoie ce choix à la couche `passerelle` ; la carte le range en `execution` par la règle d'ADR-0064 D1 » ;
   - réécrire ou retirer la dépendance PAS-04.
8. **EXE-04:9** : « …dans un dépôt de l'inventaire » → la formule des huit autres fiches, ou le périmètre lu, sa date et sa commande.
9. **A7**, six phrases sans périmètre : EXP-08:22, EXP-09:9, PLT-03:21 → « Aucune preuve citée ici n'exerce… » ; FAB-07:9, HAR-09:12, HAR-11:11 → « que cette fiche ne cite réalisé nulle part ».
10. **PUB-04** : retirer PRV-02 et PRV-03 de `depend_de`, ou écrire au rôle la clause d'I-20 qu'elles servent.
11. **FAB-03**, `preuve_produite` : « Le plan de tranches validé, où chaque tranche nomme ce qu'elle démontre et celles qu'elle attend » ; retirer « par les preuves qui manquent » du rôle ou le dire proposition de l'agent.
12. **Cibles partagées** : FAB-12, PRV-05 ou EXP-01, HAR-09 ou FAB-10, GOV-15 ou EXP-04 : écrire ce que l'artefact montre pour la brique, pas la phrase de l'autre fiche.

**Mineur**
13. GOV-04 : « l'évaluateur refuse une date de collecte future… » → « l'évaluateur classe la règle `unknown` pour une date de collecte future… ».
14. IDN-03 : « ADR-0002 §1 et D15 rendent… » → « D15 rend le tenant opaque obligatoire dans chaque jeton interne ; ADR-0002 §1 l'impose à tout espace personnel côté serveur ».
15. PLT-08, rôle : « Livre les outils du poste d'où le propriétaire pilote les agents… » → « Livre les outils de pilotage des agents… ».
16. `gouvernance.v1.yaml:3` et `publication.v1.yaml:3` : ajouter « proposé » après « ADR-0064 D1 ».
17. PLT-07:21 : sourcer « 1 Mio » ou le retirer. HAR-10:22 : donner la commande du compte. GOV-08:10 : nommer le gate.
18. HAR-03 : retirer GOV-05 de `depend_de` ou dire que c'est un contrôle croisé.

## Ce que l'audit exclut par construction

- Le code du gate ; les 77 briques hors échantillon pour le fond ; les 95 preuves hors échantillon (119 − 24).
- Preuves épinglées : en-têtes, signatures publiques et recherches ciblées, pas chaque ligne ; aucun test exécuté. Trois fichiers non cités ont été lus pour recouper : `config.mjs`, `presentation.ts` et la décision 0003 de `project-website`.
- Le test de `capability-authorization` et les trois comptes de releases sont lus à la tête du jour, pas à un commit épinglé.
- Absences datées : 4 rejouées sur 34 (103 schémas, noms de fichiers d'EXE-03, releases de PLT-03, `signing-keys`). L'index de recherche de code de la forge peut retarder.
- Dépôts privés, rulesets, historique Actions, tout ce qui vit sous l’autre contexte.
- A1 ne reconnaît que les neuf préfixes du mandat ; A3 et A4 reposent sur des listes de mots ; A7 sur des motifs de négation, une tournure hors motif échappe au compte.
- Le classement lie, voisin, fondée ou décorative est un jugement de lecture appuyé sur la phrase citée. Les limites les plus discutables : I-10 pour EXE-03, I-12 pour PLT-03, I-27 pour GOV-03, la dépendance EXE-03 → PAS-04.
- Les décisions sont vérifiées par les phrases qui leur attribuent un contenu ; une décision du YAML que la fiche nomme sans rien lui faire dire n'est pas jugée.
