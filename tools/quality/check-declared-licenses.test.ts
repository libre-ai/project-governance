import { describe, expect, test } from "bun:test";
import {
  classifyBunManifest,
  classifyCargoManifest,
  evaluateTarget,
  filesOwnedBy,
  isEditorialProse,
  type PublishableTarget,
  parseDeclaredExpression,
  parseLicenseDeclaration,
  parseLicenseDocumentIdentifiers,
  parseSpdxDocument,
  type SpdxFileAttribution,
} from "./check-declared-licenses";

/**
 * The gate's own regression suite. It covers the shapes the repository does not
 * currently contain — dual licences, workspace-inherited crate licences, a
 * manifest with no licence at all — so those paths are exercised before a real
 * package first exhibits them, not after.
 */

const SPDX_SAMPLE = [
  "SPDXVersion: SPDX-2.1",
  "DataLicense: CC0-1.0",
  "",
  "FileName: ./packages/ui/src/index.ts",
  "SPDXID: SPDXRef-1",
  "LicenseConcluded: NOASSERTION",
  "LicenseInfoInFile: Apache-2.0",
  "FileCopyrightText: <text>SPDX-FileCopyrightText: 2026 Libre AI contributors</text>",
  "",
  "FileName: ./third_party/aes/Cargo.toml",
  "SPDXID: SPDXRef-2",
  "LicenseInfoInFile: Apache-2.0",
  "LicenseInfoInFile: MIT",
  "FileCopyrightText: <text>SPDX-FileCopyrightText: 2018 Artyom Pavlov",
  "FileName: not-a-real-entry-inside-a-copyright-block",
  "SPDX-FileCopyrightText: RustCrypto Developers</text>",
  "",
  "FileName: ./packages/x/README.md",
  "SPDXID: SPDXRef-3",
  "LicenseInfoInFile: CC-BY-4.0",
  "FileCopyrightText: NONE",
].join("\n");

describe("parseSpdxDocument", () => {
  test("reads one attribution per file and strips the leading ./", () => {
    const attributions = parseSpdxDocument(SPDX_SAMPLE);
    expect(attributions.map((entry) => entry.path)).toEqual([
      "packages/ui/src/index.ts",
      "third_party/aes/Cargo.toml",
      "packages/x/README.md",
    ]);
  });

  test("keeps a dual licence as a set of identifiers", () => {
    const attributions = parseSpdxDocument(SPDX_SAMPLE);
    expect(attributions[1]?.licenses).toEqual(["Apache-2.0", "MIT"]);
  });

  test("ignores tags inside a multi-line copyright block", () => {
    const attributions = parseSpdxDocument(SPDX_SAMPLE);
    expect(attributions.some((entry) => entry.path.includes("not-a-real-entry"))).toBe(false);
  });

  test("returns nothing for a document without files", () => {
    expect(parseSpdxDocument("SPDXVersion: SPDX-2.1\nDataLicense: CC0-1.0")).toEqual([]);
  });
});

describe("parseDeclaredExpression", () => {
  test("accepts a single identifier", () => {
    expect(parseDeclaredExpression("EUPL-1.2")).toEqual(["EUPL-1.2"]);
  });

  test("accepts a disjunction, matching how REUSE decomposes it", () => {
    expect(parseDeclaredExpression("MIT OR Apache-2.0")).toEqual(["MIT", "Apache-2.0"]);
  });

  test("refuses an expression it does not model rather than guessing", () => {
    expect(parseDeclaredExpression("Apache-2.0 WITH LLVM-exception")).toBeNull();
    expect(parseDeclaredExpression("(MIT OR Apache-2.0) AND CC0-1.0")).toBeNull();
    expect(parseDeclaredExpression("   ")).toBeNull();
  });
});

describe("parseLicenseDeclaration", () => {
  test("recognises an npm licence-file declaration", () => {
    expect(parseLicenseDeclaration("SEE LICENSE IN LICENSING.md")).toEqual({
      kind: "file",
      relativePath: "LICENSING.md",
    });
  });

  test("refuses paths that can escape or vary across platforms", () => {
    for (const declaration of [
      "SEE LICENSE IN ../LICENSING.md",
      "SEE LICENSE IN /LICENSING.md",
      "SEE LICENSE IN docs\\LICENSING.md",
      "SEE LICENSE IN docs//LICENSING.md",
    ]) {
      expect(parseLicenseDeclaration(declaration).kind).toBe("invalid");
    }
  });
});

