import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderGateReport } from "../tools/quality/gate-report";
import {
  readFleetStaleness,
  STALENESS_BATCH_SIZE,
  type StalenessTransport,
} from "./check-fleet-staleness";
import {
  buildStalenessQuery,
  DORMANT_AFTER_DAYS,
  evaluateStaleness,
  type OpenPullRequest,
  PULL_REQUEST_STALE_AFTER_DAYS,
  parseStalenessExceptions,
  parseStalenessResponse,
  type RepositoryReading,
  STALENESS_EXCEPTIONS_SCHEMA_VERSION,
  type StalenessException,
  type StalenessInput,
  type StalenessKind,
} from "./fleet-staleness";

// Expected values come from the brief of the control, not from the code: 90
// and 30 days, strict comparison, a clock injected. No test reaches a forge.

const NOW = new Date("2026-11-01T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY_MS).toISOString();

const pullRequest = (number: number, ageDays: number, isDraft = false): OpenPullRequest => ({
  number,
  createdAt: daysAgo(ageDays),
  isDraft,
  url: `https://forge.example/acme/repo/pull/${number}`,
});

const read = (
  headAgeDays: number | null,
  pullRequests: readonly OpenPullRequest[] = [],
): RepositoryReading => ({
  kind: "read",
  headCommittedAt: headAgeDays === null ? null : daysAgo(headAgeDays),
  pullRequests,
});

const evaluate = (
  readings: Record<string, RepositoryReading>,
  overrides: Partial<StalenessInput> = {},
) =>
  evaluateStaleness({
    now: NOW,
    declared: Object.keys(readings),
    excluded: [],
    readings: new Map(Object.entries(readings)),
    exceptions: [],
    ...overrides,
  });

const exception = (repository: string, kind: StalenessKind, number?: number): StalenessException =>
  number === undefined
    ? { repository, kind, because: "kept on purpose" }
    : { repository, kind, number, because: "kept on purpose" };

describe("thresholds", () => {
  test("are the two limits of the control", () => {
    expect(DORMANT_AFTER_DAYS).toBe(90);
    expect(PULL_REQUEST_STALE_AFTER_DAYS).toBe(30);
  });
});

describe("evaluateStaleness — D1 dormant repository", () => {
  test("a head commit 91 days old is a failed dormant check", () => {
    const { report } = evaluate({ "acme/quiet": read(91) });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toStartWith("dormant 'acme/quiet': ");
    expect(report.violations[0]).toContain("91 day(s) ago (limit 90)");
  });

  test("exactly 90 days is not a finding", () => {
    const { report } = evaluate({ "acme/edge": read(90) });
    expect(report.violations).toEqual([]);
    expect(report.outcome).toBe("pass");
  });

  test("a repository with no served branch fails, it is never healthy", () => {
    const { report } = evaluate({ "acme/empty": read(null) });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toStartWith("dormant 'acme/empty': no served branch");
    expect(report.outcome).toBe("violations");
  });
});

describe("evaluateStaleness — D2 old pull request", () => {
  test("a pull request 31 days old is a failed check carrying its number", () => {
    const { report } = evaluate({ "acme/repo": read(1, [pullRequest(42, 31)]) });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toStartWith("pull-request 'acme/repo#42': ");
    expect(report.violations[0]).toContain("open for 31 day(s) (limit 30)");
    expect(report.violations[0]).not.toContain("draft");
  });

  test("exactly 30 days is not a finding", () => {
    const { report } = evaluate({ "acme/repo": read(1, [pullRequest(42, 30)]) });
    expect(report.violations).toEqual([]);
  });

  test("a draft pull request is reported with the draft marker", () => {
    const { report } = evaluate({ "acme/repo": read(1, [pullRequest(7, 45, true)]) });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("open for 45 day(s) (limit 30), draft");
  });
});

describe("evaluateStaleness — unreadable repository", () => {
  test("one unreadable repository among three is named, the two others are judged", () => {
    const { report } = evaluate({
      "acme/a": read(1),
      "acme/broken": { kind: "unreadable", reason: "alias was null" },
      "acme/c": read(2),
    });
    expect(report.violations).toEqual(["repository 'acme/broken': unreadable: alias was null"]);
    const items = report.checks.map((check) => check.item);
    expect(items).toContain("dormant 'acme/a'");
    expect(items).toContain("dormant 'acme/c'");
  });

  test("a declared repository without any reading is unreadable, not skipped", () => {
    const { report } = evaluate({ "acme/a": read(1) }, { declared: ["acme/a", "acme/lost"] });
    expect(report.violations).toEqual([
      "repository 'acme/lost': unreadable: no reading was returned",
    ]);
  });
});

describe("evaluateStaleness — exceptions", () => {
  test("a covered finding is an EXCEPTED line and no failure", () => {
    const { report, excepted } = evaluate(
      { "acme/quiet": read(200), "acme/repo": read(1, [pullRequest(9, 60)]) },
      {
        exceptions: [exception("acme/quiet", "dormant"), exception("acme/repo", "pull-request", 9)],
      },
    );
    expect(report.violations).toEqual([]);
    expect(excepted).toHaveLength(2);
    expect(excepted[0]).toStartWith("EXCEPTED dormant 'acme/quiet': ");
    expect(excepted[0]).toEndWith("— kept on purpose");
    expect(excepted[1]).toStartWith("EXCEPTED pull-request 'acme/repo#9': ");
  });

  test("an exception for another pull request number does not cover the finding", () => {
    const { report, excepted } = evaluate(
      { "acme/repo": read(1, [pullRequest(9, 60), pullRequest(10, 60)]) },
      { exceptions: [exception("acme/repo", "pull-request", 9)] },
    );
    expect(excepted).toHaveLength(1);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toStartWith("pull-request 'acme/repo#10': ");
  });

  test("an exception that covers no finding fails as stale", () => {
    const { report, excepted } = evaluate(
      { "acme/awake": read(3) },
      { exceptions: [exception("acme/awake", "dormant")] },
    );
    expect(excepted).toEqual([]);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toStartWith("exception 'acme/awake dormant': stale exception");
  });
});

describe("evaluateStaleness — volume", () => {
  const fixture = () =>
    evaluate(
      {
        "acme/a": read(1, [pullRequest(1, 2), pullRequest(2, 40)]),
        "acme/quiet": read(120),
        "acme/broken": { kind: "unreadable", reason: "alias was null" },
      },
      {
        declared: ["acme/a", "acme/quiet", "acme/broken", "acme/private"],
        excluded: ["acme/private"],
        exceptions: [exception("acme/quiet", "dormant")],
      },
    );
  const counter = (summary: string, name: string): number => {
    const match = new RegExp(`(?:^|[ ;])${name}=(\\d+)`).exec(summary);
    if (match?.[1] === undefined) throw new Error(`counter ${name} not printed in: ${summary}`);
    return Number(match[1]);
  };

  test("every counter of the control is printed with its value", () => {
    const summary = fixture().report.volumeSummary ?? "";
    expect(counter(summary, "declared")).toBe(4);
    expect(counter(summary, "examined")).toBe(2);
    expect(counter(summary, "excluded-private")).toBe(1);
    expect(counter(summary, "unreadable")).toBe(1);
    expect(counter(summary, "open-pull-requests-read")).toBe(2);
    expect(counter(summary, "stale-pull-requests")).toBe(1);
    expect(counter(summary, "dormant")).toBe(1);
    expect(counter(summary, "excepted")).toBe(1);
    expect(counter(summary, "stale-exceptions")).toBe(0);
  });

  test("the counters sum to the universe they claim", () => {
    const { report } = fixture();
    const summary = report.volumeSummary ?? "";
    expect(
      counter(summary, "examined") +
        counter(summary, "excluded-private") +
        counter(summary, "unreadable"),
    ).toBe(counter(summary, "declared"));
    // Findings that fail + findings excepted = dormant + stale pull requests.
    const failingFindings = report.violations.filter(
      (violation) => violation.startsWith("dormant ") || violation.startsWith("pull-request "),
    ).length;
    expect(failingFindings + counter(summary, "excepted")).toBe(
      counter(summary, "dormant") + counter(summary, "stale-pull-requests"),
    );
  });

  test("the success line carries the volume", () => {
    const { report } = evaluate({ "acme/a": read(1, [pullRequest(1, 2)]) });
    const rendered = renderGateReport("Fleet staleness", report);
    expect(rendered.ok).toBe(true);
    expect(rendered.lines[0]).toContain("declared=1 = examined=1 + excluded-private=0");
  });

  test("an empty declared universe fails the gate", () => {
    const { report } = evaluate({});
    expect(report.outcome).toBe("empty");
    expect(renderGateReport("Fleet staleness", report).ok).toBe(false);
  });

  test("a universe made only of excluded repositories fails as well", () => {
    const { report } = evaluate({}, { declared: ["acme/private"], excluded: ["acme/private"] });
    expect(renderGateReport("Fleet staleness", report).ok).toBe(false);
  });
});

describe("buildStalenessQuery", () => {
  const query = buildStalenessQuery(["acme/one", "acme/two"]);

  test("is a read: no mutation", () => {
    expect(query).not.toMatch(/mutation/i);
    expect(query).toStartWith("query {");
  });

  test("reaches the served branch through defaultBranchRef, never by name", () => {
    expect(query).toContain("defaultBranchRef");
    expect(query).not.toMatch(/\b(main|master|trunk|develop)\b/);
    expect(query).not.toContain("refs/heads");
    expect(query).not.toContain("object(expression");
  });

  test("asks one alias per repository, open pull requests with their total", () => {
    expect(query).toContain('r0: repository(owner: "acme", name: "one")');
    expect(query).toContain('r1: repository(owner: "acme", name: "two")');
    expect(query).toContain("pullRequests(states: OPEN, first: 100)");
    expect(query).toContain("totalCount");
  });

  test("refuses an entry that is not owner/name", () => {
    expect(() => buildStalenessQuery(["no-owner"])).toThrow(/owner\/name/);
  });
});

describe("parseStalenessResponse", () => {
  const node = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    defaultBranchRef: { target: { committedDate: "2026-10-30T08:00:00Z" } },
    pullRequests: { totalCount: 0, nodes: [] },
    ...overrides,
  });
  const prNode = { number: 3, createdAt: "2026-10-01T00:00:00Z", isDraft: true, url: "u" };
  const repositories = ["acme/ok", "acme/bad", "acme/also-ok"];
  const parse = (bad: unknown) =>
    parseStalenessResponse(repositories, { r0: node(), r1: bad, r2: node() });

  test("a complete node is read with its head date and pull requests", () => {
    const readings = parseStalenessResponse(["acme/ok"], {
      r0: node({ pullRequests: { totalCount: 1, nodes: [prNode] } }),
    });
    expect(readings.get("acme/ok")).toEqual({
      kind: "read",
      headCommittedAt: "2026-10-30T08:00:00Z",
      pullRequests: [prNode],
    });
  });

  test("a null defaultBranchRef is an answer: read, with no served branch", () => {
    const readings = parseStalenessResponse(["acme/empty"], {
      r0: node({ defaultBranchRef: null }),
    });
    expect(readings.get("acme/empty")).toEqual({
      kind: "read",
      headCommittedAt: null,
      pullRequests: [],
    });
  });

  test.each([
    ["a null alias", null],
    ["an absent defaultBranchRef", { pullRequests: { totalCount: 0, nodes: [] } }],
    ["a defaultBranchRef without a commit date", node({ defaultBranchRef: { target: {} } })],
    [
      "more pull requests announced than read",
      node({ pullRequests: { totalCount: 101, nodes: [prNode] } }),
    ],
    ["a missing totalCount", node({ pullRequests: { nodes: [] } })],
    [
      "a pull request node without createdAt",
      node({ pullRequests: { totalCount: 1, nodes: [{ number: 1, isDraft: false, url: "u" }] } }),
    ],
  ])("%s makes that repository alone unreadable", (_label, bad) => {
    const readings = parse(bad);
    expect(readings.get("acme/bad")?.kind).toBe("unreadable");
    expect(readings.get("acme/ok")?.kind).toBe("read");
    expect(readings.get("acme/also-ok")?.kind).toBe("read");
    expect(readings.size).toBe(3);
  });

  // Date.parse reads far more than ISO 8601: "1" is 2001, "March 7" is a year
  // the engine picks. GraphQL DateTime is ISO 8601, so anything else is a
  // response that lost its shape, not a date.
  test.each([
    "1",
    "March 7, 2026",
    "2026-10-30",
    "2026/10/30 08:00:00",
    "2026-10-30 08:00:00Z",
  ])("a head commit date %p that is not an ISO 8601 date-time makes the repository unreadable", (committedDate) => {
    const readings = parse(node({ defaultBranchRef: { target: { committedDate } } }));
    expect(readings.get("acme/bad")?.kind).toBe("unreadable");
    expect(readings.get("acme/ok")?.kind).toBe("read");
  });

  test.each([
    "1",
    "October 1, 2026",
  ])("a pull request createdAt %p that is not an ISO 8601 date-time makes the repository unreadable", (createdAt) => {
    const readings = parse(
      node({ pullRequests: { totalCount: 1, nodes: [{ ...prNode, createdAt }] } }),
    );
    expect(readings.get("acme/bad")?.kind).toBe("unreadable");
  });

  test.each([
    "2026-10-30T08:00:00Z",
    "2026-10-30T08:00:00.123Z",
    "2026-10-30T10:00:00+02:00",
  ])("an ISO 8601 date-time %p is read", (committedDate) => {
    const readings = parse(node({ defaultBranchRef: { target: { committedDate } } }));
    expect(readings.get("acme/bad")?.kind).toBe("read");
  });

  test("a payload that is not an object leaves every repository unreadable", () => {
    const readings = parseStalenessResponse(repositories, null);
    expect([...readings.values()].map((reading) => reading.kind)).toEqual([
      "unreadable",
      "unreadable",
      "unreadable",
    ]);
  });
});

