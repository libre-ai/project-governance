import { describe, expect, spyOn, test } from "bun:test";
import { MINIMUM_RELEASE_AGE_SECONDS } from "../../ecosystem/check-release-age";
import {
  classifyAll,
  classifyPin,
  type FileReader,
  freshnessReport,
  type LatestRelease,
  latestFromCratesIndex,
  latestFromGitHubRelease,
  latestFromPackument,
  latestFromPypi,
  latestFromRustChannel,
  main,
  PIN_STATES,
  type PinReading,
  parsePinned,
  readPin,
  readRepositoryFile,
  readUpstream,
  TOOLCHAIN_PINS,
  type ToolchainPin,
  tallyOf,
  type UpstreamAnswer,
  type UpstreamSource,
  volumeHolds,
  volumeLine,
} from "./check-toolchain-freshness";

const NOW = new Date("2026-11-18T12:00:00.000Z");
const secondsAgo = (seconds: number): string =>
  new Date(NOW.getTime() - seconds * 1000).toISOString();
const OLD = secondsAgo(30 * 86_400);

const filesOf =
  (files: Record<string, string>): FileReader =>
  (path) =>
    files[path] ?? null;

const pinOf = (tool: string, ...files: string[]): ToolchainPin => ({
  tool,
  sites: files.map((file) => ({ file, pattern: /^version = (\S+)$/gm })),
  source: { kind: "crates", name: tool },
});

const pinned = (version: string): PinReading => ({ kind: "pinned", version });
const latest = (version: string, publishedAt: string | null = OLD): UpstreamAnswer => ({
  kind: "latest",
  release: { version, publishedAt },
});

describe("readPin", () => {
  test("a site that cannot be read makes the pin unreadable", () => {
    const reading = readPin(pinOf("tool", "a", "b"), filesOf({ a: "version = 1.0.0\n" }));
    expect(reading).toEqual({ kind: "unreadable", reason: "b cannot be read" });
  });

  test("a site that holds no pin makes the pin unreadable", () => {
    const files = filesOf({ a: "version = 1.0.0\n", b: "nothing here\n" });
    expect(readPin(pinOf("tool", "a", "b"), files)).toEqual({
      kind: "unreadable",
      reason: "no pin found in b",
    });
  });

  test("two sites that disagree are ambiguous, never one of the two", () => {
    const files = filesOf({ a: "version = 1.0.0\n", b: "version = 1.1.0\n" });
    expect(readPin(pinOf("tool", "a", "b"), files)).toEqual({
      kind: "unreadable",
      reason: 'ambiguous: "1.0.0" in a, "1.1.0" in b',
    });
  });

  test("every match of a pattern is a reading: a second, different one is ambiguous", () => {
    const files = filesOf({ a: "version = 1.0.0\nversion = 1.1.0\n" });
    expect(readPin(pinOf("tool", "a"), files).kind).toBe("unreadable");
  });

  test("a JSON site reads the string at its path, and only a string", () => {
    const pin = (key: string): ToolchainPin => ({
      tool: "tool",
      sites: [{ file: "policy.json", json: ["node", key] }],
      source: { kind: "npm", name: "tool" },
    });
    const files = filesOf({
      "policy.json": '{"version":"9.9.9","node":{"version":"1.2.3","major":1}}',
    });
    expect(readPin(pin("version"), files)).toEqual({ kind: "pinned", version: "1.2.3" });
    expect(readPin(pin("major"), files).kind).toBe("unreadable");
    expect(readPin(pin("absent"), files).kind).toBe("unreadable");
  });

  test("a pin without a site is unreadable", () => {
    expect(readPin(pinOf("tool"), filesOf({})).kind).toBe("unreadable");
  });
});

describe("the pins this repository declares", () => {
  // Reads the tracked tree: a pin that moves, or a site whose shape changes,
  // fails here instead of on the next scheduled run.
  test.each(
    TOOLCHAIN_PINS.map((pin) => [pin.tool, pin] as const),
  )("%s is written once, as an exact version, at every declared site", (_tool, pin) => {
    const reading = readPin(pin, readRepositoryFile);
    expect(reading.kind).toBe("pinned");
    expect(parsePinned(reading.kind === "pinned" ? reading.version : "")).not.toBeNull();
  });

  test("no tool is declared twice", () => {
    const tools = TOOLCHAIN_PINS.map((pin) => pin.tool);
    expect(new Set(tools).size).toBe(tools.length);
    expect(tools.length).toBeGreaterThan(0);
  });
});

