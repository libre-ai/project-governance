import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MINIMUM_RELEASE_AGE_SECONDS } from "../../ecosystem/check-release-age";
import {
  branchName,
  bumpKind,
  type Classification,
  classifyAll,
  classifyDependency,
  type DirectDependency,
  editManifest,
  examinationRefusal,
  main,
  type Packument,
  parsePackument,
  planVolumeHolds,
  planVolumeLine,
  proposalsOf,
  tallyOf,
} from "./plan-bun-update";

const NOW = new Date("2026-11-18T12:00:00.000Z");
const DAY_SECONDS = 86_400;
const daysAgo = (days: number): string =>
  new Date(NOW.getTime() - days * DAY_SECONDS * 1000).toISOString();

const dependency = (declared: string, name = "pkg"): DirectDependency => ({
  manifest: "package.json",
  section: "dependencies",
  name,
  declared,
});

const packument = (latest: string, ages: Record<string, number>): Packument => ({
  latest,
  versions: Object.entries(ages).map(([version, age]) => ({
    version,
    deprecated: false,
    publishedAt: daysAgo(age),
  })),
});

const classify = (declared: string, published: Packument | null): Classification =>
  classifyDependency(dependency(declared), published, NOW);

describe("the class of a bump", () => {
  test.each([
    ["1.2.3", "1.2.4", "patch"],
    ["1.2.3", "1.3.0", "minor"],
    ["1.2.3", "2.0.0", "major"],
    ["0.2.3", "0.2.4", "patch"],
    ["0.2.3", "0.3.0", "major"],
    ["0.0.3", "0.0.4", "major"],
  ])("%s to %s is a %s", (from, to, kind) => {
    expect(bumpKind(from, to)).toBe(kind as ReturnType<typeof bumpKind>);
  });
});

describe("classifyDependency", () => {
  test("a patch older than the release-age floor is proposable", () => {
    const result = classify("1.0.0", packument("1.0.1", { "1.0.0": 30, "1.0.1": 4 }));
    expect(result.state).toBe("proposable");
    expect(result.target?.version).toBe("1.0.1");
    expect(result.target?.kind).toBe("patch");
  });

  test("the highest eligible minor wins over a lower patch", () => {
    const result = classify("1.0.0", packument("1.2.0", { "1.0.0": 30, "1.0.1": 9, "1.2.0": 5 }));
    expect(result.target?.version).toBe("1.2.0");
    expect(result.target?.kind).toBe("minor");
  });

  test("a major alone is listed and proposes nothing", () => {
    const result = classify("1.0.0", packument("2.0.0", { "1.0.0": 30, "2.0.0": 9 }));
    expect(result.state).toBe("major-only");
    expect(result.target).toBeNull();
    expect(result.major).toBe("2.0.0");
  });

  test("a major next to a minor is listed while the minor is proposed", () => {
    const result = classify("1.0.0", packument("2.0.0", { "1.0.0": 30, "1.1.0": 9, "2.0.0": 9 }));
    expect(result.state).toBe("proposable");
    expect(result.target?.version).toBe("1.1.0");
    expect(result.major).toBe("2.0.0");
  });

  test("a version one second under the floor is too recent, one at the floor is not", () => {
    const at = (seconds: number): Packument => ({
      latest: "1.0.1",
      versions: [
        { version: "1.0.0", deprecated: false, publishedAt: daysAgo(30) },
        {
          version: "1.0.1",
          deprecated: false,
          publishedAt: new Date(NOW.getTime() - seconds * 1000).toISOString(),
        },
      ],
    });
    expect(classify("1.0.0", at(MINIMUM_RELEASE_AGE_SECONDS - 1)).state).toBe("too-recent");
    expect(classify("1.0.0", at(MINIMUM_RELEASE_AGE_SECONDS)).state).toBe("proposable");
  });

  test("an older eligible version is proposed when the newest is too recent", () => {
    const result = classify("1.0.0", packument("1.0.2", { "1.0.0": 30, "1.0.1": 9, "1.0.2": 1 }));
    expect(result.target?.version).toBe("1.0.1");
  });

  test("a version above latest is not offered", () => {
    const result = classify("1.0.0", packument("1.0.0", { "1.0.0": 30, "1.5.0": 9 }));
    expect(result.state).toBe("up-to-date");
  });

  test("a deprecated version is not offered", () => {
    const published = packument("1.0.1", { "1.0.0": 30 });
    const versions = [
      ...published.versions,
      { version: "1.0.1", deprecated: true, publishedAt: daysAgo(9) },
    ];
    expect(classify("1.0.0", { ...published, versions }).state).toBe("up-to-date");
  });

  test("a candidate without a readable date is unreadable, never proposed", () => {
    const published = packument("1.0.1", { "1.0.0": 30 });
    const versions = [
      ...published.versions,
      { version: "1.0.1", deprecated: false, publishedAt: "not a date" },
    ];
    expect(classify("1.0.0", { ...published, versions }).state).toBe("unreadable");
  });

  test("a registry without an answer is unreadable, never up to date", () => {
    expect(classify("1.0.0", null).state).toBe("unreadable");
  });

  test("a declared version the registry does not publish is unreadable", () => {
    expect(classify("1.0.0", packument("1.0.1", { "1.0.1": 9 })).state).toBe("unreadable");
  });
});

