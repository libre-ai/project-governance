# ADR-0025 — Une collection de skills gouvernée, admise et testée, jamais recopiée

- **Statut :** accepted — la ratification est le merge propriétaire de cette
  pull request.
- **Arbitrage :** propriétaire, remise à plat du 2026-08-18 (domaine E —
  Skills & collection) — le présent ADR, le nouveau bucket `skills/**` de
  `REUSE.toml`, l'outillage `tools/skills/` et les six skills admis sont la
  doctrine à laquelle toute skill future de la flotte converge.

Owner-arbitration: 2026-08-18

- **Date de rédaction :** 2026-08-18
- **Portée :** admission, gouvernance et licence d'une collection de skills
  agentiques (harness d'ingénierie) sous `governance/skills/` — comment une
  skill entre dans la collection, comment elle en sort, ce qui la distingue
  d'un plugin machine et d'une capacité produit couche-2.
- **Étend :** I-17 (surface à touche humaine fermée — l'admission d'une
  skill et sa dépréciation restent un acte propriétaire, jamais un gate
  auto-suffisant), I-13 (la méthode est le produit zéro — une collection de
  skills gouvernée en fait partie).
- **N'amende aucun contrat verrouillé.**

## Contexte

Un harness agentique lit des skills — des fichiers `SKILL.md` qui chargent
une procédure dans le contexte d'un agent, à la demande (« model-invoked »)
ou sur invocation explicite (« user-invoked »). Deux sources existaient déjà
sans gouvernance commune : des skills machine locales (`~/.claude/skills/`,
non versionnées, parfois contaminées par du contenu du contexte pro) et des
candidats de portfolio couche-2 encore au stade idée
(`ecosystem/portfolio.v1.yaml`, famille `patterns-skills`, source Fabric —
une bibliothèque de patterns pour Polaris, pas encore un produit). Aucune des
deux n'est une collection **versionnée, testée, licenciée** que la flotte
peut consommer et faire évoluer sous revue. Ce vide produit deux risques
mesurés à l'admission des six premières skills (voir « Vérification de
collision » plus bas) : une skill machine et une skill gouvernance peuvent
porter le même nom sans qu'aucun mécanisme ne le remarque, et une skill
gouvernance peut recouvrir un gate déjà mergé par un domaine concurrent de la
même remise à plat sans qu'aucune revue croisée ne l'attrape avant merge.

## Décisions

### D1 — Emplacement, licence, et un nouveau bucket REUSE

La collection vit sous `governance/skills/<nom>/SKILL.md` (+ `references/`
si le corps dépasse son budget par scission thématique, jamais par
troncature). `REUSE.toml` gagne un nouveau bucket, créé par le présent ADR
et non par analogie avec un bucket voisin :

```toml
[[annotations]]
path = ["skills/**"]
precedence = "closest"
SPDX-FileCopyrightText = "2026 Libre AI contributors"
SPDX-License-Identifier = "Apache-2.0"
```

