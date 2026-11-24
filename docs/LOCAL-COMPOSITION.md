<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Installer une composition locale

Les dépendances de développement `file:` et Cargo `path` relient plusieurs dépôts. Cloner uniquement l’application puis exécuter `bun install` ne suffit pas. La liste exacte des voisins, leurs commits et l’ordre d’installation sont dans `.github/composition/manifest.json` et `prepare-composition.py` ; ne reconstruisez pas cette liste à la main.

Cette recette utilise les outils existants de CI. Elle prépare un **nouveau dossier** et refuse de remplacer un checkout existant. Tous les dépôts nécessaires sont présents avant l’installation ; le toolkit construit UI avant que les consommateurs en copient les exports. Les paquets conservent leurs noms, imports et versions indépendants. Rien n’est publié vers npm, Cargo ou un service de déploiement.

## Vérifier un dépôt de la flotte sur clone neuf (agent)

Sur un clone neuf d’un dépôt de la flotte, `bun run check` lancé seul ne mesure pas ce que le pipeline mesure : les dépendances `file:../<dépôt frère>` résolvent ce qui se trouve à côté, à n’importe quelle révision, et le Bun du poste n’est pas forcément celui que la gouvernance épingle. Le pipeline (`.github/workflows/validate-composition.yml`) monte d’abord la composition avec `run-composition.py`. La même commande se lance en local, et sa phase `verify` dit si le résultat est prêt.

```sh
set -eu
TARGET=collaborative-data-sync
TARGET_REVISION="$(git ls-remote "https://github.com/libre-ai/$TARGET.git" HEAD | cut -f1)"
WORKSPACE="$(mktemp -d)"
WORKSPACE="$(cd "$WORKSPACE" && pwd -P)"
COMPOSITION="$WORKSPACE/sources"
git clone --quiet https://github.com/libre-ai/project-governance.git "$WORKSPACE/tooling"
python3 -B "$WORKSPACE/tooling/.github/composition/run-composition.py" \
  --target "$TARGET" --revision "$TARGET_REVISION" \
  --root "$COMPOSITION" --phase prepare
```

Dans le même terminal, installez ensuite Bun par les blocs de la section 2.2 (celui de votre plateforme) : ils ne lisent que `WORKSPACE` et `COMPOSITION`, définis ci-dessus. Ne lancez pas la section 2.1, qui remonterait les sources dans un dossier déjà occupé. Puis demandez le verdict :

```sh
python3 -B "$WORKSPACE/tooling/.github/composition/run-composition.py" \
  --target "$TARGET" --revision "$TARGET_REVISION" \
  --root "$COMPOSITION" --phase verify
```

`TARGET_REVISION` est ici la tête de la branche servie ; donnez le SHA complet de tout autre commit à vérifier. `--root` doit être un chemin absolu sans lien symbolique (d’où `pwd -P`), et le dossier doit être neuf ou vide pour `prepare`. Aucun jeton n’est requis : les sources sont lues par le protocole Git sur des dépôts publics.

`prepare` imprime une ligne par dépôt du plan, ses compteurs, puis `Sources of <cible>: MOUNTED` ou `NOT MOUNTED`. `verify` imprime les mêmes lignes et compteurs, puis le reçu, Bun et son verdict :

```text
project-governance mounted=<sha> expected=<sha> concordant
collaborative-data-sync mounted=<sha> expected=<sha> concordant
Composition collaborative-data-sync: 2 repositories expected, 2 mounted, 2 concordant
receipt .composition-state.json expected=<empreinte du plan> concordant
bun found=<révision> expected=<révision> concordant
Toolchain: 1 expected, 1 concordant
Composition collaborative-data-sync: READY
```

