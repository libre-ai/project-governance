# Re-audit secrets/PII — `libre-ai/policy`

- **Date :** 2026-07-28
- **Objet :** condition de publication posée par ADR-0009 §8 (« model-policy rendu public après re-audit secrets/PII ») et confirmée par §9
- **Périmètre :** dépôt `libre-ai/policy`, tout l'historique et toutes les références
- **Résultat :** **propre** — aucun secret, aucune donnée personnelle de tiers

## Contexte, énoncé sans arrangement

`ecosystem/repositories.v1.yaml` déclarait `libre-ai/policy` en `visibility: private`
avec `target_visibility: public-after-secrets-audit`. Le 2026-07-28, le check requis
`Index freshness and GitHub reconciliation` a signalé la divergence :

```
DRIFT: repository 'policy' declared private but observable as public
```

Le même check passait sur `main` à 10 h 09 le jour même : la bascule de visibilité a eu
lieu dans la fenêtre qui a suivi. **Le dépôt est donc devenu public avant son re-audit**,
et non après. Ce document est l'audit conduit après coup, à la demande du propriétaire,
pour établir si l'état publié est acceptable ou s'il exige une remédiation.

Conséquence de l'ordre inversé, à garder en tête : si un secret avait été trouvé, il
aurait été **déjà exposé**. La réponse aurait été la rotation du secret concerné, pas sa
suppression du dépôt — un secret publié est un secret compromis.

## Surface auditée

| Mesure                                    |  Valeur |
| ----------------------------------------- | ------: |
| Commits (toutes références)               |      44 |
| Branches distantes                        |      10 |
| Références de pull request récupérées     |      13 |
| Objets git totaux                         |     430 |
| **Versions de blobs distinctes**          | **185** |
| Fichiers suivis au HEAD                   |      90 |
| Chemins ayant existé dans l'historique    |      90 |
| Fichiers supprimés au fil de l'historique |   **0** |

Deux propriétés simplifient l'audit et sont vérifiées, pas supposées :

- **l'historique est purement additif** — 90 chemins ajoutés, aucune suppression : aucun
  fichier n'a été retiré pour masquer son contenu ;
- **les références de pull request n'ajoutent rien** — après `git fetch` des 13
  `refs/pull/*/head`, le nombre de versions de blobs reste à 185. Toute la surface est
  couverte par les seules branches. Cette étape est explicite parce qu'un clone standard
  ne récupère pas ces références, et qu'elles portent bel et bien du contenu.

## Méthode et résultats

### 1. HEAD, garde-fous du socle appliqués au dépôt audité

| Garde-fou                                       | Résultat                                                  |
| ----------------------------------------------- | --------------------------------------------------------- |
| `tools/quality/check-secret-scan.ts`            | `Secret scan clean (WP-G2-Q01 acceptance 2) verified`     |
| `tools/quality/check-personal-data-boundary.ts` | `Personal-data boundary verified across 90 tracked files` |

### 2. Historique complet — motifs de secrets à haut signal

Les **185** versions de blobs ont été extraites et scannées une à une contre :
clés privées (`BEGIN … PRIVATE KEY`, `BEGIN OPENSSH`), jetons GitHub (`ghp_`, `gho_`,
`github_pat_`), jetons Slack (`xox[baprs]-`), clés AWS (`AKIA…`), clés de style OpenAI
(`sk-…`), clés Google (`AIza…`), en-têtes `Bearer …`, URI de connexion PostgreSQL
porteuses d'identifiants, et `ADDON_URI` (forme Clever Cloud).

**0 occurrence sur 185 blobs.**

### 3. Historique complet — données personnelles et identifiants privés

Les mêmes 185 versions ont été scannées pour : l'identifiant privé interdit par le gate
`context-hygiene`, les chemins machine-locaux (`/Users/<user>`), et toute adresse
e-mail présente dans le contenu.

**0 occurrence sur 185 blobs.**

### 4. Identités git

L'historique ne porte que les identités du propriétaire :

| Identité                                           | Commits |
| -------------------------------------------------- | ------: |
| `Constantin Jais <cjais@pm.me>`                    |      27 |
| `Constantin <…@users.noreply.github.com>`          |      16 |
| `Constantin Jais <…@protonmail.com>` |       1 |

Plus `GitHub <noreply@github.com>` comme committer de merges. Aucune identité de tiers.
Ces adresses sont inhérentes au sign-off DCO que la gouvernance du dépôt **exige** sur
chaque commit ; elles ne constituent pas une fuite mais un choix d'attribution, déjà
public dans tous les dépôts de l'organisation.

### 5. Données produit

| Fichier                              | Nature                                                                                            | Personne physique ?     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------- |
| `content/governance/providers.yaml`  | 39 fournisseurs de modèles — Anthropic, OpenAI, Google (Alphabet), Meta, Microsoft, Amazon (AWS)… | non — personnes morales |
| `apps/web/assets/demo-snapshot.json` | 2 418 octets, `manifest` + `entries`                                                              | non                     |

Aucun marqueur de champ à caractère personnel (nom, prénom, naissance, adresse,
téléphone, IBAN, identifiant national) dans `content/` ni dans les données embarquées.

## Limites de cet audit

- La détection est **par motifs**, pas par entropie : un secret de forme inhabituelle et
  sans marqueur connu ne serait pas vu. Les motifs couvrent les familles de jetons
  effectivement susceptibles d'apparaître dans ce dépôt.
- L'audit porte sur le **contenu git**. Il ne couvre pas les secrets d'exécution
  configurés côté GitHub (Actions secrets, variables d'environnement du déployeur), qui
  ne vivent pas dans l'arbre et relèvent d'une vérification propriétaire distincte.
- Il ne se prononce pas sur l'exactitude des données produit, seulement sur leur
  caractère non personnel.

## Disposition

La condition d'ADR-0009 §8 est **satisfaite** : le contenu publié ne porte ni secret ni
donnée personnelle de tiers. `libre-ai/policy` rejoint la visibilité `public` de ses
dépôts frères gelés (`feed-radar`, `notebook`, `ai-practices`, `sessions`,
`boussole-politique`), dont il était la seule exception.

`ecosystem/repositories.v1.yaml` est mis à jour pour refléter l'état observable et
pointer vers cette preuve. Aucun nouvel ADR n'est requis : ADR-0009 §9 autorisait déjà
la publication sous condition du re-audit ; l'inventaire rattrape une décision existante
dont la condition est désormais établie.

Reste à la main du propriétaire, hors périmètre de ce document : vérifier qu'aucun
secret d'exécution n'était attaché au dépôt au moment de sa bascule en public.

> Note d'intégration (session γ, 2026-07-28, ajout post-revue K4) : les scans des §1–§2
> ont couru avec le détecteur de credentials tel que corrigé par #269 (`6007444`,
> `hasUriUserinfoCredential` câblé dans `containsCredentialMarker`), qui ferme le trou
> URI-userinfo relevé par la revue K4 de #261 sur le détecteur de `cd51e64`.
