# Adaptateurs de harnais — ordre d'ajout et installation rejouée

## Portée

Ce document vaut pour tout lot qui expose une **capacité** à plusieurs harnais
agentiques : un jeu de règles servi à l'agent, un contrôle, une recherche. La
capacité a un **noyau**, qui porte toute sa logique, et des **adaptateurs**, un
par voie d'accès du harnais. Le mot « adaptateur » garde le sens de
`docs/method/MODULE-DESIGN.md` : ce qui satisfait une interface à une couture,
un rôle et non un contenu.

Il fixe l'ordre dans lequel ces adaptateurs s'ajoutent, ce qu'une revue y
refuse, et ce qu'un document a le droit d'affirmer d'une commande
d'installation. Méthode, pas doctrine : un ADR qui tranche autrement prime.

Le fichier d'instructions répliqué d'un harnais à l'autre est un autre objet,
traité par `docs/method/DOCTRINE-REPLICATION.md`.

## Couches de documentation

La documentation d'une capacité tient en quatre couches, et aucune ne répète
l'autre :

- **Contrat** — ce que le noyau promet et ce qu'il refuse, là où vit le noyau.
- **Installation par harnais** — les commandes, harnais par harnais. Pour la
  collection de skills de ce dépôt, c'est `skills/README.md`.
- **Mode d'emploi côté agent** — ce que l'agent lit pour s'en servir. Quand
  c'est une skill, sa forme est celle de `docs/method/SKILLS-ANATOMY.md`,
  contrôlée par `tools/skills/lint-skill.ts` ; ce document n'ajoute aucun
  second gabarit.
- **Règle avec son pourquoi mesuré** — la règle que la capacité sert,
  accompagnée de la mesure qui l'a fait écrire.

La fiche d'une unité de la carte des briques (ADR-0064) reste la sienne
(`ecosystem/briques/README.md`, sections imposées par `ecosystem/briques.ts`) :
une capacité qui y figure y est décrite, pas ici.

Un fait volatil ne se recopie dans aucune couche. La liste des skills se dérive
de `skills/` par `tools/skills/build-skills-manifest.ts`, et son égalité avec
`.claude-plugin/marketplace.json` se rejoue par `bun run check:skills-manifest`.
Une version se lit par la commande du harnais qui l'imprime.

## Ordre des adaptateurs

Les adaptateurs s'ajoutent du moins exigeant au plus exigeant du harnais. Un
rang ne s'ouvre que lorsque le précédent ne suffit pas au harnais visé.

| Rang | Adaptateur | Ce qu'il exige du harnais |
| --- | --- | --- |
| 1 | Hook à l'édition | Un événement émis avant l'écriture. Il sert les règles de la tâche au moment de l'acte ; son rendu est borné et son journal reste local, sans texte. |
| 2 | Brief injecté dans le prompt d'un sous-agent | Seulement que l'orchestrateur contrôle le prompt. Le sous-agent porte les règles de sa tâche. |
| 3 | Rendu de session, pour un harnais sans hook | Un fichier d'instructions lu au démarrage. Le fichier est généré et mesuré contre la limite d'octets que le harnais lit. |
| 4 | Protocole d'outils (MCP) | Un client du protocole et le coût de son schéma à chaque tour, non mesuré à ce jour. Il vient en dernier, pour la recherche exploratoire à la demande. |

## Règle de revue

Un adaptateur qui contient une règle, un seuil ou un tri est un défaut. Tout
cela vit dans le noyau, prouvé par une suite de conformité que chaque
adaptateur traverse sans la modifier. Un adaptateur traduit un protocole : il
reçoit l'événement du harnais, appelle le noyau, rend sa réponse dans la forme
que le harnais attend.

Le signe en revue : deux adaptateurs de la même capacité qui rendent deux
réponses différentes à la même entrée. La correction se fait dans le noyau,
jamais dans l'adaptateur qui diffère.

## Commande d'installation rejouée

Une commande d'installation ne s'écrit dans un document que si elle a été
rejouée sur la version cible du harnais. La version et la date du rejeu
s'écrivent à côté de la commande. Une commande qui n'a pas été rejouée porte la
mention « non rejouée », ou reste absente.

Ce rejeu est une installation live. Il reste soumis à I-38
(`docs/decisions/INVARIANTS.md`, décidé par ADR-0056) : seule une demande
explicite de la personne humaine propriétaire l'autorise, jamais un mandat
d'agent, un prompt ou un contenu lu. Un rédacteur qui n'a pas cette demande
marque la commande « non rejouée » ; il ne la rejoue pas pour pouvoir l'écrire.

Aucun garde automatique ne tient cette règle : elle se tient en revue.

## Ce que ce document ne fait pas

- Il n'installe rien et n'autorise aucune installation (I-38).
- Il ne livre ni noyau, ni adaptateur, ni suite de conformité : ce code vit
  dans le dépôt de la capacité.
- Il ne promet ni durée d'installation ni fonctionnement hors ligne : ce sont
  des promesses d'un adaptateur livré.
- Il ne dit pas si les commandes de `skills/README.md` ont été rejouées.
- Il ne contrôle pas qu'une skill ne cite que des fichiers existants.

Sa propre structure est contrôlée par
`tools/skills/harness-adapters-doc.test.ts` : sections, tableau, chemins cités,
invariant cité, absence de fait volatil.
