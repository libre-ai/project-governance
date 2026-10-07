# Paquet de preuve — candidat de marque ouverte et vérifiable

Date : 2026-09-09

Statut : **candidat local vert ; adoption et signe figuratif bloqués par décisions explicites**.

## Copie canonique

> Les plateformes propriétaires vous louent le produit.
>
> **Possédez la fabrique.**
>
> Libre AI réunit les logiciels, la méthode et les preuves pour construire des outils d'IA que vous
> pouvez vérifier, modifier et déployer où vous le décidez.
>
> Ouverts, souverains et explicables. Conçus dans une fabrique ouverte où la preuve fait partie du
> produit.

« Ouvert » ne signifie pas que l'infrastructure, les modèles, l'énergie, le stockage ou les opérations
sont gratuits. Libre AI promet des logiciels, méthodes et preuves inspectables sous leurs licences
déclarées ; pas l'absence de coûts ni une supériorité absolue sur tous les concurrents.

## Identité des candidats

| Champ | Valeur |
| --- | --- |
| `governance_sha` | `e98e85c529f734c895e543108c08186472328259` |
| `ui_sha` | `992b230664a36985feba9a9252eff480de11488b` |
| `website_sha` | `4e55c1cbcc37e9b204d30c933ce626b6b5042b45` |
| `dot_github_sha` | `ed57094964d53ce585818e2347c1ef303a61f512` |

## `gate_results`

- Governance `bun run check` : PASS — 935 tests, 0 échec, 1 651 assertions ; 8 contrôles de marque.
- UI `bun run check` : PASS — 33 tests, 0 échec, 12 507 assertions.
- UI `bun run test:e2e` : PASS — 30 réussis, 6 ignorés intentionnellement.
- Website `bun run check` : PASS — 23 tests, 0 échec, 89 assertions.
- Website `bun run test:e2e:brand-local` : PASS — 25 réussis, 5 ignorés intentionnellement.
- UI `bun run check:brand-publication` : BLOCKED attendu — licence et similarité non acceptées.
- `.github` : introductions FR/EN égales octet pour octet au rendu Governance ; 39 et 37 liens
  structurés valides respectivement, dont 38 et 36 URL HTTPS plus le lien relatif de traduction.

## `browser_matrix`

| Profil | UI | Website | Contrôles |
| --- | --- | --- | --- |
| Chromium | PASS | PASS | contenu, réseau, clavier, reflow, rendu |
| Firefox | PASS | PASS | contenu, réseau, clavier, reflow |
| WebKit | PASS | PASS | contenu, réseau, clavier, reflow |
| Chromium sans JavaScript | PASS | PASS | parcours statique complet |
| Chromium mouvement réduit | PASS | PASS | absence de dépendance au mouvement |
| Chromium couleurs forcées | PASS | PASS | structure et contrastes système |

## `asset_sha256`

| Artefact | Octets | SHA-256 |
| --- | ---: | --- |
| `src/assets/libre-ai-mark.svg` | 235 | `84cddb947b68770d950c34bddaf33182406de7a4021f22c50cdec34d2898cdbe` |
| licence de marque exacte | 1 064 | `fbc1a4aaae76d2da0c335149e4166fd6a9d1b253cd796944fc5eee7f7ff47ab6` |
| référence UI | 7 887 | `a673fb5cc2c80e080d4fac06109909ca54adbaaa31c3fbc1c13be6ba5e6a1242` |
| tokens UI | 73 890 | `f217c338ccb4d243aa9684e7c38e079894582be96e90e9aded7b6c2b3df9a211` |
| preview Website complet | 119 927 | cinq fichiers locaux ; détail ci-dessous |
| preview Website `assets/styles.css` | 10 687 | `06f095f34e8bd884c6cad8e6cf6727d7bf2e75bfccaab0dd0762110724a49f31` |
| preview Website `index.html` | 29 124 | `39c2a8da4500ba934eb7d9c2782297448fc5e26c3ace5f39d8f59e91b31217d2` |
| preview Website `comparaisons.html` | 3 931 | `2b6a2ae0036df972b640e6a155c0b39e0e0e3ff3349824858d731591d47cac08` |
| preview Website `marque.html` | 2 295 | `a4259f5fd13a057e5032ebba5b000b2f85e4e8da880b1e7628da01f31a331bef` |

## `license_decision`

`pending`. Le texte `Libre AI Brand Assets License 1.0`, identifié par le SHA ci-dessus, existe mais
n'a pas reçu `License approval: owner-accepted`. Le signe n'est donc pas distribuable.

## `similarity_review_scope`

Classes de Nice 9 et 42 ; termes `Libre AI`, `LibreAI`, `swift software`, `bird artificial
intelligence` ; concepts oiseau, martinet, trois pièces géométriques, ailes opposées et queue centrale.
Registres : EUIPO, INPI et WIPO. Références nommées : Trail, Proton, Mullvad, Mozilla, Oxide, LaSuite,
Mistral, Element, GitLab et Nextcloud. Les requêtes figuratives interactives et leur revue humaine
restent à exécuter ; aucune absence de conflit n'est affirmée.

## `known_limits`

- Aucun push, PR, merge ou déploiement n'a été réalisé.
- Les dépendances candidates Governance et UI ne sont pas encore résolubles depuis des SHA publics ;
  le Website de production n'a pas été repointé vers des références inaccessibles.
- La page publique actuelle n'est pas modifiée tant que l'adoption propriétaire n'est pas fusionnée.
- Le signe figuratif est volontairement absent du candidat Website public.
- Les trois recherches officielles et la comparaison visuelle humaine restent pendantes.
- Les trois avertissements offline de recoverability de Governance restent informatifs : le CI réseau
  est l'autorité de résolution de ces ancres préexistantes.

## `rollback_artifact`

| Dépôt | Base de rollback |
| --- | --- |
| Governance | `9e39b56889bc4620247f161ea8e854ddbaff09ca` |
| UI | `594a5dd8cbb791394714ee1eb46dec4dd629904d` |
| Website | `ca41cfe952b2d3f60c1aa4956574902558d4b29b` |
| `.github` | `2700b15860a9385657c944b3b8f28fcb5849af54` |

Ces bases sont les `origin/main` observés au moment de l'intégration locale. Le rollback consiste à ne
pas promouvoir les branches candidates ; aucune opération destructive n'est requise.
