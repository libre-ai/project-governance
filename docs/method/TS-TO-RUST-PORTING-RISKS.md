# Risques de portage TypeScript → Rust — construction, traduction évidente, piège qui la révèle

Cette grille sert le test de parité d'ADR-0063 D5
(`docs/adr/0063-purist-stack-rust-everywhere-content-is-processed.md`, section « Test de parité
de D5 ») : avant qu'un composant TypeScript qui traite du contenu soit remplacé par un composant
Rust, son corpus de parité doit contenir les pièges des constructions qu'il emploie. Elle ne
décide rien : ADR-0063 est au statut proposé, et cette grille n'oblige qu'à travers lui.

Chaque risque donne trois choses :

- la **construction TypeScript** qui porte le comportement ;
- ce que fait la **traduction évidente** en Rust, celle qu'un relecteur laisse passer parce
  qu'elle compile et ressemble à l'original ;
- le **piège** : une entrée, avec la sortie de chaque côté, qui fait diverger les deux. Un piège
  entre tel quel dans le corpus du test de parité (point (a) de sa définition).

Les sorties citées ont été mesurées le 2026-11-23 avec une sonde jetable, non versionnée : côté
JavaScript sous Bun `1.4.4-canary.1`, côté Rust avec `rustc 1.97.0`, `regex` 1.12.3 et
`serde_json` 1.0.154 (fonction `preserve_order` active). Une version différente de l'un de ces
outils peut changer une sortie : le corpus d'un composant rejoue ses pièges, il ne recopie pas
ce tableau.

## 1. Positions dans les chaînes

JavaScript compte les chaînes en unités UTF-16, Rust en octets UTF-8.

| Construction TypeScript | Traduction évidente en Rust | Piège qui le révèle |
| --- | --- | --- |
| `s.length`, `s.indexOf(x)`, `s[i]`, `s.charCodeAt(i)` | `s.len()`, `s.find(x)`, indexation par octet | `"é"` : longueur 1 en JS, 2 en Rust ; `"😀"` : 2 en JS, 4 en Rust, 1 `char`. Une position calculée d'un côté et appliquée de l'autre décale toute plage qui suit un caractère non ASCII |
| `s.slice(a, b)`, `s.substring(a, b)` pour tronquer | `&s[a..b]` | `"😀".slice(0, 1)` rend un surrogate isolé (`\uD83D`) ; `&s[0..1]` panique (« not a char boundary »). Une troncature à N unités sur un texte dont un emoji commence en N-1 coupe l'emoji en JS et fait paniquer le port |
| chaîne qui porte un surrogate isolé (issue d'un `slice`, d'une entrée, de `JSON.parse('"\ud800"')`) | `String` | Un `String` Rust ne peut pas contenir de surrogate isolé : `String::from_utf16(&[0xD800])` échoue, `serde_json` refuse `"\ud800"` (« unexpected end of hex escape »), `from_utf16_lossy` le remplace par U+FFFD. JS l'accepte, et `JSON.stringify("\uD800")` rend `"\ud800"`. Le port doit choisir entre un type d'unités UTF-16 et un refus explicite, et le corpus porte `"\uD800"` et `"a\uDC00b"` en entrée |

## 2. Ordre de comparaison des chaînes

| Construction TypeScript | Traduction évidente en Rust | Piège qui le révèle |
| --- | --- | --- |
| `a < b`, comparateur `(a, b) => (a < b ? -1 : 1)` | `a < b` sur `&str`, `sort()` sur `Vec<String>` | `<` en JS compare des unités UTF-16, Rust compare des octets, soit l'ordre des points de code. Ils divergent entre un caractère hors du plan de base et un caractère de U+E000 à U+FFFF : `"😀" < "｡"` vaut `true` en JS, `false` en Rust |
| `arr.sort()` sans comparateur | `v.sort()` | Sans comparateur, JS convertit chaque élément en chaîne : `[10, 9, 1].sort()` rend `[1, 10, 9]`, Rust `[1, 9, 10]` |
| `a.localeCompare(b)`, `Intl.Collator` | `a.cmp(b)` | La bibliothèque standard Rust n'a pas de collation : `cmp` n'est pas `localeCompare`. Le corpus porte des accents, des majuscules et des ligatures (`"é"`, `"E"`, `"œ"`) |

## 3. Expressions régulières

