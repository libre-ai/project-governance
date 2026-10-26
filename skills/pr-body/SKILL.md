---
name: pr-body
description: Write a pull request description in the fleet template format — the declaration block on its first lines (Door one-way or two-way, Origin of the problem, plus Second-instrument, Owner-arbitration and Not-added lines when they apply), then summary by its smallest visual, before/after evidence and blast radius. Use when opening a pull request or rewriting its description.
license: Apache-2.0
metadata:
  status: candidate
---

<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Corps de pull request (format de flotte)

Le format est celui du gabarit de flotte, `.github/pull_request_template.md` du dépôt `libre-ai/.github`. Le lire au moment d'écrire (`gh api repos/libre-ai/.github/contents/.github/pull_request_template.md --jq .content | base64 -d`), jamais de mémoire : si le gabarit a bougé, c'est lui qui fait foi, pas ce fichier. Dans `libre-ai/project-governance`, le contrat est appliqué par `tools/quality/check-pr-door.ts` (check requis « Door declaration ») et `tools/quality/check-pr-negatives.ts` (« Negatives declaration ») ; en cas d'écart, le code fait foi.

## Entrées à résoudre avant d'écrire

1. Branche servie : `git ls-remote --symref origin HEAD`. Jamais `main` supposé.
2. Fichiers touchés : `git diff --name-only origin/<servie>...HEAD`.
3. Preuves déjà produites dans la session : sorties rouges puis vertes des tests ajoutés, sortie brute du check agrégé du dépôt (`package.json` `scripts.check` ou équivalent), lancé **après** `git add`. Une preuve absente se déclare absente ; elle ne se reconstitue pas.

## Le bloc de déclaration

Les déclarations ne se lisent qu'à un endroit : le **bloc** en tête de la description.

- **Position.** Le bloc occupe les premières lignes. Seuls peuvent le précéder des commentaires HTML d'une ligne, complets, en colonne 0 (les lignes SPDX du gabarit). Puis des lignes consécutives `Clé: valeur`, la clé en colonne 0, sensible à la casse.
- **Fin.** Le bloc se termine par une ligne vide, obligatoire. Une ligne non vide qui n'est pas une déclaration juste après le bloc (un `## Summary` collé) fait échouer le gate.
- **Refus hors bloc.** Une ligne-clé en colonne 0 écrite ailleurs dans la description est refusée, sauf dans un commentaire HTML ou un bloc de code clôturé, l'un comme l'autre ouvert en colonne 0 juste après une ligne vide, et placé avant toute ligne, y compris à l'intérieur d'un bloc de code ou d'un commentaire, qui contient `--!>` n'importe où, ou qui commence (après au plus trois espaces) par `<pre`, `<script`, `<style` ou `<textarea` en toute casse suivi d'un espace, de `>` ou de la fin de ligne, ou par `<![CDATA[`, `<!` suivi d'une lettre ou `<?` sans sa fermeture (`]]>`, `>`, `?>`) plus loin sur la ligne : après une telle ligne, plus aucune ligne-clé n'est exemptée jusqu'à la fin. Le gate repère ces lignes sans tenir compte du rendu : un `<pre>` dans un exemple de code, ou une flèche `--!>` dans la prose, suffit à lever les exemptions qui suivent. Pour `Not-added:`, toute ligne visible dont le **début rendu** se lit comme la clé est refusée aussi (derrière `>`, `-`, `*`, `#`, un backtick, du gras, en minuscules). Dans la prose, ne jamais commencer une ligne par une clé ; une mention en milieu de phrase passe.

| Clé | Quand | Valeur |
| --- | --- | --- |
| `Door:` | toujours, une seule ligne | `two-way` si annuler le merge rend l'état antérieur ; `one-way` sinon (suppression de dépôt ou de branche protégée, release ou paquet publié, ruleset, migration de données, force push, message envoyé hors du dépôt). Dans le doute, `one-way`. Rien d'autre sur la ligne : la ligne du gabarit `Door: one-way \| two-way` est refusée. |
| `Origin:` | toujours, une seule ligne | voir le vocabulaire ci-dessous |
| `Second-instrument:` | obligatoire si `one-way` | la mesure indépendante prise avant l'acte, par un instrument **différent** de celui qui a produit le vert (autre API, autre protocole, autre chemin de données), et son résultat ; au moins 12 lettres ou chiffres, jamais `n/a`, `none`, `tbd`. Dire dans le corps ce que le premier instrument exclut par construction. |
| `Owner-arbitration:` | chemin gardé touché | `<date ISO de l'arbitrage> <où il a été donné>` (section suivante) |
| `Not-added:` | facultative, au plus une ligne | section `Not-added:` ci-dessous |

**Vocabulaire d'`Origin:`** (ADR-0056 D1, liste fermée, en minuscules) — d'où vient le problème traité :

