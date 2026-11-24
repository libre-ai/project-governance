/**
 * The `cargo` half of the doc-commands gate, and the contained file read both
 * halves share.
 *
 * A `cargo` command shown in a document is resolved by NAME, against the
 * `Cargo.toml` files of the repository read as files. Cargo is never run, and
 * no command found in a document is ever executed.
 *
 * What is resolved. A command whose subcommand is `run`, `test`, `build` or
 * `check` and that names at least one target with `-p` / `--package` / `--bin`:
 *   - every package named is the `[package].name` of the root manifest or of a
 *     workspace member;
 *   - every binary named is a binary target of the packages selected (of any
 *     package when none is selected): a `[[bin]]` entry, `src/main.rs`,
 *     `src/bin/<name>.rs` or `src/bin/<name>/main.rs`;
 *   - `cargo run` without `--bin` selects packages that hold at least one binary.
 *
 * What is not recognised, counted apart and never counted as resolved: any
 * other subcommand (`fmt`, `clippy`, `install`, a `+toolchain`), a command that
 * names no target (`cargo test`, `cargo build --locked`), and a command that
 * selects a target this module does not read (`--test`, `--example`, `--bench`,
 * `--manifest-path`, `--exclude`).
 *
 * LIMITS of the manifest reading, stated rather than hidden:
 *   - `[workspace].members` is read literally, plus the one glob form
 *     `<directory>/*`; any other glob is a failure of the gate, not a guess;
 *   - `[workspace].exclude` is read literally (no glob);
 *   - a `[[bin]]` without `name` and the targets of a build script are not read;
 *   - features, `required-features` and `default-members` are not read: a
 *     binary that exists only under a feature resolves all the same.
 */

import { readdir, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";

/** The text of a file of `root`, or null: absent, unreadable, or resolving outside `root`. */
export async function readContained(root: string, path: string): Promise<string | null> {
  try {
    const rootReal = await realpath(root);
    const real = await realpath(join(rootReal, path));
    // A registry is written by the author of the pull request the gate judges:
    // a path, or a symbolic link, that leaves the repository is not read.
    if (!real.startsWith(rootReal + sep)) return null;
    return await Bun.file(real).text();
  } catch {
    return null;
  }
}

/** A registry path stays inside the repository it is read against. */
export function isContainedPath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  return !path.split("/").includes("..");
}

export type CargoReading =
  | {
      readonly kind: "read";
      readonly command: string;
      readonly subcommand: string;
      readonly packages: readonly string[];
      readonly bins: readonly string[];
    }
  | { readonly kind: "placeholder" }
  | { readonly kind: "unrecognised"; readonly command: string; readonly why: string };

const RESOLVED_SUBCOMMANDS: ReadonlySet<string> = new Set(["run", "test", "build", "check"]);
const STOP_TOKENS: ReadonlySet<string> = new Set(["--", "&&", "||", "|", ";"]);
const UNREAD_SELECTORS: readonly string[] = [
  "--test",
  "--example",
  "--bench",
  "--manifest-path",
  "--exclude",
];
const TARGET_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * Classifies what follows `cargo ` on a line. Only the tokens before a `--`, a
 * shell operator or a `#` comment belong to cargo: what follows is given to the
 * program cargo runs, or is another command.
 */
