# Coquille Tauri 2 — gabarit de référence

- **Portée :** la configuration, les six contrôles et les commandes de
  qualification de la coquille macOS de tout produit du catalogue
  (ADR-0057 §1, D96 à D98). Gabarit à copier dans le dépôt du produit, pas du
  code livré ici : `project-governance` ne porte aucun code applicatif.
- **Statut :** proposé le 2026-10-23, issue `libre-ai/project-governance#138`.
  Il restitue ADR-0057 §2 et §4 ; en cas de divergence, l'ADR fait foi. Corrigé
  le 2026-10-24 de ce que la première réalisation a mesuré : `PR#34` désigne
  `libre-ai/personal-knowledge-workspace#34` (WP-2 de P04, fusionnée), dont le
  corps et le code sous `apps/desktop/` sont la source de chaque mesure citée.
- **Pourquoi un gabarit :** sans lui, P02, P04 et le prochain produit
  récrivent chacun les six contrôles, et trois récritures divergent.

## Ce que le gabarit ne dit pas

- Il ne mesure rien de P02 ni de P04 en mémoire, en latence ou en
  accessibilité : aucune de ces valeurs sous Tauri n'existe à ce jour
  (ADR-0057 §3). `PR#34` a mesuré les six contrôles, pas les coûts.
- Les clés de configuration ci-dessous sont celles du schéma publié par Tauri
  (`gh api repos/tauri-apps/tauri/contents/crates/tauri-schema-generator/schemas/config.schema.json`),
  relues le 2026-10-23. Une clé renommée par une version ultérieure fait
  échouer le vecteur correspondant, qui lit le fichier : c'est le but.