describe("classifyPin", () => {
  const classify = (version: string, upstream: UpstreamAnswer) =>
    classifyPin("tool", pinned(version), upstream, NOW);

  test("the latest release is up to date", () => {
    expect(classify("1.2.3", latest("1.2.3")).state).toBe("up-to-date");
  });

  test("a pin ahead of the latest release is up to date, pre-release included", () => {
    const result = classify("1.4.0-canary.1+57f349f63", latest("1.3.14"));
    expect(result.state).toBe("up-to-date");
    expect(result.reason).toBe("ahead of the latest release 1.3.14");
  });

  test("a pre-release of the latest release is behind it", () => {
    expect(classify("1.4.0-canary.1+57f349f63", latest("1.4.0")).state).toBe("behind");
  });

  test("a higher release older than the floor is behind", () => {
    const result = classify("1.2.3", latest("1.3.0", OLD));
    expect(result.state).toBe("behind");
    expect(result.reason).toBe(`1.3.0 was published ${OLD}`);
  });

  test("the floor is the fleet's release-age floor, to the second", () => {
    const at = (seconds: number) => classify("1.2.3", latest("1.2.4", secondsAgo(seconds))).state;
    expect(at(MINIMUM_RELEASE_AGE_SECONDS - 1)).toBe("too-recent");
    expect(at(MINIMUM_RELEASE_AGE_SECONDS)).toBe("behind");
  });

  test.each([
    [null],
    ["not a date"],
  ])("a higher release dated %p is unreadable, never behind", (publishedAt) => {
    expect(classify("1.2.3", latest("1.3.0", publishedAt)).state).toBe("unreadable");
  });

  test("the date of a release that is not higher is not needed", () => {
    expect(classify("1.2.3", latest("1.2.3", null)).state).toBe("up-to-date");
  });

  test.each([
    ["2.0.0-rc.1"],
    ["nightly\u001b[31m"],
    ["1.2"],
  ])("a latest release spelled %p is unreadable", (version) => {
    const result = classify("1.2.3", latest(version));
    expect(result.state).toBe("unreadable");
    expect(result.reason).not.toContain(version);
  });

  test.each([["stable"], ["1.97"], ["v1.2.3"]])("a pin spelled %p is unreadable", (version) => {
    expect(classify(version, latest("1.2.3")).state).toBe("unreadable");
  });

  test("an unreadable pin and an unreadable registry keep their reason", () => {
    const upstream: UpstreamAnswer = { kind: "unreadable", reason: "registry reason" };
    const reading: PinReading = { kind: "unreadable", reason: "pin reason" };
    expect(classifyPin("tool", reading, latest("1.0.0"), NOW)).toEqual({
      tool: "tool",
      state: "unreadable",
      pinned: null,
      reason: "pin reason",
    });
    expect(classify("1.2.3", upstream)).toEqual({
      tool: "tool",
      state: "unreadable",
      pinned: "1.2.3",
      reason: "registry reason",
    });
  });
});

