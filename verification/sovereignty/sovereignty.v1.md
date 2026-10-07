# sovereignty.v1 — la souveraineté testée

La souveraineté de Libre AI est déclarée par la doctrine (I-07 : cible runtime Clever Cloud
Paris/UE ; I-12 : GitHub = forge canonique, les exports git et artefacts empêchent toute
dépendance de données irréversible — ADR-0001, ADR-0008). Cette suite la rend **testée** :
chaque propriété de souveraineté devient un check rejouable dont le résultat est publié en
évidence (`distribution/evidence/sovereignty/`), et la part non couverte est affichée
`pending` avec sa condition d'activation — convention IN-SERVICE / SPECIFIED-PENDING de
`docs/method/POLARIS.md`. Aucune revendication de souveraineté sans check qui la porte ;
tout ce qui n'est pas encore vérifiable est dit tel quel.

Ce dossier est de l'évidence outillée, jamais une autorité (carte d'autorité :
`docs/README.md`). La doctrine décide ; cette suite prouve ou avoue.

## Registre des checks (v1)

| Id     | Propriété testée                                                                             | Méthode                                                                                                                          | Statut d'implémentation                                                                         |
| ------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| SOV-01 | `reconstruct-without-origin` — le projet se reconstruit depuis le seul clone public          | Lecture de la dernière attestation d'adoption (`distribution/evidence/adoption/latest.json`, livrable L3)                        | **in-service** (lecteur actif ; résultat `pending` tant que l'attestation L3 n'est pas publiée) |
| SOV-02 | `forge-restore` — la forge se restaure depuis un bundle git                                  | `git bundle create` du clone, restauration dans un répertoire propre, égalité des empreintes HEAD (commit + arbre)               | **in-service**                                                                                  |
| SOV-03 | `dependency-jurisdiction-inventory` — inventaire des dépendances par origine de distribution | Parse de `bun.lock` + `Cargo.lock`, agrégation par registre de distribution, comptes total/direct — heuristique v0, voir § dédié | **in-service**                                                                                  |
| SOV-04 | `second-infrastructure-deploy` — le runtime se déploie sur une seconde infrastructure        | À définir au premier déploiement                                                                                                 | **pending** — condition : première release runtime déployée publiquement                        |
| SOV-05 | `degraded-mode` — le service dégrade proprement quand une dépendance externe tombe           | À définir au premier déploiement                                                                                                 | **pending** — condition : première release runtime déployée publiquement                        |
| SOV-06 | `data-export-restore` — les données produit s'exportent et se restaurent sans perte          | À définir à la première mise en service                                                                                          | **pending** — condition : première application en service avec données produit                  |
| SOV-07 | `key-and-identity-rotation` — clés et identités d'exploitation tournent sans rupture         | À définir à la première mise en service                                                                                          | **pending** — condition : secrets d'exploitation en service                                     |

Trois checks sont in-service (SOV-01, SOV-02, SOV-03) ; quatre sont pending parce que leur
objet n'existe pas encore (aucun runtime produit déployé, aucune donnée produit en service,
aucun secret d'exploitation). Un check pending n'est ni un pass ni un échec : c'est la part
non couverte, affichée pour ne jamais sur-revendiquer.

## SOV-01 — contrat de lecture de l'attestation d'adoption (v0)

