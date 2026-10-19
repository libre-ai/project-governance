import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type CommitDeclarations,
  type Declaration,
  evaluateWorkPackageLink,
  exemptionHolds,
  type Fact,
  type IssueFields,
  type IssueRead,
  type LinkPorts,
  type PrFacts,
  readDeclaration,
  readIssueFields,
  type Trailer,
} from "./check-work-package-link";
import type { Parsed } from "./prd-model";
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

// ---------------------------------------------------------------------------
// The world a `link` declaration is resolved against: the issue, the ancestry
// of the cited commit, and the two documents at that commit. Every port call
// is logged, so a test can say which reads happened and which did not.
// ---------------------------------------------------------------------------

const PRD_REPO = "libre-ai/product-research";
const PRD_SHA = "0123456789abcdef0123456789abcdef01234567";
const PRD_REF = `${PRD_REPO}@${PRD_SHA}:docs/prd.md`;

const issueBody = (prdRef: string = PRD_REF, wp: string = "WP-3"): string =>
  `### PRD-ref\n\n${prdRef}\n\n### WP\n\n${wp}`;

const TABLE_HEADER: string =
  "| WP | CA-n couverts | Périmètre (chemins, globs) | Vérification (commande) | Porte anticipée |\n" +
  "| --- | --- | --- | --- | --- |\n";

const prdText = (
  maturityLine: string = "Maturité du document : décision",
  rows: string = "| `WP-1` | `CA-1` | `docs/**` | `bun test` | `two-way` |\n| `WP-3` | `CA-1`, `CA-2` | `src/**` | `bun test` | `two-way` |\n",
): string => `# PRD\n\n${maturityLine}\n\n${TABLE_HEADER}${rows}`;

const CAHIER: string =
  "- CA-1 One. Validation : `bun test one`\n" +
  "- CA-2 Two. Validation : `bun test two`\n" +
  "- CA-9 Nine has no clause.\n";

const issueRead = (body: string): Fact<IssueRead> => ({
  ok: true,
  value: { body, labels: ["kind:work-package"], readyLabeledBy: null, bodyEditedAfterReady: false },
});

interface World {
  readonly commits: Fact<readonly CommitDeclarations[]>;
  readonly issue: Fact<IssueRead>;
  readonly ancestor: Fact<boolean>;
  readonly prd: Fact<string>;
  readonly cahier: Fact<string>;
  readonly changed: Fact<readonly string[]>;
}

interface LinkWorld {
  readonly calls: string[];
  readonly ports: LinkPorts;
}

function linkWorld(overrides: Partial<World> = {}): LinkWorld {
  const world: World = {
    commits: withCommits(commit("c1", trailer("Work-package", WP))),
    issue: issueRead(issueBody()),
    ancestor: { ok: true, value: true },
    prd: { ok: true, value: prdText() },
    cahier: { ok: true, value: CAHIER },
    changed: { ok: false, reason: "changedFiles must not be asked on the link path" },
    ...overrides,
  };
  const calls: string[] = [];
  const ports: LinkPorts = {
    commitTrailers: async (): Promise<Fact<readonly CommitDeclarations[]>> => {
      calls.push("commitTrailers");
      return world.commits;
    },
    readIssue: async (repo: string, number: number): Promise<Fact<IssueRead>> => {
      calls.push(`readIssue ${repo}#${number}`);
      return world.issue;
    },
    isAncestorOfServedHead: async (repo: string, sha: string): Promise<Fact<boolean>> => {
      calls.push(`isAncestorOfServedHead ${repo}@${sha}`);
      return world.ancestor;
    },
    readFileAt: async (repo: string, sha: string, path: string): Promise<Fact<string>> => {
      calls.push(`readFileAt ${repo}@${sha}:${path}`);
      if (path === "docs/prd.md") return world.prd;
      if (path === "docs/cahier-des-charges.md") return world.cahier;
      return { ok: false, reason: `no fixture for ${path}` };
    },
    changedFiles: async (): Promise<Fact<readonly string[]>> => {
      calls.push("changedFiles");
      return world.changed;
    },
  };
  return { calls, ports };
}

