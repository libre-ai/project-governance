import { describe, expect, test } from "bun:test";
import {
  type CommitDeclarations,
  type Declaration,
  evaluateWorkPackageLink,
  exemptionHolds,
  type Fact,
  type LinkPorts,
  type PrFacts,
  readDeclaration,
  type Trailer,
} from "./check-work-package-link";
import type { ExemptRule, WorkPackagePolicy } from "./work-package-policy";

const NO_BREAK_SPACE = String.fromCodePoint(0xa0);
const KELVIN_SIGN = String.fromCodePoint(0x212a);
// Line boundaries and invisible characters, built from code points so that the
// file itself carries none of them.
const LF: string = String.fromCodePoint(0x0a);
const CR: string = String.fromCodePoint(0x0d);
const NUL: string = String.fromCodePoint(0x00);
const NEXT_LINE: string = String.fromCodePoint(0x85);
const LINE_SEPARATOR: string = String.fromCodePoint(0x2028);
const PARAGRAPH_SEPARATOR: string = String.fromCodePoint(0x2029);
const ZERO_WIDTH_SPACE: string = String.fromCodePoint(0x200b);
const BYTE_ORDER_MARK: string = String.fromCodePoint(0xfeff);

const policy: WorkPackagePolicy = {
  approvedFrom: "décision",
  owners: ["constantin-jais"],
  exempt: Object.assign(Object.create(null) as Record<string, ExemptRule>, {
    dependabot: { author: "dependabot[bot]" },
    "docs-only": { paths: ["**/*.md", "docs/**"] },
    revert: { titlePrefix: "Revert " },
  }),
};

const pr = (overrides: Partial<PrFacts> = {}): PrFacts => ({
  repo: "libre-ai/project-governance",
  number: 7,
  title: "feat: something",
  author: "constantin-jais",
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  ...overrides,
});

const trailer = (key: string, value: string): Trailer => ({ key, value });
const commit = (sha: string, ...trailers: Trailer[]): CommitDeclarations => ({ sha, trailers });
const reasonOf = (declaration: Declaration): string =>
  declaration.kind === "invalid" ? declaration.reason : "";

const WP = "libre-ai/product-research#12 WP-3";
const WP_LINK: Declaration = {
  kind: "link",
  repo: "libre-ai/product-research",
  issue: 12,
  wp: "WP-3",
};

