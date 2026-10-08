import { describe, expect, test } from "bun:test";

import { renderGateReport } from "../tools/quality/gate-report";
import {
  auditInventory,
  auditManifest,
  classifyProbe,
  expectationFor,
  type ForgeState,
  parseLegacyManifest,
} from "./check-truth-drift";

const present = (archived: boolean): ForgeState => ({ kind: "present", archived });
const absent: ForgeState = { kind: "absent" };
const unreadable: ForgeState = { kind: "unreadable", reason: "HTTP 502" };

const MANIFEST = `
schema_version: libre-ai.legacy-manifest.v1
repositories:
  - id: legacy.home
    remote: https://github.com/libre-ai/home.git
    github_status: reserved-active-product-home
  - id: legacy.gone
    remote: https://github.com/libre-ai/gone.git
    github_status: removed-2026-09-16
  - id: legacy.local
    github_status: never-published
`;

describe("parseLegacyManifest", () => {
  test("reads the bare repository name and the declared status of every entry", () => {
    expect(parseLegacyManifest(MANIFEST)).toEqual([
      { name: "home", githubStatus: "reserved-active-product-home" },
      { name: "gone", githubStatus: "removed-2026-09-16" },
      { name: "local", githubStatus: "never-published" },
    ]);
  });

  test("an entry without the legacy. prefix is a malformed manifest, not a skipped line", () => {
    expect(() =>
      parseLegacyManifest("repositories:\n  - id: home\n    github_status: never-published\n"),
    ).toThrow("legacy.");
  });

  test("an entry without github_status is a malformed manifest", () => {
    expect(() => parseLegacyManifest("repositories:\n  - id: legacy.home\n")).toThrow(
      "github_status",
    );
  });

  test("a manifest without a repositories sequence is malformed", () => {
    expect(() => parseLegacyManifest("schema_version: x\n")).toThrow("repositories");
  });
});

describe("expectationFor", () => {
  test("maps every status the manifest uses to the forge state it implies", () => {
    expect(expectationFor("reserved-active-product-home")).toBe("present-unarchived");
    expect(expectationFor("frozen-reserved-product-home")).toBe("present-archived");
    expect(expectationFor("removed-2026-07-19")).toBe("absent");
    expect(expectationFor("removed-before-2026-07-19")).toBe("absent");
    expect(expectationFor("never-published")).toBe("absent");
  });

  test("an unknown status has no expectation, so the gate cannot pass it silently", () => {
    expect(expectationFor("reserved-somehow")).toBeNull();
  });
});

describe("classifyProbe", () => {
  test("a readable repository reports its archive flag", () => {
    expect(classifyProbe(0, "false\n", "")).toEqual(present(false));
    expect(classifyProbe(0, "true\n", "")).toEqual(present(true));
  });

  test("only a 404 is an absence", () => {
    expect(classifyProbe(1, "", "gh: Not Found (HTTP 404)\n")).toEqual(absent);
  });

  test("any other failure is unreadable, never absent", () => {
    expect(classifyProbe(1, "", "gh: API rate limit exceeded (HTTP 403)\n").kind).toBe(
      "unreadable",
    );
    expect(classifyProbe(1, "", "").kind).toBe("unreadable");
  });

  test("a success with an unexpected body is unreadable", () => {
    expect(classifyProbe(0, "null\n", "").kind).toBe("unreadable");
  });
});

