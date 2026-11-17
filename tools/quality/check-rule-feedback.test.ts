import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  CHECKOUT_DIR,
  type ContractsAuthorityPin,
  FETCH_COMMAND,
  PIN_PATH,
  stampFor,
} from "../../crates/ecosystem-engine/scripts/contracts-authority";

/**
 * The rule feedback validator, run as a process.
 *
 * WHY A PROCESS. The command resolves the pin, the checkout and the schema
 * from its working directory, as every reader of the contracts authority does;
 * the schema path is deliberately not an option. Each probe therefore runs the
 * command in a fixture directory holding its own pin, stamp and schema, and
 * the exit code and output are the verdict. The environment is built from
 * nothing but PATH and HOME.
 *
 * WHY FIXTURE FORMS. The common forms are the contract's, read at run time.
 * These probes give the command forms of their own (FORMS_A, FORMS_B), written
 * here and NOT copied from the contract: a verdict that changes between the two
 * sets proves the command reads its forms and holds no expression of them. One
 * probe runs at the repository root against the real pinned checkout. The
 * ticket values below are chosen to hold under FORMS_A and under the contract.
 *
 * Expected labels, natures and bounds come from the briefs (L028 labels, owner
 * decision of 2026-11-17), not from the module.
 */

const SCRIPT = join(import.meta.dir, "check-rule-feedback.ts");
const ROOT = join(import.meta.dir, "..", "..");
/** What `bun run fetch:contracts-authority` runs, after its runtime floor check. */
const FETCH_SCRIPT = join(ROOT, "crates/ecosystem-engine/scripts/fetch-contracts-authority.ts");

/** The eight labels of the issue form, in order (brief L028, `listes_completes`). */
const LABELS: readonly string[] = [
  "Rule identifier",
  "Excerpt digest",
  "Pack",
  "Snapshot",
  "Overlays",
  "Core version",
  "Nature",
  "Proposal",
];

const SENTINEL = "zqxsentinel";

const FORMS_A = {
  $defs: {
    ruleId: {
      type: "string",
      minLength: 3,
      maxLength: 200,
      pattern: "^[a-z]+:[a-z]+#[A-Za-z0-9]+$",
    },
    excerptDigest: { type: "string", minLength: 64, maxLength: 64, pattern: "^[a-f0-9]+$" },
    slug: { type: "string", maxLength: 32, pattern: "^[a-z][a-z0-9-]*$" },
    edition: { type: "string", pattern: "^[0-9]+(?:\\.[0-9]+)*$" },
    overlayReference: { type: "string", pattern: "^[a-z]+/[a-z]+@[0-9]+$" },
    level: { enum: ["MUST", "MUST_NOT", "SHOULD"] },
    triggerType: { enum: ["glob", "keyword"] },
  },
};

/**
 * FORMS_A with each of the seven leaves changed: every leaf admits what FORMS_A
 * admits plus one value of its own (`ONLY_B`). The valid ticket holds under
 * both sets, so a value of `ONLY_B` is the only difference between two runs.
 */
const FORMS_B = {
  $defs: {
    ruleId: {
      type: "string",
      minLength: 3,
      maxLength: 200,
      pattern: "^(?:[a-z]+:[a-z]+#[A-Za-z0-9]+|[A-Z]+)$",
    },
    excerptDigest: {
      type: "string",
      minLength: 64,
      maxLength: 64,
      pattern: "^(?:[a-f0-9]+|[g-z]+)$",
    },
    slug: { type: "string", maxLength: 32, pattern: "^(?:[a-z][a-z0-9-]*|_[a-z]+)$" },
    edition: { type: "string", pattern: "^(?:[0-9]+(?:\\.[0-9]+)*|v[0-9]+)$" },
    overlayReference: { type: "string", pattern: "^(?:[a-z]+/[a-z]+@[0-9]+|[a-z]+:[a-z]+)$" },
    level: { enum: ["MUST", "MUST_NOT", "SHOULD", "MAY_NOT"] },
    triggerType: { enum: ["glob", "keyword", "path"] },
  },
};