SOV-01 ne rejoue pas la boucle de reproduction : celle-ci est le livrable L3 (attestation
d'adoption, en cours sur une autre branche). Le check lit
`distribution/evidence/adoption/latest.json` et attend au minimum un champ `status` de type
chaîne :

- fichier absent → résultat `pending`, raison « adoption attestation not yet published » ;
- `status` = `pass` ou `passed` → résultat `pass`, référence de l'attestation citée ;
- `status` autre → résultat `fail` (l'attestation existe et ne conclut pas au succès) ;
- fichier présent mais illisible/non conforme → résultat `fail` (présent mais invérifiable).

Ce contrat v0 est volontairement minimal ; il sera réconcilié avec le format effectif de L3
quand celui-ci atterrit. Toute divergence se résout côté SOV-01 (le producteur L3 fait foi).

## SOV-02 — restauration de forge

Réalisation directe d'I-12 (exports git = aucune dépendance de données irréversible envers
la forge) : le runner crée `git bundle create <tmp>/forge.bundle HEAD` depuis le clone
courant, restaure le bundle par `git clone` dans un répertoire propre, puis vérifie
l'égalité des empreintes du commit HEAD **et** de l'arbre (`HEAD^{tree}`) entre source et
restauration. Les deux empreintes sont publiées dans le rapport. Répertoires temporaires
créés via `mkdtemp`, nettoyés en fin de check.

Limite assumée : le bundle couvre l'historique de `HEAD` (la vérité courante), pas les
métadonnées de forge (issues, pull requests) — celles-ci relèvent d'un check futur si un
export en devient nécessaire.

## SOV-03 — inventaire par origine de distribution : heuristique v0

Le check parse les deux lockfiles à la racine du dépôt :

- `bun.lock` (texte JSONC produit par Bun ≥ 1.3) — dépendances JS/TS ;
- `Cargo.lock` (TOML, version 4) — dépendances Rust.

Il classe chaque paquet par **registre de distribution** (npm, crates.io, git/URL directe,
workspace/chemin local) et publie : liste machine complète, comptes total/direct par
écosystème, agrégats par registre, et la liste des sources hors registres standards.

**Ce que cette classification n'est pas.** Le registre de distribution n'est **pas** la
juridiction du code. npm et crates.io sont des infrastructures de distribution opérées
depuis les États-Unis, mais le code distribué est sous licences libres : il est
réplicable, miroirable et vendorable — la dépendance est un canal, pas une capture. Ce
check mesure donc la **concentration du canal de distribution** (utile pour dimensionner
miroirs et vendoring), pas une exposition juridique du code. Toute lecture « X % des
dépendances sont sous juridiction US » serait une sur-revendication ; le rapport porte
cette mise en garde en toutes lettres.

Heuristiques v0 assumées (à raffiner si un usage le justifie) :

- « direct » côté Bun = noms déclarés dans les manifestes de workspaces du lockfile
  (hors références `workspace:`) ; côté Cargo = dépendances des paquets sans `source`
  (membres du workspace **et** crates vendorés par patch, indistinguables dans le lockfile) ;
- les paquets locaux (`workspace:`, chemin/vendoré) sont comptés à part, jamais comme
  dépendances externes ;
- une résolution non reconnue est classée `unknown` et remonte dans les sources hors
  standards plutôt que d'être absorbée silencieusement dans une catégorie rassurante.

## Rapport d'évidence

Le runner `verification/sovereignty/run-sovereignty.ts` (Bun, zéro dépendance externe)
exécute les checks in-service et écrit dans `distribution/evidence/sovereignty/` :

- `YYYY-MM-DD-<short-sha>.json` — rapport machine (`schemaVersion:
libre-ai.sovereignty.v1`) : par check, statut `pass`/`fail`/`pending`, raison, données ;
- `YYYY-MM-DD-<short-sha>.md` — même contenu, lisible ;
- `latest.json` — copie du dernier rapport machine.

Le rapport est déterministe hors métadonnées de run (date ISO 8601, commit) : mêmes
entrées, mêmes octets. Le runner sort en échec (code 1) si au moins un check `fail` — un
échec réel est publié, jamais masqué. Exécution hebdomadaire par le workflow
`.github/workflows/sovereignty-report.yml` (artifact + job summary, aucun push, aucun
secret) ; exécution locale : `bun verification/sovereignty/run-sovereignty.ts`.

## Références

- `docs/decisions/INVARIANTS.md` — I-07 (runtime UE), I-12 (forge canonique + exports).
- ADR-0001, ADR-0008 — cible d'infrastructure et topologie.
- `docs/method/POLARIS.md` — convention IN-SERVICE / SPECIFIED-PENDING et traceur public.
- `distribution/evidence/README.md` — statut de l'évidence (prouve, ne décide pas).