const CALL_TRAILERS = "commitTrailers";
const CALL_ISSUE = `readIssue ${PRD_REPO}#12`;
const CALL_ANCESTOR = `isAncestorOfServedHead ${PRD_REPO}@${PRD_SHA}`;
const CALL_PRD = `readFileAt ${PRD_REPO}@${PRD_SHA}:docs/prd.md`;
const CALL_CAHIER = `readFileAt ${PRD_REPO}@${PRD_SHA}:docs/cahier-des-charges.md`;
// Mutable only because `toEqual` does not accept a readonly array.
const FULL_RESOLUTION_CALLS: string[] = [
  CALL_TRAILERS,
  CALL_ISSUE,
  CALL_ANCESTOR,
  CALL_PRD,
  CALL_CAHIER,
];

const GREEN_RESOLUTION: string =
  `; resolution: issue ${PRD_REPO}#12 read; PRD ${PRD_REF}; maturity décision; ` +
  "work packages parsed: 2; criteria parsed: 3; criteria cited: 2";

describe("evaluateWorkPackageLink", () => {
  test("a well-formed link passes, prints its volume and reads no diff", async () => {
    const world: LinkWorld = linkWorld({
      commits: withCommits(
        commit("c1", trailer("Work-package", WP)),
        commit("c2", trailer("Work-package", WP)),
        commit("c3"),
      ),
    });
    const report = await evaluateWorkPackageLink(pr(), policy, world.ports);
    expect(report.outcome).toBe("pass");
    expect(report.violations).toEqual([]);
    // The link path reads no diff: asking for one would be a wasted, failable read.
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
    expect(report.volumeSummary).toBe(
      `3 commit(s) examined; 2 declaration trailer pair(s) seen, 1 distinct; declaration read: Work-package: ${WP}; implicit exemption: no; 0 file(s) examined for an exemption${GREEN_RESOLUTION}`,
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
    const world: LinkWorld = linkWorld();
    const report = await evaluateWorkPackageLink(
      pr({ author: "dependabot[bot]" }),
      policy,
      world.ports,
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

const reasonOfFields = (parsed: Parsed<IssueFields>): string => (parsed.ok ? "" : parsed.reason);

describe("readIssueFields", () => {
  const FIELDS: IssueFields = {
    prdRef: { repo: PRD_REPO, sha: PRD_SHA, path: "docs/prd.md" },
    wp: "WP-3",
  };

  test("the body the work-package form produces is read", () => {
    expect(readIssueFields(issueBody())).toEqual({ ok: true, value: FIELDS });
  });

  test("CRLF line ends are read as LF", () => {
    expect(readIssueFields(issueBody().replaceAll(LF, `${CR}${LF}`))).toEqual({
      ok: true,
      value: FIELDS,
    });
  });

  test("one final line end is accepted", () => {
    expect(readIssueFields(`${issueBody()}${LF}`)).toEqual({ ok: true, value: FIELDS });
    expect(readIssueFields(`${issueBody()}${CR}${LF}`)).toEqual({ ok: true, value: FIELDS });
  });

  test("an owner, repository and WP at the limits of the trailer grammar are read", () => {
    const repo = "a/b.c_d-e";
    expect(readIssueFields(issueBody(`${repo}@${PRD_SHA}:docs/prd.md`, "WP-123456789"))).toEqual({
      ok: true,
      value: { prdRef: { repo, sha: PRD_SHA, path: "docs/prd.md" }, wp: "WP-123456789" },
    });
  });

  const EXPECTED_SEVEN = "expected exactly 7 lines";

  test.each([
    ["an empty body", "", 'issue body line 1 is "", expected "### PRD-ref"'],
    [
      "a body without the PRD-ref section",
      "### WP\n\nWP-3",
      'issue body line 1 is "### WP", expected "### PRD-ref"',
    ],
    [
      "text before the first section",
      `Intro\n\n${issueBody()}`,
      'issue body line 1 is "Intro", expected "### PRD-ref"',
    ],
    [
      "text between the sections",
      `### PRD-ref\n\n${PRD_REF}\n\nnote\n\n### WP\n\nWP-3`,
      'issue body line 5 is "note", expected "### WP"',
    ],
    [
      "text after the last section",
      `${issueBody()}\n\nmore`,
      "issue body has 9 lines, expected exactly 7: nothing may follow the WP value",
    ],
    [
      "two final line ends",
      `${issueBody()}\n\n`,
      "issue body has 8 lines, expected exactly 7: nothing may follow the WP value",
    ],
    [
      "an HTML comment after the last section",
      `${issueBody()}\n<!-- note -->`,
      "issue body has 8 lines, expected exactly 7: nothing may follow the WP value",
    ],
    [
      "the sections in reverse order",
      `### WP\n\nWP-3\n\n### PRD-ref\n\n${PRD_REF}`,
      'issue body line 1 is "### WP", expected "### PRD-ref"',
    ],
    [
      "a repeated section",
      `${issueBody()}\n\n### WP\n\nWP-3`,
      "issue body has 11 lines, expected exactly 7: nothing may follow the WP value",
    ],
    [
      "a value on two lines",
      `### PRD-ref\n\n${PRD_REF}\nsecond\n\n### WP\n\nWP-3`,
      'issue body line 4 is "second", expected an empty line',
    ],
    [
      "a body cut after the PRD-ref value",
      `### PRD-ref\n\n${PRD_REF}`,
      `issue body ends after line 3, ${EXPECTED_SEVEN}`,
    ],
    [
      "a heading in lower case",
      issueBody().replace("### PRD-ref", "### prd-ref"),
      'issue body line 1 is "### prd-ref", expected "### PRD-ref"',
    ],
    [
      "a heading with a trailing space",
      issueBody().replace("### WP", "### WP "),
      'issue body line 5 is "### WP ", expected "### WP"',
    ],
    [
      "a heading with a trailing tab",
      issueBody().replace("### WP", "### WP\t"),
      'issue body line 5 is "### WP\\t", expected "### WP"',
    ],
    [
      "a blank line holding a space",
      `### PRD-ref\n \n${PRD_REF}\n\n### WP\n\nWP-3`,
      'issue body line 2 is " ", expected an empty line',
    ],
    [
      "a leading byte order mark",
      `${BYTE_ORDER_MARK}${issueBody()}`,
      `issue body line 1 is "${BYTE_ORDER_MARK}### PRD-ref", expected "### PRD-ref"`,
    ],
    [
      "a bare carriage return inside a heading",
      // Not before the LF: a CR there is a CRLF line end, which is accepted.
      issueBody().replace("### WP", `### ${CR}WP`),
      `issue body line 5 is "### \\rWP", expected "### WP"`,
    ],
    [
      "an empty PRD-ref value",
      `### PRD-ref\n\n\n\n### WP\n\nWP-3`,
      'PRD-ref "" is not <owner>/<repo>@<40 hex>:docs/prd.md',
    ],
    [
      "the form's empty-field marker as PRD-ref",
      issueBody("_No response_"),
      'PRD-ref "_No response_" is not <owner>/<repo>@<40 hex>:docs/prd.md',
    ],
    [
      "the form's empty-field marker as WP",
      issueBody(PRD_REF, "_No response_"),
      'WP "_No response_" is not WP-<k> with <k> a positive integer of at most nine digits, without a leading zero',
    ],
    [
      "a PRD-ref without a commit",
      issueBody(`${PRD_REPO}:docs/prd.md`),
      `PRD-ref "${PRD_REPO}:docs/prd.md" is not <owner>/<repo>@<40 hex>:docs/prd.md`,
    ],
    [
      "a PRD-ref without a path",
      issueBody(`${PRD_REPO}@${PRD_SHA}`),
      `PRD-ref "${PRD_REPO}@${PRD_SHA}" is not <owner>/<repo>@<40 hex>:docs/prd.md`,
    ],
    [
      "a short commit",
      issueBody(`${PRD_REPO}@0123456:docs/prd.md`),
      'PRD-ref commit "0123456" is not a full commit of 40 lowercase hexadecimal characters',
    ],
    [
      "an uppercase commit",
      issueBody(`${PRD_REPO}@${PRD_SHA.toUpperCase()}:docs/prd.md`),
      `PRD-ref commit "${PRD_SHA.toUpperCase()}" is not a full commit of 40 lowercase hexadecimal characters`,
    ],
    [
      "a symbolic revision",
      issueBody(`${PRD_REPO}@main:docs/prd.md`),
      'PRD-ref commit "main" is not a full commit of 40 lowercase hexadecimal characters',
    ],
    [
      "a path other than docs/prd.md",
      issueBody(`${PRD_REPO}@${PRD_SHA}:docs/other.md`),
      'PRD-ref path "docs/other.md" is not "docs/prd.md"',
    ],
    [
      "a path differing only in case",
      issueBody(`${PRD_REPO}@${PRD_SHA}:docs/PRD.md`),
      'PRD-ref path "docs/PRD.md" is not "docs/prd.md"',
    ],
    [
      "a path with a dot segment",
      issueBody(`${PRD_REPO}@${PRD_SHA}:./docs/prd.md`),
      'PRD-ref path "./docs/prd.md" is not "docs/prd.md"',
    ],
    [
      "a dot repository name",
      issueBody(`libre-ai/..@${PRD_SHA}:docs/prd.md`),
      'PRD-ref repository "libre-ai/.." is not <owner>/<repo>',
    ],
    [
      "a repository without an owner",
      issueBody(`product-research@${PRD_SHA}:docs/prd.md`),
      'PRD-ref repository "product-research" is not <owner>/<repo>',
    ],
    [
      "a zero-width space inside the repository",
      issueBody(`libre-ai/product${ZERO_WIDTH_SPACE}-research@${PRD_SHA}:docs/prd.md`),
      `PRD-ref repository "libre-ai/product${ZERO_WIDTH_SPACE}-research" is not <owner>/<repo>`,
    ],
    [
      "a PRD-ref with a trailing space",
      issueBody(`${PRD_REF} `),
      'PRD-ref path "docs/prd.md " is not "docs/prd.md"',
    ],
    [
      "a WP with a trailing space",
      issueBody(PRD_REF, "WP-3 "),
      'WP "WP-3 " is not WP-<k> with <k> a positive integer of at most nine digits, without a leading zero',
    ],
    [
      "WP-0",
      issueBody(PRD_REF, "WP-0"),
      'WP "WP-0" is not WP-<k> with <k> a positive integer of at most nine digits, without a leading zero',
    ],
    [
      "WP-01",
      issueBody(PRD_REF, "WP-01"),
      'WP "WP-01" is not WP-<k> with <k> a positive integer of at most nine digits, without a leading zero',
    ],
    [
      "a lowercase wp",
      issueBody(PRD_REF, "wp-3"),
      'WP "wp-3" is not WP-<k> with <k> a positive integer of at most nine digits, without a leading zero',
    ],
    [
      "a WP of ten digits",
      issueBody(PRD_REF, "WP-1234567890"),
      'WP "WP-1234567890" is not WP-<k> with <k> a positive integer of at most nine digits, without a leading zero',
    ],
    [
      "a WP followed by a zero-width space",
      issueBody(PRD_REF, `WP-3${ZERO_WIDTH_SPACE}`),
      `WP "WP-3${ZERO_WIDTH_SPACE}" is not WP-<k> with <k> a positive integer of at most nine digits, without a leading zero`,
    ],
  ])("refuses %s", (_label: string, body: string, reason: string) => {
    expect(reasonOfFields(readIssueFields(body))).toBe(reason);
  });

  // The norm is read by people and by the gate: its example of an issue body
  // must be read by the gate as the fields it shows.
  test("the issue-body example of the norm is read", async () => {
    const norm: string = await Bun.file(
      join(import.meta.dir, "../../docs/specifications/WORK-PACKAGES.md"),
    ).text();
    const blocks: RegExpMatchArray[] = [
      ...norm.matchAll(/^```text issue-body-example\n([\s\S]*?)\n```$/gm),
    ];
    expect(blocks).toHaveLength(1);
    expect(readIssueFields(blocks[0]?.[1] ?? "")).toEqual({
      ok: true,
      value: {
        prdRef: {
          repo: "libre-ai/ai-work-supervision",
          sha: "0123456789abcdef0123456789abcdef01234567",
          path: "docs/prd.md",
        },
        wp: "WP-1",
      },
    });
  });
});

describe("evaluateWorkPackageLink — resolution of a link", () => {
  const ISSUE_ITEM = `PR #7 — issue ${PRD_REPO}#12`;
  const PRD_ITEM = `PR #7 — PRD ${PRD_REPO}@${PRD_SHA}`;

  async function judge(world: LinkWorld): Promise<{
    readonly outcome: string;
    readonly violations: readonly string[];
    readonly volume: string | null;
  }> {
    const report = await evaluateWorkPackageLink(pr(), policy, world.ports);
    return { outcome: report.outcome, violations: report.violations, volume: report.volumeSummary };
  }

  test("every read valid: pass, with the volume of the resolution", async () => {
    const world: LinkWorld = linkWorld();
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([]);
    expect(verdict.outcome).toBe("pass");
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
    expect(verdict.volume).toBe(
      `1 commit(s) examined; 1 declaration trailer pair(s) seen, 1 distinct; declaration read: Work-package: ${WP}; implicit exemption: no; 0 file(s) examined for an exemption${GREEN_RESOLUTION}`,
    );
  });

  test("an unreadable issue is a violation and nothing further is read", async () => {
    const world: LinkWorld = linkWorld({ issue: { ok: false, reason: "HTTP 404" } });
    const verdict = await judge(world);
    expect(verdict.outcome).toBe("violations");
    expect(verdict.violations).toEqual([`${ISSUE_ITEM}: issue unreadable (HTTP 404)`]);
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE]);
    expect(verdict.volume).toContain(
      `; resolution: issue ${PRD_REPO}#12 unreadable; PRD not resolved; maturity not read; ` +
        "work packages parsed: not read; criteria parsed: not read; criteria cited: not read",
    );
  });

  test("an issue body without the PRD-ref section is a violation naming the cause", async () => {
    const world: LinkWorld = linkWorld({ issue: issueRead("### WP\n\nWP-3") });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      `${ISSUE_ITEM}: the issue body is not the work-package form: issue body line 1 is "### WP", expected "### PRD-ref"`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE]);
  });

  test("text before the form in the issue body is a violation", async () => {
    const world: LinkWorld = linkWorld({ issue: issueRead(`Intro\n\n${issueBody()}`) });
    expect((await judge(world)).violations).toEqual([
      `${ISSUE_ITEM}: the issue body is not the work-package form: issue body line 1 is "Intro", expected "### PRD-ref"`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE]);
  });

  test("text after the form in the issue body is a violation", async () => {
    const world: LinkWorld = linkWorld({ issue: issueRead(`${issueBody()}\n\nmore`) });
    expect((await judge(world)).violations).toEqual([
      `${ISSUE_ITEM}: the issue body is not the work-package form: issue body has 9 lines, expected exactly 7: nothing may follow the WP value`,
    ]);
  });

  test("text between the sections of the issue body is a violation", async () => {
    const world: LinkWorld = linkWorld({
      issue: issueRead(`### PRD-ref\n\n${PRD_REF}\n\nnote\n\n### WP\n\nWP-3`),
    });
    expect((await judge(world)).violations).toEqual([
      `${ISSUE_ITEM}: the issue body is not the work-package form: issue body line 5 is "note", expected "### WP"`,
    ]);
  });

  test("a short commit in PRD-ref is a violation", async () => {
    const world: LinkWorld = linkWorld({
      issue: issueRead(issueBody(`${PRD_REPO}@0123456:docs/prd.md`)),
    });
    expect((await judge(world)).violations).toEqual([
      `${ISSUE_ITEM}: the issue body is not the work-package form: PRD-ref commit "0123456" is not a full commit of 40 lowercase hexadecimal characters`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE]);
  });

  test("an uppercase commit in PRD-ref is a violation", async () => {
    const upper: string = PRD_SHA.toUpperCase();
    const world: LinkWorld = linkWorld({
      issue: issueRead(issueBody(`${PRD_REPO}@${upper}:docs/prd.md`)),
    });
    expect((await judge(world)).violations).toEqual([
      `${ISSUE_ITEM}: the issue body is not the work-package form: PRD-ref commit "${upper}" is not a full commit of 40 lowercase hexadecimal characters`,
    ]);
  });

  test("a PRD-ref path other than docs/prd.md is a violation", async () => {
    const world: LinkWorld = linkWorld({
      issue: issueRead(issueBody(`${PRD_REPO}@${PRD_SHA}:docs/other.md`)),
    });
    expect((await judge(world)).violations).toEqual([
      `${ISSUE_ITEM}: the issue body is not the work-package form: PRD-ref path "docs/other.md" is not "docs/prd.md"`,
    ]);
  });

  test("a WP of the issue different from the trailer is a violation naming both", async () => {
    const world: LinkWorld = linkWorld({ issue: issueRead(issueBody(PRD_REF, "WP-4")) });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      `${ISSUE_ITEM}: the issue projects WP-4, the trailer declares WP-3`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE]);
  });

  test("a cited commit that is not on the served branch is a violation", async () => {
    const world: LinkWorld = linkWorld({ ancestor: { ok: true, value: false } });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      `${PRD_ITEM}: the cited commit is not on the served branch of ${PRD_REPO}`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE, CALL_ANCESTOR]);
    expect(verdict.volume).toContain(
      `; resolution: issue ${PRD_REPO}#12 read; PRD ${PRD_REF}; maturity not read`,
    );
  });

  test("an ancestry that cannot be decided is a violation naming the reason", async () => {
    const world: LinkWorld = linkWorld({ ancestor: { ok: false, reason: "git fetch failed" } });
    expect((await judge(world)).violations).toEqual([
      `${PRD_ITEM}: ancestry of the cited commit unreadable (git fetch failed)`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE, CALL_ANCESTOR]);
  });

  test("an unreadable PRD is a violation naming its path, and the requirements are not read", async () => {
    const world: LinkWorld = linkWorld({ prd: { ok: false, reason: "path not in tree" } });
    expect((await judge(world)).violations).toEqual([
      `${PRD_ITEM}: docs/prd.md unreadable (path not in tree)`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE, CALL_ANCESTOR, CALL_PRD]);
  });

  test("an unreadable requirements specification is a violation naming its path", async () => {
    const world: LinkWorld = linkWorld({ cahier: { ok: false, reason: "path not in tree" } });
    expect((await judge(world)).violations).toEqual([
      `${PRD_ITEM}: docs/cahier-des-charges.md unreadable (path not in tree)`,
    ]);
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
  });

  test("a PRD at maturity proposition is not approved", async () => {
    const world: LinkWorld = linkWorld({
      prd: { ok: true, value: prdText("Maturité du document : proposition") },
    });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      `${PRD_ITEM}: maturity proposition is below décision: the PRD is not approved`,
    ]);
    expect(verdict.volume).toContain("; maturity proposition; work packages parsed: not read");
  });

  test("a PRD at maturity décision is approved", async () => {
    const world: LinkWorld = linkWorld({
      prd: { ok: true, value: prdText("Maturité du document : décision") },
    });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([]);
    expect(verdict.outcome).toBe("pass");
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
    expect(verdict.volume).toContain("; maturity décision;");
  });

  test("a PRD above the threshold is approved", async () => {
    const world: LinkWorld = linkWorld({
      prd: { ok: true, value: prdText("Maturité du document : prototype") },
    });
    const verdict = await judge(world);
    expect(verdict.outcome).toBe("pass");
    expect(verdict.volume).toContain("; maturity prototype;");
  });

  test("a PRD without a Maturité du document line is not approved", async () => {
    const world: LinkWorld = linkWorld({
      prd: { ok: true, value: prdText("Maturité : décision") },
    });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      `${PRD_ITEM}: no \`Maturité du document :\` line gives a level (absent, unknown or contradictory): the PRD is not approved (threshold: décision)`,
    ]);
    expect(verdict.volume).toContain("; maturity none;");
  });

  test("the threshold is the policy's, not a constant", async () => {
    const world: LinkWorld = linkWorld();
    const report = await evaluateWorkPackageLink(
      pr(),
      { ...policy, approvedFrom: "prototype" },
      world.ports,
    );
    expect(report.violations).toEqual([
      `${PRD_ITEM}: maturity décision is below prototype: the PRD is not approved`,
    ]);
  });

  test("an unreadable work-package table is a violation with its cause", async () => {
    const world: LinkWorld = linkWorld({
      prd: { ok: true, value: "Maturité du document : décision\n\nNo table here.\n" },
    });
    expect((await judge(world)).violations).toEqual([
      `${PRD_ITEM}: work-package table unreadable (work-package table not found (expected header: WP | CA-n | Périmètre | Vérification | Porte))`,
    ]);
  });

  test("a work package absent from the table is a violation naming the rows", async () => {
    const world: LinkWorld = linkWorld({
      prd: {
        ok: true,
        value: prdText(undefined, "| `WP-1` | `CA-1` | `docs/**` | `bun test` | `two-way` |\n"),
      },
    });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      `${PRD_ITEM}: WP-3 is not a row of the work-package table (rows: WP-1)`,
    ]);
    expect(verdict.volume).toContain("; work packages parsed: 1; criteria parsed: not read");
  });

  test("a cited criterion absent from the requirements is a violation naming it", async () => {
    const world: LinkWorld = linkWorld({
      cahier: { ok: true, value: "- CA-1 One. Validation : `bun test one`\n" },
    });
    expect((await judge(world)).violations).toEqual([
      "PR #7 — WP-3 cites CA-2: docs/cahier-des-charges.md does not declare it",
    ]);
  });

  test("a criterion declared twice makes the requirements unreadable", async () => {
    const world: LinkWorld = linkWorld({
      cahier: { ok: true, value: `${CAHIER}- CA-1 Again. Validation : x\n` },
    });
    expect((await judge(world)).violations).toEqual([
      `${PRD_ITEM}: docs/cahier-des-charges.md unreadable as criteria (criterion CA-1 is declared twice, at lines 1 and 4)`,
    ]);
  });

  test("a cited criterion without a Validation clause is a violation naming it", async () => {
    const world: LinkWorld = linkWorld({
      cahier: {
        ok: true,
        value: "- CA-1 One. Validation : `bun test one`\n- CA-2 Two, no clause.\n",
      },
    });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      "PR #7 — WP-3 cites CA-2: it has no `Validation :` clause",
    ]);
    expect(verdict.volume).toContain("; criteria parsed: 2; criteria cited: 2");
  });

  test("every faulty citation is reported, not only the first", async () => {
    const world: LinkWorld = linkWorld({
      cahier: { ok: true, value: "- CA-7 Seven. Validation : x\n" },
    });
    expect((await judge(world)).violations).toEqual([
      "PR #7 — WP-3 cites CA-1: docs/cahier-des-charges.md does not declare it",
      "PR #7 — WP-3 cites CA-2: docs/cahier-des-charges.md does not declare it",
    ]);
  });

  test("an uncited criterion without a Validation clause does not matter", async () => {
    // CAHIER declares CA-9 without a clause; WP-3 cites only CA-1 and CA-2.
    const verdict = await judge(linkWorld());
    expect(verdict.outcome).toBe("pass");
    expect(verdict.volume).toContain("; criteria parsed: 3; criteria cited: 2");
  });

  test("the exempt path reads no issue and no PRD", async () => {
    const world: LinkWorld = linkWorld({
      commits: withCommits(commit("c1", trailer("Exempt", "revert"))),
      changed: { ok: true, value: ["src/a.ts"] },
    });
    const report = await evaluateWorkPackageLink(pr({ title: 'Revert "x"' }), policy, world.ports);
    expect(report.outcome).toBe("pass");
    expect(world.calls).toEqual([CALL_TRAILERS, "changedFiles"]);
  });
});
