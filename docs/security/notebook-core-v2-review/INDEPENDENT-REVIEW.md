# Procès-verbal de revues séparées par rôle — Gates A/B

> **Statut : Gate A approuvée / Gate B REJECT.**

Gate A a validé la migration `candidate -> locked` des quatre autorités Notebook Core v2. La preuve
machine-checkable est complète et la Gate B reste requise avant exploitation utilisateur.

Le moteur expérimental de Notebook peut démarrer après cette promotion ; Gate B reste obligatoire avant
sauvegarde utilisateur et release.

## Candidats immuables (Gate A)

- commit Git : `a28e116b0a3ebf278412650715e03f7050c0aac0`
- arbre Git : `cda41e7f9cc620a87ee0488caa06141614fb5b93`
- cible : `contracts/catalog.v1.json` + dossier `docs/reviews/notebook-core-v2/gate-a/a28e116/`
- mode : `review-only`
- preuve owner-control (décision du propriétaire) :
  - `https://github.com/libre-ai/libre-ai/pull/41#issuecomment-4998576948`
- dépôt : `https://github.com/libre-ai/libre-ai`
- clé dérivée `d1c64b3e330a7ac9164db94b4f31eb6b2b1dc3d4864886ca5e873b34eda0f5ff`
- référence immuable du record agentique : ce fichier

### Dossier de cycle a28e116

| Élément | Détail |
| --- | --- |
| Index du cycle | `docs/reviews/notebook-core-v2/gate-a/a28e116/README.md` |
| Révision d'intégrité | `docs/reviews/notebook-core-v2/gate-a/a28e116/` (5 fichiers) |
| Référence SHA (résumé) | voir section ci-dessous |

### Passes Gate A (role-separated)

| Rôle | reviewPassId | Verdict | Report | URL |
| --- | --- | --- | --- | --- |
| architecture | `notebook-core-v2-a28e116-architecture` | `APPROVE` | `ARCHITECTURE.md` | `https://github.com/libre-ai/libre-ai/pull/41#issuecomment-4998564391` |
| sécurité | `notebook-core-v2-a28e116-security` | `APPROVE` | `SECURITY.md` | `https://github.com/libre-ai/libre-ai/pull/41#issuecomment-4998564393` |
| cryptographie | `notebook-core-v2-a28e116-cryptography` | `APPROVE` | `CRYPTOGRAPHY.md` | `https://github.com/libre-ai/libre-ai/pull/41#issuecomment-4998564385` |
| vie privée France/UE | `notebook-core-v2-a28e116-privacy` | `APPROVE` | `PRIVACY.md` | `https://github.com/libre-ai/libre-ai/pull/41#issuecomment-4998564380` |

### Références hash — six autorités (source canonique)

| Élément canonique | SHA-256 |
| --- | --- |
| `contracts/wit/notebook-core-v2/world.wit` | `132d4cec0116352c8cea2c356b6dd6638758e07c7e182dc01042ea5667daa295` |
| `contracts/wit/notebook-core-v2/SEMANTICS.md` | `5c17e87e9944f40d1e1e29a3a5bacd85bf9846c4386bc0adb053356dad39b45b` |
| `contracts/schemas/context-document.v2.schema.json` | `f205f1a246ce88221a21a16d69d66966ff33c989f915d2879df77e5f7f5f96d4` |
| `contracts/schemas/notebook-backup-seal-request.v2.schema.json` | `4beb3e8818f2036f38c44469432d31222191523d621779c8c5b28ab5be760e5a` |
| `contracts/schemas/notebook-backup.v2.schema.json` | `e2932bbb2cd2b7062be703aad327ad84e51badf0d4fa9b8ad59b00191e686ad0` |
| `contracts/fixtures/notebook-core-v2/golden-vectors.v1.json` | `734eeecefd5c4b70fa1b86f3c389259117087882d2e105ec14dfabae5062ee09` |

### Références hash — rapports Gate A

