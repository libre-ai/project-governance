import { describe, expect, test } from "bun:test";
import {
  auditScope,
  type BunAuditRunner,
  bunVolumeHolds,
  bunVolumeLine,
  type ContentsRead,
  type ContentsReader,
  classifyContentsRead,
  diffAdvisories,
  examineBunRepository,
  extractAdvisoryIds,
  readAudit,
  selectPublicAdvisoryRepositories,
  tallyBun,
} from "./advisories";

test("fleet advisory targets exclude private repositories before content reads", () => {
  expect(
    selectPublicAdvisoryRepositories([
      { repository: "libre-ai/public", lifecycle: "active", visibility: "public" },
      {
        repository: "libre-ai/product-research",
        lifecycle: "active",
        visibility: "private",
      },
      { repository: "libre-ai/archive", lifecycle: "archived", visibility: "public" },
    ]),
  ).toEqual(["libre-ai/public"]);
});

// The 2026-08-04 incident these helpers descend from: GHSA-7p8r-x3mc-p8w7 on
// fast-uri, pinned inside the advisory range by the fleet override.

const LISTING = `bun audit v1.4.0
fast-uri  >=4.0.0 <4.1.2
  high: fast-uri vulnerable to host confusion - https://github.com/advisories/GHSA-7p8r-x3mc-p8w7

1 vulnerabilities (1 high)`;

describe("extractAdvisoryIds", () => {
  test("finds, dedupes and sorts GHSA identifiers", () => {
    expect(extractAdvisoryIds(`${LISTING}\nGHSA-7p8r-x3mc-p8w7 GHSA-1234-abcd-ef56`)).toEqual([
      "GHSA-1234-abcd-ef56",
      "GHSA-7p8r-x3mc-p8w7",
    ]);
  });

  test("a clean output yields no identifiers", () => {
    expect(extractAdvisoryIds("No vulnerabilities found")).toEqual([]);
  });
});

describe("diffAdvisories", () => {
  test("separates what the change introduces from the state of the world", () => {
    const delta = diffAdvisories(
      ["GHSA-7p8r-x3mc-p8w7"],
      ["GHSA-7p8r-x3mc-p8w7", "GHSA-1234-abcd-ef56"],
    );
    expect(delta.introduced).toEqual(["GHSA-1234-abcd-ef56"]);
    expect(delta.preExisting).toEqual(["GHSA-7p8r-x3mc-p8w7"]);
  });

  test("an advisory fixed by the change simply leaves both lists", () => {
    const delta = diffAdvisories(["GHSA-7p8r-x3mc-p8w7"], []);
    expect(delta.introduced).toEqual([]);
    expect(delta.preExisting).toEqual([]);
  });
});

// Measured 2026-09-07 on libre-ai/carriere: its package.json is
// {"name":"@libre-ai/carriere","private":true,"license":"EUPL-1.2"} — no
// dependency field at all, added so the reusable context-hygiene/licensing
// workflows have a manifest to read. `bun install` (1.4.0-canary.1) answers
// "No packages! Deleted empty lockfile": Bun refuses to persist an empty
// lockfile, so "package.json without bun.lock" was demanding an artifact that
// cannot exist. A manifest with nothing to audit is an assertion that holds,
// said out loud; a manifest WITH dependencies and no lockfile stays red.
describe("auditScope", () => {
  test("a manifest without any dependency field is nothing to audit", () => {
    const scope = auditScope('{"name":"@libre-ai/carriere","private":true,"license":"EUPL-1.2"}');
    expect(scope).toEqual({ kind: "nothing-to-audit" });
  });

  test("empty dependency objects are nothing to audit either", () => {
    expect(auditScope('{"dependencies":{},"devDependencies":{}}')).toEqual({
      kind: "nothing-to-audit",
    });
  });

  test.each([
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ])("a non-empty %s field makes the manifest auditable", (field) => {
    expect(auditScope(`{"${field}":{"left-pad":"1.0.0"}}`)).toEqual({ kind: "auditable" });
  });

  test("an unparseable manifest is an unanswered question, never a pass", () => {
    const scope = auditScope("{not json");
    expect(scope.kind).toBe("unparseable");
  });
});

