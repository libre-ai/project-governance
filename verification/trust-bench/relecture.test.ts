import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The review layer is exercised as the process it is, against a stand-in of
 * the local server it talks to: what is held is its own judgement of a reply,
 * not the judgement of a model.
 *
 * What each test would miss if it went away:
 * - a URL outside the machine would receive the diffs of the measured
 *   repository;
 * - a reply whose verdict is not a boolean would be written as a verdict,
 *   and the string "yes" would read as a defect caught.
 */

const REVIEW = join(import.meta.dir, "relecture.ts");
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface Outcome {
  readonly code: number;
  readonly stderr: string;
  readonly results: string;
}

/** One diff in a fresh directory, and where the review writes its lines. */
function workspace(): { diffs: string; results: string } {
  const root = mkdtempSync(join(tmpdir(), "trust-bench-review-test-"));
  roots.push(root);
  const diffs = join(root, "diffs");
  mkdirSync(diffs);
  writeFileSync(join(diffs, "D01.diff"), "-const x = 1;\n+const x = 2;\n");
  return { diffs, results: join(root, "results.jsonl") };
}

async function review(
  url: string,
  diffs: string,
  results: string,
  extraEnv: Record<string, string> = {},
): Promise<Outcome> {
  // Asynchronous: the stand-in server lives in this process and must answer while the review runs.
  // A clean environment: a proxy set on the machine running the tests must not decide them.
  const run = Bun.spawn([process.execPath, REVIEW, diffs, url, "modele-test", results], {
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", ...extraEnv },
  });
  const code = await run.exited;
  return {
    code,
    stderr: await new Response(run.stderr).text(),
    results: existsSync(results) ? readFileSync(results, "utf8") : "",
  };
}

/** A local server that answers every completion with `content`. */
function server(content: string) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      Response.json({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
  });
}

