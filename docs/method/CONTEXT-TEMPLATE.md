# Gabarit de contexte agent — sections obligatoires et plafonds par couche

- **Arbitrage :** propriétaire, remise à plat du 2026-08-18 (domaine D —
  Contexte agent) — le gabarit ci-dessous et le gate mécanique qui le vérifie
  (`check-context-conformance`, `ecosystem/`) sont la doctrine à laquelle
  chaque `AGENTS.md` de la flotte converge, une vague de conformité à la fois.

Owner-arbitration: 2026-08-18

Trente-quatre repositories publics partagent une même doctrine (ce dépôt) et
un même mécanisme de chargement (`AGENTS.md` natif, `CLAUDE.md` adaptateur —
voir `DOCTRINE-REPLICATION.md` §« Mécanismes de chargement »). Sans gabarit,
chaque `AGENTS.md` dérive vers sa propre forme : sections absentes, longueur
non bornée, aucun renvoi vérifiable vers l'autorité qui le gouverne. L'audit
du 2026-08-18 mesure l'état réel : la quasi-totalité des satellites portent un
stub de neuf à dix-sept lignes, en prose, sans une seule section `## `. Ce
document fixe la forme cible ; `check-context-conformance` la vérifie
mécaniquement, repo par repo, sans jamais imposer un contenu, seulement une
structure.

## Table des gabarits

Une section « OBLIGATOIRE » doit être présente en tant que titre `## ` exact.
Le plafond de lignes est **bloquant** : au-delà, le gate échoue. **Il n'y a
jamais de plancher** — un `AGENTS.md` de dix lignes qui porte les sections
requises et le pointeur d'autorité est conforme.

| Couche (registre)                                 | Sections `## ` obligatoires                                                           | Plafond |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- | ------: |
| `couche-4`                                        | Authority, Boundaries, Quality gates, Agents                                          |      40 |
| `couche-3`, `couche-2`, `transverse` non-autorité | idem (+ mention verified-projection/pin si applicable)                                |      45 |
| `couche-1` actif (produit réservé activé)         | Purpose, Domain doctrine, Commands, Working here                                      |      60 |
| `transverse` autorité (`governance`, `contracts`) | Authority, Boundaries, Quality gates, Agents (+ Stack, Naming, Security si possédées) |      80 |

- « `transverse` non-autorité » = tout repo `layer: transverse` dont le
  `role` n'est pas `authority` (aujourd'hui : `.github`, `ecosystem-engine`,
  `db-inspect`).
- « `transverse` autorité » = `role: authority` — aujourd'hui `governance` et
  `contracts` seulement ; Stack/Naming/Security ne sont exigées que si le
  repo possède réellement ce qu'elles décrivent (un repo qui ne fixe aucune
  convention de nommage n'écrit pas de section Naming vide).
- « couche-1 actif » couvre l'état observé aujourd'hui (les huit produits
  réservés sont tous `lifecycle: active`). Un couche-1 qui ne serait plus
  actif n'a pas de gabarit fixé ici — cas à trancher le jour où il se
  présente, jamais par extrapolation silencieuse.
- Exemption : `libre-ai/.github` ne porte pas d'`AGENTS.md` (profil
  d'organisation, aucun agent n'y travaille) — `check-context-conformance`
  l'assert explicitement plutôt que de le sauter en silence.
- Exemption : tout repo `lifecycle: archived` est intégralement exempté, quel
  que soit son `layer` — `moyeu` n'a donc plus de ligne dans la table
  ci-dessus, son seul membre (`libre-ai/libre-ai`) étant archivé. Un contenu
  figé en lecture seule ne peut pas être mis en conformité : aucune section,
  aucun plafond, aucun pointeur, aucun marqueur de couche ne s'y applique.
  Conséquence mécanique de l'arbitrage propriétaire du 2026-08-18 : une
  exigence ne porte que sur ce qui peut encore être modifié.
  `check-context-conformance` l'assert nommément (« archived — content
  frozen read-only, conformance not applicable »), jamais en silence.

## Règles transverses

