<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: approve-with-minor-reservations

# Faux positif `exec-non-constant` de `project-website` `server/parity/normalize.ts` : revue

**Date :** 2026-11-24
**Objet :** l'entrée de `ecosystem/sql-construction-allowlist.v1.yaml` qui couvre `libre-ai/project-website` `server/parity/normalize.ts`, règle `exec-non-constant`, `count: 2` ; et, avant elle, quatre versions d'un correctif du scanner abandonnées.
**Nature :** dossier de revue d'une pull request écrite par un agent. Le gate « Index freshness and GitHub reconciliation » est rouge sur la branche servie depuis la fusion de project-website #25 (`914fde80`), et rend rouge chaque pull request de ce dépôt. Ce dossier rend compte des passes qui ont examiné la correction. Il ne vaut pas arbitrage du propriétaire. La fusion reste au propriétaire : ADR-0068 D2 exclut les données à la racine d'`ecosystem/`.
**Rôle :** cinq passes en lecture seule, chacune faite par un sous-agent à contexte neuf. Aucun sous-agent n'a écrit ce qu'il relit, et aucun n'a reçu les conclusions des passes précédentes.

## Le site

`server/parity/normalize.ts` au sha servi `914fde80fc3d861a6ee7ed9515c23814b6730a4a` :

```ts
const LINK = (path: string) => new RegExp(`/${path}\\?jeton=(${TOKEN.source})(?![A-Za-z0-9_-])`);  // :92
    confirm: LINK("confirmer").exec(raw)?.[1] ?? null,                                        // :104
    unsubscribe: LINK("desinscrire").exec(raw)?.[1] ?? null,                                  // :105
```

C'est `RegExp.prototype.exec`. Le scanner ne connaît que trois récepteurs regex de `.exec` : un littéral, un nom lié à une regex, et `new RegExp(…)`. L'appel d'une fonction qui renvoie une regex n'en fait pas partie.

## Passes 1 à 4 : apprendre au scanner l'appel d'une fabrique de regex (abandonné)

Chaque passe a comparé le scanner de la base `18e0a468` à celui de la branche, entrée par entrée. Les passes 3 et 4 ont aussi exécuté les sources qui échappaient contre une fausse base de données, et le `DROP TABLE` a atteint `.exec`. Les commits relus n'ont pas été publiés. Les entrées ci-dessous permettent de rejouer chaque échappement.

| Passe | Version relue | Verdict | Échappements trouvés : la base signale l'entrée, la branche non |
| --- | --- | --- | --- |
| 1 | fabrique = fonction fléchée dont le corps commence par une regex, ou dont le type de retour est `RegExp` | `request-changes` | `(u) => /^pg/.test(u) ? pg : lite` ; `(s) => /x/ && db` ; type de retour `RegExp \| Database` ; surcharges ; réaffectation ; redéclaration dans une autre portée |
| 2 | valeur et type stricts, retrait sur toute autre déclaration, séparation entre propriétés et noms nus | `request-changes` | `NAME: /re/` lu comme regex (`this.db.exec(sql)` à côté de `{ db: /^db:/ }`) ; paramètre non typé, `for … of`, `catch`, import, déstructuration et valeur par défaut qui ne retirent pas la fabrique |
| 3 | forme unique `const NAME = (…) => <regex>`, déclarée une seule fois, toute autre occurrence nue étant un appel | `request-changes` | `function NAME(` dans une portée interne, exécuté ; fabrique interne couvrant un appel global, exécuté ; `éNAME` et `f` (tokenizer ASCII) ; `RegExp` réimporté |
| 4 | fabrique seulement au niveau du module ; retrait par `function`, par un caractère non ASCII et par `RegExp` lié | `request-changes` | `(RegExp) => new RegExp(…)` ; redéclaration avalée après `x! / 2` ou `i++ / 2` (confusion regex/division du tokenizer) ; profondeur d'accolades décalée par `/[}]/` après `)` ; `globalThis["RegExp"] = …`. Six cas exécutés, six `DROP TABLE` arrivés jusqu'à `.exec` |