/** Per leaf of the contract: ticket changes that hold under FORMS_B and not under FORMS_A. */
const ONLY_B: readonly (readonly [string, Readonly<Record<string, string>>, string])[] = [
  ["ruleId", { "Rule identifier": "RULE" }, 'field "Rule identifier"'],
  ["excerptDigest", { "Excerpt digest": "g".repeat(64) }, 'field "Excerpt digest"'],
  ["slug", { Pack: "_pub@2.1" }, 'field "Pack"'],
  ["edition", { Pack: "rules@v2" }, 'field "Pack"'],
  ["overlayReference", { Overlays: "publisher:local" }, 'field "Overlays"'],
  ["level", { Proposal: "MAY_NOT" }, 'field "Proposal"'],
  ["triggerType", { Nature: "trigger", Proposal: "path=x" }, 'field "Proposal"'],
];

const VALID: Readonly<Record<string, string>> = {
  "Rule identifier": "src:doc#R1",
  "Excerpt digest": "0123456789abcdef".repeat(4),
  Pack: "rules@2.1",
  Snapshot: "publisher@42",
  Overlays: "publisher/local@3",
  "Core version": "1.4.0-rc.1",
  Nature: "level",
  Proposal: "MUST_NOT",
};

/** A body with these sections, in this order, as the form renders it. */
function body(sections: readonly (readonly [string, string])[]): string {
  return sections.map(([label, value]) => `### ${label}\n\n${value}`).join("\n\n");
}

/** The valid ticket with some values replaced. */
function ticket(changes: Readonly<Record<string, string>> = {}): string {
  return body(LABELS.map((label) => [label, changes[label] ?? (VALID[label] as string)] as const));
}

