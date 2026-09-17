/**
 * Front-C no-transmission guard (WP-G3-B01 boussole, WP-G3-P01 practices).
 *
 * boussole and practices are LOCAL-ONLY / on-device apps: their binding invariant
 * is that user data (questionnaire responses, activity outcomes) NEVER leaves the
 * device — "no response ever leaves local storage", exported only by an explicit,
 * consent-driven local file operation. Today that guarantee is structural in the
 * domain modules (they import nothing and expose no network path); as the client
 * verticals grow a UI, this scanner keeps the guarantee a hard CI gate rather than
 * a convention.
 *
 * It flags network primitives in apps/boussole and apps/practices source. A
 * string URL is data, not a call, and is not flagged; `Bun.serve({ fetch: h })`
 * (property syntax) is not flagged. A literal `fetch(` IS flagged — including the
 * rare `Bun.serve({ fetch(req) { } })` method-shorthand handler; those apps serve
 * their shell via `@libre-ai/web-platform` `createRequestHandler`, so a literal
 * `fetch(` should not appear, and flagging it is the safe (fail-closed) direction.
 *
 * The invariant is "no outbound USER DATA". Inbound reads of PUBLIC reference data
 * (boussole loading a published method/dataset) are legitimate — but `fetch` alone
 * cannot be statically proven GET-only-public, so this guard conservatively
 * forbids ALL of these primitives while none is yet needed (the domains import
 * nothing today). When the public-dataset loader is built (a later increment), how
 * it reads public data — a build-time bundled asset, or a narrowly-reviewed
 * allowlisted loader module — becomes a DELIBERATE decision, not a silent default.
 * Fail-closed: over-blocking now, loosened only on purpose.
 *
 * Coarse by design. It catches the direct primitives and the common global-alias
 * source (`window.fetch`), but a determined exfiltration can still evade a
 * line-regex — e.g. an `Image().src` beacon, a `form.submit()` to an external
 * action, or an alias obtained by destructuring (`const { fetch } = globalThis`),
 * which need flow analysis. Those are deliberately deferred: the complementary,
 * stronger controls are architectural (the domains import nothing; user data lives
 * only in IndexedDB) plus a dual-K4 privacy review on every Front-C increment. This
 * gate stops the accidental and the obvious, not a motivated insider.
 */
export interface ScanTarget {
  readonly path: string;
  readonly content: string;
}

export interface TransmissionFinding {
  readonly path: string;
  readonly line: number;
  readonly reason: string;
}

// The scoped roots are the CALLER's statement, never inferred from what
// happens to exist on disk. The historical default below matched the hub
// topology — and matched NOTHING after the ADR-0020 dispatch moved both apps
// to their product repositories, which left this guard green over an empty
// scan while the invariant it carries (a locked privacy guarantee) was
// enforced nowhere. Run as a gate, it now requires --roots; the default only
// serves the pure function's tests.
const SCOPED_PREFIXES = ["apps/boussole/", "apps/practices/"];
const SELF_TEST_SUFFIX = "check-no-transmission.test.ts";

// Documented, narrow allowlist — reviewed exceptions, NOT a convenience escape
// hatch. A PWA service worker unavoidably uses `fetch` to serve its app shell;
// each file here generates a service worker whose only `fetch` is provably
// same-origin, GET-only and restricted to the shell asset allowlist (no user
// data, no cross-origin). Each entry's file header states and bounds that
// guarantee, and any change to those files must be re-reviewed for it. Adding a
// path here is a security decision, not a way to silence a real finding.
const ALLOWLISTED_PATHS: ReadonlySet<string> = new Set([
  "apps/boussole/scripts/build-service-worker.ts",
  "apps/practices/scripts/build-service-worker.ts",
]);

function inScope(path: string, prefixes: readonly string[], allow: ReadonlySet<string>): boolean {
  if (path.endsWith(SELF_TEST_SUFFIX)) return false;
  if (allow.has(path)) return false;
  return prefixes.some((prefix) => path.startsWith(prefix));
}

// A comment line cannot transmit; skip it so prose like "exposes no network path"
// or "never call fetch()" is not a false positive.
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

