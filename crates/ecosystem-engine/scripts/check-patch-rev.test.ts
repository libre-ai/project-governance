import { describe, expect, test } from "bun:test";
import {
  CargoTomlParseError,
  classifyContainment,
  declaresWorkspace,
  findStrayPatchTables,
  inspectCorpus,
  isOnMain,
  NO_PATCH_NOTE,
  type PatchScan,
  parseSymrefHead,
  scanPatches,
} from "./check-patch-rev";

const REV = "81ce4b579d383f8368f06c8f4e6e3765b518225f";
const FIXTURES = new URL("../tests/fixtures/patch-rev/", import.meta.url);

async function fixture(name: string): Promise<string> {
  return await Bun.file(new URL(name, FIXTURES)).text();
}

describe("scanPatches — accepted forms", () => {
  test("reads an intra-organisation git patch with a full sha, counts every patch entry", async () => {
    const scan = scanPatches(await fixture("ok-inline.toml"));
    expect(scan.entries).toBe(2);
    expect(scan.rejections).toEqual([]);
    expect(scan.patches).toEqual([
      {
        section: "crates-io",
        crate: "biscuit-auth",
        owner: "libre-ai",
        repo: "authz-biscuit",
        rev: REV,
      },
    ]);
  });

  test("ignores path patches, comments and other sections", async () => {
    const scan = scanPatches(await fixture("ok-inline.toml"));
    expect(scan.patches.map((patch) => patch.crate)).toEqual(["biscuit-auth"]);
  });

  test("key order, single quotes and spacing do not matter", async () => {
    const scan = scanPatches(await fixture("key-order.toml"));
    expect(scan.entries).toBe(1);
    expect(scan.rejections).toEqual([]);
    expect(scan.patches.map((patch) => patch.rev)).toEqual([REV]);
  });

  test("the dedicated-table form [patch.crates-io.<crate>] is the same entry", async () => {
    const scan = scanPatches(await fixture("table-form.toml"));
    expect(scan.entries).toBe(1);
    expect(scan.rejections).toEqual([]);
    expect(scan.patches.map((patch) => `${patch.repo}@${patch.rev}`)).toEqual([
      `authz-biscuit@${REV}`,
    ]);
  });

  test('a [patch."https://…"] source section is scanned like crates-io', async () => {
    const scan = scanPatches(await fixture("url-section.toml"));
    expect(scan.entries).toBe(2);
    expect(scan.patches.map((patch) => patch.crate)).toEqual(["bar"]);
    expect(scan.rejections.map((rejection) => rejection.crate)).toEqual(["baz"]);
    expect(scan.patches[0]?.section).toBe("https://github.com/libre-ai/foo");
  });

  test("entries outside the organisation are counted but neither checked nor rejected", async () => {
    const scan = scanPatches(await fixture("external.toml"));
    expect(scan.entries).toBe(2);
    expect(scan.patches).toEqual([]);
    expect(scan.rejections).toEqual([]);
  });
});

describe("scanPatches — rejected forms (ADR-0031 D2: a full sha, never a branch or tag)", () => {
  const rejected: ReadonlyArray<readonly [fixture: string, reason: RegExp]> = [
    ["rev-branch.toml", /rev "main" is not a full lowercase 40-hex sha/],
    ["key-order-branch.toml", /rev "main" is not a full lowercase 40-hex sha/],
    ["table-form-branch.toml", /rev "v1" is not a full lowercase 40-hex sha/],
    ["rev-short.toml", /rev "81ce4b5" is not a full lowercase 40-hex sha/],
    ["rev-uppercase.toml", /is not a full lowercase 40-hex sha/],
    ["rev-missing.toml", /no rev/],
    ["branch-key.toml", /branch = "main" is forbidden/],
    ["tag-key.toml", /tag = "v6\.0\.0" is forbidden/],
    ["string-entry.toml", /cannot parse/],
  ];

  for (const [name, reason] of rejected) {
    test(`${name} is red with an explicit reason, never a silent zero`, async () => {
      const scan = scanPatches(await fixture(name));
      expect(scan.entries).toBe(1);
      expect(scan.patches).toEqual([]);
      expect(scan.rejections).toHaveLength(1);
      expect(scan.rejections[0]?.crate).toBe("biscuit-auth");
      expect(scan.rejections[0]?.reason).toMatch(reason);
    });
  }
});

