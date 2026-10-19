import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadWorkPackagePolicy } from "./work-package-policy";

const SHIPPED = join(import.meta.dir, "..", "..", "ecosystem", "work-package-policy.v1.yaml");

// `décision` has an accent, so it is written quoted: a bare token is ASCII only.
const HEAD = 'approvedFrom: "décision"\n';

const VALID = [
  'approvedFrom: "décision"',
  "exempt:",
  "  dependabot:",
  '    author: "dependabot[bot]"',
  "owners:",
  "  - constantin-jais",
  "",
].join("\n");

function withRules(rules: string, owners = "[a]"): string {
  return `${HEAD}exempt:\n${rules}owners: ${owners}\n`;
}

function withOwners(owners: string): string {
  return `${HEAD}exempt: {}\nowners: ${owners}\n`;
}

function reason(text: string): string {
  const result = loadWorkPackagePolicy(text);
  if (result.ok) {
    throw new Error(`expected ok:false, got ${JSON.stringify(result.value)}`);
  }
  return result.reason;
}

describe("loadWorkPackagePolicy", () => {
  test("loads the shipped file", async () => {
    const result = loadWorkPackagePolicy(await Bun.file(SHIPPED).text());
    expect(result).toEqual({
      ok: true,
      value: {
        approvedFrom: "décision",
        exempt: {
          dependabot: { author: "dependabot[bot]" },
          "docs-only": { paths: ["**/*.md", "docs/**"] },
          revert: { titlePrefix: "Revert " },
        },
        owners: ["constantin-jais"],
      },
    });
  });

  test("accepts a minimal valid policy", () => {
    expect(loadWorkPackagePolicy(VALID)).toEqual({
      ok: true,
      value: {
        approvedFrom: "décision",
        exempt: { dependabot: { author: "dependabot[bot]" } },
        owners: ["constantin-jais"],
      },
    });
  });

  test("accepts full-line comments, blank lines, one-line lists and CRLF", () => {
    const text = [
      '# a comment with a: colon and a "quote',
      "",
      'approvedFrom: "mise en service"',
      "exempt:",
      "  # an indented comment",
      "  r:",
      '    paths: [a/b, "c d"]',
      "owners: [Foo-Bar, x]",
      "",
    ].join("\n");
    const expected = {
      ok: true as const,
      value: {
        approvedFrom: "mise en service" as const,
        exempt: { r: { paths: ["a/b", "c d"] } },
        owners: ["Foo-Bar", "x"],
      },
    };
    expect(loadWorkPackagePolicy(text)).toEqual(expected);
    expect(loadWorkPackagePolicy(text.replaceAll("\n", "\r\n"))).toEqual(expected);
  });

  test("an empty exempt object is valid (no exemption)", () => {
    expect(loadWorkPackagePolicy("approvedFrom: proposition\nexempt: {}\nowners: [a]\n")).toEqual({
      ok: true,
      value: { approvedFrom: "proposition", exempt: {}, owners: ["a"] },
    });
  });

  test("the exempt object has no prototype to pollute", () => {
    const result = loadWorkPackagePolicy(VALID);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(Object.getPrototypeOf(result.value.exempt)).toBeNull();
  });
});

