import { describe, expect, test } from "bun:test";
import type { RegistryEntry } from "./check-context-conformance";
import {
  ALLOWLIST_PATH,
  type Allowlist,
  emptyTally,
  importsResponseLayer,
  isExamined,
  isTestPath,
  parseAllowlist,
  reviewCaddyfile,
  reviewPolicy,
  reviewPolicySource,
  reviewRepository,
  scanFile,
  startsServer,
  strictBaseViolations,
  summarizeVolume,
  type WebTally,
} from "./check-web-headers";
import type { BlobRead, FleetFileReader } from "./fleet-tree";

const REPO = "libre-ai/example";
const ENTRY: RegistryEntry = {
  repository: REPO,
  role: "product",
  layer: "product",
  lifecycle: "active",
  visibility: "public",
};

const STRICT_CSP =
  "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'";

const POLICY_SOURCE = [
  "const SECURITY_HEADERS = {",
  `  "Content-Security-Policy":`,
  `    "${STRICT_CSP}",`,
  `  "Referrer-Policy": "no-referrer",`,
  `  "X-Content-Type-Options": "nosniff",`,
  "} as const;",
].join("\n");

const APP_MANIFEST = JSON.stringify({
  name: "@libre-ai/app",
  dependencies: { "@libre-ai/web-platform": "file:../web-platform" },
});
const HANDLER = [
  `import { createRequestHandler, renderSsrDocument } from "@libre-ai/web-platform";`,
  "export const handler = createRequestHandler({ routes: {} });",
].join("\n");

/** An in-memory repository at HEAD: tree = the keys, blobs = the values. */
function fakeReader(
  files: Record<string, string>,
  unreadable: readonly string[] = [],
): FleetFileReader {
  return async (_repository, select) => {
    const paths = Object.keys(files);
    const read = new Map<string, BlobRead>();
    for (const path of paths.filter(select)) {
      read.set(
        path,
        unreadable.includes(path)
          ? { kind: "unreadable", reason: "simulated" }
          : { kind: "text", text: files[path] ?? "" },
      );
    }
    return { listing: { kind: "listed", paths }, files: read };
  };
}

function allowlist(partial: Partial<Allowlist> = {}): Allowlist {
  return {
    policySource: { repository: REPO, path: "packages/web-platform/src/response.ts" },
    allowances: [],
    servers: [],
    ...partial,
  };
}

async function review(
  files: Record<string, string>,
  list: Allowlist = allowlist(),
  unreadable: readonly string[] = [],
): Promise<{ failures: string[]; tally: WebTally }> {
  const tally = emptyTally();
  const checks = await reviewRepository(ENTRY, list, tally, fakeReader(files, unreadable));
  return { failures: checks.filter((c) => !c.ok).map((c) => `${c.item}: ${c.note}`), tally };
}

const APP = {
  "apps/web/package.json": APP_MANIFEST,
  "apps/web/src/server/handler.ts": HANDLER,
};

describe("strict base", () => {
  test("the web-platform shape holds", () => {
    expect(strictBaseViolations(STRICT_CSP)).toEqual([]);
    expect(reviewPolicySource(POLICY_SOURCE)).toEqual([]);
  });

  test("a relaxed script-src is refused, by token", () => {
    const violations = strictBaseViolations(
      STRICT_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    );
    expect(violations.join("\n")).toContain("script-src carries 'unsafe-inline'");
  });

  test.each([
    ["object-src 'none'", "object-src 'self'"],
    ["base-uri 'none'", "base-uri 'self'"],
    ["frame-ancestors 'none'", "frame-ancestors *"],
    ["default-src 'self'", "default-src *"],
    ["script-src 'self'", "script-src https:"],
  ])("%s weakened to %s is refused", (from, to) => {
    expect(strictBaseViolations(STRICT_CSP.replace(from, to))).not.toEqual([]);
  });

  test("a missing directive is refused, and a repeated one is named", () => {
    expect(strictBaseViolations(STRICT_CSP.replace("frame-ancestors 'none'; ", ""))).toContain(
      "frame-ancestors is missing",
    );
    expect(strictBaseViolations(`${STRICT_CSP}; script-src *`)).toContain(
      "directive script-src is repeated",
    );
  });

  test("a policy source without nosniff or no-referrer is refused", () => {
    expect(reviewPolicySource(POLICY_SOURCE.replace("nosniff", "sniff"))).toContain(
      "X-Content-Type-Options is not nosniff",
    );
    expect(reviewPolicySource(POLICY_SOURCE.replace(`"no-referrer"`, `"origin"`))).toContain(
      "Referrer-Policy is not no-referrer",
    );
    expect(reviewPolicySource("export {};")).toHaveLength(1);
  });

  test("the policy source is read at HEAD and a weakened one fails", async () => {
    const path = "packages/web-platform/src/response.ts";
    const strict = await reviewPolicy(allowlist(), fakeReader({ [path]: POLICY_SOURCE }));
    expect(strict.ok).toBe(true);
    const weak = await reviewPolicy(
      allowlist(),
      fakeReader({
        [path]: POLICY_SOURCE.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"),
      }),
    );
    expect(weak.ok).toBe(false);
    const missing = await reviewPolicy(allowlist(), fakeReader({}));
    expect(missing.ok).toBe(false);
    const unreadable = await reviewPolicy(
      allowlist(),
      fakeReader({ [path]: POLICY_SOURCE }, [path]),
    );
    expect(unreadable.ok).toBe(false);
  });
});

