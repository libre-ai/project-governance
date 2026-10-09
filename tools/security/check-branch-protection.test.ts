import { describe, expect, test } from "bun:test";
import {
  auditProtection,
  type CiSnapshot,
  computeFix,
  fetchRepositoryState,
  type GhApi,
  type ProtectionSnapshot,
  planFix,
  selectActivePublicRepositories,
} from "./check-branch-protection";

test("branch-protection fleet targets exclude private repositories before remote reads", () => {
  expect(
    selectActivePublicRepositories([
      { repository: "libre-ai/public", lifecycle: "active", visibility: "public" },
      {
        repository: "libre-ai/product-research",
        lifecycle: "active",
        visibility: "private",
      },
      { repository: "libre-ai/archive", lifecycle: "archived", visibility: "public" },
    ]),
  ).toEqual(["libre-ai/public"]);
});

const protection = (required: readonly string[]): ProtectionSnapshot => ({ required });
const ci = (observed: readonly string[]): CiSnapshot => ({ observed });

describe("auditProtection", () => {
  test("required matches observed exactly: ok, no findings", () => {
    const audit = auditProtection(
      "libre-ai/auth",
      protection([
        "Bun quality",
        "context-hygiene / No private identifiers or machine-local paths",
      ]),
      ci(["context-hygiene / No private identifiers or machine-local paths", "Bun quality"]),
    );
    expect(audit.ok).toBe(true);
    expect(audit.phantom).toEqual([]);
    expect(audit.decorative).toEqual([]);
  });

  test("phantom required check — the website 'REUSE compliance' case", () => {
    // website requires "REUSE compliance", a job name no workflow on main
    // produces any more: the licensing job was migrated to the reusable
    // template and now reports as "licensing / Licensing and contribution
    // governance", which nothing requires.
    const audit = auditProtection(
      "libre-ai/website",
      protection([
        "No private identifiers or machine-local paths",
        "Bun quality",
        "REUSE compliance",
      ]),
      ci([
        "No private identifiers or machine-local paths",
        "Bun quality",
        "licensing / Licensing and contribution governance",
      ]),
    );
    expect(audit.ok).toBe(false);
    expect(audit.phantom).toEqual(["REUSE compliance"]);
    expect(audit.decorative).toEqual(["licensing / Licensing and contribution governance"]);
  });

  test("decorative checks — the db-inspect case: real jobs run but are not required", () => {
    const audit = auditProtection(
      "libre-ai/db-inspect",
      protection(["No private identifiers or machine-local paths"]),
      ci([
        "No private identifiers or machine-local paths",
        "Rust quality",
        "Dependency policy",
        "licensing / Licensing and contribution governance",
      ]),
    );
    expect(audit.ok).toBe(false);
    expect(audit.phantom).toEqual([]);
    expect(audit.decorative).toEqual([
      "Dependency policy",
      "Rust quality",
      "licensing / Licensing and contribution governance",
    ]);
  });

  test("both directions of drift at once", () => {
    const audit = auditProtection(
      "libre-ai/example",
      protection(["stale-check", "still-real"]),
      ci(["still-real", "new-unrequired"]),
    );
    expect(audit.ok).toBe(false);
    expect(audit.phantom).toEqual(["stale-check"]);
    expect(audit.decorative).toEqual(["new-unrequired"]);
  });

  test("output is sorted and de-duplicated regardless of input order", () => {
    const audit = auditProtection(
      "libre-ai/example",
      protection(["zebra-required", "alpha-required"]),
      ci(["alpha-required", "alpha-required", "zebra-required"]),
    );
    expect(audit.ok).toBe(true);
    expect(audit.phantom).toEqual([]);
    expect(audit.decorative).toEqual([]);
  });

  test("no protection and no CI: vacuously ok — nothing to compare", () => {
    const audit = auditProtection("libre-ai/example", protection([]), ci([]));
    expect(audit.ok).toBe(true);
  });
});

describe("computeFix", () => {
  test("required set becomes exactly what CI produces, sorted and de-duplicated", () => {
    expect(computeFix(ci(["b", "a", "a", "c"]))).toEqual(["a", "b", "c"]);
  });

  test("empty CI observation yields an empty fix (the raw computation, unguarded)", () => {
    expect(computeFix(ci([]))).toEqual([]);
  });
});

