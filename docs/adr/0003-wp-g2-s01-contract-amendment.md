# ADR-0003 — Réouverture bornée de WP-G2-S01

- **Statut :** accepted — amendement contractuel fermé ; quatre familles v2 verrouillées
- **Date :** 2026-07-16
- **Portée :** contrats spécialisés uniquement
- **Décision propriétaire solo :** recommandation v2 et réduction de S01 approuvées ; promotions contractuelles Radar, Notebook, Policy et Boussole autorisées après leurs revues respectives, sans autorisation moteur produit

## Contexte

Les WIT v1 Radar, Notebook, Policy et Boussole étaient syntaxiquement valides mais ne définissaient pas toutes leurs entrées/sorties JSON, formules, bornes, dérivations d’identifiants et préimages de hash. `crates/context` ne portait aucun invariant distinct ; `crates/agent-orchestrator` ne disposait ni d’un protocole de contrôle ni d’un harness contractuel.

## Décisions

1. Les v1 restent hors cible de WP-G2-S01. Radar, Notebook et Boussole v1 demeurent inchangés ; le Policy v1 verrouillé par la PR #16 est conservé comme baseline déjà fusionnée mais ne remplace pas la cible v2 approuvée pour S01. Aucune nouvelle réinterprétation v1 n’est admise.
2. Les quatre frontières ouvertes comme candidates utilisent des WIT v2 et des profils normatifs catalogués ; leurs entrées de catalogue sont désormais `locked`.
3. Radar reçoit une identité de source, une URL de base/finale et un budget de sortie ; ses IDs sont source-scoped.
4. Notebook v2 rend les métadonnées crypto explicites et authentifiées ; Gate A a reçu les quatre verdicts requis, tandis que Gate B reste distincte et bloquante avant toute sauvegarde utilisateur ou release.
5. Policy v2 introduit un besoin tenant-bound, des faits typés et la séparation humaine `approverId != proposedBy`.
6. Boussole v2 fixe une formule reproductible revue ; le scoring public et tout dataset réel restent désactivés sans approbations humaines fraîches liées aux hashes exacts de release.
7. `crates/context` et `crates/agent-orchestrator` sont retirés de WP-G2-S01. L’orchestrateur a ensuite suivi son propre RFC/Specification Lock et seul son control core de simulation a été autorisé ; aucun harness ou worker runtime n’entre dans S01.
8. Practices scoring reste explicitement non implémenté.
9. Aucun provisioning, secret, fournisseur, réseau ou stockage n’entre dans cet amendement.
10. Les sept autorités Radar v2 sont reverrouillées sans modifier leurs octets normatifs après les passes Architecture et Security favorables, une passe de promotion séparée et le jalon propriétaire. Cette décision n’autorise pas encore un moteur produit.

## Autorité et approbations

Les contrats v2 ont d’abord été catalogués comme `candidate`. Les verdicts requis ont été produits par des passes spécialisées en architecture, sécurité, cryptographie pour Notebook, méthodologie pour Boussole et vie privée France/UE pour Notebook/Policy/Boussole. En contexte solo, un même agent/session peut enchaîner une passe auteur puis des passes review-only séparées par rôle, sur un commit immuable et sans modifier les autorités revues, conformément à `docs/reviews/AGENT-REVIEW-PROTOCOL.md`. Des passes de promotion séparées ont vérifié les verdicts avant chaque jalon de contrôle humain. Radar, Notebook, Policy et Boussole v2 ont franchi ces étapes et leurs autorités sont `locked` ; ces promotions n’accordent aucune autorité d’implémentation, de données réelles ou de release.

## Refermeture contractuelle

Les passes `radar-architecture-rereview-bbe6c96` et `radar-security-rereview-bbe6c96` approuvent les mêmes autorités et hashes au commit immuable `bbe6c96651430f0a5dc0f6008e69487aead0cd41`. La passe `radar-v2-promotion-6c66e97` a vérifié leur absence de dérive sur `6c66e9762e7d45e394c9c4adbb00966bc02d8eb9`. Le propriétaire a ensuite ordonné `continue` pour la seule promotion contractuelle, décision durable référencée par `https://github.com/libre-ai/libre-ai/issues/20#issuecomment-4998658043`.

Ce premier jalon verrouille les sept entrées Radar du catalogue. Les promotions ultérieures ont verrouillé quatre entrées Notebook après Gate A sur `a28e116`, six entrées Policy après les verdicts sur `d47feb9` et cinq entrées Boussole après les verdicts sur `e83e142`. Le catalogue courant contient 85 autorités verrouillées, dont l’enveloppe de vecteurs moteur promue séparément.

Aucun de ces jalons n’autorise un moteur Rust/produit Radar, Policy ou Boussole, des données personnelles/tenant réelles, le scoring public, une capacité réseau/stockage/secret, une infrastructure ou un déploiement. Notebook reste expérimental derrière Gate B. Chaque étape produit exige encore son jalon explicite et ses preuves d’implémentation.

## Compatibilité

Radar et Notebook changent de signature WIT ; Policy et Boussole changent la signification et la famille de payloads. Tous utilisent donc un major v2. Aucun adaptateur v1→v2 n’est créé : aucun producteur canonique v1 n’a été publié. Les WIT v1, y compris le Policy v1 désormais verrouillé, restent des autorités de baseline hors cible d’implémentation S01.

## Condition de refermeture

Le Specification Lock contractuel S01 a été refermé après satisfaction des conditions suivantes :

- chaque candidat a reçu les verdicts favorables de ses agents reviewers requis ;
- schémas, OpenAPI, WIT, profils et vecteurs passent les gates ;
- les types générés sont reproductibles ;
- WP-G2-S01 conserve uniquement les quatre chemins de crates produit ;
- Practices scoring et Context restent non implémentés dans S01, et l’Orchestrator relève de son package séparé.

Cette fermeture fixe le sens des contrats. Elle ne ferme ni Notebook Gate B ni les futurs gates runtime et ne sélectionne aucun premier moteur Radar, Policy ou Boussole.
