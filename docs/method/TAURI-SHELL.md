# Coquille Tauri 2 — gabarit de référence

- **Portée :** la configuration, les six contrôles et les commandes de
  qualification de la coquille macOS de tout produit du catalogue
  (ADR-0057 §1, D96 à D98). Gabarit à copier dans le dépôt du produit, pas du
  code livré ici : `project-governance` ne porte aucun code applicatif.
- **Statut :** proposé le 2026-10-23, issue `libre-ai/project-governance#138`.
  Il restitue ADR-0057 §2 et §4 ; en cas de divergence, l'ADR fait foi.
- **Pourquoi un gabarit :** sans lui, P02, P04 et le prochain produit
  récrivent chacun les six contrôles, et trois récritures divergent.

## Ce que le gabarit ne dit pas

- Il ne mesure rien de P02 ni de P04 : aucune valeur de mémoire, de latence ou
  d'accessibilité sous Tauri n'existe à ce jour (ADR-0057 §3).
- Les clés de configuration ci-dessous sont celles du schéma publié par Tauri
  (`gh api repos/tauri-apps/tauri/contents/crates/tauri-schema-generator/schemas/config.schema.json`),
  relues le 2026-10-23. Une clé renommée par une version ultérieure fait
  échouer le vecteur correspondant, qui lit le fichier : c'est le but.
- Les points marqués **NON VÉRIFIÉ** n'ont pas été exécutés dans une coquille
  construite ; le premier produit qui adopte le gabarit les tranche et corrige
  ce document.
- Mesuré le 2026-10-23, hors coquille : le squelette TypeScript de §3.1 est
  rouge sur un dossier vide, vert sur la configuration de §2, et rouge sur
  chacune de six configurations qui violent un contrôle (URL distante dans une
  fenêtre, capacité `remote`, source de CSP élargie, fenêtre non incognito,
  permission `core:default`, `build.devUrl`) ; le script de §4 passe `sh -n` et
  `shellcheck -s sh`, et sa boucle C6 sort 0 sur un processus sans port, 1 sur
  un processus qui écoute, 1 sur un processus illisible. Le squelette Rust de
  §3.2 n'a **pas** été compilé.

## 1. Les six contrôles et leur vecteur rouge

ADR-0057 §2 : « un contrôle sans vecteur n'est pas un contrôle (I-08) ». Le
vecteur de chaque contrôle s'écrit **avant** le code de la coquille, doit être
rouge sur une coquille vide, et se termine par un compte : tentatives et refus.
Zéro tentative est un échec, jamais un vert.

| N° | Contrôle (ADR-0057 §2) | Entrée rouge du vecteur | Refus attendu, compté | Où il s'exécute |
| --- | --- | --- | --- | --- |
| C1 | Le front est servi depuis la mémoire de l'application par un gestionnaire de schéma privé, jamais depuis un hôte distant | `app.windows[].url` ou toute URL de la configuration pointant vers `http(s)://`, `ws(s)://` | 0 URL distante parmi N valeurs de configuration lues | `bun test` (§3.1) |
| C2 | La configuration Tauri n'autorise aucune URL distante | une capacité portant `remote.urls`, ou une URL absolue dans `tauri.conf.json` | 0 capacité distante parmi N lues | `bun test` (§3.1) |
| C3 | CSP `default-src 'none'` élargie aux seules origines du schéma privé | un `default-src` autre que `'none'` ; une source autre que `'none'` ou `'self'` (et, pour `connect-src`, autre que `ipc:` et `http://ipc.localhost`) : joker, `https:`, `data:`, `'unsafe-inline'`, hôte nommé | 0 source hors liste blanche parmi N directives lues | `bun test` (§3.1) |
| C4 | Le magasin de données de la vue web est non persistant | une fenêtre sans `incognito: true` ; puis, à l'exécution, une écriture `localStorage` ou IndexedDB qui survit à un redémarrage | 0 fenêtre persistante parmi N ; 0 valeur relue après redémarrage parmi M écrites | `bun test` (§3.1), puis spike D93 (§3.3) |
| C5 | Les capacités exposées au front sont énumérées par commande, deny-by-default | une capacité listant `core:default`, un joker ou `allow-*` d'une commande non déclarée ; à l'exécution, l'appel d'une commande non déclarée | 0 permission hors liste parmi N ; appel non déclaré refusé : 1 sur 1 | `bun test` (§3.1), `cargo test` (§3.2) |
| C6 | Le processus Rust n'ouvre aucun port | n'importe quelle socket en écoute du processus ou de ses descendants | 0 `(LISTEN)` parmi N lignes `lsof` examinées sur P processus | `scripts/qualify-macos.sh` (§4) |

