# ADR-0031 — Amendement d'ADR-0020 §2.5 : un patch vendorisé vit dans le dépôt qui le qualifie, les autres workspaces le consomment en git-dep d'organisation épinglée

- **Statut :** accepted — arbitrage propriétaire du 2026-09-08 par question structurée (ADR-0022/I-24). Owner-arbitration: 2026-09-08
- **Date :** 2026-09-08
- **Portée :** amendement de la décision de sécurité ADR-0020 §2.5 (clause « le patch cryptographique `aes` suit chaque workspace final dont le graphe contient `aes` ») ; enregistrement de la forme retenue pour la migration `biscuit-auth` 6.0.0 (`authz-biscuit#12`, `ecosystem-engine#13`, dossier `docs/reviews/biscuit-auth-6/`).
- **Étend :** ADR-0020 §2.1 (git-deps inter-repos épinglées par SHA), §2.5 (bornes de sécurité des git-deps).
- **Amende :** ADR-0020 §2.5, la seule clause de localisation du patch vendorisé ; les autres bornes de §2.5 (`allow-org`, pin-SHA + revue, quarantaine des registres) restent en vigueur inchangées.
- **Invariants :** I-05 élargi (des seuls contrats vendorés aux crates patchés, texte historique conservé en note datée) ; I-28 créé (D1–D3) — `docs/decisions/INVARIANTS.md` ; entrée D37 de `docs/decisions/DECISION-REGISTER.md`. Décision propriétaire du 2026-09-08 sur le finding majeur architecture du round 2 (`docs/reviews/biscuit-auth-6/d65e877/architecture.verdict.json`), voir § Invariants.

## Contexte

ADR-0020 §2.5 a fixé, pour le seul cas connu à l'époque (`aes` durci dans
`notebook`), que « le patch cryptographique `aes` suit chaque workspace final
dont le graphe contient `aes` » : une copie par consommateur, la copie voyageant
avec son `PATCH.md`.

