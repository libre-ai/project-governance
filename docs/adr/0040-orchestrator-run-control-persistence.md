# ADR-0040 — Persistance du contrôle de run Orchestrator

- **Statut :** proposed — la fusion de cette pull request constitue l'arbitrage propriétaire
- **Choix de conception :** recommandation A validée par le propriétaire le 2026-09-11 ; profil de dépendances corrigé par le choix C explicite du même jour ; l'autorité Governance reste conditionnée à la fusion
- **Étend :** ADR-0032 D38, ADR-0034 D40, ADR-0036 D42 et ADR-0037 D43
- **Applique :** I-08 (preuves et critères), I-17 (action human-touch), I-21 (zéro donnée personnelle dans Git) et ADR-0011 D4 (premier merge sécurité de couche 2)
- **Autorise :** la seule tranche de persistance du `WP-G3-O01`, dans le crate séparé `crates/agent-orchestrator-run/`
- **N'autorise pas :** service, endpoint, Biscuit, Missions ou Harness réel, worker, effet, logs runtime, secret, déploiement, checkpoint ou dépendance LangGraph/LangChain/LangSmith

## Contexte et payoff

La Phase 4A a rendu les transitions d'exécution autorisée déterministes en
mémoire. Elle ne prouve ni la sérialisation concurrente, ni l'isolation entre
organizations, ni l'atomicité entre événement, budget et projection, ni la
suppression résistante à une restauration de sauvegarde. Sans frontière
persistée qualifiée, deux processus pourraient accepter des têtes concurrentes
ou une restauration pourrait ressusciter une lignée explicitement supprimée.

Cette décision autorise une preuve PostgreSQL bornée avant toute ouverture de
service. Elle réduit l'obligation du futur runtime : charger des octets
canoniques, appliquer le cœur pur déjà accepté et refuser toute divergence. Le
store ne devient ni une seconde autorité contractuelle ni un moteur
d'exécution.

## Correction du profil SQLx — 2026-09-11

