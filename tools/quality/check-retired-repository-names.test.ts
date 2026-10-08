import { describe, expect, test } from "bun:test";
import {
  AUTHORIZATION_MARKER,
  assertAllowlistReasons,
  findOperationalReferences,
  HISTORICAL_ALLOWLIST,
  isAllowlisted,
  isAuthorizedLine,
  isTestSource,
  OPERATIONAL_KEYS,
  RETIRED_REPOSITORY_NAMES,
} from "./check-retired-repository-names";

// This test file is itself out of the gate's scope (isTestSource), which is
// what lets it write the forms the gate detects. That exclusion is a decision,
// not an oversight: a fixture naming a retired repository is sample input.
const ORG = "libre-ai";

describe("the retired list", () => {
  test("holds the sixteen names the 2026-10-07 consolidation retired", () => {
    expect(RETIRED_REPOSITORY_NAMES).toHaveLength(16);
    expect(new Set(RETIRED_REPOSITORY_NAMES).size).toBe(16);
  });

  test("the hub is deliberately absent: archived read-only is not retired", () => {
    expect(RETIRED_REPOSITORY_NAMES as readonly string[]).not.toContain("libre-ai");
    expect(RETIRED_REPOSITORY_NAMES as readonly string[]).not.toContain("website");
  });

  test("holds bare names only, so the list cannot match the forms it declares", () => {
    for (const name of RETIRED_REPOSITORY_NAMES) expect(name).not.toContain("/");
    const asDataFile = [{ path: "gate.ts", text: RETIRED_REPOSITORY_NAMES.join("\n") }];
    expect(findOperationalReferences(asDataFile)).toEqual([]);
  });
});

// One test per name: a list is only a guard for the names it actually matches,
// and a typo in one entry is invisible from a single example.
describe("every retired name is detected", () => {
  for (const name of RETIRED_REPOSITORY_NAMES) {
    test(`${name} is caught in a resolvable URL`, () => {
      const references = findOperationalReferences([
        { path: "llms.txt", text: `See https://github.com/${ORG}/${name}/blob/HEAD/README.md` },
      ]);

      expect(references).toHaveLength(1);
      expect(references[0]).toMatchObject({ name, form: "resolvable-url", line: 1 });
    });
  }
});

describe("the four operational forms", () => {
  const name = RETIRED_REPOSITORY_NAMES[0] as string;

  test("a raw-content URL counts: it is meant to resolve", () => {
    const references = findOperationalReferences([
      { path: "AGENTS.md", text: `https://raw.githubusercontent.com/${ORG}/${name}/HEAD/x.md` },
    ]);
    expect(references[0]?.form).toBe("resolvable-url");
  });

  test("a workflow step reference counts", () => {
    const references = findOperationalReferences([
      { path: ".github/workflows/x.yml", text: `      - uses: ${ORG}/${name}/.github/a.yml@sha` },
    ]);
    expect(references[0]?.form).toBe("workflow-uses");
  });

  test("a GitHub-protocol git dependency counts", () => {
    const references = findOperationalReferences([
      { path: "package.json", text: `    "x": "github:${ORG}/${name}#abc"` },
    ]);
    expect(references[0]?.form).toBe("git-dependency");
  });

  test("every declared structured key counts", () => {
    for (const key of OPERATIONAL_KEYS) {
      const references = findOperationalReferences([
        { path: "card.yaml", text: `  ${key}: ${ORG}/${name}` },
      ]);
      expect(references[0]).toMatchObject({ form: "structured-field", name });
    }
  });

  test("prose is NOT a form: the doctrine permits a historical mention", () => {
    const references = findOperationalReferences([
      {
        path: "AGENTS.md",
        text: `Historical responsibilities remain in ${ORG}/${name}; no transfer is inferred.`,
      },
    ]);
    expect(references).toEqual([]);
  });

  test("a key outside the declared set is prose", () => {
    expect(
      findOperationalReferences([{ path: "notes.yaml", text: `  predecessor: ${ORG}/${name}` }]),
    ).toEqual([]);
  });

  test("a current repository whose name merely starts with a retired one is not a match", () => {
    expect(
      findOperationalReferences([
        { path: "x.md", text: `https://github.com/${ORG}/project-governance/blob/HEAD/a.md` },
      ]),
    ).toEqual([]);
  });

  test("another owner's repository of the same name is not this organisation's", () => {
    expect(
      findOperationalReferences([
        { path: "x.md", text: `https://github.com/someone-else/${name}` },
      ]),
    ).toEqual([]);
  });
});