- Les points marqués **NON VÉRIFIÉ** n'ont pas été exécutés dans une coquille
  construite ; le premier produit qui les mesure les tranche et corrige ce
  document. `PR#34` a tranché ceux de §2.1 (CSP effective), §2.3 (commande
  hors manifeste), §3.2 (`mock_builder`) et §4 (processus WebKit), et §3.3 et
  §3.4 (vecteurs d'exécution) ; §6 liste ce qui reste **NON VÉRIFIÉ**.
- Mesuré le 2026-10-23, hors coquille : le squelette TypeScript de §3.1 est
  rouge sur un dossier vide, vert sur la configuration de §2, et rouge sur
  chacune de six configurations qui violent un contrôle (URL distante dans une
  fenêtre, capacité `remote`, source de CSP élargie, fenêtre non incognito,
  permission `core:default`, `build.devUrl`) ; le script de §4 passe `sh -n` et
  `shellcheck -s sh`, et sa boucle C6 sort 0 sur un processus sans port, 1 sur
  un processus qui écoute, 1 sur un processus illisible. Le squelette Rust
  du 2026-10-23 n'a **pas** été compilé, et il ne compilait pas : `PR#34`
  (« Measured answers… ») relève quatre défauts, corrigés en §2.3 et §3.2.
- Mesuré le 2026-10-24, hors coquille (macOS, runtime simulé de Tauri, versions
  de `PR#34` : `tauri =2.12.4`, `tauri-build =2.7.3`) : les squelettes Rust de
  §2.3, §2.3.1 et §3.2 compilent avec la configuration de §2.1 telle quelle,
  passent `cargo clippy --all-targets -- -D warnings` sous les lints de
  l'espace de travail de `PR#34` et `cargo fmt --check`, et leurs deux
  vecteurs (C5, C3) sont verts (`C5 … 3 refus sur 3 tentative(s)`). Deux
  mutants les font rougir : une commande ajoutée à `COMMANDS` et à la capacité
  (`C5 … 2 refus sur 3`) ; `'unsafe-inline'` ajouté à `script-src` (CSP
  effective différente). `TAURI_CONFIG` défini, vide ou non, fait échouer
  `build.rs`. Le squelette TypeScript de §3.1 n'a pas changé.

## 1. Les six contrôles et leur vecteur rouge

ADR-0057 §2 : « un contrôle sans vecteur n'est pas un contrôle (I-08) ». Le
vecteur de chaque contrôle s'écrit **avant** le code de la coquille, doit être
rouge sur une coquille vide, et se termine par un compte : tentatives et refus.
Zéro tentative est un échec, jamais un vert.

| N° | Contrôle (ADR-0057 §2) | Entrée rouge du vecteur | Refus attendu, compté | Où il s'exécute |
| --- | --- | --- | --- | --- |
| C1 | Le front est servi depuis la mémoire de l'application par un gestionnaire de schéma privé, jamais depuis un hôte distant ; la fenêtre ne navigue qu'à l'intérieur de ce schéma (garde `on_navigation`) | `app.windows[].url` ou toute URL de la configuration pointant vers `http(s)://`, `ws(s)://` ; puis, à l'exécution, une requête du front vers une URL hors du schéma privé, **dont la navigation de premier niveau** (`location` envoyé vers `http://127.0.0.1:<port>/`) | 0 URL distante parmi N valeurs de configuration lues ; 0 requête aboutie sur K tentées hors schéma (navigation comprise) | `bun test` (§3.1), puis la coquille lancée (§3.4) |
| C2 | La configuration Tauri n'autorise aucune URL distante | une capacité portant `remote.urls`, ou une URL absolue dans `tauri.conf.json` | 0 capacité distante parmi N lues | `bun test` (§3.1) |
| C3 | CSP `default-src 'none'` élargie aux seules origines du schéma privé | un `default-src` autre que `'none'` ; une source autre que `'none'` ou `'self'` (et, pour `connect-src`, autre que `ipc:` et `http://ipc.localhost`) : joker, `https:`, `data:`, `'unsafe-inline'`, hôte nommé | 0 source hors liste blanche parmi N directives lues | `bun test` (§3.1) |
| C4 | Le magasin de données de la vue web est non persistant. Une écriture dans un magasin non persistant **est acceptée en mémoire** : ce qui est refusé et compté est sa persistance | une fenêtre sans `incognito: true` ; puis, à l'exécution, une écriture `localStorage` ou IndexedDB qui survit à un redémarrage | 0 fenêtre persistante parmi N ; 0 valeur relue après redémarrage parmi M écrites, 0 fichier de magasin sous le dossier personnel de scratch | `bun test` (§3.1), puis la coquille lancée (§3.3) |
| C5 | Les capacités exposées au front sont énumérées par commande, deny-by-default | une capacité listant `core:default`, un joker ou `allow-*` d'une commande non déclarée ; à l'exécution, l'appel d'une commande enregistrée mais non déclarée, d'une commande inconnue, d'une commande déclarée depuis une autre fenêtre | 0 permission hors liste parmi N ; appels refusés : 3 sur 3 (runtime simulé) et 1 sur 1 (coquille réelle) | `bun test` (§3.1), `cargo test` (§3.2), la coquille lancée (§3.3) |
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
| `build.devUrl` | **absente** de ce fichier, et **sans surcharge** : `tauri dev --config` et `tauri build --config` passent leur surcharge par la variable `TAURI_CONFIG`, que `build.rs` refuse (§2.5, `PR#34` « Build-time configuration »). Le développement reconstruit le front puis lance `cargo run -p <crate>` ; la fonctionnalité `custom-protocol` par défaut (§2.3.1) y sert le front embarqué comme la release | C1, C2 |
| `app.windows[].url` | **absente** : sa valeur par défaut est le front embarqué. Une valeur absolue `http(s)://` est rouge | C1 |
| `app.windows[]` (entrée `main`) | l'entrée reste dans le fichier, mais la coquille retire sa création à Tauri (`create = false` à l'exécution) et construit la fenêtre elle-même avec la garde `on_navigation(is_private_origin)` (§2.3.1) : les fenêtres configurées n'ont aucune garde de navigation, et la CSP ne couvre pas la navigation (`PR#34`, « Not in the template, found by the probe ») | C1 |
| `app.windows[].incognito` | `true` sur chaque fenêtre. Dans `wry`, `incognito` utilise sur macOS le magasin de données non persistant (`WKWebsiteDataStore` non persistant) | C4 |
| `app.windows[].dataStoreIdentifier`, `dataDirectory` | **absentes** : elles désignent un magasin nommé ou un dossier, donc persistant | C4 |
| `app.security.csp` | forme objet (une directive par clé), `default-src` égal à `'none'`, aucune directive ne nomme d'hôte distant ; `'self'` désigne l'origine du schéma privé de la coquille. `connect-src ipc: http://ipc.localhost` est la valeur que la documentation de Tauri donne pour laisser passer l'IPC et rien d'autre | C3 |
| `app.security.dangerousDisableAssetCspModification` | **absente ou `false`** : la désactiver retire à Tauri l'ajout de ses nonces et empreintes, donc oblige à élargir la CSP à la main | C3 |
| `app.security.assetProtocol.enable` | **absente ou `false`** : le protocole d'actifs donne accès à des fichiers du disque | C1, C5 |
| `app.security.capabilities` | **absente** (tous les fichiers de `capabilities/` s'appliquent) ou énumération explicite ; jamais de capacité en ligne qui contourne la revue du dossier | C5 |
| `app.withGlobalTauri` | `false` : pas d'objet `window.__TAURI__` injecté, le front importe l'API qu'il emploie | C5 |
| `app.security.pattern` | `brownfield` (défaut) tant que le front est la seule source de code du produit. `isolation` devient exigible le jour où un produit charge du code tiers dans la vue (le front passerait alors par un iframe de validation). `PR#34` omet la clé (défaut) ; la configuration ci-dessus, clé comprise, compile (mesuré le 2026-10-24, §3.2) | C5 |
| `bundle.active` | `true` ici ; `PR#34` le laisse à `false` : l'empaquetage, les icônes du bundle, la signature et la notarisation relèvent d'un autre lot (WP-6 de P04). Tant qu'il est `false`, §4 (`codesign`, `spctl`, `stapler`) ne s'exécute sur rien | — |
| `icons/icon.png` | **requis par `generate_context!`**, même avec `bundle.active` à `false` : la macro panique sans lui. `PR#34` livre une icône synthétique de 32x32 en attendant celles du bundle | — |

La CSP **effective** de la coquille construite (`asset_resolver().get("index.html")`,
champ `csp_header`) a été lue par `PR#34` : `default-src 'none'; script-src
'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src ipc:
http://ipc.localhost`, soit la CSP configurée. L'ordre des directives varie
d'un run à l'autre (le vecteur de §3.2 compare des ensembles) et la page de
`PR#34` n'a aucune balise `<meta>` de CSP. Tauri n'y ajoute ni nonce ni empreinte tant
que la page n'a aucun script en ligne (`PR#34`). Une page qui en aurait
changerait vraisemblablement cette valeur : inféré, non mesuré.

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

Motif de `PR#34` (`apps/desktop/src-tauri/build.rs`), sans le code propre au
produit. `expect` est refusé par les lints de l'espace de travail de `PR#34`
(`expect_used`, `unwrap_used`, `panic` et `todo` sont à `deny`) : `main` rend un
`Result`.

```rust
use std::error::Error;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

// Variables que le build refuse : `tauri-build` et `generate_context!` les
// fusionnent dans la configuration, que le gate statique ne lit pas (§2.5).
const REFUSED_ENV: &[&str] = &["TAURI_CONFIG"];

// Les seules commandes que le front peut appeler : une permission
// `allow-<commande>` par nom (tauri-build). `capabilities/main.json` liste les mêmes.
const COMMANDS: &[&str] = &["shell_ping"];

// tauri-build n'efface jamais le fichier d'une commande retirée de `COMMANDS` : sa
// permission resterait dans le vocabulaire du binaire. On retire les périmés, pas
// le dossier (tauri-build surveille `permissions/` : il recompilerait à chaque appel).
fn remove_stale_permissions(directory: &Path) -> Result<(), Box<dyn Error>> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("cannot read {}: {error}", directory.display()).into()),
    };
    for entry in entries {
        let path = entry?.path();
        let current = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| COMMANDS.contains(&stem));
        if !current {
            fs::remove_file(&path)?;
        }
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    for name in REFUSED_ENV {
        // Sans cette ligne, un build en cache fait sous un environnement propre resterait vert.
        println!("cargo::rerun-if-env-changed={name}");
        if std::env::var_os(name).is_some() {
            return Err(format!(
                "{name} is set: tauri-build would merge it into the configuration, so this shell would not be built from the files the static gate judged (controls C2 to C5). Unset it; `tauri dev` and `tauri build --config` set it, so they are refused too"
            )
            .into());
        }
    }

    // `generate_context!` embarque `frontendDist` ; sans lui l'échec est une panique de macro muette.
    if !Path::new("../dist/index.html").is_file() {
        return Err("../dist/index.html is missing: build the front first".into());
    }
    println!("cargo::rerun-if-changed=../dist");
    println!("cargo::rerun-if-changed=build.rs");

    remove_stale_permissions(Path::new("permissions/autogenerated"))?;

    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    tauri_build::try_build(attributes)?;
    Ok(())
}
```

`AppManifest::commands` est la forme documentée par `tauri-build` pour générer
une permission par commande d'application. Mesuré par `PR#34`
(« Measured answers… ») : une commande enregistrée par `generate_handler!` mais
absente de ce manifeste est **refusée**, avec le même message qu'une commande
inconnue (`probe_undeclared not allowed. Command not found`) ; ajoutée au
manifeste et à la capacité, elle est servie (`reached-the-handler`). Le
vecteur C5 de §3.2 rejoue cette mesure : s'il reste vert avec la commande
ajoutée à la capacité, il ne discrimine rien.

**Permissions autogénérées d'une commande retirée.** `tauri-build` écrit
`permissions/autogenerated/<commande>.toml` pour chaque commande de
`COMMANDS` et n'efface jamais le fichier d'une commande qui en est sortie :
`PR#34` (finding m3) a mesuré `allow-probe-old` toujours présent dans
`gen/schemas/` après le retrait de `probe_old`. La règle mesurée : retirer
**seulement** les fichiers dont le nom n'est plus une commande courante.
Vider tout le dossier a été essayé et rejeté, puisque `tauri-build` surveille
`permissions/` et que la caisse se recompilait alors à chaque appel de
`cargo` ; après le retrait sélectif, une recompilation, puis 0 aux deux
appels suivants. Le dossier est ignoré par git (`.gitignore` :
`/gen/` et `/permissions/autogenerated/`). Rejoué le 2026-10-24 sur le
squelette ci-dessus : `probe_undeclared.toml` retiré après le retrait de la
commande, `allow-probe-undeclared` absent de `gen/schemas/`.

### 2.3.1 `src-tauri/src/lib.rs`, `src/main.rs` et `Cargo.toml`

Motif de `PR#34` (`apps/desktop/src-tauri/src/lib.rs`), réduit à l'essentiel.
Trois mesures de `PR#34` le façonnent :

- **Les commandes vivent dans un module.** `#[tauri::command] pub fn` à la
  racine de la bibliothèque définit deux fois les macros d'assistance
  (E0255).
- **Un seul `generate_context!` par binaire**, exposé par la bibliothèque :
  la macro définit `_EMBED_INFO_PLIST`, qu'une seconde expansion définit
  deux fois. Les tests prennent leur contexte de `<crate>::context()`.
- **La fenêtre est construite par le code**, pour porter la garde de
  navigation de C1 (`on_navigation`) que la configuration ne sait pas exprimer.

```rust
use tauri::utils::config::WindowConfig;
use tauri::{Builder, Context, Manager, Runtime, Url, WebviewWindowBuilder};

pub mod commands {
    // Sonde de vie du pont et seule commande déclarée du gabarit : le témoin
    // positif qui distingue une commande non déclarée refusée d'un pont qui refuse tout.
    #[tauri::command]
    pub fn shell_ping() -> &'static str {
        "pong"
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ShellError {
    #[error("tauri.conf.json declares no window")]
    NoWindow,
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

// Le schéma privé qui sert le front. Sur macOS : `tauri://localhost`.
pub fn is_private_origin(url: &Url) -> bool {
    url.scheme() == "tauri" && url.host_str() == Some("localhost")
}

pub fn context<R: Runtime>() -> Context<R> {
    tauri::generate_context!()
}

pub fn with_commands<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder.invoke_handler(tauri::generate_handler![commands::shell_ping])
}