La migration `biscuit-auth` 5.0.0 → 6.0.0 (2026-09-08) a produit le second cas :
l'archive publiée 6.0.0 ne compile pas avec `default-features = false`
(eclipse-biscuit/biscuit-rust#305), le correctif amont #306 est fusionné mais
non publié, et la Voie A retenue par le propriétaire vendorise « archive + diff
#306 » sous `[patch.crates-io]`. Deux workspaces consomment `biscuit-auth` :
`authz-biscuit` (dépendance runtime, brique couche 3 qui porte la qualification,
la preuve d'injectivité et le gate de provenance) et `ecosystem-engine`
(dev-dependency, exécution de vecteurs).

La passe K4 architecture du round 1 (`docs/reviews/biscuit-auth-6/81ce4b5/`)
a relevé que la forme livrée par `ecosystem-engine#13` — une seule copie dans
la flotte, consommée par
`biscuit-auth = { git = "https://github.com/libre-ai/authz-biscuit", rev = "<sha>" }`
— contredit la lettre de §2.5, et qu'elle a deux modes de défaillance non
documentés : un `rev` épinglé sur une branche de fonctionnalité continue de
résoudre indéfiniment (GitHub conserve les refs de pull request) sans jamais
signaler que `main` du producteur ne contient pas le code consommé ; et cargo
résout un paquet git par balayage du dépôt, de sorte qu'une seconde copie du
même nom (état naturel d'une requalification 7.0) est choisie par ordre de
parcours avec un simple avertissement. Le choix entre « une copie par
consommateur » (§2.5 littéral) et « une copie, consommée en git-dep » est une
décision de sécurité, pas une remédiation : d'où cet amendement.

## Décisions

### D1 — Un patch vendorisé vit dans le dépôt qui le qualifie

Un crate vendorisé avec un diff local (`third_party/<crate>-<version>/` +
`PATCH.md`) a **un seul foyer dans la flotte** : le dépôt qui en porte la
qualification — preuve de sécurité, gate de provenance (téléchargement de
l'archive, vérification du SHA-256 déclaré, application du diff commité,
`diff -r` avec l'arbre), condition de retrait. Pour `biscuit-auth` 6.0.0 c'est
`authz-biscuit`. Une seconde copie dans un autre dépôt n'est jamais créée : deux
copies « byte-égales » sont deux arbres à maintenir égaux à la main, et la
dérive entre elles n'a aucun gate qui la voie.

Le cas `aes` de §2.5 n'est pas contredit : `notebook` est aujourd'hui l'unique
workspace dont le graphe contient `aes`, il est donc à la fois foyer et seul
consommateur. Le jour où un second workspace en aurait besoin, D2 s'applique.

### D2 — Les autres workspaces le consomment en git-dep d'organisation épinglée par `rev`

Un consommateur secondaire écrit
`<crate> = { git = "https://github.com/libre-ai/<foyer>", rev = "<sha complet>" }`
dans son `[patch.crates-io]`, sous les bornes déjà posées par §2.5 :
`[sources.allow-org] github = ["libre-ai"]` dans son `deny.toml`, un SHA
complet, jamais une branche, et chaque bump de `rev` par pull request revue.
Le foyer ne contient qu'une copie du paquet, ce qui rend la résolution par
balayage de cargo déterministe ; l'avertissement `skipping duplicate package`
de cargo est traité comme une erreur par la revue.

### D3 — Un gate de `rev` orphelin est requis chez chaque consommateur

Chaque consommateur secondaire porte un gate bloquant, exécuté dans son
`bun run check`, qui échoue si le `rev` d'un patch git intra-organisation
n'est pas un commit joignable depuis `main` du foyer — statut `identical` ou
`behind` de l'API GitHub `compare/main...<rev>` acceptés, `ahead` ou
`diverged` refusés, impossibilité de vérifier refusée aussi (un gate muet
n'est pas un gate). Réalisation de référence :
`ecosystem-engine/scripts/check-patch-rev.ts` (`check:patch-rev`).

Conséquence assumée : une pull request du consommateur qui épingle la tête
d'une branche non fusionnée du foyer est **rouge par construction** jusqu'au
re-pin. Séquence de re-pin après squash-merge de la pull request du foyer :
lire le commit de merge sur `main` du foyer, remplacer `rev`,
`cargo update -p <crate>` (ce seul paquet), rejouer le gate, ouvrir la pull
request de bump. La pull request du consommateur ne fusionne jamais avant celle
du foyer.

### D4 — La copie reste archive + diff, prouvé à chaque exécution

La copie vendorisée n'est éditée qu'à travers son diff commité
(`third_party/patches/<crate>-<version>-<origine>.diff`) ; aucun `#![allow]`,
aucune retouche locale, aucune suppression de fichier (les fichiers que des
`.gitignore` globaux excluent, tel `Cargo.toml.orig`, sont suivis avec
`git add -f`). Le gate de provenance du foyer est bloquant en CI et rejouable
localement par une commande unique documentée dans `PATCH.md`. Les
avertissements amont que la copie émet sous le jeu de features réduit sont
consignés dans `PATCH.md`, jamais réduits au silence dans l'arbre.

## Invariants

Le round 2 de la revue K4 (`docs/reviews/biscuit-auth-6/d65e877/`, finding
majeur architecture) a relevé que la première version de cette section
déclarait « aucun invariant nouveau ; I-05 s'applique » alors que le texte
d'I-05 ne couvrait que les _contrats_ vendorés, et que D1 (foyer unique) et D3
(gate de `rev` orphelin chez chaque consommateur) sont des obligations de
flotte sans entrée au registre — or ce qui n'y figure pas n'est pas doctrine
(ADR-0008 §7, `AGENTS.md`). Le propriétaire a tranché le 2026-09-08 entre
« porter D1/D3 au registre » et « déclarer une exception explicite » : les
deux entrées ci-dessous sont portées, la présente section ne se réclame plus
d'un invariant existant par analogie.

- **I-05 élargi** (numéro conservé) : toute copie vendorisée — contrat sous
  gate de dérive **ou crate patché sous gate de provenance** — est une
  projection vérifiée par gate, jamais éditée à la main, jamais canonique. Le
  gate de provenance de D4 en est l'exécutant pour un crate patché, comme
  `check:schemas` l'est pour les contrats. Le texte du 2026-07-28 est conservé
  dans l'entrée en note datée ; le cas contrat n'est pas modifié, de sorte que
  les ADR antérieurs qui citent I-05 (ADR-0020 §Invariants, ADR-0024 §2.1,
  `TARGET.md`) restent vrais tels quels.
- **I-28 créé** : un patch vendorisé a un foyer unique dans la flotte — le
  dépôt qui le qualifie (preuve, gate de provenance, condition de retrait) ;
  tout consommateur secondaire le prend en git-dep d'organisation épinglée par
  SHA complet et porte un gate bloquant de `rev` orphelin. Ancrage : D1–D3
  ci-dessus, sans reformulation ; réalisations de référence
  `authz-biscuit/scripts/verify-vendored-biscuit-auth.sh` et
  `ecosystem-engine/scripts/check-patch-rev.ts`.

Les bornes de sécurité d'ADR-0020 §2.5 (`allow-org`, pin-SHA + revue,
quarantaine des registres) restent la source d'arbitrage des git-deps et ne
sont pas portées au registre par cet ADR — I-28 les cite comme condition,
il ne les restate pas ; cet ADR n'amende de §2.5 que la clause de
localisation.

## Conséquences

- ADR-0020 §2.5 se lit désormais avec D1–D3 : la clause « suit chaque
  workspace final » vaut pour le foyer ; les consommateurs secondaires passent
  par D2 + D3.
- `authz-biscuit` porte la copie de `biscuit-auth` 6.0.0, son `PATCH.md`, le
  diff commité et le gate de provenance (`scripts/verify-vendored-biscuit-auth.sh`).
- `ecosystem-engine` consomme par git-dep `rev`-épinglée et porte le gate de
  `rev` orphelin ; sa pull request reste rouge jusqu'au re-pin qui suit le merge
  du foyer.
- La note de qualification
  `docs/reviews/agent-orchestration-contracts-v1/DEPENDENCY-QUALIFICATION-BISCUIT-AUTH.md`
  cite cet ADR pour la forme et ne se réclame plus du précédent `aes` seul ;
  elle renvoie au dossier de revue `docs/reviews/biscuit-auth-6/` (un
  sous-répertoire par head revu) pour les verdicts de chaque round.
- `docs/decisions/INVARIANTS.md` porte I-05 élargi et I-28 ;
  `docs/decisions/DECISION-REGISTER.md` porte D37, sur le modèle de D36
  (ADR-0030, précédent d'amendement).
- Retrait : la copie et son `[patch.crates-io]` disparaissent chez le foyer,
  puis chez chaque consommateur (qui revient à la version de registre), dès
  qu'une version publiée incluant le correctif est qualifiée — pour
  `biscuit-auth`, la ligne 7.0, dont la rupture d'API cryptographique impose sa
  propre qualification.
