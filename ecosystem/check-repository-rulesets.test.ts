import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIndex } from "./build-index";
import type {
  DeclaredRepository,
  RulesetFinding,
  RulesetObservation,
} from "./check-repository-rulesets";
import {
  COMPARED_FIELDS,
  describeRulesetVolume,
  parseRulesetDeclaration,
  RULESET_DECLARATION_SCHEMA_VERSION,
  reconcileRulesets,
} from "./check-repository-rulesets";

/**
 * The expectations below come from the brief of the lot (six finding kinds and
 * their paths, five compared fields, eight ignored fields, five counters), not
 * from what the module prints. The readback shape is the one the provider
 * serves, taken from tools/attestation/fixtures/frozen-readback.json.
 */

const ALPHA = "example-org/alpha";
const BETA = "example-org/beta";

const DECLARATION = `
schema_version: libre-ai.repository-rulesets.v1
repositories:
  - repository: ${ALPHA}
    rulesets:
      - name: served-branch
        target: branch
        enforcement: active
        conditions:
          ref_name:
            include:
              - refs/heads/trunk
              - refs/heads/release
            exclude: []
        bypass_actors:
          - actor_id: 5
            actor_type: RepositoryRole
            bypass_mode: always
          - actor_id: 7
            actor_type: Team
            bypass_mode: pull_request
        rules:
          - type: deletion
          - type: non_fast_forward
          - type: required_status_checks
            parameters:
              strict_required_status_checks_policy: true
              required_status_checks:
                - context: first
                  integration_id: 1
                - context: second
                  integration_id: 1
      - name: tags
        target: tag
        enforcement: active
        conditions:
          ref_name:
            include:
              - "~ALL"
            exclude: []
        bypass_actors: []
        rules:
          - type: creation
`;

type Readback = Record<string, unknown>;

function declaredFixture(): DeclaredRepository[] {
  return parseRulesetDeclaration(DECLARATION);
}

/** A readback of exactly what is declared, dressed as the provider serves it. */
function readbackOf(declared: DeclaredRepository): Readback[] {
  return declared.rulesets.map((ruleset, index) => ({
    id: 1000 + index,
    node_id: `node-${index}`,
    _links: { self: { href: `https://provider.invalid/rulesets/${1000 + index}` } },
    created_at: "2026-01-01T00:00:00.000+00:00",
    updated_at: "2026-01-02T00:00:00.000+00:00",
    source: declared.repository,
    source_type: "Repository",
    current_user_can_bypass: "never",
    ...structuredClone({
      name: ruleset.name,
      target: ruleset.target,
      enforcement: ruleset.enforcement,
      conditions: ruleset.conditions,
      bypass_actors: ruleset.bypass_actors,
      rules: ruleset.rules,
    }),
  }));
}

function alphaReadback(): Readback[] {
  const alpha = declaredFixture()[0];
  if (alpha === undefined) throw new Error("fixture declares no repository");
  return readbackOf(alpha);
}

function first(rulesets: Readback[]): Readback {
  const ruleset = rulesets[0];
  if (ruleset === undefined) throw new Error("fixture readback is empty");
  return ruleset;
}

function reconcileAlpha(rulesets: unknown): readonly RulesetFinding[] {
  return reconcileRulesets(declaredFixture(), [{ repository: ALPHA, rulesets }]).findings;
}

function kinds(findings: readonly RulesetFinding[]): string[] {
  return findings.map((finding) => finding.kind);
}

/**
 * Write a value as block-style YAML, the only style the declaration admits.
 * Strings are double-quoted (JSON strings are valid YAML double-quoted
 * scalars), so no scalar is left for the parser to convert.
 */
