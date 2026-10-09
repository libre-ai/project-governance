# ADR-0047 — Specification Lock des vecteurs de liaison d'une demande de décision

- **Statut :** proposed — la fusion de cette pull request constitue l'arbitrage propriétaire
- **Date :** 2026-10-09
- **Arbitrage :** le propriétaire a demandé en chat de préparer le verrouillage et de le signer lui-même par la fusion (« Préparer, je merge moi-même »). Owner-arbitration: 2026-10-09 — préparation demandée ; la fusion de cette pull request et celle de `libre-ai/schemas-and-contracts` #22 sont la signature
- **Portée :** le jeu de vecteurs sémantiques `decision-binding-vectors.v1` de `libre-ai/schemas-and-contracts`.
- **Précise :** ADR-0036 / D42 (verrou de la famille authorized-execution) : sans en modifier le texte ni aucun de ses artefacts, ajoute un jeu verrouillé à côté de ceux qu'elle a verrouillés.
- **Applique :** I-17 (surface à touche humaine fermée : un Specification Lock est une signature) ; I-18 (données `operational` jamais autorité : une demande ne peut pas déclarer sa propre politique).
- **Autorise :** l'inscription de D69 ; le verrouillage, par la pull request #22 de `libre-ai/schemas-and-contracts`, des octets relus du jeu (SHA-256 `49328cae505b72e54275b1481ad8fc8b16547639ff02ceb49c68a6d911ab807e`) sous `contracts/fixtures/authorized-execution-v1/`, gardés comme `semantic-vectors.v1` (empreinte relue, contrôle `check-contracts`).
- **N'autorise pas :** la modification d'un artefact déjà verrouillé ; une nouvelle sorte d'entrée au catalogue ; une capacité runtime, un effet réel ou un déploiement ; la liaison du libellé d'un choix, qui exige une nouvelle version majeure de `execution-graph-v1`.

## Contexte

Les vecteurs verrouillés du domaine `decision` jugent une réponse contre sa seule demande.
Une demande porte ses propres choix (`choiceId` → `consequenceCode`), son issue en
l'absence de réponse et son rôle requis. Un évaluateur conforme acceptait donc une demande
qui inverse les issues de ses choix, ou qui abaisse le rôle de l'approbateur.
`execution-continuity-evaluator` 0.2.0 le faisait.

Le candidat `decision-binding-vectors.v1` (`libre-ai/schemas-and-contracts` #19, `599cd8e`)
exige qu'une demande reprenne exactement la politique de son pas : même correspondance
choix → issue, même issue sans réponse, même rôle, sous le graphe et l'organisation qu'elle
nomme. Il a passé trois rondes de revue à rôles séparés, architecture et sécurité, sur des
commits immuables (deux modèles distincts en rondes 1 et 2) :

| Ronde | Architecture | Sécurité |
| --- | --- | --- |
| 1 | accept-with-findings | accept-with-findings |
| 2 | accept-with-findings | accept-with-findings |
| 3 | **accept** | **accept-with-findings** (une formulation, appliquée) |

Aucune ronde n'a eu de constat bloquant. `execution-continuity-evaluator` 0.3.0
(`3cf8d67`, #11) implémente la liaison (`evaluate_bound_human_decision`).

## Décision

Le jeu est verrouillé sur le précédent de la famille, sans nouvelle sorte d'entrée au catalogue
(`schemas-and-contracts`, `docs/adr/2026-10-09-decision-binding-vectors-lock.md`) :

- les octets relus passent inchangés sous `contracts/fixtures/authorized-execution-v1/` ;
- leur SHA-256 est épinglé dans `reviewedAuthorityHashes` ;
- `check-contracts.ts` les contrôle comme `semantic-vectors.v1` : JSON strict, bornes,
  contenu public, enveloppe, identifiants, couverture et rejeu de chaque cas.

**Écart avec le dossier relu, signé par cette fusion.** Le dossier de revue annonçait comme acte
de verrouillage une nouvelle sorte d'entrée « vecteurs » au catalogue. Les relecteurs de rôle ont
jugé le contenu des vecteurs, pas cette forme de verrou. Cette ADR retient l'autre voie : la forme
déjà employée par la famille verrouillée. Une sorte « vecteurs » imposerait de changer les racines
gérées du contrôleur et de passer par le registre post-verrouillage épinglé. Elle obligerait aussi
à cataloguer les vecteurs déjà verrouillés, ou à les laisser seuls hors catalogue. Elle reste
possible plus tard, pour tous les fichiers de vecteurs à la fois.

Toute évolution de sens est une nouvelle majeure (`decision-binding-vectors.v2`), jamais une
édition en place.

## Conséquences

- Le contrat définit la liaison côté demande. Un évaluateur qui s'en réclame refuse une demande
  non liée (`graph-binding-mismatch`, `step-not-decision`,
  `decision-policy-mismatch`), et lève sur un pas en double ou un choix répété.
- Aucun consommateur n'est encore tenu de rejouer ce fichier : le work package du cœur natif ne
  lit que `semantic-vectors.v1`. `execution-continuity-evaluator` pourra le rejouer quand sa
  composition épinglera une révision des contrats qui le contient ; d'ici là, ses tests
  reproduisent les cas en fixtures Rust.
- **Risque résiduel déclaré** : le libellé d'un choix, ce que lit l'approbateur, n'est pas lié.
  La politique du graphe n'en porte pas. Jusqu'à une majeure de `execution-graph-v1`,
  l'émetteur ne prend jamais un libellé du demandeur.