| Rôle | Rapport | SHA-256 |
| --- | --- | --- |
| architecture | `docs/reviews/notebook-core-v2/gate-a/a28e116/ARCHITECTURE.md` | `bea5bb969119014d24e797bd51b4f8ccdf832c2a58977bad871d7beb5989abfa` |
| sécurité | `docs/reviews/notebook-core-v2/gate-a/a28e116/SECURITY.md` | `87610b711d515f3ccbc39aac16217b86610ee4eae98b62d19821fcf03b881a69` |
| cryptographie | `docs/reviews/notebook-core-v2/gate-a/a28e116/CRYPTOGRAPHY.md` | `591a909f728d6085ba2b70465fc05ff0449993cbf9d6f95c6ce11161f68c9dea` |
| vie privée | `docs/reviews/notebook-core-v2/gate-a/a28e116/PRIVACY.md` | `d3e690fdd357e27c31b1afc21e6e591103b2b8733f436b359c9b58d053c7e995` |

### Passe d’intégration (non Gate A/B)

| Élément | Valeur |
| --- | --- |
| reviewPassId | `notebook-core-v2-a28e116-promotion-integration` |
| mode | `promotion-integration` |
| intégrateur | `openai-codex/gpt-5.3-codex-spark` |
| session | `f9f195bf-4492-4d64-bb98-b4c08b0a2084` |
| base | `7ad0695b563745d2c6223f4d2cdcafc9fd9e3d0a` |
| URL synthèse | `https://github.com/libre-ai/libre-ai/pull/41#issuecomment-4998566929` |

### Cadre de preuve et revue par rôle

- `SEMANTICS.md` comporte un entête historique mentionnant une phase `candidate` ; la source de vérité du statut reste le catalogue : `contracts/catalog.v1.json`.
- `contracts/catalog.v1.json` contient le passage `candidate -> locked` pour les 4 autorités Notebook.
- Chaque passe est distincte par rôle (`architecture`, `sécurité`, `cryptographie`, `vie privée France/UE`).
- Une seule preuve principale est conservée ici (immutable), le lot d’artefacts et le commit sont immuables.

L’agent reviewer a vérifié en mode review-only sur un worktree propre :

```bash
git rev-parse a28e116b0a3ebf278412650715e03f7050c0aac0
git rev-parse a28e116b0a3ebf278412650715e03f7050c0aac0^{tree}
git status --short
```

## Constats de sécurité transverses

- aucun constat blocking/major ouvert pour le périmètre Gate A.
- la reproduction indépendante de la cryptographie a été documentée dans le cycle.
- la conformité runtime, la sûreté host, l’absence de persistance et la non-régression restent hors périmètre de Gate A.

## Décision Gate B

- [ ] **APPROVED**
- [ ] **APPROVED WITH MINOR RESERVATIONS**
- [x] **REJECTED** — dernière passe Gate B sur `5190972`

Les six rapports attribuables sont indexés dans
[`docs/reviews/notebook-core-v2/gate-b/README.md`](../../reviews/notebook-core-v2/gate-b/README.md).
La dernière passe [`5190972`](../../reviews/notebook-core-v2/gate-b/5190972/) passe les budgets p95/RSS
des trois navigateurs sur la classe haute mémoire de référence, mais rejette Gate B faute de classes
contraintes, de host produit exact, d’OOM processus et de preuve d’effacement physique à ce commit.

Après ce verdict, la PR #95 a intégré le host exact sous feature gate fermé et la PR #97 a observé ses
crash/kill/restart et nettoyages sur trois navigateurs. Ces preuves candidate-integration n’ont pas encore
reçu de passe Gate B spécialisée et ne démontrent ni OOM réel du processus, ni quota physiquement
épuisé, ni effacement physique, ni classes 8 Gio/16–24 Gio. La Gate B demeure non approuvée ; aucune
sauvegarde utilisateur ou release n’est autorisée.
