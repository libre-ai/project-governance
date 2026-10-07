import { describe, expect, test } from "bun:test";
import {
  analyzeTarballEntries,
  analyzeTarballManifest,
  checkExpectedLicense,
  checkExportsResolve,
  checkVersionCoherence,
  EXPECTED_LICENSES,
} from "./publish-preflight";

// Fail-closed publish gate: a satellite tarball must be self-contained and
// clean BEFORE the owner runs bun publish. These are the pure analysis rules;
// the CLI packs each satellite for real and feeds the results here.

const cleanManifest = {
  name: "@libre-ai/contracts",
  version: "0.1.0",
  license: "Apache-2.0",
  dependencies: { ajv: "8.20.0" },
  peerDependencies: { react: "19.2.7" },
};

describe("analyzeTarballManifest", () => {
  test("accepts a clean materialized manifest", () => {
    expect(analyzeTarballManifest(cleanManifest)).toEqual([]);
  });

  test("flags residual workspace: and catalog: refs in any dependency group", () => {
    const issues = analyzeTarballManifest({
      ...cleanManifest,
      dependencies: { "@libre-ai/web-platform": "workspace:*" },
      peerDependencies: { react: "catalog:" },
    });
    expect(issues.some((issue) => issue.includes("workspace:"))).toBe(true);
    expect(issues.some((issue) => issue.includes("catalog:"))).toBe(true);
  });

  test("flags a private manifest and a missing license", () => {
    const issues = analyzeTarballManifest({ ...cleanManifest, private: true, license: undefined });
    expect(issues.some((issue) => issue.includes("private"))).toBe(true);
    expect(issues.some((issue) => issue.includes("license"))).toBe(true);
  });
});

describe("analyzeTarballEntries", () => {
  test("accepts src + LICENSE + README and flags missing LICENSE", () => {
    expect(analyzeTarballEntries(["package.json", "README.md", "LICENSE", "src/index.ts"])).toEqual(
      [],
    );
    const issues = analyzeTarballEntries(["package.json", "src/index.ts"]);
    expect(issues.some((issue) => issue.includes("LICENSE"))).toBe(true);
  });

  test("flags test files leaked into the tarball", () => {
    const issues = analyzeTarballEntries([
      "package.json",
      "LICENSE",
      "src/index.ts",
      "src/registry.test.ts",
    ]);
    expect(issues.some((issue) => issue.includes("registry.test.ts"))).toBe(true);
  });

  test("flags spec and non-ts test variants, not only .test.ts(x)", () => {
    for (const leaked of [
      "src/registry.spec.ts",
      "src/registry.test.tsx",
      "src/registry.test.js",
      "src/registry.test.mjs",
      "src/registry.spec.jsx",
    ]) {
      const issues = analyzeTarballEntries(["package.json", "LICENSE", "src/index.ts", leaked]);
      expect(issues.some((issue) => issue.includes(leaked))).toBe(true);
    }
  });

  test("does not flag ordinary source that merely contains 'test' in its name", () => {
    expect(
      analyzeTarballEntries(["package.json", "LICENSE", "src/test-utils.ts", "src/attestation.ts"]),
    ).toEqual([]);
  });
});

describe("checkExpectedLicense", () => {
  test("each satellite maps to its exact SPDX license (Apache-2.0 x3, EUPL-1.2)", () => {
    expect(EXPECTED_LICENSES["@libre-ai/contracts"]).toBe("Apache-2.0");
    expect(EXPECTED_LICENSES["@libre-ai/ui"]).toBe("Apache-2.0");
    expect(EXPECTED_LICENSES["@libre-ai/web-platform"]).toBe("Apache-2.0");
    expect(EXPECTED_LICENSES["@libre-ai/auth-web"]).toBe("EUPL-1.2");
  });

  test("accepts a manifest whose license matches the expected one", () => {
    expect(checkExpectedLicense({ name: "@libre-ai/auth-web", license: "EUPL-1.2" })).toEqual([]);
  });

  test("flags a license that drifted from the expected one", () => {
    const issues = checkExpectedLicense({ name: "@libre-ai/auth-web", license: "Apache-2.0" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("EUPL-1.2");
    expect(issues[0]).toContain("Apache-2.0");
  });

  test("fails closed on a satellite name absent from the expected map", () => {
    const issues = checkExpectedLicense({ name: "@libre-ai/mystery", license: "Apache-2.0" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("no expected license");
  });
});

describe("checkExportsResolve", () => {
  const entries = ["package.json", "LICENSE", "README.md", "src/index.ts", "dist/index.js"];

  test("accepts a manifest whose every exports/types target is shipped", () => {
    expect(
      checkExportsResolve(
        {
          name: "@libre-ai/ui",
          types: "./src/index.ts",
          exports: {
            ".": {
              types: "./src/index.ts",
              bun: "./src/index.ts",
              import: "./dist/index.js",
              default: "./dist/index.js",
            },
          },
        },
        entries,
      ),
    ).toEqual([]);
  });

  test("flags a conditional export target that was not packed", () => {
    const issues = checkExportsResolve(
      { name: "@libre-ai/ui", exports: { ".": { import: "./dist/missing.js" } } },
      entries,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("./dist/missing.js");
  });

  test("flags a top-level types target that was not packed", () => {
    const issues = checkExportsResolve(
      { name: "@libre-ai/x", types: "./dist/index.d.ts" },
      entries,
    );
    expect(issues.some((issue) => issue.includes("./dist/index.d.ts"))).toBe(true);
  });

  test("skips wildcard subpath targets (cannot match concrete entries)", () => {
    expect(
      checkExportsResolve(
        { name: "@libre-ai/contracts", exports: { "./generated/*": "./src/generated/*" } },
        entries,
      ),
    ).toEqual([]);
  });
});

describe("checkVersionCoherence", () => {
  test("accepts one shared version and flags drift", () => {
    expect(
      checkVersionCoherence([
        { name: "a", version: "0.1.0" },
        { name: "b", version: "0.1.0" },
      ]),
    ).toEqual([]);
    const issues = checkVersionCoherence([
      { name: "a", version: "0.1.0" },
      { name: "b", version: "0.2.0" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("0.2.0");
  });
});