describe("planFix", () => {
  test("applies the computed fix when CI observed at least one check", () => {
    const plan = planFix(protection(["stale"]), ci(["real-check"]));
    expect(plan).toEqual({ kind: "apply", contexts: ["real-check"] });
  });

  test("applies an empty fix when protection already required nothing", () => {
    // Not a safety concern: this repository never required anything, so
    // "still nothing" is not a loss of coverage.
    const plan = planFix(protection([]), ci([]));
    expect(plan).toEqual({ kind: "apply", contexts: [] });
  });

  test("refuses to empty a branch that currently has required checks", () => {
    // Guards against a fetch failure read as "CI runs nothing" silently
    // stripping every required check via --fix.
    const plan = planFix(protection(["Bun quality", "context-hygiene"]), ci([]));
    expect(plan.kind).toBe("refuse");
    if (plan.kind === "refuse") {
      expect(plan.reason).toContain("refusing to fix to empty");
    }
  });
});

// `ghApi` reports a 404 as `{ text: null, error: null }`, because on the
// protection endpoint a 404 is the answer: this branch has no protection. On
// the repository endpoint it is not an answer — the inventory declares the
// repository, so a 404 means it stopped resolving. Measured 2026-10-09 on the
// `repoInfo.text as string` cast that stood here: `TypeError - null is not an
// object (evaluating 'JSON.parse(repoInfo.text).default_branch')`, thrown out
// of the gate, which ends the fleet sweep at the first renamed repository and
// takes every repository after it in the loop with it. One field deeper, a 200
// without `default_branch` reaches a GREEN: measured with an explicit `--ref`
// (so the commit lookup that otherwise catches it resolves),
// `branches/undefined/protection` answers 404 and the gate reports "no branch
// protection configured — outside this gate's scope" over a repository it never
// read; with `--fix` it would PATCH `branches/undefined`.
describe("an unreadable repository response is a named failure, not a crash or a green", () => {
  const notFound: GhApi = () => ({ text: null, error: null });

  test("a 404 on the repository fails the gate with a message", () => {
    const state = fetchRepositoryState("libre-ai/gone", undefined, notFound);

    expect(state).toHaveProperty("error");
    if ("error" in state) {
      expect(state.error).toContain("libre-ai/gone");
      expect(state.error).toContain("HTTP 404");
    }
  });

  test("a 200 without default_branch fails instead of passing as unprotected", () => {
    // Every read AFTER the repository one succeeds here, so nothing downstream
    // can stand in for the missing guard: with an explicit ref the commit
    // lookup resolves, `branches/undefined/protection` answers 404, and the
    // only thing left to notice that `default_branch` was never read is the
    // guard under test. Unguarded, this returns `hasProtection: false` — the
    // gate's green.
    const api: GhApi = (path) => {
      if (path === "repos/libre-ai/odd") return { text: JSON.stringify({ id: 1 }), error: null };
      if (path.includes("/check-runs")) {
        return { text: JSON.stringify({ check_runs: [{ name: "Bun quality" }] }), error: null };
      }
      if (path.includes("/commits/")) {
        return { text: JSON.stringify({ sha: "feedface" }), error: null };
      }
      // `branches/undefined/protection`: a 404, read as "no protection".
      return { text: null, error: null };
    };

    const state = fetchRepositoryState("libre-ai/odd", "feedface", api);

    expect(state).toHaveProperty("error");
    if ("error" in state) expect(state.error).toContain("no default_branch");
  });

  test("a readable repository still reads through to its CI observation", () => {
    const api: GhApi = (path) => {
      if (path === "repos/libre-ai/live") {
        return { text: JSON.stringify({ default_branch: "trunk" }), error: null };
      }
      if (path === "repos/libre-ai/live/branches/trunk/protection") {
        return {
          text: JSON.stringify({
            required_status_checks: { strict: false, contexts: ["Bun quality"] },
          }),
          error: null,
        };
      }
      if (path.includes("/check-runs")) {
        return { text: JSON.stringify({ check_runs: [{ name: "Bun quality" }] }), error: null };
      }
      return { text: JSON.stringify({ sha: "feedface" }), error: null };
    };

    const state = fetchRepositoryState("libre-ai/live", undefined, api);

    expect(state).not.toHaveProperty("error");
    if (!("error" in state)) {
      expect(state.branch).toBe("trunk");
      expect(state.hasProtection).toBe(true);
      expect(state.strict).toBe(false);
      expect(state.protection.required).toEqual(["Bun quality"]);
      expect(state.ci.observed).toEqual(["Bun quality"]);
    }
  });
});