describe("classification", () => {
  test("test paths", () => {
    expect(isTestPath("apps/a/src/x.test.ts")).toBe(true);
    expect(isTestPath("apps/a/e2e/content-security-policy.ts")).toBe(true);
    expect(isTestPath("apps/a/tests/fixtures/index.html")).toBe(true);
    expect(isTestPath("apps/a/src/server/handler.ts")).toBe(false);
  });

  test("examined files skip vendored and build trees", () => {
    expect(isExamined("apps/a/src/x.tsx")).toBe(true);
    expect(isExamined("site/index.html")).toBe(true);
    expect(isExamined("Caddyfile")).toBe(true);
    expect(isExamined("apps/a/package.json")).toBe(true);
    expect(isExamined("node_modules/x/index.js")).toBe(false);
    expect(isExamined("vendored/x/index.ts")).toBe(false);
    expect(isExamined("README.md")).toBe(false);
  });

  test("the response layer import", () => {
    expect(importsResponseLayer(HANDLER)).toBe(true);
    expect(
      importsResponseLayer(`import { secureResponse as secure } from "@libre-ai/web-platform";`),
    ).toBe(true);
    expect(
      importsResponseLayer(`import { parseServerAddress } from "@libre-ai/web-platform";`),
    ).toBe(false);
    expect(importsResponseLayer(`import { createRequestHandler } from "./local";`)).toBe(false);
  });

  test("servers", () => {
    expect(startsServer("src/main.ts", "const s = Bun.serve({ port: 0 });")).toBe(true);
    expect(
      startsServer("src/main.ts", `import { createServer } from "node:http"; createServer(h);`),
    ).toBe(true);
    expect(startsServer("src/main.ts", `import { serve } from "bun";\nserve({ fetch });`)).toBe(
      true,
    );
    expect(startsServer("src/main.ts", "serve({ fetch });")).toBe(false);
    expect(startsServer("src/main.test.ts", "Bun.serve({ port: 0 });")).toBe(false);
  });

  test("sinks are found in tests too, relaxations are not", () => {
    const text = `el.innerHTML = x; const csp = "script-src 'unsafe-inline'";`;
    expect(scanFile("src/a.test.ts", text).map((f) => f.rule)).toEqual(["html-sink"]);
    expect(
      scanFile("src/a.ts", text)
        .map((f) => f.rule)
        .sort(),
    ).toEqual(["csp-relaxation", "html-sink"]);
  });

  test("a meta http-equiv is not a header literal", () => {
    expect(scanFile("src/t.ts", `<meta http-equiv="Content-Security-Policy" content="x">`)).toEqual(
      [],
    );
    expect(scanFile("src/t.ts", `headers.set("Content-Security-Policy", p);`)).toHaveLength(1);
  });

  test.each([
    ["dangerouslySetInnerHTML", `<div dangerouslySetInnerHTML={{ __html: x }} />`],
    ["innerHTML", "node.innerHTML = value;"],
    ["outerHTML", "node.outerHTML = value;"],
    ["insertAdjacentHTML", `node.insertAdjacentHTML("beforeend", value);`],
    ["document.write", "document.write(value);"],
    ["eval", "eval(code);"],
    ["new Function", `new Function("return 1");`],
  ])("the %s sink is found", (token, text) => {
    expect(scanFile("src/ui/a.tsx", text)).toEqual([
      { path: "src/ui/a.tsx", rule: "html-sink", token, count: 1 },
    ]);
  });

  test("evaluate and a field named eval are not eval", () => {
    expect(scanFile("src/a.ts", "await page.evaluate(() => 1); const medieval = 1;")).toEqual([]);
  });
});

