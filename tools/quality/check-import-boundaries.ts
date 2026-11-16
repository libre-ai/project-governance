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
 * FAIL CLOSED ON THE MANIFEST. A missing or unparsable `package.json` is a
 * violation of its own and declares nothing, so every internal import of that
 * package becomes a violation too. A missing source folder is not an error: the
 * package holds zero files, and the success line says how many files it read.
 *
 * WHAT A LINE READER CANNOT SEE. A line that opens with `//`, `*` or `/*`, and
 * every line inside a block comment, is skipped. A specifier written on another
 * line than its keyword is not read, and a dynamic import built from a variable
 * is not read: both escape this gate by construction.
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
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"'\n]+)["']/g;

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
  readonly forbidden: Readonly<Record<string, readonly string[]>>;
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
  const forbidden: Record<string, readonly string[]> = {};
  for (const [name, modules] of Object.entries(forbiddenRaw)) {
    if (!isStringList(modules)) {
      throw new Error(`${TABLE_PATH}: "forbidden.${name}" must be a list of non-empty modules`);
    }
    forbidden[name] = modules;
  }
  return { products: record.products, forbidden };
}

interface Manifest {
  readonly name: string | null;
  readonly declared: ReadonlySet<string>;
}

/** Null when the manifest is absent, unparsable or holds a malformed field. */
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
  const declared = new Set<string>();
  for (const field of DECLARING_FIELDS) {
    const entries = record[field];
    if (entries === undefined) continue;
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) return null;
    for (const name of Object.keys(entries)) declared.add(name);
  }
  return { name: typeof record.name === "string" ? record.name : null, declared };
}

function matchesModule(specifier: string, module: string): boolean {
  return specifier === module || specifier.startsWith(`${module}/`);
}

/** `@libre-ai/x/y/z` → `@libre-ai/x`. */
function internalPackageOf(specifier: string): string {
  return specifier.split("/").slice(0, 2).join("/");
}

/** Each import specifier of a source, with its 1-based line, comment lines skipped. */
function specifiersOf(content: string): { line: number; specifier: string }[] {
  const found: { line: number; specifier: string }[] = [];
  let inBlockComment = false;
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? "").trimStart();
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      inBlockComment = !trimmed.includes("*/", 2);
      continue;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    for (const match of trimmed.matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (specifier !== undefined) found.push({ line: index + 1, specifier });
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

  for (const entry of packages) {
    const manifest = readManifest(entry.manifest);
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
    const forbidden = manifest?.name ? (table.forbidden[manifest.name] ?? []) : [];

    for (const file of entry.files) {
      files += 1;
      for (const { line, specifier } of specifiersOf(file.content)) {
        imports += 1;
        const internal = specifier.startsWith(INTERNAL_SCOPE);
        if (internal) internalImports += 1;
        if (manifest?.name && matchesModule(specifier, manifest.name)) continue;

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

  return {
    violations,
    counters: { packages: packages.length, files, imports, internalImports },
  };
}

export interface Workspace {
  readonly packages: readonly PackageInput[];
  readonly linksSkipped: number;
}

function readDirectory(path: string): Dirent[] {
  try {
    return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Read the first-level packages under `<root>/packages`. Only directory entries
 * are walked, links are never followed, so no path read leaves the root.
 */
export function readWorkspace(root: string): Workspace {
  let linksSkipped = 0;
  const packages: PackageInput[] = [];

  function collect(relative: string, into: SourceFile[]): void {
    for (const entry of readDirectory(join(root, relative))) {
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

  for (const entry of readDirectory(join(root, PACKAGES_DIR))) {
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
    const source = readDirectory(join(root, dir)).find((child) => child.name === SOURCE_DIR);
    if (source?.isSymbolicLink()) linksSkipped += 1;
    else if (source?.isDirectory()) collect(`${dir}/${SOURCE_DIR}`, files);
    packages.push({ dir, manifest, files });
  }
  return { packages, linksSkipped };
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
        report.check(entry.dir, true, `${entry.files.length} source file(s) within boundaries`);
      }
    }
    const { packages, files, imports, internalImports } = result.counters;
    report.volume(
      `${packages} package(s), ${files} file(s), ${imports} import(s) of which ` +
        `${internalImports} internal import(s), ${workspace.linksSkipped} link(s) not followed, ` +
        `${table.products.length} product package(s) and ` +
        `${Object.keys(table.forbidden).length} forbidden-module list(s) in ${TABLE_PATH}`,
    );
  }
  concludeGate("Import boundaries", report);
}