describe("what is not compared with the registry", () => {
  test.each([
    ["file:../sibling"],
    ["workspace:*"],
    ["^1.0.0"],
    ["~1.0.0"],
    ["github:owner/repository"],
    ["1.0.0-rc.1"],
  ])("%s is named as not examined", (declared) => {
    expect(examinationRefusal(dependency(declared), new Set())).not.toBeNull();
  });

  test("an exact version is examined", () => {
    expect(examinationRefusal(dependency("1.0.0"), new Set())).toBeNull();
  });

  test("a dependency pinned by overrides is left alone", () => {
    expect(examinationRefusal(dependency("1.0.0"), new Set(["pkg"]))).toContain("overrides");
  });

  test("a peer range is left to the consumer", () => {
    const peer: DirectDependency = { ...dependency("1.0.0"), section: "peerDependencies" };
    expect(examinationRefusal(peer, new Set())).toContain("peer");
  });

  test("a name that cannot reach a git ref safely is refused", () => {
    expect(examinationRefusal(dependency("1.0.0", "a~b"), new Set())).not.toBeNull();
    expect(examinationRefusal(dependency("1.0.0", "a..b"), new Set())).not.toBeNull();
  });
});

describe("parsePackument", () => {
  const response = {
    "dist-tags": { latest: "1.0.1" },
    versions: {
      "1.0.0": { deprecated: "use 1.0.1" },
      "1.0.1": {},
      "2.0.0-rc.1": {},
    },
    time: { "1.0.0": daysAgo(9), "1.0.1": daysAgo(5) },
  };

  test("keeps exact releases, drops prereleases and reads deprecation", () => {
    const parsed = parsePackument(response);
    expect(parsed?.versions.map((version) => version.version)).toEqual(["1.0.0", "1.0.1"]);
    expect(parsed?.versions[0]?.deprecated).toBe(true);
    expect(parsed?.versions[1]?.deprecated).toBe(false);
  });

  test.each([
    [null],
    ["text"],
    [{ versions: {}, time: {} }],
    [{ "dist-tags": {}, versions: {}, time: {} }],
    [{ "dist-tags": { latest: "1.0.0" }, time: {} }],
    [{ "dist-tags": { latest: "1.0.0" }, versions: {} }],
    [{ "dist-tags": { latest: "1.0.0-rc.1" }, versions: {}, time: {} }],
  ])("refuses %j", (value) => {
    expect(parsePackument(value)).toBeNull();
  });
});

describe("the volume line", () => {
  test("counters sum to the direct dependencies read", async () => {
    const dependencies = [dependency("1.0.0", "fresh"), dependency("file:../x", "local")];
    const read = async (): Promise<unknown> => {
      throw new Error("offline");
    };
    const tally = tallyOf(await classifyAll(dependencies, new Set(), read, NOW));
    expect(planVolumeHolds(tally)).toBe(true);
    expect(planVolumeLine(tally)).toBe(
      "examined: direct=2 up-to-date=0 proposable=0 major-only=0 too-recent=0 not-examined=1 unreadable=1",
    );
  });

  test("a total that does not sum is refused", () => {
    const tally = { ...tallyOf([]), direct: 1 };
    expect(planVolumeHolds(tally)).toBe(false);
  });
});

describe("branchName", () => {
  test("is a valid ref that keeps scoped and unscoped packages apart", () => {
    const scoped = branchName("@a/b", "1.2.3");
    expect(scoped).toBe("work/bun-update/@a+b@1.2.3");
    expect(scoped).not.toBe(branchName("a-b", "1.2.3"));
    const check = Bun.spawnSync(["git", "check-ref-format", `refs/heads/${scoped}`]);
    expect(check.exitCode).toBe(0);
  });
});

describe("editManifest", () => {
  const text = `{
  "overrides": {
    "other": "1.0.0"
  },
  "dependencies": {
    "pkg": "1.0.0",
    "other": "1.0.0"
  }
}
`;

  test("moves one line and keeps every other byte", () => {
    expect(editManifest(text, "pkg", "1.0.0", "1.0.1")).toBe(
      text.replace('"pkg": "1.0.0"', '"pkg": "1.0.1"'),
    );
  });

  test("refuses an edit that would also move an override", () => {
    expect(editManifest(text, "other", "1.0.0", "1.0.1")).toBeNull();
  });

  test("refuses a dependency declared at another version", () => {
    expect(editManifest(text, "pkg", "9.9.9", "9.9.10")).toBeNull();
  });
});

describe("proposalsOf", () => {
  test("one proposal per bump, naming every manifest that declares it", () => {
    const target = {
      version: "1.0.1",
      kind: "patch",
      publishedAt: daysAgo(5),
      ageSeconds: 432_000,
    } as const;
    const entry = (manifest: string): Classification => ({
      dependency: { ...dependency("1.0.0"), manifest },
      state: "proposable",
      reason: "patch bump",
      target,
      major: null,
    });
    const proposals = proposalsOf([entry("package.json"), entry("packages/a/package.json")]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.manifests).toEqual(["package.json", "packages/a/package.json"]);
    expect(proposals[0]?.branch).toBe("work/bun-update/pkg@1.0.1");
  });
});

