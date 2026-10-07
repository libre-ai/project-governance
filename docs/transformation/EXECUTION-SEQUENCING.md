# Execution sequencing — goals des vagues de migration (ADR-0009)

> **SUPERSÉDÉ par ADR-0020 (2026-07-28).** Le séquencement par vagues ne se
> relance plus : l'activation est générale et la migration intégrale se fait en
> une vague (D1/D4), ADR-0009 §8, ADR-0011 D1 et le cadre de vagues d'ADR-0018
> étant supersédés. L'ordre d'exécution du jalon γ vit désormais au design
> d'activation générale
> [`docs/superpowers/specs/2026-07-28-multi-repo-activation-design.md`](../superpowers/specs/2026-07-28-multi-repo-activation-design.md)
> §5.6. Le présent document reste **l'histoire** des vagues 0 à 2 exécutées et
> de la vague 3 ouverte : il n'ordonne plus rien et n'est pas une autorité
> vivante. Les politiques de gate qu'il cite et qui restent en vigueur
> (ADR-0011 D3 arrêt dur du lock orchestrateur, D4 confiance graduée,
> D6 plafonds) tiennent de leur ADR, pas de ce document.

Autorité de séquencement post-G2 jusqu'au 2026-07-28. Institué par l'ADR-0009 : la sortie du Big Bang s'exécute en vagues gated, chacune avec un objectif, une gate d'entrée, des livrables et une gate de sortie. Les phases G0–G5 de `GOALS.md` restent les phases de la refondation ; le présent document ordonne leur exécution après G2. Une vague ne s'ouvre que si sa gate d'entrée est verrouillée et ne se ferme que sur évidence publiée.

## Vague 0 — Vérité courante et instruments

**Objectif :** la constellation se pilote depuis des sources uniques, et sa preuve commence à se publier — première itération du traceur (la forge auto-documentée).

