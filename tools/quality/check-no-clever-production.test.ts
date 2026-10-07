import { describe, expect, test } from "bun:test";
import { type ProvisioningFinding, scanForProvisioningClaims } from "./check-no-clever-production";

/**
 * WP-G2-Q01 acceptance criterion 3, made executable: no Clever Cloud resource
 * and no production claim exists in living surfaces before G4 (STATUS.md:
 * "Clever Cloud provisioning ... until G4"). The scanner is deliberately
 * narrow — it flags active provisioning/production signals, not the many
 * legitimate mentions of the future runtime target in doctrine and ADRs.
 */

function findingsFor(path: string, content: string): ProvisioningFinding[] {
  return scanForProvisioningClaims([{ path, content }]);
}

describe("scanForProvisioningClaims", () => {
  test("flags a concrete Clever Cloud addon URI (a real provisioned resource)", () => {
    const findings = findingsFor(
      "apps/notebook/config.ts",
      'const db = "postgresql://user:pw@bXXXX-postgresql.services.clever-cloud.com:5432/db";', // secret-scan:allowed-fixture
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toMatch(/clever-cloud/i);
  });

  test("flags a *_ADDON_URI environment binding (provisioned addon)", () => {
    const findings = findingsFor(
      "apps/radar/env.ts",
      "const uri = process.env.POSTGRESQL_ADDON_URI;",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toMatch(/addon.uri/i);
  });

  test("flags an explicit production-readiness claim", () => {
    const findings = findingsFor(
      "packages/data/README.md",
      "This module is production-ready and deployed to production.",
    );
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0]?.reason).toMatch(/production/i);
  });

  test("does NOT flag doctrinal mentions of the future runtime target", () => {
    // ADR-0001 I-07: "Cible runtime : Clever Cloud Paris/UE ; configuration et
    // provisioning seulement en G4." Naming the target is not provisioning it.
    const findings = findingsFor(
      "docs/decisions/INVARIANTS.md",
      "Cible runtime : Clever Cloud Paris/UE ; provisioning seulement en G4.",
    );
    expect(findings).toHaveLength(0);
  });

  test("does NOT flag a negated / deferral statement about production", () => {
    const findings = findingsFor(
      "STATUS.md",
      "no production authorization is granted; Clever Cloud provisioning is deferred until G4.",
    );
    expect(findings).toHaveLength(0);
  });

  test("does NOT flag the word production inside an unrelated identifier", () => {
    const findings = findingsFor(
      "packages/data/src/x.ts",
      "const productionsCount = items.length; // reproduction of a parser bug",
    );
    expect(findings).toHaveLength(0);
  });

  test("reports the path and a 1-based line number for each finding", () => {
    const findings = findingsFor(
      "apps/x/db.ts",
      "line one\nconst u = process.env.REDIS_ADDON_URI;\nline three",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe("apps/x/db.ts");
    expect(findings[0]?.line).toBe(2);
  });
});
