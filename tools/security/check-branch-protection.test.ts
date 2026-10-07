import { describe, expect, test } from "bun:test";
import {
  auditProtection,
  type CiSnapshot,
  computeFix,
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