C1 et C2 se recoupent à dessein : C1 borne l'origine du **contenu**, C2 borne
l'origine des **droits**. Un produit peut passer l'un et échouer l'autre.

## 2. Contraintes de configuration

### 2.1 `src-tauri/tauri.conf.json`

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "<nom-du-produit>",
  "identifier": "<identifiant-inverse-du-produit>",
  "build": {
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": false,
    "windows": [
      {
        "label": "main",
        "title": "<nom-du-produit>",
        "incognito": true
      }
    ],
    "security": {
      "pattern": { "use": "brownfield" },
      "freezePrototype": true,
      "csp": {
        "default-src": "'none'",
        "script-src": "'self'",
        "style-src": "'self'",
        "img-src": "'self'",
        "font-src": "'self'",
        "connect-src": "ipc: http://ipc.localhost"
      }
    }
  },
  "bundle": {
    "active": true,
    "targets": ["app"]
  }
}
```

| Clé | Exigence | Contrôle |
| --- | --- | --- |
| `build.frontendDist` | un **dossier** local, jamais une URL : le front est embarqué à la compilation et servi par le protocole de la coquille, depuis la mémoire | C1 |
| `build.devUrl` | **absente** de ce fichier. Le développement la passe par une surcharge (`tauri dev --config <surcharge>`, option `-c/--config` du CLI), qui n'entre jamais dans un artefact de release | C1, C2 |
| `app.windows[].url` | **absente** : sa valeur par défaut est le front embarqué. Une valeur absolue `http(s)://` est rouge | C1 |
| `app.windows[].incognito` | `true` sur chaque fenêtre. Dans `wry`, `incognito` utilise sur macOS le magasin de données non persistant (`WKWebsiteDataStore` non persistant) | C4 |
| `app.windows[].dataStoreIdentifier`, `dataDirectory` | **absentes** : elles désignent un magasin nommé ou un dossier, donc persistant | C4 |
| `app.security.csp` | forme objet (une directive par clé), `default-src` égal à `'none'`, aucune directive ne nomme d'hôte distant ; `'self'` désigne l'origine du schéma privé de la coquille. `connect-src ipc: http://ipc.localhost` est la valeur que la documentation de Tauri donne pour laisser passer l'IPC et rien d'autre | C3 |
| `app.security.dangerousDisableAssetCspModification` | **absente ou `false`** : la désactiver retire à Tauri l'ajout de ses nonces et empreintes, donc oblige à élargir la CSP à la main | C3 |
| `app.security.assetProtocol.enable` | **absente ou `false`** : le protocole d'actifs donne accès à des fichiers du disque | C1, C5 |
| `app.security.capabilities` | **absente** (tous les fichiers de `capabilities/` s'appliquent) ou énumération explicite ; jamais de capacité en ligne qui contourne la revue du dossier | C5 |
| `app.withGlobalTauri` | `false` : pas d'objet `window.__TAURI__` injecté, le front importe l'API qu'il emploie | C5 |
| `app.security.pattern` | `brownfield` (défaut) tant que le front est la seule source de code du produit. `isolation` devient exigible le jour où un produit charge du code tiers dans la vue (le front passerait alors par un iframe de validation) | C5 |

**NON VÉRIFIÉ** : la liste de directives ci-dessus est un point de départ. La
CSP **effective** d'une coquille construite (celle que Tauri injecte dans le
HTML embarqué) n'a pas été lue dans cette session ; le vecteur C3 de §3.2 la
lit sur le binaire.