| Construction TypeScript | Traduction évidente en Rust | Piège qui le révèle |
| --- | --- | --- |
| lookaround `(?=…)`, `(?!…)`, `(?<=…)`, `(?<!…)`, référence arrière `\1`, `\k<nom>`, drapeau `y` | `regex::Regex::new` | La crate `regex` ne les a pas : `Regex::new("a(?=b)")` et `Regex::new(r"(a)\1")` échouent. Si le motif vient de données, l'échec n'arrive qu'à l'exécution. `fancy-regex` les accepte en renonçant au temps linéaire pour ces motifs |
| `/s/i`, `/k/i` sans drapeau `u` ni `v` | `(?i)s`, `(?i)k` | `(?i)` de la crate replie selon Unicode : `(?i)s` reconnaît `ſ` (U+017F) et `(?i)k` le signe Kelvin (U+212A). JS sans `u`/`v` ne reconnaît ni l'un ni l'autre ; avec `u`, il les reconnaît. `(?i-u)s` rend le comportement JS sans `u` sur `ſ` |
| `\d`, `\w`, `\b` | les mêmes classes | En JS elles sont ASCII ; dans la crate, Unicode par défaut. `\d` reconnaît `٣` (U+0663) en Rust, pas en JS ; `\w` reconnaît `é` en Rust, pas en JS ; `\bcaf\b` trouve `caf` dans `"café"` en JS (frontière avant `é`), pas en Rust |
| `.` | `.` | En JS, `.` exclut `\n`, `\r`, U+2028 et U+2029 ; dans la crate, seulement `\n`. `^.$` reconnaît `"\r"` et `" "` en Rust, pas en JS |
| motif `/g` réutilisé : `re.test(s)` deux fois | `Regex::is_match` | Un motif `/g` garde `lastIndex` entre deux appels : `/a/g.test("a")` deux fois de suite rend `true` puis `false`. `is_match` n'a pas d'état |
| remplacement `s.replace(re, "$1a")` | `re.replace(s, "$1a")` | JS lit le groupe 1 suivi de `a` (`"xy"` → `"xay"`) ; la crate lit un groupe nommé `1a`, absent, et rend `"y"`. En Rust, `${1}a` |

## 4. Nombres

`number` est un flottant IEEE 754 double précision ; la traduction évidente choisit un entier
Rust ou garde `f64` sans en reprendre les conversions.

| Construction TypeScript | Traduction évidente en Rust | Piège qui le révèle |
| --- | --- | --- |
| entier au-delà de 2^53 | `i64` | `2 ** 53 + 1` vaut `9007199254740992` en JS, `9007199254740993` en `i64` |
| `-0`, `String(x)`, gabarit `` `${x}` `` | `format!("{}", x)` | `String(-0)` rend `"0"`, Rust `"-0"`. `String(1e21)` rend `"1e+21"`, Rust `"1000000000000000000000"`. `String(5e-324)` rend `"5e-324"`, Rust 326 caractères de notation décimale. `String(1e-7)` rend `"1e-7"`, Rust `"0.0000001"` |
| `Math.floor(a / b)` sur des entiers | `a / b` sur `i64` | Rust tronque vers zéro : `-7 / 2` vaut `-3`, `Math.floor(-7 / 2)` vaut `-4` |
| `a % b` | `a.rem_euclid(b)` | `%` garde le signe du dividende des deux côtés (`-7 % 2` vaut `-1`) ; `rem_euclid` rend `1` |
| division par zéro, `MIN / -1` | `/` sur `i64` | JS rend `Infinity` ou `NaN` ; Rust panique sur `5 / 0` et sur `i64::MIN / -1` |
| `x \| 0`, `x >>> 0`, `~~x` | les opérateurs binaires sur `i64` | JS tronque à 32 bits : `2 ** 31 \| 0` vaut `-2147483648`, `-1 >>> 0` vaut `4294967295` ; sur `i64`, `(1 << 31) \| 0` vaut `2147483648` |
| `parseInt("12px")`, `Number("")`, `Number("0x1F")` | `str::parse::<i64>()` | JS rend `12`, `0`, `31` ; `parse` échoue sur les trois |
| `Math.round(x)`, `x.toFixed(0)` | `f64::round`, `format!("{:.0}", x)` | `Math.round(-2.5)` vaut `-2`, `(-2.5).round()` vaut `-3` ; `(2.5).toFixed(0)` rend `"3"`, `format!("{:.0}", 2.5)` rend `"2"` |

## 5. JSON