// Tauri construit les fenêtres configurées sans garde de navigation, et la CSP ne
// couvre pas la navigation de premier niveau : on retire la création de la fenêtre
// à Tauri (`create = false`) et on la construit soi-même (`main_window`).
pub fn take_window_config<R: Runtime>(
    context: &mut Context<R>,
) -> Result<WindowConfig, ShellError> {
    let entry = context
        .config_mut()
        .app
        .windows
        .first_mut()
        .ok_or(ShellError::NoWindow)?;
    entry.create = false;
    Ok(entry.clone())
}

pub fn main_window<'a, R: Runtime, M: Manager<R>>(
    manager: &'a M,
    config: &WindowConfig,
) -> Result<WebviewWindowBuilder<'a, R, M>, ShellError> {
    Ok(WebviewWindowBuilder::from_config(manager, config)?.on_navigation(is_private_origin))
}

pub fn run() -> Result<(), ShellError> {
    let mut context = context();
    let window = take_window_config(&mut context)?;
    with_commands(Builder::default())
        .setup(move |app| {
            main_window(app, &window)?.build()?;
            Ok(())
        })
        .run(context)?;
    Ok(())
}
```

`src/main.rs` ne fait qu'appeler `run()` et traduire son résultat en code de
sortie :

```rust
use std::process::ExitCode;