describe("authorisation requires a reason", () => {
  const name = RETIRED_REPOSITORY_NAMES[0] as string;

  test("a bare marker is not an authorisation", () => {
    expect(isAuthorizedLine(`# ${AUTHORIZATION_MARKER}`)).toBe(false);
    expect(isAuthorizedLine(`# ${AUTHORIZATION_MARKER}   `)).toBe(false);
  });

  test("a marker followed by a reason authorises the line", () => {
    expect(isAuthorizedLine(`# ${AUTHORIZATION_MARKER} dated citation, 2026-08`)).toBe(true);
  });

  test("a bare marker leaves the finding standing", () => {
    const references = findOperationalReferences([
      { path: "run.ts", text: `// github:${ORG}/${name}#abc  ${AUTHORIZATION_MARKER}` },
    ]);
    expect(references).toHaveLength(1);
  });

  test("an authorised line is not reported", () => {
    const references = findOperationalReferences([
      {
        path: "run.ts",
        text: `// github:${ORG}/${name}#abc  ${AUTHORIZATION_MARKER} dated citation, 2026-08`,
      },
    ]);
    expect(references).toEqual([]);
  });

  test("the authorisation is per line, not per file", () => {
    const references = findOperationalReferences([
      {
        path: "run.ts",
        text: [
          `// github:${ORG}/${name}#abc  ${AUTHORIZATION_MARKER} dated citation`,
          `const url = "https://github.com/${ORG}/${name}";`,
        ].join("\n"),
      },
    ]);
    expect(references).toHaveLength(1);
    expect(references[0]?.line).toBe(2);
  });
});

describe("the historical allow-list", () => {
  test("every entry carries a reason", () => {
    expect(assertAllowlistReasons()).toEqual([]);
  });

  test("an entry without a reason is reported, not silently honoured", () => {
    expect(assertAllowlistReasons([{ path: "docs/x/", reason: "  " }])).toEqual(["docs/x/"]);
  });

  test("a trailing slash authorises a subtree, a bare path only that file", () => {
    expect(isAllowlisted("docs/adr/0019-forgetting-primitive.md")).toBe(true);
    expect(isAllowlisted("ecosystem/cards/method.project.v1.yaml")).toBe(true);
    expect(isAllowlisted("ecosystem/cards/other.project.v1.yaml")).toBe(false);
    expect(isAllowlisted("SECURITY.md")).toBe(false);
  });

  test("the generated projections are scanned, not allow-listed", () => {
    // Removed after the owner arbitration of 2026-10-08 regenerated
    // fleet-status.v1.json from the live cards: a stale projection must
    // surface as a finding again, never hide behind a provisional entry.
    expect(HISTORICAL_ALLOWLIST.some((entry) => entry.path === "ecosystem/projections/")).toBe(
      false,
    );
    expect(isAllowlisted("ecosystem/projections/fleet-status.v1.json")).toBe(false);
  });
});

describe("test sources are out of scope, and it is a decision", () => {
  test("a .test.ts file, a tests/ tree and a fixtures/ tree are excluded", () => {
    expect(isTestSource("tools/quality/check-x.test.ts")).toBe(true);
    expect(isTestSource("crates/engine/tests/fixtures/patch-rev/ok.toml")).toBe(true);
    expect(isTestSource("ecosystem/fixtures/card.yaml")).toBe(true);
    expect(isTestSource("tools/quality/check-x.ts")).toBe(false);
  });

  test("a reference inside a test source is not reported", () => {
    const name = RETIRED_REPOSITORY_NAMES[0] as string;
    expect(
      findOperationalReferences([
        { path: "a/b.test.ts", text: `const u = "https://github.com/${ORG}/${name}";` },
      ]),
    ).toEqual([]);
  });
});

describe("the served tree", () => {
  test("no tracked source outside the allow-list names a retired repository operationally", async () => {
    const readable = /\.(md|ya?ml|json|jsonc|ts|tsx|rs|toml|txt|sh|sql)$/;
    const tracked = (await new Response(Bun.spawn(["git", "ls-files"]).stdout).text())
      .split("\n")
      .filter(Boolean)
      .filter((path) => readable.test(path));
    const files = await Promise.all(
      tracked.map(async (path) => ({ path, text: await Bun.file(path).text() })),
    );

    expect(findOperationalReferences(files)).toEqual([]);
    expect(
      files.filter((file) => !isTestSource(file.path) && !isAllowlisted(file.path)).length,
    ).toBeGreaterThan(0);
  });
});
