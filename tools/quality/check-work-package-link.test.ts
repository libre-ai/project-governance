import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type CommitDeclarations,
  changedPathProblem,
  type Declaration,
  evaluateWorkPackageLink,
  exemptionHolds,
  type Fact,
  type IssueFields,
  type IssueRead,
  type LinkPorts,
  matchesScope,
  type PrFacts,
  readDeclaration,
  readIssueFields,
  scopeEntryProblem,
  type Trailer,
} from "./check-work-package-link";
import type { GateOutcome, GateReport } from "./gate-report";
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
    // Inside the scope `src/**` of WP-3 in `prdText()`.
    changed: { ok: true, value: ["src/a.ts"] },
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
const CALL_CHANGED = "changedFiles";
// Mutable only because `toEqual` does not accept a readonly array.
const RESOLUTION_CALLS: string[] = [
  CALL_TRAILERS,
  CALL_ISSUE,
  CALL_ANCESTOR,
  CALL_PRD,
  CALL_CAHIER,
];
// A fully valid chain reads the diff last, once, after every check of the chain.
const FULL_RESOLUTION_CALLS: string[] = [...RESOLUTION_CALLS, CALL_CHANGED];

const GREEN_RESOLUTION: string =
  `; resolution: issue ${PRD_REPO}#12 read; PRD ${PRD_REF}; maturity décision; ` +
  "work packages parsed: 2; criteria parsed: 3; criteria cited: 2; " +
  "scope entries: 1; files examined: 1; scope decision: all 1 changed file(s) inside the scope; " +
  "ready: implicit (no guarded path touched, work package two-way)";

describe("evaluateWorkPackageLink", () => {
  test("a well-formed link passes, prints its volume and reads the diff once, last", async () => {
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
    // The diff is read only once the whole chain has held: before that, asking
    // for it would be a wasted, failable read.
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
    expect(report.violations).toEqual([
      'PR #7 — Exempt: docs-only: no changed file: an empty diff is not a documentation-only change (class "docs-only")',
    ]);
    expect(spy.diffCalls).toHaveLength(1);
  });

  // Defence in depth: the port is not trusted. `docs/../src/x.ts` matches
  // `docs/**` if it reaches the matcher, so every path is validated first and
  // the predicate is never consulted.
  test.each([
    ["docs/../src/x.ts", '"docs/../src/x.ts" (it has a ".." segment)'],
    ["./docs/a.md", '"./docs/a.md" (it starts with "./")'],
    ["/docs/a.md", '"/docs/a.md" (it is absolute)'],
    [`docs/a${NUL}.md`, '"docs/a\\u0000.md" (it contains the unreadable character U+0000)'],
    [
      `docs/a${ZERO_WIDTH_SPACE}.md`,
      '"docs/a\\u{200b}.md" (it contains the unreadable character U+200B)',
    ],
  ])("a docs-only exemption refuses the path %p before the predicate", async (path: string, shown: string) => {
    const spy = spyOn(withCommits(commit("c1", trailer("Exempt", "docs-only"))), {
      ok: true,
      value: ["README.md", path],
    });
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.outcome).toBe("violations");
    // One violation only: the predicate (which would have matched) was not reached.
    expect(report.violations).toEqual([
      `PR #7 — Exempt: docs-only: 1 of 2 changed file path(s) unreadable: ${shown}`,
    ]);
    expect(spy.diffCalls).toEqual([["a".repeat(40), "b".repeat(40)]]);
    // The refusal is the only check: the predicate did not run.
    expect(report.checks).toHaveLength(1);
  });

  test.each([
    ["U+3164", 0x3164],
    ["U+2800", 0x2800],
  ])("a docs-only exemption names an outside path holding %s escaped", async (_label: string, codePoint: number) => {
    const spy = spyOn(withCommits(commit("c1", trailer("Exempt", "docs-only"))), {
      ok: true,
      value: ["README.md", `src/${String.fromCodePoint(codePoint)}.ts`],
    });
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.violations).toEqual([
      `PR #7 — Exempt: docs-only: 1 of 2 changed file(s) outside ["**/*.md","docs/**"]: "src/\\u{${codePoint.toString(16)}}.ts" (class "docs-only")`,
    ]);
  });

  test("a docs-only exemption on valid documentation paths still passes", async () => {
    const spy = spyOn(withCommits(commit("c1", trailer("Exempt", "docs-only"))), {
      ok: true,
      value: ["README.md", "docs/.hidden", "docs/a/b.txt"],
    });
    const report = await evaluateWorkPackageLink(pr(), policy, spy.ports);
    expect(report.violations).toEqual([]);
    expect(report.outcome).toBe("pass");
  });

  test("the other classes read the diff as before and do not validate its paths", async () => {
    const spy = spyOn(withCommits(commit("c1", trailer("Exempt", "revert"))), {
      ok: true,
      value: ["../x"],
    });
    const report = await evaluateWorkPackageLink(pr({ title: 'Revert "x"' }), policy, spy.ports);
    expect(report.outcome).toBe("pass");
    expect(spy.diffCalls).toHaveLength(1);
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
      "a single-dot repository name",
      issueBody(`libre-ai/.@${PRD_SHA}:docs/prd.md`),
      'PRD-ref repository "libre-ai/." is not <owner>/<repo>',
    ],
    [
      "a commit of 41 hexadecimal characters",
      issueBody(`${PRD_REPO}@${PRD_SHA}0:docs/prd.md`),
      `PRD-ref commit "${PRD_SHA}0" is not a full commit of 40 lowercase hexadecimal characters`,
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
    expect(world.calls).toEqual(RESOLUTION_CALLS);
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

  // Identifiers are compared exactly: a near miss that merely starts like the
  // cited identifier is another identifier.
  test("a cited CA-1 is not satisfied by a declared CA-10", async () => {
    const world: LinkWorld = linkWorld({
      cahier: {
        ok: true,
        value:
          "- CA-10 Ten. Validation : `bun test ten`\n- CA-2 Two. Validation : `bun test two`\n",
      },
    });
    expect((await judge(world)).violations).toEqual([
      "PR #7 — WP-3 cites CA-1: docs/cahier-des-charges.md does not declare it",
    ]);
  });

  test("a declared WP-1 is not satisfied by a row WP-10", async () => {
    const world: LinkWorld = linkWorld({
      commits: withCommits(commit("c1", trailer("Work-package", `${PRD_REPO}#12 WP-1`))),
      issue: issueRead(issueBody(PRD_REF, "WP-1")),
      prd: {
        ok: true,
        value: prdText(undefined, "| `WP-10` | `CA-1` | `src/**` | `bun test` | `two-way` |\n"),
      },
    });
    expect((await judge(world)).violations).toEqual([
      `${PRD_ITEM}: WP-1 is not a row of the work-package table (rows: WP-10)`,
    ]);
  });

  // A sloppy port can hand over a truthy non-boolean; only `true` proves ancestry.
  test.each([
    ["the string false", "false"],
    ["the number 1", 1],
  ])("an ancestry answered with %s is not on the served branch", async (_label, value) => {
    const world: LinkWorld = linkWorld({
      ancestor: { ok: true, value: value as unknown as boolean },
    });
    expect((await judge(world)).violations).toEqual([
      `${PRD_ITEM}: the cited commit is not on the served branch of ${PRD_REPO}`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE, CALL_ANCESTOR]);
  });
});

