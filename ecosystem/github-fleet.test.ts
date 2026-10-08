import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delay, hasUsableGraphQLData, RETRY_DELAYS_MS } from "./github-fleet";

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("RETRY_DELAYS_MS", () => {
  test("is two retries beyond the first attempt, 1s then 3s", () => {
    // Every caller loops `for (attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++)`
    // and sleeps `RETRY_DELAYS_MS[attempt]`, so the array length IS the retry
    // count and its last index yields `undefined` on the final pass — that is
    // what stops the loop from sleeping after the attempt it will not retry.
    expect(RETRY_DELAYS_MS).toEqual([1000, 3000]);
    expect(RETRY_DELAYS_MS.length + 1).toBe(3);
    expect(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length]).toBeUndefined();
  });
});

describe("delay", () => {
  test("resolves no sooner than the requested duration", async () => {
    const started = Bun.nanoseconds();
    await delay(20);
    const elapsedMs = (Bun.nanoseconds() - started) / 1_000_000;
    // Lower bound only: a loaded runner may sleep longer, never shorter.
    expect(elapsedMs).toBeGreaterThanOrEqual(15);
  });

  test("resolves for a zero duration rather than hanging", async () => {
    await delay(0);
    expect(true).toBe(true);
  });
});

describe("hasUsableGraphQLData", () => {
  test("rejects a top-level rate-limit rejection — data: null alongside errors[]", () => {
    // The exact regression this predicate exists for: the documented shape of
    // a rate-limited/quota-exhausted `gh api graphql` response. `data` is
    // present (not undefined) but explicitly null — accepting it as success
    // marks every repository "unable to verify" in one pass, with no retry
    // and no REST fallback.
    expect(hasUsableGraphQLData({ data: null, errors: [{ type: "RATE_LIMITED" }] })).toBe(false);
  });

  test("rejects a response with no data key at all", () => {
    expect(hasUsableGraphQLData({ errors: [{ type: "SOME_ERROR" }] })).toBe(false);
    expect(hasUsableGraphQLData({})).toBe(false);
    // An array is `typeof "object"` but carries no `data` — rejected for the
    // same reason as `{}`, not for being an array.
    expect(hasUsableGraphQLData([])).toBe(false);
  });

  test("rejects a non-object body", () => {
    expect(hasUsableGraphQLData(null)).toBe(false);
    expect(hasUsableGraphQLData(undefined)).toBe(false);
    expect(hasUsableGraphQLData("not json shaped")).toBe(false);
    expect(hasUsableGraphQLData(42)).toBe(false);
  });

  test("accepts a real data payload, including one whose aliases are null", () => {
    expect(hasUsableGraphQLData({ data: { repo0: {} } })).toBe(true);
    expect(hasUsableGraphQLData({ data: { repo0: { agents: null } } })).toBe(true);
  });

  test("narrows the parsed body to a data record for the caller", () => {
    const parsed: unknown = { data: { repo0: { name: "demo" } } };
    if (!hasUsableGraphQLData(parsed)) throw new Error("expected a usable payload");
    // Compiles only because the predicate narrowed `unknown` to `{ data: … }`.
    expect(Object.keys(parsed.data)).toEqual(["repo0"]);
  });
});

/**
 * `ghGraphQLRaw` runs a subprocess, so its contract is measured against a
 * `gh` shim on PATH — no network call, no token. Bun resolves an executable
 * from the environment the process was STARTED with, so mutating
 * `process.env.PATH` in this process has no effect (measured): the shimmed
 * PATH has to be handed to a child through the `env` option, and the call
 * under test runs inside that child.
 *
 * What is asserted is the part every caller depends on: the query reaches the
 * subprocess on STDIN (never as an argv element, which an argument-length
 * limit would truncate), and all three channels come back whatever the exit
 * code — a partial NOT_FOUND makes the real `gh` exit non-zero while still
 * printing a usable body.
 *
 * `ghGraphQLRaw` is therefore named in the generated runner rather than
 * imported here: the call under test happens in the child, not in this file.
 */
async function ghGraphQLRawUnderShim(
  shimScript: string,
  query: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "github-fleet-gh-shim-"));
  created.push(dir);
  const shim = join(dir, "gh");
  await writeFile(shim, shimScript);
  await chmod(shim, 0o755);

  const moduleHref = new URL("github-fleet.ts", import.meta.url).href;
  const runner = join(dir, "run-under-shim.ts");
  await writeFile(
    runner,
    [
      `import { ghGraphQLRaw } from ${JSON.stringify(moduleHref)};`,
      `console.log(JSON.stringify(await ghGraphQLRaw(${JSON.stringify(query)})));`,
      "",
    ].join("\n"),
  );

  const proc = Bun.spawn(["bun", runner], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`the shimmed runner itself failed (exit ${exitCode}): ${stderr}`);
  }
  return JSON.parse(stdout) as { exitCode: number; stdout: string; stderr: string };
}

describe("ghGraphQLRaw", () => {
  test("passes the query on stdin and calls `gh api graphql -F query=@-`", async () => {
    const result = await ghGraphQLRawUnderShim(
      '#!/bin/sh\nprintf "argv:%s\\n" "$*"\ncat\n',
      'query { repository(owner: "libre-ai", name: "demo") { name } }',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("argv:api graphql -F query=@-");
    expect(result.stdout).toContain('query { repository(owner: "libre-ai", name: "demo")');
    expect(result.stderr).toBe("");
  });

  test("returns the body and stderr even when gh exits non-zero", async () => {
    const result = await ghGraphQLRawUnderShim(
      '#!/bin/sh\ncat > /dev/null\nprintf \'{"data":{"repo0":null},"errors":[{"type":"NOT_FOUND"}]}\'\nprintf "gone\\n" >&2\nexit 1\n',
      "query { __typename }",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr.trim()).toBe("gone");
    // The body is still usable: that is why callers read stdout regardless of
    // the exit code instead of treating non-zero as "no data".
    expect(hasUsableGraphQLData(JSON.parse(result.stdout))).toBe(true);
  });
});
