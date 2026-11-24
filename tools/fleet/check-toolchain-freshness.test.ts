import { describe, expect, spyOn, test } from "bun:test";
import { MINIMUM_RELEASE_AGE_SECONDS } from "../../ecosystem/check-release-age";
import {
  applyExceptions,
  classifyAll,
  classifyPin,
  EXCEPTIONS_PATH,
  EXCEPTIONS_SCHEMA_VERSION,
  type FileReader,
  type FreshnessException,
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
  parseFreshnessExceptions,
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

const pinned = (version: string): PinReading => ({ kind: "pinned", version, sites: 1 });
const latest = (
  version: string,
  publishedAt: string | null = OLD,
  listed?: readonly string[],
): UpstreamAnswer => ({
  kind: "latest",
  release: { version, publishedAt, ...(listed === undefined ? {} : { listed }) },
});

describe("readPin", () => {
  test("a site that cannot be read makes the pin unreadable", () => {
    const reading = readPin(pinOf("tool", "a", "b"), filesOf({ a: "version = 1.0.0\n" }));
    expect(reading).toEqual({ kind: "unreadable", reason: "b cannot be read", sites: 1 });
  });

  test("a site that holds no pin makes the pin unreadable", () => {
    const files = filesOf({ a: "version = 1.0.0\n", b: "nothing here\n" });
    expect(readPin(pinOf("tool", "a", "b"), files)).toEqual({
      kind: "unreadable",
      reason: "no pin found in b",
      sites: 1,
    });
  });

  test("two sites that disagree are ambiguous, never one of the two", () => {
    const files = filesOf({ a: "version = 1.0.0\n", b: "version = 1.1.0\n" });
    expect(readPin(pinOf("tool", "a", "b"), files)).toEqual({
      kind: "unreadable",
      reason: 'ambiguous: "1.0.0" in a, "1.1.0" in b',
      sites: 2,
    });
  });

  test("the sites read are counted, one per declared site that held a pin", () => {
    const files = filesOf({ a: "version = 1.0.0\nversion = 1.0.0\n", b: "version = 1.0.0\n" });
    expect(readPin(pinOf("tool", "a", "b"), files)).toEqual({
      kind: "pinned",
      version: "1.0.0",
      sites: 2,
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
    expect(readPin(pin("version"), files)).toEqual({ kind: "pinned", version: "1.2.3", sites: 1 });
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

  test("a pre-release of a version above the latest release is up to date", () => {
    const result = classify("1.4.0-canary.1+57f349f63", latest("1.3.14"));
    expect(result.state).toBe("up-to-date");
    expect(result.reason).toBe("pre-release ahead of the latest release 1.3.14");
  });

  test.each([
    ["9.9.9", "1.0.0"],
    ["0.23.0", "0.22.0"],
  ])("a stable pin %s above the latest release %s is unreadable, never ahead", (pin, published) => {
    const result = classify(pin, latest(published));
    expect(result.state).toBe("unreadable");
    expect(result.reason).toBe(`the pin is above the latest release ${published}`);
  });

  test.each([
    ["withdrawn, and above what is left", "0.23.0", "0.22.0", ["0.21.0", "0.22.0"]],
    ["withdrawn, and below the latest", "0.21.0", "0.22.0", ["0.20.0", "0.22.0"]],
    ["never published, and equal to nothing listed", "0.22.1", "0.23.0", ["0.22.0", "0.23.0"]],
  ])("a pin %s, is unreadable when the source lists its versions", (_label, pin, published, listed) => {
    const result = classify(pin, latest(published, OLD, listed));
    expect(result.state).toBe("unreadable");
    expect(result.reason).toBe("the source does not publish the pinned version, or withdrew it");
  });

  test("a pin the source lists is compared as usual", () => {
    expect(classify("0.22.0", latest("0.22.0", OLD, ["0.21.0", "0.22.0"])).state).toBe(
      "up-to-date",
    );
    expect(classify("0.21.0", latest("0.22.0", OLD, ["0.21.0", "0.22.0"])).state).toBe("behind");
  });

  test("a release dated in the future is unreadable, never too recent", () => {
    const result = classify("1.2.3", latest("1.3.0", "2099-01-01T00:00:00Z"));
    expect(result.state).toBe("unreadable");
    expect(result.reason).toBe("1.3.0 is dated in the future, 2099-01-01T00:00:00.000Z");
    expect(classify("1.2.3", latest("1.3.0", secondsAgo(0))).state).toBe("too-recent");
  });

  test("the pre-release and build parts of a pin are bounded", () => {
    expect(parsePinned(`1.2.3-${"a".repeat(32)}+${"b".repeat(32)}`)).not.toBeNull();
    expect(parsePinned(`1.2.3-${"a".repeat(33)}`)).toBeNull();
    expect(parsePinned(`1.2.3+${"b".repeat(33)}`)).toBeNull();
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
    const reading: PinReading = { kind: "unreadable", reason: "pin reason", sites: 0 };
    expect(classifyPin("tool", reading, latest("1.0.0"), NOW)).toEqual({
      tool: "tool",
      state: "unreadable",
      pinned: null,
      reason: "pin reason",
      sites: 0,
    });
    expect(classify("1.2.3", upstream)).toEqual({
      tool: "tool",
      state: "unreadable",
      pinned: "1.2.3",
      reason: "registry reason",
      sites: 1,
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
      listed: ["0.22.0", "0.9.0", "0.24.0-rc.1"],
    });
  });

  test("crates.io: a pin on a yanked version, above what is left, is unreadable", () => {
    const index = [crate("0.22.0"), crate("0.23.0", { yanked: true })].join("\n");
    const release = latestFromCratesIndex(index, "cargo-deny");
    expect(release?.listed).toEqual(["0.22.0"]);
    const upstream: UpstreamAnswer = { kind: "latest", release: release as LatestRelease };
    expect(classifyPin("cargo-deny", pinned("0.23.0"), upstream, NOW).state).toBe("unreadable");
    expect(classifyPin("cargo-deny", pinned("0.22.0"), upstream, NOW).state).toBe("up-to-date");
  });

  test("crates.io: a version without a publication time keeps a null date", () => {
    const index = JSON.stringify({ name: "cargo-deny", vers: "1.0.0", yanked: false });
    expect(latestFromCratesIndex(index, "cargo-deny")).toEqual({
      version: "1.0.0",
      publishedAt: null,
      listed: ["1.0.0"],
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

  test("rust: the stable version, dated at the end of the manifest's day, not before its start", () => {
    expect(latestFromRustChannel(channel('"2026-11-12"'))).toEqual({
      version: "1.100.0",
      publishedAt: "2026-11-13T00:00:00.000Z",
      publishedNotBefore: "2026-11-12T00:00:00.000Z",
    });
  });

  // The manifest and the classification together: the day of a Rust release,
  // its end is ahead of the clock, and that is not a date in the future.
  test.each([
    [
      "the day of the release",
      "2026-11-23",
      "too-recent",
      /published 2026-11-24T00:00:00\.000Z, is younger/,
    ],
    [
      "the day before the release",
      "2026-11-24",
      "unreadable",
      /^1\.100\.0 is dated in the future, 2026-11-24T00:00:00\.000Z$/,
    ],
    [
      "four days after the release",
      "2026-11-19",
      "behind",
      /^1\.100\.0 was published 2026-11-20T00:00:00\.000Z$/,
    ],
  ] as const)("rust, read at noon on 2026-11-23, %s (manifest dated %s): %s", (_label, date, state, reason) => {
    const noon = new Date("2026-11-23T12:00:00Z");
    const release = latestFromRustChannel(channel(`"${date}"`)) as LatestRelease;
    const result = classifyPin("rust", pinned("1.99.0"), { kind: "latest", release }, noon);
    expect(result.state).toBe(state);
    expect(result.reason).toMatch(reason);
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

  test("by default the token is the GH_TOKEN of the environment, trimmed", async () => {
    const before = process.env.GH_TOKEN;
    process.env.GH_TOKEN = " from-the-environment\n";
    try {
      const { calls, request } = serving({});
      await readUpstream(github, request).catch(() => null);
      expect(calls[0]?.init.headers).toEqual({
        Accept: "application/vnd.github+json",
        Authorization: "Bearer from-the-environment",
      });
    } finally {
      if (before === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = before;
    }
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
      sites: 1,
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
  const hold = (tool: string, extra: Partial<FreshnessException> = {}): FreshnessException => ({
    tool,
    heldAt: "1.0.0",
    because: "kept on purpose",
    until: "2026-12-31",
    ...extra,
  });
  const report = (tools: readonly string[], exceptions: readonly FreshnessException[] = []) =>
    freshnessReport(
      tools.map((tool) => pinOf(tool, tool)),
      exceptions,
      files,
      read,
      NOW,
    );
  const YOUNG = `1.1.0, published ${secondsAgo(60)}, is younger than ${MINIMUM_RELEASE_AGE_SECONDS} seconds`;

  test("every state is printed, then a volume line that sums to the pins", async () => {
    const tools = ["current", "late", "young", "mute", "kept"];
    const keptFiles: Record<string, LatestRelease | null | undefined> = {
      ...releases,
      kept: releases.late,
    };
    const { lines, status } = await freshnessReport(
      tools.map((tool) => pinOf(tool, tool === "kept" ? "late" : tool)),
      [hold("kept")],
      files,
      async (source) => (source.kind === "crates" ? (keptFiles[source.name] ?? null) : null),
      NOW,
    );
    expect(lines).toEqual([
      "up-to-date: current 1.0.0: the latest release",
      `behind: late 1.0.0: 1.1.0 was published ${OLD}`,
      `too-recent: young 1.0.0: ${YOUNG}`,
      "unreadable: mute 1.0.0: the registry gave no usable answer",
      `held: kept 1.0.0: 1.1.0 was published ${OLD}; held until 2026-12-31: kept on purpose`,
      "examined: pins=5 sites=5/5 up-to-date=1 behind=1 too-recent=1 held=1 unreadable=1 exceptions=1 exception-failures=0",
    ]);
    expect(status).toBe(1);
  });

  test("up to date, too recent and held are green", async () => {
    expect((await report(["current", "young"])).status).toBe(0);
    expect((await report(["current", "late"], [hold("late")])).status).toBe(0);
  });

  test("a pin behind alone is red", async () => {
    expect((await report(["current", "late"])).status).toBe(1);
  });

  test("an unreadable pin alone is red", async () => {
    expect((await report(["current", "mute"])).status).toBe(1);
  });

  test("no pin at all is red", async () => {
    const { lines, status } = await report([]);
    expect(lines).toEqual([
      "examined: pins=0 sites=0/0 up-to-date=0 behind=0 too-recent=0 held=0 unreadable=0 exceptions=0 exception-failures=0",
    ]);
    expect(status).toBe(1);
  });

  test("a tool declared twice breaks the sum of the volume line, and the run is red", async () => {
    const { lines, status } = await report(["current", "current"]);
    expect(lines.at(-1)).toBe(
      "examined: pins=2 sites=2/2 up-to-date=1 behind=0 too-recent=0 held=0 unreadable=0 exceptions=0 exception-failures=0",
    );
    expect(status).toBe(1);
  });

  test("the sites read fall short of the sites declared when one is missing", async () => {
    const pin = pinOf("current", "current", "absent");
    const { lines } = await freshnessReport([pin], [], files, read, NOW);
    expect(lines.at(-1)).toContain("pins=1 sites=1/2 ");
  });

  test("the volume holds when the states sum to the pins, and the five states are counted", () => {
    const classified = [
      { tool: "a", state: "behind", pinned: "1.0.0", reason: "", sites: 2 },
      { tool: "b", state: "held", pinned: "1.0.0", reason: "", sites: 1 },
    ] as const;
    const two = [pinOf("a", "x", "y"), pinOf("b", "z")];
    expect(volumeHolds(tallyOf(two, classified))).toBe(true);
    expect(volumeHolds(tallyOf([...two, pinOf("c")], classified))).toBe(false);
    expect(volumeLine(tallyOf(two, classified), 1, 0)).toBe(
      "examined: pins=2 sites=3/3 up-to-date=0 behind=1 too-recent=0 held=1 unreadable=0 exceptions=1 exception-failures=0",
    );
    expect(PIN_STATES).toEqual(["up-to-date", "behind", "too-recent", "held", "unreadable"]);
  });

  describe("an exception", () => {
    const failuresOf = async (
      tools: readonly string[],
      exceptions: readonly FreshnessException[],
      now: Date = NOW,
    ) => {
      const pins = tools.map((tool) => pinOf(tool, tool));
      const measured = await classifyAll(pins, files, read, now);
      return applyExceptions(measured, exceptions, now);
    };

    test("holds a pin behind, at the exact pinned version, with its reason and its date", async () => {
      const { classifications, failures } = await failuresOf(["late"], [hold("late")]);
      expect(failures).toEqual([]);
      expect(classifications[0]).toMatchObject({
        state: "held",
        reason: `1.1.0 was published ${OLD}; held until 2026-12-31: kept on purpose`,
      });
    });

    test("holds a pin whose higher release is still too recent", async () => {
      const { classifications, failures } = await failuresOf(["young"], [hold("young")]);
      expect(failures).toEqual([]);
      expect(classifications[0]?.state).toBe("held");
    });

    test("for another version than the pinned one is stale: a failure, the pin stays behind", async () => {
      const stale = [hold("late", { heldAt: "0.9.0" })];
      const { classifications, failures } = await failuresOf(["late"], stale);
      expect(failures).toEqual([
        "stale exception: late is held at 0.9.0 and pinned at 1.0.0; remove the entry",
      ]);
      expect(classifications[0]?.state).toBe("behind");
      expect((await report(["late"], stale)).status).toBe(1);
    });

    test("holds through its last day and fails the day after", async () => {
      const lastDay = new Date("2026-12-31T23:59:59Z");
      const dayAfter = new Date("2027-01-01T00:00:00Z");
      expect((await failuresOf(["late"], [hold("late")], lastDay)).failures).toEqual([]);
      const { classifications, failures } = await failuresOf(["late"], [hold("late")], dayAfter);
      expect(failures).toEqual(["expired exception: late was held until 2026-12-31"]);
      expect(classifications[0]?.state).toBe("behind");
    });

    test("for a tool that is up to date is dead: a failure on a pin that is green", async () => {
      const dead = [hold("current")];
      const { classifications, failures } = await failuresOf(["current"], dead);
      expect(failures).toEqual(["dead exception: current is up to date; remove the entry"]);
      expect(classifications[0]?.state).toBe("up-to-date");
      const { lines, status } = await report(["current"], dead);
      expect(lines).toEqual([
        "up-to-date: current 1.0.0: the latest release",
        "dead exception: current is up to date; remove the entry",
        "examined: pins=1 sites=1/1 up-to-date=1 behind=0 too-recent=0 held=0 unreadable=0 exceptions=1 exception-failures=1",
      ]);
      expect(status).toBe(1);
    });

    test("for a tool that is not a declared pin is dead", async () => {
      const { failures } = await failuresOf(["current"], [hold("ghost")]);
      expect(failures).toEqual(["dead exception: ghost is not a declared pin"]);
    });

    test("of a pin that could not be read is not judged, and the pin stays unreadable", async () => {
      const { classifications, failures } = await failuresOf(["mute"], [hold("mute")]);
      expect(failures).toEqual([]);
      expect(classifications[0]?.state).toBe("unreadable");
    });
  });

  describe("the exception register", () => {
    const document = (entries: string): string =>
      `schema_version: ${EXCEPTIONS_SCHEMA_VERSION}\nexceptions:${entries}\n`;
    const entry = (fields: Record<string, string>): string =>
      `\n  - ${Object.entries(fields)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n    ")}`;
    const VALID = {
      tool: "bun",
      held_at: "1.4.0-canary.1+57f349f63",
      because: "why",
      until: '"2026-12-31"',
    };

    test("an empty register is accepted", () => {
      expect(parseFreshnessExceptions(document(" []"))).toEqual([]);
    });

    test("a well-formed entry is returned", () => {
      expect(parseFreshnessExceptions(document(entry(VALID)))).toEqual([
        { tool: "bun", heldAt: "1.4.0-canary.1+57f349f63", because: "why", until: "2026-12-31" },
      ]);
    });

    test.each([
      ["no tool", { ...VALID, tool: '""' }, /\.tool is required/],
      ["no held version", { ...VALID, held_at: '""' }, /\.held_at is required/],
      [
        "a held version that is not exact",
        { ...VALID, held_at: "latest" },
        /held_at must be an exact version/,
      ],
      ["no reason", { ...VALID, because: '" "' }, /\.because is required/],
      [
        "a reason on two lines",
        { ...VALID, because: '"one\\ntwo"' },
        /\.because is required, on one line/,
      ],
      ["a date that does not exist", { ...VALID, until: '"2026-02-30"' }, /\.until is required/],
      ["a date that is not a day", { ...VALID, until: "soon" }, /\.until is required/],
    ])("an entry with %s throws", (_label, fields, message) => {
      expect(() => parseFreshnessExceptions(document(entry(fields)))).toThrow(message);
    });

    test("an entry without a date throws: a hold always ends", () => {
      const { until: _until, ...undated } = VALID;
      expect(() => parseFreshnessExceptions(document(entry(undated)))).toThrow(
        /\.until is required/,
      );
    });

    test("an entry with a key the reader does not know throws: no field is ignored", () => {
      const scoped = document(entry({ ...VALID, scope: '"*"' }));
      expect(() => parseFreshnessExceptions(scoped)).toThrow(
        /exceptions\[0\]: `scope` is not one of tool, held_at, because, until/,
      );
    });

    test("a root key the reader does not know throws: a second list is not an empty register", () => {
      const text = `schema_version: ${EXCEPTIONS_SCHEMA_VERSION}\nexceptions: []\nexemptions:${entry(VALID)}\n`;
      expect(() => parseFreshnessExceptions(text)).toThrow(
        /`exemptions` is not one of schema_version, exceptions/,
      );
    });

    test("a key written twice throws, in an entry as at the root: the last one does not win", () => {
      const twice = document(`${entry(VALID)}\n    tool: rust`);
      expect(() => parseFreshnessExceptions(twice)).toThrow(
        /exceptions\[0\]: `tool` is written twice/,
      );
      expect(() => parseFreshnessExceptions(`${document(" []")}exceptions: []\n`)).toThrow(
        /`exceptions` is written twice/,
      );
    });

    test.each([
      [
        "a flow-style entry",
        `schema_version: ${EXCEPTIONS_SCHEMA_VERSION}\nexceptions: [{tool: bun, held_at: 1.0.0, because: why, until: 2026-12-31, scope: all}]\n`,
        /1 entries parsed, 0 written in block style/,
      ],
      ["a quoted key", document('\n  - "tool": bun'), /line 3 is outside the block style/],
      [
        "a value on a second line",
        document(`${entry(VALID)}\n      continued`),
        /line 7 is outside the block style/,
      ],
    ])("%s escapes the line scan, and throws", (_label, text, message) => {
      expect(() => parseFreshnessExceptions(text)).toThrow(message);
    });

    test("a date is read the same quoted or not", () => {
      const bare = parseFreshnessExceptions(document(entry({ ...VALID, until: "2026-12-31" })));
      expect(bare).toEqual(parseFreshnessExceptions(document(entry(VALID))));
    });

    test("two entries for one tool throw", () => {
      expect(() => parseFreshnessExceptions(document(entry(VALID) + entry(VALID)))).toThrow(
        /duplicates the entry for bun/,
      );
    });

    test("a register without the schema version or without a list throws", () => {
      expect(() => parseFreshnessExceptions("exceptions: []\n")).toThrow(/schema_version/);
      expect(() =>
        parseFreshnessExceptions(`schema_version: ${EXCEPTIONS_SCHEMA_VERSION}\n`),
      ).toThrow(/must be a list/);
    });

    // Read in the tracked tree, against the tracked pins: no registry is asked.
    test("the committed register parses, and each entry holds the version its pin is at", () => {
      const committed = parseFreshnessExceptions(readRepositoryFile(EXCEPTIONS_PATH) ?? "");
      expect(committed.length).toBeGreaterThan(0);
      for (const { tool, heldAt } of committed) {
        const pin = TOOLCHAIN_PINS.find((candidate) => candidate.tool === tool);
        expect(pin).toBeDefined();
        expect(readPin(pin as ToolchainPin, readRepositoryFile)).toMatchObject({ version: heldAt });
      }
    });
  });

  describe("the command", () => {
    const withRegister = (register: string | null): FileReader => {
      const read = filesOf({ late: "version = 1.0.0\n" });
      return (path) => (path === EXCEPTIONS_PATH ? register : read(path));
    };
    const EMPTY = `schema_version: ${EXCEPTIONS_SCHEMA_VERSION}\nexceptions: []\n`;
    const run = async (argv: readonly string[], register: string | null) => {
      const error = spyOn(console, "error").mockImplementation(() => {});
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        const status = await main(argv, [pinOf("late", "late")], withRegister(register), read, NOW);
        return {
          status,
          printed: log.mock.calls.map(([line]) => line as string),
          errors: error.mock.calls.map(([line]) => line as string),
        };
      } finally {
        error.mockRestore();
        log.mockRestore();
      }
    };

    test("takes no argument", async () => {
      expect(await run(["--anything"], EMPTY)).toMatchObject({ status: 2, printed: [] });
    });

    test("prints the report and exits 1 on a pin behind", async () => {
      const { status, printed } = await run([], EMPTY);
      expect(status).toBe(1);
      expect(printed).toEqual([
        `behind: late 1.0.0: 1.1.0 was published ${OLD}`,
        "examined: pins=1 sites=1/1 up-to-date=0 behind=1 too-recent=0 held=0 unreadable=0 exceptions=0 exception-failures=0",
      ]);
    });

    test("applies the register it reads at its path", async () => {
      const register = `schema_version: ${EXCEPTIONS_SCHEMA_VERSION}\nexceptions:\n  - tool: late\n    held_at: 1.0.0\n    because: why\n    until: "2026-12-31"\n`;
      const { status, printed } = await run([], register);
      expect(status).toBe(0);
      expect(printed[0]).toBe(
        `held: late 1.0.0: 1.1.0 was published ${OLD}; held until 2026-12-31: why`,
      );
    });

    test.each([
      ["missing", null, /cannot be read/],
      ["malformed", "exceptions: []\n", /schema_version/],
    ])("fails before reading anything when the register is %s", async (_label, register, message) => {
      const { status, printed, errors } = await run([], register);
      expect(status).toBe(1);
      expect(printed).toEqual([]);
      expect(errors.join("\n")).toMatch(message);
    });
  });
});

describe("the scheduled workflow", () => {
  interface Step {
    readonly uses?: string;
    readonly run?: string;
    readonly with?: Record<string, unknown>;
    readonly env?: Record<string, string>;
  }
  interface Job {
    readonly needs?: string | readonly string[];
    readonly if?: string;
    readonly permissions?: Record<string, string>;
    readonly steps: readonly (Step & { readonly if?: string })[];
  }
  interface Workflow {
    readonly on: Record<string, unknown>;
    readonly jobs: Record<string, Job>;
  }
  const workflow = Bun.YAML.parse(
    readRepositoryFile(".github/workflows/toolchain-freshness.yml") ?? "",
  ) as Workflow;
  const jobs = Object.values(workflow.jobs);
  const reads = (job: Job): boolean =>
    job.steps.some((step) => (step.run ?? "").includes("check-toolchain-freshness"));

  test("runs on a schedule and by hand, never on a pull request or a push", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
  });

  test("runs this command once, with no argument", () => {
    const runs = jobs
      .flatMap((job) => [...job.steps])
      .filter((step) => (step.run ?? "").includes("check-toolchain-freshness"));
    expect(runs.map((step) => step.run)).toEqual(["bun tools/fleet/check-toolchain-freshness.ts"]);
  });

  test("the job that reads the outside world holds a token that can only read", () => {
    const readers = jobs.filter(reads);
    expect(readers).toHaveLength(1);
    expect(readers[0]?.permissions).toEqual({ contents: "read" });
  });

  test("the job that may write an issue never runs the command that reads the outside world", () => {
    const alerters = jobs.filter((job) =>
      job.steps.some((step) => (step.run ?? "").includes("repeat-failure-alert")),
    );
    expect(alerters).toHaveLength(1);
    expect(alerters.some(reads)).toBe(false);
  });

  test("no checkout leaves its credentials in the working tree", () => {
    const checkouts = jobs
      .flatMap((job) => [...job.steps])
      .filter((step) => (step.uses ?? "").startsWith("actions/checkout@"));
    expect(checkouts.length).toBe(jobs.length);
    for (const checkout of checkouts) expect(checkout.with?.["persist-credentials"]).toBe(false);
  });

  // The conditions that carry the alert are evaluated, not compared as text:
  // a rewording that decides the same passes, one that decides otherwise fails.
  // The subset of the expression language they use: `||`, `&&`, `==`, `!=`,
  // parentheses, quoted strings, context paths and status functions.
  type Value = string | boolean;
  interface Scope {
    readonly paths: Readonly<Record<string, string>>;
    readonly functions: Readonly<Record<string, boolean>>;
  }
  const TOKEN = /\s*(\|\||&&|==|!=|\(|\)|'[^']*'|[A-Za-z_][\w.-]*)/y;
  const evaluate = (expression: string, scope: Scope): boolean => {
    const tokens: string[] = [];
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < expression.trimEnd().length) {
      const match = TOKEN.exec(expression);
      if (match === null) throw new Error(`unreadable condition: ${expression}`);
      tokens.push(match[1] ?? "");
    }
    let at = 0;
    const take = (): string => tokens[at++] ?? "";
    const primary = (): Value => {
      const token = take();
      if (token === "(") {
        const inner = either();
        if (take() !== ")") throw new Error(`unbalanced condition: ${expression}`);
        return inner;
      }
      if (token.startsWith("'")) return token.slice(1, -1);
      if (tokens[at] === "(") {
        at += 2;
        const known = scope.functions[token];
        if (known === undefined) throw new Error(`unknown function ${token}`);
        return known;
      }
      const known = scope.paths[token];
      if (known === undefined) throw new Error(`unknown context ${token}`);
      return known;
    };
    const equality = (): Value => {
      const left = primary();
      if (tokens[at] !== "==" && tokens[at] !== "!=") return left;
      const equal = take() === "==";
      return (left === primary()) === equal;
    };
    const both = (): Value => {
      let value = equality();
      while (tokens[at] === "&&") {
        at += 1;
        const right = equality();
        value = Boolean(value) && Boolean(right);
      }
      return value;
    };
    const either = (): Value => {
      let value = both();
      while (tokens[at] === "||") {
        at += 1;
        const right = both();
        value = Boolean(value) || Boolean(right);
      }
      return value;
    };
    const result = either();
    if (at !== tokens.length) throw new Error(`trailing tokens in condition: ${expression}`);
    return Boolean(result);
  };

  const readerId = Object.keys(workflow.jobs).find((id) => reads(workflow.jobs[id] as Job)) ?? "";
  const alerter = jobs.find((job) => !reads(job)) as Job;
  const stepRunning = (suffix: string) =>
    alerter.steps.find((step) => (step.run ?? "").endsWith(suffix)) as Job["steps"][number];
  const RESULTS = ["success", "failure", "cancelled", "skipped"] as const;
  const EVENTS = ["schedule", "workflow_dispatch", "push", "pull_request"] as const;
  const LOOP_EVENTS: readonly string[] = ["schedule", "workflow_dispatch"];
  // In a step, the status functions weigh the earlier steps of the job; here
  // none has failed, so only the result of the reading job can decide.
  const stepScope = (result: string, event: string): Scope => ({
    paths: { [`needs.${readerId}.result`]: result, "github.event_name": event },
    functions: { failure: false, success: true, always: true },
  });

  test("the alert job needs the reading job, and runs whatever that job concluded", () => {
    expect([alerter.needs].flat()).toEqual([readerId]);
    for (const result of RESULTS) {
      // At job level the status functions weigh the needed jobs.
      const scope: Scope = {
        paths: {},
        functions: { always: true, success: result === "success", failure: result === "failure" },
      };
      expect([result, evaluate(alerter.if ?? "success()", scope)]).toEqual([result, true]);
    }
  });

  test("the alert step starts on the failure of the reading job only, in a loop run only", () => {
    const condition = stepRunning("repeat-failure-alert.ts").if ?? "";
    for (const result of RESULTS) {
      for (const event of EVENTS) {
        const expected = result === "failure" && LOOP_EVENTS.includes(event);
        expect([result, event, evaluate(condition, stepScope(result, event))]).toEqual([
          result,
          event,
          expected,
        ]);
      }
    }
  });

  test("the closing step starts on the success of the reading job only, in a loop run only", () => {
    const condition = stepRunning("repeat-failure-alert.ts --resolve").if ?? "";
    for (const result of RESULTS) {
      for (const event of EVENTS) {
        const expected = result === "success" && LOOP_EVENTS.includes(event);
        expect([result, event, evaluate(condition, stepScope(result, event))]).toEqual([
          result,
          event,
          expected,
        ]);
      }
    }
  });
});