export function classifyCargo(rest: string): CargoReading {
  const tokens: string[] = [];
  for (const token of rest.split(/\s+/)) {
    if (token === "") continue;
    if (STOP_TOKENS.has(token) || token.startsWith("#")) break;
    tokens.push(token);
  }
  if (tokens.some((token) => token.includes("<") || token.includes("…"))) {
    return { kind: "placeholder" };
  }
  const command = ["cargo", ...tokens].join(" ");
  const unrecognised = (why: string): CargoReading => ({ kind: "unrecognised", command, why });

  const subcommand = tokens[0];
  if (subcommand === undefined) return unrecognised("no subcommand");
  if (!RESOLVED_SUBCOMMANDS.has(subcommand)) {
    return unrecognised(`subcommand \`${subcommand}\` is not read`);
  }

  const packages: string[] = [];
  const bins: string[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    const [flag, inline] = token.startsWith("--") ? splitOnce(token, "=") : [token, undefined];
    if (UNREAD_SELECTORS.includes(flag)) {
      return unrecognised(`selector \`${flag}\` is not read`);
    }
    const into =
      flag === "-p" || flag === "--package" ? packages : flag === "--bin" ? bins : undefined;
    if (into === undefined) continue;
    const value = inline ?? tokens[index + 1];
    if (inline === undefined) index += 1;
    if (value === undefined || !TARGET_NAME.test(value)) {
      return unrecognised(`\`${flag}\` is followed by no plain name`);
    }
    into.push(value);
  }
  if (packages.length === 0 && bins.length === 0) {
    return unrecognised("names no package and no binary");
  }
  return { kind: "read", command, subcommand, packages, bins };
}

function splitOnce(token: string, separator: string): [string, string | undefined] {
  const at = token.indexOf(separator);
  return at === -1 ? [token, undefined] : [token.slice(0, at), token.slice(at + 1)];
}

export interface CargoPackage {
  readonly name: string;
  /** Path of its manifest, relative to the root. */
  readonly manifest: string;
  readonly bins: readonly string[];
}

/** The packages of a repository as read from its manifests; `failures` is empty when all could be read. */
export interface CargoWorkspace {
  readonly packages: readonly CargoPackage[];
  readonly failures: readonly string[];
}

/** Why a command read does not resolve against the packages, or null when it does. */
export function resolveCargo(
  reading: Extract<CargoReading, { kind: "read" }>,
  packages: readonly CargoPackage[],
): string | null {
  const selected: CargoPackage[] = [];
  for (const name of reading.packages) {
    const found = packages.find((candidate) => candidate.name === name);
    if (found === undefined) return `package \`${name}\` is the name of no manifest read`;
    selected.push(found);
  }
  const candidates = selected.length > 0 ? selected : packages;
  for (const bin of reading.bins) {
    if (!candidates.some((candidate) => candidate.bins.includes(bin))) {
      return selected.length > 0
        ? `binary \`${bin}\` is no binary target of the package(s) selected`
        : `binary \`${bin}\` is no binary target of any manifest read`;
    }
  }
  if (reading.subcommand === "run" && reading.bins.length === 0) {
    const without = selected.find((candidate) => candidate.bins.length === 0);
    if (without !== undefined) return `package \`${without.name}\` holds no binary target to run`;
  }
  return null;
}

interface ManifestFacts {
  readonly packageName: string | null;
  readonly autobins: boolean;
  readonly explicitBins: readonly { readonly name: string; readonly path: string | null }[];
  readonly members: readonly string[];
  readonly exclude: readonly string[];
  readonly hasWorkspace: boolean;
}

function tableOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** The fields of one `Cargo.toml` this gate reads, or null when the text is not TOML. */
export function parseCargoManifest(text: string): ManifestFacts | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = tableOf(Bun.TOML.parse(text));
  } catch {
    return null;
  }
  const pkg = tableOf(parsed.package);
  const workspace = tableOf(parsed.workspace);
  const explicitBins = (Array.isArray(parsed.bin) ? parsed.bin : []).flatMap((entry) => {
    const bin = tableOf(entry);
    return typeof bin.name === "string"
      ? [{ name: bin.name, path: typeof bin.path === "string" ? bin.path : null }]
      : [];
  });
  return {
    packageName: typeof pkg.name === "string" ? pkg.name : null,
    autobins: pkg.autobins !== false,
    explicitBins,
    members: stringsOf(workspace.members),
    exclude: stringsOf(workspace.exclude),
    hasWorkspace: "workspace" in parsed,
  };
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function entriesOf(directory: string): Promise<{ name: string; directory: boolean }[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .map((entry) => ({ name: entry.name, directory: entry.isDirectory() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Binary targets of one package directory: the `[[bin]]` entries, then what cargo discovers. */
async function binsOf(root: string, directory: string, facts: ManifestFacts): Promise<string[]> {
  const bins = new Set(facts.explicitBins.map((bin) => bin.name));
  if (!facts.autobins || facts.packageName === null) return [...bins];
  // A path a `[[bin]]` entry claims is that entry's target, not a discovered one.
  const claimed = new Set(facts.explicitBins.map((bin) => bin.path));
  const base = join(root, directory);
  if (!claimed.has("src/main.rs") && (await isFile(join(base, "src/main.rs")))) {
    bins.add(facts.packageName);
  }
  for (const entry of await entriesOf(join(base, "src/bin"))) {
    if (entry.directory) {
      const main = `src/bin/${entry.name}/main.rs`;
      if (!claimed.has(main) && (await isFile(join(base, main)))) bins.add(entry.name);
    } else if (entry.name.endsWith(".rs") && !claimed.has(`src/bin/${entry.name}`)) {
      bins.add(entry.name.slice(0, -".rs".length));
    }
  }
  return [...bins];
}

/**
 * Reads the root manifest and every workspace member it declares. Effectful:
 * files and directories of `root` are read, nothing is written or run.
 */
export async function loadCargoWorkspace(
  root: string,
  manifestPath: string,
): Promise<CargoWorkspace> {
  const failures: string[] = [];
  const packages: CargoPackage[] = [];
  const rootText = await readContained(root, manifestPath);
  if (rootText === null) return { packages, failures: [`${manifestPath} could not be read`] };
  const rootFacts = parseCargoManifest(rootText);
  if (rootFacts === null) return { packages, failures: [`${manifestPath} is not valid TOML`] };

  const slash = manifestPath.lastIndexOf("/");
  const rootDirectory = slash === -1 ? "" : manifestPath.slice(0, slash);
  const under = (member: string): string =>
    rootDirectory === "" ? member : `${rootDirectory}/${member}`;

  if (rootFacts.packageName !== null) {
    packages.push({
      name: rootFacts.packageName,
      manifest: manifestPath,
      bins: await binsOf(root, rootDirectory, rootFacts),
    });
  }

  const directories: string[] = [];
  for (const member of rootFacts.members) {
    const clean = member.replace(/\/+$/, "");
    if (!isContainedPath(clean)) {
      failures.push(`${manifestPath}: workspace member ${member} leaves the repository`);
    } else if (clean.endsWith("/*") && !/[*?[\]{}]/.test(clean.slice(0, -2))) {
      const parent = clean.slice(0, -2);
      for (const entry of await entriesOf(join(root, under(parent)))) {
        // As cargo does: a directory a glob matches that holds no manifest is no member.
        const candidate = `${parent}/${entry.name}`;
        if (entry.directory && (await isFile(join(root, under(candidate), "Cargo.toml")))) {
          directories.push(candidate);
        }
      }
    } else if (/[*?[\]{}]/.test(clean)) {
      failures.push(
        `${manifestPath}: workspace member pattern ${member} is not read (only \`<directory>/*\`)`,
      );
    } else {
      directories.push(clean);
    }
  }

  for (const directory of directories) {
    if (rootFacts.exclude.includes(directory)) continue;
    const path = `${under(directory)}/Cargo.toml`;
    const text = await readContained(root, path);
    const facts = text === null ? null : parseCargoManifest(text);
    if (text === null) failures.push(`${path} could not be read`);
    else if (facts === null) failures.push(`${path} is not valid TOML`);
    else if (facts.packageName === null) failures.push(`${path} declares no package name`);
    else {
      packages.push({
        name: facts.packageName,
        manifest: path,
        bins: await binsOf(root, under(directory), facts),
      });
    }
  }

  if (packages.length === 0 && failures.length === 0) {
    failures.push(`${manifestPath} declares neither a package nor a readable workspace member`);
  }
  return { packages, failures };
}