describe("reviewRepository", () => {
  test("a web-platform surface with no finding is conformant", async () => {
    const { failures, tally } = await review(APP);
    expect(failures).toEqual([]);
    expect(tally.surfaces).toBe(1);
    expect(tally.conformant).toBe(1);
  });

  test("a dev dependency on web-platform does not make a surface", async () => {
    const { tally } = await review({
      "package.json": JSON.stringify({ devDependencies: { "@libre-ai/web-platform": "1" } }),
    });
    expect(tally.surfaces).toBe(0);
  });

  test("a peer dependency does", async () => {
    const { tally } = await review({
      "packages/auth/package.json": JSON.stringify({
        peerDependencies: { "@libre-ai/web-platform": "=0.1.0" },
      }),
      "packages/auth/src/h.ts": `import { secureResponse } from "@libre-ai/web-platform";`,
    });
    expect(tally.surfaces).toBe(1);
  });

  test("a surface that never wires the response layer fails", async () => {
    const { failures } = await review({
      "apps/web/package.json": APP_MANIFEST,
      "apps/web/src/server/handler.ts": `export const h = () => new Response("<p>", { headers: { "content-type": "text/html" } });`,
    });
    expect(failures.join("\n")).toContain("no non-test source imports createRequestHandler");
  });

  test("an injected sink turns the surface red", async () => {
    const { failures, tally } = await review({
      ...APP,
      "apps/web/src/ui/view.tsx":
        "export const V = (h: string) => <div dangerouslySetInnerHTML={{ __html: h }} />;",
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("html-sink dangerouslySetInnerHTML ×1");
    expect(tally.violating).toBe(1);
  });

  test("a sink in a library that is not a surface is out of scope", async () => {
    const { failures } = await review({
      ...APP,
      "packages/lib/package.json": JSON.stringify({ name: "lib" }),
      "packages/lib/src/x.ts": "el.innerHTML = v;",
    });
    expect(failures).toEqual([]);
  });

  test("a CSP relaxed outside the allowlist turns the surface red", async () => {
    const { failures } = await review({
      ...APP,
      "apps/web/src/server/relax.ts": `headers.set("Content-Security-Policy", "script-src 'self' 'unsafe-inline'");`,
    });
    expect(failures.join("\n")).toContain("csp-relaxation 'unsafe-inline' ×1");
    expect(failures.join("\n")).toContain("csp-header-literal Content-Security-Policy ×1");
  });

  const notebookFiles = {
    ...APP,
    "apps/web/src/server/wasm.ts": `const p = headers.get("Content-Security-Policy"); headers.set("Content-Security-Policy", p.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'"));`,
    "apps/web/e2e/csp.ts":
      "expect(csp).toContain(\"'wasm-unsafe-eval'\"); // Content-Security-Policy",
  };
  const notebookAllowances = allowlist({
    allowances: [
      {
        repository: REPO,
        path: "apps/web/src/server/wasm.ts",
        rule: "csp-relaxation",
        token: "'wasm-unsafe-eval'",
        count: 1,
        because: "core compiled in the browser",
      },
      {
        repository: REPO,
        path: "apps/web/src/server/wasm.ts",
        rule: "csp-header-literal",
        token: "Content-Security-Policy",
        count: 2,
        because: "read and write of that relaxation",
      },
    ],
  });

  test("a named, counted relaxation passes and the surface is counted as exempted", async () => {
    const { failures, tally } = await review(notebookFiles, notebookAllowances);
    expect(failures).toEqual([]);
    expect(tally.exempted).toBe(1);
    expect(tally.allowed).toBe(3);
    expect(tally.servedCspTests).toBe(1);
  });

  test("a second relaxation next to the reviewed one moves the count and fails", async () => {
    const { failures } = await review(
      {
        ...notebookFiles,
        "apps/web/src/server/wasm.ts": `${notebookFiles["apps/web/src/server/wasm.ts"]} const extra = "'wasm-unsafe-eval'";`,
      },
      notebookAllowances,
    );
    expect(failures.join("\n")).toContain("the allowlist reviewed 1, the file now has 2");
  });

  test("an allowance with nothing left is stale", async () => {
    const { failures } = await review(APP, notebookAllowances);
    expect(failures.filter((f) => f.includes("stale allowance"))).toHaveLength(2);
  });

  test("a strict Caddyfile makes an equivalent surface; a weak one fails", async () => {
    const caddy = (csp: string) => ({
      "package.json": JSON.stringify({ name: "site" }),
      Caddyfile: `header {\n\tContent-Security-Policy "${csp}"\n\tReferrer-Policy "no-referrer"\n\tX-Content-Type-Options "nosniff"\n}`,
      "site/index.html": "<p>static</p>",
    });
    const strict = await review(caddy(STRICT_CSP));
    expect(strict.failures).toEqual([]);
    expect(strict.tally.surfaces).toBe(1);
    const weak = await review(caddy(STRICT_CSP.replace("object-src 'none'", "object-src *")));
    expect(weak.failures.join("\n")).toContain("object-src is `*`");
    expect(reviewCaddyfile("header {}")).toEqual([
      "the Caddyfile sets no Content-Security-Policy header",
    ]);
  });

  test("an undeclared server outside every surface fails; a declared one passes", async () => {
    const files = {
      ...APP,
      "tools/serve.ts": "Bun.serve({ hostname: '127.0.0.1', port: 0, fetch });",
    };
    expect((await review(files)).failures.join("\n")).toContain(
      "starts an HTTP server outside every web surface",
    );
    const declared = allowlist({
      servers: [{ repository: REPO, path: "tools/serve.ts", because: "loopback harness" }],
    });
    const { failures, tally } = await review(files, declared);
    expect(failures).toEqual([]);
    expect(tally.serversOutside).toBe(1);
  });

  test("a server inside a surface needs no declaration, and a stale declaration fails", async () => {
    const files = { ...APP, "apps/web/src/server/index.ts": "Bun.serve({ fetch: handler });" };
    expect((await review(files)).failures).toEqual([]);
    const stale = allowlist({
      servers: [{ repository: REPO, path: "apps/web/src/server/index.ts", because: "x" }],
    });
    expect((await review(files, stale)).failures.join("\n")).toContain("stale declaration");
  });

  test("an unreadable file fails instead of counting as no surface", async () => {
    const { failures, tally } = await review(APP, allowlist(), ["apps/web/package.json"]);
    expect(failures.join("\n")).toContain("unreadable at HEAD: simulated");
    expect(tally.surfaces).toBe(0);
  });

  test("an unreadable tree fails", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(ENTRY, allowlist(), tally, async () => ({
      listing: { kind: "unreadable", reason: "truncated" },
      files: new Map(),
    }));
    expect(checks.map((c) => c.ok)).toEqual([false]);
  });

  test("a manifest that is not JSON fails", async () => {
    const { failures } = await review({ "apps/web/package.json": "{" });
    expect(failures.join("\n")).toContain("package.json is not JSON");
  });

  test("an exempt entry is counted, never read", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(
      { ...ENTRY, lifecycle: "archived" },
      allowlist(),
      tally,
      async () => {
        throw new Error("must not read");
      },
    );
    expect(checks[0]?.ok).toBe(true);
    expect(tally.exempt).toBe(1);
  });

  test("the volume line sums its surfaces", async () => {
    const { tally } = await review(notebookFiles, notebookAllowances);
    const line = summarizeVolume(tally);
    expect(line).toContain(
      "1 web surface(s) = 0 conformant + 1 exempted (allowlisted findings) + 0 violating",
    );
    expect(tally.surfaces).toBe(tally.conformant + tally.exempted + tally.violating);
  });
});

