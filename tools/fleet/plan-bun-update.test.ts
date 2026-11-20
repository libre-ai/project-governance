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
  editedManifest,
  editManifest,
  examinationRefusal,
  isIsoInstant,
  lockfileCommand,
  main,
  type Packument,
  parsePackument,
  planVolumeHolds,
  planVolumeLine,
  prepareBundle,
  proposalsOf,
  readRegistry,
  readWorkspace,
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

const NONE: ReadonlySet<string> = new Set<string>();

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

  test("a latest below the declared version is unreadable, never up to date", () => {
    const result = classify("2.0.0", packument("1.0.0", { "1.0.0": 30, "2.0.0": 30 }));
    expect(result.state).toBe("unreadable");
    expect(result.reason).toContain("below the declared");
  });

  test("a latest equal to the declared version is up to date", () => {
    expect(classify("2.0.0", packument("2.0.0", { "2.0.0": 30 })).state).toBe("up-to-date");
  });

  test.each([
    "Nov 1 2026 (see https://example.invalid)",
    "2026-11-01T00:00:00Z",
    "2026-11-01",
  ])("the date %s leaves the plan as a canonical instant", (publishedAt) => {
    const published = packument("1.0.1", { "1.0.0": 30 });
    const versions = [...published.versions, { version: "1.0.1", deprecated: false, publishedAt }];
    const target = classify("1.0.0", { ...published, versions }).target;
    expect(target?.publishedAt).toBe(new Date(publishedAt).toISOString());
    expect(isIsoInstant(target?.publishedAt ?? "")).toBe(true);
  });
});

describe("isIsoInstant", () => {
  test("accepts the form toISOString writes", () => {
    expect(isIsoInstant("2026-11-01T00:00:00.000Z")).toBe(true);
  });

  test.each([
    "2026-11-01",
    "2026-11-01T00:00:00Z",
    "2026-11-01T00:00:00.000+01:00",
    "2026-13-01T00:00:00.000Z",
    "+012026-11-01T00:00:00.000Z",
    "2026-11-01T00:00:00.000Z [link](https://example.invalid)",
    "[link](https://example.invalid)",
  ])("refuses %s", (value) => {
    expect(isIsoInstant(value)).toBe(false);
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
    expect(examinationRefusal(dependency(declared), NONE, NONE)).not.toBeNull();
  });

  test("an exact version is examined", () => {
    expect(examinationRefusal(dependency("1.0.0"), NONE, NONE)).toBeNull();
  });

  test("a dependency pinned by overrides is left alone", () => {
    expect(examinationRefusal(dependency("1.0.0"), new Set(["pkg"]), NONE)).toContain("overrides");
  });

  test("a peer range is left to the consumer", () => {
    const peer: DirectDependency = { ...dependency("1.0.0"), section: "peerDependencies" };
    expect(examinationRefusal(peer, NONE, NONE)).toContain("peer");
  });

  test("a name that cannot reach a git ref safely is refused", () => {
    expect(examinationRefusal(dependency("1.0.0", "a~b"), NONE, NONE)).not.toBeNull();
    expect(examinationRefusal(dependency("1.0.0", "a..b"), NONE, NONE)).not.toBeNull();
  });

  test("a name a workspace member carries is not compared with the public registry", () => {
    expect(examinationRefusal(dependency("1.0.0"), NONE, new Set(["pkg"]))).toContain("member");
  });

  test("a member's dependency is counted as not examined, and the registry is not asked", async () => {
    let asked = 0;
    const read = async (): Promise<unknown> => {
      asked += 1;
      return null;
    };
    const workspace = { overrides: NONE, memberNames: new Set(["pkg"]) };
    const [result] = await classifyAll([dependency("1.0.0")], workspace, read, NOW);
    expect(result?.state).toBe("not-examined");
    expect(asked).toBe(0);
  });
});

describe("classifyAll against an incoherent registry", () => {
  const answer = (name: string) => async (): Promise<unknown> => ({
    name,
    "dist-tags": { latest: "1.0.1" },
    versions: { "1.0.0": {}, "1.0.1": {} },
    time: { "1.0.0": daysAgo(30), "1.0.1": daysAgo(9) },
  });
  const workspace = { overrides: NONE, memberNames: NONE };

  test("an answer about the requested package is classified", async () => {
    const [result] = await classifyAll([dependency("1.0.0")], workspace, answer("pkg"), NOW);
    expect(result?.state).toBe("proposable");
  });

  test("an answer about another package is unreadable", async () => {
    const [result] = await classifyAll([dependency("1.0.0")], workspace, answer("other"), NOW);
    expect(result?.state).toBe("unreadable");
  });
});