describe("semantic validation", () => {
  test("approvedFrom outside the ladder is ok:false", () => {
    expect(reason(VALID.replace("décision", "approved"))).toContain("approvedFrom");
  });

  test("an exempt rule with two kinds of predicate is ok:false", () => {
    const text = VALID.replace(
      '    author: "dependabot[bot]"',
      '    author: "dependabot[bot]"\n    titlePrefix: "Bump "',
    );
    const why = reason(text);
    expect(why).toContain("dependabot");
    expect(why).toContain("exactly one");
  });

  test("an empty owners list is ok:false", () => {
    expect(
      reason(VALID.replace("  - constantin-jais\n", "").replace("owners:", "owners: []")),
    ).toContain("owners");
  });

  test("an unknown root key is ok:false and names the key", () => {
    expect(reason(`${VALID}approvers: [x]\n`)).toContain("approvers");
  });

  test("a missing root key is ok:false and names the key", () => {
    expect(reason(`${HEAD}owners: [a]\n`)).toContain("exempt");
    expect(reason("exempt: {}\nowners: [a]\n")).toContain("approvedFrom");
    expect(reason(`${HEAD}exempt: {}\n`)).toContain("owners");
  });

  test("owners that is not an array is ok:false", () => {
    expect(reason(withOwners("constantin-jais"))).toContain("owners");
  });

  test("owners containing a non-string or empty entry is ok:false", () => {
    expect(reason(withOwners("[a, 3]"))).toContain("owners");
    expect(reason(withOwners('[a, ""]'))).toContain("owners");
    expect(reason(withOwners("[a, null]"))).toContain("owners");
  });

  test("an exempt that is not an object is ok:false", () => {
    expect(reason(`${HEAD}exempt: [a]\nowners: [a]\n`)).toContain("exempt");
    expect(reason(`${HEAD}exempt: nope\nowners: [a]\n`)).toContain("exempt");
  });

  test("an exempt rule with no predicate is ok:false", () => {
    expect(reason(withRules("  empty:\n"))).toContain("empty");
  });

  test("an exempt rule with an unknown predicate key is ok:false and names the key", () => {
    const why = reason(withRules("  r:\n    branch: main\n"));
    expect(why).toContain("branch");
    expect(why).toContain("r");
  });

  test("an empty or mistyped predicate is ok:false", () => {
    for (const body of ['author: ""', 'titlePrefix: ""', "author: 7", "titlePrefix: [x]"]) {
      expect(reason(withRules(`  r:\n    ${body}\n`))).toContain("r");
    }
  });

  test("paths must be a non-empty array of non-empty strings", () => {
    for (const body of [
      "paths: []",
      "paths: docs/**",
      'paths: [""]',
      "paths: [1]",
      "paths: [a, null]",
    ]) {
      expect(reason(withRules(`  r:\n    ${body}\n`))).toContain("paths");
    }
  });

  test("reserved names are ok:false", () => {
    for (const name of ["constructor", "prototype"]) {
      const why = reason(withRules(`  ${name}:\n    author: x\n`));
      expect(why).toContain(name);
      expect(why).toContain("reserved");
    }
    expect(reason(withRules("  __proto__:\n    author: x\n"))).toContain("__proto__");
    expect(reason(withRules('  "__proto__":\n    author: x\n'))).toContain("__proto__");
  });
});

describe("duplicate keys are ok:false (naming the key and both lines)", () => {
  test("a repeated root key", () => {
    const owners = reason(`${VALID}owners:\n  - other\n`);
    expect(owners).toContain("duplicate key");
    expect(owners).toContain('"owners"');
    expect(owners).toContain("line 5");
    expect(owners).toContain("line 7");
    const approved = reason(`${VALID}approvedFrom: proposition\n`);
    expect(approved).toContain('"approvedFrom"');
    expect(approved).toContain("line 1");
    expect(approved).toContain("line 7");
  });

  test("a repeated class name under exempt", () => {
    const why = reason(withRules("  r:\n    author: x\n  r:\n    titlePrefix: y\n"));
    expect(why).toContain("duplicate key");
    expect(why).toContain('"r"');
    expect(why).toContain("line 3");
    expect(why).toContain("line 5");
  });

  test("a repeated predicate key inside one rule", () => {
    const why = reason(withRules("  r:\n    author: x\n    author: y\n"));
    expect(why).toContain("duplicate key");
    expect(why).toContain('"author"');
    expect(why).toContain("line 4");
    expect(why).toContain("line 5");
  });

  test("the same predicate key in two different rules is not a duplicate", () => {
    const text = withRules(
      '  one:\n    author: x\n  # a comment\n  two:\n    author: "y # not a comment"\n',
    );
    expect(loadWorkPackagePolicy(text)).toEqual({
      ok: true,
      value: {
        approvedFrom: "décision",
        exempt: { one: { author: "x" }, two: { author: "y # not a comment" } },
        owners: ["a"],
      },
    });
  });

  test("a repeated key in a flow mapping is refused as a flow mapping", () => {
    const why = reason(withRules('  revert: {titlePrefix: "A", titlePrefix: "B"}\n'));
    expect(why).toContain("flow mapping");
    expect(why).toContain("revert");
    expect(reason(`${HEAD}exempt: {r: {author: x, author: y}}\nowners: [a]\n`)).toContain(
      "flow mapping",
    );
    expect(reason("{approvedFrom: proposition, approvedFrom: proposition}\n")).toContain("root");
  });

  test("a quoted spelling of a key is refused, so it cannot hide a duplicate", () => {
    expect(reason(`${VALID}"owners": [z]\n`)).toContain("quoted");
    expect(reason(`${VALID}'owners': [z]\n`)).toContain("single quote");
  });
});

