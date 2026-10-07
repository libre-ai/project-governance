import { describe, expect, test } from "bun:test";
import {
  type ForgottenRegister,
  findForbiddenCitations,
  findResurrections,
  findWildForgetting,
  parseRegister,
} from "./check-forgotten";

const REGISTER: ForgottenRegister = {
  entries: [
    {
      id: "forgotten.tree",
      evicted_paths: ["docs/dead/tree/"],
      recoverable_at: "cafebabe",
    },
    {
      id: "forgotten.file",
      evicted_paths: ["prompts/done.md"],
      recoverable_at: "cafebabe",
    },
  ],
  citation_allowlist: ["ecosystem/FORGOTTEN.yaml"],
};

describe("anti-resurrection", () => {
  test("flags a file back under an evicted directory", () => {
    const findings = findResurrections(REGISTER, ["docs/dead/tree/DESIGN.md", "README.md"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toContain("docs/dead/tree/DESIGN.md");
  });

  test("flags an evicted single file back in the tree", () => {
    expect(findResurrections(REGISTER, ["prompts/done.md"])).toHaveLength(1);
  });

  test("a sibling path that merely shares a prefix is not a resurrection", () => {
    expect(
      findResurrections(REGISTER, ["docs/dead/tree-notes.md", "prompts/done.md.bak"]),
    ).toHaveLength(0);
  });

  test("passes on a clean tree", () => {
    expect(findResurrections(REGISTER, ["README.md", "docs/positioning/website.md"])).toHaveLength(
      0,
    );
  });
});

describe("anti-citation", () => {
  test("flags a living document that names an evicted path", () => {
    const findings = findForbiddenCitations(REGISTER, [
      { path: "docs/plan.md", text: "voir docs/dead/tree/DESIGN.md pour la cible" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("citation");
  });

  test("matches a citation written without the trailing slash", () => {
    expect(
      findForbiddenCitations(REGISTER, [{ path: "docs/plan.md", text: "cf docs/dead/tree" }]),
    ).toHaveLength(1);
  });

  test("the register itself may name what it forgets", () => {
    expect(
      findForbiddenCitations(REGISTER, [
        { path: "ecosystem/FORGOTTEN.yaml", text: "docs/dead/tree/ and prompts/done.md" },
      ]),
    ).toHaveLength(0);
  });
});

describe("anti-wild-forgetting", () => {
  test("fails when recoverable_at does not resolve", () => {
    const findings = findWildForgetting(REGISTER, () => null);
    expect(findings).toHaveLength(2);
    expect(findings[0]?.detail).toContain("does not resolve");
  });

  test("fails when the recorded commit does not carry the evicted content", () => {
    const findings = findWildForgetting(REGISTER, () => ["README.md"]);
    expect(findings).toHaveLength(2);
    expect(findings[0]?.detail).toContain("does not carry");
  });

  test("passes when the commit carries every evicted path", () => {
    const findings = findWildForgetting(REGISTER, () => [
      "docs/dead/tree/DESIGN.md",
      "prompts/done.md",
    ]);
    expect(findings).toHaveLength(0);
  });
});

describe("register parsing", () => {
  test("reads entries and allow-list", () => {
    const register = parseRegister(`
version: 1
entries:
  - id: forgotten.example
    evicted_paths:
      - docs/gone/
    recoverable_at: deadbeef
citation_allowlist:
  - ecosystem/FORGOTTEN.yaml
`);
    expect(register.entries).toHaveLength(1);
    expect(register.entries[0]?.id).toBe("forgotten.example");
    expect(register.citation_allowlist).toContain("ecosystem/FORGOTTEN.yaml");
  });

  test("rejects a register without entries", () => {
    expect(() => parseRegister("version: 1\n")).toThrow("missing `entries`");
  });

  test("defaults the allow-list to empty", () => {
    const register = parseRegister(`
entries:
  - id: forgotten.example
    evicted_paths: [docs/gone/]
    recoverable_at: deadbeef
`);
    expect(register.citation_allowlist).toEqual([]);
  });
});

describe("the real register", () => {
  test("every entry declares paths and a recovery commit", async () => {
    const register = parseRegister(await Bun.file("ecosystem/FORGOTTEN.yaml").text());
    expect(register.entries.length).toBeGreaterThan(0);
    for (const entry of register.entries) {
      expect(entry.id).toMatch(/^forgotten\./);
      expect(entry.evicted_paths.length).toBeGreaterThan(0);
      expect(entry.recoverable_at).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});