describe("auditManifest", () => {
  const entries = parseLegacyManifest(MANIFEST);

  test("a manifest matching the forge passes and states its volume", () => {
    const report = auditManifest(
      entries,
      new Map([
        ["home", present(false)],
        ["gone", absent],
        ["local", absent],
      ]),
      new Set(),
    );
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBe(3);
    const rendered = renderGateReport("Legacy manifest drift", report);
    expect(rendered.lines[0]).toBe(
      "Legacy manifest drift verified: 3 assertion(s) hold — 3 manifest entries read, " +
        "3 compared with the live organization (1 expected present, 2 expected absent), " +
        "0 skipped as private",
    );
  });

  test("a reserved home that disappeared is drift", () => {
    const report = auditManifest(
      entries,
      new Map([
        ["home", absent],
        ["gone", absent],
        ["local", absent],
      ]),
      new Set(),
    );
    expect(report.violations).toEqual([
      "home: expected present and unarchived (reserved-active-product-home), live=absent",
    ]);
  });

  test("a removed repository that came back is drift", () => {
    const report = auditManifest(
      entries,
      new Map([
        ["home", present(false)],
        ["gone", present(false)],
        ["local", absent],
      ]),
      new Set(),
    );
    expect(report.violations).toEqual([
      "gone: expected absent (removed-2026-09-16), live=present-unarchived",
    ]);
  });

  test("an unreadable repository fails instead of counting as absent", () => {
    const report = auditManifest(
      entries,
      new Map([
        ["home", present(false)],
        ["gone", unreadable],
        ["local", absent],
      ]),
      new Set(),
    );
    expect(report.violations).toEqual(["gone: unreadable (HTTP 502), nothing compared"]);
  });

  test("an entry never probed fails", () => {
    const report = auditManifest(entries, new Map([["home", present(false)]]), new Set());
    expect(report.violations).toEqual([
      "gone: never probed, nothing compared",
      "local: never probed, nothing compared",
    ]);
  });

  test("an unknown status fails", () => {
    const report = auditManifest(
      [{ name: "odd", githubStatus: "reserved-somehow" }],
      new Map([["odd", present(false)]]),
      new Set(),
    );
    expect(report.violations).toEqual([
      "odd: unknown github_status 'reserved-somehow', no expected forge state",
    ]);
  });

  test("a skipped entry is counted in the volume, not asserted", () => {
    const report = auditManifest(
      entries,
      new Map([
        ["home", present(false)],
        ["local", absent],
      ]),
      new Set(["gone"]),
    );
    expect(report.asserted).toBe(2);
    expect(report.volumeSummary).toContain("1 skipped as private");
  });

  test("an empty manifest asserts nothing and fails", () => {
    expect(auditManifest([], new Map(), new Set()).outcome).toBe("empty");
  });
});

describe("auditInventory", () => {
  test("matching public sets pass and state their volume", () => {
    const report = auditInventory(
      ["a", "b"],
      ["a", "b"],
      new Map([
        ["a", present(false)],
        ["b", present(true)],
      ]),
    );
    expect(report.outcome).toBe("pass");
    expect(report.volumeSummary).toBe(
      "2 declared public repositories compared with 2 observed public in the libre-ai organization",
    );
  });

  test("a live public repository missing from the inventory is drift", () => {
    const report = auditInventory(["a"], ["a", "rogue"], new Map([["a", present(false)]]));
    expect(report.violations).toEqual([
      "rogue: public repository absent from repositories.v1.yaml",
    ]);
  });

  test("a declared public repository that is gone is drift", () => {
    const report = auditInventory(
      ["a", "gone"],
      ["a"],
      new Map([
        ["a", present(false)],
        ["gone", absent],
      ]),
    );
    expect(report.violations).toEqual([
      "gone: inventory declares it public but it is not observable",
    ]);
  });

  test("an unreadable declared repository fails instead of passing", () => {
    const report = auditInventory(["a"], ["a"], new Map([["a", unreadable]]));
    expect(report.violations).toEqual(["a: unreadable (HTTP 502), nothing compared"]);
  });

  test("an empty side is a broken read, not an agreement", () => {
    expect(auditInventory([], ["a"], new Map()).violations).toContain(
      "repositories.v1.yaml: declares no public repository, the comparison asserted nothing",
    );
    expect(auditInventory(["a"], [], new Map([["a", present(false)]])).violations).toContain(
      "libre-ai organization: no public repository observed, the listing asserted nothing",
    );
  });
});