fn main() -> ExitCode {
    match <crate>::run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("shell failed: {error}");
            ExitCode::FAILURE
        }
    }
}
```

`Cargo.toml` : ce que `PR#34` y fixe, au-delà des dépendances.

```toml
[lib]
name = "<crate>"

[features]
# Le comportement de production est le seul comportement : `frontendDist` est
# embarqué et servi par le schéma privé, `devUrl` n'est jamais lu. Par défaut,
# pour qu'aucun build, test ou qualification n'exerce une coquille autre que celle livrée.
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]

[build-dependencies]
tauri-build = { version = "=<exacte>", default-features = false, features = ["config-json"] }

[dependencies]
tauri = { version = "=<exacte>", default-features = false, features = ["wry", "compression"] }
thiserror = "<…>"

[dev-dependencies]
tauri = { version = "=<exacte>", default-features = false, features = ["wry", "compression", "test"] }
```

`default-features = false` retire `dynamic-acl` : des capacités ajoutées à
l'exécution annuleraient un pont énuméré et deny-by-default (commentaire de
l'espace de travail de `PR#34`, non mesuré par elle). Versions épinglées
exactement (`PR#34` : `tauri =2.12.4`, `tauri-build =2.7.3`). Une caisse de
coquille est membre de l'espace de travail sans être membre par défaut : la
composition Linux lance `cargo test --locked --offline` et ne doit pas
compiler du code WKWebView (`PR#34`, « Deviations »). Un test qui lance la
vraie coquille déclare `[[test]] harness = false` : une WKWebView exige le
fil principal de son processus, que libtest ne lui laisserait pas.

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

### 2.5 Variables d'environnement de build