const workspace: string = mkdtempSync(join(tmpdir(), "rule-feedback-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
let fixtureCount = 0;

const PIN: ContractsAuthorityPin = {
  repository: "libre-ai/schemas-and-contracts",
  commit: "0123456789abcdef0123456789abcdef01234567",
  integrity: `sha512-${"A".repeat(86)}==`,
};

interface AuthorityFixture {
  /** The schema text, or null for no schema file. */
  readonly schema?: string | null;
  readonly stamp?: "current" | "stale" | "missing";
  readonly pin?: boolean;
}

/** A working directory holding a pin, a checkout stamp and a schema. */
function authority(options: AuthorityFixture = {}): string {
  fixtureCount += 1;
  const dir = join(workspace, `cwd-${fixtureCount}`);
  const schemaPath = join(dir, CHECKOUT_DIR, "contracts/schemas/rule-common.v1.schema.json");
  mkdirSync(dirname(schemaPath), { recursive: true });
  if (options.pin !== false) {
    mkdirSync(dirname(join(dir, PIN_PATH)), { recursive: true });
    writeFileSync(join(dir, PIN_PATH), JSON.stringify(PIN));
  }
  const stamp = options.stamp ?? "current";
  if (stamp !== "missing") {
    const stamped = stamp === "current" ? PIN : { ...PIN, commit: "f".repeat(40) };
    writeFileSync(join(dir, CHECKOUT_DIR, ".pin"), stampFor(stamped));
  }
  const schema = options.schema === undefined ? JSON.stringify(FORMS_A) : options.schema;
  if (schema !== null) writeFileSync(schemaPath, schema);
  return dir;
}

interface Run {
  readonly code: number;
  readonly output: string;
  readonly lines: readonly string[];
}

function run(cwd: string, argv: readonly string[]): Run {
  const result = Bun.spawnSync(["bun", SCRIPT, ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NO_COLOR: "1" },
  });
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  return {
    code: result.exitCode ?? -1,
    output,
    lines: output.split("\n").filter((line) => line !== ""),
  };
}

const defaultCwd: string = authority();

/** Write `content` as a ticket file and check it in `cwd`. */
function check(content: string | Uint8Array, cwd: string = defaultCwd): Run {
  fixtureCount += 1;
  const path = join(workspace, `ticket-${fixtureCount}.md`);
  writeFileSync(path, content);
  return run(cwd, ["check", path]);
}
const PASS_COUNTS =
  "rule feedback ticket: lines=31 sections=8 fields valid=8 invalid=0 unread=0 of 8";

function expectRefused(result: Run, reason: string): void {
  expect(result.code).toBe(1);
  expect(result.lines.at(-1)).toStartWith("refused: ");
  expect(result.lines.at(-1)).toContain(reason);
  expect(result.output).not.toContain("\npass");
}

describe("a valid ticket", () => {
  test("eight valid fields in order pass, and the counts say 8 of 8", () => {
    const result = check(ticket());
    expect(result.code).toBe(0);
    expect(result.lines).toEqual([PASS_COUNTS, "pass"]);
  });

  test("CRLF line ends, and one final line end, give the same verdict and output", () => {
    const lf = check(ticket());
    for (const variant of [
      ticket().replaceAll("\n", "\r\n"),
      `${ticket()}\n`,
      `${ticket().replaceAll("\n", "\r\n")}\r\n`,
    ]) {
      const result = check(variant);
      expect(result.code).toBe(lf.code);
      expect(result.output).toBe(lf.output);
    }
  });

  test("none is accepted as the proposal of each of the three natures, and as overlays", () => {
    for (const nature of ["rephrasing", "trigger", "level"]) {
      expect(check(ticket({ Nature: nature, Proposal: "none" })).code).toBe(0);
    }
    expect(check(ticket({ Overlays: "none" })).code).toBe(0);
  });

  test("overlays are references separated by commas, in stack order", () => {
    expect(check(ticket({ Overlays: "publisher/local@3,team/extra@12" })).code).toBe(0);
  });

  test("a trigger proposal is type=value with a known type", () => {
    expect(check(ticket({ Nature: "trigger", Proposal: "glob=src/**/*.ts" })).code).toBe(0);
  });

  test("a core version without a pre-release passes", () => {
    expect(check(ticket({ "Core version": "1.4.0" })).code).toBe(0);
  });
});

describe("the structure is exact", () => {
  test("an unknown field is refused", () => {
    const sections = LABELS.map((label) => [label, VALID[label] as string] as const);
    expectRefused(
      check(body([...sections.slice(0, 2), ["Comment", "x"], ...sections.slice(2)])),
      "line 9: unknown field",
    );
  });

  test("a repeated field is refused", () => {
    const sections = LABELS.map((label) => [label, VALID[label] as string] as const);
    expectRefused(
      check(body([...sections, ["Pack", "rules@2.1"]])),
      'field "Pack" repeated at line 33',
    );
  });

  test("a missing field is refused", () => {
    const sections = LABELS.filter((label) => label !== "Snapshot").map(
      (label) => [label, VALID[label] as string] as const,
    );
    expectRefused(check(body(sections)), 'field "Snapshot" missing');
  });

  test("two swapped fields are refused", () => {
    const order = ["Rule identifier", "Pack", "Excerpt digest", ...LABELS.slice(3)];
    expectRefused(
      check(body(order.map((label) => [label, VALID[label] as string] as const))),
      'field "Pack" out of order at line 5',
    );
  });

  test("a line of text before, between or after the fields is refused", () => {
    expectRefused(check(`Some text\n\n${ticket()}`), "line 1: out of form");
    const between = ticket().replace("\n\n### Pack", "\n\nSome text\n\n### Pack");
    expectRefused(check(between), "line 9: out of form");
    expectRefused(check(`${ticket()}\n\nSome text`), "line 33: out of form");
  });

  test("a value on two lines is refused", () => {
    expectRefused(check(ticket({ Pack: "rules@2.1\nmore" })), "line 12: out of form");
  });

  test("an empty line after the last value, beyond one final line end, is refused", () => {
    expectRefused(check(`${ticket()}\n\n`), "line 32: out of form");
  });

  test("a ticket that ends after a heading, or holds nothing, is refused", () => {
    expectRefused(check("### Rule identifier"), "line 2: the ticket ends");
    expectRefused(check("### Rule identifier\n\n"), "line 3: the ticket ends");
    expectRefused(check(""), "line 1: out of form");
  });

  test("a comment anywhere is refused: own line, value, heading", () => {
    expectRefused(check(`${ticket()}\n\n<!-- template -->`), "line 33: a comment is not allowed");
    expectRefused(
      check(ticket({ Nature: "rephrasing", Proposal: "Say it <!-- x --> plainly" })),
      "line 31: a comment is not allowed",
    );
    expectRefused(check(ticket().replace("### Pack", "### Pack <!-- x -->")), "line 9: a comment");
  });

  test("the form's empty answer is refused", () => {
    expectRefused(
      check(ticket({ Nature: "rephrasing", Proposal: "_No response_" })),
      "line 31: an empty answer is not allowed",
    );
  });

  test("a space at the start or end of a line is refused", () => {
    expectRefused(check(ticket({ Pack: " rules@2.1" })), "line 11: a space");
    expectRefused(check(ticket().replace("### Pack", "### Pack ")), "line 9: a space");
  });
});

describe("values are judged against their forms", () => {
  test("a rephrasing proposal of 1000 characters passes, of 1001 is refused", () => {
    // Counted in code points: an astral character is one, not two UTF-16 units.
    for (const unit of ["a", "\u{E9}", "\u{1D11E}"]) {
      expect(check(ticket({ Nature: "rephrasing", Proposal: unit.repeat(1000) })).code).toBe(0);
      expectRefused(
        check(ticket({ Nature: "rephrasing", Proposal: unit.repeat(1001) })),
        'field "Proposal": longer than 1000 characters',
      );
    }
  });

  test("a nature outside the three is refused", () => {
    expectRefused(check(ticket({ Nature: "rewording" })), 'field "Nature"');
    const result = check(ticket({ Nature: "rewording" }));
    expect(result.lines[0]).toContain("valid=6 invalid=1 unread=1 of 8");
  });

  test("a level outside the vocabulary is refused", () => {
    expectRefused(check(ticket({ Proposal: "MUST NOT" })), 'field "Proposal": incompatible');
    expectRefused(check(ticket({ Proposal: "must" })), 'field "Proposal": incompatible');
  });

  test("a trigger without =, of unknown type, or with an empty value is refused", () => {
    expectRefused(check(ticket({ Nature: "trigger", Proposal: "glob" })), "expected type=value");
    expectRefused(check(ticket({ Nature: "trigger", Proposal: "path=x" })), "unknown trigger type");
    expectRefused(check(ticket({ Nature: "trigger", Proposal: "glob=" })), "empty trigger value");
  });

  test("a snapshot version of 16 digits passes, of 17 or not decimal is refused", () => {
    expect(check(ticket({ Snapshot: `publisher@${"9".repeat(16)}` })).code).toBe(0);
    expectRefused(check(ticket({ Snapshot: `publisher@${"9".repeat(17)}` })), 'field "Snapshot"');
    expectRefused(check(ticket({ Snapshot: "publisher@4a" })), 'field "Snapshot"');
    expectRefused(check(ticket({ Snapshot: "publisher@0" })), 'field "Snapshot"');
  });

  test("a pack is slug@edition with a single @", () => {
    expectRefused(check(ticket({ Pack: "rules" })), 'field "Pack"');
    expectRefused(check(ticket({ Pack: "rules@2@1" })), 'field "Pack"');
    expectRefused(check(ticket({ Pack: "Rules@2.1" })), 'field "Pack"');
    // With a slug form that admits digits, "11" without its @ would read as
    // slug "1" and edition "11" if the separator were not required.
    const digitSlugs = authority({
      schema: JSON.stringify({
        $defs: { ...FORMS_A.$defs, slug: { type: "string", pattern: "^[a-z0-9]+$" } },
      }),
    });
    expect(check(ticket({ Pack: "1@11" }), digitSlugs).code).toBe(0);
    expectRefused(check(ticket({ Pack: "11" }), digitSlugs), 'field "Pack"');
  });

  test("overlays refuse a repeated reference and a reference out of form", () => {
    expectRefused(
      check(ticket({ Overlays: "publisher/local@3,publisher/local@3" })),
      'field "Overlays"',
    );
    expectRefused(
      check(ticket({ Overlays: "publisher/local@3, team/extra@1" })),
      'field "Overlays"',
    );
    expectRefused(
      check(ticket({ Overlays: "publisher/local@3,team/extra@1 x" })),
      'field "Overlays"',
    );
  });

  test("a core version is x.y.z with an optional pre-release, no build metadata", () => {
    for (const value of ["1.4", "01.4.0", "1.4.0+build", "1.4.0-", "1.4.0-01"]) {
      expectRefused(check(ticket({ "Core version": value })), 'field "Core version"');
    }
  });

  test("a core version holds at most 64 characters", () => {
    expect(check(ticket({ "Core version": `1.0.0-${"a".repeat(58)}` })).code).toBe(0);
    expectRefused(
      check(ticket({ "Core version": `1.0.0-${"a".repeat(59)}` })),
      'field "Core version"',
    );
  });

  test("the length bounds of a common form are read and applied", () => {
    // FORMS_A gives the digest the pattern ^[a-f0-9]+$ and the bounds 64..64:
    // only the bounds refuse 63 and 65 characters.
    expectRefused(check(ticket({ "Excerpt digest": "a".repeat(63) })), 'field "Excerpt digest"');
    expectRefused(check(ticket({ "Excerpt digest": "a".repeat(65) })), 'field "Excerpt digest"');
  });

  test("tab, NUL, no-break space and byte order mark are refused, naming line and code point", () => {
    const proposalCases: readonly (readonly [string, string])[] = [
      ["\t", "U+0009"],
      ["\u{0}", "U+0000"],
      ["\u{A0}", "U+00A0"],
      ["\u{FEFF}", "U+FEFF"],
    ];
    for (const [char, codePoint] of proposalCases) {
      expectRefused(
        check(ticket({ Nature: "rephrasing", Proposal: `a${char}b` })),
        `line 31: unreadable character ${codePoint}`,
      );
    }
    expectRefused(check(`\u{FEFF}${ticket()}`), "line 1: unreadable character U+FEFF");
  });

  test("a trigger value holds 1 to 1000 characters", () => {
    // Counted in code points, as the rephrasing proposal ("glob=" is 5 of them).
    for (const unit of ["a", "\u{1D11E}"]) {
      expect(check(ticket({ Nature: "trigger", Proposal: `glob=${unit.repeat(1000)}` })).code).toBe(
        0,
      );
      expectRefused(
        check(ticket({ Nature: "trigger", Proposal: `glob=${unit.repeat(1001)}` })),
        'field "Proposal": longer than 1000 characters',
      );
    }
  });

  test("a free value without a visible character is refused", () => {
    // A lone combining mark, or a run of spaces between visible text and
    // nothing: neither reaches the line-edge or invisible-character refusals.
    for (const value of ["\u{301}", "\u{301}\u{301}"]) {
      expectRefused(
        check(ticket({ Nature: "trigger", Proposal: `glob=${value}` })),
        'field "Proposal": no visible character',
      );
      expectRefused(
        check(ticket({ Nature: "rephrasing", Proposal: value })),
        'field "Proposal": no visible character',
      );
    }
    expect(check(ticket({ Nature: "rephrasing", Proposal: "e\u{301}" })).code).toBe(0);
  });

  test("format characters and spaces other than U+0020 are refused, naming line and code point", () => {
    // \p{Cf} (zero width, soft hyphen, bidirectional controls, tag characters)
    // and \p{Z} other than U+0020; the shared guard refuses U+00A0, U+2028,
    // U+2029 and U+FEFF on its own and is left unchanged.
    const cases: readonly string[] = [
      "\u{200B}",
      "\u{200E}",
      "\u{200F}",
      "\u{AD}",
      "\u{202A}",
      "\u{202E}",
      "\u{2066}",
      "\u{2069}",
      "\u{E0041}",
      "\u{2009}",
      "\u{3000}",
      "\u{1680}",
    ];
    for (const char of cases) {
      const codePoint = `U+${(char.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}`;
      expectRefused(
        check(ticket({ Nature: "rephrasing", Proposal: `a${char}b` })),
        `line 31: invisible character ${codePoint}`,
      );
      expectRefused(
        check(ticket({ Nature: "trigger", Proposal: `glob=a${char}b` })),
        `line 31: invisible character ${codePoint}`,
      );
    }
    expectRefused(
      check(ticket({ "Rule identifier": "src:doc#R\u{202E}1" })),
      "line 3: invisible character U+202E",
    );
    expectRefused(
      check(ticket().replace("### Pack", "### Pa\u{200B}ck")),
      "line 9: invisible character U+200B",
    );
    expect(check(ticket({ Nature: "rephrasing", Proposal: "a plain sentence" })).code).toBe(0);
  });

  test("< and > are refused in a free value", () => {
    for (const value of ["<b>x</b>", "a < b", "a > b", "<details>", "x>"]) {
      expectRefused(
        check(ticket({ Nature: "rephrasing", Proposal: value })),
        'field "Proposal": < and > are not allowed',
      );
      expectRefused(
        check(ticket({ Nature: "trigger", Proposal: `glob=${value}` })),
        'field "Proposal": < and > are not allowed',
      );
    }
  });

  test("a ticket file that is not valid UTF-8 is refused", () => {
    const bytes = new TextEncoder().encode(ticket());
    const broken = new Uint8Array([...bytes.slice(0, 20), 0xff, ...bytes.slice(20)]);
    expectRefused(check(broken), "not valid UTF-8");
  });
});

describe("no value leaks into the output", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["unknown field", body([[SENTINEL, "x"]])],
    ["text before", `${SENTINEL}\n\n${ticket()}`],
    ["text after", `${ticket()}\n\n${SENTINEL}`],
    ["comment", `${ticket()}\n\n<!-- ${SENTINEL} -->`],
    ["two-line value", ticket({ Pack: `rules@2.1\n${SENTINEL}` })],
    ["rule identifier", ticket({ "Rule identifier": SENTINEL })],
    ["excerpt digest", ticket({ "Excerpt digest": SENTINEL })],
    ["pack", ticket({ Pack: `${SENTINEL}@x` })],
    ["snapshot", ticket({ Snapshot: `publisher@${SENTINEL}` })],
    ["overlays", ticket({ Overlays: SENTINEL })],
    ["core version", ticket({ "Core version": SENTINEL })],
    ["nature", ticket({ Nature: SENTINEL })],
    ["level", ticket({ Proposal: SENTINEL })],
    ["trigger type", ticket({ Nature: "trigger", Proposal: `${SENTINEL}=x` })],
    ["trigger without =", ticket({ Nature: "trigger", Proposal: SENTINEL })],
    ["long rephrasing", ticket({ Nature: "rephrasing", Proposal: SENTINEL.repeat(100) })],
    ["unreadable", ticket({ Nature: "rephrasing", Proposal: `${SENTINEL}\t` })],
    ["edge space", ticket({ Nature: "rephrasing", Proposal: `${SENTINEL} ` })],
    ["long trigger value", ticket({ Nature: "trigger", Proposal: `glob=${SENTINEL.repeat(100)}` })],
    ["invisible character", ticket({ Nature: "rephrasing", Proposal: `${SENTINEL}\u{202E}x` })],
    ["angle bracket", ticket({ Nature: "rephrasing", Proposal: `<${SENTINEL}>` })],
    ["angle bracket in trigger", ticket({ Nature: "trigger", Proposal: `glob=<${SENTINEL}` })],
  ];
  const labelOrLine = new RegExp(`field "(?:${LABELS.join("|")})"|line \\d+`);

  for (const [name, content] of cases) {
    test(`refusal "${name}": the sentinel is absent, a label or a line is named`, () => {
      const result = check(content);
      expect(result.code).toBe(1);
      expect(result.output).not.toContain(SENTINEL);
      expect(result.lines.at(-1)).toMatch(labelOrLine);
    });
  }
});

