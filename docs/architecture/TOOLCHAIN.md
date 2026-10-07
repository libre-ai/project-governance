# Toolchain observée et politique de version

Extrait de vision.md (vague 0). Les versions effectivement qualifiées par la CI priment sur les observations datées ci-dessous.

## 15. Toolchain observée et politique de version

### 15.1 Checkpoint au 2026-07-16

Vérifications réalisées avant cette décision :

- dernière release GitHub stable Bun : `1.3.14`, publiée le 2026-05-13 ;
- cette ligne stable précède la bascule Rust visée ;
- Bun local observé : `1.3.11+af24e281e` ;
- asset canary officiel macOS ARM64 vérifié par SHA-256 ;
- le binaire canary observé rapporte
  `1.4.0-canary.1+57f349f63` ;
- checksum macOS ARM64 observé :
  `4d4bdb8e3ca1b41dede0ce423871b3804424bd785c6435e43c625a60a49f2f02` ;
- checksum Linux x64 observé :
  `83144e2542c33aaae541cf16b42f8cf1c55c3b94c5395fc776417fa27e95bcbf` ;
- React documenté via la ligne `19.2.7` ;
- Clever Cloud documente un support Bun natif déclenché par `bun.lock` ou
  `CC_NODE_BUILD_TOOL=bun`, mais sélectionne la dernière version disponible au
  lieu de garantir un pin exact.

Sources documentaires consultées : `/oven-sh/bun`,
`/react/react/v19.2.7`, `/clevercloud/documentation`, `/biomejs/biome`,
`/websites/react-aria_adobe`, `/ajv-validator/ajv`, documentation et release API
officielles Bun, registry npm et binaire officiel vérifié localement.

Le commit source complet du canary observé est :
`57f349f6307cf89dcfb8893f003c1ef421a74589`.

Versions de préparation observées et à épingler dans le premier lockfile après
qualification :

| Dépendance            | Version observée                                                            | Licence           |
| --------------------- | --------------------------------------------------------------------------- | ----------------- |
| React / React DOM     | `19.2.7`                                                                    | MIT               |
| React Aria Components | `1.19.0`                                                                    | Apache-2.0        |
| Tailwind CSS          | `4.3.2`                                                                     | MIT               |
| TypeScript            | `7.0.2`                                                                     | Apache-2.0        |
| Biome                 | `2.5.3` — dernière version admise par la fenêtre de sécurité de trois jours | MIT OR Apache-2.0 |
| Ajv                   | `8.20.0`                                                                    | MIT               |
| ajv-formats           | `3.0.1`                                                                     | MIT               |
| Playwright Test       | `1.61.1`                                                                    | Apache-2.0        |

Décisions d’outillage :

- Biome est l’unique formatter/linter TypeScript, TSX, JSON et CSS ;
- `biome ci` vérifie sans appliquer de fixes en CI ;
- Ajv en mode strict compile une fois les JSON Schemas canoniques ;
- les détails d’erreur Ajv sont convertis en erreurs publiques bornées et ne
  sont jamais journalisés avec leur donnée brute ;
- React Aria Components fournit les primitives accessibles ; React 19 n’exige
  pas `SSRProvider`, car `useId` assure les identifiants SSR/hydratation ;
- TypeScript reste l’autorité du type-checking, indépendamment du transpileur
  Bun.

### 15.2 Version Bun cible

La cible est la première ligne stable Bun écrite en Rust, normalement `1.4.x`
ou ultérieure.

Tant qu’elle n’existe pas :

- le template peut qualifier un canary exact ;
- version, révision et checksums sont enregistrés ;
- aucune URL `canary` mouvante n’est une source reproductible suffisante ;
- le binaire doit être conservé légalement ou reconstruit depuis un commit exact ;
- le statut pré-release est public ;
- aucun déploiement ne bascule silencieusement sur Bun stable `1.3.x`.

Le cutover production d’un produit requiert soit :

1. une release stable Rust épinglée ;
2. soit un canary qualifié, reproductible, archivé et explicitement accepté.

### 15.3 Clever Cloud

Clever Cloud reste la cible de déploiement applicatif Paris/UE, mais sa
configuration est volontairement différée. Aucun provisioning, secret,
environnement ou déploiement n’est attendu pendant le cleanup et la
Specification Lock. Cette absence est une décision de séquencement, pas un
blocage.

Le support natif « dernière version disponible » ne suffit pas à la
reproductibilité cible.

Ordre de préférence :

1. runtime Bun natif lorsque Clever permet le pin exact requis ;
2. binaire officiel exact, vérifié par checksum, sans `curl | bash` ;
3. image OCI maîtrisée si le runtime natif est insuffisant ;
4. Docker uniquement en dernier recours.

`bun build --compile` n’est pas le défaut tant que la redistribution LGPL n’a
pas été revue.

---