| Construction TypeScript | Traduction évidente en Rust | Piège qui le révèle |
| --- | --- | --- |
| `JSON.stringify(objet)` | `serde_json::to_string` | Un objet JS range d'abord les clés de forme entière par ordre croissant, puis les autres dans l'ordre d'insertion : `{b:1, a:2, 2:3, 1:4}` s'écrit `{"1":4,"2":3,"b":1,"a":2}`. Sans `preserve_order`, `serde_json::Map` trie les clés ; avec, il garde l'ordre d'insertion (`{"b":1,"a":2,"2":3,"1":4}`) : aucun des deux ne rend l'ordre JS |
| `delete obj.k` | `serde_json::Map::remove` | Avec `preserve_order`, `remove` déplace la dernière clé dans le trou : `{"a","b","c","d"}` privé de `b` donne `a, d, c`. `shift_remove` garde l'ordre JS (`a, c, d`) |
| `JSON.parse` de décimaux | `serde_json::from_str` sans `float_roundtrip` | L'analyseur par défaut de `serde_json` peut rendre un flottant voisin d'une unité au dernier rang (ULP) ; la fonction `float_roundtrip` rend la valeur exacte. Le corpus porte des décimaux à 17 chiffres significatifs |
| `JSON.stringify(1.0)` | `serde_json::to_string(&1.0_f64)` | JS écrit `1`, `serde_json` écrit `1.0` ; `-0` : JS `0`, `serde_json` `-0.0` |
| `JSON.parse` avec clé dupliquée | `#[derive(Deserialize)]` | `{"a":1,"b":0,"a":2}` : JS garde la dernière valeur (`{"a":2,"b":0}`), comme `serde_json::Value` ; une structure dérivée refuse (« duplicate field ») |
| `JSON.parse` d'un grand entier | `serde_json::Value` | `{"id":9007199254740993}` : JS lit `9007199254740992`, `serde_json` garde `9007199254740993` |
| champ `undefined` | champ `Option` à `None` | `JSON.stringify({a: undefined, b: 1})` omet `a` ; `None` s'écrit `null` sans `skip_serializing_if` |

## 6. Ordre d'itération

