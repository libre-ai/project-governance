import { describe, expect, test } from "bun:test";
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
