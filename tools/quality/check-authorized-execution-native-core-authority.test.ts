import { describe, expect, test } from "bun:test";

interface WorkPackage {
  readonly id: string;
  readonly dependsOn: readonly string[];
  readonly definitionStatus: string;
  readonly writePaths: readonly string[];
  readonly acceptance: readonly string[];
}

interface WorkPackagePlan {
  readonly packages: readonly WorkPackage[];
}

const expectedWritePaths = [
  "src/authorized_execution/**",
  "tests/authorized_execution_*.rs",
  "tests/support/**",
  "benches/authorized_execution_replay.rs",
  "bun.lock",
  "docs/compat/**",
  "docs/reviews/authorized-execution-native-core/**",
  "tools/quality/authorized-execution-authority.test.ts",
  "tests/compat_surface.rs",
  "tests/compat/**",
  "src/lib.rs",
] as const;

describe("authorized execution native-core authority", () => {
  test("binds ADR-0037, D43 and the bounded work package", async () => {
    const [adrExists, decisionRegister, plan] = await Promise.all([
      Bun.file("docs/adr/0037-authorized-execution-native-core.md").exists(),
      Bun.file("docs/decisions/DECISION-REGISTER.md").text(),
      Bun.file("docs/transformation/work-packages.v1.json").json() as Promise<WorkPackagePlan>,
    ]);
    const workPackage = plan.packages.find((entry) => entry.id === "WP-G3-O02");

    expect(adrExists).toBeTrue();
    expect(decisionRegister).toContain(
      "| D43 | The native authorized-execution core is pure and non-normative",
    );
    expect(workPackage?.definitionStatus).toBe("locked");
    expect(workPackage?.dependsOn).toEqual(["WP-G2-C01"]);
    expect(workPackage?.writePaths).toEqual(expectedWritePaths);
    expect(workPackage?.acceptance).toHaveLength(6);
  });
});
