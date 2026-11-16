/**
 * Import-boundary gate.
 *
 * Reads the .ts and .tsx sources of every first-level package of `packages/`
 * (its `src/` folder, outside `node_modules` and `.git`) and holds each import
 * specifier — static import, `from` (imports and re-exports), dynamic
 * `import(...)`, `require(...)` — to three rules:
 *
 *   1. An internal specifier (`@libre-ai/...`) names a dependency the package
 *      declares (`dependencies`, `peerDependencies` or `devDependencies`). The
 *      package is its first two segments, so a sub-path resolves to its
 *      package. A package importing itself is not in violation.
 *   2. No specifier names a PRODUCT package or a sub-path of one, declared or
 *      not. Products live in their own repositories and are reached by package
 *      name, so the products are a list of package names, in data.
 *   3. A per-package table of forbidden modules, in data, refuses a module and
 *      its sub-paths even when the package declares it.
 *
 * The forbidden lists win over the declarations: rules 2 and 3 are checked
 * first, and an import receives one verdict.
 *
 * FAIL CLOSED ON THE MANIFEST. A missing, unparsable or nameless `package.json`
 * is a violation of its own and declares nothing, so every internal import of
 * that package becomes a violation too. A missing source folder is not an
 * error: the package holds zero files, and the success line says how many files
 * it read. A source folder that exists but cannot be listed also holds zero
 * files, without failing, as the brief wants; it is counted apart and printed,
 * so it never reads as absent.
 *
 * FAIL CLOSED ON THE TABLE. A forbidden-module list whose key names no package
 * examined (a misspelt key, a renamed package) is a violation: it refuses
 * nothing, and staying green over it would open the refusal in silence. The
 * success line prints how many lists bound a package.
 *
 * DECLARED, NOT PINNED. Rule 1 reads the names a manifest declares, not the
 * version it declares them at: `"*"` satisfies it. Which forms pin an internal
 * dependency (exact version, git revision, workspace protocol) is a fleet
 * contract no gate of this repository holds today; this gate does not decide it.
 *
 * WHAT THIS READER CANNOT SEE. Comments are blanked out before reading,
 * wherever they open on a line, and string literals are stepped over so that a
 * `/*` or `//` inside one opens nothing. Still out of reach by construction:
 *   - a specifier written on another line than its keyword;
 *   - a dynamic import built from a variable or from a template literal with a
 *     substitution (a template literal without one is read);
 *   - a regular-expression literal holding an unbalanced quote blinds the rest
 *     of its line.
 * And one false positive: text shaped like `from "@scope/x"` inside a string
 * literal is read as an import.
 *
 * THE PACKAGE IS NAMED BY ITS MANIFEST, not by its directory, so a directory
 * renamed without its manifest does not change what "itself" means. A symbolic
 * link under a source folder is not followed: it is counted and printed.
 */

import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The table of products and forbidden modules, relative to the root examined. */
export const TABLE_PATH = "tools/quality/import-boundaries.v1.json";

const PACKAGES_DIR = "packages";
const SOURCE_DIR = "src";
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);
const INTERNAL_SCOPE = "@libre-ai/";
const DECLARING_FIELDS = ["dependencies", "peerDependencies", "devDependencies"] as const;

// One alternation per form: `from "x"`, `import "x"`, `import("x")`, `require("x")`.
// The quote may be a backquote: a template literal without substitution is a
// plain specifier. The second `\s*` of the import branch exists only behind a
// parenthesis actually read: `\s*\(?\s*` splits a run of blanks between two
// quantifiers and backtracks quadratically (80 000 spaces took 19 s).
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)(["'`])([^"'`\n]+)\1/g;

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface PackageInput {
  /** Repository-relative directory of the package. */
  readonly dir: string;
  /** Text of its `package.json`, or null when it could not be read. */
  readonly manifest: string | null;
  readonly files: readonly SourceFile[];
}

export interface BoundaryTable {
  readonly products: readonly string[];
  /**
   * Package name → forbidden modules. A Map, not an object: the keys come from
   * data, and `constructor` or `__proto__` must stay keys, not prototype members.
   */
  readonly forbidden: ReadonlyMap<string, readonly string[]>;
}

export interface BoundaryViolation {
  readonly package: string;
  readonly file: string;
  readonly line: number;
  readonly target: string;
  readonly reason: string;
}

export interface BoundaryCounters {
  readonly packages: number;
  readonly files: number;
  readonly imports: number;
  readonly internalImports: number;
  /** Lists of the table whose key names a package examined: the ones that refused anything. */
  readonly boundForbiddenLists: number;
}

export interface BoundaryResult {
  readonly violations: readonly BoundaryViolation[];
  readonly counters: BoundaryCounters;
}

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) => typeof entry === "string" && entry.trim() !== "" && entry === entry.trim(),
    )
  );
}