| Construction TypeScript | Traduction évidente en Rust | Piège qui le révèle |
| --- | --- | --- |
| `Map`, `Set`, `Object.keys`, `for…in` | `HashMap`, `HashSet` | JS itère dans l'ordre d'insertion (clés entières d'abord pour un objet) ; `HashMap` dans un ordre tiré à chaque processus. Deux exécutions du port sur la même entrée rendent deux ordres : le point (b) du test de parité le classe comme variation, et elle n'est pas tolérable si l'ordre atteint la sortie. `indexmap` garde l'ordre d'insertion, `BTreeMap` trie |
| suppression puis réinsertion : `m.delete("b"); m.set("b", 3)` | `IndexMap::insert` après `swap_remove` | JS place `b` à la fin ; l'ordre Rust dépend de la suppression choisie (voir la ligne `remove` du §5) |
| comparateur incohérent : `(a, b) => a - b` avec `NaN` | `sort_by(\|a, b\| a.partial_cmp(b).unwrap_or(…))` | L'ordre obtenu dépend de l'algorithme de tri de chaque côté ; la documentation de `slice::sort_by` admet en outre une panique quand le comparateur n'est pas un ordre total. Le corpus porte des tableaux avec `NaN` |

## 7. Exceptions contre `Result`

| Construction TypeScript | Traduction évidente en Rust | Piège qui le révèle |
| --- | --- | --- |
| `throw` de n'importe quelle valeur, `try`/`catch` qui attrape tout | `?`, `unwrap()`, `expect()` | Un `unwrap()` mis là où l'original lève une exception transforme une erreur attrapable en panique ; les lints de la flotte refusent `unwrap`, `expect` et `panic!`, le port doit donc nommer chaque erreur. Le corpus porte, pour chaque chemin où l'original lève, une entrée qui le déclenche |
| `JSON.parse` qui lève `SyntaxError`, `new URL` qui lève `TypeError` | `serde_json::from_str`, `url::Url::parse` | Les deux côtés refusent, mais pas les mêmes entrées : chaque entrée refusée d'un côté seulement est une divergence |
| `finally` | `Drop`, ou code après `?` | Le code placé après un `?` ne s'exécute pas sur l'erreur ; un effet de `finally` (fermeture, journal) disparaît si le port ne le porte pas dans un `Drop` ou ne le rend pas explicite |

## 8. Asynchrone

| Construction TypeScript | Traduction évidente en Rust | Piège qui le révèle |
| --- | --- | --- |
| `const p = f(); … await p` | `let p = f(); … p.await` | Une promesse JS démarre à sa création ; un futur Rust ne fait rien tant qu'il n'est pas attendu ou lancé. Deux requêtes lancées puis attendues en JS deviennent deux requêtes en série. Le corpus compare l'ordre et le nombre des appels sortants (point (d)) |
| `Promise.all([…])` | `futures::future::try_join_all` | Quand une promesse échoue, `Promise.all` rejette mais les autres continuent ; `try_join_all` abandonne les autres futurs, et abandonner un futur l'annule. Les effets déjà partis diffèrent |
| état partagé entre deux `await`, sans verrou | `tokio` multi-thread | JS exécute un seul fil : entre deux `await`, aucun autre code ne s'intercale. Sous un exécuteur multi-thread, l'état partagé demande `Send`, `Sync` et une conception ; ce que le test de parité ne mesure pas (concurrence) commence ici |

## 9. Code dynamique et réflexion

| Construction TypeScript | Traduction évidente en Rust | Piège qui le révèle |
| --- | --- | --- |
| `eval`, `new Function`, `import(expr)`, `require(variable)` | aucune : un moteur JS embarqué, ou une table ajoutée à la main | Il n'y a pas d'équivalent. La forme admissible est un registre explicite des cas, et le corpus porte chaque nom que l'original sait charger, plus un nom inconnu |
| `obj[cle]` calculé, `Proxy`, `Reflect`, `Symbol`, prototype modifié, `instanceof` | `serde_json::Value` partout, ou un `match` sur des chaînes | La valeur dont la forme se vérifie à l'exécution demande une énumération Rust explicite. Le corpus porte une valeur de chaque forme que l'original distingue, plus une forme qu'il ne connaît pas |

## 10. Horloge et aléatoire

| Construction TypeScript | Traduction évidente en Rust | Piège qui le révèle |
| --- | --- | --- |
| `Date.now()`, `new Date()`, `performance.now()`, `Math.random()`, `crypto.randomUUID()` | `SystemTime::now()`, `rand::random()`, `Uuid::new_v4()` | Les valeurs changent à chaque exécution : le point (b) du test de parité les voit varier entre deux exécutions de l'original. La forme admissible est de les passer en paramètre (horloge et graine injectées), pas de les tolérer par un normaliseur large |
| `new Date("2026-11-23")` contre `new Date("2026-11-23T10:00")` | une seule fonction d'analyse de date | JS lit une date seule en UTC (`2026-11-23T00:00:00.000Z`) et une date avec heure sans fuseau en heure locale (`2026-11-23T09:00:00.000Z` sous `TZ=Europe/Paris`). Le corpus porte les deux formes et fixe `TZ` |

## Sources à consulter, sans import

Deux éléments du même dépôt servent à préparer un portage. Aucun n'est importé ni installé ici,
et aucun ne dispense des règles de la flotte.

- **Table bibliothèque npm → crate** : `src/crates.toml` donne, pour une bibliothèque importée
  par le code TypeScript, une ou plusieurs crates et un degré d'adéquation (`good`, `partial`,
  `none`). La table n'a pas de colonne de licence : toute crate retenue passe l'audit de licence
  de la flotte (I-11, `deny.toml`) comme n'importe quelle dépendance.
- **Porte d'entrée** : pour remplacer un serveur route par route, un serveur axum démarre
  l'original sur un port qui lui est propre, répond aux routes déjà portées et transmet toutes
  les autres à l'original (`docs/whole-apps.md`, section « Servers »). Les deux implémentations
  coexistent : c'est la double exécution temporaire de `vision.md` §4.6, qui exige un
  propriétaire, une date de suppression et le retrait de l'ancienne implémentation après la
  bascule.

## Provenance

Grille rédigée à partir du dépôt `erkamyaman/rust-anything` (https://github.com/erkamyaman/rust-anything,
licence MIT), commit `4fbcdb1f62cc3a382e72d43820a0f4d1ad436812` : catalogue des risques
(`src/risks.rs`, lignes 8 à 56), texte de chaque risque (lignes 140 à 258), repliement de casse
et fonctions de regex manquantes (lignes 410 à 430), décisions X6 (`shift_remove`, ordre UTF-16)
et M9 (`float_roundtrip`) de `DECISIONS.md`, `docs/pitfalls.md`, et `docs/whole-apps.md` pour la
porte d'entrée. Aucun code ni texte n'en est copié : la grille est écrite en propres termes, et
ses sorties sont celles de la sonde du 2026-11-23, pas celles de l'outil. L'outil n'est ni
adopté ni prescrit.

Sont des ajouts de cette grille, absents de la source : l'état `lastIndex` d'un motif `/g`, la
syntaxe de remplacement `$1a`, le `.` et les fins de ligne, l'ordre des clés de forme entière,
le tri sans comparateur, la collation, `Promise.all` et l'annulation d'un futur, l'analyse des
dates, `finally`.