describe("the command line", () => {
  test("--fields prints the eight labels in order, and a ticket built from them passes", () => {
    const result = run(defaultCwd, ["--fields"]);
    expect(result.code).toBe(0);
    expect(result.lines).toEqual([...LABELS]);
    expect(
      check(body(result.lines.map((label) => [label, VALID[label] as string] as const))).code,
    ).toBe(0);
  });

  test("no argument, an unknown subcommand, check without a file or with two: exit 2", () => {
    for (const argv of [[], ["verify", "x"], ["check"], ["check", "a", "b"], ["--fields", "x"]]) {
      const result = run(defaultCwd, argv);
      expect(result.code).toBe(2);
      expect(result.lines.length).toBe(1);
      expect(result.lines[0]).toStartWith("usage: ");
    }
  });

  test("an absent ticket file is a named failure", () => {
    const result = run(defaultCwd, ["check", join(workspace, "absent.md")]);
    expectRefused(result, "cannot read the ticket file");
    expect(result.lines[0]).toContain("unread=8 of 8");
  });
});

describe("the common forms are read from the pinned checkout", () => {
  const unreadable: readonly (readonly [string, AuthorityFixture, string])[] = [
    ["schema absent", { schema: null }, "cannot read"],
    ["schema not JSON", { schema: "{" }, "not valid JSON"],
    ["no $defs", { schema: "{}" }, "no $defs"],
    [
      "pointer absent",
      { schema: JSON.stringify({ $defs: { ...FORMS_A.$defs, level: undefined } }) },
      "#/$defs/level is absent",
    ],
    [
      "leaf with a $ref",
      {
        schema: JSON.stringify({
          $defs: { ...FORMS_A.$defs, slug: { $ref: "#/x", type: "string", pattern: "^a$" } },
        }),
      },
      '#/$defs/slug carries the keyword "$ref"',
    ],
    [
      "pattern that does not compile",
      {
        schema: JSON.stringify({
          $defs: { ...FORMS_A.$defs, slug: { type: "string", pattern: "^(a$" } },
        }),
      },
      "does not compile",
    ],
    [
      "empty list",
      { schema: JSON.stringify({ $defs: { ...FORMS_A.$defs, level: { enum: [] } } }) },
      "#/$defs/level is not a non-empty list",
    ],
    [
      "list leaf with another keyword",
      {
        schema: JSON.stringify({
          $defs: { ...FORMS_A.$defs, level: { type: "string", enum: ["MUST"] } },
        }),
      },
      '#/$defs/level is not a closed list holding "enum" alone',
    ],
    ["checkout missing", { stamp: "missing" }, `is missing, run ${FETCH_COMMAND}`],
    ["checkout stale", { stamp: "stale" }, `is stale, run ${FETCH_COMMAND}`],
    ["pin missing", { pin: false }, "contracts authority pin unreadable"],
  ];

  for (const [name, fixture, reason] of unreadable) {
    test(`${name}: exit 1 with a named reason, never pass`, () => {
      const result = check(ticket(), authority(fixture));
      expectRefused(result, reason);
      expect(result.lines[0]).toContain("unread=8 of 8");
    });
  }

  test("FORMS_B changes each of the seven leaves of FORMS_A", () => {
    const leaves = Object.keys(FORMS_A.$defs) as (keyof typeof FORMS_A.$defs)[];
    expect(leaves.length).toBe(7);
    expect(ONLY_B.map(([leaf]) => leaf).sort()).toEqual([...leaves].sort());
    for (const leaf of leaves) {
      expect(FORMS_B.$defs[leaf]).not.toEqual(FORMS_A.$defs[leaf]);
    }
  });

  const formsB = authority({ schema: JSON.stringify(FORMS_B) });
  test("the valid ticket holds under both sets of forms", () => {
    expect(check(ticket(), formsB).code).toBe(0);
    expect(check(ticket()).code).toBe(0);
  });

  for (const [leaf, changes, reason] of ONLY_B) {
    test(`with other forms, the same value changes verdict: ${leaf}`, () => {
      expectRefused(check(ticket(changes)), reason);
      const underB = check(ticket(changes), formsB);
      expect(underB.code).toBe(0);
      expect(underB.lines.at(-1)).toBe("pass");
    });
  }

  test("a pattern decides the whole value, whatever its anchors (rule R3)", () => {
    // `^publisher|rules$` starts with ^ and ends with $, yet as written it
    // accepts any value that starts with "publisher" or ends with "rules": the
    // form must still match the whole value. (Both slugs of the valid ticket hold.)
    const looselyAnchored = authority({
      schema: JSON.stringify({
        $defs: { ...FORMS_A.$defs, slug: { type: "string", pattern: "^publisher|rules$" } },
      }),
    });
    expect(check(ticket(), looselyAnchored).code).toBe(0);
    expectRefused(check(ticket({ Pack: "xrules@2.1" }), looselyAnchored), 'field "Pack"');
    expectRefused(check(ticket({ Pack: "publisherx@2.1" }), looselyAnchored), 'field "Pack"');
    // Without anchors at all, the form is still a whole-value match.
    const unanchored = authority({
      schema: JSON.stringify({
        $defs: { ...FORMS_A.$defs, slug: { type: "string", pattern: "[a-z]+" } },
      }),
    });
    expect(check(ticket(), unanchored).code).toBe(0);
    expectRefused(check(ticket({ Pack: "rules1@2.1" }), unanchored), 'field "Pack"');
  });

  test("a pattern that would close the wrapping group is refused, not spliced", () => {
    // Wrapped as ^(?:<source>)$, this source would read ^(?:zz)|(?:.*)$ and
    // accept anything: it does not compile on its own, so it is refused.
    const result = check(
      ticket(),
      authority({
        schema: JSON.stringify({
          $defs: { ...FORMS_A.$defs, slug: { type: "string", pattern: "zz)|(?:.*" } },
        }),
      }),
    );
    expectRefused(result, "#/$defs/slug has a pattern that does not compile");
  });

  test("a length bound written null is refused, not read as absent", () => {
    for (const bound of ["minLength", "maxLength"]) {
      const result = check(
        ticket(),
        authority({
          schema: JSON.stringify({
            $defs: {
              ...FORMS_A.$defs,
              slug: { type: "string", pattern: "^[a-z]+$", [bound]: null },
            },
          }),
        }),
      );
      expectRefused(result, "#/$defs/slug has a length bound that is not a natural integer");
    }
  });

  test("at the repository root: the pinned checkout is fetched if needed, read, and the ticket passes", () => {
    // The test does not accept an absent checkout: in CI `bun run test` runs
    // before any link that fetches it. The repository's own fetch (integrity
    // verified before extraction, a no-op on a current checkout) runs first;
    // a fetch that fails is a failure of this test.
    const fetched = Bun.spawnSync(["bun", FETCH_SCRIPT], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NO_COLOR: "1" },
    });
    const fetchOutput =
      new TextDecoder().decode(fetched.stdout) + new TextDecoder().decode(fetched.stderr);
    // The output is part of the compared object so that a failed fetch says why.
    expect({ code: fetched.exitCode, output: fetchOutput }).toMatchObject({ code: 0 });
    expect(fetchOutput).toContain("Contracts authority ");
    expect(
      existsSync(join(ROOT, CHECKOUT_DIR, "contracts/schemas/rule-common.v1.schema.json")),
    ).toBe(true);
    const result = check(ticket(), ROOT);
    expect(result.code).toBe(0);
    expect(result.lines).toEqual([PASS_COUNTS, "pass"]);
  }, 120_000);
});