describe("what each registry answers", () => {
  test("npm: the latest tag and the date the registry gives for it", () => {
    const packument = {
      name: "bun",
      "dist-tags": { latest: "1.4.5" },
      versions: { "1.4.4": {}, "1.4.5": {}, "1.5.0": {} },
      time: { "1.4.4": "2026-11-01T00:00:00.000Z", "1.4.5": "2026-11-19T08:54:36.807Z" },
    };
    expect(latestFromPackument(packument, "bun")).toEqual({
      version: "1.4.5",
      publishedAt: "2026-11-19T08:54:36.807Z",
    });
    expect(latestFromPackument(packument, "other")).toBeNull();
  });

  const crate = (vers: string, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ name: "cargo-deny", vers, yanked: false, pubtime: OLD, ...extra });

  test("crates.io: the highest stable version that is not yanked, whatever the order", () => {
    const index = [
      crate("0.22.0", { pubtime: "2026-11-19T16:23:37Z" }),
      crate("0.9.0"),
      crate("0.23.0", { yanked: true }),
      crate("0.24.0-rc.1"),
      "",
    ].join("\n");
    expect(latestFromCratesIndex(index, "cargo-deny")).toEqual({
      version: "0.22.0",
      publishedAt: "2026-11-19T16:23:37Z",
    });
  });

  test("crates.io: a version without a publication time keeps a null date", () => {
    const index = JSON.stringify({ name: "cargo-deny", vers: "1.0.0", yanked: false });
    expect(latestFromCratesIndex(index, "cargo-deny")).toEqual({
      version: "1.0.0",
      publishedAt: null,
    });
  });

  test("crates.io: a line that is not an index entry makes the file unreadable", () => {
    expect(latestFromCratesIndex(`${crate("1.0.0")}\n<html>\n`, "cargo-deny")).toBeNull();
    expect(latestFromCratesIndex(`${crate("1.0.0")}\n{"vers":2}\n`, "cargo-deny")).toBeNull();
    expect(latestFromCratesIndex("", "cargo-deny")).toBeNull();
  });

  test("crates.io: the index of another crate is not an answer", () => {
    expect(latestFromCratesIndex(crate("1.0.0"), "cargo-audit")).toBeNull();
  });

  const channel = (date: string): string =>
    `manifest-version = "2"\ndate = ${date}\n\n[pkg.rust]\nversion = "1.100.0 (0ef1bc386 2026-11-09)"\n`;

  test("rust: the stable version, dated at the end of the manifest's day", () => {
    expect(latestFromRustChannel(channel('"2026-11-12"'))).toEqual({
      version: "1.100.0",
      publishedAt: "2026-11-13T00:00:00.000Z",
    });
  });

  test("rust: a date that is not a day is a null date, a manifest without rust is null", () => {
    expect(latestFromRustChannel(channel('"12 November"'))?.publishedAt).toBeNull();
    expect(latestFromRustChannel(channel('"2026-13-45"'))?.publishedAt).toBeNull();
    expect(latestFromRustChannel('date = "2026-11-12"\n')).toBeNull();
    expect(latestFromRustChannel("<html>")).toBeNull();
  });

  const project = (info: Record<string, unknown>, files: readonly unknown[]): unknown => ({
    info: { name: "reuse", version: "6.3.0", ...info },
    releases: { "6.2.0": [{ upload_time_iso_8601: "2026-01-01T00:00:00Z" }], "6.3.0": files },
  });
  const FILES = [
    { upload_time_iso_8601: "2026-10-30T13:34:54.743075Z" },
    { upload_time_iso_8601: "2026-10-30T13:34:52.686456Z" },
  ];

  test("pypi: the current version, dated by its last uploaded file", () => {
    expect(latestFromPypi(project({}, FILES), "reuse")).toEqual({
      version: "6.3.0",
      publishedAt: "2026-10-30T13:34:54.743Z",
    });
  });

  test("pypi: a file without a readable date leaves the release undated", () => {
    expect(latestFromPypi(project({}, [...FILES, {}]), "reuse")?.publishedAt).toBeNull();
    expect(latestFromPypi(project({}, []), "reuse")?.publishedAt).toBeNull();
  });

  test("pypi: a yanked release and another project are not answers", () => {
    expect(latestFromPypi(project({ yanked: true }, FILES), "reuse")).toBeNull();
    expect(latestFromPypi(project({ name: "reuse-tool" }, FILES), "reuse")).toBeNull();
  });

  const release = (extra: Record<string, unknown> = {}): unknown => ({
    tag_name: "v2.7.1",
    published_at: "2026-11-09T04:15:04Z",
    draft: false,
    prerelease: false,
    ...extra,
  });

  test("github: the tag without its prefix, and its publication date", () => {
    expect(latestFromGitHubRelease(release())).toEqual({
      version: "2.7.1",
      publishedAt: "2026-11-09T04:15:04Z",
    });
    expect(latestFromGitHubRelease(release({ tag_name: "2.7.1" }))).toBeNull();
    expect(latestFromGitHubRelease("v2.7.1")).toBeNull();
  });

  test("github: a draft, a pre-release, or a release that says neither, is not an answer", () => {
    expect(latestFromGitHubRelease(release({ draft: true }))).toBeNull();
    expect(latestFromGitHubRelease(release({ prerelease: true }))).toBeNull();
    expect(latestFromGitHubRelease({ tag_name: "v2.7.1" })).toBeNull();
  });
});