describe("constructs the whitelist cannot read are ok:false (naming line and construct)", () => {
  test("a merge key", () => {
    const why = reason(withRules("  r:\n    <<: {author: x}\n"));
    expect(why).toContain("merge key");
    expect(why).toContain("<<");
    expect(why).toContain("line 4");
  });

  test("an anchor", () => {
    const why = reason(withRules("  p: &p\n    author: x\n"));
    expect(why).toContain("anchor");
    expect(why).toContain("&p");
  });

  test("an alias", () => {
    const why = reason(withRules("  p:\n    author: x\n  s: *p\n"));
    expect(why).toContain("alias");
    expect(why).toContain("*p");
  });

  test("anchors and aliases inside lists", () => {
    expect(reason(withOwners("[*a]"))).toContain("alias");
    expect(reason(`${HEAD}exempt: {}\nowners:\n  - &a x\n  - *a\n`)).toContain("anchor");
  });

  test("a tag", () => {
    expect(reason(withRules("  r:\n    author: !!str x\n"))).toContain("tag");
  });

  test("a flow mapping anywhere but `exempt: {}`", () => {
    expect(reason(withRules("  r: {author: &a x}\n"))).toContain("flow mapping");
    expect(reason(withRules("  r: {author: *a}\n"))).toContain("flow mapping");
    expect(reason(withRules("  r:\n    author: {a: b}\n"))).toContain("flow mapping");
    expect(reason(`${HEAD}exempt: {}\nowners: {a: b}\n`)).toContain("flow mapping");
    expect(reason("approvedFrom: {}\nexempt: {}\nowners: [a]\n")).toContain("flow mapping");
    expect(reason(`${HEAD}exempt: { }\nowners: [a]\n`)).toContain("exempt");
  });

  test("a block scalar", () => {
    expect(reason(`${HEAD}exempt: {}\nowners: |\n  a\n`)).toContain("block scalar");
    expect(reason(withRules("  r:\n    author: >\n      x\n"))).toContain("block scalar");
  });

  test("an explicit key", () => {
    expect(reason(`${HEAD}exempt: {}\nowners: [a]\n? x\n: y\n`)).toContain("explicit key");
  });

  test("a multi-line scalar", () => {
    expect(reason(withRules('  r:\n    author: "abc\n      def"\n'))).toContain("line 4");
    expect(reason(withRules("  r:\n    author: abc\n      def\n"))).toContain("line 5");
  });

  test("a quoted look-alike is a plain string, not a construct", () => {
    expect(loadWorkPackagePolicy(withRules('  r:\n    author: "&p *p <<"\n')).ok).toBe(true);
  });

  test("a trailing comment", () => {
    expect(reason(withRules("  r:\n    author: x # c\n"))).toContain("trailing comment");
    expect(reason(withOwners("[a] # c"))).toContain("trailing comment");
    expect(reason(withRules('  r:\n    author: "x" # c\n'))).toContain("trailing comment");
  });

  test("document markers", () => {
    expect(reason(`---\n${VALID}`)).toContain("document marker");
    expect(reason(`${VALID}...\n`)).toContain("document marker");
    expect(reason(`${VALID}---\nx: 1\n`)).toContain("document marker");
  });

  test("a tab", () => {
    expect(reason(`${HEAD}exempt: {}\nowners:\t[a]\n`)).toContain("tab");
    expect(reason(`${VALID}# a\tcomment\n`)).toContain("tab");
  });

  test("a backslash and a single quote, even inside quotes or comments", () => {
    expect(reason(withRules('  r:\n    author: "a\\b"\n'))).toContain("backslash");
    expect(reason(`${VALID}# a \\ comment\n`)).toContain("backslash");
    expect(reason(withRules('  r:\n    author: "it\'s"\n'))).toContain("single quote");
    expect(reason(`${VALID}# it's\n`)).toContain("single quote");
  });

  test("YAML escapes in a quoted key cannot hide a duplicate (round 2 probes)", () => {
    expect(
      reason(
        'approvedFrom: "décision"\nexempt: {}\nowners: [a]\n"\\x61pprovedFrom": proposition\n',
      ),
    ).toContain("backslash");
    expect(
      reason('approvedFrom: "décision"\nexempt: {}\nowners: [a]\n"o\\x77ners": [b]\n'),
    ).toContain("backslash");
    expect(
      reason('approvedFrom: décision\nexempt: {}\nowners: [a]\n"\\x61pprovedFrom": proposition\n'),
    ).toContain("backslash");
  });

  test("invalid YAML and a non-mapping root", () => {
    expect(reason("approvedFrom: [unterminated\n")).toContain("YAML");
    expect(reason("- a\n- b\n")).toContain("root");
    expect(reason("just a string\n")).toContain("root");
    expect(reason("")).toContain("root");
  });

  test("a bare CR line ending", () => {
    expect(
      reason('approvedFrom: "décision"\rexempt: {}\rowners: [a]\rapprovedFrom: proposition\r'),
    ).toContain("bare CR");
    expect(reason(`${HEAD}exempt: {}\rowners: [a]\n`)).toContain("bare CR");
  });
});