Apache-2.0, pas EUPL-1.2 : une skill est un artefact de **portabilité**
(adoption par n'importe quel harness de la flotte ou hors flotte), pas un
composant réseau qui appelle une réciprocité EUPL — le même raisonnement que
`tools/**` et les contrats d'interopérabilité dans `LICENSING.md`. Chaque
`SKILL.md` porte en plus un en-tête SPDX inline (balise `SPDX-License-
Identifier`, valeur `Apache-2.0`) — délibérément redondant avec le
bucket `REUSE.toml` : une skill est conçue pour être copiée telle quelle
dans un autre harness, où `REUSE.toml` de ce dépôt ne la suit pas ; la
licence doit voyager avec le fichier, pas seulement se résoudre depuis ce
dépôt. `LICENSING.md` §« First-party software » gagne la ligne
correspondante.

### D2 — Admission : anti-doublon interne, eval obligatoire, collision manuelle documentée

Une skill entre dans la collection quand trois conditions tiennent
simultanément :

1. **Anti-doublon interne (gate T2, `check:skills-routing`).** Sa
   description ne recouvre à ≥75 % aucune autre description admise (TF-IDF
   cosinus, seuil jamais assoupli — une collision se corrige en réécrivant
   la description, jamais en relâchant le seuil) ; ≥50 % est un
   avertissement non bloquant qui invite à la réécriture.
2. **Eval obligatoire (gate T1, `check:skills`, plus `check:skills-routing`
   pour la partie routage).** Un fichier `eval.json` porte au moins 3
   déclencheurs positifs, 2 déclencheurs négatifs et exactement 1 cas
   comportemental (`scenario` + `expected`). Les déclencheurs positifs sont
   effectivement rejoués par `check:skills-routing` : la skill visée doit
   gagner le rang 1 au-dessus d'un plancher configurable
   (`SKILLS_RANK1_FLOOR`, valeur par défaut calée sur le corpus réel — la
   corriger en réécrivant la description, jamais en assouplissant le
   plancher). Les déclencheurs négatifs et le cas comportemental restent des
   fixtures de revue : aucun gate ne prétend les noter mécaniquement (voir
   `tools/skills/check-skills-routing.ts`, section « pourquoi pas » dans son
   en-tête).
3. **Vérification manuelle de collision avec les plugins machine, à
   l'admission — documentée, jamais scriptée sur un état périmé.** Aucun
   inventaire versionné des plugins machine locaux n'existe (ils vivent hors
   de ce dépôt, par construction — voir `bounded-context-isolation.md` côté
   harness) : un script qui les listerait figerait un instantané faux dès le
   lendemain. La vérification est donc un constat humain, journalisé dans le
   changeset qui admet la skill, jamais un gate CI qui prétendrait couvrir
   une liste qu'il ne peut pas tenir à jour. Constats de l'admission des six
   premières skills, ci-dessous.

### D3 — Dépréciation : suppression, jamais un flag caché

Déprécier une skill est une suppression du répertoire
`skills/<nom>/`, jamais un frontmatter `deprecated: true` qui laisse le
fichier chargeable. Le changeset de suppression nomme explicitement son
remplaçant (une autre skill, un gate, un pointeur doctrine) — une
dépréciation sans remplaçant nommé est un signal que la capacité disparaît
purement et simplement, à faire trancher par l'acte propriétaire, pas à
laisser implicite dans un message de commit.

### D4 — `.out-of-scope/` : la mémoire des refus, consultée avant tout réexamen

`skills/.out-of-scope/` porte un fichier par idée de skill explicitement
refusée, avec la raison. Avant de proposer une nouvelle skill ou de
rouvrir une idée déjà écartée, `.out-of-scope/` se consulte — un refus
motivé qui se rediscute sans relire sa propre justification n'est pas une
revue, c'est un oubli. Deux entrées day-1, posées par le présent ADR (voir
« Conséquences »).

### D5 — Budget de corps : 120 lignes cible, 200 lignes avertissement CI

Le corps d'un `SKILL.md` (après le frontmatter) vise 120 lignes. Le gate T1
n'échoue jamais sur ce seuil — un budget de style n'est pas une assertion de
correction — mais avertit (non bloquant) au-delà de 200 lignes, en invitant
à la scission par divulgation progressive (`references/`). `biscuit-auth`
applique déjà cette scission dès l'admission (authority/attenuation/policies
au corps, rotation/révocation en référence) — pas parce qu'il dépasse 200
lignes, mais parce que la rotation/révocation n'est pertinente qu'à une
fraction des tâches qui invoquent la skill (voir
`docs/method/SKILLS-ANATOMY.md`, « test de coupure »).

### D6 — Frontmatter : anglais, `status` fermé, licence déclarée

Le frontmatter (`name`, `description`, `license`, `status`, et
`disable-model-invocation` quand applicable) est en anglais, y compris sur
les skills dont le corps reste en français — c'est la surface que le
mécanisme de routage d'un harness lit pour décider quelle skill charger,
elle doit rester lisible et comparable indépendamment de la langue du corps.
`status` est fermé à `candidate` (skill admise, pas encore éprouvée à
l'usage réel) ou `promoted` (usage réel confirmé, aucun gate ne fait cette
promotion automatiquement — acte propriétaire). Les six skills admises par
le présent ADR portent toutes `status: candidate`.