describe("parsePackument", () => {
  const response = {
    name: "pkg",
    "dist-tags": { latest: "1.0.1" },
    versions: {
      "1.0.0": { deprecated: "use 1.0.1" },
      "1.0.1": {},
      "2.0.0-rc.1": {},
    },
    time: { "1.0.0": daysAgo(9), "1.0.1": daysAgo(5) },
  };

  test("keeps exact releases, drops prereleases and reads deprecation", () => {
    const parsed = parsePackument(response, "pkg");
    expect(parsed?.versions.map((version) => version.version)).toEqual(["1.0.0", "1.0.1"]);
    expect(parsed?.versions[0]?.deprecated).toBe(true);
    expect(parsed?.versions[1]?.deprecated).toBe(false);
  });

  test("refuses an answer about another package, or about none", () => {
    expect(parsePackument(response, "other")).toBeNull();
    expect(parsePackument({ ...response, name: undefined }, "pkg")).toBeNull();
  });

  test.each([
    [null],
    ["text"],
    [{ name: "pkg", versions: {}, time: {} }],
    [{ name: "pkg", "dist-tags": {}, versions: {}, time: {} }],
    [{ name: "pkg", "dist-tags": { latest: "1.0.0" }, time: {} }],
    [{ name: "pkg", "dist-tags": { latest: "1.0.0" }, versions: {} }],
    [{ name: "pkg", "dist-tags": { latest: "1.0.0-rc.1" }, versions: {}, time: {} }],
  ])("refuses %j", (value) => {
    expect(parsePackument(value, "pkg")).toBeNull();
  });
});

