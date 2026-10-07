/**
 * Dead-code gate.
 *
 * Fails when code stops being reachable. Three independent checks:
 *
 *   1. UNREACHED FILES     — a TS/TSX source no entry point can reach.
 *   2. UNREFERENCED EXPORTS— an exported value whose name occurs exactly once
 *                            repo-wide (its own declaration) and nowhere else.
 *   3. UNUSED DEPENDENCIES — a manifest dependency no source of that package
 *                            imports.
 *
 * Each check reports how many entries it EXAMINED, and a check that examines
 * zero entries fails: a broken glob or a moved directory must turn this gate
 * red, never silently green.
 *
 * Deliberately NOT reported as dead, because they are reached by mechanisms a
 * module graph cannot see:
 *   - a package's public entry points (`exports`/`main`/`bin`) and everything
 *     they re-export: a published surface needs no internal consumer;
 *   - test/spec files, discovered by the bun and Playwright harnesses;
 *   - build entry points, worker URLs and config string paths, which name
 *     their target as a string rather than importing it;
 *   - `react`/`react-dom` in a package holding .tsx, required by the automatic
 *     JSX runtime and by React's single-instance rule without any import;
 *   - `@types/*` packages selected through the root tsconfig `types` array.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const tracked = execSync("git ls-files", { encoding: "utf8", cwd: ROOT, maxBuffer: 1 << 28 })
  .split("\n")
  .filter(Boolean);
const trackedSet = new Set(tracked);

const isSource = (p: string) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".d.ts");
const isHarness = (p: string) => /\.(test|e2e|playwright)\.tsx?$/.test(p);
const sourceFiles = tracked.filter(isSource);

const text = new Map<string, string>();
function read(path: string): string {
  let value = text.get(path);
  if (value === undefined) {
    try {
      value = readFileSync(join(ROOT, path), "utf8");
    } catch {
      value = "";
    }
    text.set(path, value);
  }
  return value;
}

const manifests = tracked.filter((p) => p.endsWith("package.json"));
interface Workspace {
  readonly dir: string;
  // biome-ignore lint/suspicious/noExplicitAny: manifest shape is validated elsewhere.
  readonly json: any;
}
const packages = new Map<string, Workspace>();
for (const path of manifests) {
  try {
    const json = JSON.parse(read(path));
    if (json.name) packages.set(json.name, { dir: dirname(path), json });
  } catch {
    // A malformed manifest is the manifest gate's business, not this one's.
  }
}

const SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const repoPath = (p: string) => relative(ROOT, resolve(ROOT, p)).split("\\").join("/");

function resolveModule(base: string): string | null {
  for (const suffix of SUFFIXES) {
    const candidate = base + suffix;
    if (trackedSet.has(candidate) && isSource(candidate)) return candidate;
  }
  // An ESM specifier or a worker URL may name the built ".js" of a ".ts" source.
  if (base.endsWith(".js")) {
    for (const alt of [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]) {
      if (trackedSet.has(alt)) return alt;
    }
  }
  return null;
}

function resolveSpecifier(specifier: string, from: string): string | null {
  if (specifier.startsWith(".")) return resolveModule(repoPath(join(dirname(from), specifier)));
  for (const [name, workspace] of packages) {
    if (specifier !== name && !specifier.startsWith(`${name}/`)) continue;
    const sub = specifier === name ? "." : `.${specifier.slice(name.length)}`;
    const entry = workspace.json.exports;
    if (typeof entry === "string" && sub === ".") {
      return resolveModule(repoPath(join(workspace.dir, entry)));
    }
    if (entry && typeof entry === "object") {
      const target = entry[sub];
      const file = typeof target === "string" ? target : (target?.import ?? target?.default);
      if (typeof file === "string") return resolveModule(repoPath(join(workspace.dir, file)));
    }
    if (sub !== ".") return resolveModule(repoPath(join(workspace.dir, sub)));
    return null;
  }
  return null; // external package or node: builtin
}

const SPECIFIER_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function importsOf(file: string): string[] {
  const source = read(file);
  const found = new Set<string>();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) found.add(match[1] as string);
  }
  return [...found];
}

// ---------------------------------------------------------------- entry points
const entryPoints = new Set<string>();

for (const file of sourceFiles) {
  // Harness-discovered: bun test, Playwright testMatch, and config modules that
  // a runner loads by path rather than by import.
  if (isHarness(file) || /\.config\.tsx?$/.test(file)) entryPoints.add(file);
}

// Declared public surface of every workspace package.
for (const workspace of packages.values()) {
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      const target = resolveModule(repoPath(join(workspace.dir, value)));
      if (target) entryPoints.add(target);
    } else if (value && typeof value === "object") {
      for (const nested of Object.values(value)) collect(nested);
    }
  };
  collect(workspace.json.exports);
  collect(workspace.json.main);
  collect(workspace.json.module);
  collect(workspace.json.bin);
}

// A string path in a script is written relative to the repository root, to the
// file itself, or to its package root (`resolve(import.meta.dir, "..")` is the
// usual build-script idiom), so every ancestor is a candidate base.
function resolveNamedPath(raw: string, host: string): string | null {
  const direct = resolveModule(repoPath(raw));
  if (direct) return direct;
  let base = dirname(host);
  while (true) {
    const target = resolveModule(repoPath(join(base, raw)));
    if (target) return target;
    if (base === "." || base === "" || base === "/") return null;
    base = dirname(base);
  }
}

// Any source named as a string: package scripts, workflows, HTML, Playwright
// `globalSetup`/`webServer`, `Bun.build` entry points, `new Worker(new URL(...))`.
const REFERENCING_HOSTS = tracked.filter((p) =>
  /\.(json|ya?ml|html|toml|sh|mjs|js|ts|tsx)$/.test(p),
);
const PATH_LIKE = /(?:^|[\s"'`(=,:])((?:\.{0,2}\/)?[\w.@/-]+\.tsx?)(?=$|[\s"'`),;:])/g;
for (const host of REFERENCING_HOSTS) {
  for (const match of read(host).matchAll(PATH_LIKE)) {
    const target = resolveNamedPath(match[1] as string, host);
    if (target) entryPoints.add(target);
  }
}

// A source documented as a runnable command is an entry point: operators invoke
// it by that exact line. This is narrower than "any filename appearing in
// prose" — a stale mention of a name keeps nothing alive, an executable
// invocation does. Documentation counts here, and only here.
const COMMAND_INVOCATION =
  /\b(?:bun|bunx|node|deno)\s+(?:run\s+)?(?:--?[\w=-]+\s+)*([\w.@/-]+\.tsx?)\b/g;
for (const host of tracked) {
  if (/\.(png|jpg|jpeg|gif|svg|ico|wasm|zip|pdf|woff2?)$/.test(host)) continue;
  for (const match of read(host).matchAll(COMMAND_INVOCATION)) {
    const target = resolveNamedPath(match[1] as string, host);
    if (target) entryPoints.add(target);
  }
}

// ------------------------------------------------------- 1. unreached sources
const reached = new Set<string>();
const pending = [...entryPoints];
while (pending.length > 0) {
  const file = pending.pop() as string;
  if (reached.has(file)) continue;
  reached.add(file);
  for (const specifier of importsOf(file)) {
    if (specifier.startsWith("node:") || specifier.startsWith("bun:")) continue;
    const target = resolveSpecifier(specifier, file);
    if (target && !reached.has(target)) pending.push(target);
  }
}
const unreachedFiles = sourceFiles.filter((file) => !reached.has(file)).sort();

// --------------------------------------------- 2. exported but never referenced
// Public surface = package entry points plus their transitive re-export closure.
const publicSurface = new Set<string>();
const surfaceQueue: string[] = [];
for (const workspace of packages.values()) {
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      const target = resolveModule(repoPath(join(workspace.dir, value)));
      if (target) surfaceQueue.push(target);
    } else if (value && typeof value === "object") {
      for (const nested of Object.values(value)) collect(nested);
    }
  };
  collect(workspace.json.exports);
  collect(workspace.json.main);
  collect(workspace.json.bin);
}
while (surfaceQueue.length > 0) {
  const file = surfaceQueue.pop() as string;
  if (publicSurface.has(file)) continue;
  publicSurface.add(file);
  const reexport = /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;
  for (const match of read(file).matchAll(reexport)) {
    const target = resolveSpecifier(match[1] as string, file);
    if (target) surfaceQueue.push(target);
  }
}

// A name mentioned in a runtime config or template may be invoked reflectively,
// so those files count as references. Prose (.md) deliberately does not.
const referenceCorpus = tracked
  .filter((p) => /\.(ts|tsx|json|ya?ml|html)$/.test(p))
  .map((p) => read(p))
  .join("\n");

const VALUE_DECLARATION =
  /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|enum)\s+([A-Za-z_$][\w$]*)/g;

interface DeadSymbol {
  readonly file: string;
  readonly name: string;
}
const unreferencedExports: DeadSymbol[] = [];
let examinedExports = 0;
for (const file of sourceFiles) {
  if (isHarness(file) || publicSurface.has(file)) continue;
  for (const match of read(file).matchAll(VALUE_DECLARATION)) {
    const name = match[1] as string;
    examinedExports++;
    const occurrences = referenceCorpus.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
    // Exactly one occurrence repo-wide is the declaration itself: nothing, not
    // even its own module, ever names it again.
    if (occurrences <= 1) unreferencedExports.push({ file, name });
  }
}

// ------------------------------------------------ 3. declared but unused deps
const unusedDependencies: string[] = [];
let examinedDependencies = 0;
const rootTypes: string[] = (() => {
  try {
    const raw = read("tsconfig.json").replace(/\/\*[\s\S]*?\*\//g, "");
    return JSON.parse(raw).compilerOptions?.types ?? [];
  } catch {
    return [];
  }
})();

for (const manifestPath of manifests) {
  let json: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  try {
    json = JSON.parse(read(manifestPath));
  } catch {
    continue;
  }
  const dir = dirname(manifestPath) === "." ? "" : `${dirname(manifestPath)}/`;
  const nested = manifests
    .filter((other) => other !== manifestPath && `${dirname(other)}/`.startsWith(dir))
    .map((other) => `${dirname(other)}/`);
  const owned = tracked.filter(
    (file) =>
      file.startsWith(dir) && isSource(file) && !nested.some((prefix) => file.startsWith(prefix)),
  );
  // The root manifest's tooling is invoked from anywhere in the repository.
  const scope = manifestPath === "package.json" ? sourceFiles : owned;
  const corpus = scope.map(read).join("\n");
  const scripts = JSON.stringify(json.scripts ?? {});
  const hasJsx = owned.some((file) => file.endsWith(".tsx"));

  for (const field of ["dependencies", "devDependencies"] as const) {
    for (const dependency of Object.keys(json[field] ?? {})) {
      examinedDependencies++;
      if (dependency === "react" || dependency === "react-dom") {
        if (hasJsx) continue; // automatic JSX runtime + single React instance
      }
      if (dependency.startsWith("@types/")) {
        if (rootTypes.includes(dependency.slice("@types/".length))) continue;
      }
      // The compiler is consumed as the `tsc` binary and by editor tooling; it
      // has no import surface to find.
      if (dependency === "typescript") continue;
      const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const imported = new RegExp(`["']${escaped}(/[^"']*)?["']`).test(corpus);
      const inScripts = new RegExp(`\\b${escaped.split("/").pop()}\\b`).test(scripts);
      if (!imported && !inScripts) unusedDependencies.push(`${manifestPath}: ${dependency}`);
    }
  }
}

// ------------------------------------------------------------------- verdict
const checks = [
  { label: "source files reachable from an entry point", examined: sourceFiles.length },
  { label: "exported values", examined: examinedExports },
  { label: "declared dependencies", examined: examinedDependencies },
];

console.log("Dead-code gate");
console.log(`  entry points discovered: ${entryPoints.size}`);
for (const check of checks) console.log(`  examined ${check.examined} ${check.label}`);

const { concludeGate, GateReport } = await import("./gate-report");
const report = new GateReport();
for (const check of checks) {
  // The local anti-empty rule this file already carried, now uniform: an
  // examination of zero inputs is a red check, not a silent pass.
  report.check(
    check.label,
    check.examined > 0,
    check.examined > 0
      ? `examined ${check.examined} ${check.label}`
      : `examined 0 ${check.label} — the gate lost its inputs and cannot prove anything`,
  );
}
for (const file of unreachedFiles) {
  report.check(file, false, "unreached source, no entry point can import it");
}
for (const { file, name } of unreferencedExports) {
  report.check(`${file} -> ${name}`, false, "exported but never referenced anywhere");
}
for (const entry of unusedDependencies) {
  report.check(entry, false, "declared but never imported");
}
concludeGate("Dead code", report);