const NETWORK_MODULE = "(?:http|https|http2|net|tls|dgram)";
const SIGNALS: readonly { readonly test: RegExp; readonly reason: string }[] = [
  { test: /\bfetch\s*\(/, reason: "fetch() call" },
  // The common alias SOURCE: `const f = window.fetch` then `f(...)` would evade a
  // bare `fetch(` match, so flag the global reference itself.
  {
    test: /\b(?:window|globalThis|self)\s*\.\s*fetch\b/,
    reason: "fetch via global (alias source)",
  },
  { test: /\bnew\s+XMLHttpRequest\b/, reason: "XMLHttpRequest" },
  { test: /\bnew\s+WebSocket\b/, reason: "WebSocket" },
  { test: /\bnew\s+EventSource\b/, reason: "EventSource" },
  { test: /\bnew\s+RTCPeerConnection\b/, reason: "RTCPeerConnection (WebRTC)" },
  { test: /\bnavigator\s*\.\s*sendBeacon\b/, reason: "navigator.sendBeacon" },
  { test: /\bimport\s*\(\s*["']https?:\/\//, reason: "remote dynamic import" },
  {
    test: new RegExp(`\\bfrom\\s+["']node:${NETWORK_MODULE}["']`),
    reason: "node network module import",
  },
  {
    test: new RegExp(`\\bimport\\s*\\(\\s*["']node:${NETWORK_MODULE}["']`),
    reason: "node network module dynamic import",
  },
  {
    test: new RegExp(`\\brequire\\s*\\(\\s*["'](?:node:)?${NETWORK_MODULE}["']`),
    reason: "node network module require",
  },
];

export function scanForTransmission(
  targets: readonly ScanTarget[],
  prefixes: readonly string[] = SCOPED_PREFIXES,
  allow: ReadonlySet<string> = ALLOWLISTED_PATHS,
): TransmissionFinding[] {
  const findings: TransmissionFinding[] = [];
  for (const target of targets) {
    if (!inScope(target.path, prefixes, allow)) continue;
    const lines = target.content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (isCommentLine(line)) continue;
      for (const signal of SIGNALS) {
        if (signal.test.test(line)) {
          findings.push({ path: target.path, line: i + 1, reason: signal.reason });
          break;
        }
      }
    }
  }
  return findings;
}

// Executable entrypoint. The caller names the roots it guarantees local-only:
//
//   bun check-no-transmission.ts --roots src            (a product repository)
//   bun check-no-transmission.ts --roots src --allow src/scripts/build-sw.ts
//
// No default roots: a default tied to a topology is how this gate went green
// over an empty scan for a whole dispatch.
if (import.meta.main) {
  const { concludeGate, GateReport } = await import("./gate-report");
  const argv = process.argv.slice(2);
  const rootsFlag = argv.indexOf("--roots");
  const allowFlag = argv.indexOf("--allow");
  const takeAfter = (flag: number): string[] => {
    const values: string[] = [];
    if (flag === -1) return values;
    for (let i = flag + 1; i < argv.length; i += 1) {
      const arg = argv[i] ?? "";
      if (arg.startsWith("--")) break;
      values.push(arg);
    }
    return values;
  };
  const roots = takeAfter(rootsFlag).map((r) => (r.endsWith("/") ? r : `${r}/`));
  const allow: ReadonlySet<string> = new Set(takeAfter(allowFlag));

  const report = new GateReport();
  if (roots.length === 0) {
    report.check(
      "--roots",
      false,
      "no root named — this gate scans what the caller declares local-only, never a topology default",
    );
    concludeGate("No transmission", report);
  }

  // Vendored and generated trees under a root are not the app's source: a
  // dependency's own use of fetch (playwright-core's type declarations were
  // the live case) says nothing about what THIS app transmits. The dependency
  // surface is licence-gated and lockfile-pinned elsewhere.
  const VENDORED_SEGMENTS = ["/node_modules/", "/dist/", "/build/", "/target/"];
  for (const root of roots) {
    const glob = new Bun.Glob(`${root}**/*.{ts,tsx}`);
    const targets: ScanTarget[] = [];
    for await (const path of glob.scan({ cwd: ".", onlyFiles: true })) {
      if (VENDORED_SEGMENTS.some((segment) => path.includes(segment))) continue;
      targets.push({ path, content: await Bun.file(path).text() });
    }
    const findings = scanForTransmission(targets, [root], allow);
    for (const finding of findings) {
      report.check(`${finding.path}:${finding.line}`, false, finding.reason);
    }
    if (findings.length === 0) {
      report.check(
        root,
        targets.length > 0,
        targets.length > 0
          ? `${targets.length} files carry no outbound transmission primitive`
          : "root matched no file — wrong path, or the app moved again",
      );
    }
  }
  concludeGate("No transmission", report);
}