describe("layout is exactly two spaces per level, without trailing spaces", () => {
  test("an odd indentation", () => {
    expect(reason(withRules("   r:\n    author: x\n"))).toContain("indentation");
  });

  test("a rule indented four spaces under exempt", () => {
    expect(reason(withRules("    r:\n      author: x\n"))).toContain("indentation");
  });

  test("a nested line under a scalar or an inline list", () => {
    expect(reason(`${HEAD}  - x\nexempt: {}\nowners: [a]\n`)).toContain("line 2");
    expect(reason(`${HEAD}exempt: {}\nowners: [a]\n  - b\n`)).toContain("line 4");
  });

  test("a list item at the indent of its parent", () => {
    expect(reason(`${HEAD}exempt: {}\nowners:\n- a\n`)).toContain("line 4");
  });

  test("a trailing space", () => {
    expect(reason(`approvedFrom: "décision" \nexempt: {}\nowners: [a]\n`)).toContain(
      "trailing space",
    );
  });

  test("a whitespace-only line", () => {
    expect(reason(`${HEAD}  \nexempt: {}\nowners: [a]\n`)).toContain("trailing space");
  });
});

describe("rule names and keys that YAML resolves to the same key are ok:false", () => {
  test("1 and 0x1 (both the integer 1)", () => {
    const why = reason(withRules("  1:\n    author: x\n  0x1:\n    titlePrefix: y\n"));
    expect(why).toContain('"1"');
  });

  test("null and ~ (both null)", () => {
    expect(reason(withRules("  null:\n    author: x\n  ~:\n    titlePrefix: y\n"))).toContain(
      '"null"',
    );
    expect(reason(withRules("  ~:\n    author: x\n"))).toContain('"~"');
  });

  test("true and True (both the boolean true)", () => {
    expect(reason(withRules("  true:\n    author: x\n  True:\n    titlePrefix: y\n"))).toContain(
      '"true"',
    );
  });

  test.each([
    "yes",
    "no",
    "on",
    "off",
    "y",
    "n",
    "null",
    "true",
    "false",
  ])("the YAML word %p is not a rule name", (name) => {
    const why = reason(withRules(`  ${name}:\n    author: x\n`));
    expect(why).toContain(`"${name}"`);
    expect(why).toContain("rule name");
  });

  test("the same words are refused as root keys too", () => {
    expect(reason(`${VALID}null: 1\n`)).toContain('"null"');
    expect(reason(`${VALID}yes: 1\n`)).toContain('"yes"');
  });

  test.each([
    "Revert",
    "docs_only",
    "docs.only",
    "-x",
    "a b",
    "1x",
  ])("the rule name %p is refused", (name) => {
    const why = reason(withRules(`  ${name}:\n    author: x\n`));
    expect(why).toContain(name);
    expect(why).toContain("rule name");
  });

  test("a quoted rule name is refused", () => {
    const why = reason(withRules('  "revert":\n    author: x\n'));
    expect(why).toContain("quoted");
    expect(why).toContain("rule name");
  });

  test("the shipped rule names pass", async () => {
    const result = loadWorkPackagePolicy(await Bun.file(SHIPPED).text());
    expect(result.ok && Object.keys(result.value.exempt)).toEqual([
      "dependabot",
      "docs-only",
      "revert",
    ]);
  });
});

