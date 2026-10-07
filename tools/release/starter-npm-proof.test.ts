import { describe, expect, test } from "bun:test";
import { isPrePublicationFailure, rewriteManifestForRegistry } from "./starter-npm-proof";

// Rewrite the starter template manifest for registry consumption: replace
// workspace:* refs with the linked version, and catalog:/catalog:testing refs
// with the exact versions from root catalogs. Fail-closed on unresolvable refs.

const baseManifest = {
  name: "@libre-ai/starter-template",
  version: "0.1.0",
  private: true,
  license: "Apache-2.0",
  dependencies: {
    "@libre-ai/ui": "workspace:*",
    "@libre-ai/web-platform": "workspace:*",
    "@libre-ai/auth-web": "workspace:*",
    "@libre-ai/contracts": "workspace:*",
    react: "catalog:",
    "react-dom": "catalog:",
  },
  devDependencies: {
    "@playwright/test": "catalog:testing",
  },
};

const opts = {
  linkedVersion: "0.1.0",
  catalog: {
    react: "19.2.7",
    "react-dom": "19.2.7",
  },
  testingCatalog: {
    "@playwright/test": "1.61.1",
  },
};

describe("rewriteManifestForRegistry", () => {
  test("rewrites workspace:* to linked version for libre-ai deps", () => {
    const result = rewriteManifestForRegistry(baseManifest, opts);
    expect(result.dependencies?.["@libre-ai/ui"]).toBe("^0.1.0");
    expect(result.dependencies?.["@libre-ai/contracts"]).toBe("^0.1.0");
  });

  test("rewrites catalog: to exact version from root catalog", () => {
    const result = rewriteManifestForRegistry(baseManifest, opts);
    expect(result.dependencies?.react).toBe("19.2.7");
    expect(result.dependencies?.["react-dom"]).toBe("19.2.7");
  });

  test("rewrites catalog:testing to exact version from testing catalog", () => {
    const result = rewriteManifestForRegistry(baseManifest, opts);
    expect(result.devDependencies?.["@playwright/test"]).toBe("1.61.1");
  });

  test("preserves private field (template remains private: true)", () => {
    const result = rewriteManifestForRegistry(baseManifest, opts);
    expect(result.private).toBe(true);
  });

  test("preserves other fields unchanged", () => {
    const result = rewriteManifestForRegistry(baseManifest, opts);
    expect(result.name).toBe("@libre-ai/starter-template");
    expect(result.license).toBe("Apache-2.0");
  });

  test("throws on unknown catalog ref", () => {
    const badManifest = {
      ...baseManifest,
      dependencies: { ...baseManifest.dependencies, xyz: "catalog:" },
    };
    expect(() => rewriteManifestForRegistry(badManifest, opts)).toThrow(/catalog/);
  });

  test("throws on unknown catalog:testing ref", () => {
    const badManifest = {
      ...baseManifest,
      devDependencies: { ...baseManifest.devDependencies, "@unknown/lib": "catalog:testing" },
    };
    expect(() => rewriteManifestForRegistry(badManifest, opts)).toThrow(/catalog:testing/);
  });

  test("throws on non-libre-ai workspace ref", () => {
    const badManifest = {
      ...baseManifest,
      dependencies: { ...baseManifest.dependencies, "@other-org/pkg": "workspace:*" },
    };
    expect(() => rewriteManifestForRegistry(badManifest, opts)).toThrow(/workspace:/);
  });

  test("handles optionalDependencies and peerDependencies", () => {
    const withOptional = {
      ...baseManifest,
      optionalDependencies: { react: "catalog:" },
      peerDependencies: { "@libre-ai/ui": "workspace:*" },
    };
    const result = rewriteManifestForRegistry(withOptional, opts);
    expect(result.optionalDependencies?.react).toBe("19.2.7");
    expect(result.peerDependencies?.["@libre-ai/ui"]).toBe("^0.1.0");
  });
});

// The pre-publication classifier must fire only on a 404/E404 for an @libre-ai
// package — never on a real post-publication failure that mentions the scope.
describe("isPrePublicationFailure", () => {
  test("true when the registry returns 404 for an @libre-ai package", () => {
    expect(
      isPrePublicationFailure("error: GET https://registry.npmjs.org/@libre-ai%2fui - 404"),
    ).toBe(true);
    expect(isPrePublicationFailure("npm error code E404\nnpm error 404 @libre-ai/contracts")).toBe(
      true,
    );
  });

  test("false for a real failure that merely mentions @libre-ai (no 404)", () => {
    expect(isPrePublicationFailure("error: @libre-ai/ui peer react@19 is not installed")).toBe(
      false,
    );
    expect(isPrePublicationFailure("@libre-ai/ui: ETIMEDOUT connecting to registry")).toBe(false);
  });

  test("false for a 404 unrelated to the @libre-ai scope", () => {
    expect(isPrePublicationFailure("GET https://registry.npmjs.org/left-pad - 404")).toBe(false);
  });
});