// The chain is an audit trail inside ONE owner: an issue or a PRD of another
// owner is a public file anyone can write at `décision`.
describe("evaluateWorkPackageLink — owner of the work package and of the PRD", () => {
  const ownerViolation = (kind: "issue" | "PRD-ref", owner: string, prOwner: string): string =>
    `the ${kind} repository belongs to owner ${JSON.stringify(owner)}, the pull request to owner ${JSON.stringify(prOwner)}: the chain is resolved only within the owner of the pull request`;

  test("the reviewer's probe: a trailer naming an issue of another owner", async () => {
    const world: LinkWorld = linkWorld({
      commits: withCommits(commit("c1", trailer("Work-package", "evil-owner/x#1 WP-1"))),
    });
    const report = await evaluateWorkPackageLink(pr(), policy, world.ports);
    expect(report.violations).toEqual([
      `PR #7 — issue evil-owner/x#1: ${ownerViolation("issue", "evil-owner", "libre-ai")}`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS]);
  });

  test("the reviewer's probe: an issue of the owner whose PRD-ref names another owner", async () => {
    const world: LinkWorld = linkWorld({
      issue: issueRead(issueBody(`evil-owner/x@${PRD_SHA}:docs/prd.md`)),
    });
    const report = await evaluateWorkPackageLink(pr(), policy, world.ports);
    expect(report.violations).toEqual([
      `PR #7 — PRD evil-owner/x@${PRD_SHA}: ${ownerViolation("PRD-ref", "evil-owner", "libre-ai")}`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE]);
    expect(report.volumeSummary).toContain("; PRD not resolved;");
  });

  test("the same owner in another case is the same owner", async () => {
    const world: LinkWorld = linkWorld({
      commits: withCommits(commit("c1", trailer("Work-package", "LIBRE-AI/x#12 WP-3"))),
      issue: issueRead(issueBody(`LIBRE-AI/x@${PRD_SHA}:docs/prd.md`)),
    });
    const report = await evaluateWorkPackageLink(pr({ repo: "libre-ai/y" }), policy, world.ports);
    expect(report.violations).toEqual([]);
    expect(report.outcome).toBe("pass");
    expect(world.calls).toEqual([
      CALL_TRAILERS,
      "readIssue LIBRE-AI/x#12",
      `isAncestorOfServedHead LIBRE-AI/x@${PRD_SHA}`,
      `readFileAt LIBRE-AI/x@${PRD_SHA}:docs/prd.md`,
      `readFileAt LIBRE-AI/x@${PRD_SHA}:docs/cahier-des-charges.md`,
      CALL_CHANGED,
    ]);
  });

  test("a pull request owner in another case is the same owner", async () => {
    const world: LinkWorld = linkWorld();
    const report = await evaluateWorkPackageLink(
      pr({ repo: "Libre-AI/project-governance" }),
      policy,
      world.ports,
    );
    expect(report.outcome).toBe("pass");
  });

  test.each([
    ["libre-ai2", "libre-ai2/x"],
    ["libre-ai-evil", "libre-ai-evil/x"],
    ["libre", "libre/ai"],
  ])("an issue of owner %s is refused", async (owner: string, repo: string) => {
    const world: LinkWorld = linkWorld({
      commits: withCommits(commit("c1", trailer("Work-package", `${repo}#12 WP-3`))),
    });
    const report = await evaluateWorkPackageLink(pr(), policy, world.ports);
    expect(report.violations).toEqual([
      `PR #7 — issue ${repo}#12: ${ownerViolation("issue", owner, "libre-ai")}`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS]);
  });

  test.each([
    ["libre-ai2", "libre-ai2/x"],
    ["libre-ai-evil", "libre-ai-evil/x"],
    ["libre", "libre/ai"],
  ])("a PRD-ref of owner %s is refused", async (owner: string, repo: string) => {
    const world: LinkWorld = linkWorld({
      issue: issueRead(issueBody(`${repo}@${PRD_SHA}:docs/prd.md`)),
    });
    const report = await evaluateWorkPackageLink(pr(), policy, world.ports);
    expect(report.violations).toEqual([
      `PR #7 — PRD ${repo}@${PRD_SHA}: ${ownerViolation("PRD-ref", owner, "libre-ai")}`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE]);
  });

  // U+0456 is the Cyrillic small letter i, drawn like the Latin i. Neither it nor
  // a trailing dot is in the owner grammar, so both are refused before any read.
  const LOOK_ALIKE_OWNER: string = `l${String.fromCodePoint(0x0456)}bre-ai`;

  test.each([
    ["a trailing dot", "libre-ai."],
    ["a Unicode look-alike", LOOK_ALIKE_OWNER],
  ])("an issue owner with %s is refused before any read", async (_label: string, owner: string) => {
    const value = `${owner}/x#12 WP-3`;
    const world: LinkWorld = linkWorld({
      commits: withCommits(commit("c1", trailer("Work-package", value))),
    });
    const report = await evaluateWorkPackageLink(pr(), policy, world.ports);
    expect(report.violations).toEqual([
      `PR #7 — declaration: malformed Work-package value ${JSON.stringify(value)} — expected "<owner>/<repo>#<n> WP-<k>" with one space, <n> and <k> positive without a leading zero`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS]);
  });

  test.each([
    ["a trailing dot", "libre-ai."],
    ["a Unicode look-alike", LOOK_ALIKE_OWNER],
  ])("a PRD-ref owner with %s is refused before the ancestry", async (_label: string, owner: string) => {
    const world: LinkWorld = linkWorld({
      issue: issueRead(issueBody(`${owner}/x@${PRD_SHA}:docs/prd.md`)),
    });
    const report = await evaluateWorkPackageLink(pr(), policy, world.ports);
    expect(report.violations).toEqual([
      `PR #7 — issue ${PRD_REPO}#12: the issue body is not the work-package form: PRD-ref repository ${JSON.stringify(`${owner}/x`)} is not <owner>/<repo>`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE]);
  });

  // An unset or malformed pull request repository (an empty GITHUB_REPOSITORY,
  // for instance) has no owner to compare with: every link is refused, the
  // same-owner-looking one included, before any read.
  const noOwner = (prRepo: string): string =>
    `the pull request repository has no owner (${JSON.stringify(prRepo)} is not <owner>/<repo>): the chain is resolved only within the owner of the pull request`;

  test.each([
    ["empty", ""],
    ["an owner without a slash", "libre-ai"],
    ["an owner with an empty name", "libre-ai/"],
    ["a name with an empty owner", "/gov"],
  ])("a pull request repository that is %s refuses every link", async (_label: string, prRepo: string) => {
    for (const declared of ["evil-owner/x", "libre-ai/product-research"]) {
      const world: LinkWorld = linkWorld({
        commits: withCommits(commit("c1", trailer("Work-package", `${declared}#12 WP-3`))),
      });
      const report = await evaluateWorkPackageLink(pr({ repo: prRepo }), policy, world.ports);
      expect(report.violations).toEqual([`PR #7 — issue ${declared}#12: ${noOwner(prRepo)}`]);
      expect(world.calls).toEqual([CALL_TRAILERS]);
    }
  });

  // U+212A (Kelvin sign) lower-cases to "k" under Unicode case mapping: a
  // full lower-casing would read the owner "Kilo" written with it as "kilo".
  test.each([
    ["the Kelvin sign", `${KELVIN_SIGN}ilo/x`],
    ["the Kelvin sign in a longer owner", `${KELVIN_SIGN}ILO/x`],
  ])("a pull request owner written with %s is not the ASCII owner", async (_label: string, prRepo: string) => {
    const world: LinkWorld = linkWorld({
      commits: withCommits(commit("c1", trailer("Work-package", "kilo/x#12 WP-3"))),
    });
    const report = await evaluateWorkPackageLink(pr({ repo: prRepo }), policy, world.ports);
    expect(report.violations).toEqual([
      `PR #7 — issue kilo/x#12: ${ownerViolation("issue", "kilo", prRepo.slice(0, prRepo.indexOf("/")))}`,
    ]);
    expect(world.calls).toEqual([CALL_TRAILERS]);
  });

  test("the ASCII owner kilo matches its upper-case spelling", async () => {
    const world: LinkWorld = linkWorld({
      commits: withCommits(commit("c1", trailer("Work-package", "kilo/x#12 WP-3"))),
      issue: issueRead(issueBody(`KILO/x@${PRD_SHA}:docs/prd.md`)),
    });
    const report = await evaluateWorkPackageLink(pr({ repo: "Kilo/x" }), policy, world.ports);
    expect(report.outcome).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Containment of the diff in the scope of the work package (norm, "Work-package
// table"): every changed file must be inside at least one entry of the
// `Périmètre` cell of the PRD at the cited commit.
//
// The expectations of this table were MEASURED on Bun 1.4.0 (`Bun.Glob#match`),
// not assumed; the gate relies on them and this table is what notices a Bun
// that changes them. A rename is two paths (the port contract is
// `--no-renames`), so the matcher only ever sees one path at a time.
// ---------------------------------------------------------------------------

describe("matchesScope", () => {
  test.each([
    // `**` crosses `/`, matches dotfiles and a file directly under the prefix.
    ["src/**", "src/a/b.ts", true],
    ["src/**", "src/x", true],
    ["src/**", "src/.hidden", true],
    ["src/**", "src/a/.h/b", true],
    // The directory itself is not a file under it; git never prints a directory.
    ["src/**", "src", false],
    ["docs/**", "docs", false],
    ["src/**", "xsrc/a.ts", false],
    ["**", "a/b/c", true],
    ["**/*.md", ".md", true],
    ["**/*.md", "README.md", true],
    ["**/*.md", "docs/a.md", true],
    ["**/*.md", "docs/.hidden.md", true],
    ["**/*.md", ".hidden/a.md", true],
    ["**/*.md", "docs/a.txt", false],
    // `*` does not cross `/`, and matches a dotfile.
    ["*", "a", true],
    ["*", ".a", true],
    ["*", "a/b", false],
    ["src/*", "src/a", true],
    ["src/*", "src/a/b", false],
    ["src/*.ts", "src/a/b.ts", false],
    // Alternation, including in the middle of a path and with `**` after it.
    ["{a,b}", "a", true],
    ["{a,b}", "b", true],
    ["{a,b}", "c", false],
    ["src/{a,b}/**", "src/a/x.ts", true],
    ["src/{a,b}/**", "src/c/x.ts", false],
    ["*.{ts,md}", "a.md", true],
    ["*.{ts,md}", "a/b.md", false],
    // Literal paths are exact, and case matters.
    ["src/a.ts", "src/a.ts", true],
    ["src/a.ts", "src/a.tsx", false],
    ["src/a.ts", "SRC/a.ts", false],
    ["src/**", "SRC/a.ts", false],
    ["a=b", "a=b", true],
    ["a@b", "a@b", true],
  ])("%s against %s is %p", (pattern: string, path: string, expected: boolean) => {
    expect(matchesScope(pattern, path)).toBe(expected);
  });
});

describe("scopeEntryProblem", () => {
  test.each([
    "src/**",
    "docs/a.md",
    "**/*.md",
    "src/{a,b}/**",
    "a=b",
    "a@b+c",
    ".github/**",
    "*",
    "a,b",
    // Braces stay available for LITERAL alternatives; the `*` is outside them.
    "{a,b}/x.ts",
    "*/{a,b}",
    "src/{a,b}/**/*.md",
  ])("%s is a supported entry", (entry: string) => {
    expect(scopeEntryProblem(entry)).toBeNull();
  });

  const CHARSET = "[A-Za-z0-9._/@+=,{}*-]";
  const STAR_IN_BRACES =
    'it has a "*" inside braces: list the alternatives as separate entries outside braces';
  test.each([
    ["", "the entry is empty"],
    ["!src/**", `the character "!" is outside ${CHARSET}`],
    ["src/[ab]", `the character "[" is outside ${CHARSET}`],
    ["src/a?", `the character "?" is outside ${CHARSET}`],
    ["src/a b", `the character " " is outside ${CHARSET}`],
    ["src/é", `the character "\\u{e9}" is outside ${CHARSET}`],
    ["/abs", 'it starts with "/"'],
    ["/", 'it starts with "/"'],
    ["../x", 'it has a ".." segment'],
    ["a/../x", 'it has a ".." segment'],
    ["a/..", 'it has a ".." segment'],
    // A `..` hidden inside an alternation is still a `..` segment of one branch.
    ["src/{..,a}/x", 'it has a ".." segment'],
    ["{../x,a}", 'it has a ".." segment'],
    ["src/{a,b", "its braces are unbalanced"],
    ["src/a,b}", "its braces are unbalanced"],
    ["}{", "its braces are unbalanced"],
    // Measured on Bun 1.4.0: a `*` inside braces does not behave as outside them
    // (`{src/**,lib/**}` does not match `src/a/b`), so the gate refuses it.
    ["{src/**,lib/**}", STAR_IN_BRACES],
    ["src{/**,}", STAR_IN_BRACES],
    ["{**/*.md,x}", STAR_IN_BRACES],
    ["{a,b*}", STAR_IN_BRACES],
    ["{a,{b,c*}}", STAR_IN_BRACES],
  ])("%p is refused: %s", (entry: string, cause: string) => {
    expect(scopeEntryProblem(entry)).toBe(cause);
  });
});

describe("changedPathProblem", () => {
  test.each([
    "src/a.ts",
    ".github/workflows/x.yml",
    "docs/.hidden",
    "a b.md",
    "docs/été.md",
    "a..b/c",
    "...",
  ])("%s is a repository-relative path", (path: string) => {
    expect(changedPathProblem(path)).toBeNull();
  });

  test.each([
    ["", "it is empty"],
    ["/etc/x", "it is absolute"],
    ["./x", 'it starts with "./"'],
    ["../x", 'it has a ".." segment'],
    ["src/../../etc/passwd", 'it has a ".." segment'],
    ["a/..", 'it has a ".." segment'],
    ["a/./b", 'it has a "." segment'],
    ["a//b", "it has an empty segment"],
    ["a/", "it has an empty segment"],
    [`a${NUL}b`, "it contains the unreadable character U+0000"],
    [`a${LF}b`, "it contains the unreadable character U+000A"],
    [`a${CR}${LF}b`, "it contains the unreadable character U+000A"],
    [`a${CR}b`, "it contains the unreadable character U+000D"],
    [`a${String.fromCodePoint(0x09)}b`, "it contains the unreadable character U+0009"],
    [`a${String.fromCodePoint(0x7f)}b`, "it contains the unreadable character U+007F"],
    [`a${NEXT_LINE}b`, "it contains the unreadable character U+0085"],
    [`a${NO_BREAK_SPACE}b`, "it contains the unreadable character U+00A0"],
    [`a${LINE_SEPARATOR}b`, "it contains the unreadable character U+2028"],
    [`a${PARAGRAPH_SEPARATOR}b`, "it contains the unreadable character U+2029"],
    [`a${BYTE_ORDER_MARK}b`, "it contains the unreadable character U+FEFF"],
    // Allowed by the YAML guard, invisible all the same: the path guard adds them.
    [`a${ZERO_WIDTH_SPACE}b`, "it contains the unreadable character U+200B"],
    [`a${String.fromCodePoint(0x202e)}b`, "it contains the unreadable character U+202E"],
    [`a${String.fromCodePoint(0x3000)}b`, "it contains the unreadable character U+3000"],
    [`a${String.fromCodePoint(0xe000)}b`, "it contains the unreadable character U+E000"],
  ])("%p is refused: %s", (path: string, cause: string) => {
    expect(changedPathProblem(path)).toBe(cause);
  });
});

describe("evaluateWorkPackageLink — scope of the diff", () => {
  const SCOPE_ITEM = "PR #7 — WP-3 scope";
  const CHANGED_ITEM = "PR #7 — WP-3 changed files";
  const CHARSET = "[A-Za-z0-9._/@+=,{}*-]";

  const rows = (scopeCell: string): string =>
    "| `WP-1` | `CA-1` | `docs/**` | `bun test` | `two-way` |\n" +
    `| \`WP-3\` | \`CA-1\`, \`CA-2\` | ${scopeCell} | \`bun test\` | \`two-way\` |\n`;

  /** A world whose WP-3 has the given scope cell and whose diff is `changed`. */
  const scoped = (scopeCell: string, changed: Fact<readonly string[]>): LinkWorld =>
    linkWorld({ prd: { ok: true, value: prdText(undefined, rows(scopeCell)) }, changed });
  const files = (...paths: string[]): Fact<readonly string[]> => ({ ok: true, value: paths });

  async function judge(world: LinkWorld) {
    const report = await evaluateWorkPackageLink(pr(), policy, world.ports);
    return {
      report,
      outcome: report.outcome,
      violations: report.violations,
      volume: report.volumeSummary,
    };
  }

  test("every file inside the scope: pass, the diff read once after the chain", async () => {
    const world = scoped("`src/**`", files("src/a.ts", "src/b/c.ts"));
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([]);
    expect(verdict.outcome).toBe("pass");
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
    expect(verdict.report.checks.at(-1)).toEqual({
      item: SCOPE_ITEM,
      ok: true,
      note: 'all 2 changed file(s) are inside the scope ["src/**"]',
    });
    expect(verdict.volume).toContain(
      "; scope entries: 1; files examined: 2; scope decision: all 2 changed file(s) inside the scope",
    );
  });

  test("the diff is asked for the base and the head of the pull request", async () => {
    const asked: Array<[string, string]> = [];
    const world = scoped("`src/**`", files("src/a.ts"));
    const ports: LinkPorts = {
      ...world.ports,
      changedFiles: async (baseSha, headSha) => {
        asked.push([baseSha, headSha]);
        return files("src/a.ts");
      },
    };
    const report = await evaluateWorkPackageLink(pr(), policy, ports);
    expect(report.outcome).toBe("pass");
    expect(asked).toEqual([["a".repeat(40), "b".repeat(40)]]);
  });

  test("one file outside the scope: a violation naming the file and the scope", async () => {
    const world = scoped("`src/**`", files("src/a.ts", "docs/x.md"));
    const verdict = await judge(world);
    expect(verdict.outcome).toBe("violations");
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: 1 of 2 changed file(s) outside the scope ["src/**"]: "docs/x.md"`,
    ]);
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
    expect(verdict.volume).toContain(
      "; scope entries: 1; files examined: 2; scope decision: 1 of 2 changed file(s) outside the scope",
    );
  });

  test("every file outside the scope is named, in the order of the diff", async () => {
    const world = scoped("`src/**`, `lib/**`", files("z.md", "src/a.ts", "docs/x.md", "lib/b.ts"));
    expect((await judge(world)).violations).toEqual([
      `${SCOPE_ITEM}: 2 of 4 changed file(s) outside the scope ["src/**","lib/**"]: "z.md", "docs/x.md"`,
    ]);
  });

  const outsideRange = (count: number): string[] =>
    Array.from({ length: count }, (_unused, index) => `out/f${index}.txt`);
  const named = (names: readonly string[]): string => names.map((n) => `"${n}"`).join(", ");

  test("exactly twenty files outside the scope are all named, with no remainder", async () => {
    const outside = outsideRange(20);
    const verdict = await judge(scoped("`src/**`", files(...outside)));
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: 20 of 20 changed file(s) outside the scope ["src/**"]: ${named(outside)}`,
    ]);
  });

  test("more than twenty files outside the scope: twenty are named and the rest counted", async () => {
    const outside = outsideRange(25);
    const verdict = await judge(scoped("`src/**`", files(...outside)));
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: 25 of 25 changed file(s) outside the scope ["src/**"]: ${named(outside.slice(0, 20))}, and 5 more`,
    ]);
  });

  test("twenty-one files outside the scope: and 1 more", async () => {
    const outside = outsideRange(21);
    const verdict = await judge(scoped("`src/**`", files(...outside)));
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: 21 of 21 changed file(s) outside the scope ["src/**"]: ${named(outside.slice(0, 20))}, and 1 more`,
    ]);
  });

  // A zero must be a failure (gate-integrity section 2): a diff with no file has
  // nothing to attach to the work package, exactly like an empty commit range.
  test("an empty diff is a violation, never a pass and never a declared emptiness", async () => {
    const world = scoped("`src/**`", files());
    const verdict = await judge(world);
    expect(verdict.outcome).toBe("violations");
    expect(verdict.violations).toEqual([
      `${CHANGED_ITEM}: the diff holds no changed file: a pull request that cites a work package changes at least one file`,
    ]);
    expect(verdict.report.emptyReason).toBeNull();
    // The diff was asked for exactly once, after the whole chain.
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
    expect(verdict.volume).toContain(
      "; scope entries: 1; files examined: 0; scope decision: the diff holds no changed file",
    );
  });

  test("an unreadable diff is a violation naming the cause, never a pass", async () => {
    const world = scoped("`src/**`", { ok: false, reason: "git diff failed: bad object" });
    const verdict = await judge(world);
    expect(verdict.outcome).toBe("violations");
    expect(verdict.violations).toEqual([
      `${CHANGED_ITEM}: changed files unreadable (git diff failed: bad object)`,
    ]);
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
    expect(verdict.volume).toContain(
      "; scope entries: 1; files examined: not read; scope decision: changed files unreadable",
    );
  });

  // Defence in depth: the port is not trusted. Each of these would match
  // `src/**` or `**` if it reached the matcher.
  const SHOWN_PREFIX = `${SCOPE_ITEM}: 1 of 1 changed file path(s) unreadable: `;
  test.each([
    ["../x", '"../x" (it has a ".." segment)'],
    ["src/../../etc/passwd", '"src/../../etc/passwd" (it has a ".." segment)'],
    ["/etc/x", '"/etc/x" (it is absolute)'],
    ["./x", '"./x" (it starts with "./")'],
    ["", '"" (it is empty)'],
    [`src/a${NUL}b`, '"src/a\\u0000b" (it contains the unreadable character U+0000)'],
    [`src/a${LF}b`, '"src/a\\nb" (it contains the unreadable character U+000A)'],
    [
      `src/a${ZERO_WIDTH_SPACE}b`,
      '"src/a\\u{200b}b" (it contains the unreadable character U+200B)',
    ],
    ["src//x", '"src//x" (it has an empty segment)'],
  ])("the changed path %p is refused before any match", async (path: string, shown: string) => {
    const world = scoped("`src/**`, `**`", files(path));
    const verdict = await judge(world);
    expect(verdict.outcome).toBe("violations");
    expect(verdict.violations).toEqual([`${SHOWN_PREFIX}${shown}`]);
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
    expect(verdict.volume).toContain(
      "; scope entries: 2; files examined: 1; scope decision: 1 of 1 changed file path(s) unreadable",
    );
  });

  test("an unreadable path refuses the diff even beside files inside the scope", async () => {
    const verdict = await judge(scoped("`src/**`", files("src/a.ts", "../x", "src/b.ts")));
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: 1 of 3 changed file path(s) unreadable: "../x" (it has a ".." segment)`,
    ]);
  });

  test("twenty-two unreadable paths: twenty are named and the rest counted", async () => {
    const bad = Array.from({ length: 22 }, (_unused, index) => `../f${index}`);
    const shown = bad
      .slice(0, 20)
      .map((path) => `"${path}" (it has a ".." segment)`)
      .join(", ");
    const verdict = await judge(scoped("`src/**`", files(...bad)));
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: 22 of 22 changed file path(s) unreadable: ${shown}, and 2 more`,
    ]);
  });

  test.each([
    ["!src/**", `the character "!" is outside ${CHARSET}`],
    ["../x", 'it has a ".." segment'],
    ["/abs", 'it starts with "/"'],
    ["src/[ab]", `the character "[" is outside ${CHARSET}`],
    ["src/a b", `the character " " is outside ${CHARSET}`],
    ["src/{..,a}/x", 'it has a ".." segment'],
  ])("the scope entry %p is refused, fail closed, and the diff is not read", async (entry: string, cause: string) => {
    const world = scoped(entry, files("src/a.ts"));
    const verdict = await judge(world);
    expect(verdict.outcome).toBe("violations");
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: unsupported scope glob ${JSON.stringify(entry)}: ${cause}`,
    ]);
    expect(world.calls).toEqual(RESOLUTION_CALLS);
    expect(verdict.volume).toContain(
      "; scope entries: 1; files examined: not read; scope decision: 1 unsupported scope glob(s)",
    );
  });

  test("every unsupported entry is named, beside the supported ones", async () => {
    const world = scoped("`src/**`, `!a`, `../b`", files("src/a.ts"));
    expect((await judge(world)).violations).toEqual([
      `${SCOPE_ITEM}: unsupported scope glob "!a": the character "!" is outside ${CHARSET}`,
      `${SCOPE_ITEM}: unsupported scope glob "../b": it has a ".." segment`,
    ]);
    expect(world.calls).toEqual(RESOLUTION_CALLS);
  });

  test("an unbalanced brace is refused with the table, before the diff is read", async () => {
    const world = scoped("`src/{a,b`", files("src/a/x.ts"));
    const verdict = await judge(world);
    expect(verdict.outcome).toBe("violations");
    expect(verdict.violations).toHaveLength(1);
    expect(verdict.violations[0]).toContain("unbalanced braces in scope");
    expect(world.calls).toEqual([CALL_TRAILERS, CALL_ISSUE, CALL_ANCESTOR, CALL_PRD, CALL_CAHIER]);
  });

  test("the diff is not read while a cited criterion is faulty", async () => {
    const world = linkWorld({
      cahier: { ok: true, value: "- CA-1 One. Validation : `bun test one`\n" },
      changed: files("src/a.ts"),
    });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      "PR #7 — WP-3 cites CA-2: docs/cahier-des-charges.md does not declare it",
    ]);
    expect(world.calls).toEqual(RESOLUTION_CALLS);
  });

  test.each([
    ["a dotfile under a recursive scope", "`src/**`", ["src/.hidden", "src/a/.env"]],
    ["an alternation", "`src/{a,b}/**`", ["src/a/x.ts", "src/b/y.ts"]],
    ["a literal path", "`docs/a.md`", ["docs/a.md"]],
    ["the second of two entries", "`lib/**`, `docs/**`", ["docs/a.md", "lib/b.ts"]],
    ["a markdown file at the root", "`**/*.md`", ["README.md", ".md"]],
  ])("inside the scope: %s", async (_label: string, cell: string, paths: string[]) => {
    const verdict = await judge(scoped(cell, files(...paths)));
    expect(verdict.violations).toEqual([]);
    expect(verdict.outcome).toBe("pass");
  });

  test.each([
    ["a dotfile outside a docs scope", "`docs/**`", [".github/x.yml"]],
    ["an alternation that does not list the branch", "`src/{a,b}/**`", ["src/c/x.ts"]],
    ["a different case", "`src/**`", ["SRC/a.ts"]],
    ["a sibling directory with the same prefix", "`src/**`", ["src-old/a.ts"]],
    ["a star that does not cross a slash", "`src/*`", ["src/a/b.ts"]],
  ])("outside the scope: %s", async (_label: string, cell: string, paths: string[]) => {
    const verdict = await judge(scoped(cell, files(...paths)));
    expect(verdict.outcome).toBe("violations");
    expect(verdict.violations).toHaveLength(1);
    expect(verdict.violations[0]).toContain(`outside the scope`);
  });

  test("a wildcard inside braces is refused at the evaluation, with the cause, before the diff", async () => {
    const world = scoped("`{src/**,lib/**}`", files("src/a/b.ts"));
    const verdict = await judge(world);
    expect(verdict.outcome).toBe("violations");
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: unsupported scope glob "{src/**,lib/**}": it has a "*" inside braces: list the alternatives as separate entries outside braces`,
    ]);
    expect(world.calls).toEqual(RESOLUTION_CALLS);
  });

  test("literal alternatives in braces are accepted, with the wildcard outside them", async () => {
    const verdict = await judge(scoped("`src/{a,b}/**`", files("src/a/x/y.ts", "src/b/z.ts")));
    expect(verdict.violations).toEqual([]);
    expect(verdict.outcome).toBe("pass");
  });

  test("a non-ASCII scope entry is refused with its escaped rendering", async () => {
    const world = scoped("`src/é`", files("src/a.ts"));
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: unsupported scope glob "src/\\u{e9}": the character "\\u{e9}" is outside ${CHARSET}`,
    ]);
    expect(world.calls).toEqual(RESOLUTION_CALLS);
  });

  // An entry the gate accepts but that bounds nothing makes the containment
  // check assert nothing: accepted, never silently.
  const UNBOUNDED_NOTE = (entries: string): string =>
    `scope unbounded: the entries ${entries} are accepted and flagged, because they do not bound the files of the work package`;

  test.each([
    ["**", ["src/a.ts", "x/y/z.md"], '["**"]'],
    ["*", ["a.ts", ".env"], '["*"]'],
    ["**/*", ["a.ts", "x/y/z.md"], '["**/*"]'],
    ["**, *", ["a.ts"], '["**","*"]'],
    ["`src/**`, `**`", ["src/a.ts", "z/y.ts"], '["**"]'],
    ["`lib/**`, `**/*`, `src/**`", ["src/a.ts"], '["**/*"]'],
  ])("the unbounded scope %s passes and is flagged", async (cell: string, paths: string[], listed: string) => {
    const verdict = await judge(scoped(cell, files(...paths)));
    expect(verdict.violations).toEqual([]);
    expect(verdict.outcome).toBe("pass");
    expect(
      verdict.report.checks.filter((check) => check.note.startsWith("scope unbounded")),
    ).toEqual([{ item: SCOPE_ITEM, ok: true, note: UNBOUNDED_NOTE(listed) }]);
    expect(verdict.volume).toContain("; scope: unbounded");
  });

  test("a bounded scope carries no flag", async () => {
    const verdict = await judge(scoped("`src/**`, `lib/*.ts`", files("src/a.ts")));
    expect(verdict.outcome).toBe("pass");
    expect(verdict.report.checks.some((check) => check.note.includes("unbounded"))).toBe(false);
    expect(verdict.volume).not.toContain("unbounded");
  });

  test("an unbounded scope does not turn a refusal into a pass", async () => {
    const verdict = await judge(scoped("`**`", files("../x")));
    expect(verdict.outcome).toBe("violations");
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: 1 of 1 changed file path(s) unreadable: "../x" (it has a ".." segment)`,
    ]);
  });

  // Accepted invisible characters (a filler, a blank braille cell) still reach
  // the log as `\u{...}` when the path is named in a refusal.
  test.each([
    ["U+3164 HANGUL FILLER", 0x3164],
    ["U+2800 BRAILLE PATTERN BLANK", 0x2800],
    ["U+115F HANGUL CHOSEONG FILLER", 0x115f],
  ])("an outside path holding %s is printed escaped", async (_label: string, codePoint: number) => {
    const path = `lib/${String.fromCodePoint(codePoint)}.ts`;
    const verdict = await judge(scoped("`src/**`", files(path)));
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: 1 of 1 changed file(s) outside the scope ["src/**"]: "lib/\\u{${codePoint.toString(16)}}.ts"`,
    ]);
  });

  test("a rename from src/a.ts to docs/a.md is seen as two paths and refused for its source", async () => {
    const verdict = await judge(scoped("`docs/**`", files("src/a.ts", "docs/a.md")));
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: 1 of 2 changed file(s) outside the scope ["docs/**"]: "src/a.ts"`,
    ]);
  });

  test("the scope is the table of the PRD at the cited commit, WP-3 and not WP-1", async () => {
    // WP-1 owns docs/**; the declared WP-3 owns src/**.
    const verdict = await judge(scoped("`src/**`", files("docs/x.md")));
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: 1 of 1 changed file(s) outside the scope ["src/**"]: "docs/x.md"`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Explicit `ready` (norm, "Readiness"): inside an approved PRD a work package is
// ready implicitly; an explicit `ready` of an owner, with the issue body not
// edited since, is required only when the diff touches a guarded path of I-17
// (`GATED_PATH_PATTERNS`) or when the work package is `one-way` in the
// `Porte anticipée` column of the PRD at the cited commit.
// ---------------------------------------------------------------------------

describe("evaluateWorkPackageLink — explicit ready", () => {
  const READY_ITEM = "PR #7 — WP-3 ready";
  const SCOPE_ITEM = "PR #7 — WP-3 scope";
  const GUARDED = "docs/adr/0001-x.md";
  const GUARDED_REASON = `guarded path(s) touched: "${GUARDED}"`;
  const ONE_WAY_REASON = "work package WP-3 is one-way";
  const OWNERS_TEXT = '["constantin-jais"]';

  const rows = (door: string): string =>
    "| `WP-1` | `CA-1` | `docs/**` | `bun test` | `two-way` |\n" +
    `| \`WP-3\` | \`CA-1\`, \`CA-2\` | \`src/**\`, \`docs/**\` | \`bun test\` | \`${door}\` |\n`;

  const OWNER_READY: Partial<IssueRead> = {
    labels: ["kind:work-package", "ready"],
    readyLabeledBy: "constantin-jais",
    bodyEditedAfterReady: false,
  };

  interface ReadyCase {
    readonly door?: "one-way" | "two-way";
    readonly changed?: readonly string[];
    readonly issue?: Partial<IssueRead>;
  }

  function readyWorld(given: ReadyCase = {}): LinkWorld {
    const issue: IssueRead = {
      body: issueBody(),
      labels: ["kind:work-package"],
      readyLabeledBy: null,
      bodyEditedAfterReady: false,
      ...given.issue,
    };
    return linkWorld({
      prd: { ok: true, value: prdText(undefined, rows(given.door ?? "two-way")) },
      changed: { ok: true, value: given.changed ?? [GUARDED] },
      issue: { ok: true, value: issue },
    });
  }

  interface ReadyVerdict {
    readonly report: GateReport;
    readonly outcome: GateOutcome;
    readonly violations: readonly string[];
    readonly volume: string | null;
  }

  async function judge(
    world: LinkWorld,
    onPolicy: WorkPackagePolicy = policy,
  ): Promise<ReadyVerdict> {
    const report: GateReport = await evaluateWorkPackageLink(pr(), onPolicy, world.ports);
    return {
      report,
      outcome: report.outcome,
      violations: report.violations,
      volume: report.volumeSummary,
    };
  }

  test("a guarded path without the ready label is a violation naming the path", async () => {
    const world = readyWorld();
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: the issue carries no "ready" label: an explicit ready is required because ${GUARDED_REASON}`,
    ]);
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
    expect(verdict.volume).toContain(
      `; ready: explicit required (${GUARDED_REASON}), 1 check(s) failed`,
    );
  });

  test("a ready set by someone-else, not an owner, does not count", async () => {
    const verdict = await judge(
      readyWorld({ issue: { ...OWNER_READY, readyLabeledBy: "someone-else" } }),
    );
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: the "ready" label was set by "someone-else", who is not in owners ${OWNERS_TEXT}: it does not count`,
    ]);
  });

  test("a ready of an owner followed by an edit of the body is cancelled", async () => {
    const verdict = await judge(
      readyWorld({ issue: { ...OWNER_READY, bodyEditedAfterReady: true } }),
    );
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: the issue body was edited after the "ready" label: the ready is cancelled, set it again`,
    ]);
  });

  test("a ready of an owner, body not edited since: pass, saying why it was required", async () => {
    const world = readyWorld({ issue: OWNER_READY });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([]);
    expect(verdict.outcome).toBe("pass");
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
    expect(verdict.report.checks.at(-1)).toEqual({
      item: READY_ITEM,
      ok: true,
      note: `explicit ready set by "constantin-jais" (an owner), the issue body not edited since; required because ${GUARDED_REASON}`,
    });
    expect(verdict.volume).toContain(`; ready: explicit required (${GUARDED_REASON}), held`);
    // The shared identity of the agents and the owner (norm, "Limit of the
    // control") forbids presenting the owner check as an authentication.
    expect(String(verdict.volume).toLowerCase()).not.toContain("authentic");
    expect(JSON.stringify(verdict.report.checks).toLowerCase()).not.toContain("authentic");
  });

  test("the owner login in another ASCII case is the owner", async () => {
    const verdict = await judge(
      readyWorld({ issue: { ...OWNER_READY, readyLabeledBy: "Constantin-Jais" } }),
    );
    expect(verdict.violations).toEqual([]);
    expect(verdict.outcome).toBe("pass");
  });

  describe("a list of several owners", () => {
    const owners: WorkPackagePolicy = { ...policy, owners: ["constantin-jais", "kilo"] };
    const OWNERS_TWO = '["constantin-jais","kilo"]';

    test.each([
      "kilo",
      "KILO",
      "constantin-jais",
    ])("the owner %s is accepted", async (actor: string) => {
      const verdict = await judge(
        readyWorld({ issue: { ...OWNER_READY, readyLabeledBy: actor } }),
        owners,
      );
      expect(verdict.violations).toEqual([]);
    });

    test("a login with the Kelvin sign does not fold onto the owner kilo", async () => {
      const verdict = await judge(
        readyWorld({ issue: { ...OWNER_READY, readyLabeledBy: `${KELVIN_SIGN}ilo` } }),
        owners,
      );
      expect(verdict.violations).toEqual([
        `${READY_ITEM}: the "ready" label was set by "\\u{212a}ilo", who is not in owners ${OWNERS_TWO}: it does not count`,
      ]);
    });

    test("a login outside the list is refused, naming every owner", async () => {
      const verdict = await judge(
        readyWorld({ issue: { ...OWNER_READY, readyLabeledBy: "mallory" } }),
        owners,
      );
      expect(verdict.violations).toEqual([
        `${READY_ITEM}: the "ready" label was set by "mallory", who is not in owners ${OWNERS_TWO}: it does not count`,
      ]);
    });
  });

  test("a one-way work package outside the guarded paths without ready is a violation", async () => {
    const world = readyWorld({ door: "one-way", changed: ["src/a.ts"] });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: the issue carries no "ready" label: an explicit ready is required because ${ONE_WAY_REASON}`,
    ]);
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
    expect(verdict.volume).toContain(
      `; ready: explicit required (${ONE_WAY_REASON}), 1 check(s) failed`,
    );
  });

  test("a one-way work package with a valid ready passes", async () => {
    const verdict = await judge(
      readyWorld({ door: "one-way", changed: ["src/a.ts"], issue: OWNER_READY }),
    );
    expect(verdict.violations).toEqual([]);
    expect(verdict.outcome).toBe("pass");
    expect(verdict.volume).toContain(`; ready: explicit required (${ONE_WAY_REASON}), held`);
  });

  test("a guarded path and a one-way work package give both reasons", async () => {
    const verdict = await judge(readyWorld({ door: "one-way" }));
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: the issue carries no "ready" label: an explicit ready is required because ${GUARDED_REASON} and ${ONE_WAY_REASON}`,
    ]);
  });

  test("an ordinary two-way pull request outside the guarded paths needs no ready label", async () => {
    const world = readyWorld({ changed: ["src/a.ts", "docs/guide.md"] });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([]);
    expect(verdict.outcome).toBe("pass");
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
    expect(verdict.volume).toContain(
      "; ready: implicit (no guarded path touched, work package two-way)",
    );
    // An implicit ready adds no check: the scope stays the last thing asserted.
    expect(verdict.report.checks.at(-1)?.item).toBe(SCOPE_ITEM);
  });

  test.each([
    "Ready",
    "READY",
    "ready",
  ])("the label %s is the ready label (ASCII case folded)", async (label: string) => {
    const verdict = await judge(
      readyWorld({ issue: { ...OWNER_READY, labels: ["kind:work-package", label] } }),
    );
    expect(verdict.violations).toEqual([]);
  });

  test.each([
    "ready-for-review",
    " ready",
    "ready ",
    "not-ready",
    `${NO_BREAK_SPACE}ready`,
  ])("the label %p is not the ready label", async (label: string) => {
    const verdict = await judge(
      readyWorld({ issue: { ...OWNER_READY, labels: ["kind:work-package", label] } }),
    );
    // The actor is the owner but no ready label is there: both are reported.
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: the issue carries no "ready" label: an explicit ready is required because ${GUARDED_REASON}`,
      `${READY_ITEM}: inconsistent issue read: the "ready" label is absent but its actor is "constantin-jais"`,
    ]);
  });

  test.each([
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["the string false", "false", '"false"'],
    ["zero", 0, "0"],
  ])("bodyEditedAfterReady %s from a careless port is a violation", async (_name: string, value: unknown, shown: string) => {
    const verdict = await judge(
      readyWorld({
        issue: { ...OWNER_READY, bodyEditedAfterReady: value as unknown as boolean },
      }),
    );
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: bodyEditedAfterReady is ${shown}, not the boolean false: the issue read cannot show the body unedited since the ready`,
    ]);
  });

  test("a ready label without an actor is an inconsistent issue read", async () => {
    const verdict = await judge(readyWorld({ issue: { ...OWNER_READY, readyLabeledBy: null } }));
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: inconsistent issue read: the "ready" label is present but its actor is null`,
    ]);
  });

  test("an actor without a ready label is an inconsistent issue read, beside the missing label", async () => {
    const verdict = await judge(
      readyWorld({ issue: { labels: ["kind:work-package"], readyLabeledBy: "constantin-jais" } }),
    );
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: the issue carries no "ready" label: an explicit ready is required because ${GUARDED_REASON}`,
      `${READY_ITEM}: inconsistent issue read: the "ready" label is absent but its actor is "constantin-jais"`,
    ]);
  });

  test("every failed control is reported, not only the first", async () => {
    const verdict = await judge(
      readyWorld({
        issue: {
          labels: ["kind:work-package"],
          readyLabeledBy: "someone-else",
          bodyEditedAfterReady: true,
        },
      }),
    );
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: the issue carries no "ready" label: an explicit ready is required because ${GUARDED_REASON}`,
      `${READY_ITEM}: inconsistent issue read: the "ready" label is absent but its actor is "someone-else"`,
      `${READY_ITEM}: the "ready" label was set by "someone-else", who is not in owners ${OWNERS_TEXT}: it does not count`,
      `${READY_ITEM}: the issue body was edited after the "ready" label: the ready is cancelled, set it again`,
    ]);
    expect(verdict.volume).toContain(
      `; ready: explicit required (${GUARDED_REASON}), 4 check(s) failed`,
    );
  });

  test("more than twenty guarded paths: twenty are named and the rest counted", async () => {
    const changed: string[] = Array.from(
      { length: 21 },
      (_, i) => `docs/adr/${String(i).padStart(4, "0")}-x.md`,
    );
    const verdict = await judge(readyWorld({ changed }));
    const named: string = changed
      .slice(0, 20)
      .map((path) => `"${path}"`)
      .join(", ");
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: the issue carries no "ready" label: an explicit ready is required because guarded path(s) touched: ${named}, and 1 more`,
    ]);
  });

  test.each([
    ["a number", 42, "42"],
    ["an object", { login: "constantin-jais" }, '{"login":"constantin-jais"}'],
  ])("an actor that is %s from a careless port is an inconsistent issue read", async (_name: string, value: unknown, rendered: string) => {
    const verdict = await judge(
      readyWorld({ issue: { ...OWNER_READY, readyLabeledBy: value as unknown as string } }),
    );
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: inconsistent issue read: the actor of the "ready" label is ${rendered}, neither a login nor null`,
    ]);
  });

  test("a label that is not a string from a careless port is no ready label", async () => {
    const verdict = await judge(
      readyWorld({
        issue: { ...OWNER_READY, labels: [{ name: "ready" } as unknown as string] },
      }),
    );
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: the issue carries no "ready" label: an explicit ready is required because ${GUARDED_REASON}`,
      `${READY_ITEM}: inconsistent issue read: the "ready" label is absent but its actor is "constantin-jais"`,
    ]);
  });

  test("only the guarded paths are named, not the other files of the diff", async () => {
    const verdict = await judge(
      readyWorld({ changed: ["src/a.ts", "docs/decisions/INVARIANTS.md", "docs/guide.md"] }),
    );
    expect(verdict.violations).toEqual([
      `${READY_ITEM}: the issue carries no "ready" label: an explicit ready is required because guarded path(s) touched: "docs/decisions/INVARIANTS.md"`,
    ]);
  });

  test("an invalid guarded-looking path is refused by the scope check and ready is not reached", async () => {
    const world = readyWorld({ changed: ["docs/adr/../x.md"] });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: 1 of 1 changed file path(s) unreadable: "docs/adr/../x.md" (it has a ".." segment)`,
    ]);
    expect(verdict.volume).toContain("; ready: not reached");
    expect(world.calls).toEqual(FULL_RESOLUTION_CALLS);
  });

  test("ready is not reached while the scope is violated", async () => {
    const world = readyWorld({ changed: ["lib/x.ts", GUARDED] });
    const verdict = await judge(world);
    expect(verdict.violations).toEqual([
      `${SCOPE_ITEM}: 1 of 2 changed file(s) outside the scope ["src/**","docs/**"]: "lib/x.ts"`,
    ]);
    expect(verdict.volume).toContain("; ready: not reached");
  });

  test("the guarded paths are read from the diff the scope check validated, read once", async () => {
    let reads = 0;
    const world = readyWorld({ issue: OWNER_READY });
    const ports: LinkPorts = {
      ...world.ports,
      changedFiles: async (): Promise<Fact<readonly string[]>> => {
        reads += 1;
        // A second read would see a diff without the guarded path and pass.
        return { ok: true, value: reads === 1 ? [GUARDED] : ["src/a.ts"] };
      },
    };
    const report = await evaluateWorkPackageLink(pr(), policy, ports);
    expect(reads).toBe(1);
    expect(report.volumeSummary).toContain(`; ready: explicit required (${GUARDED_REASON}), held`);
  });
});

// The matcher of the scope and the matcher of `docs-only` are one function:
// the same table, read through the exemption, must give the same answers.
describe("exemptionHolds — docs-only shares the matcher of the scope", () => {
  test.each([
    ["src/**", "src/.hidden", true],
    ["src/**", "SRC/a.ts", false],
    ["src/**", "src", false],
    ["src/{a,b}/**", "src/a/x.ts", true],
    ["src/{a,b}/**", "src/c/x.ts", false],
    ["*", "a/b", false],
    ["**/*.md", ".md", true],
  ])("%s against %s is %p", (pattern: string, path: string, expected: boolean) => {
    const rule: ExemptRule = { paths: [pattern] };
    expect(exemptionHolds("docs-only", rule, pr(), [path]).ok).toBe(expected);
  });
});