describe("the bounds of a resolution", () => {
  test("the lockfile is regenerated without scripts and without installing", () => {
    const { command, cwd } = lockfileCommand("/work");
    expect(command.slice(1)).toEqual(["install", "--lockfile-only", "--ignore-scripts"]);
    expect(cwd).toBe("/work");
  });

  test("the resolution inherits no credential and no user configuration", () => {
    process.env.BUN_UPDATE_PROBE_TOKEN = "secret";
    try {
      const { env } = lockfileCommand("/work");
      expect(Object.keys(env).sort()).toEqual(["HOME", "PATH", "TMPDIR"]);
      expect(env.HOME).toBe("/work");
    } finally {
      delete process.env.BUN_UPDATE_PROBE_TOKEN;
    }
  });

  test("the registry is read anonymously and a redirect is an error", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const request = async (url: string, init: RequestInit): Promise<Response> => {
      seen.push({ url, init });
      return new Response("{}");
    };
    await readRegistry("@scope/pkg", request);
    expect(seen[0]?.url).toBe("https://registry.npmjs.org/@scope%2fpkg");
    expect(seen[0]?.init.redirect).toBe("error");
    expect(seen[0]?.init.headers).toBeUndefined();
  });

  test("a registry error status is not read as an answer", async () => {
    const request = async (): Promise<Response> => new Response("{}", { status: 503 });
    await expect(readRegistry("pkg", request)).rejects.toThrow("HTTP 503");
  });

  test("the release-age guard of the repository is next to the manifests it judges", () => {
    const root = mkdtempSync(join(tmpdir(), "plan-bun-update-bunfig-"));
    try {
      writeFileSync(
        join(root, "package.json"),
        '{\n  "dependencies": {\n    "pkg": "1.0.0"\n  }\n}\n',
      );
      writeFileSync(join(root, "bun.lock"), "{}\n");
      writeFileSync(join(root, "bunfig.toml"), "[install]\nminimumReleaseAge = 259200\n");
      const copied: string[] = [];
      const regenerate = (directory: string) => {
        copied.push(readFileSync(join(directory, "bunfig.toml"), "utf8"));
        return { ok: false, detail: "stop here" };
      };
      const [proposal] = proposalsOf([
        {
          dependency: dependency("1.0.0"),
          state: "proposable",
          reason: "patch bump",
          target: { version: "1.0.1", kind: "patch", publishedAt: daysAgo(5), ageSeconds: 432_000 },
          major: null,
        },
      ]);
      if (proposal === undefined) throw new Error("no proposal");
      prepareBundle(proposal, root, ["package.json"], join(root, "out"), regenerate);
      expect(copied).toEqual(["[install]\nminimumReleaseAge = 259200\n"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("readWorkspace", () => {
  test("names the packages the workspace provides, and the pinned ones", async () => {
    const root = mkdtempSync(join(tmpdir(), "plan-bun-update-workspace-"));
    try {
      mkdirSync(join(root, "packages/a"), { recursive: true });
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({
          name: "root-package",
          workspaces: ["packages/*"],
          overrides: { pinned: "1.0.0" },
          resolutions: { resolved: "1.0.0" },
        }),
      );
      writeFileSync(join(root, "packages/a/package.json"), JSON.stringify({ name: "member-a" }));
      const workspace = await readWorkspace(root);
      expect([...workspace.memberNames].sort()).toEqual(["member-a", "root-package"]);
      expect([...workspace.overrides].sort()).toEqual(["pinned", "resolved"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the volume line", () => {
  test("counters sum to the direct dependencies read", async () => {
    const dependencies = [dependency("1.0.0", "fresh"), dependency("file:../x", "local")];
    const read = async (): Promise<unknown> => {
      throw new Error("offline");
    };
    const workspace = { overrides: NONE, memberNames: NONE };
    const tally = tallyOf(await classifyAll(dependencies, workspace, read, NOW));
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

  const sections = `{
  "dependencies": {
    "pkg": "1.0.0"
  },
  "devDependencies": {
    "pkg": "1.0.0"
  },
  "peerDependencies": {
    "pkg": "1.0.0"
  }
}
`;

  test("moves one line and keeps every other byte", () => {
    expect(editManifest(text, "dependencies", "pkg", "1.0.0", "1.0.1")).toBe(
      text.replace('"pkg": "1.0.0"', '"pkg": "1.0.1"'),
    );
  });

  test("refuses a dependency pinned by an override", () => {
    expect(editManifest(text, "dependencies", "other", "1.0.0", "1.0.1")).toBeNull();
  });

  test("refuses a dependency pinned by a resolution", () => {
    const pinned = text.replace('"overrides"', '"resolutions"');
    expect(editManifest(pinned, "dependencies", "other", "1.0.0", "1.0.1")).toBeNull();
  });

  test("refuses a dependency declared at another version", () => {
    expect(editManifest(text, "dependencies", "pkg", "9.9.9", "9.9.10")).toBeNull();
  });

  test("refuses a section that does not declare the dependency", () => {
    expect(editManifest(text, "devDependencies", "pkg", "1.0.0", "1.0.1")).toBeNull();
  });

  test.each([
    "dependencies",
    "devDependencies",
  ] as const)("moves %s alone, leaving the same line of every other section", (section) => {
    const edited = JSON.parse(editManifest(sections, section, "pkg", "1.0.0", "1.0.1") ?? "{}");
    const expected = JSON.parse(sections);
    expected[section].pkg = "1.0.1";
    expect(edited).toEqual(expected);
    expect(edited.peerDependencies.pkg).toBe("1.0.0");
  });

  test("applies every edit of a proposal to the manifest it names", () => {
    const edits = [
      { manifest: "package.json", section: "dependencies", from: "1.0.0" },
      { manifest: "package.json", section: "devDependencies", from: "1.0.0" },
      { manifest: "packages/a/package.json", section: "dependencies", from: "9.9.9" },
    ] as const;
    const edited = editedManifest(sections, "package.json", { name: "pkg", to: "1.0.1", edits });
    const parsed = JSON.parse(edited ?? "{}");
    expect(parsed.dependencies.pkg).toBe("1.0.1");
    expect(parsed.devDependencies.pkg).toBe("1.0.1");
    expect(parsed.peerDependencies.pkg).toBe("1.0.0");
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

  test("two declared versions moving to one target share one proposal and one branch", () => {
    const target = {
      version: "1.1.5",
      kind: "patch",
      publishedAt: daysAgo(5),
      ageSeconds: 432_000,
    } as const;
    const entry = (declared: string, manifest: string): Classification => ({
      dependency: { ...dependency(declared), manifest },
      state: "proposable",
      reason: "bump",
      target,
      major: null,
    });
    const proposals = proposalsOf([
      entry("1.0.0", "package.json"),
      entry("1.1.0", "packages/b/package.json"),
    ]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.from).toBe("1.0.0");
    expect(proposals[0]?.kind).toBe("minor");
    expect(proposals[0]?.edits.map((edit) => edit.from)).toEqual(["1.0.0", "1.1.0"]);
    expect(proposals[0]?.manifests).toEqual(["package.json", "packages/b/package.json"]);
    expect(proposals[0]?.directory).toBe("0");
  });

  test("two targets of one package stay two proposals", () => {
    const entry = (declared: string, version: string): Classification => ({
      dependency: dependency(declared),
      state: "proposable",
      reason: "bump",
      target: { version, kind: "minor", publishedAt: daysAgo(5), ageSeconds: 432_000 },
      major: null,
    });
    const proposals = proposalsOf([entry("1.0.0", "1.5.0"), entry("2.0.0", "2.5.0")]);
    expect(proposals.map((proposal) => proposal.directory)).toEqual(["0", "1"]);
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
    name: "pkg",
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

  test("a dependency on a workspace member yields no proposal", async () => {
    const root = fixture({ workspaces: ["packages/*"], dependencies: { pkg: "1.0.0" } });
    mkdirSync(join(root, "packages/a"), { recursive: true });
    writeFileSync(join(root, "packages/a/package.json"), JSON.stringify({ name: "pkg" }));
    const out = join(root, "out");
    expect(await main(["--root", root, "--out", out], registry, regenerated, NOW)).toBe(0);
    expect(JSON.parse(readFileSync(join(out, "plan.json"), "utf8")).proposals).toEqual([]);
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