describe("readAudit", () => {
  test("exit 0 is a clean run", () => {
    const reading = readAudit(0, "No vulnerabilities found");
    expect(reading.ran).toBe(true);
    expect(reading.advisories).toEqual([]);
  });

  test("exit 1 with a listing is a run that found advisories", () => {
    const reading = readAudit(1, LISTING);
    expect(reading.ran).toBe(true);
    expect(reading.advisories).toEqual(["GHSA-7p8r-x3mc-p8w7"]);
  });

  test("exit 1 without a listing is an unanswered question, never a finding", () => {
    // "Found nothing" and "could not look" must never be conflated.
    const reading = readAudit(1, "error: connect ETIMEDOUT registry.npmjs.org");
    expect(reading.ran).toBe(false);
    expect(reading.detail).toContain("unanswered");
  });
});

// 2026-10-09: the Bun half read any non-zero `gh api` exit as "no
// package.json" and passed. Every class below used to come out green.
describe("classifyContentsRead", () => {
  test("a 404 is the forge's answer: absent", () => {
    expect(classifyContentsRead(1, "", "gh: Not Found (HTTP 404)\n")).toEqual({ kind: "absent" });
  });

  test.each([
    ["forbidden", "gh: Resource not accessible by integration (HTTP 403)"],
    ["quota", "gh: API rate limit exceeded for installation ID 1. (HTTP 403)"],
    ["secondary limit", "gh: You have exceeded a secondary rate limit. (HTTP 429)"],
    ["server error", "gh: Server Error (HTTP 500)"],
    ["bad gateway", "gh: Bad Gateway (HTTP 502)"],
    [
      "network",
      "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com",
    ],
    ["silent", ""],
  ])("%s is unreadable, never absent", (_label, stderr) => {
    const read = classifyContentsRead(1, "", stderr);
    expect(read.kind).toBe("unreadable");
  });

  test("the unreadable detail names the cause", () => {
    const read = classifyContentsRead(1, "", "gh: Server Error (HTTP 500)\n");
    expect(read).toEqual({ kind: "unreadable", detail: "gh: Server Error (HTTP 500)" });
  });

  test("an empty body is a malformed answer, not a file", () => {
    expect(classifyContentsRead(0, "  \n", "").kind).toBe("unreadable");
  });

  test("the metadata envelope is a malformed answer, not a manifest", () => {
    const envelope = JSON.stringify({
      type: "file",
      sha: "3d21ec53a331a6f037a91c368710b99387d012c1",
      content: "e30K",
      _links: { self: "https://api.github.com/repos/o/r/contents/package.json" },
    });
    expect(classifyContentsRead(0, envelope, "").kind).toBe("unreadable");
  });

  test("a directory listing is a malformed answer", () => {
    expect(classifyContentsRead(0, '[{"name":"a","type":"file"}]', "").kind).toBe("unreadable");
  });

  test("raw bytes are the file", () => {
    expect(classifyContentsRead(0, '{"name":"x"}', "")).toEqual({
      kind: "found",
      text: '{"name":"x"}',
    });
  });

  test("a bun.lock with trailing commas is read as found", () => {
    const lock = '{\n  "lockfileVersion": 1,\n  "workspaces": {},\n}\n';
    expect(classifyContentsRead(0, lock, "").kind).toBe("found");
  });
});

const MANIFEST = '{"dependencies":{"left-pad":"1.0.0"}}';
const LOCK = '{"lockfileVersion":1,}';
const UNREACHABLE: ContentsRead = { kind: "unreadable", detail: "gh: Server Error (HTTP 500)" };

function reader(files: Record<string, ContentsRead>): ContentsReader {
  return (path) => files[path] ?? { kind: "absent" };
}

const CLEAN_AUDIT: BunAuditRunner = () => ({ exitCode: 0, output: "No vulnerabilities found" });
const NO_AUDIT: BunAuditRunner = () => {
  throw new Error("bun audit must not run");
};