describe("scanPatches — cannot parse is red, not zero", () => {
  test("a manifest the TOML parser refuses raises CargoTomlParseError", async () => {
    const manifest = await fixture("unparseable.toml");
    expect(() => scanPatches(manifest)).toThrow(CargoTomlParseError);
  });

  test("a parser that silently drops an organisation git source is caught by the raw-text cross-check", () => {
    const manifest = `[patch.crates-io]\nbiscuit-auth = { git = "https://github.com/libre-ai/authz-biscuit", rev = "${REV}" }\n`;
    const lenientParser = (): unknown => ({});
    expect(() => scanPatches(manifest, lenientParser)).toThrow(CargoTomlParseError);
    expect(() => scanPatches(manifest, lenientParser)).toThrow(
      /1 organisation git source\(s\) in the text, 0 in the parsed manifest/,
    );
  });

  test("the cross-check ignores comments and counts sources anywhere, not only under [patch]", async () => {
    const scan = scanPatches(await fixture("ok-inline.toml"));
    expect(scan.organisationSources).toBe(2);
  });

  test("a manifest without any [patch] table is zero entries, zero sources", () => {
    const scan = scanPatches(`[package]\nname = "x"\n`);
    expect(scan).toEqual({ entries: 0, organisationSources: 0, patches: [], rejections: [] });
  });
});

describe("isOnMain", () => {
  test("only identical and behind mean main already contains the rev", () => {
    expect(isOnMain("identical")).toBe(true);
    expect(isOnMain("behind")).toBe(true);
    expect(isOnMain("ahead")).toBe(false);
    expect(isOnMain("diverged")).toBe(false);
  });
});

// The defect, probed on f3a7e193: a `Cargo.toml` carrying no `[patch.*]` at all
// printed `Orphan-rev gate: OK` and exited 0. The file's own comment recorded
// that it had already happened once — the relocation of the crate under
// `crates/` made an unqualified "Cargo.toml" resolve to nothing.
//
// The fix is not "empty fails": a repository may legitimately carry no patch.
// What the gate owed was the distinction D3 names — green on what it CANNOT
// READ is not a gate — so the two facts it can be wrong about are asserted on
// every run whatever the patch count, and a zero is reported as a zero.
describe("inspectCorpus", () => {
  const ONE_PIN: PatchScan = {
    entries: 1,
    organisationSources: 1,
    patches: [
      {
        section: "crates-io",
        crate: "biscuit-auth",
        owner: "libre-ai",
        repo: "capability-authorization",
        rev: REV,
      },
    ],
    rejections: [],
  };
  const EMPTY: PatchScan = { entries: 0, organisationSources: 0, patches: [], rejections: [] };
  const ROOT = { manifest: "Cargo.toml", declaresWorkspace: true };

  test("asserts that the manifest it read is the workspace root, on every run", () => {
    const assertions = inspectCorpus({
      ...ROOT,
      scan: ONE_PIN,
      memberManifests: [],
      strayPatchManifests: [],
    });

    expect(assertions).toHaveLength(1);
    expect(assertions[0]).toMatchObject({ item: "Cargo.toml", ok: true });
    expect(assertions[0]?.detail).toContain("is the workspace root");
  });

  test("a manifest read as the root but carrying no [workspace] fails", () => {
    const assertions = inspectCorpus({
      manifest: "Cargo.toml",
      declaresWorkspace: false,
      scan: ONE_PIN,
      memberManifests: [],
      strayPatchManifests: [],
    });

    expect(assertions.filter((assertion) => !assertion.ok)).toHaveLength(1);
    expect(assertions[0]?.detail).toContain("no [workspace] table");
    expect(assertions[0]?.detail).toContain("resolve to nothing");
  });

  test("a [patch.*] in a member manifest fails: Cargo ignores it there", () => {
    const assertions = inspectCorpus({
      ...ROOT,
      scan: ONE_PIN,
      memberManifests: ["crates/a/Cargo.toml", "crates/b/Cargo.toml"],
      strayPatchManifests: ["crates/b/Cargo.toml"],
    });

    expect(assertions).toHaveLength(3);
    const failed = assertions.filter((assertion) => !assertion.ok);
    expect(failed.map((assertion) => assertion.item)).toEqual(["crates/b/Cargo.toml"]);
    expect(failed[0]?.detail).toContain("silently ignores it");
  });

  test("every member manifest is asserted, clean ones included", () => {
    const assertions = inspectCorpus({
      ...ROOT,
      scan: ONE_PIN,
      memberManifests: ["crates/a/Cargo.toml", "crates/b/Cargo.toml"],
      strayPatchManifests: [],
    });

    expect(assertions.every((assertion) => assertion.ok)).toBe(true);
    expect(assertions.map((assertion) => assertion.item)).toEqual([
      "Cargo.toml",
      "crates/a/Cargo.toml",
      "crates/b/Cargo.toml",
    ]);
  });

  // Not symmetrical with the forgetting register: a repository may legitimately
  // carry no patch at all, so the gate says so rather than failing.
  test("no patch entry is reported as a zero with its reason, not as a failure", () => {
    const assertions = inspectCorpus({
      ...ROOT,
      scan: EMPTY,
      memberManifests: [],
      strayPatchManifests: [],
    });

    expect(assertions.every((assertion) => assertion.ok)).toBe(true);
    expect(assertions.at(-1)?.detail).toBe(NO_PATCH_NOTE);
    expect(NO_PATCH_NOTE).toContain("legitimate answer");
    expect(NO_PATCH_NOTE).toContain("two different answers");
  });

  test("an unreadable root and a root with no patch are two different verdicts", () => {
    const unreadable = inspectCorpus({
      manifest: "Cargo.toml",
      declaresWorkspace: false,
      scan: EMPTY,
      memberManifests: [],
      strayPatchManifests: [],
    });
    const empty = inspectCorpus({
      ...ROOT,
      scan: EMPTY,
      memberManifests: [],
      strayPatchManifests: [],
    });

    expect(unreadable.some((assertion) => !assertion.ok)).toBe(true);
    expect(empty.every((assertion) => assertion.ok)).toBe(true);
  });
});

