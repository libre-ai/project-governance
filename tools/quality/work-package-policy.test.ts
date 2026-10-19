import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadWorkPackagePolicy } from "./work-package-policy";

const SHIPPED = join(import.meta.dir, "..", "..", "ecosystem", "work-package-policy.v1.yaml");

const VALID = [
  "approvedFrom: décision",
  "exempt:",
  "  dependabot:",
  '    author: "dependabot[bot]"',
  "owners:",
  "  - constantin-jais",
  "",
].join("\n");

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

  test("invalid YAML is ok:false", () => {
    expect(reason("approvedFrom: [unterminated\n")).toContain("YAML");
  });

  test("a non-object root is ok:false", () => {
    expect(reason("- a\n- b\n")).toContain("root");
    expect(reason("just a string\n")).toContain("root");
    expect(reason("")).toContain("root");
  });

  test("an unknown root key is ok:false and names the key", () => {
    expect(reason(`${VALID}approvers: [x]\n`)).toContain("approvers");
  });

  test("a missing root key is ok:false and names the key", () => {
    expect(reason("approvedFrom: décision\nowners: [a]\n")).toContain("exempt");
    expect(reason("exempt: {}\nowners: [a]\n")).toContain("approvedFrom");
    expect(reason("approvedFrom: décision\nexempt: {}\n")).toContain("owners");
  });

  test("owners that is not an array is ok:false", () => {
    expect(reason("approvedFrom: décision\nexempt: {}\nowners: constantin-jais\n")).toContain(
      "owners",
    );
  });

  test("owners containing a non-string or empty entry is ok:false", () => {
    expect(reason("approvedFrom: décision\nexempt: {}\nowners: [a, 3]\n")).toContain("owners");
    expect(reason('approvedFrom: décision\nexempt: {}\nowners: [a, ""]\n')).toContain("owners");
    expect(reason("approvedFrom: décision\nexempt: {}\nowners: [a, null]\n")).toContain("owners");
  });

  test("an exempt that is not an object is ok:false", () => {
    expect(reason("approvedFrom: décision\nexempt: [a]\nowners: [a]\n")).toContain("exempt");
    expect(reason("approvedFrom: décision\nexempt: nope\nowners: [a]\n")).toContain("exempt");
  });

  test("an exempt rule with no predicate is ok:false", () => {
    expect(reason("approvedFrom: décision\nexempt:\n  empty: {}\nowners: [a]\n")).toContain(
      "empty",
    );
  });

  test("an exempt rule with an unknown predicate key is ok:false and names the key", () => {
    const text = "approvedFrom: décision\nexempt:\n  r:\n    branch: main\nowners: [a]\n";
    const why = reason(text);
    expect(why).toContain("branch");
    expect(why).toContain("r");
  });

  test("an exempt rule that is not an object is ok:false", () => {
    expect(reason("approvedFrom: décision\nexempt:\n  r: dependabot\nowners: [a]\n")).toContain(
      "r",
    );
  });

  test("an empty predicate string is ok:false", () => {
    for (const body of ['author: ""', 'titlePrefix: ""', "author: 7", "titlePrefix: [x]"]) {
      const text = `approvedFrom: décision\nexempt:\n  r:\n    ${body}\nowners: [a]\n`;
      expect(reason(text)).toContain("r");
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
      const text = `approvedFrom: décision\nexempt:\n  r:\n    ${body}\nowners: [a]\n`;
      expect(reason(text)).toContain("paths");
    }
  });

  test("an empty exempt object is valid (no exemption)", () => {
    expect(loadWorkPackagePolicy("approvedFrom: proposition\nexempt: {}\nowners: [a]\n")).toEqual({
      ok: true,
      value: { approvedFrom: "proposition", exempt: {}, owners: ["a"] },
    });
  });
});