describe("readUpstream", () => {
  interface Call {
    readonly url: string;
    readonly init: RequestInit;
  }
  const serving = (answers: Record<string, Response | undefined>) => {
    const calls: Call[] = [];
    const request = async (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      return answers[url] ?? new Response("not found", { status: 404 });
    };
    return { calls, request };
  };
  const json = (value: unknown): Response => new Response(JSON.stringify(value));

  const GITHUB = "https://api.github.com/repos/google/osv-scanner/releases/latest";
  const github: UpstreamSource = { kind: "github-release", repository: "google/osv-scanner" };
  const SOURCES: readonly (readonly [UpstreamSource, string])[] = [
    [{ kind: "npm", name: "bun" }, "https://registry.npmjs.org/bun"],
    [{ kind: "crates", name: "cargo-deny" }, "https://index.crates.io/ca/rg/cargo-deny"],
    [{ kind: "rust-stable" }, "https://static.rust-lang.org/dist/channel-rust-stable.toml"],
    [{ kind: "pypi", name: "reuse" }, "https://pypi.org/pypi/reuse/json"],
    [github, GITHUB],
  ];

  test.each(
    SOURCES,
  )("%j is asked once, where it is published, and no redirect is followed", async (source, url) => {
    const { calls, request } = serving({});
    await readUpstream(source, request, "").catch(() => null);
    expect(calls.map((call) => call.url)).toEqual([url]);
    expect(calls[0]?.init.redirect).toBe("error");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  test.each(SOURCES)("%j: an error status is not read as an answer", async (source) => {
    const { request } = serving({});
    await expect(readUpstream(source, request, "")).rejects.toThrow("HTTP 404");
  });

  test("the token reaches api.github.com and no other host", async () => {
    const { calls, request } = serving({});
    for (const [source] of SOURCES) await readUpstream(source, request, "s3cret").catch(() => null);
    const carriers = calls.filter(({ init }) =>
      JSON.stringify(init.headers ?? {}).includes("s3cret"),
    );
    expect(carriers.map((call) => call.url)).toEqual([GITHUB]);
    expect(carriers[0]?.init.headers).toEqual({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer s3cret",
    });
  });

  test("without a token the GitHub read carries no authorization at all", async () => {
    const { calls, request } = serving({});
    await readUpstream(github, request, "").catch(() => null);
    expect(calls[0]?.init.headers).toEqual({ Accept: "application/vnd.github+json" });
  });

  test("github: the latest release of the repository is the answer", async () => {
    const { request } = serving({
      [GITHUB]: json({ tag_name: "v2.7.1", published_at: OLD, draft: false, prerelease: false }),
    });
    expect(await readUpstream(github, request, "")).toEqual({ version: "2.7.1", publishedAt: OLD });
  });

  test.each([
    [{ kind: "crates", name: "../x" }],
    [{ kind: "crates", name: "syn" }],
    [{ kind: "github-release", repository: "owner/repo/../../user" }],
  ] satisfies [
    UpstreamSource,
  ][])("%j does not fit its registry's layout and asks nothing", async (source) => {
    const { calls, request } = serving({});
    expect(await readUpstream(source, request, "s3cret")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("classifyAll", () => {
  const files = filesOf({ a: "version = 1.0.0\n" });

  test("a pin that cannot be read asks the registry nothing", async () => {
    let asked = 0;
    const read = async (): Promise<LatestRelease | null> => {
      asked += 1;
      return { version: "1.0.0", publishedAt: OLD };
    };
    const [result] = await classifyAll([pinOf("tool", "missing")], files, read, NOW);
    expect(result?.state).toBe("unreadable");
    expect(asked).toBe(0);
  });

  test("a registry without a usable answer is unreadable", async () => {
    const [result] = await classifyAll([pinOf("tool", "a")], files, async () => null, NOW);
    expect(result).toEqual({
      tool: "tool",
      state: "unreadable",
      pinned: "1.0.0",
      reason: "the registry gave no usable answer",
    });
  });

  test("a failed read names an HTTP status and repeats nothing else", async () => {
    const failing = (message: string) => async (): Promise<LatestRelease | null> => {
      throw new Error(message);
    };
    const reasonOf = async (message: string) =>
      (await classifyAll([pinOf("tool", "a")], files, failing(message), NOW))[0]?.reason;
    expect(await reasonOf("HTTP 503")).toBe("the registry did not answer (HTTP 503)");
    expect(await reasonOf("connect ECONNREFUSED: whatever the network said")).toBe(
      "the registry did not answer",
    );
  });
});

describe("the report", () => {
  const files = filesOf({
    current: "version = 1.0.0\n",
    late: "version = 1.0.0\n",
    young: "version = 1.0.0\n",
    mute: "version = 1.0.0\n",
  });
  const releases: Record<string, LatestRelease | null> = {
    current: { version: "1.0.0", publishedAt: OLD },
    late: { version: "1.1.0", publishedAt: OLD },
    young: { version: "1.1.0", publishedAt: secondsAgo(60) },
    mute: null,
  };
  const read = async (source: UpstreamSource): Promise<LatestRelease | null> =>
    source.kind === "crates" ? (releases[source.name] ?? null) : null;
  const report = (...tools: string[]) =>
    freshnessReport(
      tools.map((tool) => pinOf(tool, tool)),
      files,
      read,
      NOW,
    );

  test("every state is printed, then a volume line that sums to the pins", async () => {
    const { lines, status } = await report("current", "late", "young", "mute");
    expect(lines).toEqual([
      "up-to-date: current 1.0.0: the latest release",
      `behind: late 1.0.0: 1.1.0 was published ${OLD}`,
      `too-recent: young 1.0.0: 1.1.0, published ${secondsAgo(60)}, is younger than ${MINIMUM_RELEASE_AGE_SECONDS} seconds`,
      "unreadable: mute 1.0.0: the registry gave no usable answer",
      "examined: pins=4 up-to-date=1 behind=1 too-recent=1 unreadable=1",
    ]);
    expect(status).toBe(1);
  });

  test("up to date and too recent are green", async () => {
    expect((await report("current", "young")).status).toBe(0);
  });

  test("a pin behind alone is red", async () => {
    expect((await report("current", "late")).status).toBe(1);
  });

  test("an unreadable pin alone is red", async () => {
    expect((await report("current", "mute")).status).toBe(1);
  });

  test("no pin at all is red", async () => {
    const { lines, status } = await report();
    expect(lines).toEqual(["examined: pins=0 up-to-date=0 behind=0 too-recent=0 unreadable=0"]);
    expect(status).toBe(1);
  });

  test("the volume holds only when every declared pin has a state", () => {
    const classified = [
      { tool: "a", state: "behind", pinned: "1.0.0", reason: "" },
      { tool: "b", state: "up-to-date", pinned: "1.0.0", reason: "" },
    ] as const;
    expect(volumeHolds(tallyOf(2, classified))).toBe(true);
    expect(volumeHolds(tallyOf(3, classified))).toBe(false);
    expect(volumeLine(tallyOf(2, classified))).toBe(
      "examined: pins=2 up-to-date=1 behind=1 too-recent=0 unreadable=0",
    );
    expect(PIN_STATES).toHaveLength(4);
  });

  test("the command takes no argument, and prints the report otherwise", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await main(["--anything"], [], files, read, NOW)).toBe(2);
      expect(log).not.toHaveBeenCalled();
      expect(await main([], [pinOf("late", "late")], files, read, NOW)).toBe(1);
      expect(log.mock.calls.map(([line]) => line)).toEqual([
        `behind: late 1.0.0: 1.1.0 was published ${OLD}`,
        "examined: pins=1 up-to-date=0 behind=1 too-recent=0 unreadable=0",
      ]);
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
  });
});

describe("the scheduled workflow", () => {
  interface Workflow {
    readonly on: Record<string, unknown>;
    readonly jobs: Record<string, { readonly steps: readonly { readonly run?: string }[] }>;
  }
  const workflow = Bun.YAML.parse(
    readRepositoryFile(".github/workflows/toolchain-freshness.yml") ?? "",
  ) as Workflow;

  test("runs on a schedule and by hand, never on a pull request or a push", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
  });

  test("runs this command once, with no argument", () => {
    const steps = Object.values(workflow.jobs).flatMap((job) => [...job.steps]);
    const runs = steps.filter((step) => (step.run ?? "").includes("check-toolchain-freshness"));
    expect(runs.map((step) => step.run)).toEqual(["bun tools/fleet/check-toolchain-freshness.ts"]);
  });
});