/** Parse and validate the table; any departure from its shape throws. */
export function parseBoundaryTable(text: string): BoundaryTable {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${TABLE_PATH}: the table is not an object`);
  }
  const record = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (key) => !["because", "products", "forbidden"].includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new Error(`${TABLE_PATH}: unknown key(s) ${unknownKeys.join(", ")}`);
  }
  if (typeof record.because !== "string" || record.because.trim() === "") {
    throw new Error(`${TABLE_PATH}: "because" must say why the table holds what it holds`);
  }
  if (!isStringList(record.products)) {
    throw new Error(`${TABLE_PATH}: "products" must be a list of non-empty package names`);
  }
  const forbiddenRaw = record.forbidden;
  if (typeof forbiddenRaw !== "object" || forbiddenRaw === null || Array.isArray(forbiddenRaw)) {
    throw new Error(`${TABLE_PATH}: "forbidden" must map a package name to a list of modules`);
  }
  const forbidden = new Map<string, readonly string[]>();
  for (const [name, modules] of Object.entries(forbiddenRaw)) {
    if (name.trim() === "" || name !== name.trim()) {
      throw new Error(`${TABLE_PATH}: "forbidden" has a key that is not a package name`);
    }
    if (!isStringList(modules)) {
      throw new Error(`${TABLE_PATH}: "forbidden.${name}" must be a list of non-empty modules`);
    }
    forbidden.set(name, modules);
  }
  return { products: record.products, forbidden };
}

interface Manifest {
  readonly name: string;
  readonly declared: ReadonlySet<string>;
}

/**
 * Null when the manifest is absent, unparsable, nameless or holds a malformed
 * field. A nameless manifest is unreadable for this gate: the table of
 * forbidden modules binds packages by name, so a package without one would
 * escape its refusals in silence.
 */
function readManifest(text: string | null): Manifest | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const name = record.name;
  if (typeof name !== "string" || name.trim() === "") return null;
  const declared = new Set<string>();
  for (const field of DECLARING_FIELDS) {
    const entries = record[field];
    if (entries === undefined) continue;
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) return null;
    for (const name of Object.keys(entries)) declared.add(name);
  }
  return { name, declared };
}

function matchesModule(specifier: string, module: string): boolean {
  return specifier === module || specifier.startsWith(`${module}/`);
}

/** `@libre-ai/x/y/z` → `@libre-ai/x`. */
function internalPackageOf(specifier: string): string {
  return specifier.split("/").slice(0, 2).join("/");
}

type LexState = "code" | "line-comment" | "block-comment" | "'" | '"' | "`";

/**
 * The source with every comment replaced by spaces, line breaks kept so that
 * line numbers hold. String and template literals are stepped over, so `"/*"`
 * or `"http://x"` opens no comment; a backslash in code escapes the next
 * character, so the literal `/a\/*b/` opens none either. A quoted string ends at its line
 * break at the latest: an unbalanced quote blinds the rest of its line, never
 * the rest of the file.
 */
function blankComments(content: string): string {
  const out: string[] = [];
  let state: LexState = "code";
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index] ?? "";
    const next = content[index + 1] ?? "";
    switch (state) {
      case "code":
        if (char === "/" && next === "/") {
          state = "line-comment";
          out.push("  ");
          index += 1;
        } else if (char === "/" && next === "*") {
          state = "block-comment";
          out.push("  ");
          index += 1;
        } else if (char === "\\") {
          out.push(char, next);
          index += 1;
        } else {
          if (char === "'" || char === '"' || char === "`") state = char;
          out.push(char);
        }
        break;
      case "line-comment":
        if (char === "\n") state = "code";
        out.push(char === "\n" ? "\n" : " ");
        break;
      case "block-comment":
        if (char === "*" && next === "/") {
          state = "code";
          out.push("  ");
          index += 1;
        } else {
          out.push(char === "\n" ? "\n" : " ");
        }
        break;
      default:
        // Inside a literal whose opening quote is `state`.
        if (char === "\\" && next !== "\n") {
          out.push(char, next);
          index += 1;
        } else {
          if (char === state || (char === "\n" && state !== "`")) state = "code";
          out.push(char);
        }
    }
  }
  return out.join("");
}