- Verdict d’un dépôt : `concordant`, `mismatch` (une autre révision que celle du plan), `modified` (un fichier suivi a changé), `masked` (un fichier suivi porte un drapeau d’index `skip-worktree` ou `assume-unchanged` : Git ne le regarde plus, son silence ne dit rien de ce fichier), `absent`, `unreadable` (pas un checkout Git lisible à cet endroit, un dossier qui est un lien, un `.git` qui est un fichier ou un lien : il renverrait à un autre dépôt que le dossier nommé, ou un chemin que l’outil n’a pas le droit de lire : jamais annoncé `absent`). La configuration propre d’un checkout ne lance aucun programme pendant la lecture : `core.fsmonitor` y est désactivé.
- `prepare` monte les sources et ne juge pas l’outillage. `verify` ne monte rien et n’écrit rien, `.git` compris ; elle seule dit `READY`.
- `verify` lit le reçu `.composition-state.json` que `prepare` écrit à la racine et que `--phase check` exige (`absent`, `mismatch` s’il appartient à un autre plan, `unreadable`). Des dépôts posés à la main aux bons SHA, sans `prepare`, ne sont donc pas `READY` : `check` les refuserait.
- `verify` compare `bun --revision` à la révision de `project-governance/toolchains/bun.json` **dans la composition**, le fichier que le pipeline donne à son installateur. Si elle diffère, la sortie nomme la révision attendue ; elle s’installe par la section 2.2, puis `verify` se relance.
- Les variables `GIT_*` du terminal (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`…) ne sont transmises à aucune commande lancée par l’outil : le verdict porte sur le dossier donné à `--root`. La purge vaut aussi pour le `fetch` de `prepare` : `GIT_SSL_CAINFO`, `GIT_PROXY_COMMAND` et `GIT_SSH_COMMAND` ne l’atteignent pas, donc un `prepare` derrière un proxy TLS d’entreprise doit trouver le certificat de ce proxy dans le magasin de certificats du système.
- Si la racine n’existe pas, la première ligne le dit : `Composition root is missing: <chemin>` ; si c’est un fichier, `Composition root is not a directory: <chemin>` ; si l’outil ne peut pas la lire, `Composition root is unreadable: <chemin>` : rendre le droit de lecture puis relancer `verify`, un nouveau `prepare` refuserait cette racine non vide.
- Le code de sortie est non nul dès qu’un dépôt n’est pas `concordant`, que le plan est vide, ou, pour `verify`, que le reçu ou Bun n’est pas celui attendu. Sous `set -e`, une `verify` non prête arrête donc le terminal ; pour seulement lire son diagnostic, ajoutez `|| true` à la commande.

Quand `verify` dit `READY`, `--phase check` (section 3) admet cette racine : même reçu, mêmes SHA. Cette phase installe dans l’ordre du plan, puis exécute la commande de vérification de la cible ; ses propres prérequis (Rust, outil de licences) sont ceux de la section 2.1, que `verify` ne juge pas.

Les voisins sont montés aux SHA de `manifest.json` **de l’outillage employé**. Le clone ci-dessus prend l’outillage à la tête de la branche servie de `project-governance`. Le pipeline d’un dépôt emploie, lui, la révision `tooling_ref` écrite dans son `.github/workflows/code-validation.yml` : pour reproduire exactement son verdict, placez `$WORKSPACE/tooling` à ce SHA (`git -C "$WORKSPACE/tooling" checkout --detach <tooling_ref>`). Un outillage antérieur à l’ajout de la phase `verify` la refuse.

## 1. Choisir les révisions et lire le plan

Prérequis : Git, Python 3.11 ou supérieur, Bash, curl, Rustup et un accès aux dépôts GitHub publics. Les commandes suivantes s’exécutent dans le même terminal. L’exemple choisit un commit Notebook qualifié ; pour un autre travail, remplacez `TARGET` et `TARGET_REVISION` par le nom canonique et le SHA complet du commit à vérifier. N’utilisez pas un ancien commit documentaire comme preuve de présence du code.

```sh
set -eu
TARGET=personal-knowledge-workspace
TARGET_REVISION=3c4e38605152fff7b5e6f94d5c1557ac94ea5956
TOOLING_REVISION=ed87f3fa5b9285adc08e7a07a94853872cb1bb16
WORKSPACE="$(mktemp -d)"
WORKSPACE="$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$WORKSPACE")"
COMPOSITION="$WORKSPACE/sources"
git clone --no-checkout https://github.com/libre-ai/project-governance.git "$WORKSPACE/tooling"
git -C "$WORKSPACE/tooling" checkout --detach "$TOOLING_REVISION"
python3 "$WORKSPACE/tooling/.github/composition/prepare-composition.py" \
  --target "$TARGET" --revision "$TARGET_REVISION"
python3 "$WORKSPACE/tooling/.github/composition/run-composition.py" \
  --target "$TARGET" --revision "$TARGET_REVISION" \
  --root "$COMPOSITION" --phase prepare --plan
