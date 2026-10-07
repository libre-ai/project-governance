# Programme de transformation Big Bang

> **SUPERSÉDÉ par ADR-0020 (2026-07-28).** Le séquencement en sept vagues
> décrit ci-dessous ne s'exécute plus tel quel : l'activation est générale et
> la migration intégrale se fait en une vague (D1/D4), ADR-0009 §8 et le cadre
> de vagues d'ADR-0018 étant supersédés. L'ordre d'exécution du jalon γ vit
> désormais au design d'activation générale
> [`docs/superpowers/specs/2026-07-28-multi-repo-activation-design.md`](../superpowers/specs/2026-07-28-multi-repo-activation-design.md)
> §5.6. Le présent document reste **l'histoire** du programme Big Bang tel que
> défini à l'origine : il n'ordonne plus rien et n'est pas une autorité
> vivante.

## Définition

Le Big Bang supprime toute architecture de transition : freeze global de l’existant, reconstruction dans le monorepo, qualification globale, puis cutover unique.

Il n’autorise ni perte de données, ni intégration tardive. Les composants cibles sont intégrés en continu pendant la reconstruction.

## Vague 0 — Global Freeze

- préserver les modifications locales ;
- enregistrer SHA, licences, données, releases et contrats utiles ;
- produire `ecosystem/LEGACY-MANIFEST.yaml` ;
- archiver les repositories ;
- arrêter tout développement historique.

**Gate :** aucune perte utilisateur ou légale ; le monorepo est l’unique destination.

## Vague 1 — Specification Lock

- ADR et architecture ;
- noms et ownership ;
- modèle d’objets ;
- contrats ;
- modèles de données et auth ;
- plans des applications ;
- work packages et graphe.

**Gate :** aucune décision d’architecture critique laissée aux agents d’implémentation.

## Vague 2 — Foundation Build

- workspaces Bun/Cargo ;
- Knowledge Engine ;
- packages web ;
- crates spécialisées ;
- template ;
- CI, Proof, Artifact et Clever smoke.

**Gate :** chaîne de référence complète depuis une checkout vierge.

## Vague 3 — Parallel Reconstruction

- applications et capabilities construites en parallèle ;
- intégration fréquente ;
- aucune compatibilité historique ;
- tests des seuls invariants acceptés.

**Gate :** cible complète, compilable et sans ancienne stack.

## Vague 4 — Global Hardening

- sécurité, accessibilité, charge ;
- migrations de données ;
- observabilité ;
- backup/restore/rollback ;
- répétition du cutover.

**Gate :** release candidate globale reconstructible.

## Vague 5 — Single Cutover

- DNS, artefacts et déploiements ;
- publications générées et repositories produits selon décision propriétaire (ADR-0008) ;
- archivage définitif ;
- surveillance et rollback global.

## Vague 6 — Distribution

- registries européens ;
- miroirs publics ;
- SDK/MCP/knowledge packs ;
- documentation, formation et reproduction indépendante.