### 2.2 `src-tauri/capabilities/main.json`

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main",
  "description": "Droits du front : une entrée par commande, rien d'autre.",
  "windows": ["main"],
  "permissions": [
    "allow-<commande-1>",
    "allow-<commande-2>"
  ]
}
```

- Pas de clé `remote` (C2), pas de `core:default`, pas de joker (C5).
  `core:default` ouvre des groupes de commandes du noyau que le produit n'a pas
  énumérés.
- Chaque `allow-<commande>` correspond à une commande du produit déclarée dans
  `build.rs` (§2.3). Une permission sans commande, ou une commande sans
  permission, est une dérive que le vecteur C5 compte.
- Un plugin Tauri ajoute ses propres permissions : chacune entre dans la liste
  par une ligne de la revue, avec la commande qu'elle ouvre.

### 2.3 `src-tauri/build.rs`

```rust
fn main() {
    // Les seules commandes que le front peut appeler. Chaque nom génère les
    // permissions `allow-<commande>` / `deny-<commande>` (tauri-build).
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            // "<commande-1>",
            // "<commande-2>",
        ]),
    );
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
```

`AppManifest::commands` est la forme documentée par `tauri-build` pour générer
une permission par commande d'application. **NON VÉRIFIÉ** : le comportement
d'une commande enregistrée par `generate_handler!` mais absente de ce manifeste
(refusée ou autorisée à tous). Le vecteur C5 de §3.2 est précisément ce qui le
tranche : s'il reste vert avec la commande retirée de la capacité, la
configuration n'est pas deny-by-default et le produit ne l'adopte pas.

### 2.4 Le plafond de mémoire (ADR-0057 §4)

Le produit écrit, **avant toute mesure**, le plafond de mémoire résidente de sa
coquille en régime établi dans sa fiche `project.v1.yaml` (ou, à défaut, dans
son ADR). Le schéma de fiche porte le champ depuis ce gabarit :

```yaml
desktop_shell:
  framework: tauri-2
  memory_ceiling_mib: 512      # D92 : valeur par défaut, un produit peut en poser une autre
  ceiling_fixed_on: "<AAAA-MM-JJ, antérieure à la première mesure>"
```

Une fiche qui déclare `desktop_shell` sans l'un des deux champs échoue à
`bun run check:cards`, qui imprime aussi le nombre de fiches lues, de coquilles
déclarées et de plafonds fixés. Un dépassement mesuré à la qualification est
une décision de surface (retour au natif pour ce produit), jamais une révision
du plafond (ADR-0057 §4).

## 3. Les vecteurs rouges, en squelettes exécutables

Chaque squelette **échoue tel quel** sur un dépôt sans coquille : c'est l'état
« rouge d'abord » exigé par ADR-0057 §2. Il passe au vert quand la coquille
respecte le contrôle, et reste rouge si on retire le contrôle.

### 3.1 Contrôles de configuration C1 à C5 — `shell/config-vectors.test.ts`

Se lance avec `TAURI_SHELL_DIR=src-tauri bun test shell/config-vectors.test.ts`
(la variable d'environnement vaut `src-tauri` par défaut). Il ne lance pas
la coquille : il lit les fichiers qui la configurent.

```ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Gabarit docs/method/TAURI-SHELL.md §3.1 (ADR-0057 §2). Chaque test compte ce
// qu'il a examiné : zéro élément examiné est un échec, jamais un vert.
const DIR = process.env.TAURI_SHELL_DIR ?? "src-tauri";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, "utf8")) as Json;
}

// Source illisible = échec : readFileSync lève, le test rougit.
const config = readJson(join(DIR, "tauri.conf.json")) as { [key: string]: Json };
const capabilityFiles = readdirSync(join(DIR, "capabilities")).filter((f) => f.endsWith(".json"));
const capabilities = capabilityFiles.map((file) => ({
  file,
  body: readJson(join(DIR, "capabilities", file)) as { [key: string]: Json },
}));

// `$schema` est une URL d'éditeur, pas une origine que la coquille contacte.
function strings(value: Json, found: string[] = []): string[] {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, found);
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key !== "$schema") strings(item, found);
    }
  }
  return found;
}

