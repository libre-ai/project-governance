import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanForTransmission, type TransmissionFinding } from "./check-no-transmission";

// The Front-C no-transmission guard (WP-G3-B01 / WP-G3-P01): boussole and
// practices are local-only, so an outbound data-transmission primitive in their
// source is a hard failure. Serving static assets locally is not transmission and
// must not be flagged.

function findingsFor(path: string, content: string): TransmissionFinding[] {
  return scanForTransmission([{ path, content }]);
}

describe("scanForTransmission", () => {
  test("flags a fetch() call in a local-only app", () => {
    const findings = findingsFor(
      "apps/boussole/src/client/upload.ts",
      "await fetch('/api/responses', { method: 'POST', body });",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toBe("fetch() call");
  });

  test("flags a WebSocket, an EventSource and sendBeacon", () => {
    expect(
      findingsFor("apps/practices/src/client/live.ts", "const s = new WebSocket('wss://x');"),
    ).toHaveLength(1);
    expect(
      findingsFor("apps/boussole/src/client/live.ts", "const e = new EventSource('/stream');"),
    ).toHaveLength(1);
    expect(
      findingsFor("apps/practices/src/client/beacon.ts", "navigator.sendBeacon('/t', data);"),
    ).toHaveLength(1);
  });

  test("flags an RTCPeerConnection, a global-alias fetch source and a remote dynamic import", () => {
    expect(
      findingsFor("apps/boussole/src/client/rtc.ts", "const pc = new RTCPeerConnection();"),
    ).toHaveLength(1);
    expect(
      findingsFor("apps/practices/src/client/alias.ts", "const f = globalThis.fetch;"),
    ).toHaveLength(1);
    expect(
      findingsFor("apps/boussole/src/client/x.ts", 'await import("https://cdn.example/x.js");'),
    ).toHaveLength(1);
  });

  test("flags a literal fetch( method-shorthand handler by design (use createRequestHandler)", () => {
    // A raw `Bun.serve({ fetch(req) { } })` handler is flagged: it is the safe
    // (fail-closed) direction, and Front-C apps serve their shell via
    // createRequestHandler / property syntax, so a literal fetch( should not appear.
    expect(
      findingsFor("apps/boussole/src/server/index.ts", "Bun.serve({ fetch(req) { return r; } });"),
    ).toHaveLength(1);
  });

  test("flags a node network module import, dynamic import and require", () => {
    expect(
      findingsFor("apps/boussole/src/x.ts", 'import { request } from "node:https";'),
    ).toHaveLength(1);
    expect(findingsFor("apps/practices/src/x.ts", 'await import("node:http");')).toHaveLength(1);
    expect(findingsFor("apps/boussole/src/x.ts", 'const net = require("node:net");')).toHaveLength(
      1,
    );
  });

  test("does not flag a comment or prose mentioning the primitives", () => {
    expect(
      findingsFor(
        "apps/boussole/src/domain/response-set.ts",
        "// this module never calls fetch() and exposes no network path",
      ),
    ).toHaveLength(0);
    expect(
      findingsFor("apps/practices/src/domain/x.ts", " * a WebSocket would violate no-transmission"),
    ).toHaveLength(0);
  });

  test("does not flag serving static assets locally (Bun.serve / a string URL)", () => {
    expect(
      findingsFor(
        "apps/boussole/src/server/index.ts",
        "Bun.serve({ fetch: handler, port: 3000 });",
      ),
    ).toHaveLength(0);
    expect(
      findingsFor("apps/practices/src/ui/link.tsx", 'const href = "https://example.org/method";'),
    ).toHaveLength(0);
  });

  test("does not flag transmission primitives outside the scoped apps", () => {
    // The server-side RLS apps legitimately make network calls; this guard is
    // scoped to the local-only apps only.
    expect(
      findingsFor("apps/missions/src/x.ts", "await fetch('https://provider/api');"),
    ).toHaveLength(0);
    expect(
      findingsFor("packages/data/src/x.ts", "const s = new WebSocket('wss://x');"),
    ).toHaveLength(0);
  });

  test("does not flag the documented service-worker generator allowlist entry", () => {
    // The PWA service worker's shell-only fetch is a reviewed exception, named in
    // ALLOWLISTED_PATHS with a bounded rationale.
    expect(
      findingsFor(
        "apps/boussole/scripts/build-service-worker.ts",
        "event.respondWith(caches.match(event.request).then(cached=>cached??fetch(event.request)));",
      ),
    ).toHaveLength(0);
  });

  test("still flags the same fetch in a non-allowlisted boussole file", () => {
    // The allowlist is by exact path, not a blanket scripts/ exemption: a fetch
    // anywhere else in the app is still caught.
    expect(
      findingsFor("apps/boussole/scripts/build.ts", "await fetch(event.request);"),
    ).toHaveLength(1);
  });

  test("does not flag transmission primitives in the practices service-worker generator allowlist entry", () => {
    // The PWA service worker's shell-only fetch is a reviewed exception, named in
    // ALLOWLISTED_PATHS with a bounded rationale (same as boussole).
    expect(
      findingsFor(
        "apps/practices/scripts/build-service-worker.ts",
        "event.respondWith(caches.match(event.request).then(cached=>cached??fetch(event.request)));",
      ),
    ).toHaveLength(0);
  });

  test("still flags a fetch in a non-allowlisted practices file", () => {
    // The allowlist is by exact path, not a blanket scripts/ exemption: a fetch
    // anywhere else in the practices app is still caught.
    expect(
      findingsFor("apps/practices/scripts/build.ts", "await fetch(event.request);"),
    ).toHaveLength(1);
  });
});

// --------------------------------------------------------------- the executable
//
// Why the SCRIPT is exercised here and not only the pure function above.
//
// This repository holds no local-only application: both apps left with the
// ADR-0020 dispatch, so there is no honest `--roots` to put in this repository's
// own `check` chain — a root invented to have something to scan is the defect
// this gate was built to stop, not its wiring. Its enforcement point is a
// consumer: measured on 2026-10-08 across the twenty-four inventoried
// repositories, exactly one wires it — `personal-knowledge-notebook`, as
// `check:no-transmission` inside its aggregated `check`, over
// `apps/notebook/src`.
//
// So this repository SHIPS an executable it never ran. Everything above tested
// the pure scanner; the half a consumer actually invokes — the mandatory roots,
// the empty-root refusal, the vendored skip, the volume line — had no execution
// coverage at all, and it is precisely that half which failed silently from the
// dispatch until 2026-08-04 (an empty glob, a reassuring sentence, exit 0).
// `bun test` is a link of the `check` chain, so these cases make the chain carry
// the gate's real verdict on a real run instead of its unit tests alone.
describe("check-no-transmission executable", () => {
  const SCRIPT = join(import.meta.dir, "check-no-transmission.ts");

  interface Run {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }

  /** Runs the real gate in a throwaway tree, so no fixture is ever tracked. */
  function runIn(files: Record<string, string>, argv: readonly string[]): Run {
    const cwd = mkdtempSync(join(tmpdir(), "no-transmission-"));
    for (const [path, content] of Object.entries(files)) {
      const full = join(cwd, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content);
    }
    const result = Bun.spawnSync(["bun", SCRIPT, ...argv], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      // NO_COLOR keeps the assertions comparing text, not ANSI escapes.
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", GATE_VERBOSE: "" },
    });
    return {
      exitCode: result.exitCode ?? 1,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  }

  test("refuses to run without a declared root", () => {
    const run = runIn({ "src/clean.ts": "export const a = 1;\n" }, []);
    expect(run.exitCode).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain("no root named");
  });

  test("fails on a root that matches no file, instead of passing over nothing", () => {
    // THE historical failure mode: from the ADR-0020 dispatch to 2026-08-04 the
    // scan glob matched nothing and the gate exited 0. An empty root is a red
    // check, so a moved application turns this gate red rather than green.
    const run = runIn({ "src/clean.ts": "export const a = 1;\n" }, ["--roots", "apps/gone"]);
    expect(run.exitCode).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain("root matched no file");
  });

  test("passes a clean root AND prints the volume it scanned", () => {
    const run = runIn(
      {
        "src/domain/a.ts": "export const a = 1;\n",
        "src/domain/b.ts": "// never calls fetch()\nexport const b = 2;\n",
      },
      ["--roots", "src"],
    );
    expect(run.exitCode).toBe(0);
    // A verdict without a volume is compatible with zero inspection: the count
    // has to be on the success line, which is the only line CI prints.
    expect(run.stdout).toContain("No transmission verified");
    expect(run.stdout).toContain("2 file(s) across 1 declared root(s)");
    expect(run.stdout).toContain("transmission signal(s)");
  });

  test("flags a planted primitive with its file and line", () => {
    const run = runIn(
      {
        "src/ok.ts": "export const a = 1;\n",
        "src/leak.ts":
          "export async function send(b: string) {\n  await fetch('/x', { body: b });\n}\n",
      },
      ["--roots", "src"],
    );
    expect(run.exitCode).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain("src/leak.ts:2");
    expect(`${run.stdout}${run.stderr}`).toContain("fetch() call");
  });

  test("honours --allow for a reviewed exception and skips vendored trees", () => {
    const run = runIn(
      {
        "src/sw.ts": "self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));\n",
        "src/node_modules/dep/index.ts": "await fetch('https://provider/api');\n",
        "src/ok.ts": "export const a = 1;\n",
      },
      ["--roots", "src", "--allow", "src/sw.ts"],
    );
    expect(run.exitCode).toBe(0);
    // The vendored file is not counted at all, so the volume names 2, not 3.
    expect(run.stdout).toContain("2 file(s) across 1 declared root(s)");
    expect(run.stdout).toContain("1 reviewed allowance(s)");
  });
});