Un gate qui lit les fichiers suivis (§3.1) juge une coquille que le build peut
ne pas construire. `tauri-build` (`try_build`), `tauri-codegen` (`get_config`,
exécuté par `generate_context!`) et `tauri-utils` (construction de l'ACL)
fusionnent la variable **`TAURI_CONFIG`** dans la configuration. `PR#34`
(« Build-time configuration », finding M1, sévérité majeure, sécurité) a
reproduit deux écarts sur sa tête d'alors :

- `TAURI_CONFIG='{"app":{"security":{"csp":null}}}'` : la moitié dynamique
  rougit (CSP `[]`, `eval reached`) alors que le vérificateur statique reste
  à 23 tests verts ;
- une capacité en ligne sur `windows: ["*"]` avec `core:default` compile, et la
  moitié dynamique affiche OK, alors que `capabilities/` n'en contient aucune.

La variable est donc **refusée**, en deux endroits :

1. `build.rs` (§2.3) : constante `REFUSED_ENV`, variable définie **ou vide**
   (vide : `cargo` sort déjà en 101 sur l'analyse JSON, mais sur un autre
   message ; le refus doit nommer la variable et C2 à C5).
2. La chaîne de qualification, **avant sa première étape `cargo`** : un script
   lit la liste `REFUSED_ENV` de `build.rs` et échoue si l'une de ses variables
   est définie (`PR#34` : `tests/shell/refuse-env.ts`, première étape de
   `check:p04-shell`, qui imprime `refuse-env: 1 variable(s) refused
   (TAURI_CONFIG), 0 defined`). Un job de CI qui lance la coquille hérite de
   la même obligation. Une seule liste, lue par les deux : sinon l'un refuse
   ce que l'autre ignore.

Conséquence mesurée : `tauri dev` et `tauri build --config` passent leur
surcharge par cette variable, ils sont **refusés**. Le développement
reconstruit le front puis lance `cargo run -p <crate>`. Un serveur de
développement demanderait sa propre décision (une fonctionnalité ou une caisse
séparée jugée par le même gate), pas une exception à la liste.

Les autres variables lues par `tauri-build 2.7.3`, `tauri-codegen 2.7.3`,
`tauri-macros 2.7.3` et `tauri-utils 2.10.2` ont été examinées par `PR#34`
(message du commit `d5c3336a`) et **ne sont pas refusées** :

| Variable | Pourquoi elle n'est pas refusée |
| --- | --- |
| `DEP_*_PERMISSION_FILES_PATH`, `DEP_*_GLOBAL_SCOPE_SCHEMA_PATH` | n'ajoutent que des permissions de plugin qu'une capacité devrait nommer ; le gate refuse toute permission qui n'est pas `allow-<commande déclarée>` |
| `DEP_*_GLOBAL_API_SCRIPT_PATH` | lue seulement si `withGlobalTauri` vaut `true` ; le gate refuse toute autre valeur que `false` |
| `REMOVE_UNUSED_COMMANDS` | retire les gestionnaires que ses capacités n'autorisent pas : réduit, n'élargit jamais |
| `TAURI_ENV_TARGET_TRIPLE` | écrasée par le `rustc-env` du script de build lui-même |
| `TAURI_ANDROID_PROJECT_PATH`, `STATIC_VCRUNTIME`, `SDKROOT`, les variables `*_DEPLOYMENT_TARGET` | ne touchent ni la configuration ni l'ACL sur macOS |

Chaque ligne vaut pour les versions nommées : la liste se rejoue à chaque
changement de version de Tauri (inféré : `PR#34` l'a établie pour ces versions
seulement). Discrimination, mesurée par `PR#34` : le refus de `build.rs`
remplacé par `&& false` fait rougir les trois vecteurs de refus (5 verts,
3 rouges) ; `REFUSED_ENV` vidé en fait rougir 4 ; un refus déplacé ou reformulé
reste vert tant qu'il sort non nul et nomme la variable, C2 et C5, alors que
ignorer la variable au lieu de la refuser les fait rougir, comme exigé.

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
(`<crate>::context()`, §2.3.1) sur le runtime simulé de Tauri (`tauri::test`,
module que Tauri documente comme instable) et appelle l'IPC comme le ferait le
front. Il est rouge tant que la coquille n'existe pas : la caisse ou la
commande témoin `shell_ping` manque et le test ne compile pas ou le témoin
positif échoue. Il n'y a plus de `todo!` : les lints de l'espace de travail de
`PR#34` le refusent, et le témoin positif suffit à rendre le vecteur rouge.

```rust
// Gabarit docs/method/TAURI-SHELL.md §3.2 (ADR-0057 §2, contrôles C5 et C3).
// Cargo.toml : tauri avec la fonctionnalité `test` en dev-dependencies (§2.3.1).
use <crate>::{commands, context};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{WebviewWindow, WebviewWindowBuilder};

// Une commande enregistrée dans le handler mais absente de `COMMANDS` : le handler
// répondrait si l'ACL laissait passer l'appel. Dans un module : cf. E0255.
mod probe {
    #[tauri::command]
    pub fn probe_undeclared() -> &'static str {
        "reached-the-handler"
    }
}

fn invoke(webview: &WebviewWindow<MockRuntime>, command: &str) -> Result<String, String> {
    let url = "tauri://localhost"
        .parse()
        .map_err(|e| format!("url: {e}"))?;
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url,
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| format!("{body:?}"))
    .map_err(|e| format!("{e:?}"))
}

#[test]
fn c5_undeclared_calls_are_refused_and_counted() -> Result<(), String> {
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![
            commands::shell_ping,
            probe::probe_undeclared
        ])
        .build(context())
        .map_err(|e| format!("mock build: {e}"))?;
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .map_err(|e| e.to_string())?;
    let other = WebviewWindowBuilder::new(&app, "other", Default::default())
        .build()
        .map_err(|e| e.to_string())?;

    // Témoin positif : sans lui, « tout est refusé » passerait pour un contrôle tenu.
    let pong = invoke(&main, "shell_ping")?;
    if !pong.contains("pong") {
        return Err(format!("positive control: shell_ping answered {pong}"));
    }
    let attempts = [
        (
            "registered but undeclared",
            invoke(&main, "probe_undeclared"),
        ),
        ("unknown command", invoke(&main, "nothing_here")),
        (
            "declared command, other window",
            invoke(&other, "shell_ping"),
        ),
    ];
    let refused = attempts
        .iter()
        .filter(|(_, outcome)| outcome.is_err())
        .count();
    println!(
        "C5 commandes non déclarées : {refused} refus sur {} tentative(s)",
        attempts.len()
    );
    if refused != attempts.len() {
        return Err("a call that should be refused was accepted".into());
    }
    Ok(())
}

#[test]
fn c3_the_effective_csp_header_is_read_from_the_built_shell() -> Result<(), String> {
    let app = mock_builder()
        .build(context())
        .map_err(|e| format!("mock build: {e}"))?;
    let header = app
        .asset_resolver()
        .get("index.html".into())
        .and_then(|asset| asset.csp_header)
        .ok_or("no csp_header on index.html")?;
    println!("CSP {header}");
    // L'ordre des directives varie d'un run à l'autre : on compare des ensembles.
    let mut directives: Vec<&str> = header
        .split(';')
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .collect();
    directives.sort_unstable();
    let mut expected = vec![
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self'",
        "font-src 'self'",
        "connect-src ipc: http://ipc.localhost",
    ];
    expected.sort_unstable();
    if directives != expected {
        return Err(format!(
            "effective CSP differs from the configured one: {header}"
        ));
    }
    Ok(())
}
```

Mesuré par `PR#34` (« Measured answers… ») : `mock_builder` combiné à
`generate_context!` **applique** l'ACL générée. `shell_ping` répond `pong` sur
`main` ; sur une fenêtre `other` il est refusé avec la liste des fenêtres
autorisées ; une commande enregistrée mais non déclarée est refusée comme une
commande inconnue (§2.3). Ce harnais mesure donc C5 sans le spike
`@wdio/tauri-service` de P02. `PR#34` compte `3 sur 3 (mock)`, et `1 sur 1`
dans la coquille réelle (§3.3).

La lecture de la CSP effective de `PR#34` se fait sur la **coquille réelle**
(`app.asset_resolver()` après `Builder::build`, dans le processus fils de
§3.3). Le vecteur C3 ci-dessus la lit sur le runtime simulé : le squelette a
été rejoué ainsi le 2026-10-24 (valeur lue identique à celle de §2.1) mais
cette lecture-là n'est **pas** celle de `PR#34`, et elle ne dit pas ce que la
page elle-même refuse (`eval` et script en ligne refusés par la page, mesurés
par `PR#34` dans la coquille).

### 3.3 Vecteur C4 à l'exécution

Une écriture dans le magasin persistant est le deuxième cas rouge nommé par
ADR-0057 §2. Il se joue dans la coquille construite, hors de portée de
`bun test` : écrire une clé `localStorage` et une base IndexedDB depuis le
front, quitter l'application, la relancer, relire. Le vecteur compte les
valeurs écrites et les valeurs relues ; il est vert à **0 relue sur M écrites**
(M > 0).

**Écart à la lettre du critère.** Dans un magasin non persistant, l'écriture
elle-même **est acceptée en mémoire** ; ce que le contrôle refuse, et que le
vecteur compte, est sa **persistance**. Mesuré par `PR#34` (« Deviations ») :
2 écrites, 0 relue après redémarrage, 0 fichier de magasin sous le dossier
personnel de scratch ; la même exécution sans `incognito` : 2 relues, 6
fichiers. Un vecteur qui attendrait une écriture refusée échouerait sur une
coquille correcte.

**Le pilote** de `PR#34` n'est pas `@wdio/tauri-service` (spike de P02) : le
test (`[[test]] harness = false`, §2.3.1) lance la vraie coquille en processus
fils, y injecte une sonde par `initialization_script` et lit son rapport par
`document.title` (`on_document_title_changed`). Les données de WebKit sont
redirigées vers un dossier personnel de scratch par `CFFIXED_USER_HOME` ;
`PR#34` a mesuré que rien n'atterrit alors dans `~/Library/WebKit`. Le
verdict du spike `@wdio/tauri-service` n'est donc ni nécessaire à ces
vecteurs ni établi par eux (§6).

Même instrument pour C5 dans la coquille réelle : l'appel d'une commande non
déclarée depuis la page est refusé, 1 sur 1.

Compteurs de la dernière exécution de `PR#34` (verbatim, `bun run check:p04-shell`) :

```
shell_controls: refus comptes: C1 7/7 (hors schema), C5 3/3 (mock) + 1/1 (coquille), C4 2/2 (ecritures non persistees), C6 0 port(s) en ecoute ; variantes rouges vues rouges: 4/4
```

Le test porte lui-même quatre variantes rouges (CSP retirée, garde de
navigation retirée, fenêtre non incognito, écouteur volontaire) : un vecteur
qui reste vert sans son contrôle fait échouer l'exécution. Le script e2e de
`PR#34` lance le binaire de debug de la vraie coquille (pas une release), fenêtre
visible environ 12 secondes.

### 3.4 Vecteur C1 à l'exécution

Une requête vers une URL hors schéma est le premier cas rouge nommé par
ADR-0057 §2. Les vecteurs de §3.1 prouvent qu'aucune URL distante n'est
configurée ; ils ne prouvent pas que la coquille construite refuse la requête
qu'un front compromis tenterait. Depuis le front, dans la coquille construite :
émettre K requêtes (`fetch`, `XMLHttpRequest`, chargement d'image et de
script, `WebSocket`, `window.open`, **navigation de premier niveau**) vers des
URL hors du schéma privé, dont un hôte local en clair
(`http://127.0.0.1:<port-de-contrôle>`), ouvert par le pilote pour que
l'aboutissement soit observable côté serveur. Le vecteur compte les tentatives
et les requêtes abouties ; il est vert à **0 aboutie sur K tentées** (K > 0) et
rouge si le serveur de contrôle a reçu une connexion. Même pilote que §3.3.

Mesuré par `PR#34` : K = 7 (les sept ci-dessus), 0 arrivée au serveur de
contrôle (`C1 7/7 (hors schema)`).

**La navigation de premier niveau n'est couverte ni par la CSP ni par la
configuration.** Avec la seule fenêtre configurée, une navigation vers
`http://127.0.0.1:<port>/` atteint le serveur (18 à 23 connexions) : une
politique de sécurité de contenu ne couvre pas la navigation (`PR#34`, « Not in
the template, found by the probe »). La garde `on_navigation(is_private_origin)`
de la fenêtre construite par le code (§2.3.1) la ferme. Mutant : la garde
remplacée par `|_| true` : `C1 0/7` (aucune des 7 tentatives refusée) et 23
connexions atteignent le serveur de contrôle. Une page chargée ainsi n'a aucun droit :
son appel à `shell_ping` est refusé (`not allowed on window "main" … URL:
http://127.0.0.1:…`).

`window.open` n'exige aucune garde propre : sur `wry` 0.57.0 et 0.57.1,
`window.open(<URL externe>)` renvoie `null` et n'atteint rien sans gestionnaire
`on_new_window`. Un `on_new_window(Deny)` a été retiré faute de vecteur qui le
discrimine ; le vecteur `popup` consigne ce défaut (inféré : une version de `wry` qui le
changerait le ferait rougir, non mesuré).

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
# Le processus et tous ses descendants, générations comprises : `pgrep -P` ne
# liste que les enfants directs, donc on le rejoue sur chaque pid découvert
# jusqu'à épuisement (un petit-fils en écoute resterait sinon invisible).
tree_pids() {
  queue="$1"
  found=""
  while [ -n "$queue" ]; do
    next=""
    for parent in $queue; do
      found="$found $parent"
      next="$next $(pgrep -P "$parent" 2>/dev/null | tr '\n' ' ' || true)"
    done
    queue="$(echo $next)"
  done
  echo $found
}
PIDS="$(tree_pids "$ROOT_PID")"
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
| `lsof -i -P` | C6 : aucun port en écoute (borné au processus de la coquille et à ses descendants ; les processus auxiliaires de WebKit n'en sont pas des descendants : mesuré une fois par `PR#34` sur une page inactive, 3 nouveaux auxiliaires, 0 ligne réseau, 0 en écoute) | ports en écoute, lignes examinées, processus |
| `codesign --verify --strict` | la signature de l'application est valide et stricte | sortie de `codesign` (`valid on disk`) |
| `spctl --assess` | Gatekeeper accepte l'application | sortie de `spctl` (`accepted`) |
| `xcrun stapler validate` | un ticket de notarisation est agrafé à la release candidate | sortie de `stapler` |
| Playwright webkit | le parcours fonctionnel tourne sur le moteur de la vue | tests passés sur tests déclarés |

La syntaxe de `codesign`, `spctl`, `xcrun stapler` et `lsof -i -P -n -a -p` a
été exécutée le 2026-10-23 sur une application système (`Calculator.app`) : les
options sont acceptées, et `stapler` répond bien « does not have a ticket
stapled » sur une application sans ticket.

**C6 sur une coquille réelle.** `PR#34` a lancé la coquille de P04 et lu
`lsof -n -P -i -a -p <pid>` sur l'arbre de ses processus (`-n` : sans
résolution DNS) ; compteurs de sa dernière exécution (verbatim) :

```
C6 shell: lsof -i -P -a -p 8 lecture(s) de processus sur 8 echantillon(s) : 0 ligne(s), 0 en ecoute
C6 vecteur rouge (ecouteur volontaire): 1 ligne(s) dont 1 en ecoute
```

`lsof -p` est lu **d'abord** sur chaque processus (un processus illisible est un
échec) ; un descendant disparu entre `ps` et `lsof` est compté à part, alors que
le squelette ci-dessus le traiterait en échec. Le reste de ce tableau
(`codesign`, `spctl`, `stapler`) n'a **pas** été exécuté sur une coquille
Tauri : `bundle.active` vaut `false` dans `PR#34` (§2.1), il n'y a pas de
`.app` à signer. **NON VÉRIFIÉ** sur une coquille réelle.