function reportRefusals(label: string, examined: number, offenders: string[]): void {
  console.log(`${label}: ${offenders.length} refus sur ${examined} élément(s) examiné(s)`);
  expect(examined).toBeGreaterThan(0);
  expect(offenders).toEqual([]);
}

describe("C1/C2 — aucune URL distante", () => {
  test("la configuration ne contient aucune URL absolue", () => {
    const values = strings(config);
    const remote = values.filter((value) => /^(?:https?|wss?|ftp):\/\//i.test(value));
    reportRefusals("C1 configuration", values.length, remote);
  });

  test("aucune capacité n'ouvre de droits à une origine distante", () => {
    const remote = capabilities.filter(({ body }) => "remote" in body).map(({ file }) => file);
    reportRefusals("C2 capacités", capabilities.length, remote);
  });

  test("le front est un dossier embarqué, pas une URL", () => {
    const build = config.build as { [key: string]: Json } | undefined;
    expect(typeof build?.frontendDist).toBe("string");
    expect(build?.devUrl).toBeUndefined();
    expect(strings(config.app ?? null).filter((v) => /^[a-z][a-z0-9+.-]*:\/\//i.test(v))).toEqual([]);
  });
});

describe("C3 — CSP default-src 'none', schéma privé seul", () => {
  const app = (config.app ?? {}) as { [key: string]: Json };
  const security = (app.security ?? {}) as { [key: string]: Json };
  const csp = security.csp as { [key: string]: string } | undefined;

  test("la CSP est un objet dont default-src vaut 'none'", () => {
    expect(csp).toBeDefined();
    expect(csp?.["default-src"]).toBe("'none'");
  });

  test("aucune directive n'élargit au-delà du schéma privé et de l'IPC", () => {
    const directives = Object.entries(csp ?? {});
    const forbidden = directives.flatMap(([name, value]) =>
      value
        .split(/\s+/)
        .filter(Boolean)
        .filter((source) => {
          if (name === "connect-src") return !["ipc:", "http://ipc.localhost"].includes(source);
          return !["'none'", "'self'"].includes(source);
        })
        .map((source) => `${name} ${source}`),
    );
    reportRefusals("C3 directives", directives.length, forbidden);
  });

  test("Tauri garde la main sur les nonces et empreintes de la CSP", () => {
    expect(security.dangerousDisableAssetCspModification ?? false).toBe(false);
  });
});

describe("C4 — magasin de données non persistant", () => {
  test("chaque fenêtre déclarée est incognito et sans magasin nommé", () => {
    const app = (config.app ?? {}) as { windows?: { [key: string]: Json }[] };
    const windows = app.windows ?? [];
    const persistent = windows
      .filter(
        (window) =>
          window.incognito !== true ||
          "dataStoreIdentifier" in window ||
          "dataDirectory" in window,
      )
      .map((window) => String(window.label ?? "<sans label>"));
    reportRefusals("C4 fenêtres", windows.length, persistent);
  });
});

describe("C5 — capacités énumérées par commande, deny-by-default", () => {
  test("chaque permission est un allow-<commande>, sans joker ni groupe par défaut", () => {
    const permissions = capabilities.flatMap(({ file, body }) =>
      (Array.isArray(body.permissions) ? body.permissions : []).map(
        (permission) => `${file}:${JSON.stringify(permission)}`,
      ),
    );
    const offenders = permissions.filter(
      (entry) => !/:"allow-[a-z0-9-]+"$/.test(entry) || entry.includes("*"),
    );
    reportRefusals("C5 permissions", permissions.length, offenders);
  });

  test("la fenêtre du front n'obtient aucun droit par la configuration en ligne", () => {
    const security = ((config.app ?? {}) as { [key: string]: Json }).security as
      | { [key: string]: Json }
      | undefined;
    const inline = Array.isArray(security?.capabilities)
      ? security.capabilities.filter((entry) => typeof entry !== "string")
      : [];
    expect(inline).toEqual([]);
  });
});
```

### 3.2 Vecteurs à l'exécution — `src-tauri/tests/shell_vectors.rs`

Le test construit l'application avec la **vraie** configuration du produit
(`generate_context!`) sur le runtime simulé de Tauri (`tauri::test`, module que
Tauri documente comme instable) et appelle l'IPC comme le ferait le front.
Il échoue tel quel (`todo!`) tant que la coquille n'est pas câblée.

```rust
// Gabarit docs/method/TAURI-SHELL.md §3.2 (ADR-0057 §2, contrôle C5).
// Cargo.toml : tauri = { version = "2", features = ["test"] } en dev-dependencies.
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;

fn invoke(webview: &tauri::WebviewWindow<tauri::test::MockRuntime>, cmd: &str) -> Result<(), String> {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|_| ())
    .map_err(|error| format!("{error:?}"))
}

#[test]
fn c5_a_command_missing_from_the_capability_is_refused_and_counted() {
    // Les commandes DÉCLARÉES par le produit : la même liste que build.rs.
    let declared: &[&str] = &[/* "<commande-1>", ... */];
    // Une commande enregistrée dans le handler mais absente de la capacité.
    let undeclared = "<commande-enregistree-mais-non-declaree>";

    let app = mock_builder()
        // .invoke_handler(tauri::generate_handler![<toutes les commandes>])
        .build(tauri::generate_context!())
        .expect("la coquille se construit");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("la fenêtre se construit");

    let attempts = 1_usize;
    let refused = usize::from(invoke(&webview, undeclared).is_err());
    println!("C5 commande non déclarée : {refused} refus sur {attempts} tentative(s)");

    assert!(!declared.is_empty(), "aucune commande déclarée : le vecteur n'examine rien");
    assert_eq!(refused, attempts, "une commande non déclarée a été acceptée");
    todo!("câbler le handler du produit : tant que ce todo! existe, le vecteur est rouge");
}

#[test]
fn c3_the_effective_csp_of_the_built_shell_is_the_configured_one() {
    // NON VÉRIFIÉ : lire la CSP effective injectée dans le HTML embarqué
    // (asset résolu par le contexte) et la comparer à celle de tauri.conf.json.
    todo!("à écrire avec le premier produit : lire la CSP effective, pas la configurée");
}
```

**NON VÉRIFIÉ** : `mock_builder` combiné à `generate_context!()` applique-t-il
l'ACL générée par `build.rs` ? Si la commande non déclarée est acceptée alors
que la capacité l'exclut, ce harnais ne mesure rien : le vecteur C5 passe alors
par le spike `@wdio/tauri-service` de P02 (ADR-0057 §4, D93), dont le verdict
vaut pour la flotte.

### 3.3 Vecteur C4 à l'exécution

Une écriture dans le magasin persistant est le deuxième cas rouge nommé par
ADR-0057 §2. Il se joue dans la coquille construite, hors de portée de
`bun test` : écrire une clé `localStorage` et une base IndexedDB depuis le
front, quitter l'application, la relancer, relire. Le vecteur compte les
valeurs écrites et les valeurs relues ; il est vert à **0 relue sur M écrites**
(M > 0). Le pilote est celui du spike `@wdio/tauri-service` (ADR-0057 §4) : tant que ce
verdict n'existe pas, ce vecteur est **NON VÉRIFIÉ** et le contrôle C4 ne se
déclare tenu que sur sa moitié de configuration (§3.1).

La même contrainte vaut pour C5 si le harnais de §3.2 n'applique pas l'ACL : le
pilote de ce spike est alors le seul instrument d'exécution.

## 4. Qualification macOS (ADR-0057 §4, D98)

Elle s'exécute sur un runner macOS, sur la coquille construite et lancée. Le
squelette `scripts/qualify-macos.sh` regroupe les commandes ; chacune imprime
ce qu'elle a examiné et le script sort non nul au premier échec.

```sh
#!/bin/sh
# Gabarit docs/method/TAURI-SHELL.md §4. Usage : qualify-macos.sh <chemin.app> <binaire-du-processus>
set -eu

APP="${1:?chemin du bundle .app}"
PROCESS_NAME="${2:?nom du processus de la coquille}"

# C6 — aucun port en écoute. `lsof -i -P` est la commande de l'ADR ; elle est
# bornée au processus de la coquille et à ses descendants, puis comptée.
open "$APP"
sleep 10
ROOT_PID="$(pgrep -x "$PROCESS_NAME" | head -n 1)"
[ -n "$ROOT_PID" ] || { echo "C6 : processus $PROCESS_NAME introuvable" >&2; exit 1; }
PIDS="$ROOT_PID $(pgrep -P "$ROOT_PID" | tr '\n' ' ')"
examined=0
listening=0
processes=0
for pid in $PIDS; do
  # `lsof -i` sort 0 ligne aussi bien pour « aucun port » que pour « processus
  # illisible » : on prouve d'abord que lsof lit ce processus (tout processus a
  # au moins un descripteur), sinon un vert ne voudrait rien dire.
  readable="$(lsof -n -p "$pid" 2>/dev/null | grep -c . || true)"
  [ "$readable" -gt 0 ] || { echo "C6 : lsof ne lit pas le processus $pid" >&2; exit 1; }
  processes=$((processes + 1))
  lines="$(lsof -i -P -n -a -p "$pid" 2>/dev/null || true)"
  examined=$((examined + $(printf '%s\n' "$lines" | grep -c . || true)))
  listening=$((listening + $(printf '%s\n' "$lines" | grep -c '(LISTEN)' || true)))
done
echo "C6 : $listening en écoute, $examined lignes réseau, $processes processus lus"
[ "$listening" -eq 0 ] || exit 1

# Signature, évaluation Gatekeeper, ticket de notarisation.
codesign --verify --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose=4 "$APP"
xcrun stapler validate "$APP"
echo "signature, Gatekeeper et ticket de notarisation : vérifiés pour $APP"
```

Le même runner joue le parcours fonctionnel du produit sous Playwright webkit
(D93), moteur de rendu de la WKWebView de la coquille :

```sh
bunx playwright test --project=webkit
```

Le projet `webkit` se déclare dans `playwright.config.ts` du produit
(`projects: [{ name: "webkit", use: { ...devices["Desktop Safari"] } }]`) ; le
cross-browser durable se code là, pas dans une exploration ponctuelle.

| Commande (ADR-0057 §4) | Ce qu'elle prouve | Compte imprimé |
| --- | --- | --- |
| `lsof -i -P` | C6 : aucun port en écoute (borné au processus de la coquille et à ses descendants ; les services XPC de WebKit n'en sont pas des descendants, **NON VÉRIFIÉ** s'ils ouvrent un port) | ports en écoute, lignes examinées, processus |
| `codesign --verify --strict` | la signature de l'application est valide et stricte | sortie de `codesign` (`valid on disk`) |
| `spctl --assess` | Gatekeeper accepte l'application | sortie de `spctl` (`accepted`) |
| `xcrun stapler validate` | un ticket de notarisation est agrafé à la release candidate | sortie de `stapler` |
| Playwright webkit | le parcours fonctionnel tourne sur le moteur de la vue | tests passés sur tests déclarés |

La syntaxe de `codesign`, `spctl`, `xcrun stapler` et `lsof -i -P -n -a -p` a
été exécutée le 2026-10-23 sur une application système (`Calculator.app`) : les
options sont acceptées, et `stapler` répond bien « does not have a ticket
stapled » sur une application sans ticket. Aucune coquille Tauri n'a été
construite ni lancée pour ce gabarit : **NON VÉRIFIÉ** sur une coquille réelle.

## 5. Ce qui reste à la charge du produit

- Les noms de commandes, la liste des permissions et la valeur du plafond.
- Le branchement du vecteur C4 d'exécution (§3.3) et du vecteur C3 sur la CSP
  effective (§3.2), qui dépendent du verdict du spike `@wdio/tauri-service`.
- La matrice de menace du produit, qui reprend les deux risques d'ADR-0057
  (moteur web et processus auxiliaires ; texte exposé à l'accessibilité) avec
  leurs contrôles, sans en inventer d'autres pour la coquille.