function blockYaml(value: Record<string, unknown>, indent = 0): string {
  const pad = " ".repeat(indent);
  const scalar = (item: unknown): string => JSON.stringify(item);
  const lines: string[] = [];
  for (const [key, member] of Object.entries(value)) {
    if (Array.isArray(member)) {
      if (member.length === 0) {
        lines.push(`${pad}${key}: []`);
        continue;
      }
      lines.push(`${pad}${key}:`);
      for (const item of member) {
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          const nested = blockYaml(item as Record<string, unknown>, indent + 4);
          lines.push(`${pad}  - ${nested.trimStart()}`.trimEnd());
        } else {
          lines.push(`${pad}  - ${scalar(item)}`);
        }
      }
    } else if (typeof member === "object" && member !== null) {
      const record = member as Record<string, unknown>;
      if (Object.keys(record).length === 0) lines.push(`${pad}${key}: {}`);
      else lines.push(`${pad}${key}:`, blockYaml(record, indent + 2).trimEnd());
    } else {
      lines.push(`${pad}${key}: ${scalar(member)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Rebuild a value with every object's keys in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .reverse()
        .map((key) => [key, reverseKeys(record[key])]),
    );
  }
  return value;
}

describe("reconcileRulesets: agreement", () => {
  test("identical content with permuted keys and permuted rules yields no finding", () => {
    const rulesets = alphaReadback().map((ruleset) => {
      const permuted = reverseKeys(ruleset) as Readback;
      return { ...permuted, rules: [...(permuted.rules as unknown[])].reverse() };
    });
    const result = reconcileRulesets(declaredFixture(), [{ repository: ALPHA, rulesets }]);
    expect(result.findings).toEqual([]);
    expect(result.counts.declaredRulesets).toBe(2);
    expect(result.counts.matched).toBe(result.counts.declaredRulesets);
  });

  test("permuted bypass_actors, include and exclude are not a difference", () => {
    const rulesets = alphaReadback();
    const target = first(rulesets);
    target.bypass_actors = [...(target.bypass_actors as unknown[])].reverse();
    target.conditions = {
      ref_name: { include: ["refs/heads/release", "refs/heads/trunk"], exclude: [] },
    };
    expect(reconcileAlpha(rulesets)).toEqual([]);
  });

  test("changing only id, updated_at and current_user_can_bypass yields no finding", () => {
    const rulesets = alphaReadback();
    const target = first(rulesets);
    target.id = 424242;
    target.updated_at = "2027-03-04T05:06:07.000+00:00";
    target.current_user_can_bypass = "always";
    expect(reconcileAlpha(rulesets)).toEqual([]);
  });

  test("the eight provider-side fields are all ignored", () => {
    const rulesets = alphaReadback();
    const target = first(rulesets);
    for (const field of [
      "id",
      "node_id",
      "_links",
      "created_at",
      "updated_at",
      "source",
      "source_type",
      "current_user_can_bypass",
    ]) {
      target[field] = "changed";
    }
    expect(reconcileAlpha(rulesets)).toEqual([]);
  });

  test("the ruleset shape really served by the provider is accepted", () => {
    const readback = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "tools", "attestation", "fixtures", "frozen-readback.json"),
        "utf8",
      ),
    ) as { repository: string; rulesets: Readback[] };
    expect(readback.rulesets.length).toBeGreaterThan(0);
    const declaration = {
      schema_version: RULESET_DECLARATION_SCHEMA_VERSION,
      repositories: [
        {
          repository: readback.repository,
          rulesets: readback.rulesets.map((ruleset) => ({
            name: ruleset.name,
            target: ruleset.target,
            enforcement: ruleset.enforcement,
            conditions: ruleset.conditions,
            bypass_actors: ruleset.bypass_actors,
            rules: ruleset.rules,
          })),
        },
      ],
    };
    const declared = parseRulesetDeclaration(blockYaml(declaration));
    // The whole readback object is handed over: its other keys are ignored.
    const result = reconcileRulesets(declared, [readback]);
    expect(result.findings).toEqual([]);
    expect(result.counts.matched).toBe(readback.rulesets.length);
  });
});

describe("reconcileRulesets: a ruleset that differs", () => {
  const path = `declared.${ALPHA}.rulesets.served-branch`;

  test("a changed enforcement is named", () => {
    const rulesets = alphaReadback();
    first(rulesets).enforcement = "disabled";
    const findings = reconcileAlpha(rulesets);
    expect(findings).toEqual([{ kind: "ruleset-differs", path, note: "differs on: enforcement" }]);
  });

  test("an added exclusion names conditions", () => {
    const rulesets = alphaReadback();
    first(rulesets).conditions = {
      ref_name: {
        include: ["refs/heads/trunk", "refs/heads/release"],
        exclude: ["refs/heads/trunk"],
      },
    };
    const findings = reconcileAlpha(rulesets);
    expect(findings).toEqual([{ kind: "ruleset-differs", path, note: "differs on: conditions" }]);
  });

  test("an added bypass actor names bypass_actors", () => {
    const rulesets = alphaReadback();
    const target = first(rulesets);
    target.bypass_actors = [
      ...(target.bypass_actors as unknown[]),
      { actor_id: 1, actor_type: "OrganizationAdmin", bypass_mode: "always" },
    ];
    const findings = reconcileAlpha(rulesets);
    expect(findings).toEqual([
      { kind: "ruleset-differs", path, note: "differs on: bypass_actors" },
    ]);
  });

  test("a removed rule names rules", () => {
    const rulesets = alphaReadback();
    const target = first(rulesets);
    target.rules = (target.rules as unknown[]).slice(1);
    const findings = reconcileAlpha(rulesets);
    expect(findings).toEqual([{ kind: "ruleset-differs", path, note: "differs on: rules" }]);
  });

  test("a changed target is named, and several fields are listed together", () => {
    const rulesets = alphaReadback();
    const target = first(rulesets);
    target.target = "push";
    target.enforcement = "evaluate";
    const findings = reconcileAlpha(rulesets);
    expect(findings).toEqual([
      { kind: "ruleset-differs", path, note: "differs on: target, enforcement" },
    ]);
  });

  test("order is compared outside the four unordered sequences", () => {
    const rulesets = alphaReadback();
    const target = first(rulesets);
    target.rules = (target.rules as Readback[]).map((rule) =>
      rule.type === "required_status_checks"
        ? {
            type: "required_status_checks",
            parameters: {
              strict_required_status_checks_policy: true,
              required_status_checks: [
                { context: "second", integration_id: 1 },
                { context: "first", integration_id: 1 },
              ],
            },
          }
        : rule,
    );
    expect(reconcileAlpha(rulesets)).toEqual([
      { kind: "ruleset-differs", path, note: "differs on: rules" },
    ]);
  });

  test("a compared field absent from the readback differs, even from a declared empty list", () => {
    // `tags` declares `bypass_actors: []`: absent is not the same as empty.
    const rulesets = alphaReadback();
    const tags = rulesets.find((ruleset) => ruleset.name === "tags");
    if (tags === undefined) throw new Error("fixture readback has no tags ruleset");
    delete tags.bypass_actors;
    expect(reconcileAlpha(rulesets)).toEqual([
      {
        kind: "ruleset-differs",
        path: `declared.${ALPHA}.rulesets.tags`,
        note: "differs on: bypass_actors",
      },
    ]);
  });
});

describe("reconcileRulesets: both directions", () => {
  test("a ruleset read under an unknown name is undeclared", () => {
    const rulesets = alphaReadback();
    rulesets.push({ ...first(rulesets), name: "added-by-hand" });
    const findings = reconcileAlpha(rulesets);
    expect(kinds(findings)).toEqual(["undeclared-ruleset"]);
    expect(findings[0]?.path).toBe(`observed.${ALPHA}.rulesets.added-by-hand`);
  });

  test("a declared ruleset absent from the readback is missing", () => {
    const rulesets = alphaReadback().filter((ruleset) => ruleset.name !== "tags");
    const findings = reconcileAlpha(rulesets);
    expect(kinds(findings)).toEqual(["missing-ruleset"]);
    expect(findings[0]?.path).toBe(`declared.${ALPHA}.rulesets.tags`);
  });

  test("an empty readback yields one missing-ruleset per declared ruleset", () => {
    const findings = reconcileAlpha([]);
    expect(kinds(findings)).toEqual(["missing-ruleset", "missing-ruleset"]);
    expect(findings.map((finding) => finding.path)).toEqual([
      `declared.${ALPHA}.rulesets.served-branch`,
      `declared.${ALPHA}.rulesets.tags`,
    ]);
  });

  test("a declared repository without a readback is unobserved", () => {
    const findings = reconcileRulesets(declaredFixture(), []).findings;
    expect(kinds(findings)).toEqual(["unobserved-repository"]);
    expect(findings[0]?.path).toBe(`declared.${ALPHA}`);
  });

  test("a readback of a repository that is not declared is undeclared", () => {
    const findings = reconcileRulesets(declaredFixture(), [
      { repository: ALPHA, rulesets: alphaReadback() },
      { repository: BETA, rulesets: [] },
    ]).findings;
    expect(kinds(findings)).toEqual(["undeclared-repository"]);
    expect(findings[0]?.path).toBe(`observed.${BETA}`);
  });

  test("a repository declaring no ruleset agrees with an empty readback", () => {
    const declared: DeclaredRepository[] = [{ repository: BETA, rulesets: [] }];
    const result = reconcileRulesets(declared, [{ repository: BETA, rulesets: [] }]);
    expect(result.findings).toEqual([]);
    expect(result.agreements.map((agreement) => agreement.path)).toEqual([`declared.${BETA}`]);
  });
});

describe("reconcileRulesets: an unreadable readback is named, never an empty list", () => {
  const path = `observed.${ALPHA}.rulesets`;

  test("rulesets: null yields one unreadable-observation and no missing-ruleset", () => {
    const findings = reconcileAlpha(null);
    expect(kinds(findings)).toEqual(["unreadable-observation"]);
    expect(findings[0]?.path).toBe(path);
  });

  test("a non-sequence, an absent key and a nameless entry are unreadable", () => {
    for (const rulesets of [
      "none",
      undefined,
      { name: "served-branch" },
      [{ target: "branch" }],
      [{ name: "" }],
      [null],
    ]) {
      const findings = reconcileAlpha(rulesets);
      expect(kinds(findings)).toEqual(["unreadable-observation"]);
      expect(findings[0]?.path).toBe(path);
    }
  });

  test("two rulesets read under the same name are unreadable", () => {
    const rulesets = alphaReadback();
    rulesets.push({ ...first(rulesets) });
    const findings = reconcileAlpha(rulesets);
    expect(kinds(findings)).toEqual(["unreadable-observation"]);
    expect(findings[0]?.path).toBe(path);
  });

  test("a name carrying a control character is unreadable, never printed raw", () => {
    for (const name of [
      "forged\nRepository rulesets verified",
      "tab\there",
      "bell\u{7}",
      "nel\u{85}",
    ]) {
      const rulesets = alphaReadback();
      rulesets.push({ ...first(rulesets), name });
      const findings = reconcileAlpha(rulesets);
      expect(kinds(findings)).toEqual(["unreadable-observation"]);
      expect(findings[0]?.note).not.toContain(name);
    }
  });

  test("two readbacks of one repository are unreadable, neither is compared", () => {
    const result = reconcileRulesets(declaredFixture(), [
      { repository: ALPHA, rulesets: alphaReadback() },
      { repository: ALPHA, rulesets: alphaReadback() },
    ]);
    expect(kinds(result.findings)).toEqual(["unreadable-observation"]);
    expect(result.counts.matched).toBe(0);
  });
});

describe("reconcileRulesets: counters and determinism", () => {
  test("the five counters count what was declared, supplied, read and identical", () => {
    const rulesets = alphaReadback();
    first(rulesets).enforcement = "disabled";
    rulesets.push({ ...first(rulesets), name: "added-by-hand" });
    const result = reconcileRulesets(declaredFixture(), [
      { repository: ALPHA, rulesets },
      { repository: BETA, rulesets: null },
    ]);
    expect(result.counts).toEqual({
      declaredRepositories: 1,
      observedRepositories: 2,
      declaredRulesets: 2,
      observedRulesets: 3,
      matched: 1,
    });
    expect(describeRulesetVolume(result.counts)).toBe(
      "1 declared repositories, 2 readbacks supplied, 2 declared rulesets, 3 rulesets read, 1 identical",
    );
  });

  test("findings are sorted, whatever the order the inputs arrive in", () => {
    const declared: DeclaredRepository[] = [
      ...declaredFixture(),
      { repository: BETA, rulesets: [] },
    ];
    const observations: RulesetObservation[] = [
      { repository: "example-org/gamma", rulesets: [] },
      { repository: BETA, rulesets: null },
      { repository: ALPHA, rulesets: [{ ...first(alphaReadback()), name: "zeta" }] },
    ];
    const forward = reconcileRulesets(declared, observations);
    const backward = reconcileRulesets([...declared].reverse(), [...observations].reverse());
    expect(JSON.stringify(backward.findings)).toBe(JSON.stringify(forward.findings));
    expect(forward.findings.map((finding) => finding.path)).toEqual([
      `declared.${ALPHA}.rulesets.served-branch`,
      `declared.${ALPHA}.rulesets.tags`,
      `observed.${ALPHA}.rulesets.zeta`,
      `observed.${BETA}.rulesets`,
      "observed.example-org/gamma",
    ]);
  });
});

describe("parseRulesetDeclaration", () => {
  function refusal(text: string): string {
    try {
      parseRulesetDeclaration(text);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("the declaration was accepted");
  }

  function declarationWith(repositories: unknown): string {
    return blockYaml({ schema_version: RULESET_DECLARATION_SCHEMA_VERSION, repositories });
  }

  const ruleset = {
    name: "one",
    target: "branch",
    enforcement: "active",
    conditions: {},
    bypass_actors: [],
    rules: [],
  };

  test("reads the five compared fields of every ruleset", () => {
    const declared = declaredFixture();
    expect(declared.map((entry) => entry.repository)).toEqual([ALPHA]);
    expect(declared[0]?.rulesets.map((entry) => entry.name)).toEqual(["served-branch", "tags"]);
    expect(Object.keys(declared[0]?.rulesets[0] ?? {}).sort()).toEqual(
      ["name", ...COMPARED_FIELDS].sort(),
    );
  });

  test("refuses an unknown key in a ruleset, by field path", () => {
    const text = declarationWith([{ repository: ALPHA, rulesets: [{ ...ruleset, id: 1 }] }]);
    expect(refusal(text)).toContain("repositories[0].rulesets[0].id: unknown key");
  });

  test("refuses a missing compared field, by field path", () => {
    for (const field of COMPARED_FIELDS) {
      const partial: Record<string, unknown> = { ...ruleset };
      delete partial[field];
      const text = declarationWith([{ repository: ALPHA, rulesets: [partial] }]);
      expect(refusal(text)).toContain(`repositories[0].rulesets[0].${field}: missing key`);
    }
  });

  test("refuses a duplicate repository, by field path", () => {
    const text = declarationWith([
      { repository: ALPHA, rulesets: [] },
      { repository: ALPHA, rulesets: [] },
    ]);
    expect(refusal(text)).toContain(`repositories[1].repository: duplicate repository ${ALPHA}`);
  });

  test("refuses a duplicate ruleset name in a repository, by field path", () => {
    const text = declarationWith([{ repository: ALPHA, rulesets: [ruleset, ruleset] }]);
    expect(refusal(text)).toContain("repositories[0].rulesets[1].name: duplicate ruleset name one");
  });

  test("refuses an empty repositories sequence", () => {
    expect(refusal(declarationWith([]))).toContain("repositories: expected a non-empty sequence");
  });

  test("refuses an unknown key at the top and in a repository, and another schema", () => {
    expect(
      refusal(
        blockYaml({
          schema_version: RULESET_DECLARATION_SCHEMA_VERSION,
          repositories: [{ repository: ALPHA, rulesets: [] }],
          exemptions: [],
        }),
      ),
    ).toContain("exemptions: unknown key");
    expect(refusal(declarationWith([{ repository: ALPHA, rulesets: [], exempt: true }]))).toContain(
      "repositories[0].exempt: unknown key",
    );
    expect(
      refusal(
        blockYaml({
          schema_version: "libre-ai.repository-rulesets.v0",
          repositories: [{ repository: ALPHA, rulesets: [] }],
        }),
      ),
    ).toContain("schema_version: expected libre-ai.repository-rulesets.v1");
  });

  test("refuses a repository that is not an owner/name slug and a mistyped field", () => {
    expect(refusal(declarationWith([{ repository: "alpha", rulesets: [] }]))).toContain(
      "repositories[0].repository: expected an owner/name slug",
    );
    expect(
      refusal(declarationWith([{ repository: ALPHA, rulesets: [{ ...ruleset, rules: {} }] }])),
    ).toContain("repositories[0].rulesets[0].rules: expected a sequence");
  });

  test("admits an empty rulesets list", () => {
    expect(parseRulesetDeclaration(declarationWith([{ repository: ALPHA, rulesets: [] }]))).toEqual(
      [{ repository: ALPHA, rulesets: [] }],
    );
  });
});

/**
 * The YAML parser keeps the LAST of two equal keys, so a `rulesets:` written
 * twice would silently erase the first list. The declaration is therefore
 * also read line by line, in the block style it is written in, and every key
 * is read once.
 */
describe("parseRulesetDeclaration: every key read once, in block style", () => {
  function refusal(text: string): string {
    try {
      parseRulesetDeclaration(text);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("the declaration was accepted");
  }

  const HEAD = "schema_version: libre-ai.repository-rulesets.v1\nrepositories:\n";
  const RULESET = [
    "      - name: one",
    "        target: branch",
    "        enforcement: active",
    "        conditions:",
    "          ref_name:",
    "            include:",
    '              - "~ALL"',
    "            exclude: []",
    "        bypass_actors: []",
    "        rules:",
    "          - type: required_status_checks",
    "            parameters:",
    "              required_status_checks:",
    "                - context: CONTEXT",
    "                  integration_id: 15368",
  ];

  function entry(...extra: string[]): string {
    return `${HEAD}  - repository: ${ALPHA}\n    rulesets:\n${[...RULESET, ...extra].join("\n")}\n`;
  }

  test("a block-style declaration with quoted and typed scalars is read", () => {
    const declared = parseRulesetDeclaration(entry().replace("CONTEXT", '"1.10"'));
    expect(declared[0]?.rulesets[0]?.rules).toEqual([
      {
        type: "required_status_checks",
        parameters: { required_status_checks: [{ context: "1.10", integration_id: 15368 }] },
      },
    ]);
  });

  test("rulesets written twice in a repository is refused, not read as the last list", () => {
    const text = `${entry().replace("CONTEXT", "first")}    rulesets: []\n`;
    expect(refusal(text)).toContain("repositories[0].rulesets: duplicate key");
  });

  test("enforcement written twice in a ruleset is refused by path", () => {
    const text = entry()
      .replace("CONTEXT", "first")
      .replace(
        "        enforcement: active\n",
        "        enforcement: active\n        enforcement: disabled\n",
      );
    expect(refusal(text)).toContain("repositories[0].rulesets[0].enforcement: duplicate key");
  });

  test("a duplicate key at the root and deep in a rule is refused by path", () => {
    expect(refusal(`schema_version: x\n${entry().replace("CONTEXT", "first")}`)).toContain(
      ": schema_version: duplicate key",
    );
    const deep = entry("                  integration_id: 1").replace("CONTEXT", "first");
    expect(refusal(deep)).toContain(
      "repositories[0].rulesets[0].rules[0].parameters.required_status_checks[0].integration_id: duplicate key",
    );
  });

  test("a declaration outside the block style is refused, so no key escapes the line reading", () => {
    for (const text of [
      JSON.stringify({ schema_version: RULESET_DECLARATION_SCHEMA_VERSION, repositories: [] }),
      entry()
        .replace("CONTEXT", "first")
        .replace("        bypass_actors: []", "        bypass_actors: [{ actor_id: 1 }]"),
      entry()
        .replace("CONTEXT", "first")
        .replace("        target: branch", '        "target": branch'),
      entry()
        .replace("CONTEXT", "first")
        .replace("        target: branch", "        target: &t branch"),
      entry()
        .replace("CONTEXT", "first")
        .replace("        target: branch", "        target: |\n          branch"),
      `---\n${entry().replace("CONTEXT", "first")}`,
    ]) {
      expect(refusal(text)).toContain("block style");
    }
  });

  test("a plain scalar the parser would convert is refused: quote it", () => {
    for (const plain of ["1.10", "0x10", "012", "1e3", "~"]) {
      expect(refusal(entry().replace("CONTEXT", plain))).toContain(
        `repositories[0].rulesets[0].rules[0].parameters.required_status_checks[0].context: plain scalar ${JSON.stringify(plain)}`,
      );
    }
  });
});

describe("the tracked declaration", () => {
  const text = readFileSync(join(import.meta.dir, "repository-rulesets.v1.yaml"), "utf8");

  test("parses, carries the schema version, and declares inventoried repositories only", () => {
    expect(text).toContain("\nschema_version: libre-ai.repository-rulesets.v1\n");
    const declared = parseRulesetDeclaration(text);
    expect(declared.length).toBeGreaterThan(0);
    const inventory = new Set(
      buildIndex(
        readFileSync(join(import.meta.dir, "repositories.v1.yaml"), "utf8"),
      ).repositories.map((entry) => entry.repository),
    );
    for (const entry of declared) {
      expect(inventory.has(entry.repository)).toBe(true);
    }
  });
});

/**
 * The gate run as a process. The child gets an empty environment, so neither
 * `GATE_VERBOSE` nor anything else of the ambient run changes what it prints.
 */
describe("the command", () => {
  const GATE = join(import.meta.dir, "check-repository-rulesets.ts");
  let directory = "";

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "repository-rulesets-"));
    writeFileSync(join(directory, "declaration.yaml"), DECLARATION);
    writeFileSync(
      join(directory, "agree.json"),
      JSON.stringify({ repository: ALPHA, rulesets: alphaReadback(), observed_at: "ignored" }),
    );
    const drifted = alphaReadback();
    first(drifted).enforcement = "disabled";
    drifted.push({ ...first(drifted), name: "added-by-hand" });
    writeFileSync(
      join(directory, "drift.json"),
      JSON.stringify({ repository: ALPHA, rulesets: drifted }),
    );
    writeFileSync(join(directory, "not-json.json"), "{ repository:");
    writeFileSync(join(directory, "malformed.yaml"), "schema_version: nope\nrepositories: []\n");
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function run(...args: string[]): { exitCode: number; stdout: string; stderr: string } {
    const child = Bun.spawnSync([process.execPath, GATE, ...args], {
      env: {},
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: child.exitCode,
      stdout: child.stdout.toString(),
      stderr: child.stderr.toString(),
    };
  }

  function file(name: string): string {
    return join(directory, name);
  }

  test("exits 0 and prints the five counters when everything agrees", () => {
    const result = run("--declaration", file("declaration.yaml"), "--observed", file("agree.json"));
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "Repository rulesets verified: 3 assertion(s) hold — 1 declared repositories, " +
        "1 readbacks supplied, 2 declared rulesets, 2 rulesets read, 2 identical\n",
    );
  });

  test("exits non-zero and prints one line per finding on drift", () => {
    const result = run("--declaration", file("declaration.yaml"), "--observed", file("drift.json"));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.split("\n").filter((line) => line.length > 0)).toEqual([
      `Repository rulesets: declared.${ALPHA}.rulesets.served-branch: ruleset-differs: differs on: enforcement`,
      `Repository rulesets: observed.${ALPHA}.rulesets.added-by-hand: undeclared-ruleset: read, absent from the declaration`,
      "Repository rulesets failed: 2 of 4 assertion(s) did not hold.",
    ]);
  });

  test("exits non-zero without any --observed", () => {
    const result = run("--declaration", file("declaration.yaml"));
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("no --observed file supplied");
  });

  test("exits non-zero on an absent readback file", () => {
    const result = run(
      "--declaration",
      file("declaration.yaml"),
      "--observed",
      file("absent.json"),
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("absent.json: unreadable readback file");
  });

  test("exits non-zero on a readback that is not JSON, or names no repository", () => {
    const notJson = run(
      "--declaration",
      file("declaration.yaml"),
      "--observed",
      file("not-json.json"),
    );
    expect(notJson.exitCode).not.toBe(0);
    expect(notJson.stderr).toContain("not-json.json: readback is not JSON");
    // A YAML declaration is not a readback: it carries no `repository`.
    writeFileSync(file("no-repository.json"), JSON.stringify({ rulesets: [] }));
    const nameless = run(
      "--declaration",
      file("declaration.yaml"),
      "--observed",
      file("no-repository.json"),
    );
    expect(nameless.exitCode).not.toBe(0);
    expect(nameless.stderr).toContain("no-repository.json: readback carries no non-empty string");
  });

  test("a read name or repository carrying a newline cannot forge an output line", () => {
    const rulesets = alphaReadback();
    rulesets.push({ ...first(rulesets), name: "x\nRepository rulesets verified: forged" });
    writeFileSync(file("forged-name.json"), JSON.stringify({ repository: ALPHA, rulesets }));
    const named = run(
      "--declaration",
      file("declaration.yaml"),
      "--observed",
      file("forged-name.json"),
    );
    expect(named.exitCode).toBe(1);
    const output = `${named.stdout}${named.stderr}`;
    expect(output).not.toContain("\nRepository rulesets verified");
    expect(output).toContain(`observed.${ALPHA}.rulesets: unreadable-observation`);

    writeFileSync(
      file("forged-repository.json"),
      JSON.stringify({
        repository: `${ALPHA}\nRepository rulesets verified: forged`,
        rulesets: [],
      }),
    );
    const repository = run(
      "--declaration",
      file("declaration.yaml"),
      "--observed",
      file("forged-repository.json"),
    );
    expect(repository.exitCode).not.toBe(0);
    expect(`${repository.stdout}${repository.stderr}`).not.toContain(
      "\nRepository rulesets verified",
    );
    expect(repository.stderr).toContain("control character");
  });

  test("exits non-zero on a malformed declaration and on an unknown argument", () => {
    const malformed = run(
      "--declaration",
      file("malformed.yaml"),
      "--observed",
      file("agree.json"),
    );
    expect(malformed.exitCode).not.toBe(0);
    expect(malformed.stdout).toBe("");
    expect(malformed.stderr).toContain("schema_version: expected libre-ai.repository-rulesets.v1");
    const unknown = run("--observed", file("agree.json"), "--fix");
    expect(unknown.exitCode).not.toBe(0);
    expect(unknown.stderr).toContain("unknown argument --fix");
  });

  test("reads the tracked declaration by default", () => {
    const declared = parseRulesetDeclaration(
      readFileSync(join(import.meta.dir, "repository-rulesets.v1.yaml"), "utf8"),
    );
    const paths = declared.map((entry, index) => {
      const path = file(`tracked-${index}.json`);
      writeFileSync(
        path,
        JSON.stringify({ repository: entry.repository, rulesets: readbackOf(entry) }),
      );
      return path;
    });
    const result = run(...paths.flatMap((path) => ["--observed", path]));
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const total = declared.reduce((sum, entry) => sum + entry.rulesets.length, 0);
    expect(result.stdout).toContain(
      `${declared.length} declared repositories, ${declared.length} readbacks supplied, ` +
        `${total} declared rulesets, ${total} rulesets read, ${total} identical`,
    );
  });
});
