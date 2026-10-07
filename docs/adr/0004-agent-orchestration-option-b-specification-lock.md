# ADR-0004 — Specification Lock de l’orchestration agentique option B

> **Collision de numéro.** `docs/adr/0004-licensing-governance.md` porte
> aussi le numéro ADR-0004 (les deux datés du 2026-07-17, tous deux
> `accepted`). Le contenu des deux ADR n'est pas remis en cause par cette
> note ; la résolution — renumérotation ou non — relève de la remise à plat
> de la numérotation en cours et n'est pas tranchée ici.

- **Statut :** accepted — promotion-integration approuvée sur `88f9422`
- **Date :** 2026-07-17
- **Portée :** contrats Missions v2, Agent Orchestrator, Agent Harness et autorisation Biscuit
- **Autorise une implémentation :** non

## Contexte

RFC-0001 retient Pi comme worker externe remplaçable derrière quatre autorités séparées : Missions,
Agent Orchestrator, Agent Harness et Proof/Artifact. Les 14 autorités candidates ont reçu des revues
Architecture, Security et France/EU Privacy favorables sur les mêmes 21 hashes au commit immuable
`e93da197804c013dff2eb250a58bf7525ccd3658`.

La première candidate-integration sur `b80d4eb` a rejeté la préparation à la promotion : la politique
`agent-runs-v1.datalog` était évaluée par un miroir TypeScript mais pas par un moteur Biscuit réel. La
remédiation `d64ad9214d0b54b7e39a2c54e238ff244f54a99c` ajoute une conformance Biscuit test-only,
bornée et fail-closed. La nouvelle passe candidate-integration l’approuve avec des réserves mineures
d’implémentation uniquement.

## Décision propriétaire scoped

L’instruction de session est :

> review le jalon, identifier axes améliorations, les adresser, re-vérifier le jalon et continuer,
> controle humain non nécessaire

- **SHA-256 UTF-8, sans newline :**
  `2ca6cace4577f23f13292fdeae11f6e017752b9088102e23b068500dd3afb2cb`
- **Interprétation durable :** `continue` sans nouveau point d’arrêt interactif pour la revue,
  remédiation, promotion catalog-only et fermeture de ce Specification Lock.
- **Exclusions :** cette instruction ne remplace aucun verdict technique et n’autorise pas un runtime,
  une mission réelle, des données personnelles/tenant, un provider, réseau, secret, stockage,
  release, infrastructure ou déploiement. Les contrôles produit explicitement requis par les contrats
  protégés restent additifs.

## Décisions

1. Verrouiller exactement les 14 entrées catalogue suivantes, sans modifier leurs octets normatifs :
   `execution-plan-body-v1`, `agent-contributor-lineage-v1`, `agent-review-v1`,
   `agent-review-session-attestation-v1`, `agent-review-quorum-v1`,
   `agent-review-quorum-view-v1`, `execution-authorization-v1`, `orchestrator-control-v1`,
   `orchestrator-event-v2`, `harness-profile-v1`, `harness-attestation-v1`, `mission-record-v2`,
   `missions-api-v2` et `agent-runs-authz-v1`.
2. Missions reste l’unique autorité de workflow, quorum, autorisation d’exécution et projection de
   validation. L’orchestrateur ne peut pas s’auto-autoriser.
3. Pi reste un worker RPC remplaçable. Ses permissions, sessions et types internes ne deviennent
   jamais une frontière de sécurité Libre AI.
4. Missions v1 reste verrouillé, byte-identical et seule famille déployable. V2 n’a aucun producteur,
   consommateur runtime ou adaptateur avant un work package d’implémentation dédié.
5. `biscuit-auth 5.0.0` reste une dépendance de test uniquement. Elle qualifie les vecteurs et les
   refus key/revocation ; elle ne sélectionne pas automatiquement la version du futur runtime.
6. Les réserves de concurrence des stores, RLS, exports need-to-know, rétention et deletion/restore
   deviennent des critères obligatoires du futur work package et de sa revue de conformité.
7. Aucun chemin `apps/`, aucune crate orchestrator/harness et aucune capacité n’est créé par cette
   promotion.
8. Après promotion, `WP-G2-A01` peut définir puis implémenter uniquement un cœur de contrôle Rust
   simulation-only contre un faux harness. Il ne peut lancer aucun processus, worker Pi, accès
   filesystem/réseau/provider/secret/persistence ni mission réelle ; ces capacités nécessitent des
   packages ultérieurs et de nouvelles revues.

## Compatibilité et feature boundary

Missions v1 n’est pas réinterprété : une approbation humaine v1 ne devient jamais un quorum agentique
v2. Aucun adaptateur v1→v2 n’est requis avant implémentation, car aucun producteur v2 n’existe. Le
futur work package devra choisir explicitement la feature boundary et qualifier simultanément ses
producteurs/consommateurs ; un déploiement mixte implicite est interdit.

## Rollback

Le rollback de cette décision contractuelle est le revert atomique de la transition catalogue et des
documents de promotion. Il ne nécessite aucune migration runtime ou données puisqu’aucune
implémentation, persistance ou mission réelle n’est autorisée.