- `observed YYYY-MM-DD <source>` — une panne survenue en usage réel, ou un fait périmé daté et cité. La date est une date ISO qui existe au calendrier et n'est pas dans le futur ; la source nomme une pull request, une issue, un `chemin:ligne` ou une note de session, jamais un mot de remplissage ;
- `inspection` — un défaut trouvé en lisant du code, de la doctrine ou un outil ;
- `synthetic` — un cas construit pour l'occasion (sonde, fixture, vecteur, mutation) : une sonde qui rougit est `synthetic`, même quand elle reproduit un défaut réel ;
- `proposal` — une amélioration sans défaut constaté.

Rien ne suit une valeur autre qu'`observed`. Un problème à plusieurs origines déclare celle qui l'a déclenché et cite les autres dans le corps.

**Règle des valeurs.** Hors code span, une valeur ne porte ni `[`, ni `]`, ni `~`, ni `$`, même échappés, ni HTML, ni `<` autre qu'un autolien complet `<https://…>` : pas de lien markdown, d'image, de barré ni de maths. Un lien s'écrit nu (`https://…`) ou en autolien ; tout le reste (un chemin `~/…`, un `$VAR`) va dans un code span, qui se ferme sur la même ligne. Une valeur refusée fait échouer le gate, et les lignes du bloc qui la suivent ne sont plus lues.

Exemple de bloc (porte two-way, chemin gardé, aucune dépendance touchée) :

```text
<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Door: two-way
Origin: observed 2026-10-07 #123
Owner-arbitration: 2026-10-13 owner decision in chat
Not-added: dependency, hosted-service

## Summary
```

## `Not-added:`

Ce qu'une pull request qui ajoute une capacité n'ajoute **pas** (ADR-0056 D5) : valeurs de la liste fermée `dependency`, `schema`, `workflow`, `hosted-service`, `telemetry`, `public-surface`, séparées par des virgules, chacune une fois.

- `dependency`, `schema` et `workflow` sont **vérifiées contre le diff** : déclarées, elles affirment que le diff **ne touche pas** leur surface, et tout contact fait échouer le gate (« cannot verify: <chemin> changed »). Les surfaces sont en donnée dans `tools/quality/pr-negatives.v1.json`, lu à la base de fusion : le lire, ne pas le recopier, et confronter aux fichiers touchés. Elles sont larges à dessein (`dependency` couvre manifestes, lockfiles, workflows, `Dockerfile`, `toolchains/`… ; `schema` tout `.json` ou `.yaml` ajouté ou modifié dont le texte contient `schema` ou un échappement `\u`, `\x`).
- On ne déclare une négative vérifiable que si le diff ne touche pas sa surface. Dans le doute, ne pas la déclarer : la ligne est facultative.
- `hosted-service`, `telemetry` et `public-surface` sont déclaratives, lues en revue.

## Sections, après le bloc

- **Summary** — le plus petit visuel qui porte le changement : un tableau avant/après, ou la liste des fichiers qui bougent, ou un seul schéma. Un tableau plutôt qu'un paragraphe.
- **Evidence** — avant/après, par test ajouté : la sortie rouge sur le code non corrigé, puis la verte. La commande qui rejoue chaque chiffre.
- **Blast radius** — qui est atteint : dépôts consommateurs, branches, utilisateurs, flotte entière.

## Chemins gardés et `Owner-arbitration:`

Dans `libre-ai/project-governance`, la liste des chemins gardés est `GATED_PATH_PATTERNS` de `tools/quality/check-review-evidence.ts`. La lire **sur la base** (`git show origin/<servie>:tools/quality/check-review-evidence.ts`), jamais la recopier, puis la confronter aux fichiers touchés.

- Un fichier touché correspond : ajouter au bloc `Owner-arbitration: <date ISO de l'arbitrage> <où il a été donné>`, ou citer un artefact `docs/reviews/…` dans le corps. La date est celle d'un arbitrage **réel** du propriétaire dans la session ou un document ; ne jamais en écrire une pour faire passer le gate. Sans arbitrage, s'arrêter et poser la question au propriétaire (choix structuré, contexte restitué).
- Autre dépôt : chercher son équivalent (`grep -rln "Owner-arbitration" tools .github`). Aucun gate : aucune ligne.

## Vérification avant `gh pr create`

Dans `project-governance`, rejouer les deux gates sur le corps écrit, depuis la branche :

```sh
jq -Rs '{pull_request:{number:0,body:.}}' body.md > event.json
GITHUB_EVENT_NAME=pull_request GITHUB_EVENT_PATH=event.json bun tools/quality/check-pr-door.ts
GITHUB_EVENT_NAME=pull_request GITHUB_EVENT_PATH=event.json GITHUB_BASE_REF=<servie> bun tools/quality/check-pr-negatives.ts
```

Créer la PR avec `--body-file`, jamais en interpolant le corps dans la commande. Une description modifiée relance les deux checks.

## Interdits

- Aucun secret, aucune donnée personnelle, aucun chemin absolu machine-local dans le corps.
- Pas d'appréciation du travail (« propre », « robuste ») : des faits et leurs chiffres.

## Provenance

Idée adaptée du skill `pr` de `mattpocock/skills` (MIT) : porte et rayon d'impact déclarés par l'auteur. Aucun texte repris ; le menu de visuels de l'amont n'est pas repris.
