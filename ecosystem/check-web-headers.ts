/**
 * Web security headers and raw HTML sinks across the fleet — I-37, ADR-0049
 * (owner arbitration 2026-10-10). ADR-0049 §3 named the mechanism as missing:
 * "un gate de flotte des en-têtes servis". This is that gate.
 *
 * WHAT IS A WEB SURFACE. The definition is the most verifiable one, read from
 * tracked files only, never from a deployment:
 *
 *   - S1 — a package (the directory of a tracked `package.json`) that declares
 *     `@libre-ai/web-platform` in `dependencies` or `peerDependencies`. That is
 *     runtime use of the response layer; a `devDependencies` or `overrides`
 *     entry at a workspace root is toolchain plumbing and does not count;
 *   - S2 — a package that tracks a `Caddyfile`: a static site whose headers are
 *     set by the web server rather than by code.
 *
 * Every other HTTP server is accounted for too, so the definition cannot shrink
 * in silence: a non-test source outside every surface that starts a server
 * (Bun's `serve`, `createServer`) must be declared in the allowlist under
 * `servers_outside_surfaces` with the reason it serves no application HTML. An
 * undeclared one fails, and so does a declaration whose server is gone.
 *
 * WHAT A SURFACE MUST HOLD.
 *
 *   1. Policy — a non-test source imports `createRequestHandler` or
 *      `secureResponse` from `@libre-ai/web-platform` (S1), or the tracked
 *      `Caddyfile` sets a CSP with the strict base below plus `nosniff` and
 *      `no-referrer` (S2, the "equivalent strict" policy). The policy source
 *      itself, named in the allowlist, is read at HEAD and must carry the strict
 *      base: a weakened `web-platform` would make every S1 surface conformant
 *      by reference.
 *   2. Relaxations — in the non-test sources, HTML documents and Caddyfile of a
 *      surface, every CSP relaxation token (`'unsafe-inline'`, `'unsafe-eval'`,
 *      `'wasm-unsafe-eval'`, `'unsafe-hashes'`) and every string literal naming
 *      the `Content-Security-Policy` header in TS/JS (outside a
 *      `<meta http-equiv>`, which can only add a policy) is a finding.
 *   3. Sinks — in every source of a surface, tests included, each raw HTML or
 *      code sink of I-37 is a finding: `dangerouslySetInnerHTML`, `.innerHTML`,
 *      `.outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`,
 *      `new Function(`.
 *
 * A finding passes only if `ecosystem/web-headers-allowlist.v1.yaml` names it by
 * (repository, path, rule, token) with the EXACT count and the reason it is
 * bounded. A count that moves either way fails; an entry left with no finding
 * fails as stale. That is how "un relâchement nommé, borné et justifié" is
 * enforced: named by its token, bounded by its file and count, justified by
 * `because`.
 *
 * Test files are `*.test.*`, `*.spec.*`, `*.e2e.*` and anything under an
 * `e2e/`, `test/`, `tests/`, `__tests__/` or `fixtures/` directory. They are
 * excluded from rules 1 and 2 (a test that asserts the relaxed CSP is not a
 * relaxation), never from rule 3.
 *
 * Measured, not enforced: how many surfaces carry a test reading the served
 * `Content-Security-Policy` (I-37's third clause). Enforcing it today would turn
 * this required check red on surfaces this repository cannot fix; the count is
 * printed so the adoption is visible.
 *
 * Limits, said out loud: a policy import proves the response layer is wired,
 * not that every response flows through it — that is what the served-CSP test
 * proves; the scan is lexical, so a sink in a comment counts and a sink built
 * by string concatenation does not; libraries a surface imports are not
 * scanned unless they are surfaces themselves.
 *
 * Read at `HEAD` through `fleet-tree.ts` (REST tree + GraphQL `HEAD:` blobs).
 * An unreadable tree, file or manifest fails; it is never counted as "no
 * surface". Network: wired in `inventory-drift.yml`, never in `bun run check`.
 */