describe("the command", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const fixture = (manifest: Record<string, unknown>, lock = true): string => {
    const root = mkdtempSync(join(tmpdir(), "plan-bun-update-test-"));
    roots.push(root);
    writeFileSync(join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    if (lock) writeFileSync(join(root, "bun.lock"), '{ "packages": { "pkg": ["pkg@1.0.0"] } }\n');
    return root;
  };

  const registry = async (): Promise<unknown> => ({
    "dist-tags": { latest: "1.0.1" },
    versions: { "1.0.0": {}, "1.0.1": {} },
    time: { "1.0.0": daysAgo(30), "1.0.1": daysAgo(5) },
  });

  const regenerated = (directory: string) => {
    writeFileSync(join(directory, "bun.lock"), '{ "packages": { "pkg": ["pkg@1.0.1"] } }\n');
    return { ok: true, detail: "" };
  };

  test("an unknown argument is a usage error", async () => {
    expect(await main(["--nope", "x"], registry, regenerated, NOW)).toBe(2);
  });

  test("a root without bun.lock is a usage error", async () => {
    const root = fixture({ dependencies: { pkg: "1.0.0" } }, false);
    expect(await main(["--root", root], registry, regenerated, NOW)).toBe(2);
  });

  test("a workspace negation is refused by name", async () => {
    const root = fixture({ workspaces: ["!packages/a"] });
    expect(await main(["--root", root], registry, regenerated, NOW)).toBe(2);
  });

  test("a registry error exits 1", async () => {
    const root = fixture({ dependencies: { pkg: "1.0.0" } });
    const offline = async (): Promise<unknown> => {
      throw new Error("offline");
    };
    expect(await main(["--root", root], offline, regenerated, NOW)).toBe(1);
  });

  test("a workspace member is read in addition to the root", async () => {
    const root = fixture({ workspaces: ["packages/*"] });
    mkdirSync(join(root, "packages/a"), { recursive: true });
    writeFileSync(
      join(root, "packages/a/package.json"),
      `${JSON.stringify({ dependencies: { pkg: "1.0.0" } }, null, 2)}\n`,
    );
    const out = join(root, "out");
    expect(await main(["--root", root, "--out", out], registry, regenerated, NOW)).toBe(0);
    const plan = JSON.parse(readFileSync(join(out, "plan.json"), "utf8"));
    expect(plan.proposals[0].manifests).toEqual(["packages/a/package.json"]);
  });

  test("a bundle holds the one-line manifest and the regenerated lockfile", async () => {
    const root = fixture({ dependencies: { pkg: "1.0.0" } });
    const out = join(root, "out");
    expect(await main(["--root", root, "--out", out], registry, regenerated, NOW)).toBe(0);
    expect(readFileSync(join(out, "0/package.json"), "utf8")).toContain('"pkg": "1.0.1"');
    expect(readFileSync(join(out, "0/bun.lock"), "utf8")).toContain("pkg@1.0.1");
  });

  test("a lockfile that did not change fails the proposal", async () => {
    const root = fixture({ dependencies: { pkg: "1.0.0" } });
    const unchanged = () => ({ ok: true, detail: "" });
    const out = join(root, "out");
    expect(await main(["--root", root, "--out", out], registry, unchanged, NOW)).toBe(1);
    expect(JSON.parse(readFileSync(join(out, "plan.json"), "utf8")).proposals).toEqual([]);
  });

  test("a lockfile that already resolved the target and did not change fails too", async () => {
    const root = fixture({ dependencies: { pkg: "1.0.0" } });
    writeFileSync(join(root, "bun.lock"), '{ "packages": { "pkg": ["pkg@1.0.1"] } }\n');
    const unchanged = () => ({ ok: true, detail: "" });
    expect(await main(["--root", root, "--out", join(root, "out")], registry, unchanged, NOW)).toBe(
      1,
    );
  });

  test("a regeneration that reports failure is refused whatever it left on disk", async () => {
    const root = fixture({ dependencies: { pkg: "1.0.0" } });
    const failedAfterWriting = (directory: string) => {
      regenerated(directory);
      return { ok: false, detail: "interrupted" };
    };
    const out = join(root, "out");
    expect(await main(["--root", root, "--out", out], registry, failedAfterWriting, NOW)).toBe(1);
    expect(JSON.parse(readFileSync(join(out, "plan.json"), "utf8")).proposals).toEqual([]);
  });

  test("a refused regeneration fails the proposal", async () => {
    const root = fixture({ dependencies: { pkg: "1.0.0" } });
    const refused = () => ({ ok: false, detail: "blocked by minimumReleaseAge" });
    expect(await main(["--root", root, "--out", join(root, "out")], registry, refused, NOW)).toBe(
      1,
    );
  });
});
