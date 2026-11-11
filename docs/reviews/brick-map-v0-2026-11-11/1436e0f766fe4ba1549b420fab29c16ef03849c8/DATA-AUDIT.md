
Audit en lecture seule, rien écrit dans le worktree. `git status --short` y montre une entrée non suivie, `node_modules`, que je n'ai pas créée (aucune installation lancée). Le répertoire temporaire de l'audit est effacé (`scratch-clean` : 1 sur 1).

- **Commit audité** (`git rev-parse HEAD`) : `1436e0f766fe4ba1549b420fab29c16ef03849c8`
- **Ligne de volume du gate** (`bun ecosystem/check-briques.ts`) : `Brick map verified: 118 assertion(s) hold — 99 brick(s) in 11 of 11 layer file(s) (gouvernance 16, fabrique 13, harness 12, identite 5, passerelle 4, execution 7, preuve 12, plateforme 9, exploitation 12, publication 7, produit 2); 122 entry(ies) under ecosystem/briques/ = 11 layer file(s) + 11 layer directory(ies) + 99 fiche(s) + 1 README + 0 refused; status derived: decrite 25, en_cours 74, prototypee 0, retiree 0 (…); proofs held: 48 on this tree, 72 pinned and left to the pinned-citations gate; products: 40 in the catalogue of ADR-0042 §1 = 2 as bricks + 38 outside the map; layer rules: 3 verified (gouvernance, fabrique, produit), 8 declarative, not verified by this gate; origin: 87 inspection, 0 observed, 12 propre; autonomy: 37 discover, 62 modify, 0 govern; 21 brick(s) without a carrier repository, 0 transitional; 3 brick(s) outside the gouvernance layer bound by no invariant (EXE-07, PRV-10, PLT-07); 10 proof target(s) cited by more than one brick`

Racine des chemins cités : `<worktree de revue>`. Les comptes sur YAML passent par `yq -o=json '.' ecosystem/briques/*.v1.yaml | jq -s '[.[]|.couche as $c|.briques[]|.+{couche:$c}]'`, noté `J` ci-dessous ; les 99 briques et 120 preuves y sont retrouvées.

## Partie A — balayage des 99 briques

| # | Contrôle | Commande | Occurrences | Détail |
|---|---|---|---|---|
| 1 | Identifiants externes entre accents graves | ``grep -rnE '`(pb\|[gfhipesx])-[A-Za-z0-9][^`]*`' ecosystem/briques --include='*.md'`` | 0 | Contrôle positif : le motif attrape 2 lignes sur 2 d'un témoin. Forme sans accents graves, fiches et YAML : 0. |
| 2 | Chemins machine-locaux | `grep -rnE '/Users/\|/tmp/\|/private/\|~/\.claude\|l’autre contexte\|~/Documents\|\$HOME\|/var/folders\|/home/' ecosystem/briques` | 0 | Tilde général `(^\|[^A-Za-z0-9])~/` : 0. |
| 3 | Noms d'entreprise, de produit, d'hébergeur | `grep -rhoE -- "<nom>" ecosystem/briques/*/*.md ecosystem/briques/*.yaml \| wc -l` par nom | liste ci-dessous | Sans jugement. |
| 4 | Chiffres | `awk` qui retire accents graves, identifiants, dates et `§N`, puis garde les lignes à chiffre ; `grep -niwE '(deux\|trois\|…\|zéro)'` pour les nombres en lettres | 27 lignes à chiffres sur 20 fiches ; 73 lignes à nombre en lettres | Liste ci-dessous. |
| 5 | Délai, effort, appréciation | `grep -rnoiE` sur les deux listes du mandat, élargies | délai 1, « délai » objet de mesure 3, appréciation 5 | Liste ci-dessous. |
| 6 | Fiches hors 120–300 mots | `grep -vE '^#{1,6} ' f \| wc -w` | 2 | PRD-02 = 393, PRD-15 = 313. Minimum 218 (HAR-04, HAR-10). En ne comptant que les jetons alphanumériques : PRD-02 = 369, PRD-15 = 291, soit 1 seule fiche hors bornes. Le gate ne contrôle pas ces bornes (`grep -nE '\b(120\|300)\b\|words\|mots' ecosystem/briques.ts ecosystem/check-briques.ts` : aucune ligne). |
| 7 | Preuve citée par plusieurs briques | `jq '[.[]\|.id as $i\|.preuve[]\|{c:.cible,i:$i}]\|group_by(.c)\|map(select(length>1))' J` | 10 cibles | Liste ci-dessous ; égal au compteur du gate. |
| 8 | ADR proposé cité sans que la fiche le dise | `grep -L 'Statut.*accepted' docs/adr/00*.md`, puis par brique : phrase nommant l'ADR, recherche de `propos` | 96 briques sur 99 | Détail ci-dessous. |
| 9 | `depend_de` jamais nommé dans la fiche | `jq -r '.[]\|.id as $i\|.couche as $c\|.depend_de[]\|"\($i) \($c) \(.)"' J`, puis `grep -qF` | 30 dépendances sur 125, 23 briques | Aucune des 30 n'est nommée non plus par son `nom`. |