describe("owners must be GitHub logins", () => {
  test.each([
    ['"@Foo"', "@Foo"],
    ['"Foo Bar"', "Foo Bar"],
    ['"-x"', "-x"],
    ['"x-"', "x-"],
    [`"${"a".repeat(40)}"`, "a".repeat(40)],
    ['"a_b"', "a_b"],
  ])("%s is refused and named", (yamlValue, entry) => {
    const why = reason(withOwners(`[${yamlValue}]`));
    expect(why).toContain("owners");
    expect(why).toContain(entry);
  });

  test("a duplicate compared case-insensitively is refused, value kept as written elsewhere", () => {
    const why = reason(withOwners("[A, a]"));
    expect(why).toContain("duplicate");
    expect(why).toContain('"a"');
  });

  test("a valid mixed-case login passes and is stored as written", () => {
    expect(loadWorkPackagePolicy(withOwners(`[Foo-Bar9, ${"a".repeat(39)}, x]`))).toEqual({
      ok: true,
      value: {
        approvedFrom: "décision",
        exempt: {},
        owners: ["Foo-Bar9", "a".repeat(39), "x"],
      },
    });
  });
});

describe("whitespace-only strings and duplicate globs are ok:false", () => {
  test.each(["author", "titlePrefix"])("a whitespace-only %s", (key) => {
    const why = reason(withRules(`  r:\n    ${key}: "   "\n`));
    expect(why).toContain("r");
    expect(why).toContain(key);
  });

  test("a whitespace-only paths entry", () => {
    expect(reason(withRules('  r:\n    paths: ["docs/**", "  "]\n'))).toContain("paths");
  });

  test("a whitespace-only owner", () => {
    expect(reason(withOwners('["  "]'))).toContain("owners");
  });

  test("a duplicate paths glob names the entry", () => {
    const why = reason(withRules('  r:\n    paths: ["docs/**", "*.md", "docs/**"]\n'));
    expect(why).toContain("duplicate");
    expect(why).toContain("docs/**");
  });

  test("block-style paths are read like the one-line form", () => {
    expect(
      loadWorkPackagePolicy(withRules('  r:\n    paths:\n      - "a/**"\n      - b\n')),
    ).toEqual({
      ok: true,
      value: {
        approvedFrom: "décision",
        exempt: { r: { paths: ["a/**", "b"] } },
        owners: ["a"],
      },
    });
  });

  test("a trailing space is kept in the stored value", () => {
    expect(loadWorkPackagePolicy(withRules('  revert:\n    titlePrefix: "Revert "\n'))).toEqual({
      ok: true,
      value: {
        approvedFrom: "décision",
        exempt: { revert: { titlePrefix: "Revert " } },
        owners: ["a"],
      },
    });
  });
});