describe("parseLicenseDocumentIdentifiers", () => {
  test("reads exact level-two SPDX headings", () => {
    expect(
      parseLicenseDocumentIdentifiers(
        "# Distribution licences\n\n## `Apache-2.0`\n\nCode.\n\n## `LicenseRef-Brand-1.0`\n\nMark.\n",
      ),
    ).toEqual(["Apache-2.0", "LicenseRef-Brand-1.0"]);
  });

  test("refuses duplicate or malformed licence headings", () => {
    expect(parseLicenseDocumentIdentifiers("## `Apache-2.0`\n\n## `Apache-2.0`\n")).toBeNull();
    expect(parseLicenseDocumentIdentifiers("## Apache-2.0\n")).toBeNull();
  });
});

describe("isEditorialProse", () => {
  test("recognises Markdown under the documentation licence", () => {
    expect(isEditorialProse("packages/x/README.md", ["CC-BY-4.0"])).toBe(true);
  });

  test("does not exempt a source file under the documentation licence", () => {
    expect(isEditorialProse("packages/x/src/index.ts", ["CC-BY-4.0"])).toBe(false);
  });

  test("does not exempt Markdown under any other licence", () => {
    expect(isEditorialProse("packages/x/README.md", ["EUPL-1.2"])).toBe(false);
  });
});

describe("classifyBunManifest", () => {
  test("excludes a manifest that opts out of publication", () => {
    const result = classifyBunManifest("apps/radar/package.json", { private: true });
    expect(result).toEqual({ kind: "excluded", reason: "private: true" });
  });

  test("includes a manifest without the private flag", () => {
    const result = classifyBunManifest("packages/ui/package.json", {
      name: "@libre-ai/ui",
      license: "Apache-2.0",
    });
    expect(result.kind).toBe("publishable");
    if (result.kind !== "publishable") return;
    expect(result.target.directory).toBe("packages/ui");
    expect(result.target.declared).toBe("Apache-2.0");
  });

  test("records a missing licence as absent rather than defaulting it", () => {
    const result = classifyBunManifest("packages/x/package.json", { name: "@libre-ai/x" });
    expect(result.kind).toBe("publishable");
    if (result.kind !== "publishable") return;
    expect(result.target.declared).toBeNull();
  });
});

describe("classifyCargoManifest", () => {
  test("excludes a crate with publish disabled", () => {
    const result = classifyCargoManifest(
      "crates/policy-core/Cargo.toml",
      { package: { name: "policy-core", publish: false } },
      "EUPL-1.2",
    );
    expect(result).toEqual({ kind: "excluded", reason: "publish disabled" });
  });

  test("excludes a crate publishing to an empty registry list", () => {
    const result = classifyCargoManifest(
      "crates/x/Cargo.toml",
      { package: { name: "x", publish: [] } },
      "EUPL-1.2",
    );
    expect(result).toEqual({ kind: "excluded", reason: "publish disabled" });
  });

  test("excludes the virtual workspace manifest", () => {
    const result = classifyCargoManifest("Cargo.toml", {}, "EUPL-1.2");
    expect(result).toEqual({ kind: "excluded", reason: "workspace manifest, no [package]" });
  });

  test("excludes vendored third-party material", () => {
    const result = classifyCargoManifest(
      "third_party/rustcrypto-aes-0.8.4/Cargo.toml",
      { package: { name: "aes", license: "MIT OR Apache-2.0" } },
      "EUPL-1.2",
    );
    expect(result).toEqual({ kind: "excluded", reason: "vendored third-party material" });
  });

  test("includes a publishable crate and resolves workspace licence inheritance", () => {
    const result = classifyCargoManifest(
      "crates/sdk/Cargo.toml",
      { package: { name: "sdk", license: { workspace: true } } },
      "EUPL-1.2",
    );
    expect(result.kind).toBe("publishable");
    if (result.kind !== "publishable") return;
    expect(result.target.declared).toBe("EUPL-1.2");
  });
});

