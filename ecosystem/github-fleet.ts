/**
 * Shared GitHub access primitives for the fleet gates.
 *
 * Every gate that reads the organization through `gh` needs the same four
 * things: a retry budget, a sleep, a way to run one GraphQL request, and a
 * predicate telling a usable response apart from a top-level rejection.
 * Before this module each of them carried its own copy — `RETRY_DELAYS_MS`
 * in seven files, `delay` in six, `ghGraphQLRaw` in six,
 * `hasUsableGraphQLData` in four — byte-identical, and
 * `check-dependabot-conformance.ts` imported four of them from
 * `check-context-conformance.ts`, making one gate depend on another gate.
 *
 * Why these four and not the REST wrapper: `ghWithRetry` exists in three
 * genuinely different forms across the gates (`Bun.spawnSync` in
 * `check-hub-orphans.ts`, inline `Bun.spawn` in `check-toolchain-source.ts`,
 * an extracted async `ghRaw` in `check-context-conformance.ts`, with two
 * different argument types and two different 404 tests). Collapsing them
 * would be a behaviour change, not an extraction, so each keeps its own
 * until that change is decided on its own terms.
 */

/**
 * Two retries beyond the first attempt — 1s then 3s — before a caller gives
 * up and reports unable-to-verify. A fleet-wide scan that reported "missing"
 * for a repository it merely failed to reach is the incident this budget
 * exists to prevent; a confirmed 404 is an answer and is never retried.
 */
export const RETRY_DELAYS_MS = [1000, 3000];

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One `gh api graphql` request, query passed on stdin so it is never subject
 * to an argument-length limit. Returns the three raw channels rather than a
 * parsed body: `data` must be read from stdout regardless of exit code — a
 * partial NOT_FOUND on one alias makes `gh` exit non-zero even though the
 * response carries a complete, usable `data` object for every other alias
 * (verified empirically against the live API). The caller decides, through
 * `hasUsableGraphQLData`, whether that body is usable.
 */
export async function ghGraphQLRaw(
  query: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["gh", "api", "graphql", "-F", "query=@-"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(query);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/**
 * Pure: does this parsed `gh api graphql` response body carry a usable
 * `data` payload? False for a top-level rejection (`{"data": null,
 * "errors": [...]}` — the documented shape of a rate-limited/quota-exhausted
 * response: `data` is present, just explicitly `null`), a response with no
 * `data` key at all, or a non-object body. Treating `data: null` as success
 * would hand `null` to a batch parser, which reads it as "every repository
 * unresolved" in one pass with no retry and no REST fallback — the exact
 * class of incident the retry logic above exists to prevent, moved from the
 * REST 403 to the GraphQL top-level error.
 */
export function hasUsableGraphQLData(
  parsed: unknown,
): parsed is { readonly data: Record<string, unknown> } {
  if (typeof parsed !== "object" || parsed === null) return false;
  const data = (parsed as { readonly data?: unknown }).data;
  return typeof data === "object" && data !== null;
}