describe("readDeclaration", () => {
  test("one Work-package trailer is a link", () => {
    expect(readDeclaration([commit("c1", trailer("Work-package", WP))])).toEqual(WP_LINK);
  });

  test("one Exempt trailer is an exemption", () => {
    expect(readDeclaration([commit("c1", trailer("Exempt", "docs-only"))])).toEqual({
      kind: "exempt",
      cls: "docs-only",
    });
  });

  test("the same value on three commits is one declaration", () => {
    expect(
      readDeclaration([
        commit("c1", trailer("Work-package", WP)),
        commit("c2", trailer("Work-package", WP)),
        commit("c3", trailer("Signed-off-by", "A <a@example.org>"), trailer("Work-package", WP)),
      ]),
    ).toEqual(WP_LINK);
  });

  test("a declaration on only one commit of the range is enough", () => {
    expect(
      readDeclaration([
        commit("c1"),
        commit("c2", trailer("Signed-off-by", "A <a@example.org>")),
        commit("c3", trailer("Work-package", WP)),
      ]),
    ).toEqual(WP_LINK);
  });

  test("the same value repeated within one commit counts once", () => {
    expect(
      readDeclaration([commit("c1", trailer("Work-package", WP), trailer("Work-package", WP))]),
    ).toEqual(WP_LINK);
  });

  test("two distinct Work-package values are refused, naming both", () => {
    const declaration = readDeclaration([
      commit("c1", trailer("Work-package", "libre-ai/x#1 WP-1")),
      commit("c2", trailer("Work-package", "libre-ai/x#1 WP-2")),
    ]);
    expect(declaration.kind).toBe("invalid");
    expect(reasonOf(declaration)).toContain("2 distinct declaration trailers");
    expect(reasonOf(declaration)).toContain('"libre-ai/x#1 WP-1"');
    expect(reasonOf(declaration)).toContain('"libre-ai/x#1 WP-2"');
  });

  test("a Work-package and an Exempt are two distinct declarations", () => {
    const declaration = readDeclaration([
      commit("c1", trailer("Work-package", WP), trailer("Exempt", "revert")),
    ]);
    expect(declaration.kind).toBe("invalid");
    expect(reasonOf(declaration)).toContain("2 distinct declaration trailers");
    expect(reasonOf(declaration)).toContain(`work-package: "${WP}"`);
    expect(reasonOf(declaration)).toContain('exempt: "revert"');
  });

  test("two Exempt values are refused", () => {
    expect(
      readDeclaration([commit("c1", trailer("Exempt", "revert"), trailer("Exempt", "docs-only"))])
        .kind,
    ).toBe("invalid");
  });

  test.each([
    "work-package",
    "WORK-PACKAGE",
    "Work-Package",
    "wOrK-pAcKaGe",
  ])("the Work-package key is case-insensitive: %s", (key) => {
    expect(readDeclaration([commit("c1", trailer(key, WP))])).toEqual(WP_LINK);
  });

  test.each(["exempt", "EXEMPT", "Exempt"])("the Exempt key is case-insensitive: %s", (key) => {
    expect(readDeclaration([commit("c1", trailer(key, "revert"))])).toEqual({
      kind: "exempt",
      cls: "revert",
    });
  });

  test("the same value under keys that differ only in case is one declaration", () => {
    expect(
      readDeclaration([
        commit("c1", trailer("Work-package", WP)),
        commit("c2", trailer("WORK-PACKAGE", WP)),
      ]),
    ).toEqual(WP_LINK);
  });

  test("the same key with values that differ only in case is two declarations", () => {
    const declaration = readDeclaration([
      commit("c1", trailer("Work-package", "libre-ai/x#1 WP-1")),
      commit("c2", trailer("Work-package", "Libre-ai/x#1 WP-1")),
    ]);
    expect(declaration.kind).toBe("invalid");
    expect(reasonOf(declaration)).toContain("2 distinct declaration trailers");
  });

  test("a key folded into the keyword by Unicode case mapping is not the keyword", () => {
    // U+212A lower-cases to "k": a full lower-casing would read this as work-package.
    const declaration = readDeclaration([commit("c1", trailer(`Work-pac${KELVIN_SIGN}age`, WP))]);
    expect(reasonOf(declaration)).toContain("no declaration trailer");
  });

  test("a key that merely starts with the keyword is not the keyword", () => {
    expect(reasonOf(readDeclaration([commit("c1", trailer("Work-package-extra", WP))]))).toContain(
      "no declaration trailer",
    );
    expect(reasonOf(readDeclaration([commit("c1", trailer("Exempt-by", "revert"))]))).toContain(
      "no declaration trailer",
    );
  });

  test("unrelated trailers are ignored", () => {
    expect(
      readDeclaration([
        commit(
          "c1",
          trailer("Signed-off-by", "A <a@example.org>"),
          trailer("Reviewed-by", "B <b@example.org>"),
          trailer("Work-package", WP),
          trailer("Door", "two-way"),
        ),
      ]),
    ).toEqual(WP_LINK);
  });

  test("zero trailers is refused", () => {
    expect(reasonOf(readDeclaration([commit("c1"), commit("c2")]))).toBe(
      "no declaration trailer in the commits of the range",
    );
  });

  test("an empty range is refused the same way", () => {
    expect(reasonOf(readDeclaration([]))).toBe(
      "no declaration trailer in the commits of the range",
    );
  });

  test("only unrelated trailers is refused", () => {
    expect(
      reasonOf(readDeclaration([commit("c1", trailer("Signed-off-by", "A <a@example.org>"))])),
    ).toContain("no declaration trailer");
  });

  test.each([
    ["the template placeholder left as is", "<owner>/<repo>#<n> WP-<k>"],
    ["issue number zero", "libre-ai/x#0 WP-1"],
    ["issue number with a leading zero", "libre-ai/x#01 WP-1"],
    ["issue number beyond the safe integer range", "libre-ai/x#99999999999999999999 WP-1"],
    ["WP-0", "libre-ai/x#1 WP-0"],
    ["WP-01", "libre-ai/x#1 WP-01"],
    ["a lowercase WP prefix", "libre-ai/x#1 wp-1"],
    ["a mixed-case WP prefix", "libre-ai/x#1 Wp-1"],
    ["an extra space before WP", "libre-ai/x#1  WP-1"],
    ["a trailing space", "libre-ai/x#1 WP-1 "],
    ["a leading space", " libre-ai/x#1 WP-1"],
    ["a trailing token", "libre-ai/x#1 WP-1 done"],
    ["a missing owner", "x#1 WP-1"],
    ["a missing issue number", "libre-ai/x WP-1"],
    ["a missing work package", "libre-ai/x#1"],
    ["a dot repository name", "libre-ai/..#1 WP-1"],
    ["a nested path as repository", "libre-ai/x/y#1 WP-1"],
    ["a no-break space between the parts", `libre-ai/x#1${NO_BREAK_SPACE}WP-1`],
    ["an empty value", ""],
    ["a WP number of ten digits", "libre-ai/x#1 WP-1234567890"],
    ["a trailing line feed", `libre-ai/x#1 WP-1${LF}`],
    ["a line feed instead of the inner space", `libre-ai/x#1${LF}WP-1`],
    ["a line of junk before the value", `junk${LF}libre-ai/x#1 WP-1`],
    ["a line of junk after the value", `libre-ai/x#1 WP-1${LF}junk`],
    ["a second trailer after a line feed", `libre-ai/x#1 WP-1${LF}Exempt: revert`],
    ["a trailing NUL", `libre-ai/x#1 WP-1${NUL}`],
    ["a NUL inside the owner", `libre${NUL}ai/x#1 WP-1`],
    ["a trailing carriage return", `libre-ai/x#1 WP-1${CR}`],
    ["a carriage return before a second line", `libre-ai/x#1 WP-1${CR}junk`],
    ["a trailing U+2028 line separator", `libre-ai/x#1 WP-1${LINE_SEPARATOR}`],
    ["a trailing U+2029 paragraph separator", `libre-ai/x#1 WP-1${PARAGRAPH_SEPARATOR}`],
    ["a trailing U+0085 next line", `libre-ai/x#1 WP-1${NEXT_LINE}`],
    ["a zero-width space inside the owner", `libre${ZERO_WIDTH_SPACE}-ai/x#1 WP-1`],
    ["a trailing zero-width space", `libre-ai/x#1 WP-1${ZERO_WIDTH_SPACE}`],
    ["a leading byte order mark", `${BYTE_ORDER_MARK}libre-ai/x#1 WP-1`],
  ])("a malformed Work-package value is invalid: %s", (_label, value) => {
    const declaration = readDeclaration([commit("c1", trailer("Work-package", value))]);
    expect(declaration.kind).toBe("invalid");
  });

  test("a WP number of nine digits is the longest accepted", () => {
    expect(
      readDeclaration([commit("c1", trailer("Work-package", "libre-ai/x#1 WP-123456789"))]),
    ).toEqual({ kind: "link", repo: "libre-ai/x", issue: 1, wp: "WP-123456789" });
  });

  test("a malformed value names the offending text", () => {
    const declaration = readDeclaration([
      commit("c1", trailer("Work-package", "libre-ai/x#0 WP-1")),
    ]);
    expect(reasonOf(declaration)).toContain('"libre-ai/x#0 WP-1"');
  });

  test.each([
    ["an empty class", ""],
    ["a blank class", "  "],
    ["a class in capitals", "Docs-only"],
    ["a class with a space", "docs only"],
    ["a class with a trailing space", "docs-only "],
    ["a class with a leading space", " docs-only"],
    ["a class starting with a digit", "1st"],
    ["a prototype name", "__proto__"],
    ["a trailing line feed", `revert${LF}`],
    ["a line of junk before the class", `junk${LF}revert`],
    ["a line of junk after the class", `revert${LF}junk`],
    ["a second trailer after a line feed", `revert${LF}Work-package: libre-ai/x#1 WP-1`],
    ["a trailing NUL", `revert${NUL}`],
    ["a NUL inside the class", `re${NUL}vert`],
    ["a trailing carriage return", `revert${CR}`],
    ["a trailing U+2028 line separator", `revert${LINE_SEPARATOR}`],
    ["a trailing U+2029 paragraph separator", `revert${PARAGRAPH_SEPARATOR}`],
    ["a trailing U+0085 next line", `revert${NEXT_LINE}`],
    ["a zero-width space inside the class", `re${ZERO_WIDTH_SPACE}vert`],
    ["a trailing zero-width space", `revert${ZERO_WIDTH_SPACE}`],
    ["a leading byte order mark", `${BYTE_ORDER_MARK}revert`],
  ])("a malformed Exempt value is invalid: %s", (_label, value) => {
    expect(readDeclaration([commit("c1", trailer("Exempt", value))]).kind).toBe("invalid");
  });

  test("an empty Exempt class says it is empty", () => {
    expect(reasonOf(readDeclaration([commit("c1", trailer("Exempt", ""))]))).toContain("empty");
  });
});