```

Les deux dernières commandes affichent le plan sans installer ni modifier les dépôts. Le SHA cible remplace uniquement la cible ; les voisins restent aux SHA du manifeste de l’outillage choisi. Conservez cette distinction lorsque vous interprétez les résultats. Pour employer une autre révision de l’outillage, choisissez explicitement son SHA après revue du manifeste et des scripts.

## 2. Préparer les sources et les outils

### 2.1 Sources, Rust et outil de licences

```sh
python3 "$WORKSPACE/tooling/.github/composition/run-composition.py" \
  --target "$TARGET" --revision "$TARGET_REVISION" \
  --root "$COMPOSITION" --phase prepare
rustup toolchain install 1.100.0 --profile minimal \
  --component rustfmt --component clippy --component llvm-tools-preview \
  --target wasm32-unknown-unknown
RUST_BIN="$(dirname "$(rustup which --toolchain 1.100.0 cargo)")"
export PATH="$RUST_BIN:$PATH"
python3 -m venv "$WORKSPACE/licensing"
"$WORKSPACE/licensing/bin/python" -m pip install reuse==6.2.0
export PATH="$WORKSPACE/licensing/bin:$PATH"
```

Le répertoire choisi par `rustup which` place Cargo et rustc 1.100 en tête du `PATH` de cette session ; aucun défaut Rustup global ni variable `RUSTUP_TOOLCHAIN` n’est modifié.

### 2.2 Bun, Node et outils vérifiés

Ces blocs ne lisent que `WORKSPACE` et `COMPOSITION`, et demandent que la section 2.1 ou la recette agent ait monté les sources. Les fiches de Bun, de Node et de cargo-deny sont lues dans `"$COMPOSITION/project-governance/toolchains"`, la gouvernance **composée** : ce sont les fichiers que le pipeline donne à son installateur, et celui auquel `verify` compare Bun. Seule la fiche d’osv-scanner vient de l’outillage (`$WORKSPACE/tooling`), comme dans le pipeline. Lire Bun dans l’outillage installerait, dès que l’outillage et la gouvernance composée épinglent deux Bun, celui que `verify` refuse.

Bun doit être exactement `1.4.0-canary.1+57f349f63`. Les builds Notebook utilisent Node `26.5.0` et vérifient aussi le SHA de son exécutable. Les installateurs ci-dessous lisent les empreintes depuis les manifestes épinglés, vérifient les archives avant extraction et n’activent les chemins qu’après tous les contrôles. Leurs fichiers `GITHUB_PATH` et `GITHUB_ENV` sont ici de simples sorties locales ; aucun fichier d’environnement n’est exécuté.

```sh
export RUNNER_TEMP="$WORKSPACE"
export GITHUB_PATH="$WORKSPACE/tool-path"
export GITHUB_ENV="$WORKSPACE/tool-env"
: > "$GITHUB_PATH"
: > "$GITHUB_ENV"
```

Sur **Linux x86_64** :

```sh
bash "$WORKSPACE/tooling/.github/composition/install-toolchains.sh" \
  "$COMPOSITION/project-governance/toolchains/bun.json" \
  "$COMPOSITION/project-governance/toolchains/notebook-qualification.json" \
  "$COMPOSITION/project-governance/toolchains/cargo-deny.json" \
  "$WORKSPACE/tooling/toolchains/osv-scanner.json"
```

Cet installateur fournit aussi osv-scanner `2.7.1` (binaire vérifié contre `toolchains/osv-scanner.json`, chemin dans `LIBRE_AI_OSV_SCANNER`) ; la base d’avis hors ligne qu’il lit se télécharge à part, voir `docs/toolchain/OSV-ADVISORY-DATABASE.md`. Il fournit aussi cargo-deny `0.19.5` (archive et exécutable vérifiés contre `toolchains/cargo-deny.json`) et écrit son chemin dans `LIBRE_AI_CARGO_DENY` ; exportez cette variable comme `NOTEBOOK_QUALIFICATION_NODE` ci-dessous. Quand elle est définie, `tools/quality/check-dependency-policy.ts` utilise ce binaire et échoue s’il manque ou diffère, sans en télécharger un autre. Sur macOS, laissez-la vide : le script télécharge alors l’archive épinglée et en vérifie les empreintes.

Sur **macOS ARM64**, réutilisez l’installateur Notebook au commit qualifié, sans ajouter ses paquets à la composition. Son empreinte est vérifiée avant exécution :

```sh
curl --fail --location --proto '=https' --proto-redir '=https' --max-time 120 \
  --output "$WORKSPACE/install-macos-toolchains.sh" \
  https://raw.githubusercontent.com/libre-ai/personal-knowledge-workspace/3c4e38605152fff7b5e6f94d5c1557ac94ea5956/.github/scripts/install-macos-toolchains.sh