**Conclusion.** Le chemin « fabrique » repose sur des propriétés que le tokenizer ne garantit pas : la frontière entre regex et division, la profondeur d'accolades, les identifiants non ASCII. Chaque correctif a ouvert une nouvelle forme d'échappement. Sur ce gate de sécurité, un faux négatif coûte plus qu'un faux positif. Le scanner reste donc tel qu'il est sur la base, et le site est inscrit dans la liste d'autorisation, à son compte exact.

## Passe 5 : l'entrée de la liste d'autorisation

| Passe | Base de gouvernance | Sha servi de project-website | Verdict |
| --- | --- | --- | --- |
| 5 | `18e0a468527310590db2f49da15ba697250472a7` | `914fde80fc3d861a6ee7ed9515c23814b6730a4a` | `approve-with-minor-reservations` |

| Question | Mesure de la passe |
| --- | --- |
| Les deux sites sont-ils exactement 104 et 105, et sont-ils des `.exec` sur `LINK("<littéral>")` ? | Oui. `scanSource` sur le fichier récupéré donne `exec-non-constant` aux lignes 104 et 105. Les deux autres `.exec` du fichier (`:259`, `:272`) ont des récepteurs regex déjà reconnus. |
| `LINK` est-il une constante de module dont le corps n'est que `new RegExp(…)`, et `RegExp` est-il celui du langage ? | Oui. `LINK` n'apparaît qu'aux lignes 92, 104 et 105. Les seuls imports sont `node:zlib` et `../tokens` (qui importe `node:crypto`). |
| Le fichier atteint-il une base de données ? | Non. `RowTrace` est une donnée passée par l'appelant. « database driver » n'apparaît qu'en commentaire. |
| Le texte de `because` est-il exact ? | Oui, phrase par phrase. `raw` vient de `readOutbox` dans `server/parity.test.ts:174-178`, qui lit l'outbox écrite par le test. La recherche des appelants s'est faite par recherche de code et par lecture des fichiers de parité ; ce n'est pas un parcours exhaustif. |
| `count: 2` est-il juste, et un troisième site ferait-il échouer le gate ? | Oui, mesuré avec `parseAllowlist` et `judgeRepository`. Un troisième `client.exec(sql)`, un troisième `LINK("autre").exec(raw)` ou la ligne 105 retirée donnent `ok:false`. L'auteur a fait la même mesure sur le gate complet : avec `count: 1`, le gate échoue (« the allowlist reviewed 1 site(s), the file now has 2 »). |

## Constats

| Gravité | Disposition | Constat | Suite |
| --- | --- | --- | --- |
| medium | fixed | `because` citait ce dossier avant qu'il existe. | Le dossier est livré dans la même pull request. |
| medium | owner | #314 (`work/sql-scanner-regex-factory`, ouverte par une autre session) corrige le même rouge en apprenant au scanner l'appel d'une fabrique. Les deux pull requests s'excluent : si #314 fusionne avec cette entrée, l'entrée devient périmée. | L'auteur a rejoué sur le scanner de #314 (tête `65e1afc`) neuf des échappements ci-dessus. Les neuf passent : la base les signale, #314 non. Choix au propriétaire. |
| nit | none | `LINK` insère `path` dans la regex sans l'échapper. C'est sûr ici parce que les deux arguments sont des littéraux sans métacaractère. | Rien. |
| info | none | Le registre ne réexamine le site que si le compte change. Une modification de `normalize.ts` qui garde deux sites non constants laisse le gate vert. | Limite de la liste d'autorisation, inchangée. |

Aucun constat `blocking`.

## Non relu

- Les passes 1 à 4 ont relu des commits locaux, qui n'ont pas été publiés.
- Ce dossier lui-même n'a été relu par aucune passe.