describe("exemptionHolds", () => {
  const docsOnly = policy.exempt["docs-only"];

  test("docs-only holds when every changed file matches a glob", () => {
    const result = exemptionHolds("docs-only", docsOnly, pr(), ["README.md", "docs/a/b.txt"]);
    expect(result).toEqual({
      ok: true,
      note: 'all 2 changed file(s) match ["**/*.md","docs/**"] (class "docs-only")',
    });
  });

  test("docs-only fails when one changed file is outside the globs", () => {
    const result = exemptionHolds("docs-only", docsOnly, pr(), ["README.md", "src/a.ts"]);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("src/a.ts");
  });

  test("docs-only fails on an empty diff: nothing changed is not documentation only", () => {
    const result = exemptionHolds("docs-only", docsOnly, pr(), []);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("no changed file");
  });

  test("docs-only does not match a path that merely starts like a glob prefix", () => {
    expect(exemptionHolds("docs-only", docsOnly, pr(), ["docsx/a.ts"]).ok).toBe(false);
  });

  test("dependabot holds for the exact bot login", () => {
    const rule = policy.exempt.dependabot;
    expect(exemptionHolds("dependabot", rule, pr({ author: "dependabot[bot]" }), []).ok).toBe(true);
  });

  test("dependabot fails for a human author", () => {
    const rule = policy.exempt.dependabot;
    expect(exemptionHolds("dependabot", rule, pr({ author: "constantin-jais" }), []).ok).toBe(
      false,
    );
  });

  test("dependabot compares the login byte for byte, not case-insensitively", () => {
    const rule = policy.exempt.dependabot;
    expect(exemptionHolds("dependabot", rule, pr({ author: "Dependabot[bot]" }), []).ok).toBe(
      false,
    );
  });

  test("dependabot fails when the author is unknown", () => {
    const rule = policy.exempt.dependabot;
    expect(exemptionHolds("dependabot", rule, pr({ author: null }), []).ok).toBe(false);
  });

  test("dependabot does not trim the login", () => {
    const rule = policy.exempt.dependabot;
    expect(exemptionHolds("dependabot", rule, pr({ author: "dependabot[bot] " }), []).ok).toBe(
      false,
    );
  });

  test("revert holds for a title starting with the exact prefix", () => {
    const rule = policy.exempt.revert;
    expect(exemptionHolds("revert", rule, pr({ title: 'Revert "x"' }), []).ok).toBe(true);
  });

  test("revert fails for a lowercase title", () => {
    const rule = policy.exempt.revert;
    expect(exemptionHolds("revert", rule, pr({ title: 'revert "x"' }), []).ok).toBe(false);
  });

  test("revert fails when the prefix is not at the start of the title", () => {
    const rule = policy.exempt.revert;
    expect(exemptionHolds("revert", rule, pr({ title: ' Revert "x"' }), []).ok).toBe(false);
  });

  test("revert fails without the trailing space of the prefix", () => {
    const rule = policy.exempt.revert;
    expect(exemptionHolds("revert", rule, pr({ title: "Reverted x" }), []).ok).toBe(false);
  });

  test("an absent rule names the class", () => {
    const result = exemptionHolds("nonexistent", undefined, pr(), ["README.md"]);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("nonexistent");
  });
});