**Où cela tourne en CI.** La moitié dynamique (`cargo test … shell_controls`,
le script e2e, `build-env.test.ts`, `cargo fmt`, `cargo clippy`) ne tourne
**que si un job macOS la lance**. `PR#34` ne crée aucun workflow : le job
macOS qui lance `bun run check:p04-shell` est livré par WP-6 de ce produit
(`.github/workflows/p04-desktop-macos.yml`). Tant qu'il n'existe pas, seule la
moitié statique (`check:p04-shell-config`, dans `bun run check`) tourne dans la
voie Linux de la CI, et la moitié dynamique n'a tourné qu'en local sur macOS.
Sur un autre système, le test et le script e2e impriment **`unavailable`** et
**échouent** : `unavailable` est un échec, jamais un vert. Un produit qui
adopte ce gabarit sans job macOS n'a pas la moitié dynamique de C1, C3 (page),
C4 et C6.

## 5. Ce qui reste à la charge du produit

- Les noms de commandes, la liste des permissions et la valeur du plafond.
- Le branchement des vecteurs d'exécution C1, C4 et C6 (§3.3, §3.4, §4) : le
  motif de `PR#34` (coquille en processus fils, sonde injectée, serveur de
  contrôle sur la boucle locale, `lsof`) se recopie de
  `apps/desktop/src-tauri/tests/shell_controls.rs` du dépôt de P04 ; il ne
  dépend plus du spike `@wdio/tauri-service`.