import { parseRegistry, type RegistryEntry } from "./check-context-conformance";
import { type BlobRead, exemption, type FleetFileReader, readRepositoryFiles } from "./fleet-tree";

export const ALLOWLIST_PATH = "ecosystem/web-headers-allowlist.v1.yaml";
export const WEB_PLATFORM = "@libre-ai/web-platform";

export const RULES = ["csp-relaxation", "csp-header-literal", "html-sink"] as const;
export type Rule = (typeof RULES)[number];

export const RELAXATION_TOKENS = [
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'wasm-unsafe-eval'",
  "'unsafe-hashes'",
] as const;

/** The sinks I-37 names, each with the lexical pattern that finds it. */
export const SINKS: readonly { readonly token: string; readonly pattern: RegExp }[] = [
  { token: "dangerouslySetInnerHTML", pattern: /\bdangerouslySetInnerHTML\b/g },
  { token: "innerHTML", pattern: /\.innerHTML\b/g },
  { token: "outerHTML", pattern: /\.outerHTML\b/g },
  { token: "insertAdjacentHTML", pattern: /\binsertAdjacentHTML\b/g },
  { token: "document.write", pattern: /\bdocument\s*\.\s*write(?:ln)?\s*\(/g },
  { token: "eval", pattern: /(?<![\w$])eval\s*\(/g },
  { token: "new Function", pattern: /\bnew\s+Function\s*\(/g },
];

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const HTML = /\.html?$/;
const IGNORED_SEGMENT = /(?:^|\/)(?:node_modules|vendored|third_party|dist|target)\//;
const TEST_SEGMENT = /(?:^|\/)(?:e2e|test|tests|__tests__|fixtures)\//;
const TEST_NAME = /\.(?:test|spec|e2e)\.[cm]?[jt]sx?$/;

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export function isTestPath(path: string): boolean {
  return TEST_SEGMENT.test(path) || TEST_NAME.test(path);
}

/** The files this gate reads: sources, HTML documents, manifests and Caddyfiles. */
export function isExamined(path: string): boolean {
  if (IGNORED_SEGMENT.test(path)) return false;
  const name = basename(path);
  return CODE.test(path) || HTML.test(path) || name === "package.json" || name === "Caddyfile";
}

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(new RegExp(pattern.source, "g"))].length;
}

function countLiteral(text: string, literal: string): number {
  return text.split(literal).length - 1;
}

// --- strict base -----------------------------------------------------------

/** Directives as `name → sources`; a repeated directive is reported, never merged. */
export function parseCsp(policy: string): {
  directives: Map<string, string[]>;
  repeated: string[];
} {
  const directives = new Map<string, string[]>();
  const repeated: string[] = [];
  for (const part of policy.split(";")) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    const [name, ...sources] = words;
    if (name === undefined) continue;
    const key = name.toLowerCase();
    if (directives.has(key)) repeated.push(key);
    else directives.set(key, sources);
  }
  return { directives, repeated };
}

/**
 * The CSP base I-37 requires, with no relaxation: `default-src` and
 * `script-src` limited to `'self'` or `'none'`, `object-src`, `base-uri` and
 * `frame-ancestors` set to `'none'`, no relaxation token in any directive.
 */
export function strictBaseViolations(policy: string): string[] {
  const { directives, repeated } = parseCsp(policy);
  const violations = repeated.map((name) => `directive ${name} is repeated`);
  const onlyFrom = (name: string, allowed: readonly string[]) => {
    const sources = directives.get(name);
    if (sources === undefined || sources.length === 0) {
      violations.push(`${name} is missing`);
    } else if (!sources.every((source) => allowed.includes(source))) {
      violations.push(`${name} is \`${sources.join(" ")}\`, expected only ${allowed.join(" or ")}`);
    }
  };
  onlyFrom("default-src", ["'self'", "'none'"]);
  onlyFrom("script-src", ["'self'", "'none'"]);
  onlyFrom("object-src", ["'none'"]);
  onlyFrom("base-uri", ["'none'"]);
  onlyFrom("frame-ancestors", ["'none'"]);
  for (const [name, sources] of directives) {
    for (const token of RELAXATION_TOKENS) {
      if (sources.includes(token)) violations.push(`${name} carries ${token}`);
    }
  }
  return violations;
}