/** Each import specifier of a source, with its 1-based line, comments blanked out. */
function specifiersOf(content: string): { line: number; specifier: string }[] {
  const found: { line: number; specifier: string }[] = [];
  const lines = blankComments(content).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of (lines[index] ?? "").matchAll(SPECIFIER)) {
      const [, quote, specifier] = match;
      if (specifier === undefined) continue;
      // A substitution makes the specifier a runtime value this reader cannot know.
      if (quote === "`" && specifier.includes("${")) continue;
      found.push({ line: index + 1, specifier });
    }
  }
  return found;
}

/** Pure: hold every package of the workspace to the three rules. */
export function checkImportBoundaries(
  packages: readonly PackageInput[],
  table: BoundaryTable,
): BoundaryResult {
  const violations: BoundaryViolation[] = [];
  let files = 0;
  let imports = 0;
  let internalImports = 0;
  const examinedNames = new Set<string>();

  for (const entry of packages) {
    const manifest = readManifest(entry.manifest);
    if (manifest !== null) examinedNames.add(manifest.name);
    const name = manifest?.name ?? entry.dir;
    if (manifest === null) {
      violations.push({
        package: name,
        file: `${entry.dir}/package.json`,
        line: 0,
        target: "package.json",
        reason:
          "manifest missing or unreadable: it declares nothing, so every internal import of " +
          "this package is undeclared",
      });
    }
    const declared = manifest?.declared ?? new Set<string>();
    const forbidden = manifest === null ? [] : (table.forbidden.get(manifest.name) ?? []);

    for (const file of entry.files) {
      files += 1;
      for (const { line, specifier } of specifiersOf(file.content)) {
        imports += 1;
        const internal = specifier.startsWith(INTERNAL_SCOPE);
        if (internal) internalImports += 1;
        if (manifest !== null && matchesModule(specifier, manifest.name)) continue;

        const at = { package: name, file: file.path, line, target: specifier };
        const product = table.products.find((module) => matchesModule(specifier, module));
        if (product !== undefined) {
          violations.push({ ...at, reason: `targets the product package ${product}` });
          continue;
        }
        const refused = forbidden.find((module) => matchesModule(specifier, module));
        if (refused !== undefined) {
          violations.push({
            ...at,
            reason: `${refused} is forbidden for this package by ${TABLE_PATH}, declared or not`,
          });
          continue;
        }
        if (internal && !declared.has(internalPackageOf(specifier))) {
          violations.push({
            ...at,
            reason:
              `${internalPackageOf(specifier)} is not declared in dependencies, ` +
              "peerDependencies or devDependencies",
          });
        }
      }
    }
  }

  // A key that names no package examined refuses nothing: the package it meant
  // was renamed, lost its manifest, or the key is misspelt. The refusal it was
  // written for is open, so the key itself is the violation.
  let boundForbiddenLists = 0;
  for (const key of table.forbidden.keys()) {
    if (examinedNames.has(key)) {
      boundForbiddenLists += 1;
      continue;
    }
    violations.push({
      package: key,
      file: TABLE_PATH,
      line: 0,
      target: key,
      reason:
        "this forbidden-module list names no package of this workspace, so it refuses nothing",
    });
  }

  return {
    violations,
    counters: { packages: packages.length, files, imports, internalImports, boundForbiddenLists },
  };
}