**A3 — noms relevés (occurrences / fichiers).**
- Hébergeur et forge : Clever Cloud 1/1 (EXE-02:5) ; GitHub 3/2 (EXP-04:5, EXP-04:15, GOV-15:5).
- Éditeurs et produits tiers : Apple 2/2 (PLT-03:5 « compte Apple Developer », PLT-08:15) ; Chrome 1 et Firefox 1 (PLT-05:5) ; Playwright 1 et WebKit 1 (PLT-07:21) ; OpenTelemetry 1 (EXP-05:5) ; LangGraph 2/2 (FAB-10:5, `fabrique.v1.yaml:157`) ; Flatpak 1 (PLT-03:5) ; Tauri 8/5 ; Bun 1 (PLT-04:5) ; Swift 1 (PLT-01:22).
- Systèmes et langages : macOS 21/8 ; Linux 9/7 ; Windows 2/2 (PRD-02:19, `produit.v1.yaml:30`) ; Rust 21/14 ; TypeScript 4/4 ; JavaScript 2/1 (PUB-03).
- Outils et bibliothèques : Biscuit 3/2 et `biscuit-auth` (IDN-02:5, :12) ; `cargo-deny` 1 (PLT-04:5) ; `codesign`, `spctl` (PRV-03:22) ; REUSE 5/2.
- Normes : RGAA 8 lignes, dont deux noms de brique (PLT-07, PUB-03) ; WCAG 1 (PUB-03:22) ; MLS 10 ; OIDC 6 ; Ed25519 6.
- Produits internes : Work Supervision 13/11 ; Square Control 1 (GOV-03:5) ; Notebook 2/1 (PLT-05) ; `pi-harness-challenger` 9/4 ; `pi-evidence` 4.
- Zéro occurrence pour Anthropic, Claude, OpenAI, Codex, Mistral, Google, Microsoft, AWS, Azure, Cloudflare, Scaleway, OVH, Hetzner, Docker.
- PLT-07:5 écrit lui-même : « Le nom de la brique cite le RGAA, que ni un invariant ni un ADR de ce dépôt ne nomme. »

**A4 — chiffres.**
- 19 des 27 lignes à chiffres ne portent qu'un identifiant, une version, un algorithme ou une licence : EXE-01:5 ; FAB-04:5, :10, :22 ; HAR-03:5 ; HAR-08:24 ; IDN-02:5 ; IDN-04:5 ; PAS-02:16 ; PLT-01:10 ; PLT-02:5 ; PLT-09:5, :23 ; PRV-01:5 ; PRV-03:5 ; PRV-04:5, :12 ; PRD-02:5 ; PRD-15:26.
- Quantités avec source citée, retrouvée à la source :

| Fiche:ligne | Chiffre | Source retrouvée |
|---|---|---|
| FAB-04:23, FAB-08:5, GOV-14:5, GOV-14:23, HAR-05:24 | « dix missions consécutives » | ADR-0042 §3 |
| HAR-09:22 | « 54 selon ADR-0037 D3 » | `docs/adr/0037-…md:62` |
| PLT-02:11 | « 512 MiB à défaut (D92, D98) » | registre, lignes D92 et D98 |
| PLT-07:5 | « 100 % », « 0,54 % » | ADR-0057 §3 ; `docs/adr/0044-…md:20,47` |
| PRV-12:5 | « RFC 9420 » | I-34 |
| HAR-04:5 | « quatre niveaux, de R0 à R3 » | `docs/security/TOOL-CALL-RISK-CLASSIFICATION.md:15-25` |
| HAR-10:5 | « ADR-0036 en verrouille onze » | D42 |
| GOV-12:11 | « quatre conditions d'ADR-0012 D2 » | `docs/adr/0012-…md:37` |
| GOV-09:9, :21 | « deux échecs consécutifs (ADR-0029) » | `docs/adr/0029-…md:238-243` |
| PLT-01:17 | « six conditions d'entrée d'ADR-0065 §2 » | ADR-0065 §2, D105 |
| PLT-05:5, PRD-02:5, PRD-02:25 | trois surfaces, trois navigateurs, trois largeurs, deux navigateurs réels | ADR-0054 §3, D90 |
| FAB-02:5, :21 | « cinq lignes / cinq champs » | schéma, `charte.required` |
| FAB-12:5, HAR-07:5 | « deux à quatre options » | I-24 |
| IDN-04:5, :22 | « trois faits d'identité » | I-18 |
| HAR-12:5, :21 | « trois valeurs » | schéma `autonomie` (ADR-0064 D2, proposé) |
| EXP-08:5 | « commercial en deux sens (D81) » | D81 |
| GOV-03:5 | « deux dépôts hors catalogue sont sortis » | D80 |

- Source citée mais non rouverte : FAB-06:18 « trois négatives (ADR-0056 D5) ».

- Quantité contredite par sa source (hors échantillon) : GOV-03:5 « Deux levées existent : ADR-0052 pour Square Control (D76) et ADR-0055 pour `signalement` (D94). » D94 dit : « l'ordre d'ADR-0042 §3, le jalon B′ et le moratoire restent inchangés » et « sans création de dépôt ». `docs/adr/0054-…md:37` dit : « Le présent ADR lève le moratoire d'ADR-0042 §3 pour le seul dépôt produit de P02 ».
- Quantités sans source dans la phrase :
  - PUB-02:21 « au relevé du 2026-11-11, les quatre dernières exécutions planifiées de ce contrôle sont en échec » : daté, sans commande, non vérifiable depuis l'arbre.
  - PLT-01:5 « Deux dépôts portent un cœur aujourd'hui ».
  - PRV-03:5 « Deux modules signent aujourd'hui… Aucun binaire de la flotte n'est signé ni notarisé ».
  - EXP-05:22 « Ses deux versions candidates ».
  - PUB-04:5 « un journal et deux flux ».
  - IDN-02:5 « rotation à deux clés » (présent dans `auth.v1` : « Two-key rotation », non cité).
  - GOV-08:10 « au moins trois codes de refus stables » (présent dans `tools/quality/check-specification-lock.ts:66`, non cité).
  - PLT-07:21 « note de 1 Mio ».
  - PUB-03:22 « WCAG 2.2 AA ».