/** The `web-platform` header table: its CSP, nosniff and no-referrer. */
export function reviewPolicySource(text: string): string[] {
  // The value is double-quoted or a template literal: CSP sources carry single quotes.
  const csp = /["']Content-Security-Policy["']\s*:\s*(["`])([^"`]+)\1/.exec(text);
  if (csp?.[2] === undefined) {
    return ["no `Content-Security-Policy` entry found in the policy source"];
  }
  const violations = strictBaseViolations(csp[2]);
  if (!/["']X-Content-Type-Options["']\s*:\s*["']nosniff["']/.test(text)) {
    violations.push("X-Content-Type-Options is not nosniff");
  }
  if (!/["']Referrer-Policy["']\s*:\s*["']no-referrer["']/.test(text)) {
    violations.push("Referrer-Policy is not no-referrer");
  }
  return violations;
}

/** A Caddyfile's `header` block: same three properties as the policy source. */
export function reviewCaddyfile(text: string): string[] {
  const csp = /^\s*Content-Security-Policy\s+"([^"]+)"/m.exec(text);
  if (csp?.[1] === undefined) return ["the Caddyfile sets no Content-Security-Policy header"];
  const violations = strictBaseViolations(csp[1]);
  if (!/^\s*X-Content-Type-Options\s+"nosniff"/m.test(text)) {
    violations.push("the Caddyfile does not set X-Content-Type-Options nosniff");
  }
  if (!/^\s*Referrer-Policy\s+"no-referrer"/m.test(text)) {
    violations.push("the Caddyfile does not set Referrer-Policy no-referrer");
  }
  return violations;
}

// --- allowlist -------------------------------------------------------------

export interface Allowance {
  readonly repository: string;
  readonly path: string;
  readonly rule: Rule;
  readonly token: string;
  readonly count: number;
  readonly because: string;
}

export interface DeclaredServer {
  readonly repository: string;
  readonly path: string;
  readonly because: string;
}

export interface Allowlist {
  readonly policySource: { readonly repository: string; readonly path: string };
  readonly allowances: readonly Allowance[];
  readonly servers: readonly DeclaredServer[];
}

function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${ALLOWLIST_PATH}: ${where}.${key} is required`);
  }
  return value;
}

function requireList(document: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = document[key];
  if (!Array.isArray(value)) throw new Error(`${ALLOWLIST_PATH}: \`${key}\` must be a list`);
  return value as Record<string, unknown>[];
}

/** The allowlist; a malformed entry throws, so the gate never runs on half a register. */
export function parseAllowlist(text: string): Allowlist {
  const document = Bun.YAML.parse(text) as Record<string, unknown> | null;
  if (document === null || typeof document !== "object") {
    throw new Error(`${ALLOWLIST_PATH}: not a mapping`);
  }
  if (document.schema_version !== "libre-ai.web-headers-allowlist.v1") {
    throw new Error(`${ALLOWLIST_PATH}: schema_version must be libre-ai.web-headers-allowlist.v1`);
  }
  const source = document.policy_source as Record<string, unknown> | undefined;
  if (source === undefined || source === null || typeof source !== "object") {
    throw new Error(`${ALLOWLIST_PATH}: policy_source is required`);
  }
  const policySource = {
    repository: requireString(source, "repository", "policy_source"),
    path: requireString(source, "path", "policy_source"),
  };
  const seen = new Set<string>();
  const allowances = requireList(document, "allowances").map((record, index): Allowance => {
    const where = `allowances[${index}]`;
    const rule = requireString(record, "rule", where);
    if (!RULES.includes(rule as Rule)) {
      throw new Error(`${ALLOWLIST_PATH}: ${where}.rule must be one of ${RULES.join(", ")}`);
    }
    if (!Number.isInteger(record.count) || (record.count as number) < 1) {
      throw new Error(`${ALLOWLIST_PATH}: ${where}.count must be a positive integer`);
    }
    const allowance: Allowance = {
      repository: requireString(record, "repository", where),
      path: requireString(record, "path", where),
      rule: rule as Rule,
      token: requireString(record, "token", where),
      count: record.count as number,
      because: requireString(record, "because", where),
    };
    const key = findingKey(allowance.repository, allowance.path, allowance.rule, allowance.token);
    if (seen.has(key)) throw new Error(`${ALLOWLIST_PATH}: ${where} duplicates an earlier entry`);
    seen.add(key);
    return allowance;
  });
  const servers = requireList(document, "servers_outside_surfaces").map(
    (record, index): DeclaredServer => {
      const where = `servers_outside_surfaces[${index}]`;
      return {
        repository: requireString(record, "repository", where),
        path: requireString(record, "path", where),
        because: requireString(record, "because", where),
      };
    },
  );
  return { policySource, allowances, servers };
}