- Le job macOS de CI qui lance la moitié dynamique (§4, « Où cela tourne en CI »),
  et le refus de `TAURI_CONFIG` dans sa chaîne (§2.5).
- La matrice de menace du produit, qui reprend les deux risques d'ADR-0057
  (moteur web et processus auxiliaires ; texte exposé à l'accessibilité) avec
  leurs contrôles, sans en inventer d'autres pour la coquille.

## 6. Ce qui reste NON VÉRIFIÉ

`PR#34` n'a pas mesuré, et ce document ne l'affirme donc pas :

- **Signature, Gatekeeper, notarisation** (`codesign`, `spctl`, `stapler`) sur
  une coquille Tauri : `bundle.active` vaut `false` dans `PR#34`, le bundle, ses
  icônes et le bundle identifier (`org.libre-ai.p04-desktop`, provisoire)
  relèvent de WP-6.
- **L'exécution en CI de la moitié dynamique** : aucun job macOS n'existait à la
  fusion de `PR#34` (§4).
- **Le verdict du spike `@wdio/tauri-service`** de P02 : `PR#34` ne l'utilise pas
  et ne l'établit pas (§3.3).
- **Les processus auxiliaires de WebKit**, au-delà d'une mesure sur une page
  inactive (§4) : une page qui charge du contenu n'a pas été mesurée.
- **Le comportement d'une page à script en ligne** sur la CSP effective (§2.1) :
  inféré, non mesuré.
- **Les clés de §2.1 que `PR#34` ne pose pas** (`pattern`, `bundle.targets`) :
  elles compilent (mesure du 2026-10-24, « Ce que le gabarit ne dit pas ») ; leur effet à l'exécution n'a pas
  été mesuré.
- **Mémoire, latence, accessibilité** (ADR-0057 §3).