describe("declaresWorkspace", () => {
  test("true for a manifest carrying a [workspace] table", () => {
    expect(declaresWorkspace('[workspace]\nmembers = ["crates/x"]\n')).toBe(true);
  });

  test("false for a package manifest", () => {
    expect(declaresWorkspace('[package]\nname = "x"\nversion = "0.1.0"\n')).toBe(false);
  });

  test("false for a manifest the parser cannot read — never a silent true", () => {
    expect(declaresWorkspace("[workspace\n")).toBe(false);
  });
});

describe("findStrayPatchTables", () => {
  test("names a member manifest that declares [patch.*]", () => {
    const stray = findStrayPatchTables([
      { path: "crates/a/Cargo.toml", text: '[package]\nname = "a"\nversion = "0.1.0"\n' },
      {
        path: "crates/b/Cargo.toml",
        text: '[package]\nname = "b"\nversion = "0.1.0"\n[patch.crates-io]\nx = { path = "x" }\n',
      },
    ]);

    expect(stray).toEqual(["crates/b/Cargo.toml"]);
  });

  test("an unreadable member manifest is not reported as stray", () => {
    expect(findStrayPatchTables([{ path: "crates/a/Cargo.toml", text: "[patch\n" }])).toEqual([]);
  });
});

describe("classifyContainment — ancestry named in the compare vocabulary", () => {
  test("the same commit is identical", () => {
    const status = classifyContainment({
      equal: true,
      revIsAncestorOfTip: true,
      tipIsAncestorOfRev: true,
    });
    expect(status).toBe("identical");
    expect(isOnMain(status)).toBe(true);
  });

  test("a rev the served tip descends from is behind, and acceptable", () => {
    const status = classifyContainment({
      equal: false,
      revIsAncestorOfTip: true,
      tipIsAncestorOfRev: false,
    });
    expect(status).toBe("behind");
    expect(isOnMain(status)).toBe(true);
  });

  test("a rev that descends from the served tip is ahead: not merged yet, red", () => {
    const status = classifyContainment({
      equal: false,
      revIsAncestorOfTip: false,
      tipIsAncestorOfRev: true,
    });
    expect(status).toBe("ahead");
    expect(isOnMain(status)).toBe(false);
  });

  test("unrelated lines diverge: red", () => {
    const status = classifyContainment({
      equal: false,
      revIsAncestorOfTip: false,
      tipIsAncestorOfRev: false,
    });
    expect(status).toBe("diverged");
    expect(isOnMain(status)).toBe(false);
  });

  // The 2026-10-07 consolidation moved the fleet's served branches off `main`;
  // equality is decided by sha, so the branch's name never enters the verdict.
  test("equality wins over ancestry, whatever the branch is called", () => {
    expect(
      classifyContainment({ equal: true, revIsAncestorOfTip: false, tipIsAncestorOfRev: false }),
    ).toBe("identical");
  });
});

describe("parseSymrefHead — the producer's served branch, never a hardcoded main", () => {
  test("reads the symbolic ref git prints before the HEAD line", () => {
    const stdout =
      "ref: refs/heads/migrate/recover-code\tHEAD\n0123456789abcdef0123456789abcdef01234567\tHEAD\n";
    expect(parseSymrefHead(stdout)).toBe("migrate/recover-code");
  });

  test("a plain main is read the same way", () => {
    expect(parseSymrefHead("ref: refs/heads/main\tHEAD\n")).toBe("main");
  });

  test("output without a symbolic ref is an error, never a guessed branch", () => {
    expect(() => parseSymrefHead("0123456789abcdef0123456789abcdef01234567\tHEAD\n")).toThrow(
      /no symbolic HEAD/,
    );
  });

  test("empty output is an error", () => {
    expect(() => parseSymrefHead("")).toThrow(/no symbolic HEAD/);
  });
});