function findingKey(repository: string, path: string, rule: Rule, token: string): string {
  return `${repository}\0${path}\0${rule}\0${token}`;
}

// --- surfaces --------------------------------------------------------------

export type SurfaceKind = "web-platform" | "caddy";

export interface Surface {
  readonly root: string;
  readonly kinds: readonly SurfaceKind[];
}

interface Manifest {
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
}

/** The package that owns a path: the deepest tracked `package.json` above it, else the root. */
export function owningPackage(path: string, packageRoots: readonly string[]): string {
  let best = "";
  for (const root of packageRoots) {
    if (root === "") continue;
    if ((path === root || path.startsWith(`${root}/`)) && root.length > best.length) best = root;
  }
  return best;
}

export interface Finding {
  readonly path: string;
  readonly rule: Rule;
  readonly token: string;
  readonly count: number;
}

/** Rule 2 and rule 3 findings of one file, given whether it is a test. */
export function scanFile(path: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const test = isTestPath(path);
  const code = CODE.test(path);
  if (!test) {
    for (const token of RELAXATION_TOKENS) {
      const n = countLiteral(text, token);
      if (n > 0) findings.push({ path, rule: "csp-relaxation", token, count: n });
    }
    if (code) {
      const n = count(text, /(?<!http-equiv=)["'`]Content-Security-Policy["'`]/i);
      if (n > 0) {
        findings.push({
          path,
          rule: "csp-header-literal",
          token: "Content-Security-Policy",
          count: n,
        });
      }
    }
  }
  if (code || HTML.test(path)) {
    for (const sink of SINKS) {
      const n = count(text, sink.pattern);
      if (n > 0) findings.push({ path, rule: "html-sink", token: sink.token, count: n });
    }
  }
  return findings;
}

const POLICY_IMPORT = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*["']@libre-ai\/web-platform["']/g;

/** Rule 1 for an S1 surface: a non-test source imports the response layer. */
export function importsResponseLayer(text: string): boolean {
  for (const match of text.matchAll(POLICY_IMPORT)) {
    const names = (match[1] ?? "").split(",").map((name) => name.trim().split(/\s+as\s+/)[0]);
    if (names.includes("createRequestHandler") || names.includes("secureResponse")) return true;
  }
  return false;
}

const SERVER_START = [/\bBun\s*\.\s*serve\s*\(/, /\bcreateServer\s*\(/, /\bserve\s*\(\s*\{/];

/** A non-test source that starts an HTTP server. */
export function startsServer(path: string, text: string): boolean {
  if (!CODE.test(path) || isTestPath(path)) return false;
  if (SERVER_START[0]?.test(text) || SERVER_START[1]?.test(text)) return true;
  // A bare `serve({` counts only when `serve` is imported from Bun.
  return (
    /import\s*\{[^}]*\bserve\b[^}]*\}\s*from\s*["']bun["']/.test(text) &&
    (SERVER_START[2]?.test(text) ?? false)
  );
}

// --- verdict ---------------------------------------------------------------

export interface ItemCheck {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

export interface WebTally {
  repositories: number;
  exempt: number;
  filesTracked: number;
  filesExamined: number;
  surfaces: number;
  conformant: number;
  exempted: number;
  violating: number;
  findings: number;
  allowed: number;
  serversOutside: number;
  servedCspTests: number;
}

export function emptyTally(): WebTally {
  return {
    repositories: 0,
    exempt: 0,
    filesTracked: 0,
    filesExamined: 0,
    surfaces: 0,
    conformant: 0,
    exempted: 0,
    violating: 0,
    findings: 0,
    allowed: 0,
    serversOutside: 0,
    servedCspTests: 0,
  };
}

export function summarizeVolume(t: WebTally): string {
  return `${t.repositories + t.exempt} inventory entries (${t.repositories} read, ${t.exempt} exempt): ${t.filesExamined} of ${t.filesTracked} tracked file(s) examined; ${t.surfaces} web surface(s) = ${t.conformant} conformant + ${t.exempted} exempted (allowlisted findings) + ${t.violating} violating; ${t.findings} finding(s), ${t.allowed} allowlisted; ${t.serversOutside} declared server(s) outside surfaces; ${t.servedCspTests} of ${t.surfaces} surface(s) carry a test reading the served CSP (measured, not enforced)`;
}

export async function reviewRepository(
  entry: RegistryEntry,
  allowlist: Allowlist,
  tally: WebTally,
  reader: FleetFileReader = readRepositoryFiles,
): Promise<ItemCheck[]> {
  const exempt = exemption(entry);
  if (exempt !== null) {
    tally.exempt++;
    return [{ item: entry.repository, ok: true, note: `exempt: ${exempt}` }];
  }
  tally.repositories++;
  const repository = entry.repository;
  const { listing, files } = await reader(repository, isExamined);
  if (listing.kind === "unreadable") {
    return [{ item: repository, ok: false, note: `tree unreadable at HEAD: ${listing.reason}` }];
  }
  const examined = listing.paths.filter(isExamined);
  tally.filesTracked += examined.length;

  const checks: ItemCheck[] = [];
  const texts = new Map<string, string>();
  for (const path of examined) {
    const read: BlobRead | undefined = files.get(path);
    if (read === undefined || read.kind === "unreadable") {
      checks.push({
        item: `${repository}:${path}`,
        ok: false,
        note: `unreadable at HEAD: ${read?.reason ?? "no read outcome recorded"}`,
      });
      continue;
    }
    texts.set(path, read.text);
    tally.filesExamined++;
  }
  if (checks.length > 0) return checks;

  // Surfaces, from manifests and Caddyfiles.
  const packageRoots = examined.filter((p) => basename(p) === "package.json").map(dirname);
  const kinds = new Map<string, Set<SurfaceKind>>();
  const addKind = (root: string, kind: SurfaceKind) => {
    const set = kinds.get(root) ?? new Set<SurfaceKind>();
    set.add(kind);
    kinds.set(root, set);
  };
  for (const path of examined) {
    const text = texts.get(path) ?? "";
    if (basename(path) === "package.json") {
      let manifest: Manifest;
      try {
        manifest = JSON.parse(text) as Manifest;
      } catch {
        checks.push({ item: `${repository}:${path}`, ok: false, note: "package.json is not JSON" });
        continue;
      }
      if (
        Object.hasOwn(manifest.dependencies ?? {}, WEB_PLATFORM) ||
        Object.hasOwn(manifest.peerDependencies ?? {}, WEB_PLATFORM)
      ) {
        addKind(dirname(path), "web-platform");
      }
    } else if (basename(path) === "Caddyfile") {
      addKind(owningPackage(path, packageRoots), "caddy");
    }
  }
  if (checks.length > 0) return checks;

  const surfaceRoots = new Set(kinds.keys());
  const findings: Finding[] = [];
  const surfacePaths = new Map<string, string[]>();
  for (const path of examined) {
    const root = owningPackage(path, packageRoots);
    if (!surfaceRoots.has(root)) continue;
    const list = surfacePaths.get(root) ?? [];
    list.push(path);
    surfacePaths.set(root, list);
  }

  // Rule 1 per surface, and rules 2-3 collected for the allowlist judgement.
  const surfaceVerdicts = new Map<string, { policy: string[]; findingCount: number }>();
  for (const [root, surfaceKinds] of kinds) {
    tally.surfaces++;
    const paths = surfacePaths.get(root) ?? [];
    const policy: string[] = [];
    let wired = false;
    if (surfaceKinds.has("web-platform")) {
      wired = paths.some(
        (p) => CODE.test(p) && !isTestPath(p) && importsResponseLayer(texts.get(p) ?? ""),
      );
      if (!wired && !surfaceKinds.has("caddy")) {
        policy.push(
          `declares ${WEB_PLATFORM} but no non-test source imports createRequestHandler or secureResponse from it`,
        );
      }
    }
    if (surfaceKinds.has("caddy")) {
      for (const p of paths.filter((x) => basename(x) === "Caddyfile")) {
        for (const v of reviewCaddyfile(texts.get(p) ?? "")) policy.push(`${p}: ${v}`);
      }
    }
    let surfaceFindings = 0;
    for (const p of paths) {
      const found = scanFile(p, texts.get(p) ?? "");
      surfaceFindings += found.length;
      findings.push(...found);
    }
    if (paths.some((p) => isTestPath(p) && /content-security-policy/i.test(texts.get(p) ?? ""))) {
      tally.servedCspTests++;
    }
    surfaceVerdicts.set(root, { policy, findingCount: surfaceFindings });
  }

  // Allowlist judgement over the findings.
  const own = allowlist.allowances.filter((a) => a.repository === repository);
  const failedRoots = new Set<string>();
  const matched = new Set<string>();
  for (const finding of findings) {
    tally.findings += finding.count;
    const key = findingKey(repository, finding.path, finding.rule, finding.token);
    const allowance = own.find((a) => findingKey(a.repository, a.path, a.rule, a.token) === key);
    const item = `${repository}:${finding.path}`;
    const root = owningPackage(finding.path, packageRoots);
    if (allowance === undefined) {
      failedRoots.add(root);
      checks.push({
        item,
        ok: false,
        note: `${finding.rule} ${finding.token} ×${finding.count} — serve through ${WEB_PLATFORM} without it, or record it in ${ALLOWLIST_PATH} with its bound and reason`,
      });
    } else if (allowance.count !== finding.count) {
      matched.add(key);
      failedRoots.add(root);
      checks.push({
        item,
        ok: false,
        note: `${finding.rule} ${finding.token}: the allowlist reviewed ${allowance.count}, the file now has ${finding.count} — review the change and update the count`,
      });
    } else {
      matched.add(key);
      tally.allowed += finding.count;
      checks.push({
        item,
        ok: true,
        note: `${finding.rule} ${finding.token} ×${finding.count} allowlisted — ${allowance.because}`,
      });
    }
  }
  for (const allowance of own) {
    const key = findingKey(allowance.repository, allowance.path, allowance.rule, allowance.token);
    if (!matched.has(key)) {
      checks.push({
        item: `${repository}:${allowance.path}`,
        ok: false,
        note: `stale allowance: ${allowance.rule} ${allowance.token} has no finding left in a surface file — remove it from ${ALLOWLIST_PATH}`,
      });
    }
  }

  for (const [root, verdict] of surfaceVerdicts) {
    const item = `${repository}:${root === "" ? "." : root}`;
    const kindsText = [...(kinds.get(root) ?? [])].join("+");
    if (verdict.policy.length > 0) {
      tally.violating++;
      checks.push({
        item,
        ok: false,
        note: `web surface (${kindsText}): ${verdict.policy.join("; ")}`,
      });
    } else if (failedRoots.has(root)) {
      tally.violating++;
    } else if (verdict.findingCount > 0) {
      tally.exempted++;
      checks.push({
        item,
        ok: true,
        note: `web surface (${kindsText}): strict policy, ${verdict.findingCount} allowlisted finding kind(s)`,
      });
    } else {
      tally.conformant++;
      checks.push({
        item,
        ok: true,
        note: `web surface (${kindsText}): strict policy, no finding`,
      });
    }
  }

  // Servers outside every surface must be declared, and declarations must be live.
  const declared = allowlist.servers.filter((s) => s.repository === repository);
  const seenServers = new Set<string>();
  for (const path of examined) {
    if (surfaceRoots.has(owningPackage(path, packageRoots))) continue;
    if (!startsServer(path, texts.get(path) ?? "")) continue;
    seenServers.add(path);
    const declaration = declared.find((s) => s.path === path);
    if (declaration === undefined) {
      checks.push({
        item: `${repository}:${path}`,
        ok: false,
        note: `starts an HTTP server outside every web surface — serve HTML through ${WEB_PLATFORM}, or declare it under servers_outside_surfaces in ${ALLOWLIST_PATH} with why it serves no application HTML`,
      });
    } else {
      tally.serversOutside++;
      checks.push({
        item: `${repository}:${path}`,
        ok: true,
        note: `declared server outside surfaces — ${declaration.because}`,
      });
    }
  }
  for (const declaration of declared) {
    if (!seenServers.has(declaration.path)) {
      checks.push({
        item: `${repository}:${declaration.path}`,
        ok: false,
        note: `stale declaration: no server starts in this file outside a web surface — remove it from servers_outside_surfaces`,
      });
    }
  }

  if (checks.length === 0) {
    checks.push({
      item: repository,
      ok: true,
      note: `${examined.length} file(s) examined, no web surface and no HTTP server`,
    });
  }
  return checks;
}

/** The policy source at HEAD must carry the strict base itself. */
export async function reviewPolicy(
  allowlist: Allowlist,
  reader: FleetFileReader = readRepositoryFiles,
): Promise<ItemCheck> {
  const { repository, path } = allowlist.policySource;
  const item = `${repository}:${path}`;
  const { listing, files } = await reader(repository, (p) => p === path);
  if (listing.kind === "unreadable") {
    return { item, ok: false, note: `policy source tree unreadable at HEAD: ${listing.reason}` };
  }
  const read = files.get(path);
  if (read === undefined || read.kind === "unreadable") {
    return {
      item,
      ok: false,
      note: `policy source unreadable at HEAD: ${read?.reason ?? "not tracked"}`,
    };
  }
  const violations = reviewPolicySource(read.text);
  return violations.length === 0
    ? {
        item,
        ok: true,
        note: "policy source carries the strict I-37 base, nosniff and no-referrer",
      }
    : { item, ok: false, note: `policy source is not strict: ${violations.join("; ")}` };
}

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const registry = parseRegistry(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const allowlist = parseAllowlist(await Bun.file(ALLOWLIST_PATH).text());
  const report = new GateReport();
  const tally = emptyTally();
  const policy = await reviewPolicy(allowlist);
  report.check(policy.item, policy.ok, policy.note);
  for (const entry of registry) {
    for (const check of await reviewRepository(entry, allowlist, tally)) {
      report.check(check.item, check.ok, check.note);
    }
  }
  // An entry naming a repository this gate does not read is a permission nobody verifies.
  const read = new Set(registry.filter((e) => exemption(e) === null).map((e) => e.repository));
  for (const entry of [...allowlist.allowances, ...allowlist.servers]) {
    if (!read.has(entry.repository)) {
      report.check(
        `${entry.repository}:${entry.path}`,
        false,
        "allowlist entry for a repository this gate does not read (absent, private or archived) — remove it",
      );
    }
  }
  if (!read.has(allowlist.policySource.repository)) {
    report.check(
      allowlist.policySource.repository,
      false,
      "the policy source lives in a repository this gate does not read",
    );
  }
  report.volume(summarizeVolume(tally));
  if (report.outcome !== "pass") console.error(`Web headers volume: ${summarizeVolume(tally)}`);
  concludeGate("Web headers", report);
}
