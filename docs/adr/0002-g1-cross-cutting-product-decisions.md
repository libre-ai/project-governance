# ADR-0002 — Décisions produit transverses G1

- **Statut :** accepted
- **Date :** 2026-07-16
- **Portée :** neuf applications et contrats transverses
- **Approbation humaine :** Q1 à Q5 acceptées avec les recommandations

## Contexte

Le Specification Lock nécessite cinq arbitrages humains avant de figer les contrats : modèle de tenant, frontière du fournisseur d'identité, rétention, synchronisation Notebook et autorité de publication Boussole. Ces décisions ne modifient pas l'architecture Big Bang de l'ADR-0001.

## Décision

### 1. Modèle de tenant

- Website et données publiques Boussole sont publiques sans tenant utilisateur ; leurs opérations internes de publication utilisent le tenant de service `public`.
- Practices, Radar, Notebook et réponses Boussole relèvent d'un espace personnel.
- Sessions, Model Policy, Specifications et Missions relèvent d'un tenant organisation.
- Tout espace personnel autorisé côté serveur utilise un identifiant de tenant opaque obligatoire ; l'absence de tenant n'est jamais un cas personnel implicite.
- Les APIs produit n'exposent aucune agrégation inter-tenant.
- Notebook et réponses Boussole restent locales en v1 et n'ont donc pas de tenant serveur.

### 2. Frontière d'identité

Les applications serveur utilisent un adaptateur OIDC neutre, Authorization Code avec PKCE et mapping serveur du subject vers un identifiant utilisateur opaque. Le développement local utilise un issuer de test déterministe en processus. Aucun fournisseur n'est sélectionné ou provisionné pendant G1 ; le choix souverain de production intervient en G4 sans modifier le contrat de session.

### 3. Rétention et suppression

| Donnée | Rétention acceptée |
| --- | --- |
| sessions navigateur et révocations | expiration de session + 24 h ; session maximale 12 h |
| progression locale Practices | jusqu'à suppression ou réinitialisation après export |
| corps récupérés par Radar | suppression après normalisation ; quarantaine d'échec 7 jours |
| éléments et décisions Radar normalisés | 90 jours ; configurable par tenant de 7 à 365 jours |
| Notebook | local jusqu'à suppression ; aucune copie serveur en v1 |
| présence participant Sessions | 24 h |
| contenus et résultats Sessions | 90 jours ; configurable par tenant de 7 à 365 jours |
| snapshots Model Policy acceptés | immuables tant que référencés, puis 5 ans |
| SpecPackages acceptés | immuables tant que référencés, puis 5 ans |
| événements Missions et références de preuve | 1 an ; configurable par tenant jusqu'à 6 ans |
| logs opérationnels | 30 jours ; aucun contenu ou PII |
| manifestes Proof/Artifact | immuables tant que la release ou décision associée est conservée |

La projection exécutable de ce tableau est `contracts/data/retention.v1.json` ; toute divergence bloque G1/release.

Une demande de suppression s'exécute immédiatement dans les stores actifs. Les sauvegardes chiffrées expirent sous 35 jours et ne sont pas restaurées sélectivement. Une obligation légale contradictoire bloque la suppression concernée avec motif et échéance auditables ; elle ne justifie aucune extension silencieuse.

### 4. Synchronisation Notebook

Notebook v1 est local-only. Il fournit export/import chiffré et restauration déterministe dans un nouvel espace local avec rapport explicite de conflits. G2 n'inclut ni synchronisation cloud en arrière-plan, ni stockage serveur des notes, ni merge multi-device. Une évolution exige une nouvelle décision et un threat model.

### 5. Autorité Boussole

Le code et les datasets publics peuvent être construits en G2/G3, mais le scoring public reste désactivé jusqu'à deux approbations indépendantes et nommées : revue méthodologique et revue juridique/vie privée France/UE. La gate conserve les références d'approbation et les hashes dataset/méthode. Elle ne conserve aucune donnée personnelle des reviewers au-delà d'une attribution professionnelle publique explicitement consentie.

## Conséquences

- les contrats OpenAPI imposent un tenant pour toute donnée serveur non publique ;
- les politiques Biscuit refusent un tenant manquant ou divergent ;
- les migrations et tâches de purge doivent prouver les rétentions ci-dessus ;
- le fournisseur OIDC et Clever Cloud restent hors de G1 ;
- aucun endpoint Notebook ou Boussole n'accepte les contenus personnels locaux en v1 ;
- la release Boussole doit être techniquement fail-closed en l'absence des deux approbations.

## Garde-fous de changement

Modifier l'une de ces décisions exige un nouvel ADR, une analyse sécurité/RGPD, les migrations associées et une approbation humaine explicite.