Le profil initial de cette déclaration utilisait la façade `sqlx` 0.9.0 avec
ses default features désactivées. L'étude de source a établi un fait plus
strict : la dépendance non optionnelle de la façade `sqlx` 0.9.0 active
inconditionnellement `sqlx-core/migrate`. Le module `sqlx_core::testing`,
sélectionné par cette feature, contient deux sites `eprintln!`. Cela invalide
le refus source absolu du profil initial, sans établir
qu'un de ces chemins ait été appelé par l'API proposée. Sources upstream
versionnées : [manifest de la façade
0.9.0](https://docs.rs/crate/sqlx/0.9.0/source/Cargo.toml), [sélection du module
core 0.9.0](https://docs.rs/crate/sqlx-core/0.9.0/source/src/lib.rs) et [module
testing 0.9.0](https://docs.rs/crate/sqlx-core/0.9.0/source/src/testing/mod.rs).

Le choix propriétaire C remplace uniquement cette déclaration par les crates
registry non modifiées `sqlx-core` et `sqlx-postgres` 0.9.0. Core active
exactement `_rt-tokio`, `json` et `chrono`; Postgres active exactement `json`
et `chrono`, default features désactivées dans les deux cas. Il accepte pour
cette preuve l'API explicitement semver-exempt de `sqlx-core` et son couplage à
la feature privée `_rt-tokio`, sous pins exacts et requalification complète à
chaque mise à jour. Le gate porte sur le graphe final effectivement sélectionné
en debug, release et dev `tracing/log-always`, et refuse toute réintroduction de
la façade, de `migrate`, d'une version dupliquée, de TLS ou d'une feature non
autorisée par un autre consommateur du même graphe. Les packages seulement
présents dans le lockfile ou le superset de `cargo metadata` ne sont pas, seuls,
des packages sélectionnés. `sqlx-postgres` peut faire apparaître la feature
`sqlx-core/default`, qui est vide en 0.9.0 ; le gate compare la fermeture
effective concrète, pas des noms de features isolés. Les quatre blocages
production existants restent inchangés. Le diagnostic isolé n'a prouvé que la
disponibilité à la compilation des APIs directes et l'exclusion connue du
module `testing`, pas un E2E ni un audit exhaustif des sources du graphe.

## Décision

### D1 — Isoler la capacité PostgreSQL dans le second crate Rust

Orchestrator ajoute `crates/agent-orchestrator-run/`. Le crate racine pur reste
sans I/O et sa surface publique demeure inchangée. Le nouveau crate reçoit des
`PgConnectOptions`, possède ses pools privés et n'expose ni connexion, ni SQL
brut, ni migration, ni constructeur lisant l'environnement, le système de
fichiers, l'horloge hôte ou un secret. Seul le guard PostgreSQL fermé capture
son instant effectif de suppression après les verrous ; aucun appelant ne le
fournit.

Cette preuve est Unix-domain socket only. Avant tout pool ou I/O, le crate
exige `PgConnectOptions::get_socket() == Some`, refuse les startup options de
l'appelant, remplace mot de passe, nom d'application et tout certificat/clé
fichier ou inline par des valeurs fixes non secrètes, puis force
`PgSslMode::Disable`. Il n'appelle jamais `to_url_lossy` ni aucun formateur
d'options. La construction des options par l'appelant reste hors de cette
frontière ; aucun TCP ou TLS n'est autorisé dans cette tranche.

Cette tranche consomme les schémas embarqués par SDK Rust et le replay du cœur
pur. Elle ne crée pas de package concurrent : le `WP-G3-O01` verrouillé reste
le seul propriétaire de `crates/agent-orchestrator-run/**` et demeure incomplet
après cette réalisation.

Le plan machine transfère prospectivement d'O02 vers O01 les six chemins
support partagés qu'O02 possédait : manifests Cargo/package, README,
documentation Orchestrator et carte projet. Il attribue pour la première fois
à O01 le chemin CI exact sous la règle satellite ADR-0020. Les chemins
de code pur, `bun.lock`, tests, compatibilité et preuves historiques d'O02 ne
changent pas de propriétaire. Le gate O01 compare chaque chemin modifié à la
liste exacte autorisée ; aucune glob support large ni coordination implicite
n'est admise.

Cette tranche dépend explicitement du `WP-G3-O02` accepté. Elle peut commencer
même si `WP-G3-H01` n'est pas prouvé sur le `main` Harness courant parce
qu'elle n'importe aucune API Harness, n'ouvre aucun service et ne peut invoquer
ni worker ni effet. H01 reste une dépendance obligatoire de toute tranche O01
ultérieure et de la complétion de `WP-G3-O01`. Cette exception étroite ne
déclare donc aucune capacité de confinement disponible.

### D2 — Conserver les octets JCS comme autorité et rejouer toute la chaîne

Chaque événement accepté est validé contre Contracts, canonisé RFC 8785 et
stocké avec son digest SHA-256. Ces octets JCS sont l'autorité de replay de
l'exécution ; les tables de tête, budget et références d'attestation sont des
projections reconstructibles. À chaque append, le store recharge et revalide
toute la chaîne verrouillée avant de calculer la transition suivante.

La projection `runs` ne persiste que les identifiants/digests mécaniquement
extraits, les instants de création/dernier événement et la tête
séquence/digest. Elle ne persiste ni phase de replay, ni génération dérivée,
ni état courant des budgets : ces valeurs restent privées au reducer pur et
aucun accessor n'est ajouté pour les exporter. Le ledger de budget recopie les
champs validés de l'événement et les lie à son digest ; il ne recalcule aucune
politique.

La rétention n'est pas déductible des événements quand Missions change sa
politique après la fermeture d'un run. Le store conserve donc séparément les
faits de rétention immuables déjà authentifiés par un futur appelant. Ils sont
la preuve locale de ce qui a été appliqué, jamais une autorité de politique ni
un nouveau contrat wire. La projection lifecycle se reconstruit uniquement de
ce journal borné après que la date de création a été reconstruite et vérifiée
depuis les événements ; la projection d'exécution reste reconstruite uniquement
des événements.

Une transaction verrouille la tête du run, puis écrit événement, ledger,
références et projection de façon atomique. Des contraintes différées refusent
au commit une tête sans événement maximal correspondant ou un ledger non lié à
son événement immuable.
Un doublon octet-identique est idempotent ; une collision divergente refuse
fermée.

### D3 — Séparer app, rétention, restore et guard sous FORCE RLS

Les rôles cluster `libre_ai_app`, `libre_ai_retention`, `libre_ai_restore` et
`libre_ai_tombstone_guard` sont préprovisionnés `NOLOGIN NOSUPERUSER NOINHERIT
NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0`, sans
configuration de rôle ni membership sortant. Les migrations produit vérifient
leur présence mais ne les créent pas. Les trois identités de connexion sont
`LOGIN NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB NOREPLICATION
NOBYPASSRLS`, chacune membre sans admin option de son seul rôle nécessaire ;
PostgreSQL 16+ impose en plus `inherit_option = false` et `set_option = true`,
avec preuve transactionnelle du `SET LOCAL ROLE`. À partir de PostgreSQL 15,
aucun des sept principals ni `PUBLIC` ne reçoit de `pg_parameter_acl`, et
`session_replication_role` reste effectivement interdit. L'attestation lit
directement `pg_db_role_setting` pour exclure tout default rôle+base ou
database-wide caché par `rolconfig`. Chaque connexion initiale, remplacée,
rendue au pool ou empruntée prouve en outre
`session_replication_role = 'origin'` avant tout SQL métier, sans tenter de
corriger une valeur différente. Les identités ont une
limite de connexion positive bornée et aucun ownership applicatif. Elles
utilisent des pools physiquement séparés.

Toute transaction organization-scoped exécute un `SET LOCAL ROLE` littéral et
un `set_config('app.tenant_id', $1, true)` lié. Chaque table est protégée par
`ENABLE ROW LEVEL SECURITY` et `FORCE ROW LEVEL SECURITY`. Dans le graphe Cargo
final sélectionné, les dépendances directes exactes `sqlx-core` et
`sqlx-postgres` 0.9.0 remplacent la façade `sqlx`; ni la façade ni `migrate` ne
peuvent être sélectionnés par un autre consommateur. Les dépendances normales
`log` et `tracing` activent
`max_level_off` et `release_max_level_off` ; des assertions de compilation
imposent `log::STATIC_MAX_LEVEL == Off` et
`tracing::level_filters::STATIC_MAX_LEVEL == OFF`. Les macros des façades de
logging sont donc compilées hors du binaire en debug, release et sous la variante
de test `tracing/log-always`. `disable_statement_logging()` reste imposé en
défense en profondeur, mais ne porte pas seul la garantie. Le gate refuse tout
appel direct à un logger/événement/stdout et toute feature SQLx hors liste,
notamment `ipnet` et son chemin optionnel `println!`.

L'audit source parcourt les crates SQLx réellement sélectionnés. Il peut
écarter une branche `cfg` dont la feature est démontrée absente, mais aucun
répertoire nommé `testing` ni aucun chemin supposé inatteignable ne reçoit
d'exception. Le graphe final est éprouvé séparément en debug, release et dev
`tracing/log-always`; le superset de packages de `cargo metadata` sert à
résoudre les objets mais ne remplace pas cette sélection effective.

Ce contrôle a un effet global aval assumé sur les instances de packages
unifiées : tout consommateur du même graphe perd aussi les diagnostics de ces
instances `log`/`tracing`. Une version dupliquée ou toute autre modification du
graphe invalide la preuve. Ce coût n'est acceptable que pour cette preuve non
productive. Chaque retour au pool vide d'abord le cache client de prepared
statements SQLx puis exécute `DISCARD ALL` sans préparation persistante ;
l'échec de l'une des deux étapes détruit la connexion.

Le graphe SQLx ne contient aucune implémentation TLS. Le socket explicite
sélectionne le chemin UDS sans repli TCP même si le host inerte est malformé ;
`PgSslMode::Disable` est réappliqué à chaque pool et connexion de remplacement.
Les tests utilisent le socket privé mode 0700 du harness, avec
`listen_addresses` vide et toutes les règles HBA host refusées.
Les writers live commencent explicitement en `READ COMMITTED`. Les fonctions
guard et le trigger anti-résurrection sont `VOLATILE`, vérifient
`current_setting('transaction_isolation')` et refusent `REPEATABLE READ` ou
`SERIALIZABLE` : après une attente advisory, leur lecture suivante doit voir
le tombstone concurrent commité. Seul restore emploie `REPEATABLE READ`, après
gel autoritatif des writers.
Le rôle restore est limité à la récupération pré-ouverture et ne peut ni
append, ni exporter, ni modifier un schéma, ni accéder aux méthodes applicatives.
Le rôle rétention ne modifie ni ne supprime directement une ligne `runs` : tous
les writers se synchronisent sur une projection lifecycle séparée. Aucun rôle
ne reçoit un `UPDATE` global sur `runs` ; les grants applicatifs restent limités
aux colonnes de tête mécanique, et les grants lifecycle aux seules colonnes de
rétention.

### D4 — Rendre suppression et restauration anti-résurrection

Une suppression autorisée inscrit et conserve atomiquement un tombstone
content-free avant de retirer la lignée. La commande ne fournit aucun instant
de suppression : après tous les verrous de lignée, le guard capture
`clock_timestamp()` comme instant effectif et fixe l'éligibilité temporelle 840
heures plus tard. Un reçu retardé ne peut donc créer une barrière déjà éligible,
et un retry au même reçu conserve l'instant et l'éligibilité initiaux. Son sujet
est un SHA-256 versionné et encadré par longueurs de l'organization et du run ;
des vecteurs fixes prouvent l'égalité Rust/PostgreSQL. Le rôle rétention ne reçoit aucun accès brut
d'insertion, lecture ou suppression : la fonction guard
`delete_lineage_with_tombstone` dérive le sujet du contexte transactionnel,
verrouille la lignée, inscrit ou compare le reçu puis supprime le run cascade
dans la même transaction. Un reçu divergent refuse avant le `DELETE`. Le guard
reçoit uniquement les privilèges RLS tombstone, verrou lifecycle et `DELETE`
organization-scoped sur `runs` nécessaires à ses fonctions fermées ; il ne
peut mettre à jour un tombstone ni lire une autre relation. Sa fonction
d'expiration impose en plus l'ordre, la taille, les deux bornes temporelles et
un `SnapshotRetirementFact` exact issu de l'autorité indépendante de backup.
Aucune identité de connexion ne peut assumer ce rôle, et rétention n'a aucun
`DELETE` brut sur la lignée ou ses dépendances.

Avant toute inspection ou insertion, append, mise à jour lifecycle, sweep et
suppression acquièrent le même `pg_advisory_xact_lock` dérivé du sujet, puis le
row lock lifecycle et enfin, pour append, le row lock `runs` ; le trigger
anti-résurrection prend le verrou avant sa lecture. Le verrou couvre donc aussi
la lignée encore absente, que le row lock lifecycle ne peut pas voir, et cet
ordre unique prévient l'interblocage. Une collision de clé ne crée qu'une
sérialisation superflue et ne permet aucun bypass.
Un sweep multi-lignées pré-acquiert toutes les clés advisory distinctes de sa
page bornée, triées par valeur signée immuable, avant le premier row lock. Son
ordre de curseur par deadline reste séparé et ne peut donc créer un cycle quand
deux sweeps ont observé des ordres de deadlines différents.

Les tombstones deviennent éligibles après exactement `P35D` suivant leur
suppression effective, plafond déclaré des sauvegardes ; PostgreSQL l'exprime
comme `interval '840 hours'` et jamais
comme 35 jours calendaires, afin qu'un fuseau de session empoisonné ou un
passage DST ne raccourcisse pas la barrière. La rétention en années reste un
calcul calendaire UTC séparé. Le temps seul ne suffit jamais : une preuve
authentifiée doit lier un catalogue immuable de snapshots et l'ensemble exact
des sujets/reçus, et affirmer qu'aucun snapshot d'exécution encore admissible
ne peut contenir ces lignées. Sans cette preuve, le tombstone content-free
reste actif au-delà de `P35D`. Une suppression anticipée ou non prouvée est
bloquée en base. Une opération globale bornée du rôle rétention les expire sans retourner leurs lignes, selon
l'ordre `(expires_at, subject_digest)` et sous une double borne de temps injecté
et d'horloge PostgreSQL, plus cette preuve exacte de retrait. Lors d'une
restauration, le rôle restore charge d'abord un registre de suppressions
indépendamment protégé et accompagné d'un manifeste autoritatif. Le store
recalcule son compte et son digest, exige une couverture au moins égale au
gel des writers et refuse un snapshot d'exécution plus ancien que `P35D`.
Manifeste absent, incomplet, périmé ou incohérent refuse la pré-ouverture.
Seulement après cette preuve, restore rejoue chaque tombstone retenu contre les
lignées restaurées. Un tombstone purgé ne peut être omis que si la preuve de
retrait lie le snapshot sélectionné et exclut cette lignée ; son âge seul ne
suffit pas. Restore supprime par pages bornées, puis exige un compte résiduel
nul. Ce zéro est nécessaire mais jamais suffisant sans preuve de complétude et
de fraîcheur du registre. Le crate vérifie seulement leurs bornes, ordres et
digests internes : il ne peut comparer le digest déclaré au backup réel ni
décider quel catalogue est authentique ou courant. Le futur gate pré-ouverture
doit authentifier le catalogue, l'appartenance du snapshot sélectionné et la
preuve de retrait avant de construire ces faits. Le crate ne contrôle aucun
gel de writers ni démarrage de service ; ces autorités restent séparément
fermées.

### D5 — Mesurer le coût O(n) et interdire le branchement production

Le nombre d'instructions SQL d'append reste constant, mais le volume canonique
chargé, validé et rejoué croît en `O(n)` avec la chaîne. Les benchmarks
PostgreSQL publient tailles, octets, mémoire et percentiles sur des longueurs
fixes, sans seuil dépendant du matériel. Les plans de requête bornés doivent
utiliser les indexes organization/run/sequence.

La restauration vérifie le registre en `O(tombstones)`, puis effectue pour
chaque run restauré un lookup B-tree de tombstone. La décision de rapprochement
est donc en `O(tombstones + runs * log(tombstones))`. La suppression cascade
ajoute un coût linéaire dans les lignes dépendantes réellement purgées : la
borne complète est
`O(tombstones + runs * log(tombstones) + purged_rows)`. La mémoire cliente est
bornée par une seule page propriétaire, libérée avant la suivante ; aucun hash
join ou chargement intégral du registre n'est admis.

Aucun service de production ne peut consommer cette implémentation avant une
autorisation distincte d'état incrémental ou une borne autoritative démontrée
par les mesures. Un checkpoint de framework n'est pas une solution admise par
implication.

L'extinction globale des diagnostics constitue un deuxième blocage production.
Elle ne peut pas être retirée pour « réactiver les logs » : une option upstream
ou un driver séparément prouvé doit préserver des diagnostics aval sûrs sans
réintroduire les émissions SQLx de requête, notice, pool ou erreur.

L'absence volontaire de transport TCP/TLS est le troisième blocage production.
Clever Cloud Paris/UE reste un candidat de résidence future qui requiert une
autorisation séparée avec WebPKI `verify-full`, propriété/zeroization des
secrets et preuve de transport ; il n'est pas joignable par cette tranche
locale.

La compatibilité non démontrée du provisionnement des rôles est le quatrième
blocage production. La documentation Clever Cloud consultée le 2026-09-11
indique que l'administration directe des utilisateurs PostgreSQL n'est pas
disponible au-delà des identités owner/read-only du control plane et renvoie
les opérations restreintes au support :
<https://www.clever.cloud/developers/doc/deploy/databases/postgresql/>. Une
résidence UE ne prouve donc pas la capacité à créer les quatre rôles globaux
`NOLOGIN`, les trois identités de connexion séparées, leurs memberships et
grants, ni à activer `pgcrypto`. Avant tout branchement production, une preuve
immuable exécutée sur la cible doit attester le catalogue exact des rôles,
attributs, appartenances, privilèges et extensions après provisionnement
autorisé par le fournisseur. À défaut, un fournisseur PostgreSQL UE compatible
doit être sélectionné et autorisé séparément. Un bootstrap superuser local ou
un échange de support non reproduit ne satisfait pas ce gate.

### D6 — Arrêter avant merge sur dossier indépendant

Le candidat d'implémentation immuable `I` reçoit des revues
architecture/performance, sécurité, vie privée/souveraineté et complétude sur
le même SHA. Toute modification de `I` invalide les verdicts précédents. Après
acceptation seulement, un enfant direct strictement evidence-only `E` peut
ajouter le dossier, puis faire passer de `pending` à `accepted` le critère
`immutable-role-review` de la phase `run-control-persistence` et lui ajouter le
mapping schéma-valide `evidence: { date, reference }`. La référence nomme le
dossier et le SHA complet `I`. Un gate prouve `parent(E) = I`, limite son diff
au dossier, au scalaire de statut et au mapping evidence, et vérifie que tout
autre octet et tous les chemins d'implémentation sont byte-identiques à `I`.
Les preuves couvrent PostgreSQL
réel, concurrence, RLS, replay, rétention, suppression/restauration,
compatibilité, couverture et rollback.

ADR-0011 D4 impose ensuite un hard stop : le premier merge de persistance
sécurité de couche 2 exige un prononcé explicite du propriétaire. L'approbation
du design, du présent ADR, du plan ou de la création de PR ne vaut pas ce
prononcé.

## Sécurité et vie privée

Les APIs publiques utilisent des types validés et des erreurs à cinq codes
constants. `Display` et `Debug` n'exposent jamais SQL, détail de connexion,
organization, run, digest, document, chemin ou valeur rejetée. La bibliothèque
ne logue rien ; les fixtures sont synthétiques et un gate recherche les
contenus interdits. Des collecteurs permissifs reçoivent d'abord un contrôle
positif par leurs APIs directes, puis les tests exigent zéro événement et zéro
évaluation d'un formateur sensible sur tous les chemins SQLx, y compris
erreur/cancellation/nettoyage et PostgreSQL `RAISE INFO`, `NOTICE` et
`WARNING`. Cette preuve vaut uniquement pour le graphe exact vérifié.
Des options host malformé, mot de passe et certificats/clé fichier ou inline
synthétiques prouvent en plus l'absence de panic, sérialisation, lecture de
fichier, transmission et émission sur le chemin UDS.

Les tests PostgreSQL réels prouvent l'absence de lecture, mutation, inférence
ou collision cross-organization par toute méthode publique. Ils empoisonnent
et annulent des sessions de pool, attaquent les privilèges de chaque rôle,
injectent des échecs à chaque frontière SQL et vérifient qu'aucun état partiel
ne devient visible.

## Qualité, performance et complétude

Toute logique non triviale suit rouge-vert-refactor. Format, Clippy sans
warning, rustdoc sans warning, tests unitaires/intégration/E2E, compatibilité
publique, inventaire de dépendances et gates Bun sont bloquants. La couverture
du workspace et celle du nouveau crate atteignent chacune indépendamment au
minimum 87 % des lignes et 90 % des fonctions ; l'agrégat du workspace ne peut
pas masquer une régression locale.

`sqlx-core` et `sqlx-postgres` 0.9.0, Tokio, `log` et `tracing` sont épinglés
avec leurs seules features nécessaires, sous licences MIT/Apache-2.0
compatibles. L'acceptation bornée de l'API semver-exempt de `sqlx-core` et de
`_rt-tokio` impose une requalification complète à chaque mise à jour. SQLx
n'active aucune
feature TLS ni découverte de certificat. PostgreSQL 14+ avec `pgcrypto` est la
cible portable locale de la preuve ; Clever Cloud PostgreSQL reste un candidat
UE futur, sans compatibilité réseau ou de provisionnement revendiquée ni
déploiement autorisé ici.

## Compatibilité et rollback

Le changement est additif et ne modifie aucun contrat wire. Avant consommateur,
le rollback est le retrait du crate. Après application, les migrations restent
forward-only : le code peut être épinglé ou reverté, mais les événements
canoniques et tombstones ne sont ni réécrits ni détruits par une down-migration.
Le rôle restore reste absent de toute identité applicative.

## Alternatives rejetées

### Ouvrir le service runtime complet

Rejeté : stockage, autorisation, exposition réseau et effets seraient alors
qualifiés ensemble, empêchant d'attribuer correctement une violation de
causalité ou d'isolation.

### Persister une projection JSON comme autorité

Rejeté : elle dupliquerait la sémantique du cœur pur et pourrait dériver des
octets contractuels. Seule la chaîne JCS validée est autoritative.

### Introduire un repository ou event-store générique

Rejeté : aucun troisième consommateur ne justifie cette abstraction et elle
élargirait les surfaces SQL et de configuration sans réduire le risque.

### Utiliser LangGraph comme checkpoint

Rejeté : LangGraph deviendrait une spécification implicite et une dépendance de
restauration. Il reste un oracle non normatif de questions et scénarios de
panne, supprimable sans modifier Missions ni Orchestrator.

### Filtrer SQLx avec un subscriber scoped

Rejeté : la portée d'un poll n'est pas une frontière Drop, ne couvre pas les
tâches de fond du pool et modifie des états globaux de dispatcher/fallback. Elle
ne prouve pas le confinement des notices PostgreSQL ni des erreurs asynchrones.

### Maintenir un fork local de SQLx

Rejeté pour cette tranche non productive : il pourrait retirer chaque site
d'émission, mais créerait une surface durable d'audit upstream et de supply
chain disproportionnée. La preuve static-off sur graphe exact est plus étroite
et réversible ; la production devra choisir un contrôle upstream ou un driver
à diagnostics sûrs séparément prouvé.

### Conserver la façade `sqlx` avec une preuve d'inatteignabilité

Rejeté : en 0.9.0 sa dépendance non optionnelle sélectionne
`sqlx-core/migrate`, donc le module `testing` et ses deux émissions directes.
Une exemption de répertoire ou de call graph relâcherait le refus source
existant. Le profil direct retire cette sélection connue sans fork ; toute
réactivation future par un consommateur reste un échec du gate final.

### Inférer le variant certificat via les options sérialisées

Rejeté : SQLx sérialise fichier et inline sous les mêmes clés, son formateur
peut paniquer sur des champs appelant, et une clé privée inline serait copiée
dans des buffers non zeroized. La preuve locale n'active ni sérialisation
d'options ni TLS.

## Gate d'acceptation

La tranche de persistance n'est mergeable que si une même révision immuable
prouve :

1. les octets JCS, digests, replay complet de l'exécution, journal de faits de
   rétention et reconstruction séparée des deux projections ;
2. l'atomicité sous concurrence et échec injecté dans PostgreSQL réel ;
3. `FORCE RLS`, les quatre rôles minimaux et le nettoyage des pools ;
4. le socket Unix explicite sans repli TCP, TLS forcé disabled, champs secrets
   neutralisés sans formatage et aucun TLS dans le graphe exact ;
5. les graphes finaux sélectionnés debug, release et dev
   `tracing/log-always` contiennent seulement `sqlx-core` et `sqlx-postgres`
   0.9.0 sous les features autorisées, sans façade, `migrate`, duplication,
   TLS ou feature supplémentaire, et prouvent zéro émission et zéro évaluation
   sensible sans bypass direct ;
6. la rétention mission bornée, la suppression atomique et la restauration
   tombstone-first sans résurrection, avec registre complet et frais ;
7. les pages bornées, plans indexés, mesures append `O(n)`, rapprochement
   `O(tombstones + runs * log(tombstones))`, restauration totale
   `O(tombstones + runs * log(tombstones) + purged_rows)` et blocage
   production, auxquels s'ajoutent les blocages diagnostics globaux et
   transport distant ainsi que l'absence de preuve du provisionnement exact
   des rôles sur le fournisseur cible ;
8. la compatibilité, couverture, documentation, rollback et tous les gates ;
9. quatre verdicts indépendants acceptant le même SHA d'implémentation `I` ;
10. si le dossier est suivi dans Git, son unique commit `E` est l'enfant direct
   evidence-only mécaniquement vérifié de `I`, et `I` puis `E` restent ancêtres
   de la branche principale après un merge commit non-squashé et non-rebasé ;
11. le prononcé propriétaire ADR-0011 D4 nomme `I` et `E` après ces preuves et
   avant merge.

Tout finding Blocking ou Major invalide les preuves de la révision. La fusion
de cette tranche ne complète pas `WP-G3-O01` et n'autorise aucun service,
effet, worker, mission réelle ou déploiement.