printf '%s  %s\n' \
  621479c80cd1be892d4d33e989b94f3cf22a21bcaf46dffe90ecb5805f7b840a \
  "$WORKSPACE/install-macos-toolchains.sh" | shasum -a 256 --check
bash "$WORKSPACE/install-macos-toolchains.sh" \
  "$COMPOSITION/project-governance/toolchains/bun.json" \
  "$COMPOSITION/project-governance/toolchains/notebook-qualification.json"
```

Ces recettes refusent les autres architectures. Elles ne changent pas l’autorisation d’usage bootstrap de la version Bun préliminaire.

```sh
TOOL_BIN="$(cat "$GITHUB_PATH")"
export PATH="$TOOL_BIN:$PATH"
export NOTEBOOK_QUALIFICATION_NODE="$TOOL_BIN/node"
[ -x "$TOOL_BIN/cargo-deny" ] && export LIBRE_AI_CARGO_DENY="$TOOL_BIN/cargo-deny"
bun --revision
node --version
```

## 3. Installer dans l’ordre et vérifier la cible

Le contrôle principal d’`artifact-verification` exige son outil de couverture. Installez-le avant cette phase si cette cible est sélectionnée :

```sh
if [ "$TARGET" = artifact-verification ]; then
  cargo install cargo-llvm-cov --version 0.9.2 --locked
  export PATH="$PATH:$HOME/.cargo/bin"
fi
```

```sh
python3 "$WORKSPACE/tooling/.github/composition/run-composition.py" \
  --target "$TARGET" --revision "$TARGET_REVISION" \
  --root "$COMPOSITION" --phase check
```

Cette phase exécute les installations gelées `--frozen-lockfile --ignore-scripts`, construit UI au bon moment et lance les contrôles de la cible. Elle vérifie les SHA et l’absence de changements suivis après chaque groupe. Ne relancez pas `prepare` sur ce dossier : il est maintenant occupé. Les applications se trouvent sous `"$COMPOSITION/$TARGET"` ; les autres commandes de leur guide se lancent depuis cette racine. Ne faites pas d’installation indépendante dans un sous-workspace.

`--phase check` ne représente pas toutes les suites supplémentaires de chaque workflow : tests natifs, WASM, navigateurs et couverture peuvent être des étapes distinctes.

## 4. Compléments Notebook et Model Policy

Le 2026-11-23, le propriétaire a décidé de retirer de `personal-knowledge-workspace` l'app Notebook et sa suite de navigateurs ; la qualification du cœur `notebook-core-v2` reste. À partir de l'outillage qui porte ce retrait, `check-products.py` refuse la porte `e2e` de `personal-knowledge-workspace` ; sa porte `wasm` et `NOTEBOOK_QUALIFICATION_NODE` sont inchangées. L'exemple de cette page reste épinglé à un commit du Notebook et à l'outillage `ed87f3fa`, où cette porte `e2e` existe : il reste rejouable tel quel, mais le paragraphe des navigateurs, en fin de section, ne décrit plus la composition courante de ce dépôt pour `personal-knowledge-workspace`.

Préchargez les dépendances avant une commande Cargo hors ligne :

```sh
cd "$COMPOSITION/$TARGET"
cargo fetch --locked
cargo test --locked --offline
```

Le lanceur existant permet ensuite de construire et vérifier le WASM de ces deux cibles :

```sh
python3 "$WORKSPACE/tooling/.github/composition/check-products.py" \
  --root "$COMPOSITION" --target "$TARGET" --gate wasm \
  --bun "$(command -v bun)" --cargo "$(command -v cargo)" --node "$(command -v node)"
```

Pour les navigateurs, suivez la commande du guide de l’application et installez d’abord les navigateurs du Playwright verrouillé, depuis son workspace : `bun x --no-install playwright install chromium firefox webkit` (ajouter `--with-deps` sur Linux si les bibliothèques système manquent). Exécutez séquentiellement les suites partageant un port. Notebook distingue les parcours Chromium/Firefox, le refus WebKit Linux et le fonctionnement positif WebKit macOS ; ces preuves ne sont pas interchangeables.