**Pointeur d'autorité, obligatoire, jamais en prose.** Chaque `AGENTS.md`
porte au moins une URL fetchable vers la doctrine :
`https://raw.githubusercontent.com/libre-ai/governance/main/...` (forme
canonique, lisible sans navigateur) ou `https://github.com/libre-ai/governance/...`
(lien de consultation). Une phrase du type « voir la doctrine governance »
sans URL ne compte pas — `check-context-conformance` cherche le motif, pas
l'intention. Un pointeur vers `contracts` s'ajoute seulement si le repo
consomme des contrats verrouillés (le gate n'exige jamais les deux).

**`CLAUDE.md` est un adaptateur strict.** Contenu octet-exact `@AGENTS.md\n`,
rien d'autre — présent si et seulement si `AGENTS.md` existe. Un `CLAUDE.md`
qui diverge de ce contenu, ou qui existe sans `AGENTS.md`, ou qui manque alors
qu'`AGENTS.md` existe, est une violation (`DOCTRINE-REPLICATION.md` §2 :
la sentinelle, ici réduite à l'égalité octet-exacte parce que le rendu est
constant, pas paramétré).

**Boundaries, sans dupliquer `project.v1.yaml`.** La section répond à « qu'est-ce
qui ne se construit **pas** ici, et où cela vit-il » — un renvoi, jamais une
recopie de l'état (exposition, hypothèse, critères) qui vit dans la fiche
`project.v1.yaml` du repo et n'a qu'une seule autorité.

**Quality gates, la commande agrégée seulement.** `bun run check` (ou son
équivalent local), jamais le détail de `package.json` — le détail dérive, la
commande ne dérive pas.

**Langue anglaise.** Tout `AGENTS.md`/`CLAUDE.md` de la flotte est en anglais
(convention déjà en vigueur, ce gabarit ne fait que la formaliser) ; le
français reste la langue de communication humaine, jamais celle de la
doctrine versionnée d'un repo public.

**Aucun `.claude/` tracké.** Doctrine actée : un répertoire `.claude/` suivi
par git dans un repo de la flotte est une violation, quel que soit son
contenu — les réglages d'agent sont locaux à la machine, jamais versionnés.

**Marqueur de couche, cohérent avec le registre.** Le texte contient le motif
`couche[- ]?[1-4]`, `transverse` ou `moyeu` correspondant exactement au
`layer:` déclaré pour ce repo dans `ecosystem/repositories.v1.yaml` — pas une
mention de n'importe quelle couche, la sienne. La convention « couche N » en
toutes lettres dans une phrase anglaise est déjà en usage (`envelope`:
« K3 kernel, couche 3 ») ; ce gabarit ne fait que l'exiger partout.

## Exemple — stub couche-4 réhaussé au gabarit

```markdown
# envelope Canonical Agent Rules

## Authority

Integrity envelope for untrusted content, couche 4 brick of the constellation.
Doctrine lives upstream: https://raw.githubusercontent.com/libre-ai/governance/main/docs/README.md

## Boundaries

- Contract shapes are canonical in `libre-ai/contracts`, never redefined here.
- Product code and product specifications live in their own repositories.

## Quality gates

Run `bun run check` before pushing; never hide a red test.

## Agents

- Stage files before running tree-walking gates.
- Security > quality > performance > completeness.
```

Vingt lignes, quatre sections, un pointeur fetchable, le marqueur de couche —
conforme au gabarit `couche-4` avec vingt lignes de marge sous le plafond. La
conformité n'est jamais une question de longueur.

## Ce que ce gabarit ne fait pas

- Il ne prescrit aucun contenu de doctrine — seulement une structure et un
  pointeur vérifiables.
- Il ne fixe pas de plancher : un stub conforme reste court.
- Il ne rend pas la flotte conforme lui-même — c'est `check-context-conformance`
  qui mesure l'écart, repo par repo. La vague de mise en conformité est passée
  (36/36 entrées du registre conformes, 2026-08-19) : le workflow tourne
  désormais aussi sur `pull_request`, et le check est requis au merge sur
  `governance` (`tools/security/check-branch-protection.ts --fix`).
