import { describe, expect, test } from "bun:test";
import { CargoTomlParseError, isOnMain, scanPatches } from "./check-patch-rev";

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