describe("filesOwnedBy", () => {
  const attributions: SpdxFileAttribution[] = [
    { path: "packages/ui/src/index.ts", licenses: ["Apache-2.0"] },
    { path: "packages/ui/nested/package.json", licenses: ["EUPL-1.2"] },
    { path: "packages/ui/nested/src/a.ts", licenses: ["EUPL-1.2"] },
    { path: "packages/other/src/b.ts", licenses: ["EUPL-1.2"] },
  ];

  test("claims only files under the directory", () => {
    const owned = filesOwnedBy("packages/ui", ["packages/ui"], attributions);
    expect(owned.map((file) => file.path)).not.toContain("packages/other/src/b.ts");
  });

  test("does not claim files a nested manifest owns", () => {
    const owned = filesOwnedBy("packages/ui", ["packages/ui", "packages/ui/nested"], attributions);
    expect(owned.map((file) => file.path)).toEqual(["packages/ui/src/index.ts"]);
  });
});

const target = (declared: string | null): PublishableTarget => ({
  manifestPath: "packages/x/package.json",
  directory: "packages/x",
  name: "@libre-ai/x",
  declared,
});

describe("evaluateTarget", () => {
  test("conforming when every compared file carries the declared licence", () => {
    const verdict = evaluateTarget(target("Apache-2.0"), [
      { path: "packages/x/src/a.ts", licenses: ["Apache-2.0"] },
      { path: "packages/x/src/b.ts", licenses: ["Apache-2.0"] },
    ]);
    expect(verdict.state).toBe("conforming");
    if (verdict.state !== "conforming") return;
    expect(verdict.compared).toBe(2);
  });

  test("divergent on the exact defect that shipped: Apache claim over EUPL sources", () => {
    const verdict = evaluateTarget(target("Apache-2.0"), [
      { path: "packages/x/src/a.ts", licenses: ["EUPL-1.2"] },
      { path: "packages/x/src/b.ts", licenses: ["Apache-2.0"] },
    ]);
    expect(verdict.state).toBe("divergent");
    if (verdict.state !== "divergent") return;
    expect(verdict.divergences).toEqual([{ path: "packages/x/src/a.ts", effective: "EUPL-1.2" }]);
  });

  test("skips editorial prose but still compares the software", () => {
    const verdict = evaluateTarget(target("EUPL-1.2"), [
      { path: "packages/x/README.md", licenses: ["CC-BY-4.0"] },
      { path: "packages/x/src/a.ts", licenses: ["EUPL-1.2"] },
    ]);
    expect(verdict.state).toBe("conforming");
    if (verdict.state !== "conforming") return;
    expect(verdict.compared).toBe(1);
    expect(verdict.editorialSkipped).toBe(1);
  });

  test("still fails when a source, not prose, carries the documentation licence", () => {
    const verdict = evaluateTarget(target("EUPL-1.2"), [
      { path: "packages/x/src/a.ts", licenses: ["CC-BY-4.0"] },
    ]);
    expect(verdict.state).toBe("divergent");
  });

  test("matches a dual licence against the identifier set REUSE resolves", () => {
    const verdict = evaluateTarget(target("MIT OR Apache-2.0"), [
      { path: "packages/x/src/a.ts", licenses: ["Apache-2.0", "MIT"] },
    ]);
    expect(verdict.state).toBe("conforming");
  });

  test("rejects a file carrying only one half of a declared dual licence", () => {
    const verdict = evaluateTarget(target("MIT OR Apache-2.0"), [
      { path: "packages/x/src/a.ts", licenses: ["MIT"] },
    ]);
    expect(verdict.state).toBe("divergent");
  });

  test("indeterminate, not conforming, when the manifest declares no licence", () => {
    const verdict = evaluateTarget(target(null), [
      { path: "packages/x/src/a.ts", licenses: ["EUPL-1.2"] },
    ]);
    expect(verdict.state).toBe("indeterminate");
  });

  test("indeterminate when the declared expression is not modelled", () => {
    const verdict = evaluateTarget(target("Apache-2.0 WITH LLVM-exception"), [
      { path: "packages/x/src/a.ts", licenses: ["Apache-2.0"] },
    ]);
    expect(verdict.state).toBe("indeterminate");
  });

  test("indeterminate when nothing was attributed — an empty scan never reads as clean", () => {
    const verdict = evaluateTarget(target("Apache-2.0"), []);
    expect(verdict.state).toBe("indeterminate");
    if (verdict.state !== "indeterminate") return;
    expect(verdict.reason).toContain("no attributed software file");
  });

  test("indeterminate when only editorial prose remains after the skip", () => {
    const verdict = evaluateTarget(target("Apache-2.0"), [
      { path: "packages/x/README.md", licenses: ["CC-BY-4.0"] },
    ]);
    expect(verdict.state).toBe("indeterminate");
  });

  test("reports a file REUSE could not license as a divergence, never as a pass", () => {
    const verdict = evaluateTarget(target("Apache-2.0"), [
      { path: "packages/x/src/a.ts", licenses: [] },
    ]);
    expect(verdict.state).toBe("divergent");
    if (verdict.state !== "divergent") return;
    expect(verdict.divergences[0]?.effective).toBe("no licence resolved");
  });

  test("accepts a mixed package only when its licence file lists the exact REUSE union", () => {
    const verdict = evaluateTarget(
      target("SEE LICENSE IN LICENSING.md"),
      [
        { path: "packages/x/LICENSING.md", licenses: ["Apache-2.0"] },
        { path: "packages/x/src/a.ts", licenses: ["Apache-2.0"] },
        { path: "packages/x/assets/mark.svg", licenses: ["LicenseRef-Brand-1.0"] },
      ],
      new Map([
        [
          "packages/x/LICENSING.md",
          "# Distribution licences\n\n## `Apache-2.0`\n\nCode.\n\n## `LicenseRef-Brand-1.0`\n\nMark.\n",
        ],
      ]),
    );
    expect(verdict.state).toBe("conforming");
    if (verdict.state !== "conforming") return;
    expect(verdict.compared).toBe(3);
  });

  test("refuses a missing licence file", () => {
    const verdict = evaluateTarget(target("SEE LICENSE IN LICENSING.md"), [
      { path: "packages/x/src/a.ts", licenses: ["Apache-2.0"] },
      { path: "packages/x/assets/mark.svg", licenses: ["LicenseRef-Brand-1.0"] },
    ]);
    expect(verdict.state).toBe("indeterminate");
    if (verdict.state !== "indeterminate") return;
    expect(verdict.reason).toContain("not tracked or unreadable");
  });

  test("rejects an incomplete or extraneous licence-file inventory", () => {
    const ownedFiles: SpdxFileAttribution[] = [
      { path: "packages/x/LICENSING.md", licenses: ["Apache-2.0"] },
      { path: "packages/x/src/a.ts", licenses: ["Apache-2.0"] },
      { path: "packages/x/assets/mark.svg", licenses: ["LicenseRef-Brand-1.0"] },
    ];

    for (const document of [
      "## `Apache-2.0`\n",
      "## `Apache-2.0`\n\n## `LicenseRef-Brand-1.0`\n\n## `MIT`\n",
    ]) {
      const verdict = evaluateTarget(
        target("SEE LICENSE IN LICENSING.md"),
        ownedFiles,
        new Map([["packages/x/LICENSING.md", document]]),
      );
      expect(verdict.state).toBe("divergent");
    }
  });

  test("does not let a licence file hide unresolved REUSE attribution", () => {
    const verdict = evaluateTarget(
      target("SEE LICENSE IN LICENSING.md"),
      [
        { path: "packages/x/LICENSING.md", licenses: ["Apache-2.0"] },
        { path: "packages/x/src/a.ts", licenses: [] },
        { path: "packages/x/assets/mark.svg", licenses: ["LicenseRef-Brand-1.0"] },
      ],
      new Map([["packages/x/LICENSING.md", "## `Apache-2.0`\n\n## `LicenseRef-Brand-1.0`\n"]]),
    );
    expect(verdict.state).toBe("divergent");
    if (verdict.state !== "divergent") return;
    expect(verdict.divergences).toContainEqual({
      path: "packages/x/src/a.ts",
      effective: "no licence resolved",
    });
  });

  test("keeps direct SPDX declarations mandatory for single-licence packages", () => {
    const verdict = evaluateTarget(
      target("SEE LICENSE IN LICENSING.md"),
      [
        { path: "packages/x/LICENSING.md", licenses: ["Apache-2.0"] },
        { path: "packages/x/src/a.ts", licenses: ["Apache-2.0"] },
      ],
      new Map([["packages/x/LICENSING.md", "## `Apache-2.0`\n"]]),
    );
    expect(verdict.state).toBe("indeterminate");
    if (verdict.state !== "indeterminate") return;
    expect(verdict.reason).toContain("distinct effective licences");
  });
});