## Vérification de collision (admission des six premières skills)

Constat manuel du 2026-08-18, journalisé ici conformément à D2.3 :

| Skill                | Collision trouvée                                                                                                                                                                                                                                                           | Résolution                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `biscuit-auth`       | **Nom identique** à une skill machine locale existante (`~/.claude/skills/biscuit-auth/SKILL.md`, 163 lignes, français). `grep` négatif sur les identifiants privés de contexte pro deny-listés par `context-hygiene.yml` (hôtes internes, organisation) dans cette source. | Admise comme version canonique de flotte, adaptée de la source (authority/attenuation/policies au corps, rotation/révocation scindée en `references/`). Le sort de la copie machine locale est une décision de harness, hors périmètre de ce dépôt.                       |
| `deploy-clever`      | **Nom/fonction proches** d'une skill machine locale existante (`deploy: Deploy application to Clever Cloud with pre-flight checks`), contaminée par du contenu pro (mentions GitLab/`glab`) et non lue par construction (consigne d'admission).                             | Réécrite de zéro, périmètre strictement Clever Cloud + GitHub Actions, aucune mention d'une autre forge. Ne se substitue pas à la skill machine locale, qui reste hors périmètre de ce dépôt.                                                                             |
| `context-conformity` | **Collision de domaine (pas de nom)** avec `check-context-conformance` (`ecosystem/check-context-conformance.ts`, `docs/method/CONTEXT-TEMPLATE.md`), mergé la même vague par le domaine D — structure/plafonds `AGENTS.md`/`CLAUDE.md`.                                    | Portée resserrée pour ne pas dupliquer : `context-conformity` pointe vers `CONTEXT-TEMPLATE.md`/`check-context-conformance` pour la forme d'`AGENTS.md`, et couvre ce que ce gate ne couvre pas — gates de qualité verts, workflows réutilisables consommés, trailer DCO. |
| `review-fanout`      | Proximité de nom avec les skills machine `review` (checklist solo) et `code-review` (revue de PR) — périmètre distinct (fan-out multi-agent par rôle, pas une passe solo).                                                                                                  | Aucune fusion : les trois skills couvrent des besoins différents, documentés comme tels dans `review-fanout/SKILL.md`.                                                                                                                                                    |
| `rgpd-dpia`          | Aucune collision trouvée (recherche machine + flotte).                                                                                                                                                                                                                      | Admise sans réserve.                                                                                                                                                                                                                                                      |
| `verify-runtime`     | Aucune collision de nom ; proximité fonctionnelle avec la skill machine `run` (lancer l'app) — périmètre distinct (verdict PASS/FAIL/BLOCKED/SKIP sur un changement précis, pas un lancement général).                                                                      | Aucune fusion ; source = archive `pi-harness-challenger` (bundle de secours), adaptée : toute mention Pi retirée, contenu propriétaire, pas d'attribution tierce requise.                                                                                                 |

La collision `context-conformity` est la plus significative : elle démontre
D2.3 en conditions réelles — deux domaines de la même remise à plat ont
convergé sur des noms proches pour des besoins adjacents, sans se voir avant
merge. Aucun gate CI ne l'aurait attrapée (les deux artefacts sont
syntaxiquement valides et ne se référencent pas). Seule la vérification
manuelle documentée, exécutée au moment de l'admission plutôt que sur un
inventaire figé, l'a trouvée.

## Provenance de `verify-runtime` (ADR-0024 §2.3)