export interface Workspace {
  readonly packages: readonly PackageInput[];
  readonly linksSkipped: number;
  /**
   * Directories that exist but could not be listed. They hold zero files, as
   * the brief wants, and are named here so that they never look absent.
   */
  readonly unreadableDirectories: readonly string[];
}

const ABSENT_CODES = new Set(["ENOENT", "ENOTDIR"]);

/**
 * Read the first-level packages under `<root>/packages`. Only directory entries
 * are walked, links are never followed, so no path read leaves the root.
 */
export function readWorkspace(root: string): Workspace {
  let linksSkipped = 0;
  const unreadableDirectories: string[] = [];
  const packages: PackageInput[] = [];

  /** The sorted entries of a directory; [] when absent, [] and recorded when unreadable. */
  function readDirectory(relative: string): Dirent[] {
    try {
      return readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === undefined || !ABSENT_CODES.has(code)) unreadableDirectories.push(relative);
      return [];
    }
  }

  function collect(relative: string, into: SourceFile[]): void {
    for (const entry of readDirectory(relative)) {
      const path = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        linksSkipped += 1;
      } else if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) collect(path, into);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        into.push({ path, content: readFileSync(join(root, path), "utf8") });
      }
    }
  }

  for (const entry of readDirectory(PACKAGES_DIR)) {
    if (entry.isSymbolicLink()) {
      linksSkipped += 1;
      continue;
    }
    if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const dir = `${PACKAGES_DIR}/${entry.name}`;
    let manifest: string | null;
    try {
      manifest = readFileSync(join(root, dir, "package.json"), "utf8");
    } catch {
      manifest = null;
    }
    const files: SourceFile[] = [];
    const source = readDirectory(dir).find((child) => child.name === SOURCE_DIR);
    if (source?.isSymbolicLink()) linksSkipped += 1;
    else if (source?.isDirectory()) collect(`${dir}/${SOURCE_DIR}`, files);
    packages.push({ dir, manifest, files });
  }
  return { packages, linksSkipped, unreadableDirectories };
}

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("./gate-report");
  const root = process.cwd();
  const report = new GateReport();
  let table: BoundaryTable | null = null;
  try {
    table = parseBoundaryTable(readFileSync(join(root, TABLE_PATH), "utf8"));
  } catch (error) {
    report.check(TABLE_PATH, false, error instanceof Error ? error.message : String(error));
  }
  if (table !== null) {
    const workspace = readWorkspace(root);
    const result = checkImportBoundaries(workspace.packages, table);
    for (const violation of result.violations) {
      report.check(
        `${violation.package} ${violation.file}:${violation.line} -> ${violation.target}`,
        false,
        violation.reason,
      );
    }
    for (const entry of workspace.packages) {
      if (!result.violations.some((violation) => violation.file.startsWith(`${entry.dir}/`))) {
        const unreadable = workspace.unreadableDirectories.filter((path) =>
          path.startsWith(`${entry.dir}/`),
        );
        const note =
          unreadable.length === 0 ? "" : ` (unreadable, read as empty: ${unreadable.join(", ")})`;
        report.check(
          entry.dir,
          true,
          `${entry.files.length} source file(s) within boundaries${note}`,
        );
      }
    }
    const { packages, files, imports, internalImports, boundForbiddenLists } = result.counters;
    report.volume(
      `${packages} package(s), ${files} file(s), ${imports} import(s) of which ` +
        `${internalImports} internal import(s), ${workspace.linksSkipped} link(s) not followed, ` +
        `${workspace.unreadableDirectories.length} unreadable directory(ies) read as empty, ` +
        `${table.products.length} product package(s) and ` +
        `${table.forbidden.size} forbidden-module list(s) in ${TABLE_PATH}, ` +
        `${boundForbiddenLists} forbidden-module list(s) bound to a package`,
    );
  }
  concludeGate("Import boundaries", report);
}