describe("parseStalenessExceptions", () => {
  const document = (entries: string): string =>
    `schema_version: ${STALENESS_EXCEPTIONS_SCHEMA_VERSION}\nexceptions:${entries}\n`;

  test("an empty register is accepted", () => {
    expect(parseStalenessExceptions(document(" []"))).toEqual([]);
  });

  test("the committed register parses", async () => {
    const text = await Bun.file(new URL("staleness-exceptions.v1.yaml", import.meta.url)).text();
    expect(parseStalenessExceptions(text)).toEqual([]);
  });

  test("well-formed entries of both kinds are returned", () => {
    const parsed = parseStalenessExceptions(
      document(
        "\n  - repository: acme/quiet\n    kind: dormant\n    because: stable by design" +
          "\n  - repository: acme/repo\n    kind: pull-request\n    number: 12\n    because: waits for a release",
      ),
    );
    expect(parsed).toEqual([
      { repository: "acme/quiet", kind: "dormant", because: "stable by design" },
      { repository: "acme/repo", kind: "pull-request", number: 12, because: "waits for a release" },
    ]);
  });

  test.each([
    ["no because", "\n  - repository: acme/a\n    kind: dormant", /because is required/],
    [
      "an unknown kind",
      "\n  - repository: acme/a\n    kind: sleepy\n    because: x",
      /kind must be one of/,
    ],
    [
      "a pull-request without number",
      "\n  - repository: acme/a\n    kind: pull-request\n    because: x",
      /number is required/,
    ],
    ["no repository", "\n  - kind: dormant\n    because: x", /repository is required/],
    [
      "a number on a dormant entry",
      "\n  - repository: acme/a\n    kind: dormant\n    number: 3\n    because: x",
      /only meaningful/,
    ],
    [
      "a duplicated entry",
      "\n  - repository: acme/a\n    kind: dormant\n    because: x\n  - repository: acme/a\n    kind: dormant\n    because: y",
      /duplicates/,
    ],
  ])("an entry with %s throws", (_label, entries, message) => {
    expect(() => parseStalenessExceptions(document(entries))).toThrow(message);
  });

  test("a register without the schema version or without a list throws", () => {
    expect(() => parseStalenessExceptions("exceptions: []\n")).toThrow(/schema_version/);
    expect(() =>
      parseStalenessExceptions(`schema_version: ${STALENESS_EXCEPTIONS_SCHEMA_VERSION}\n`),
    ).toThrow(/must be a list/);
  });
});