interface Spy {
  readonly trailerCalls: Array<[string, string]>;
  readonly diffCalls: Array<[string, string]>;
  readonly ports: LinkPorts;
}

const unused = (name: string) => async (): Promise<never> => {
  throw new Error(`port ${name} must not be called by the skeleton`);
};

function spyOn(
  commits: Fact<readonly CommitDeclarations[]>,
  changed: Fact<readonly string[]> = { ok: false, reason: "changedFiles must not be asked" },
): Spy {
  const trailerCalls: Array<[string, string]> = [];
  const diffCalls: Array<[string, string]> = [];
  const ports: LinkPorts = {
    readIssue: unused("readIssue"),
    readFileAt: unused("readFileAt"),
    isAncestorOfServedHead: unused("isAncestorOfServedHead"),
    commitTrailers: async (baseSha, headSha) => {
      trailerCalls.push([baseSha, headSha]);
      return commits;
    },
    changedFiles: async (baseSha, headSha) => {
      diffCalls.push([baseSha, headSha]);
      return changed;
    },
  };
  return { trailerCalls, diffCalls, ports };
}

const withCommits = (...commits: CommitDeclarations[]): Fact<readonly CommitDeclarations[]> => ({
  ok: true,
  value: commits,
});

describe("evaluateWorkPackageLink", () => {
  test("a well-formed link passes, prints its volume and reads no diff", async () => {
    const spy = spyOn(
      withCommits(
        commit("c1", trailer("Work-package", WP)),
        commit("c2", trailer("Work-package", WP)),
        commit("c3"),
      ),
    );
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.outcome).toBe("pass");
    expect(report.violations).toEqual([]);
    expect(spy.trailerCalls).toEqual([["a".repeat(40), "b".repeat(40)]]);
    // The link path reads no diff: asking for one would be a wasted, failable read.
    expect(spy.diffCalls).toEqual([]);
    expect(report.volumeSummary).toBe(
      `3 commit(s) examined; 2 declaration trailer pair(s) seen, 1 distinct; declaration read: Work-package: ${WP}; implicit exemption: no; 0 file(s) examined for an exemption`,
    );
  });

  test("an unreadable range is a violation naming the reason, never a pass", async () => {
    const spy = spyOn({ ok: false, reason: "git log failed: bad revision" });
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("git log failed: bad revision");
    expect(spy.diffCalls).toEqual([]);
  });

  test("an unreadable range is a violation even for an exempt author", async () => {
    const spy = spyOn({ ok: false, reason: "git log failed" });
    const report = await evaluateWorkPackageLink(
      pr({ author: "dependabot[bot]" }),
      policy,
      spy.ports,
    );
    expect(report.outcome).toBe("violations");
  });

  // A pull request always has at least one commit: an empty list can only be a
  // misread range, never "nothing to declare".
  const EMPTY_RANGE: string =
    "PR #7 — declaration: the range holds no commit: a pull request has at least one, so an empty list is a misread range";

  test("an empty range is a violation for an exempt author, not an implicit exemption", async () => {
    const spy: Spy = spyOn(withCommits());
    const report = await evaluateWorkPackageLink(
      pr({ author: "dependabot[bot]" }),
      policy,
      spy.ports,
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations).toEqual([EMPTY_RANGE]);
    expect(spy.diffCalls).toEqual([]);
    expect(report.volumeSummary).toBe("0 commit(s) examined: the range holds no commit");
  });

  test("an empty range is the same violation for a human author, not a missing declaration", async () => {
    const spy: Spy = spyOn(withCommits());
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.outcome).toBe("violations");
    expect(report.violations).toEqual([EMPTY_RANGE]);
    expect(spy.diffCalls).toEqual([]);
    expect(report.volumeSummary).toBe("0 commit(s) examined: the range holds no commit");
  });

  test("an empty author never matches a class whose author predicate is empty", async () => {
    const emptyAuthorClass: WorkPackagePolicy = {
      ...policy,
      exempt: Object.assign(Object.create(null) as Record<string, ExemptRule>, {
        ghost: { author: "" },
      }),
    };
    const spy: Spy = spyOn(withCommits(commit("c1")));
    const report = await evaluateWorkPackageLink(pr({ author: "" }), emptyAuthorClass, spy.ports);
    expect(report.outcome).toBe("violations");
    expect(report.violations).toEqual([
      "PR #7 — declaration: no declaration trailer in the commits of the range",
    ]);
    expect(report.volumeSummary).toContain("implicit exemption: no");
  });

  test("zero declarations from a human author is a violation", async () => {
    const spy = spyOn(withCommits(commit("c1", trailer("Signed-off-by", "A <a@example.org>"))));
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("no declaration trailer");
    expect(report.volumeSummary).toContain("0 declaration trailer pair(s) seen, 0 distinct");
    expect(report.volumeSummary).toContain("implicit exemption: no");
  });

  test("zero declarations from an unknown author is a violation", async () => {
    const spy = spyOn(withCommits(commit("c1")));
    const report = await evaluateWorkPackageLink(pr({ author: null }), policy, spy.ports);
    expect(report.outcome).toBe("violations");
  });

  test("zero declarations from the author of an author-based class is exempt (implicit)", async () => {
    const spy = spyOn(withCommits(commit("c1"), commit("c2")));
    const report = await evaluateWorkPackageLink(
      pr({ author: "dependabot[bot]" }),
      policy,
      spy.ports,
    );
    expect(report.outcome).toBe("pass");
    expect(report.checks.map((check) => check.note).join("\n")).toContain(
      "exempt (implicit: dependabot)",
    );
    expect(spy.diffCalls).toEqual([]);
    expect(report.volumeSummary).toBe(
      "2 commit(s) examined; 0 declaration trailer pair(s) seen, 0 distinct; declaration read: exempt (implicit: dependabot); implicit exemption: yes (dependabot); 0 file(s) examined for an exemption",
    );
  });

  test("the implicit exemption compares the author exactly", async () => {
    for (const author of [
      "Dependabot[bot]",
      "dependabot[bot] ",
      "dependabot",
      "dependabot[bot]x",
    ]) {
      const spy = spyOn(withCommits(commit("c1")));
      const report = await evaluateWorkPackageLink(pr({ author }), policy, spy.ports);
      expect(report.outcome).toBe("violations");
    }
  });

  test("the implicit exemption needs a class with an author predicate", async () => {
    const withoutAuthorClass: WorkPackagePolicy = {
      ...policy,
      exempt: Object.assign(Object.create(null) as Record<string, ExemptRule>, {
        revert: { titlePrefix: "Revert " },
      }),
    };
    const spy = spyOn(withCommits(commit("c1")));
    const report = await evaluateWorkPackageLink(
      pr({ author: "dependabot[bot]" }),
      withoutAuthorClass,
      spy.ports,
    );
    expect(report.outcome).toBe("violations");
  });

  test("the title and path classes never grant an implicit exemption", async () => {
    const spy = spyOn(withCommits(commit("c1")));
    const report = await evaluateWorkPackageLink(pr({ title: 'Revert "x"' }), policy, spy.ports);
    expect(report.outcome).toBe("violations");
  });

  test("an exempt author with a bad declaration is judged on the declaration", async () => {
    const spy = spyOn(withCommits(commit("c1", trailer("Work-package", "libre-ai/x#0 WP-1"))));
    const report = await evaluateWorkPackageLink(
      pr({ author: "dependabot[bot]" }),
      policy,
      spy.ports,
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("malformed Work-package value");
    expect(report.volumeSummary).toContain("implicit exemption: no");
  });

  test("an exempt author with a valid link is judged as a link, not as implicit", async () => {
    const spy = spyOn(withCommits(commit("c1", trailer("Work-package", WP))));
    const report = await evaluateWorkPackageLink(
      pr({ author: "dependabot[bot]" }),
      policy,
      spy.ports,
    );
    expect(report.outcome).toBe("pass");
    expect(report.volumeSummary).toContain(`declaration read: Work-package: ${WP}`);
    expect(report.volumeSummary).toContain("implicit exemption: no");
  });

  test("an exempt author with a declared exemption is still verified against the diff", async () => {
    const spy = spyOn(withCommits(commit("c1", trailer("Exempt", "docs-only"))), {
      ok: true,
      value: ["src/a.ts"],
    });
    const report = await evaluateWorkPackageLink(
      pr({ author: "dependabot[bot]" }),
      policy,
      spy.ports,
    );
    expect(report.outcome).toBe("violations");
    expect(spy.diffCalls).toHaveLength(1);
  });

  test("two distinct declarations are a violation naming both, and read no diff", async () => {
    const spy = spyOn(
      withCommits(
        commit("c1", trailer("Work-package", WP)),
        commit("c2", trailer("Exempt", "docs-only")),
      ),
    );
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("2 distinct declaration trailers");
    expect(report.volumeSummary).toContain("2 declaration trailer pair(s) seen, 2 distinct");
    expect(spy.diffCalls).toEqual([]);
  });

  test("a holding declared exemption passes and prints the files examined", async () => {
    const spy = spyOn(withCommits(commit("c1", trailer("Exempt", "docs-only"))), {
      ok: true,
      value: ["README.md", "docs/a.txt"],
    });
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.outcome).toBe("pass");
    expect(spy.diffCalls).toEqual([["a".repeat(40), "b".repeat(40)]]);
    expect(report.volumeSummary).toContain("declaration read: Exempt: docs-only");
    expect(report.volumeSummary).toContain("2 file(s) examined");
  });

  test("a declared exemption whose predicate is false is a violation", async () => {
    const spy = spyOn(withCommits(commit("c1", trailer("Exempt", "docs-only"))), {
      ok: true,
      value: ["src/a.ts"],
    });
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("src/a.ts");
  });

  test("a declared exemption class absent from the policy is a violation naming it", async () => {
    const spy = spyOn(withCommits(commit("c1", trailer("Exempt", "chore"))), {
      ok: true,
      value: ["README.md"],
    });
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("chore");
  });

  test("a declared exemption with an unreadable diff is a violation, never a pass", async () => {
    const spy = spyOn(withCommits(commit("c1", trailer("Exempt", "docs-only"))), {
      ok: false,
      reason: "git diff failed",
    });
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("git diff failed");
  });

  test("an unreadable diff is a violation even for an author-based declared exemption", async () => {
    const spy = spyOn(withCommits(commit("c1", trailer("Exempt", "dependabot"))), {
      ok: false,
      reason: "git diff failed",
    });
    const report = await evaluateWorkPackageLink(
      pr({ author: "dependabot[bot]" }),
      policy,
      spy.ports,
    );
    expect(report.outcome).toBe("violations");
  });

  test("a docs-only exemption on an empty diff is a violation", async () => {
    const spy = spyOn(withCommits(commit("c1", trailer("Exempt", "docs-only"))), {
      ok: true,
      value: [],
    });
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.outcome).toBe("violations");
  });

  test("a prototype-named class cannot reach an inherited rule", async () => {
    const inherited: WorkPackagePolicy = { ...policy, exempt: {} as Record<string, ExemptRule> };
    const spy = spyOn(withCommits(commit("c1", trailer("Exempt", "constructor"))), {
      ok: true,
      value: ["README.md"],
    });
    const report = await evaluateWorkPackageLink(pr(), inherited, spy.ports);
    expect(report.outcome).toBe("violations");
  });
});
