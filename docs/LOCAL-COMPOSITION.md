<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Installer une composition locale

Les dépendances de développement `file:` et Cargo `path` relient plusieurs dépôts. Cloner uniquement l’application puis exécuter `bun install` ne suffit pas. La liste exacte des voisins, leurs commits et l’ordre d’installation sont dans `.github/composition/manifest.json` et `prepare-composition.py` ; ne reconstruisez pas cette liste à la main.

Cette recette utilise les outils existants de CI. Elle prépare un **nouveau dossier** et refuse de remplacer un checkout existant. Tous les dépôts nécessaires sont présents avant l’installation ; le toolkit construit UI avant que les consommateurs en copient les exports. Les paquets conservent leurs noms, imports et versions indépendants. Rien n’est publié vers npm, Cargo ou un service de déploiement.

## 1. Choisir les révisions et lire le plan

Prérequis : Git, Python 3.11 ou supérieur, Bash, curl, Rustup et un accès aux dépôts GitHub publics. Les commandes suivantes s’exécutent dans le même terminal. L’exemple choisit un commit Notebook qualifié ; pour un autre travail, remplacez `TARGET` et `TARGET_REVISION` par le nom canonique et le SHA complet du commit à vérifier. N’utilisez pas un ancien commit documentaire comme preuve de présence du code.

```sh
set -eu
TARGET=personal-knowledge-notebook
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

```sh
python3 "$WORKSPACE/tooling/.github/composition/run-composition.py" \
  --target "$TARGET" --revision "$TARGET_REVISION" \
  --root "$COMPOSITION" --phase prepare
rustup toolchain install 1.97.0 --profile minimal \
  --component rustfmt --component clippy --component llvm-tools-preview \
  --target wasm32-unknown-unknown
RUST_BIN="$(dirname "$(rustup which --toolchain 1.97.0 cargo)")"
export PATH="$RUST_BIN:$PATH"
python3 -m venv "$WORKSPACE/licensing"
"$WORKSPACE/licensing/bin/python" -m pip install reuse==6.2.0
export PATH="$WORKSPACE/licensing/bin:$PATH"
```

Le répertoire choisi par `rustup which` place Cargo et rustc 1.97 en tête du `PATH` de cette session ; aucun défaut Rustup global ni variable `RUSTUP_TOOLCHAIN` n’est modifié.

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
  "$WORKSPACE/tooling/toolchains/bun.json" \
  "$WORKSPACE/tooling/toolchains/notebook-qualification.json"
```

Sur **macOS ARM64**, réutilisez l’installateur Notebook au commit qualifié, sans ajouter ses paquets à la composition. Son empreinte est vérifiée avant exécution :

```sh
curl --fail --location --proto '=https' --proto-redir '=https' --max-time 120 \
  --output "$WORKSPACE/install-macos-toolchains.sh" \
  https://raw.githubusercontent.com/libre-ai/personal-knowledge-notebook/3c4e38605152fff7b5e6f94d5c1557ac94ea5956/.github/scripts/install-macos-toolchains.sh
printf '%s  %s\n' \
  621479c80cd1be892d4d33e989b94f3cf22a21bcaf46dffe90ecb5805f7b840a \
  "$WORKSPACE/install-macos-toolchains.sh" | shasum -a 256 --check
bash "$WORKSPACE/install-macos-toolchains.sh" \
  "$WORKSPACE/tooling/toolchains/bun.json" \
  "$WORKSPACE/tooling/toolchains/notebook-qualification.json"
```

Ces recettes refusent les autres architectures. Elles ne changent pas l’autorisation d’usage bootstrap de la version Bun préliminaire.

```sh
TOOL_BIN="$(cat "$GITHUB_PATH")"
export PATH="$TOOL_BIN:$PATH"
export NOTEBOOK_QUALIFICATION_NODE="$TOOL_BIN/node"
bun --revision
node --version
```

## 3. Installer dans l’ordre et vérifier la cible

Le contrôle principal d’`artifact-verification` exige son outil de couverture. Installez-le avant cette phase si cette cible est sélectionnée :

```sh
if [ "$TARGET" = artifact-verification ]; then
  cargo install cargo-llvm-cov --version 0.8.7 --locked
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