describe("readFleetStaleness — forge behind a double", () => {
  const healthy = {
    defaultBranchRef: { target: { committedDate: "2026-10-30T08:00:00Z" } },
    pullRequests: { totalCount: 0, nodes: [] },
  };
  const answerFor = (query: string): string => {
    const aliases = [...query.matchAll(/^ {2}(r\d+): repository/gm)].map((match) => match[1]);
    return JSON.stringify({ data: Object.fromEntries(aliases.map((alias) => [alias, healthy])) });
  };
  const repositories = Array.from({ length: STALENESS_BATCH_SIZE + 2 }, (_, i) => `acme/r${i}`);

  test("reads every repository asked, in bounded batches", async () => {
    const sizes: number[] = [];
    const transport: StalenessTransport = {
      retryDelaysMs: [],
      graphql: async (query) => {
        sizes.push([...query.matchAll(/repository\(/g)].length);
        return { exitCode: 0, stdout: answerFor(query), stderr: "" };
      },
    };
    const readings = await readFleetStaleness(repositories, transport);
    expect(sizes).toEqual([STALENESS_BATCH_SIZE, 2]);
    expect(readings.size).toBe(repositories.length);
    expect([...readings.values()].every((reading) => reading.kind === "read")).toBe(true);
  });

  test("a batch that is never answered names each of its repositories, and the run goes on", async () => {
    let calls = 0;
    const transport: StalenessTransport = {
      retryDelaysMs: [0],
      graphql: async (query) => {
        calls += 1;
        // The first batch is rejected on both attempts; the second is answered.
        return calls <= 2
          ? {
              exitCode: 1,
              stdout: '{"data":null,"errors":[{"type":"RATE_LIMITED"}]}',
              stderr: "rate limited",
            }
          : { exitCode: 0, stdout: answerFor(query), stderr: "" };
      },
    };
    const readings = await readFleetStaleness(repositories, transport);
    expect(calls).toBe(3);
    expect(readings.size).toBe(repositories.length);
    expect(readings.get("acme/r0")).toEqual({
      kind: "unreadable",
      reason: "batch not answered after 2 attempt(s): rate limited",
    });
    expect(readings.get(`acme/r${STALENESS_BATCH_SIZE}`)?.kind).toBe("read");
  });

  test("a usable body served with a non-zero exit is still read alias by alias", async () => {
    const transport: StalenessTransport = {
      retryDelaysMs: [],
      graphql: async () => ({
        exitCode: 1,
        stdout: JSON.stringify({
          data: { r0: healthy, r1: null },
          errors: [{ type: "NOT_FOUND" }],
        }),
        stderr: "gh: Could not resolve",
      }),
    };
    const readings = await readFleetStaleness(["acme/here", "acme/gone"], transport);
    expect(readings.get("acme/here")?.kind).toBe("read");
    expect(readings.get("acme/gone")?.kind).toBe("unreadable");
  });
});

describe("check-fleet-staleness.ts — command line", () => {
  test("without GH_TOKEN it exits non-zero, names the variable and never calls gh", () => {
    const directory = mkdtempSync(join(tmpdir(), "fleet-staleness-"));
    try {
      const witness = join(directory, "gh-was-called");
      const fakeGh = join(directory, "gh");
      writeFileSync(fakeGh, `#!/bin/sh\necho called > '${witness}'\nexit 1\n`);
      chmodSync(fakeGh, 0o755);
      const script = new URL("check-fleet-staleness.ts", import.meta.url).pathname;
      // `env -i`: the ambient run may carry a token, and the probe must
      // measure its own case, not the environment it was launched from.
      const result = Bun.spawnSync(
        ["/usr/bin/env", "-i", `PATH=${directory}:/usr/bin:/bin`, process.execPath, script],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("GH_TOKEN");
      expect(existsSync(witness)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("fleet-staleness.yml", () => {
  interface Workflow {
    readonly on?: Record<string, unknown>;
    readonly permissions?: Record<string, string>;
    readonly jobs?: Record<string, { readonly steps?: readonly { readonly run?: string }[] }>;
  }
  const load = async (): Promise<Workflow> =>
    Bun.YAML.parse(
      await Bun.file(new URL("../.github/workflows/fleet-staleness.yml", import.meta.url)).text(),
    ) as Workflow;

  test("is triggered by a schedule and a manual dispatch, and nothing else", async () => {
    expect(Object.keys((await load()).on ?? {}).sort()).toEqual(["schedule", "workflow_dispatch"]);
  });

  test("holds exactly contents: read and issues: write", async () => {
    expect((await load()).permissions).toEqual({ contents: "read", issues: "write" });
  });

  test("runs the gate", async () => {
    const runs = Object.values((await load()).jobs ?? {}).flatMap((job) =>
      (job.steps ?? []).map((step) => step.run ?? ""),
    );
    expect(runs).toContain("bun ecosystem/check-fleet-staleness.ts");
  });
});