describe("examineBunRepository", () => {
  test("a 404 on package.json is an inspected absence", () => {
    const examination = examineBunRepository("o/r", reader({}), NO_AUDIT);
    expect(examination.outcome).toBe("absent");
    expect(examination.ok).toBe(true);
  });

  test("an unreadable package.json is a named failure, not an absence", () => {
    const examination = examineBunRepository(
      "o/r",
      reader({ "package.json": UNREACHABLE }),
      NO_AUDIT,
    );
    expect(examination.outcome).toBe("failed");
    expect(examination.ok).toBe(false);
    expect(examination.note).toContain("package.json unreadable (gh: Server Error (HTTP 500))");
  });

  test("an unreadable bun.lock is a named failure, distinct from a missing one", () => {
    const examination = examineBunRepository(
      "o/r",
      reader({ "package.json": { kind: "found", text: MANIFEST }, "bun.lock": UNREACHABLE }),
      NO_AUDIT,
    );
    expect(examination.outcome).toBe("failed");
    expect(examination.note).toContain("bun.lock unreadable");
  });

  test("a 404 on bun.lock under a manifest with dependencies stays red", () => {
    const examination = examineBunRepository(
      "o/r",
      reader({ "package.json": { kind: "found", text: MANIFEST } }),
      NO_AUDIT,
    );
    expect(examination.outcome).toBe("failed");
    expect(examination.note).toContain("without bun.lock");
  });

  test("a manifest without dependencies is nothing to audit", () => {
    const examination = examineBunRepository(
      "o/r",
      reader({ "package.json": { kind: "found", text: '{"name":"x"}' } }),
      NO_AUDIT,
    );
    expect(examination.outcome).toBe("nothing-to-audit");
    expect(examination.ok).toBe(true);
  });

  test("a clean audit passes, a listing fails with its advisories", () => {
    const files = reader({
      "package.json": { kind: "found", text: MANIFEST },
      "bun.lock": { kind: "found", text: LOCK },
    });
    expect(examineBunRepository("o/r", files, CLEAN_AUDIT)).toMatchObject({
      outcome: "audited",
      ok: true,
    });
    const found = examineBunRepository("o/r", files, () => ({ exitCode: 1, output: LISTING }));
    expect(found).toMatchObject({
      outcome: "audited",
      ok: false,
      advisories: ["GHSA-7p8r-x3mc-p8w7"],
    });
  });

  test("an audit that could not answer is a failure", () => {
    const files = reader({
      "package.json": { kind: "found", text: MANIFEST },
      "bun.lock": { kind: "found", text: LOCK },
    });
    const examination = examineBunRepository("o/r", files, () => ({
      exitCode: 1,
      output: "error: connect ETIMEDOUT",
    }));
    expect(examination).toMatchObject({ outcome: "failed", ok: false });
  });
});

describe("Bun volume", () => {
  const examinations = [
    examineBunRepository("o/absent", reader({}), NO_AUDIT),
    examineBunRepository("o/down", reader({ "package.json": UNREACHABLE }), NO_AUDIT),
    examineBunRepository(
      "o/empty",
      reader({ "package.json": { kind: "found", text: "{}" } }),
      NO_AUDIT,
    ),
    examineBunRepository(
      "o/audited",
      reader({
        "package.json": { kind: "found", text: MANIFEST },
        "bun.lock": { kind: "found", text: LOCK },
      }),
      () => ({ exitCode: 1, output: LISTING }),
    ),
  ];

  test("the four outcomes sum to the repositories examined", () => {
    const volume = tallyBun(4, examinations);
    expect(volume).toEqual({
      repositories: 4,
      absent: 1,
      nothingToAudit: 1,
      audited: 1,
      failed: 1,
      advisories: 1,
    });
    expect(bunVolumeHolds(volume)).toBe(true);
    expect(bunVolumeLine(volume)).toBe(
      "Bun: 4 repositories = 1 without package.json + 1 with nothing to audit + 1 audited + " +
        "1 failed, 1 advisory(ies)",
    );
  });

  test("a repository dropped from the tally is a counting defect, said on the line", () => {
    const volume = tallyBun(5, examinations);
    expect(bunVolumeHolds(volume)).toBe(false);
    expect(bunVolumeLine(volume)).toContain("COUNTING DEFECT: 4 accounted for, 5 examined");
  });
});
