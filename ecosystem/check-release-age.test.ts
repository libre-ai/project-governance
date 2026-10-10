import { describe, expect, test } from "bun:test";
import {
  emptyTally,
  MINIMUM_RELEASE_AGE_SECONDS,
  parseExceptions,
  type ReleaseAgeException,
  reviewBunfig,
  reviewRepository,
  summarizeVolume,
  uncoveredInstallRoots,
} from "./check-release-age";
import type { BlobRead, FleetFileReader, TreeListing } from "./fleet-tree";

const GUARDED = "[install]\nminimumReleaseAge = 259200\nminimumReleaseAgeExcludes = []\n";
const none = new Set<string>();

describe("reviewBunfig", () => {
  test("the fleet form passes", () => {
    expect(reviewBunfig(GUARDED, none)).toEqual([]);
  });

  test("an absent exclude list is no exclusion and passes", () => {
    expect(reviewBunfig("[install]\nexact = true\nminimumReleaseAge = 259200\n", none)).toEqual([]);
  });

  test("a longer age passes", () => {
    expect(reviewBunfig("[install]\nminimumReleaseAge = 604800\n", none)).toEqual([]);
  });

  test("a test-only bunfig has no [install] table", () => {
    const failures = reviewBunfig("[test]\ncoverageThreshold = 0.9\n", none);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("no [install] table");
  });

  test("an [install] table without the key fails (the toolkit's linker-only root)", () => {
    const failures = reviewBunfig('[install]\nlinker = "hoisted"\n', none);
    expect(failures).toEqual([
      `[install] has no minimumReleaseAge (expected >= ${MINIMUM_RELEASE_AGE_SECONDS})`,
    ]);
  });

  test("an age below three days fails", () => {
    expect(reviewBunfig("[install]\nminimumReleaseAge = 86400\n", none)[0]).toContain(
      "is below 259200",
    );
  });

  test("a non-integer age fails", () => {
    expect(reviewBunfig('[install]\nminimumReleaseAge = "259200"\n', none)[0]).toContain(
      "not an integer",
    );
  });

  test("an undeclared exclusion fails and names the package", () => {
    const failures = reviewBunfig(
      '[install]\nminimumReleaseAge = 259200\nminimumReleaseAgeExcludes = ["left-pad"]\n',
      none,
    );
    expect(failures[0]).toContain('"left-pad"');
  });

  test("a declared exclusion passes", () => {
    expect(
      reviewBunfig(
        '[install]\nminimumReleaseAge = 259200\nminimumReleaseAgeExcludes = ["left-pad"]\n',
        new Set(["left-pad"]),
      ),
    ).toEqual([]);
  });

  test("a decoy key inside a multi-line string does not satisfy the guard", () => {
    const decoy = '[test]\nnote = """\n[install]\nminimumReleaseAge = 259200\n"""\n';
    expect(reviewBunfig(decoy, none)[0]).toContain("no [install] table");
  });

  test("a document the TOML readers refuse is unreadable, never green", () => {
    expect(reviewBunfig("[install\nminimumReleaseAge = 259200\n", none)[0]).toContain("unreadable");
  });

  test("the dotted form at the root is read as the install table", () => {
    expect(reviewBunfig("install.minimumReleaseAge = 259200\n", none)).toEqual([]);
  });
});

describe("uncoveredInstallRoots", () => {
  test("a lockfile directory without a bunfig.toml is uncovered", () => {
    const { roots, uncovered } = uncoveredInstallRoots([
      "bun.lock",
      "packages/core/bunfig.toml",
      "tools/review/bun.lock",
      "tools/review/bunfig.toml",
      "packages/core/package.json",
    ]);
    expect(roots).toEqual(["", "tools/review"]);
    expect(uncovered).toEqual([""]);
  });
});

function reader(listing: TreeListing, files: Record<string, BlobRead>): FleetFileReader {
  return async () => ({ listing, files: new Map(Object.entries(files)) });
}

const active = {
  repository: "libre-ai/sample",
  role: "satellite",
  layer: "couche-1",
  lifecycle: "active",
  visibility: "public" as const,
};

describe("reviewRepository", () => {
  test("green: every bunfig guarded, every install root covered, counters sum", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(
      active,
      [],
      tally,
      reader(
        { kind: "listed", paths: ["bun.lock", "bunfig.toml", "README.md"] },
        { "bunfig.toml": { kind: "text", text: GUARDED } },
      ),
    );
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(tally).toMatchObject({ bunfigTracked: 1, bunfigExamined: 1, installRoots: 1 });
    expect(summarizeVolume(tally)).toBe(
      "1 inventory entries (1 read, 0 exempt): 1 of 1 tracked bunfig.toml examined, 1 of 1 install roots covered by a bunfig.toml",
    );
  });

  test("red: an install root without a bunfig.toml fails", async () => {
    const checks = await reviewRepository(
      active,
      [],
      emptyTally(),
      reader({ kind: "listed", paths: ["bun.lock", "package.json"] }, {}),
    );
    expect(checks.filter((check) => !check.ok).map((check) => check.item)).toEqual([
      "libre-ai/sample:.",
    ]);
  });

  test("an unreadable tree fails, never 'no bunfig.toml'", async () => {
    const checks = await reviewRepository(
      active,
      [],
      emptyTally(),
      reader({ kind: "unreadable", reason: "HTTP 403" }, {}),
    );
    expect(checks).toEqual([
      { item: "libre-ai/sample", ok: false, note: "tree unreadable at HEAD: HTTP 403" },
    ]);
  });

  test("an unreadable bunfig fails and is not counted as examined", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(
      active,
      [],
      tally,
      reader(
        { kind: "listed", paths: ["bunfig.toml"] },
        { "bunfig.toml": { kind: "unreadable", reason: "rate limited" } },
      ),
    );
    expect(checks[0]?.ok).toBe(false);
    expect(tally).toMatchObject({ bunfigTracked: 1, bunfigExamined: 0 });
  });

  test("a private repository is exempt and counted, never read", async () => {
    const tally = emptyTally();
    let read = false;
    const checks = await reviewRepository(
      { ...active, visibility: "private" },
      [],
      tally,
      async () => {
        read = true;
        return { listing: { kind: "listed", paths: [] }, files: new Map() };
      },
    );
    expect(read).toBe(false);
    expect(checks[0]?.ok).toBe(true);
    expect(tally.exempt).toBe(1);
  });

  test("an exception the file no longer uses is stale and fails", async () => {
    const exception: ReleaseAgeException = {
      repository: "libre-ai/sample",
      path: "bunfig.toml",
      package: "left-pad",
      because: "test",
    };
    const checks = await reviewRepository(
      active,
      [exception],
      emptyTally(),
      reader(
        { kind: "listed", paths: ["bunfig.toml"] },
        { "bunfig.toml": { kind: "text", text: GUARDED } },
      ),
    );
    expect(checks.some((check) => !check.ok && check.note.startsWith("stale exception"))).toBe(
      true,
    );
  });
});

describe("parseExceptions", () => {
  test("the committed register parses", async () => {
    const text = await Bun.file(new URL("release-age-exceptions.v1.yaml", import.meta.url)).text();
    expect(Array.isArray(parseExceptions(text))).toBe(true);
  });

  test("an entry without a reason is refused", () => {
    expect(() =>
      parseExceptions(
        "exceptions:\n  - repository: libre-ai/x\n    path: bunfig.toml\n    package: p\n",
      ),
    ).toThrow("because");
  });
});