ADR-0024 (domaine B, 2026-08-18) retire un dépôt de recherche locale de
durcissement de harness agent (jamais publié sur GitHub, 90 fichiers suivis,
préservé par bundle vérifié) et en verse sept éléments réutilisables comme
intrants aux « domaines skills et outillage agent », sans en fixer le
contenu ni la forme. Le troisième de ces éléments est nommément « un skill
de vérification d'environnement d'exécution avant délégation d'une tâche
agent (`verify-runtime`) ». Le bundle de secours consommé ici
(`pi-harness-challenger-rescue-2026-08-18`, 90 fichiers suivis, même
description « package local d'expérimentation pour renforcer le harness Pi
sans remplacer ses ressources existantes ») est ce même dépôt : le compte de
fichiers et la description concordent. Les six autres éléments versés par
ADR-0024 §2.3 (taxonomie de risque, registre de capacités, fixture
anti-injection, corpus de commandes bénignes, checklist sandbox, méthode de
revue avec preuve) vivent dans ce même bundle sous `extensions/policy-gate`
et ailleurs — hors du périmètre du présent ADR, qui n'admet que
`verify-runtime` : leur intégration reste au domaine outillage agent.

## Ce que la collection n'est pas

- **Pas `patterns-skills`.** `ecosystem/portfolio.v1.yaml` porte
  `patterns-skills` (couche-2, source Fabric, `exposure: idea`) : une
  bibliothèque de patterns d'agent en tant que **capacité produit future**
  de Polaris, pas encore construite. `governance/skills/` est l'inverse :
  une collection déjà versionnée, testée et consommée aujourd'hui par le
  harness d'ingénierie de la flotte. `docs/decisions/LEXICON.md` gagne
  l'entrée qui désambiguïse les deux (voir « Conséquences »).
- **Pas un remplacement des skills machine locales.** Ce dépôt ne peut ni
  lire ni gouverner `~/.claude/skills/` — hors de son périmètre par
  construction (isolation de contexte harness). Une skill admise ici que
  son équivalent machine local rend redondante n'efface pas cet équivalent :
  seul un acte de harness le fait, hors de ce dépôt.

## Conséquences

- Le registre des invariants gagne I-25, sourcé par le présent ADR ; le
  registre des décisions gagne D33.
- `docs/decisions/LEXICON.md` §4 (glossaire produit) gagne l'entrée
  `skills` qui désambiguïse la collection de `patterns-skills`.
- `docs/README.md` (carte d'autorité) gagne la ligne « Collection de skills
  du harness » → `governance/skills/` (le présent ADR, gouvernance :
  `docs/method/SKILLS-ANATOMY.md`).
- `LICENSING.md` §« First-party software » gagne la ligne `skills/**` →
  Apache-2.0.
- `tools/skills/lint-skill.ts` + `check-skills.ts` (T1) et
  `check-skills-routing.ts` (T2) sont câblés dans `bun run check` via
  `check:skills` et `check:skills-routing` — contrairement à
  `check:context-conformance` (domaine D), qui reste volontairement hors de
  l'agrégat pendant sa propre vague de conformité ; les deux domaines ont
  tranché indépendamment, aucune incohérence à corriger.
- Six skills admises : `review-fanout`, `context-conformity`,
  `deploy-clever`, `rgpd-dpia`, `biscuit-auth`, `verify-runtime`, chacune
  `status: candidate`, chacune avec son `eval.json`.
- Deux entrées day-1 sous `skills/.out-of-scope/` :
  `writing-for-agents-as-skill.md` (la doctrine d'écriture des skills vit
  dans `docs/method/SKILLS-ANATOMY.md`, jamais dupliquée en skill — deux
  sources de vérité sinon) et `verify-the-world-as-skill.md` (la doctrine de
  test générale est absorbée par `verify-runtime` et par
  `docs/reviews/AGENT-REVIEW-PROTOCOL.md`, pas une skill séparée).

## Ce qui n'est pas décidé ici

- Aucune skill n'est promue `promoted` par le présent ADR — les six sont
  `candidate`, l'usage réel tranchera la promotion, acte propriétaire.
- Le sort des skills machine locales homonymes (`biscuit-auth`,
  `deploy`) n'est pas tranché ici : décision de harness, hors du périmètre
  de ce dépôt.
- Aucun gate n'automatise la vérification de collision avec les plugins
  machine (D2.3) : en établir un scripterait un inventaire que ce dépôt ne
  peut pas tenir à jour, et masquerait la constatation derrière un vert
  trompeur.