// Fix round 1: the loader must fail closed on ambiguity. YAML parsers resolve
// ambiguous input silently (last duplicate key wins, `<<` merges, aliases
// copy), so each site below used to return ok:true with a value the author
// did not plainly write.
const HEAD = "approvedFrom: décision\n";

function withRules(rules: string, owners = "[a]"): string {
  return `${HEAD}exempt:\n${rules}owners: ${owners}\n`;
}

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

  test("a repeated key in a flow mapping", () => {
    const why = reason(withRules('  revert: {titlePrefix: "A", titlePrefix: "B"}\n'));
    expect(why).toContain("duplicate key");
    expect(why).toContain('"titlePrefix"');
    expect(why).toContain("line 3");
  });

  test("a repeated key in a nested flow mapping and in a flow root", () => {
    expect(reason(`${HEAD}exempt: {r: {author: x, author: y}}\nowners: [a]\n`)).toContain(
      '"author"',
    );
    expect(reason("{approvedFrom: décision, approvedFrom: proposition}\n")).toContain(
      '"approvedFrom"',
    );
  });

  test("quoting does not hide a repeated key", () => {
    expect(reason(`${VALID}"owners": [z]\n`)).toContain('"owners"');
    expect(reason(`${VALID}'owners': [z]\n`)).toContain('"owners"');
  });

  test("the same key in two different mappings is not a duplicate", () => {
    const text = withRules(
      '  one:\n    author: x # a comment with a: colon and "quote\n  two:\n    author: "y # not a comment"\n',
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
});

describe("reserved names are ok:false", () => {
  test("__proto__, constructor and prototype as a rule name", () => {
    for (const name of ["__proto__", "constructor", "prototype"]) {
      const why = reason(withRules(`  "${name}":\n    author: x\n`));
      expect(why).toContain(name);
      expect(why).toContain("reserved");
    }
  });

  test("the exempt object has no prototype to pollute", () => {
    const result = loadWorkPackagePolicy(VALID);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(Object.getPrototypeOf(result.value.exempt)).toBeNull();
  });
});

describe("merge keys, anchors, aliases and tags are ok:false (naming the construct)", () => {
  test("a merge key", () => {
    const why = reason(withRules("  r:\n    <<: {author: x}\n"));
    expect(why).toContain("merge key");
    expect(why).toContain("<<");
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

  test("anchors and aliases inside flow collections and sequences", () => {
    expect(reason(withRules("  r: {author: &a x}\n"))).toContain("anchor");
    expect(reason(withRules("  r: {author: *a}\n"))).toContain("alias");
    expect(reason(`${HEAD}exempt: {}\nowners: [*a]\n`)).toContain("alias");
    expect(reason(`${HEAD}exempt: {}\nowners:\n  - &a x\n  - *a\n`)).toContain("anchor");
  });

  test("a tag", () => {
    expect(reason(withRules("  r:\n    author: !!str x\n"))).toContain("tag");
  });

  test("quoted look-alikes are plain strings, not constructs", () => {
    const text = withRules('  r:\n    author: "&p *p <<"\n');
    expect(loadWorkPackagePolicy(text).ok).toBe(true);
  });
});

describe("owners must be GitHub logins", () => {
  const withOwners = (owners: string): string => `${HEAD}exempt: {}\nowners: ${owners}\n`;

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
    expect(reason(`${HEAD}exempt: {}\nowners: ["  "]\n`)).toContain("owners");
  });

  test("a duplicate paths glob names the entry", () => {
    const why = reason(withRules('  r:\n    paths: ["docs/**", "*.md", "docs/**"]\n'));
    expect(why).toContain("duplicate");
    expect(why).toContain("docs/**");
  });

  test("a trailing space is kept in the stored value", () => {
    const result = loadWorkPackagePolicy(withRules('  revert:\n    titlePrefix: "Revert "\n'));
    expect(result).toEqual({
      ok: true,
      value: {
        approvedFrom: "décision",
        exempt: { revert: { titlePrefix: "Revert " } },
        owners: ["a"],
      },
    });
  });
});