- **Gate d'entrée :** ADR-0009 ratifié (fait, 2026-07-19).
- **Livrables :**
  - `main` = vérité courante seule, socle et control plane (tag d'archive nommé puis retrait des strates obsolètes ; l'historique reste l'archive, on ne le réécrit pas) ;
  - `ecosystem/repositories.v1.yaml` — inventaire machine-lisible, source unique de la topologie publique ; il portait aussi l'état d'exposition des projets, clause supersédée depuis par ADR-0020 §2.2 (l'état d'un projet, exposition comprise, est porté par sa fiche `project.v1.yaml`) ; profil d'organisation et descriptions régénérés depuis lui ;
  - carte d'autorité documentaire (un sujet = une autorité) et décomposition de `vision.md` selon elle ;
  - première publication d'évidence de forge : journal public des verdicts de gates, rapports signés dans `distribution/evidence/` ;
  - audit de lignée pré-consolidation (optionnel, borné, sur décision propriétaire).
- **Gate de sortie :** aucun document vivant ne contredit la cible (gates CI étendues à l'inventaire) ; l'évidence publiée est accessible anonymement ; **test de l'agent froid** — une session neuve, munie du seul chargeur canonique, répond correctement aux questions de topologie, de doctrine et de statut sans correction.

## Vague 1 — Couche 4 : l'atelier applicatif exposé

**Objectif :** les outils des apps deviennent des produits publiés consommables hors du moyeu — et la méthode fait sa première preuve d'exploitation réelle sur eux.

- **Gate d'entrée :** G2 clos (identité `WP-G2-I01` → données `WP-G2-D01` → harness qualité `WP-G2-Q01`).
- **Livrables :** `ui`, `auth`, `sdk-ts` publiés en satellites (`@libre-ai/*`, miroirs en lecture seule) avec vitrines selon la loi d'exposition ; automatisation de bump et de release opérationnelle sur ces briques ; premières métriques de couverture publiées. Différés : `sdk-rs`, `starter` (dérivé de la première app).
- **Gate de sortie :** chaque brique consommée par au moins un usage réel ; part des opérations sans touche humaine mesurée et publiée ; évidence scellée.

## Vague 2 — Couche 3 : l'infrastructure de confiance

**Objectif :** les briques qui rendent les agents dignes de confiance existent, publiées, et la forge tourne dessus (dogfooding prouvé) — préalable structurel à toute expansion des agents.

- **Gate d'entrée :** sortie de vague 1.
- **Livrables :** `envelope` (doctrine anti-injection implémentée), `provenance`, `proof`, `artifacts` productisés ; classification `authoritative / derived / operational` opérationnelle sur les flux de la forge ; signatures d'évidence de bout en bout. `memory` en brique autonome arrive avec le lock orchestrateur (vague 3).
- **Gate de sortie :** la forge consomme ces briques en production réelle ; le noyau de sécurité des boucles (ADR-0009 §6) est spécifié et prêt à verrouiller ; évidence publiée.

## Vague 3 — Couche 2 : la méthode incarnée (Polaris)

**Objectif :** l'orchestration gouvernable devient produit — la boucle auto-alimentée officielle démarre, la flotte étant son premier client. La couche 2 porte le nom **Polaris** (ADR-0011 D2).

- **Gate d'entrée :** noyau de sécurité verrouillé (identité des agents — flotte/mission/capacités/révocation — spécifiée et lockée ; registre immuable ; mutations de couche 3 sous revue) **et** Specification Lock orchestrateur prononcé. **En run autonome (ADR-0011 D3, durci) :** ARRÊT DUR — un agent verrouille K1-K5, lance sa revue indépendante, produit le dossier, puis s'arrête ; le prononcé du lock est un acte propriétaire nominatif exclusif, jamais automatisé.
- **Livrables :** `orchestrator`, `harness` sous leur lock ; `missions` (l'app humaine de la couche) ; boucles opérant la flotte sous gates avec métriques ; `memory` livré avec le lock.
- **Gate de sortie :** la constellation est gérée par la méthode en conditions réelles ; les métriques de couverture pilotent la loi de croissance ; traceur v2 — démonstration publique complète de la méthode sur son propre cas.

## Vague 4 — Couche 1 : les apps-preuves

**Objectif :** les produits visibles du grand public, construits par et avec la méthode — la preuve par l'exemple au sens plein. Scindée en pilote puis parallèle (ADR-0011 D1).

- **Vague 4a — Notebook (pilote).** Gate d'entrée : G2 clos + contrat Notebook Core v2 (Gate B déjà approuvée). Rôle : valider le pattern app de bout en bout (contrat → moteur → app → revue) une fois. Sortie : Notebook utilisable et vérifiable, publié avec son évidence.
- **Vague 4b — le reste en parallèle, orchestré par Polaris.** Gate d'entrée : pattern validé en 4a + Polaris opérationnel (vague 3). Radar, Boussole, Model Policy, Practices, Sessions, Spec Studio construits en parallèle sous l'orchestration de la couche 2 — cette phase parallèle est la démonstration du produit zéro. `model-policy` : re-audit secrets/PII puis passage en public avant activation. Les `WP-G3-*` s'exécutent ici ; `WP-G4-*`/`WP-G5-*` par produit au fil des activations.
- **Politique de gate sécurité en run autonome (ADR-0011 D4, confiance graduée) :** chaque composant sécurité-critique est relu par des agents adversariaux distincts de l'implémenteur (K4). **Premier merge sécurité-critique d'une couche = arrêt dur** (dossier produit, prononcé propriétaire, amorçage de la chaîne de confiance) ; **répétitions du même pattern = merge automatique** sur dossier de revue propre. L'indépendance de la revue est préservée dans les deux cas. Distinct de D3, dont l'arrêt dur est permanent (jamais auto).
- **Plafonds d'autonomie chiffrés (ADR-0011 D6) :** liveness — ≤ 3 cycles CI/revue par PR, 3 PR consécutives sans progrès mesurable par vague, anti-thrash 5 rééditions ; coût — > 400 k tokens par PR, plafonds par vague (Phase 0 300 k, G2 1,5 M, V1 1 M, V2 2 M, V4a 1 M ; total run α 6 M). Un dépassement = STOP + dossier, jamais de kill silencieux.

## Correspondance vagues ↔ phases et work-packages

| Vague | Phases `GOALS.md` mobilisées                           | Work-packages                                    |
| ----- | ------------------------------------------------------ | ------------------------------------------------ |
| 0     | transverse (gouvernance)                               | hors WP produit — actes de gouvernance sous ADRs |
| 1     | G2 (sortie) → G5 partielle (publication de packages)   | livrables de `WP-G2-C01`/`W01`/`I01` exposés     |
| 2     | G2 (`WP-G2-P01`, `K01`) → G5 partielle                 | `WP-G2-P01`, `WP-G2-K01`, puis productisation    |
| 3     | Specification Lock dédié + futur package orchestrateur | lock orchestrateur puis ses packages             |
| 4     | G3 (par app) + G4/G5 par produit                       | `WP-G3-*`, `WP-G4-*`, `WP-G5-*`                  |

La précédence de sécurité (couche 3 avant couche 2, noyau ADR-0009 §6 avant vague 3) est indérogeable ; l'ordre interne des apps de la vague 4 est propriétaire.
