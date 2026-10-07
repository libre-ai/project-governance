import { describe, expect, test } from "bun:test";
import {
  auditScope,
  diffAdvisories,
  extractAdvisoryIds,
  readAudit,
  selectPublicAdvisoryRepositories,
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
