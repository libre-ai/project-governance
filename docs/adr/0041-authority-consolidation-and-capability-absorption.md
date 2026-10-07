# ADR-0041 — Consolidation de l'autorité et absorption des capacités sans destination

- **Statut :** proposed — la fusion de cette pull request constitue l'arbitrage propriétaire
- **Arbitrage :** décisions propriétaires du 2026-10-07, prises sur les quatre axes de décision (sécurité, qualité, performance, complétude) après mesure, le coût d'outillage ayant été écarté comme critère
- **Étend :** la direction propriétaire du 2026-09-29 (`docs/adr/2026-09-29-portfolio-consolidation.md`), à laquelle il donne sa numérotation et ses entrées de registre
- **Amende :** ADR-0024 §2.2 (clause « aucune fusion ») et I-28 (réalisations de référence du gate de `rev` orphelin)
- **Applique :** I-03 (deux autorités séparées, un sujet une autorité unique), I-05 (la projection est l'artefact généré, vérifié par gate, jamais canonique), I-16 (les préconditions de la loi de couverture ne conditionnent pas l'existence d'un repository), I-18 (noyau de sécurité des boucles K1–K5)
- **Autorise :** le retrait des dépôts donneurs aux noms courts après préservation prouvée et manifeste confirmé ; l'absorption de trois capacités dans `project-governance` ; la déclaration de `carriere` à l'inventaire
- **N'autorise pas :** la suppression de `governance` avant le re-épinglage de ses consommateurs ; l'activation d'un produit ; un transfert d'autorité au-delà des transferts tracés ici ; la modification d'un ruleset de protection hors du périmètre nommé au §6

## Contexte

Trois actes s'étaient empilés sans qu'aucun ne soit enregistré par la doctrine.
La bascule du 2026-09-16 a supprimé 36 dépôts et créé 20 destinations
documentaires. Onze minutes après une note consignant « aucune restauration
GitHub actionnée ; aucun clic sur Restore », 35 dépôts ont été restaurés sans
qu'aucun document ne porte ce choix. La direction du 2026-09-29 a tranché la
topologie cible mais n'a reçu ni numéro d'ADR, ni entrée au registre des
décisions, ni la ligne `Arbitrage` que le gate `doctrine-governance` exige
depuis l'ADR-0008.

Pendant ce temps l'inventaire déclarait 37 dépôts aux noms courts tandis que le
profil d'organisation ne pointait que vers les 20 noms longs, et le gate de
dérive comptait 21 assertions rouges. Aucune des trois surfaces ne décrivait
l'organisation observable.

## Décision

### 1. L'autorité passe aux noms longs, par exécution de la direction du 29/09

`project-governance` reçoit la doctrine et l'outillage de flotte,
`schemas-and-contracts` les contrats et les projections de SDK. Les transferts
sont individuels et tracés ; le corpus historique n'est pas déclaré supersédé
(`docs/reviews/`, 415 fichiers, et 28 des 33 artefacts `docs/superpowers/`
restent dans l'archive vérifiée).

### 2. Les 19 destinations sont admises par bascule de branche par défaut

Sur les 19, `main` — trois commits documentaires — est **ancêtre** de
`migrate/recover-code`. L'admission n'a donc demandé ni fusion, ni pull request,
ni dérogation : la branche par défaut a été basculée. **Aucun ruleset de
protection n'a été modifié**, ce que le §6 de la direction du 29/09 exigeait.

### 3. Les donneurs sont retirés après préservation prouvée

34 miroirs et bundles, et la preuve n'est pas `git bundle verify` mais un clone
réel depuis chaque bundle, `git fsck --full`, et un recomptage branche par
branche : 34/34, 1 116 refs, 191 branches, 33 tags, 50 269 fichiers, zéro écart.
Les 25 révisions citées par les 18 registres de provenance sont toutes présentes.
29 donneurs ont été retirés sur manifeste confirmé.

### 4. Trois capacités sans destination sont absorbées, pas supprimées

**`ecosystem-engine` → `crates/ecosystem-engine`.** Son artefact vivait déjà
ici : `ecosystem/objects` porte les 38 objets canoniques et
`ecosystem/projections/public.v1.json` la projection committée, tandis que le
seul outil capable de la vérifier vivait dans un autre dépôt. Le moteur la
reproduit exactement, vérifié avant le déplacement — l'artefact dérivé avait une
vérité atteignable et aucun contrôle atteignable, un écart à I-05.
`check:projection` exécute désormais `ecosystem-project --check` dans
`bun run check`, que le gate de composition lance.

L'absorption **supprime** deux des quatre paires vendorisées au lieu de les
assouplir : le schéma d'objet et la projection committée étaient vendorisés
depuis un pin `governance` parce que le moteur vivait ailleurs ; `src/graph.rs`
et `tests/public_projection.rs` les lisent maintenant dans `ecosystem/`. Une
copie qui n'existe pas ne peut pas dériver, ce qui est plus fort qu'une copie
qu'un gate surveille.

**`classification` (K2) → `packages/classification`.** Sous-paquet exporté, non
code inliné : son sceau est intra-processus et les sources de vérité qu'il garde
sont écrites par deux autorités, donc une extraction ultérieure reste un
déplacement d'historique, pas une réécriture. Et K2 cesse d'être nominal :
`ecosystem/build-index.ts` classe l'inventaire committé `authoritative`, dérive
l'index publié, et exige l'autorité au puits avant d'écrire. Un invariant
qu'aucun code n'exerce est une affirmation, pas un contrôle.

**`knowledge` → `ecosystem/knowledge-projection.ts`.** Conservé pour une seule
raison qui vaut le fichier : il calcule le digest de sélection une seconde fois,
dans un autre langage, par une canonicalisation écrite indépendamment du moteur.
Une implémentation seule qui s'accorde avec elle-même prouve le déterminisme, pas
la correction — un défaut de canonicalisation se reproduirait fidèlement et
resterait invisible. `check:projection:digest` échoue si les deux divergent.

**Amendement d'ADR-0024 §2.2.** Sa clause « aucune fusion », arbitrée le
2026-08-18, visait neuf satellites de code partagé « en attente de
consommateurs ». Elle est amendée pour ces trois-là seulement, au motif que la
mesure a changé : leur dépôt disparaît, et deux d'entre eux portent une capacité
dont l'artefact ou le chemin d'écriture vit dans l'autorité. Les six autres
satellites ne sont pas touchés.

**Amendement d'I-28.** Le gate de `rev` orphelin cite
`ecosystem-engine/scripts/check-patch-rev.ts` comme réalisation de référence. Le
chemin devient `crates/ecosystem-engine/scripts/check-patch-rev.ts`, et le gate
retrouve un cas d'usage vivant : `project-governance` est désormais consommateur
secondaire du patch `biscuit-auth` dont `capability-authorization` est le foyer.

### 5. `carriere` est conservé et déclaré

I-16 a abrogé les préconditions de la loi de couverture comme conditions
d'existence d'un repository, et ADR-0023 §2.2 confine la loi d'exposition à la
seule vitrine. Un dépôt sans code n'est donc pas un défaut ; un dépôt observable
absent de l'inventaire en est un. Le registre de transition interdit par ailleurs
sa « suppression implicite ». Il entre à l'inventaire avec son périmètre déclaré
à clarifier et son prédicat de mort inchangé.

### 6. Une seule modification de contrôle de protection, nommée

Le dépôt de profil `libre-ai/.github` porte un `refoundation-no-bypass-branch`
sur `~ALL` **sans exclusion** et sans bypass : sa vitrine était inchangeable.
Périmètre autorisé et exécuté : ajout d'un `bypass_actors`
`OrganizationAdmin` sur ce seul ruleset, de ce seul dépôt, le temps d'un push,
puis **restauration à l'identique** (`bypass_actors: []`, `~ALL`,
`creation+deletion+update`, actif). Aucun autre contrôle n'a été touché.

### 7. Une classe de défaut, pas des accidents

Six gates lisaient un `main` codé en dur alors que les 19 destinations servent
`migrate/recover-code`, dont le `main` documentaire est un ancêtre. Chacun
mesurait donc le mauvais arbre, et deux déclaraient défaillant un dépôt
conforme :

| Gate | Effet du défaut |
| --- | --- |
| `check-audit-delta` | base vide → tout avis déjà porté par la base lu comme « introduit par ce changement » |
| `check-context-conformance` | `AGENTS.md` présent déclaré manquant |
| `check-dependabot-conformance` | `{workflows:false, cargoToml:false}` pour les 19 — aucun dépôt notable |
| `check-patch-rev` | toute `rev` correctement épinglée déclarée orpheline |
| pointeur d'autorité de `check-context-conformance` | exigeait un lien **récupérable** vers `governance` ou `contracts`, deux dépôts retirés |
| `check-vendored` | filtrait sur `.wit` alors que les entrées sont des répertoires : 14 fichiers vendorisés jamais comparés, et un succès affiché depuis le compte de la paire voisine |

Tous résolvent désormais la branche par défaut du dépôt lu, et leurs messages
nomment « on the default branch » plutôt que « at main » — un message qui nomme
la mauvaise ref envoie le lecteur au mauvais arbre. Deux gates gagnent en outre
un refus explicite : le compte par paire de `check-vendored`, et le refus des
noms d'autorité retirés, testé plutôt que simplement obtenu.

Le gate de licences JS, lui, a appris la différence entre une décision d'entrée
et du code de première partie, en reconnaissant la provenance par la **source
résolue** du lockfile et non par un nom de paquet qu'un attaquant peut
revendiquer.

## Conséquences et limites

Le gate de dérive d'inventaire passe de 21 assertions rouges à 4 : `governance`
et les trois briques absorbées. Il n'est pas vert, et c'est son rôle : il mesure
l'écart restant à la cible et passera au vert au retrait du dernier donneur.

`project-governance` acquiert une chaîne Cargo, qu'il n'avait pas. Le coût n'a
pas été retenu comme critère ; en revanche la complétude l'a été, et une crate
que le gate de composition ne compilerait pas aurait reproduit le défaut qu'on
ferme : `bun run check` reçoit donc les maillons `check:rust` et
`check:projection`.

`signalement` et `pi-evidence` consomment encore des workflows réutilisables de
`governance` à SHA épinglé — 11 références sur quatre surfaces. Leur
re-épinglage sur `project-governance` est la précondition du retrait de
`governance`, et il exige que cette pull request soit fusionnée d'abord.

Aucune licence, aucun fournisseur, aucun profil de déploiement n'est remplacé
silencieusement. La classe de licence amont des artefacts vendorisés est
réancrée explicitement : sous `crates/**` ils seraient EUPL-1.2 et leurs
documents CC-BY-4.0, alors qu'en amont sous `contracts/**` l'arbre entier est
Apache-2.0. Une copie vendorisée ne change pas de licence en traversant un
dépôt.

## Preuves

`bun run check` sort à 0 sur 28 maillons, avec 1 083 tests Bun et 15 tests Rust.
`check-vendored` rapporte 20 fichiers contre 8 avant réparation. Le gate de `rev`
orphelin rapporte `identical`. `ecosystem-project --check` reproduit la
projection committée octet pour octet, et `check:projection:digest` retrouve son
digest de sélection par une seconde implémentation.
