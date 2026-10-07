# ADR-0004 — Gouvernance des licences et de la marque

> **Collision de numéro.** `docs/adr/0004-agent-orchestration-option-b-specification-lock.md`
> porte aussi le numéro ADR-0004 (les deux datés du 2026-07-17, tous deux
> `accepted`). Le contenu des deux ADR n'est pas remis en cause par cette
> note ; la résolution — renumérotation ou non — relève de la remise à plat
> de la numérotation en cours et n'est pas tranchée ici.

- **Statut :** accepted
- **Date :** 2026-07-17
- **Portée :** monorepo canonique, futurs repositories produits et projections générées (documentation, SDK, packs)
- **Décision propriétaire solo :** transition multi-licence, REUSE et DCO explicitement autorisés

## Contexte

Le monorepo canonique était publié globalement au choix sous MIT ou Apache-2.0,
tandis que sa propre licence exigeait des déclarations séparées pour la
documentation, les données, les médias et les imports. Aucun périmètre SPDX
n'était encore présent. Cette situation facilitait l'adoption mais ne protégeait
pas les améliorations des applications et moteurs exploités comme services et
ne rendait pas les droits lisibles fichier par fichier.

Les 18 dépôts historiques sont déjà figés par l'ADR-0001 et le manifeste G0. Le
propriétaire des dépôts Libre AI a confirmé son autorité sur le portefeuille et
a approuvé la présente transition. Les composants tiers restent exclus de cette
assertion et conservent leurs droits amont.

## Décision

1. Le code applicatif, les services, les control planes et les moteurs
   stratégiques first-party utilisent `EUPL-1.2`, avec le mécanisme de versions
   ultérieures prévu par son article 5.
2. Les SDK, contrats d'interopérabilité, types générés, templates, composants
   d'adoption et harnesses techniques utilisent `Apache-2.0`.
3. `MPL-2.0` n'est pas appliquée par catégorie. Son introduction exige un ADR
   démontrant un besoin concret d'intégration propriétaire et acceptant
   explicitement l'absence de réciprocité pour l'usage SaaS seul.
4. La documentation éditoriale et les enregistrements first-party utilisent
   `CC-BY-4.0`. Les spécifications et politiques exécutables conservent une
   licence logicielle.
5. Les données réelles n'ont aucune licence par défaut. Chaque dataset exige un
   audit de provenance, de droits et de protection des données avant publication.
6. Les marques et futurs assets de marque restent hors licences open source et
   suivent une politique nominative séparée.
7. REUSE et SPDX sont l'autorité machine-readable. Une gate `reuse lint` est
   obligatoire en intégration continue.
8. Les contributions exigent un sign-off DCO 1.1. Aucun CLA de relicence
   propriétaire n'est introduit.
9. Les versions déjà publiées sous `MIT OR Apache-2.0` restent utilisables sous
   ces termes. Aucun droit déjà accordé n'est retiré.
10. Les dépôts historiques restent inchangés et en lecture seule ; seule la
    cible canonique reçoit cette nouvelle politique.

## Conséquences

- un opérateur réseau doit fournir le source couvert conformément à l'EUPL ;
- l'EUPL n'interdit ni l'hébergement commercial conforme ni la concurrence ;
- les frontières Apache restent largement intégrables ;
- le passage futur d'une contribution externe vers une licence incompatible ou
  propriétaire nécessiterait l'accord des titulaires concernés ;
- chaque nouveau type d'artefact doit être cartographié avant publication ;
- les distributions doivent conserver les notices tierces et les obligations
  de leurs dépendances indépendamment de la licence first-party.

## Enregistrement d’application

La PR #93 a exposé un défaut d’enforcement : son job PR-only `Licensing and contribution governance`
a correctement refusé 27 commits sans trailer DCO, mais `main` n’exigeait alors que les contextes Bun
et Rust et la PR a été fusionnée. Le contributeur/propriétaire a publié une
[attestation DCO 1.1 rétroactive liée aux 27 SHAs](https://github.com/libre-ai/libre-ai/pull/93#issuecomment-5009777987),
sans réécrire l’historique ni requalifier le run rouge. Le contexte gouvernance est désormais un
required check strict de `main` avec Bun et Rust ; aucune nouvelle fusion ne peut contourner ce gate.

## Garde-fous

- priorité aux notices fichier et aux annotations tierces sur les valeurs par
  défaut de répertoire ;
- aucune donnée ou sortie de modèle publiée sans `DATA-PROVENANCE.md` complet ;
- aucune marque utilisée pour faire croire qu'un fork est officiel ;
- aucun dépôt historique modifié pour simuler une relicence rétroactive ;
- revue juridique dédiée avant certification commerciale, enregistrement de
  marque ou introduction d'un CLA.