describe("the allowlist", () => {
  test("the committed register parses and names the Notebook relaxation with its reason", async () => {
    const list = parseAllowlist(
      await Bun.file(new URL(`../${ALLOWLIST_PATH}`, import.meta.url)).text(),
    );
    const wasm = list.allowances.find((a) => a.token === "'wasm-unsafe-eval'");
    expect(wasm?.repository).toBe("libre-ai/personal-knowledge-workspace");
    expect(wasm?.path).toBe("apps/notebook/src/server/handler.ts");
    expect(wasm?.because.length).toBeGreaterThan(40);
    expect(list.policySource.path).toBe("packages/web-platform/src/response.ts");
  });

  const base = [
    "schema_version: libre-ai.web-headers-allowlist.v1",
    "policy_source: { repository: a/b, path: c.ts }",
    "servers_outside_surfaces: []",
  ];

  test.each([
    [
      "an unknown rule",
      "  - { repository: a/b, path: p, rule: other, token: t, count: 1, because: r }",
    ],
    [
      "a zero count",
      "  - { repository: a/b, path: p, rule: html-sink, token: eval, count: 0, because: r }",
    ],
    [
      "a missing reason",
      "  - { repository: a/b, path: p, rule: html-sink, token: eval, count: 1 }",
    ],
  ])("%s is refused", (_label, line) => {
    expect(() => parseAllowlist([...base, "allowances:", line].join("\n"))).toThrow();
  });

  test("a duplicate entry is refused", () => {
    const line =
      "  - { repository: a/b, path: p, rule: html-sink, token: eval, count: 1, because: r }";
    expect(() => parseAllowlist([...base, "allowances:", line, line].join("\n"))).toThrow(
      "duplicates",
    );
  });

  test("a wrong schema version is refused", () => {
    expect(() =>
      parseAllowlist(["schema_version: v0", ...base.slice(1), "allowances: []"].join("\n")),
    ).toThrow("schema_version");
  });
});