describe("relecture", () => {
  // Names under the reserved `.invalid` domain: a review that let them through would fail to
  // resolve them, so even a broken guard sends nothing off the machine.
  test.each([
    "http://example.invalid:8080",
    "https://127.0.0.1:8080",
    "http://127.0.0.1.invalid:8080",
    "http://localhost.invalid:8080",
    "http://localhost:8080/v1",
  ])("a URL that is not local is refused before any diff is read: %s", async (url) => {
    const { diffs, results } = workspace();
    const outcome = await review(url, diffs, results);
    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toContain("seule une URL locale est admise");
    expect(outcome.results).toBe("");
  });

  test("control: a boolean verdict from a local server is written as a verdict", async () => {
    const local = server(JSON.stringify({ reasoning: "changes a constant", defect: true }));
    try {
      const { diffs, results } = workspace();
      const outcome = await review(`http://127.0.0.1:${local.port}`, diffs, results);
      expect(outcome.code, outcome.stderr).toBe(0);
      expect(JSON.parse(outcome.results)).toMatchObject({
        cas: "D01",
        modele: "modele-test",
        defaut: true,
        illisible: false,
      });
    } finally {
      local.stop(true);
    }
  });

  test("a redirect is not followed: the diff never reaches the host it points to", async () => {
    // The target stands for any host: a local one keeps the test off the network.
    let received = 0;
    const target = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        received += 1;
        return Response.json({
          choices: [{ message: { content: JSON.stringify({ reasoning: "r", defect: true }) } }],
        });
      },
    });
    // 307 keeps the method and the body: a followed redirect would resend the diff as is.
    const redirecting = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(null, {
          status: 307,
          headers: { location: `http://127.0.0.1:${target.port}/v1/chat/completions` },
        }),
    });
    try {
      const { diffs, results } = workspace();
      const outcome = await review(`http://127.0.0.1:${redirecting.port}`, diffs, results);
      expect(received).toBe(0);
      // A reported failure, not an uncaught exception: the run names the diff it stopped on.
      expect(outcome.code).toBe(1);
      expect(outcome.stderr).toContain("relecture : D01.diff : requête impossible");
      expect(outcome.results).toBe("");
    } finally {
      redirecting.stop(true);
      target.stop(true);
    }
  });

  test("a successful status whose body is not JSON is unreadable, written as such", async () => {
    const local = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("not json", { status: 200 }),
    });
    try {
      const { diffs, results } = workspace();
      const outcome = await review(`http://127.0.0.1:${local.port}`, diffs, results);
      expect(outcome.code).toBe(1);
      expect(JSON.parse(outcome.results)).toMatchObject({
        cas: "D01",
        defaut: null,
        illisible: true,
      });
    } finally {
      local.stop(true);
    }
  });

  // An error status is not an answer, whatever its body says: a verdict-shaped body on a 500
  // would otherwise be written as the model's verdict.
  test.each([
    [
      "a verdict-shaped JSON body",
      500,
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ reasoning: "r", defect: true }) } }],
      }),
    ],
    ["a body that is not JSON", 503, "upstream down"],
  ])("an error status with %s stops the run and writes nothing", async (_name, status, body) => {
    const failing = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(body, { status, headers: { "content-type": "application/json" } }),
    });
    try {
      const { diffs, results } = workspace();
      const outcome = await review(`http://127.0.0.1:${failing.port}`, diffs, results);
      expect(outcome.code).toBe(1);
      expect(outcome.stderr).toContain(
        `relecture : D01.diff : le serveur a répondu HTTP ${status}`,
      );
      expect(outcome.results).toBe("");
    } finally {
      failing.stop(true);
    }
  });

  test("a proxy set in the environment is refused: neither the proxy nor the server receive the diff", async () => {
    // Bun's fetch would send the diff to the proxy even for 127.0.0.1; the proxy here is a local
    // server that counts what it receives.
    let proxied = 0;
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        proxied += 1;
        return new Response("proxy", { status: 502 });
      },
    });
    let received = 0;
    const local = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        received += 1;
        return new Response("down", { status: 503 });
      },
    });
    try {
      const { diffs, results } = workspace();
      const outcome = await review(`http://127.0.0.1:${local.port}`, diffs, results, {
        http_proxy: `http://127.0.0.1:${proxy.port}`,
      });
      expect(outcome.code).toBe(2);
      expect(outcome.stderr).toContain("un proxy est défini (http_proxy)");
      expect(proxied).toBe(0);
      expect(received).toBe(0);
      expect(outcome.results).toBe("");
    } finally {
      proxy.stop(true);
      local.stop(true);
    }
  });

  // No exemption: under Bun 1.4.4 these two forms let the request reach the proxy although a
  // no_proxy variable names the host (measured by review rev-285-5d4a314).
  test.each([
    [
      "NO_PROXY naming the host, masked by a lower-case no_proxy",
      { NO_PROXY: "127.0.0.1", no_proxy: "example.com" },
    ],
    ["a mixed-case No_Proxy naming the host", { No_Proxy: "127.0.0.1" }],
  ])("a proxy is refused even with %s", async (_name, exemption) => {
    let proxied = 0;
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        proxied += 1;
        return new Response("proxy", { status: 502 });
      },
    });
    const local = server(JSON.stringify({ reasoning: "changes a constant", defect: true }));
    try {
      const { diffs, results } = workspace();
      const outcome = await review(`http://127.0.0.1:${local.port}`, diffs, results, {
        http_proxy: `http://127.0.0.1:${proxy.port}`,
        ...exemption,
      });
      expect(outcome.code).toBe(2);
      expect(proxied).toBe(0);
      expect(outcome.results).toBe("");
    } finally {
      proxy.stop(true);
      local.stop(true);
    }
  });

  test.each([
    ["a string", JSON.stringify({ reasoning: "r", defect: "yes" })],
    ["a number", JSON.stringify({ reasoning: "r", defect: 1 })],
    ["absent", JSON.stringify({ reasoning: "r" })],
    ["no JSON at all", "the change is a defect"],
  ])("a verdict that is %s is unreadable, neither red nor green", async (_name, content) => {
    const local = server(content);
    try {
      const { diffs, results } = workspace();
      const outcome = await review(`http://127.0.0.1:${local.port}`, diffs, results);
      // An unreadable reply fails the run, so that it is seen.
      expect(outcome.code).toBe(1);
      expect(JSON.parse(outcome.results)).toMatchObject({
        cas: "D01",
        defaut: null,
        illisible: true,
      });
    } finally {
      local.stop(true);
    }
  });
});