- Le reste des 73 lignes à nombre en lettres est une énumération dont les éléments sont nommés dans la phrase, ou un faux positif : « neuf » = nouveau (HAR-02:5, PUB-02:11, :21) ; « zéro » = « produit zéro » ou « remis à zéro » (FAB-04:5, GOV-01:5, GOV-09:5, PAS-03:10).

**A5.**
- Délai : `exploitation/EXP-04.md:5` « chaque semaine » (périodicité d'un contrôle).
- « délai » comme grandeur mesurée : `harness/HAR-07.md:5`, `identite/IDN-05.md:12`, `harness.v1.yaml:106`.
- Zéro pour bientôt, rapidement, jours, mois, prochainement, à terme, facile.
- Appréciation : zéro pour robuste, puissant, simple, honnête, élégant.
- « complet/complète » : EXP-12:23, FAB-05:12, PAS-01:10, `fabrique.v1.yaml:122`. « exhaustive » : GOV-02:5 (reprise d'ADR-0008).
- « fiable » n'apparaît que dans « non fiable », terme d'I-32.

**A7 — cibles partagées.**

| Cible | Briques |
|---|---|
| `.github/workflows/reusable-licensing.yml` | FAB-09, PUB-05 |
| `ecosystem/check-context-conformance.ts` | GOV-06, HAR-08 |
| `ecosystem/check-inventory-drift.ts` | GOV-03, PLT-06 |
| `tools/quality/check-pr-door.ts` | EXP-11, FAB-06 |
| `tools/quality/check-review-evidence.ts` | FAB-12, GOV-01 |
| `verification/sovereignty/forge-restore.ts` | EXP-04, GOV-15 |
| `ai-work-supervision@7a0afef5…:crates/work-supervision-domain/src/coordination.rs` | FAB-01, HAR-07 |
| `execution-continuity-evaluator@02ff8561…:src/authorized_execution/graph.rs` | FAB-10, HAR-09 |
| `execution-continuity-evaluator@02ff8561…:src/tool_observation.rs` | EXP-01, HAR-03, PRV-05 |
| `schemas-and-contracts@ce464c21…:contracts/schemas/execution-plan-body.v2.schema.json` | PAS-02, PAS-03 |

Les 48 dates de preuves locales égalent toutes la date du dernier commit du fichier (`git log -1 --format=%cs -- <cible>`). Le README ne dit pas ce que la date d'une preuve désigne.

**A8.** ADR proposés selon la commande du mandat : 0016 (statut `deferred`, cité par 0 brique), 0063, 0064, 0065.
- ADR-0064, cité par 99 briques :
  - 4 fiches le disent proposé : PLT-02, PLT-03, PLT-05, PLT-06.
  - 12 le nomment à l'indicatif sans le dire : EXP-07, EXP-09, FAB-02, FAB-13, GOV-04, HAR-01, HAR-06, HAR-12, PRD-02, PRD-15, PUB-01, PUB-02. Exemple, PUB-01:5 : « ADR-0064 D6 décide que la page vision est produite… ».
  - 83 ne le nomment pas dans la fiche.
- ADR-0063, cité par 14 briques :
  - 8 le disent : EXE-03, EXE-04, FAB-10, GOV-16, HAR-09, PAS-04, PLT-01, PRV-10.
  - 5 le nomment sans le dire : EXP-09, GOV-04, PAS-01, PAS-02, PRD-02.
  - 1 ne le nomme pas : PLT-02.
- ADR-0065, cité par 2 briques, aucune ne le dit : EXE-03, PLT-01. Sa ligne de statut est « proposé — la fusion de cette pull request vaut signature du propriétaire (ADR-0043) », alors que le fichier est fusionné et que D104 à D106 sont au registre. La règle du mandat le classe proposé ; l'état réel est ambigu à la source.
- Seules PLT-03, PLT-05 et PLT-06 passent le contrôle.
- `ecosystem/briques/README.md` ne dit pas non plus qu'ADR-0064 est proposé (`grep -ni propos` : 0).

**A9.** Dépendances jamais nommées, ni par identifiant ni par nom :
- EXP-03→PRV-01 ; EXP-06→PRV-01 ; EXP-07→PRV-01 ; GOV-04→GOV-01
- HAR-01→GOV-07 ; HAR-03→GOV-05 ; HAR-06→HAR-02 ; HAR-07→GOV-01, HAR-02 ; HAR-12→GOV-01
- IDN-01→GOV-07 ; IDN-02→GOV-07 ; IDN-04→IDN-02 ; IDN-05→IDN-04
- PAS-01→IDN-02 ; PAS-02→GOV-07 ; PAS-03→GOV-07
- PRD-02→PLT-01, PLT-02, PLT-05, PLT-07, EXE-04 (5 sur 5) ; PRD-15→PAS-02, PLT-06, PLT-07 (3 sur 3)
- PRV-02→IDN-04 ; PRV-05→IDN-04 ; PRV-08→IDN-05 ; PRV-11→IDN-04 ; PUB-06→PUB-04

**Relevés hors des neuf contrôles, même méthode.**
- Invariants du YAML jamais nommés dans la fiche : 26 liens sur 231, 19 briques. FAB-01 I-13 ; FAB-02 I-14 ; FAB-03 I-19 ; FAB-05 I-08 ; FAB-06 I-13 ; FAB-10 I-06, I-18 ; FAB-11 I-13 ; FAB-13 I-05, I-15 ; GOV-07 I-08 ; GOV-08 I-05 ; HAR-09 I-06, I-08, I-18 ; HAR-10 I-08 ; IDN-04 I-09 ; PLT-02 I-06 ; PLT-05 I-08 ; PLT-09 I-11 ; PRD-02 I-06, I-08, I-27 ; PRD-15 I-08, I-15 ; PUB-01 I-15.
- Invariants nommés dans la fiche et absents du YAML : 13. FAB-04 I-09 ; FAB-07 I-30 ; GOV-02 I-35 ; GOV-13 I-23 ; GOV-15 I-17 ; GOV-16 I-07 ; HAR-07 I-32 ; PLT-03 I-07 ; PLT-08 I-13 ; PRD-02 I-20 ; PRV-06 I-17 ; PRV-09 I-26 ; PRV-10 I-10.
- Décisions du YAML (hors ADR-0064) jamais nommées dans la fiche : 84 sur 329.
- `origine` : les 87 briques `inspection` portent la même source, « vision externe en briques inspectée le 2026-11-09 (analyse hors dépôt) ». ADR-0064 D2 demande « `inspection` avec la source nommée » ; cette source n'est ni nommée ni consultable.
- Le schéma (`brique.v1.schema.json:117`) et ADR-0064 (« Applique ») rattachent l'origine à I-33. I-33 s'intitule « Observation des appels d'outil sans contenu ni autorité » ; `grep -niE 'origine|origin' docs/decisions/INVARIANTS.md` ne rend rien.

## Partie B — 22 briques

Légende des cinq réponses : (1) invariants ; (2) ADR et registre ; (3) preuves locales ; (4) preuves épinglées ; (5) invérifiable.

**GOV-01**
1. I-13 lie (« touche humaine réduite aux invariants ») ; I-17 lie (« Surface à touche humaine fermée ») ; I-24 lie (« Protocole d'interaction au point de décision »).
2. ADR-0009 §5, D68 et D31 conformes. ADR-0043 est au YAML et absent de la fiche.
3. `tools/quality/check-review-evidence.ts` exerce la brique : il refuse une PR qui touche la surface gardée sans artefact `docs/reviews/**` existant ni marque `Owner-arbitration: <date>`. La Mesure dit ce que l'artefact montre.
4. Aucune.
5. « La flotte ne connaît que ces deux acteurs. » Le titre en nomme trois ; aucune source.

**GOV-02**
1. I-03 lie (« `governance` (doctrine, invariants, ADR…) ») ; I-17 lie.
2. ADR-0008 point 7 et D103 conformes.
3. `check-doctrine-governance.sh` exerce une partie. « chaque ADR accepté » est plus large que l'artefact : ligne 46, `if [ "$((10#$num))" -lt 8 ]; then continue; fi`, soit à partir de 0008.
4. Aucune.
5. Aucune. La seconde moitié du rôle (« rattache chaque invariant à la couche et à la classe de dépôt ») n'existe pas ; la fiche le dit.

**FAB-01**
1. I-19 lie (« les besoins externes entrent par need-capture ») ; I-13 lie par D52, jamais nommé dans la fiche.
2. D52 conforme, non nommé dans la fiche. « capturée sans interruption … (I-19) » : I-19 ne contient pas « sans interruption ».
3. `check-issue-forms.ts` exerce la forme des formulaires ; Mesure exacte.
4. `coordination.rs` réalise capture, qualification, promotion, écartement, avec motifs fermés `implemented / refused / other` et `require_owner()` aux lignes 574 et 598. Le module est pur (« the caller … records the event ») : « chaque étape journalisée » n'y est pas montré. Le rôle dit « qualifie par une règle » ; l'artefact montre une commande `Qualify` émise par un acteur.
5. « Aucun artefact lu ne relie une issue de la forge à une idée de Work Supervision » : absence sans périmètre ni commande.

**FAB-02**
1. I-08 voisin (« chaque repo produit trace ses phases… dans sa fiche `project.v1.yaml` » : la charte n'est pas cette fiche) ; I-15 voisin (même motif : « l'échelle de preuve est portée par la fiche `project.v1.yaml` ») ; I-14 sans rapport (aucune clause sur une charte, jamais nommé dans la fiche).
2. « ADR-0064 D2 donne… » à l'indicatif, ADR proposé.
3. Le schéma réalise : `charte.required` porte 5 champs, `additionalProperties: false`. Mesure exacte. « le gate y refuse un mot de durée » : vérifié, `ecosystem/briques.ts:210`.
4. Aucune.
5. Aucune.

**HAR-01**
1. I-03 lie (un contrat canonique relève de l'autorité `contracts`) ; I-08 voisin (ne dit rien d'une « preuve attendue nommée d'avance » pour une exécution).
2. « ADR-0034 D4 lui fait déclarer sa classe… et ses résultats fermés » : la classe est en D4 (`0034:154`), les résultats fermés en D1 (`0034:56`).
3. Aucune.
4. Aucune.
5. « Aucun artefact de la flotte ne décrit… » : absence universelle sans commande.

**HAR-02**
1. I-18 lie (« identité des agents (flotte/mission/capacités…) ») ; « zone déclarée » n'est pas dans I-18. I-38 lie comme contrainte ; aucune preuve ne l'exerce.
2. ADR-0018 D2 et ADR-0042 §3 conformes.
3. Aucune.
4. `session.rs` réalise l'environnement en liste fermée (`ALLOWED_ENVIRONMENT`, `env_clear`) et l'empreinte glissante. `run.rs` lie l'identité à l'attestation et rend `ControlNotEnforceable` avant tout lancement (lignes 124-127). Mesure exacte. Aucun des deux ne montre un objet qui « refuse de démarrer sans » identité, zone et journal.
5. « Les sessions d'agent du propriétaire tournent sous le bac à sable de son harnais, hors flotte. »

**IDN-01**
1. I-09 lie.
2. ADR-0002 §2, D16 et D09 conformes. « le serveur n'en garde qu'un condensé, et il change à chaque authentification (I-09) » : absent du texte d'I-09 ; `auth.v1` le porte (« rotates transaction into Strict application session »).
3. Aucune.
4. `auth.v1.yaml` spécifie la frontière ; `transaction.ts` réalise la transaction OIDC (PKCE S256, state, nonce). « la frontière est… implémentée » dépasse le module cité, qui ne montre pas la session.
5. Le statut verrouillé d'`auth.v1` n'a pas été lu au catalogue.

**IDN-02**
1. I-09 lie ; I-28 lie, mais I-28 nomme `authz-biscuit` et la fiche `capability-authorization` ; aucune source de ce dépôt ne relie les deux noms (`grep -rnE 'authz-biscuit.*capability-authorization'` : 0).
2. « borné à un tenant, une ressource, des opérations et une échéance (I-09, D15) » : I-09 et D15 ne portent que le tenant et « court » ; le reste vient de `token.rs:91-95`.
3. Aucune.
4. `token.rs` et `tests/authz.rs` réalisent et exercent : `offline_attenuation_can_only_reduce_authority` (ligne 305), `Debug` caviardé. Mesure exacte.
5. Aucune.

**PAS-01**
1. I-32 voisin (cité pour ce que la brique ne fait pas) ; I-33 voisin (régit ce qui « quitte le harness », pas ce qu'une passerelle reçoit ; la règle « métadonnées typées » vient d'ADR-0064 D1, proposé).
2. « ADR-0063 renvoie la forme de la passerelle à cette fiche » : conforme à `0063:50`, section « Ce qui n'est pas décidé ici » d'un ADR proposé, non dit. Menace conforme à `docs/security/THREAT-MODEL.md:116`.
3. Aucune.
4. Aucune.
5. « Aucun composant de la flotte ne joue ce rôle aujourd'hui » : absence universelle.

**PAS-02**
1. I-21 lie ; I-10 lie (« local-first où la spec l'exige ») ; I-07 voisin (cible runtime d'un déploiement, pas zone de traitement par classe) ; I-22 voisin (vise une « personne non-utilisatrice » ; le schéma exige `authorizationBasis` pour toute sortie vers un modèle).
2. ADR-0036 et ADR-0063 conformes ; ADR-0063 proposé, non dit.
3. Aucune.
4. Le schéma réalise des vocabulaires fermés ; le gate refuse une classe hors vocabulaire (`check-contracts.ts:380-383`). Mesure exacte. La liste « ferme » contredit la preuve : « La donnée personnelle envoyée à un service distant : I-21 la garde sur l'appareil ». Le schéma cité admet `"maximumClassification": { "enum": ["public", "internal", "tenant-private", "personal"] }` (ligne 234), et sa branche réseau ouvert (lignes 322-334) ne contraint que `authorizationBasis`, `sourcePaths`, `maxBytesPerRequest`, `region` (`france`/`eu`) et `subprocessors`.
5. Aucune.

**EXE-01**
1. I-32 voisin (la fiche lui fait dire « traité dans la tâche confinée » ; l'invariant dit « référence opaque résolue hors du modèle », et la quarantaine d'ADR-0045 est un modèle sans outil) ; I-33 voisin (obligations d'observation, la brique ne fournit que l'attestation) ; I-38 voisin (porte sur l'autorisation d'installer, pas sur un confinement).
2. ADR-0018 et D52 conformes. « après la qualification C0 » se lit comme acquis ; D53 et FAB-04 disent C0 non vert. ADR-0030 et D36 sont au YAML et absents de la fiche.
3. Aucune.
4. `confinement.rs` et son test réalisent et exercent ; Mesure exacte. La liste « ferme » contredit le même dépôt au même commit : « L'écriture hors du périmètre déclaré ». `src/host/run.rs:154-157` (preuve de HAR-02) dit : « It is NOT a boundary: nothing here bounds the worker's own syscalls, which is precisely why filesystem_confinement is not an engine capability ».
5. Aucune.

**EXE-02**
1. I-07 lie ; I-21 voisin (la preuve couvre un site statique sans donnée).
2. ADR-0035 et D41 conformes.
3. Aucune.
4. `context.ts` et son test réalisent et exercent (`WRONG_OWNER`, `WRONG_APP_TYPE`, `WRONG_ZONE`). Mesure exacte.
5. Aucune.

**PRV-01**
1. I-09 voisin (cité comme ce dont la v0 déroge) ; I-20 voisin (vise le journal public des verdicts de gates ; la fiche écrit « Elle ne publie rien »).
2. ADR-0042 §5 et D55 conformes.
3. Aucune.
4. `journal.rs` et le vérificateur réalisent : ajout seul, chaîne, « shares no code with the writer », `TornTail` distinct. Mesure exacte. Le rôle dit « chaque événement d'une organisation » ; la v0 n'a pas d'organisation, et la Mesure le dit.
5. Aucune.

**PRV-02**
1. I-20 lie (« releases liées à leur évidence ») ; I-10 voisin (la fiche écrit « comme I-10 l'exige d'une exportation »).
2. ADR-0009 §7 et D71 conformes.
3. Aucune.
4. `verify.rs` et le schéma réalisent : `EvidenceRequired`, `EvidenceNotPassing`, `EvidenceSubjectMismatch`, `canonical_document_digest`. Mesure exacte.
5. « Aucune release de la flotte ne porte encore de manifeste » : absence universelle.

**PLT-01**
1. I-06 lie.
2. ADR-0057 §1, ADR-0044 D2 et D3, D96, D97 conformes. ADR-0042 §6 dit « Un cœur Rust et des adaptateurs » ; « par produit » est ajouté. ADR-0065 est à l'indicatif (« exige ») sans mention de son statut.
3. Aucune.
4. Les deux tests exercent ; Mesure exacte.
5. « Deux dépôts portent un cœur aujourd'hui » : sans commande ; `0063:34` relève aussi le serveur Rust de `signalement`.

**PLT-02**
1. I-06 lie (D96), jamais nommé dans la fiche ; I-08 lie par ADR-0057 §2 (« Un contrôle sans vecteur n'est pas un contrôle (I-08) ») ; I-37 lie pour la surface web.
2. ADR-0057 §1 à §3, ADR-0042 §8, D92 et D98 conformes. ADR-0063 est au YAML, absent de la fiche.
3. `docs/method/TAURI-SHELL.md` §6 est cité, non déclaré comme preuve ; conforme.
4. `shell_controls.rs` exerce, macOS seulement (`#[cfg(not(target_os = "macos"))]` rend `FAILURE`). Mesure exacte.
5. Aucune.

**EXP-01**
1. I-33 lie ; I-18 lie (« données `operational` jamais autorité »).
2. ADR-0046 et D67 conformes. Le rôle dit « Rejoue une mission » ; ADR-0046 borne à « une invocation ».
3. Aucune.
4. `tool_observation.rs` réalise, `tool_observation_vectors.rs` exerce. La Mesure omet que les signatures des vecteurs sont un bouche-trou : « the same placeholder signature (64 zero bytes) ».
5. « elle lit ce que PRV-01 scelle » : aucune source ne place les observations dans le journal de Work Supervision.

**EXP-02**
1. I-27 voisin (vise un gate de parité « fondé sur une comparaison à un benchmark concurrent » ; la fiche généralise à « toute comparaison à un étalon ») ; I-19 voisin.
2. ADR-0027 et D34 conformes. ADR-0042 §6 fige un seuil pour la matrice de parité d'un produit ; la fiche le transpose aux modèles.
3. Aucune.
4. Aucune.
5. L'absence est déclarée sur trois dépôts nommés, sans commande.

**PUB-01**
1. I-05 lie ; I-14 lie ; I-15 voisin, jamais nommé dans la fiche.
2. « ADR-0064 D6 décide » : ADR proposé. « sous ADR-0038 » reprend D6 ; ADR-0038 porte sur la première publication d'un dépôt.
3. Aucune. « `distribution/vision/` est absent de l'arbre » : vérifié.
4. Aucune.
5. Aucune.

**PUB-02**
1. I-05 lie ; I-14 lie ; I-15 lie.
2. Déformation : « ADR-0064 en fait une projection vérifiée de la carte ». ADR-0064 écrit l'inverse : « le catalogue d'ADR-0042 reste la source de leur liste et de leur gel, la carte en est la projection vérifiée ». ADR-0020 est au YAML, absent de la fiche.
3. `render-fleet-status.ts` et `check-org-readme-drift.ts` réalisent et exercent ; Mesure exacte.
4. Aucune.
5. « les quatre dernières exécutions planifiées de ce contrôle sont en échec ».

**PRD-02**
1. I-06 lie (amendé par ADR-0054), I-08 lie, I-27 lie par ADR-0042 §6 : aucun des trois n'est nommé dans la fiche. I-15 lie. I-30 lie, mais déformé. I-10 voisin (renvoie à la spécification du produit, absente de ce dépôt).
2. Quatre écarts.
   - « ADR-0054 le sort du gel » : ADR-0042 §1 dit « P02, P07, P33 et P39, gelés jusqu'ici, sortent du gel » ; ADR-0054 lève le moratoire pour un dépôt et ne contient pas le mot « gel ».
   - « I-30 sépare l'attestation, la publication et l'enregistrement à l'inventaire » : I-30 sépare « nom/enrôlement, création d'un distant de staging vide privé hors portefeuille, puis exposition publique ».
   - « aucune donnée de paiement… (D81) » : c'est D87.
   - « Rien n'est citable tant que le dépôt porteur est privé (I-15) » : I-15 ne le dit pas.
3. Aucune.
4. Aucune.
5. Quatre affirmations.
   - « Ce dépôt existe et reste privé. »
   - « sans qu'un serveur tiers sache ce qu'il lit » : la revue des chartes cite ADR-0054 §1 et §3, qui ne le contiennent pas ; le §4 décide une offre hébergée.
   - Le refus « Dépendre d'un service managé pour le cœur ».
   - « la brique ne compte comme prototypée qu'avec… (I-15, I-20) » : I-20 est absent du YAML.

**PRD-15**
1. I-08 lie, I-15 lie, jamais nommés dans la fiche ; I-22 voisin (ADR-0055 ne le cite pas ; l'émetteur utilise la surface) ; I-32 voisin (ADR-0055 ne le cite pas ; la preuve est une capture PNG, sans modèle).
2. ADR-0055, D94 et ADR-0042 §1 conformes. ADR-0064 D8 est à l'indicatif.
3. Aucune.
4. `capture.ts` (63 lignes) réalise un fragment : capture d'écran de l'onglet actif sur action explicite. Ni relais ni reçu. Mesure exacte.
5. « avec un reçu que l'émetteur peut vérifier » ; « formulaire, courriel » ; les refus « file de messages hébergée » et « au-delà de la page signalée ». ADR-0055 ne nomme que « interface web » et « reçu de projection ».

**Synthèse**

| Brique | Invariants (lie / voisin / sans rapport) | Preuves (réalise-exerce / mentionne / gonflée) | Invérifiables |
|---|---|---|---|
| GOV-01 | 3 / 0 / 0 | 1 / 0 / 0 | 1 |
| GOV-02 | 2 / 0 / 0 | 1 / 0 / 0 (portée « chaque ADR » trop large) | 0 |
| FAB-01 | 2 / 0 / 0 | 2 / 0 / 0 (« journalisée » non montré) | 1 |
| FAB-02 | 0 / 2 / 1 | 1 / 0 / 0 | 0 |
| HAR-01 | 1 / 1 / 0 | aucune preuve | 1 |
| HAR-02 | 2 / 0 / 0 | 2 / 0 / 0 | 1 |
| IDN-01 | 1 / 0 / 0 | 2 / 0 / 1 (« implémentée ») | 0 |
| IDN-02 | 2 / 0 / 0 | 2 / 0 / 0 | 0 |
| PAS-01 | 0 / 2 / 0 | aucune preuve | 1 |
| PAS-02 | 2 / 2 / 0 | 2 / 0 / 0 ; liste « ferme » contredite | 0 |
| EXE-01 | 0 / 3 / 0 | 2 / 0 / 0 ; liste « ferme » contredite | 0 |
| EXE-02 | 1 / 1 / 0 | 2 / 0 / 0 | 0 |
| PRV-01 | 0 / 2 / 0 | 2 / 0 / 0 | 0 |
| PRV-02 | 1 / 1 / 0 | 2 / 0 / 0 | 1 |
| PLT-01 | 1 / 0 / 0 | 2 / 0 / 0 | 1 |
| PLT-02 | 3 / 0 / 0 | 1 / 0 / 0 | 0 |
| EXP-01 | 2 / 0 / 0 | 2 / 0 / 0 (bouche-trou omis) | 1 |
| EXP-02 | 0 / 2 / 0 | aucune preuve | 1 |
| PUB-01 | 2 / 1 / 0 | aucune preuve | 0 |
| PUB-02 | 3 / 0 / 0 | 2 / 0 / 0 | 1 |
| PRD-02 | 5 / 1 / 0 | aucune preuve | 4 |
| PRD-15 | 2 / 2 / 0 | 1 / 0 / 0 (fragment) | 3 |

Totaux : 59 liens d'invariant = 35 lie, 23 voisin, 1 sans rapport. 29 preuves ouvertes (6 locales, 23 épinglées) : aucune ne fait que mentionner la brique ; 1 formulation de Mesure gonflée (IDN-01). Les deux contradictions (PAS-02, EXE-01) sont dans « Ce que la brique ferme », pas dans « Mesure ».

## Corrections recommandées

**Bloquant** (contredit par la source ou par la preuve citée)
1. **PAS-02**, « Ce que la brique ferme », 1re puce. Remplacer par : « La donnée personnelle envoyée hors de l'Union : le plan borne la région à `local`, `france` ou `eu`. Il admet la classe `personal` en sortie vers un modèle quand le réseau est ouvert ; rien dans ce contrat ne la garde sur l'appareil (I-21 non réalisé ici). »
2. **EXE-01**, « Ce que la brique ferme », 4e puce (« L'écriture hors du périmètre déclaré, installation live comprise (I-38) »). La retirer, ou la porter en « Prochaine preuve », et ajouter à la Mesure : « Au commit cité, le moteur ne borne pas les appels système du worker : le confinement du système de fichiers n'est pas une capacité du moteur (`src/host/run.rs`). »
3. **PUB-02**, Contexte, 1re phrase. Remplacer « et ADR-0064 en fait une projection vérifiée de la carte » par « et ADR-0064, encore proposé, garde ce catalogue comme source et fait de la carte sa projection vérifiée ».
4. **PRD-02**, Contexte.
   - « ADR-0054 le sort du gel et fixe sa première version » → « ADR-0042 §1 le sort du gel (D52) ; ADR-0054 fixe sa première version et lève le moratoire pour son dépôt dédié ».
   - « I-30 sépare l'attestation, la publication et l'enregistrement à l'inventaire, et aucun des trois n'est fait » → « I-30 sépare le nom et l'enrôlement, le distant de staging privé, puis l'exposition publique après attestation ; l'exposition n'est pas faite ».
5. **GOV-03** (hors échantillon), Contexte. « Deux levées existent : ADR-0052 pour Square Control (D76) et ADR-0055 pour `signalement` (D94) » → « Deux levées du moratoire existent : ADR-0052 pour Square Control (D76) et ADR-0054 pour le dépôt de P02 (D89). ADR-0055 lève le gel de `signalement` sans toucher au moratoire (D94). »

**Majeur**
6. Les 12 fiches qui énoncent ADR-0064 à l'indicatif, les 5 pour ADR-0063 et les 2 pour ADR-0065 : ajouter « encore proposé » à la première mention, comme le font PLT-02, PLT-03, PLT-05 et PLT-06. Pour les 83 fiches qui ne nomment pas ADR-0064 : le dire une fois dans `ecosystem/briques/README.md`, ou retirer ADR-0064 de leur champ `decisions`.
7. Retirer du champ `invariants` ce que la précision 8 d'ADR-0064 appelle des invariants « cités par analogie » :
   - FAB-02 : I-08, I-14, I-15 ;
   - PAS-01 : I-32, I-33 ;
   - EXE-01 : I-32, I-33, I-38 ;
   - PRV-01 : I-09, I-20 ;
   - EXP-02 : I-19, I-27 ;
   - PAS-02 : I-07, I-22 ; EXE-02 : I-21 ; PRV-02 : I-10 ; PUB-01 : I-15 ; PRD-02 : I-10 ; PRD-15 : I-22, I-32.
   
   Le compteur « bound by no invariant » passerait alors de 3 à 8, avec FAB-02, PAS-01, EXE-01, PRV-01 et EXP-02.
8. **PRD-02** : « (D81) » → « (D87) » ; retirer « (I-15) » de « Rien n'est citable tant que le dépôt porteur est privé », règle du README et non de l'invariant ; ajouter I-20 au YAML ou le retirer de la fiche ; marquer « sans qu'un serveur tiers sache ce qu'il lit » et « Dépendre d'un service managé pour le cœur » comme propositions de l'agent sans source, au même titre que le fait d'abandon.
9. **PRD-15** : marquer comme propositions sans source dans ce dépôt « un reçu que l'émetteur peut vérifier », « courriel » et les deux derniers refus.
10. **HAR-02**, Contexte : retirer « Les sessions d'agent du propriétaire tournent sous le bac à sable de son harnais, hors flotte. »
11. **PUB-02**, Mesure : donner la commande du relevé du 2026-11-11, ou retirer « les quatre dernières ».
12. `origine.source` des 87 briques `inspection` : nommer la source, ou amender D2. Corriger aussi `I-33` en `ADR-0056` dans `brique.v1.schema.json:117` et dans la ligne « Applique » d'ADR-0064.
13. Les 30 dépendances du contrôle A9 : nommer chacune dans la fiche, ou la retirer de `depend_de`. PRD-02 (5 sur 5) et PRD-15 (3 sur 3) en priorité.
14. **PRD-02** : 393 mots de corps ; ramener sous 300.

**Mineur**
15. GOV-01 : retirer « La flotte ne connaît que ces deux acteurs. »
16. GOV-02, Mesure : « chaque ADR accepté » → « chaque ADR accepté à partir de 0008 ».
17. FAB-01 : rôle « la qualifie par une règle » → « la fait qualifier par un acteur, dans des états fermés » ; « chaque étape journalisée » → « chaque étape rendue comme événement à journaliser ».
18. HAR-01 : « ADR-0034 D4 lui fait déclarer sa classe… et ses résultats fermés » → « ADR-0034 D4 lui fait déclarer sa classe, et D1 ses résultats fermés ».
19. IDN-01 : « (I-09) » → « (contrat `auth.v1`) » après « il change à chaque authentification » ; Mesure : « implémentée » → « implémentée pour la transaction OIDC ».
20. IDN-02 : « (I-09, D15) » → « (I-09 et D15 pour le tenant ; module d'émission pour le reste) » ; dire que I-28 nomme ce foyer sous son ancien nom `authz-biscuit`.
21. EXE-01 : « après la qualification C0 (D52) » → « une fois la qualification C0 passée (D52) ; elle ne l'est pas ».
22. EXP-01 : rôle « Rejoue une mission » → « Rejoue le flux d'observations d'une invocation » ; Mesure : ajouter « les signatures des vecteurs sont un bouche-trou, aucune signature de harness n'est vérifiée » ; retirer ou sourcer « elle lit ce que PRV-01 scelle ».
23. PLT-01 : « un cœur Rust par produit » attribué à ADR-0042 §6 → « un cœur Rust » ; donner la commande derrière « Deux dépôts portent un cœur ».
24. PRD-15 : 313 mots de corps au `wc -w`, 291 jetons alphanumériques ; fixer l'instrument de comptage dans le README.
25. README des briques : dire que la date d'une preuve locale est celle du dernier commit du fichier ; c'est la règle observée sur 48 preuves sur 48.

## Ce que l'audit exclut par construction

- Le code du gate (`ecosystem/briques.ts`, `check-briques.ts`), lu seulement pour trois faits : absence de contrôle 120–300 mots, liste `DELAY_WORDS`, valeurs de statut.
- Le fond des 77 briques hors échantillon : aucun invariant, ADR ni preuve relu, sauf GOV-03, rencontrée par le contrôle A4.
- Les 49 preuves épinglées hors échantillon (72 − 23) et les 42 preuves locales hors échantillon (48 − 6).
- Pour les 23 preuves épinglées lues : en-têtes, signatures publiques et recherches ciblées, pas chaque ligne (`tests/authz.rs` fait 3 077 lignes). Aucun test exécuté. La date d'une preuve épinglée n'est pas comparée à la date de son commit.
- Tout état hors de l'arbre : historique Actions, rulesets (« check requis »), dépôts privés (`information-watch`), statut de verrou au catalogue de `schemas-and-contracts`, dépôts sous l’autre contexte.
- Les affirmations d'absence (« aucun dépôt de la flotte ne porte… ») : relevées comme non sourcées, jamais rejouées sur les autres dépôts.
- A3 repose sur une liste de noms que j'ai dressée et sur l'extraction des mots à majuscule ; un nom en minuscules absent de ma liste échappe au compte.
- A1 ne reconnaît que les neuf préfixes du mandat ; un identifiant externe d'une autre forme n'est pas vu.
- Le classement lie / voisin est un jugement de lecture, fondé sur la phrase citée de l'invariant, non une mesure.
