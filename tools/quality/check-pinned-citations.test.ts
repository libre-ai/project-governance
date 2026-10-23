import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AdrRule,
  type Asked,
  adrStanding,
  CitationResolver,
  CONFIG_PATH,
  canonicalRepository,
  classifyRemoteFailure,
  countLines,
  evaluateCitations,
  HARDENING_FLAGS,
  hardenedGitEnvironment,
  listCandidateSegments,
  type PinnedCitation,
  type PinnedCitationsConfig,
  parseLineSpec,
  type Resolution,
  reconcileCandidates,
  repositoryFromRemote,
  type ScannedText,
  scanText,
  spansOutside,
  validateCitedPath,
  validateConfig,
} from "./check-pinned-citations";

const ORG = "libre-ai";
const SHA40 = "e149c702f044180ae41005e2dec6f19206e21774";
/** The repository the gate runs in, as `repositoryFromRemote` derives it. */
const SELF = "this-repository";

// ------------------------------------------------------------- parsing ---

describe("parseLineSpec", () => {
  test("reads L, a-b, a,b and comma lists of those", () => {
    expect(parseLineSpec("13")).toEqual([{ start: 13, end: 13 }]);
    expect(parseLineSpec("33-38")).toEqual([{ start: 33, end: 38 }]);
    expect(parseLineSpec("304,358")).toEqual([
      { start: 304, end: 304 },
      { start: 358, end: 358 },
    ]);
    expect(parseLineSpec("1-3,7")).toEqual([
      { start: 1, end: 3 },
      { start: 7, end: 7 },
    ]);
  });

  test("refuses line 0, reversed ranges and malformed lists", () => {
    for (const spec of ["0", "5-3", "1-", "-2", "1,,2", "1,", "a", "", "1-2-3"]) {
      expect(parseLineSpec(spec)).toBeNull();
    }
  });
});

describe("validateCitedPath", () => {
  test("accepts a repository-relative path", () => {
    expect(validateCitedPath("packages/core/src/crypto-types.ts")).toBeNull();
    expect(validateCitedPath(".github/workflows/ci.yml")).toBeNull();
  });

  test("refuses every path git would not read as tree-relative", () => {
    expect(validateCitedPath("")).toContain("empty");
    expect(validateCitedPath("/etc/passwd")).toContain("absolute");
    expect(validateCitedPath("a/../b")).toContain("..");
    expect(validateCitedPath("../b")).toContain("..");
    expect(validateCitedPath("./a")).toContain("'.' segment");
    expect(validateCitedPath("a//b")).toContain("empty segment");
    expect(validateCitedPath("a\\b")).toContain("backslash");
    expect(validateCitedPath("a:b")).toContain("colon");
    expect(validateCitedPath("a\u0001b")).toContain("control");
    expect(validateCitedPath("a\u007fb")).toContain("control");
  });

  test("refuses each markdown or revision character by name", () => {
    for (const character of [
      "*",
      "{",
      "}",
      "[",
      "]",
      "|",
      "(",
      ")",
      "<",
      ">",
      "'",
      '"',
      "`",
      "#",
      "^",
      "~",
      "?",
    ]) {
      expect(validateCitedPath(`docs/a${character}b.md`)).toBe(
        `the path carries '${character}', a markdown or revision character no cited path is written with`,
      );
    }
  });
});

describe("scanText — pinned citations", () => {
  const scan = (text: string): ScannedText => scanText(text, ORG, []);

  test("reads every documented form with its host line", () => {
    const text = [
      "intro",
      "(`libre-ai/collaborative-data-sync@ed2c0fe:packages/core/src/crypto-types.ts:33-38`).",
      "- `libre-ai/execution-continuity-evaluator@60c33eb:src/authorized_execution/graph.rs:304,358`",
      "measured in `libre-ai/schemas-and-contracts@e149c70` and libre-ai/square-control@95e1bcea, then",
      `libre-ai/x@${SHA40}:README.md.`,
      "libre-ai/x@abcdef1:src/a.ts:13, and libre-ai/x@abcdef1:src/a.ts:1-3,7;",
    ].join("\n");
    const { pinned, rejected } = scan(text);
    expect(rejected).toEqual([]);
    expect(
      pinned.map((c) => [c.line, c.text, c.repository, c.sha, c.path, c.lines ?? null]),
    ).toEqual([
      [
        2,
        "libre-ai/collaborative-data-sync@ed2c0fe:packages/core/src/crypto-types.ts:33-38",
        "collaborative-data-sync",
        "ed2c0fe",
        "packages/core/src/crypto-types.ts",
        [{ start: 33, end: 38 }],
      ],
      [
        3,
        "libre-ai/execution-continuity-evaluator@60c33eb:src/authorized_execution/graph.rs:304,358",
        "execution-continuity-evaluator",
        "60c33eb",
        "src/authorized_execution/graph.rs",
        [
          { start: 304, end: 304 },
          { start: 358, end: 358 },
        ],
      ],
      [4, "libre-ai/schemas-and-contracts@e149c70", "schemas-and-contracts", "e149c70", null, null],
      [4, "libre-ai/square-control@95e1bcea", "square-control", "95e1bcea", null, null],
      [5, `libre-ai/x@${SHA40}:README.md`, "x", SHA40, "README.md", null],
      [6, "libre-ai/x@abcdef1:src/a.ts:13", "x", "abcdef1", "src/a.ts", [{ start: 13, end: 13 }]],
      [
        6,
        "libre-ai/x@abcdef1:src/a.ts:1-3,7",
        "x",
        "abcdef1",
        "src/a.ts",
        [
          { start: 1, end: 3 },
          { start: 7, end: 7 },
        ],
      ],
    ]);
  });

  test("reads neither other organisations nor a repository mentioned without '@'", () => {
    const text = [
      "other-org/x@abcdef1:a.ts:1 and actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "libre-ai/project-governance names a repository and pins nothing, but libre-ai/x@ is a candidate",
      "git@github.com:libre-ai/x.git puts its '@' before the organisation",
    ].join("\n");
    const { pinned, rejected } = scan(text);
    expect(pinned).toEqual([]);
    expect(rejected.map((r) => r.text)).toEqual(["libre-ai/x@"]);
    expect(listCandidateSegments(text, ORG)).toHaveLength(1);
  });

  test("closed by default: anything written against the organisation is refused, never skipped", () => {
    const text = [
      "@libre-ai/ui@1.2.3 is a package specifier",
      "https://github.com/libre-ai/x@abcdef1 is a URL",
      "xlibre-ai/x@abcdef1 and see.libre-ai/nonexistent-repo-zz@abcdef1",
    ].join("\n");
    const { pinned, rejected } = scan(text);
    expect(pinned).toEqual([]);
    expect(rejected.map((r) => [r.line, r.reason])).toEqual([
      [
        1,
        "'@' is written against libre-ai/: a citation is wrapped only in backticks, emphasis, brackets, parentheses or quotes",
      ],
      [
        2,
        "'https://github.com/' is written against libre-ai/: a citation is wrapped only in backticks, emphasis, brackets, parentheses or quotes",
      ],
      [
        3,
        "'x' is written against libre-ai/: a citation is wrapped only in backticks, emphasis, brackets, parentheses or quotes",
      ],
      [
        3,
        "'see.' is written against libre-ai/: a citation is wrapped only in backticks, emphasis, brackets, parentheses or quotes",
      ],
    ]);
    expect(listCandidateSegments(text, ORG)).toHaveLength(4);
  });

  test("D1: a character glued to the sha or the path is part of the citation, never its end", () => {
    // Each of these resolved on its prefix in the second form of the gate.
    const text = [
      "libre-ai/project-governance@c466a5c*docs/x.md",
      "libre-ai/project-governance@c466a5c{~1}:package.json",
      "libre-ai/project-governance@c466a5c[0]:package.json:9999",
      "libre-ai/project-governance@c466a5c|docs/x.md",
      "libre-ai/project-governance@c466a5c:package.json*:9999",
      "libre-ai/project-governance@c466a5c:package.json(9999)",
      "libre-ai/project-governance@c466a5c'#L9999",
      "libre-ai/project-governance@c466a5c:package.json<9999>",
    ].join("\n");
    const { pinned, rejected } = scan(text);
    expect(pinned).toEqual([]);
    expect(rejected.map((r) => [r.line, r.text, r.reason])).toEqual([
      [
        1,
        "libre-ai/project-governance@c466a5c*docs/x.md",
        "after the sha only ':' or the end of the citation may follow, found '*': 'c466a5c*docs/x.md' does not name a commit",
      ],
      [
        2,
        "libre-ai/project-governance@c466a5c{~1}:package.json",
        "after the sha only ':' or the end of the citation may follow, found '{': 'c466a5c{~1}' does not name a commit",
      ],
      [
        3,
        "libre-ai/project-governance@c466a5c[0]:package.json:9999",
        "after the sha only ':' or the end of the citation may follow, found '[': 'c466a5c[0]' does not name a commit",
      ],
      [
        4,
        "libre-ai/project-governance@c466a5c|docs/x.md",
        "after the sha only ':' or the end of the citation may follow, found '|': 'c466a5c|docs/x.md' does not name a commit",
      ],
      [
        5,
        "libre-ai/project-governance@c466a5c:package.json*:9999",
        "the path carries '*', a markdown or revision character no cited path is written with",
      ],
      [
        6,
        "libre-ai/project-governance@c466a5c:package.json(9999)",
        "the path carries '(', a markdown or revision character no cited path is written with",
      ],
      [
        7,
        "libre-ai/project-governance@c466a5c'#L9999",
        "after the sha only ':' or the end of the citation may follow, found ''': 'c466a5c'#L9999' does not name a commit",
      ],
      [
        8,
        "libre-ai/project-governance@c466a5c:package.json<9999>",
        "the path carries '<', a markdown or revision character no cited path is written with",
      ],
    ]);
    expect(listCandidateSegments(text, ORG)).toHaveLength(8);
  });

  test("D2: emphasis and a glued point no longer hide a citation from either count", () => {
    const text = [
      "_libre-ai/project-governance@c466a5c:package.json:9999_",
      "__libre-ai/nonexistent-repo-zz@abcdef1:x.md__",
      "see.libre-ai/nonexistent-repo-zz@abcdef1",
    ].join("\n");
    const { pinned, rejected } = scan(text);
    expect(pinned.map((c) => [c.line, c.text, c.repository, c.path])).toEqual([
      [
        1,
        "libre-ai/project-governance@c466a5c:package.json:9999",
        "project-governance",
        "package.json",
      ],
      [2, "libre-ai/nonexistent-repo-zz@abcdef1:x.md", "nonexistent-repo-zz", "x.md"],
    ]);
    expect(rejected.map((r) => [r.line, r.text])).toEqual([
      [3, "see.libre-ai/nonexistent-repo-zz@abcdef1"],
    ]);
    expect(listCandidateSegments(text, ORG)).toHaveLength(3);
  });

  test("named wrappings are removed only when they enclose the citation", () => {
    const text = [
      "**libre-ai/x@abcdef1:a.ts:3**",
      "*libre-ai/x@abcdef1:a.ts:3*,",
      "(`libre-ai/x@abcdef1:a.ts:1-9`).",
      "[libre-ai/x@abcdef1]",
      '"libre-ai/x@abcdef1:a.ts",',
      "`uses: libre-ai/x/.github/workflows/w.yml@abcdef1`)",
      "**libre-ai/x@abcdef1:a.ts:3*",
    ].join("\n");
    const { pinned, rejected } = scan(text);
    expect(pinned.map((c) => [c.line, c.text])).toEqual([
      [1, "libre-ai/x@abcdef1:a.ts:3"],
      [2, "libre-ai/x@abcdef1:a.ts:3"],
      [3, "libre-ai/x@abcdef1:a.ts:1-9"],
      [4, "libre-ai/x@abcdef1"],
      [5, "libre-ai/x@abcdef1:a.ts"],
      [6, "libre-ai/x/.github/workflows/w.yml@abcdef1"],
    ]);
    // An unpaired emphasis is not a wrapping: it is refused, not trimmed.
    expect(rejected.map((r) => [r.line, r.text])).toEqual([[7, "*libre-ai/x@abcdef1:a.ts:3"]]);
  });

  test("an action reference of the organisation is resolved as <repository>@<sha>:<path>", () => {
    const { pinned, rejected } = scan(
      "libre-ai/project-governance/.github/workflows/ci.yml@0123456789abcdef0123456789abcdef01234567",
    );
    expect(rejected).toEqual([]);
    expect(pinned.map((c) => [c.repository, c.sha, c.path, c.lines])).toEqual([
      [
        "project-governance",
        "0123456789abcdef0123456789abcdef01234567",
        ".github/workflows/ci.yml",
        null,
      ],
    ]);
  });

  test("two citations glued into one segment are one invalid citation, counted once on both sides", () => {
    const text = "libre-ai/x@abcdef1:a:1;libre-ai/y@abcdef2";
    const { pinned, rejected } = scan(text);
    expect(pinned).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual([
      "'1;libre-ai/y@abcdef2' is not a line spec (L, a-b, a,b; 1-based, a <= b)",
    ]);
    expect(listCandidateSegments(text, ORG)).toHaveLength(1);
  });

  test("a suffix that opens with a digit is judged as a line spec", () => {
    const { rejected } = scan("libre-ai/x@abcdef1:package.json:9999~");
    expect(rejected.map((r) => r.reason)).toEqual([
      "'9999~' is not a line spec (L, a-b, a,b; 1-based, a <= b)",
    ]);
  });

  test("judges the token whole: nothing but ':' or its end may follow the sha", () => {
    // Each of these resolved on the commit alone in the first form of the gate.
    const text = [
      "libre-ai/project-governance@c466a5c/docs/does-not-exist.md",
      "libre-ai/project-governance@c466a5c~1:docs/adr/0049-threat-model-coverage.md",
      "libre-ai/project-governance@c466a5c^:docs/adr/0049-threat-model-coverage.md:9999",
      "libre-ai/project-governance@c466a5c#L9999",
    ].join("\n");
    const { pinned, rejected } = scan(text);
    expect(pinned).toEqual([]);
    expect(rejected.map((r) => [r.line, r.text])).toEqual([
      [1, "libre-ai/project-governance@c466a5c/docs/does-not-exist.md"],
      [2, "libre-ai/project-governance@c466a5c~1:docs/adr/0049-threat-model-coverage.md"],
      [3, "libre-ai/project-governance@c466a5c^:docs/adr/0049-threat-model-coverage.md:9999"],
      [4, "libre-ai/project-governance@c466a5c#L9999"],
    ]);
    expect(rejected.map((r) => r.reason)).toEqual([
      "after the sha only ':' or the end of the citation may follow, found '/': 'c466a5c/docs/does-not-exist.md' does not name a commit",
      "after the sha only ':' or the end of the citation may follow, found '~': 'c466a5c~1' does not name a commit",
      "after the sha only ':' or the end of the citation may follow, found '^': 'c466a5c^' does not name a commit",
      "after the sha only ':' or the end of the citation may follow, found '#': 'c466a5c#L9999' does not name a commit",
    ]);
  });

  test("every libre-ai/…@… token is examined: what is not a pin is rejected, never skipped", () => {
    const text = [
      "libre-ai/../evil@abcdef1:README.md",
      "libre-ai/a/b@abcdef1:README.md",
      "libre-ai/x@abcdef1q:README.md",
      "libre-ai/x@v2:README.md and libre-ai/x@main",
      "libre-ai/x@",
    ].join("\n");
    const { pinned, rejected } = scan(text);
    expect(pinned).toEqual([]);
    expect(rejected.map((r) => [r.line, r.reason])).toEqual([
      [1, "'..' is not a repository name"],
      [
        2,
        "an action reference (libre-ai/<repository>/<path>@<sha>) ends at its sha, found ':README.md'",
      ],
      [
        3,
        "after the sha only ':' or the end of the citation may follow, found 'q': 'abcdef1q' does not name a commit",
      ],
      [
        4,
        "'v2' is not a sha: a pin names a commit, never a branch, a tag or a revision expression",
      ],
      [
        4,
        "'main' is not a sha: a pin names a commit, never a branch, a tag or a revision expression",
      ],
      [5, "'' is not a sha: a pin names a commit, never a branch, a tag or a revision expression"],
    ]);
    // The independent walk sees exactly the segments the parser judged.
    expect(listCandidateSegments(text, ORG)).toHaveLength(rejected.length);
  });

  test("refuses a sha that is not 7-40 lowercase hex, naming the reason", () => {
    const text = [
      "libre-ai/x@ABCDEF1:a.ts",
      "libre-ai/x@abcdef:a.ts",
      `libre-ai/x@${SHA40}0:a.ts`,
    ].join("\n");
    const { pinned, rejected } = scan(text);
    expect(pinned).toEqual([]);
    expect(rejected.map((r) => [r.line, r.text])).toEqual([
      [1, "libre-ai/x@ABCDEF1:a.ts"],
      [2, "libre-ai/x@abcdef:a.ts"],
      [3, `libre-ai/x@${SHA40}0:a.ts`],
    ]);
    for (const r of rejected) expect(r.reason).toContain("7 to 40 lowercase hexadecimal");
  });

  test("refuses malformed line specs and unsafe paths instead of truncating them", () => {
    const text = [
      "libre-ai/x@abcdef1:a.ts:0",
      "libre-ai/x@abcdef1:a.ts:9-3",
      "libre-ai/x@abcdef1:a.ts:1-",
      "libre-ai/x@abcdef1:/etc/passwd",
      "libre-ai/x@abcdef1:a/../../b.ts:1",
      "libre-ai/x@abcdef1:./a.ts",
      "libre-ai/x@abcdef1:a\u0001b.ts",
      "libre-ai/x@abcdef1:a\\b.ts",
      "libre-ai/x@abcdef1:a:b:c",
      "libre-ai/..@abcdef1:a.ts",
    ].join("\n");
    const { pinned, rejected } = scan(text);
    expect(pinned).toEqual([]);
    expect(rejected.map((r) => r.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rejected[0]?.reason).toContain("line spec");
    expect(rejected[3]?.reason).toContain("absolute");
    expect(rejected[4]?.reason).toContain("..");
    expect(rejected[6]?.reason).toContain("control");
    expect(rejected[9]?.reason).toContain("not a repository name");
  });
});

describe("scanText — bare and unqualified citations", () => {
  const extensions = ["ts", "tsx", "md", "yaml", "json", "rs"];

  test("reads bare path:line citations, never the tail of a pinned one", () => {
    const text = [
      "see `docs/parity/README.md:17` and `apps/x.tsx:5-9`",
      "pinned `libre-ai/x@abcdef1:packages/core/src/a.ts:33-38` only once",
      "a URL https://example.org/a.ts:12 and a short tail (`:23`) are not citations",
    ].join("\n");
    const { bare, pinned } = scanText(text, ORG, extensions);
    expect(pinned).toHaveLength(1);
    expect(bare.map((b) => [b.line, b.path, b.lines])).toEqual([
      [1, "docs/parity/README.md", [{ start: 17, end: 17 }]],
      [1, "apps/x.tsx", [{ start: 5, end: 9 }]],
    ]);
  });

  test("does not read bare citations when no extension is declared", () => {
    expect(scanText("docs/a.md:3", ORG, []).bare).toEqual([]);
  });

  test("counts unqualified pins and leaves action references alone", () => {
    const text = [
      "(`personal-knowledge-notebook@22e8b2e:crates/notebook-core/src/crypto.rs:2`, `:16-17`)",
      "(`docs/security/THREAT-MODEL.md@6f780d5:143`) and governance@33dcc5a.",
      "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "libre-ai/governance/.github/workflows/reusable-licensing.yml@94fc054c6b16e047eb0736e12444a08d50728efc",
    ].join("\n");
    const { unqualified, bare } = scanText(text, ORG, extensions);
    expect(unqualified.map((u) => [u.line, u.text])).toEqual([
      [1, "personal-knowledge-notebook@22e8b2e:crates/notebook-core/src/crypto.rs:2"],
      [2, "docs/security/THREAT-MODEL.md@6f780d5:143"],
      [2, "governance@33dcc5a"],
    ]);
    // The tail of an unqualified pin is not counted a second time as bare.
    expect(bare).toEqual([]);
  });

  test("reads local pins <sha>:<path>[:<lines>] whole, never as bare, never inside another form", () => {
    const text = [
      "(`c466a5c:AGENTS.md:80`, `c466a5c:docs/reviews/AGENT-REVIEW-PROTOCOL.md:28-29`)",
      "a whole file: `abcdef1:docs/a.md`; any extension: c466a5c:Makefile:3.",
      "pinned `libre-ai/x@abcdef1:packages/core/src/a.ts:33` and unqualified `name@abcdef2:a.ts:2`",
      "not a sha: `zzzzzzz:docs/a.md:3`; prose: commit c466a5c: it moved",
      // A parenthesis opened here and closed on the next line, as in ADR-0056.
      "(`c466a5c:vision.md:544-561`,",
      "emphasis _c466a5c:tools/x.ts:12_. and __c466a5c:tools/x.ts:13__ and *c466a5c:tools/x.ts:14*",
      `forty: \`${SHA40}:tools/x.ts:1-2,5\``,
    ].join("\n");
    const { local, localRejected, bare, pinned, unqualified } = scanText(text, ORG, extensions);
    expect(local.map((pin) => [pin.line, pin.sha, pin.path, pin.lines])).toEqual([
      [1, "c466a5c", "AGENTS.md", [{ start: 80, end: 80 }]],
      [1, "c466a5c", "docs/reviews/AGENT-REVIEW-PROTOCOL.md", [{ start: 28, end: 29 }]],
      [2, "abcdef1", "docs/a.md", null],
      [2, "c466a5c", "Makefile", [{ start: 3, end: 3 }]],
      [5, "c466a5c", "vision.md", [{ start: 544, end: 561 }]],
      [6, "c466a5c", "tools/x.ts", [{ start: 12, end: 12 }]],
      [6, "c466a5c", "tools/x.ts", [{ start: 13, end: 13 }]],
      [6, "c466a5c", "tools/x.ts", [{ start: 14, end: 14 }]],
      [
        7,
        SHA40,
        "tools/x.ts",
        [
          { start: 1, end: 2 },
          { start: 5, end: 5 },
        ],
      ],
    ]);
    expect(localRejected).toEqual([]);
    expect(pinned).toHaveLength(1);
    expect(unqualified.map((u) => u.text)).toEqual(["name@abcdef2:a.ts:2"]);
    // `zzzzzzz:` is not hex, so `docs/a.md:3` after it is no bare citation either:
    // the bare pattern refuses a path preceded by ':'.
    expect(bare).toEqual([]);
  });

  test("closed by default: a sha then ':' is a local pin in full, or refused by name", () => {
    const cases: readonly (readonly [string, string])[] = [
      // A suffix glued to the line spec or the path is part of the pin, never its end.
      ["c466a5c:tools/quality/check-pr-door.ts:3-9999999x", "is not a line spec"],
      ["c466a5c:tools/quality/check-pr-door.ts:99999abc", "is not a line spec"],
      ["c466a5c:tools/quality/check-pr-door.ts#L99999", "carries '#'"],
      ["c466a5c:tools/quality/check-pr-door.ts*docs/y.ts", "carries '*'"],
      ["c466a5c:tools/quality/check-pr-door.ts~1", "carries '~'"],
      ["c466a5c:tools/x.ts:0", "is not a line spec"],
      ["c466a5c:../x.ts", "climbs out of the tree"],
      // Written against the sha: nothing may precede it.
      ["C466A5C:tools/x.ts:12", "7 to 40 lowercase hexadecimal"],
      [`${SHA40}a:tools/x.ts:12`, "7 to 40 lowercase hexadecimal"],
      ["@c466a5c:tools/x.ts:12", "is not a local pin"],
      ["commit:c466a5c:tools/x.ts:12", "is not a local pin"],
      ["--c466a5c:tools/x.ts:12", "is not a local pin"],
      // Two forms glued into one segment are one refused candidate, and the
      // bare citation inside it is not counted a second time.
      ["docs/a.md:3,c466a5c:tools/x.ts", "is not a local pin"],
      // A pin of another owner is judged on the same tail grammar, and the
      // organisation written in another case is not another owner.
      ["tt-a1i/archify@25cf370:<chemin>", "carries '<'"],
      ["tt-a1i/archify@25cf370:a.md:3x", "is not a line spec"],
      ["Libre-AI/live@abcdef1:a.md", "is the organisation written in another case"],
      ["LIBRE-AI/live@abcdef1:a.md", "is the organisation written in another case"],
    ];
    for (const [written, reason] of cases) {
      const { local, localRejected, bare } = scanText(`see \`${written}\`.`, ORG, extensions);
      expect(local, written).toEqual([]);
      expect(bare, written).toEqual([]);
      expect(
        localRejected.map((r) => r.text),
        written,
      ).toEqual([written]);
      expect(localRejected[0]?.reason, written).toContain(reason);
    }
  });

  test("a pin of another owner is counted apart, never as local", () => {
    const text =
      "(`tt-a1i/archify@25cf370:CONTRIBUTING.md:51`) and `tt-a1i/archify@25cf370:AGENTS.md:15`";
    const { foreign, local, localRejected, unqualified, bare } = scanText(text, ORG, extensions);
    expect(foreign.map((f) => f.text)).toEqual([
      "tt-a1i/archify@25cf370:CONTRIBUTING.md:51",
      "tt-a1i/archify@25cf370:AGENTS.md:15",
    ]);
    expect([local, localRejected, unqualified, bare]).toEqual([[], [], [], []]);
  });

  test("does not read local pins outside an ADR (no extension declared)", () => {
    const scanned = scanText("`c466a5c:AGENTS.md:80` `C466A5C:x.ts`", ORG, []);
    expect([scanned.local, scanned.localRejected, scanned.foreign]).toEqual([[], [], []]);
  });
});

describe("canonicalRepository", () => {
  test("folds the spellings GitHub resolves to one", () => {
    for (const name of [
      "project-governance",
      "Project-Governance",
      "project-governance.git",
      "PROJECT-GOVERNANCE.GIT",
    ]) {
      expect(canonicalRepository(name)).toBe("project-governance");
    }
    expect(canonicalRepository("x.github.io")).toBe("x.github.io");
  });
});

describe("repositoryFromRemote", () => {
  test("names the repository of the organisation in every form git is given it", () => {
    for (const url of [
      "https://github.com/libre-ai/project-governance",
      "https://github.com/libre-ai/project-governance.git",
      "https://github.com/libre-ai/project-governance/",
      "git@github.com:libre-ai/project-governance.git",
      "ssh://git@github.com/libre-ai/project-governance.git",
    ]) {
      expect(repositoryFromRemote(url, ORG)).toBe("project-governance");
    }
  });

  test("refuses another host, another owner, a nested path or an unsafe name", () => {
    for (const url of [
      "https://gitlab.com/libre-ai/project-governance",
      "https://github.com/someone-else/project-governance",
      "https://github.com/libre-ai-fork/project-governance",
      "https://github.com/libre-ai/a/b",
      "https://github.com/libre-ai/..",
      "https://github.com/libre-ai/",
      "https://github.com/libre-ai/x;rm",
      "/home/runner/work/project-governance",
    ]) {
      expect(repositoryFromRemote(url, ORG)).toBeNull();
    }
  });
});

describe("countLines and spansOutside", () => {
  test("numbers lines the way an editor does", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("\n")).toBe(1);
  });

  test("returns the spans that end past the last line", () => {
    expect(spansOutside([{ start: 1, end: 3 }], 3)).toEqual([]);
    expect(
      spansOutside(
        [
          { start: 1, end: 3 },
          { start: 3, end: 4 },
          { start: 9, end: 9 },
        ],
        3,
      ),
    ).toEqual([
      { start: 3, end: 4 },
      { start: 9, end: 9 },
    ]);
  });
});

describe("adrStanding", () => {
  const rule: AdrRule = {
    directory: "docs/adr/",
    bareCitationsGuardedAbove: 53,
    unnumbered: [{ path: "docs/adr/2026-09-29-portfolio-consolidation.md", because: "legacy" }],
    extensions: ["ts"],
  };

  test("guards strictly above the threshold, by number not by date", () => {
    expect(adrStanding("docs/adr/0054-next.md", rule)).toBe("guarded");
    expect(adrStanding("docs/adr/0053-last.md", rule)).toBe("legacy");
    expect(adrStanding("docs/adr/0004-early.md", rule)).toBe("legacy");
    // A dated file is not ADR 2026.
    expect(adrStanding("docs/adr/2026-09-29-portfolio-consolidation.md", rule)).toBe("legacy");
  });

  test("an unnumbered ADR escapes the forward rule only when listed", () => {
    expect(adrStanding("docs/adr/2027-01-01-new.md", rule)).toBe("guarded");
    expect(adrStanding("docs/adr/notes.md", rule)).toBe("guarded");
  });

  test("files outside the directory, below it, or not markdown are not ADRs", () => {
    expect(adrStanding("docs/security/THREAT-MODEL.md", rule)).toBe("not-an-adr");
    expect(adrStanding("docs/adr/assets/0099-x.md", rule)).toBe("not-an-adr");
    expect(adrStanding("docs/adr/0099-x.txt", rule)).toBe("not-an-adr");
  });
});

// ------------------------------------------------------- hardening ---

describe("git hardening", () => {
  test("the environment is built, not inherited", () => {
    const environment = hardenedGitEnvironment("/scratch", "https");
    expect(Object.keys(environment).sort()).toEqual([
      "GIT_ALLOW_PROTOCOL",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_TERMINAL_PROMPT",
      "HOME",
      "LC_ALL",
      "PATH",
    ]);
    expect(environment.GIT_ALLOW_PROTOCOL).toBe("https");
    expect(environment.GIT_TERMINAL_PROMPT).toBe("0");
    expect(environment.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(environment.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(environment.HOME).toBe("/scratch");
  });

  test("hooks and credential helpers are switched off on every call", () => {
    expect(HARDENING_FLAGS).toEqual(["-c", "core.hooksPath=/dev/null", "-c", "credential.helper="]);
  });

  test("a missing repository and a failure to ask are told apart", () => {
    expect(
      classifyRemoteFailure(
        "remote: Repository not found.\nfatal: repository 'x' not found",
        false,
      ),
    ).toBe("repository-not-found");
    expect(
      classifyRemoteFailure(
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        false,
      ),
    ).toBe("repository-not-found");
    expect(
      classifyRemoteFailure("fatal: unable to access: Could not resolve host: github.com", false),
    ).toBe("repository-unreachable");
    expect(classifyRemoteFailure("fatal: transport 'file' not allowed", false)).toBe(
      "repository-unreachable",
    );
    expect(classifyRemoteFailure("Repository not found", true)).toBe("repository-unreachable");
  });
});

// ------------------------------------------- resolution, local repositories ---

// Every fixture git process runs in a built environment: nothing of the
// developer's or the runner's configuration (hooks, signing, url rewrites,
// default branch) reaches it, so the fixture is the same everywhere.
let base = "";
const fixtureEnvironment = (): Record<string, string> => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: base,
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
});

function git(cwd: string, args: readonly string[], input?: string): string {
  return execFileSync("git", args, {
    cwd,
    env: fixtureEnvironment(),
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

let older = ""; // src/a.ts has 3 lines here
let newer = ""; // src/a.ts has 5 lines here
let lazyCommit = "";
let brokenCommit = "";
let ambiguousPrefix = "";
let ambiguousCandidates: string[] = [];
let trunkCommit = "";
let sideCommit = "";
let shadowedShort = "";
let upstreamCommit = "";
let danglingHeadCommit = "";
let scratchCount = 0;

/** A fast-import stream of `count` deterministic commits on one branch. */
function fastImportStream(count: number): string {
  const parts: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const message = `commit ${i}\n`;
    const content = `${i}\n`;
    parts.push(
      `commit refs/heads/trunk\nmark :${i}\ncommitter Fixture <fixture@example.invalid> ${1_700_000_000 + i} +0000\n` +
        `data ${Buffer.byteLength(message)}\n${message}`,
    );
    if (i > 1) parts.push(`from :${i - 1}\n`);
    parts.push(`M 644 inline counter.txt\ndata ${Buffer.byteLength(content)}\n${content}\n`);
  }
  return parts.join("");
}

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "pinned-citations-test-"));

  const source = join(base, "source");
  git(base, ["init", "--quiet", "-b", "trunk", source]);
  await Bun.write(join(source, "src", "a.ts"), "one\ntwo\nthree\n");
  await Bun.write(join(source, "docs", "readme.md"), "readme\n");
  git(source, ["add", "-A"]);
  git(source, ["commit", "--quiet", "-m", "three lines"]);
  older = git(source, ["rev-parse", "HEAD"]);
  await Bun.write(join(source, "src", "a.ts"), "one\ntwo\nthree\nfour\nfive\n");
  git(source, ["commit", "--quiet", "-am", "five lines"]);
  newer = git(source, ["rev-parse", "HEAD"]);

  // A source that honours `--filter=blob:none`, so the gate's clone holds trees
  // and no blob: once this source disappears, a path is still in the tree but
  // its object cannot be fetched — the case `cat-file -e` exists for.
  const lazy = join(base, "lazy");
  git(base, ["init", "--quiet", "-b", "trunk", lazy]);
  git(lazy, ["config", "uploadpack.allowFilter", "true"]);
  await Bun.write(join(lazy, "src", "a.ts"), "one\n");
  git(lazy, ["add", "-A"]);
  git(lazy, ["commit", "--quiet", "-m", "one line"]);
  lazyCommit = git(lazy, ["rev-parse", "HEAD"]);

  // A source whose refs answer ls-remote but whose root tree is gone: the
  // clone fails after a successful probe.
  const broken = join(base, "broken");
  git(base, ["init", "--quiet", "-b", "trunk", broken]);
  await Bun.write(join(broken, "a.ts"), "one\n");
  git(broken, ["add", "-A"]);
  git(broken, ["commit", "--quiet", "-m", "one line"]);
  brokenCommit = git(broken, ["rev-parse", "HEAD"]);
  const tree = git(broken, ["rev-parse", "HEAD^{tree}"]);
  rmSync(join(broken, ".git", "objects", tree.slice(0, 2), tree.slice(2)));

  // Two commits sharing a short prefix. A collision on 7 hex characters cannot
  // be manufactured in a test; git's ambiguity rule is the same at 4, which
  // 1200 commits reach with near certainty — and the stream is deterministic,
  // so the collision is the same on every run.
  const crowded = join(base, "crowded");
  git(base, ["init", "--quiet", "--bare", crowded]);
  git(crowded, ["fast-import", "--quiet"], fastImportStream(1200));
  const byPrefix = new Map<string, string[]>();
  for (const sha of git(crowded, ["rev-list", "--all"]).split("\n")) {
    const prefix = sha.slice(0, 4);
    const known = byPrefix.get(prefix);
    if (known === undefined) byPrefix.set(prefix, [sha]);
    else known.push(sha);
  }
  for (const [prefix, shas] of byPrefix) {
    if (shas.length < 2) continue;
    ambiguousPrefix = prefix;
    ambiguousCandidates = shas;
    break;
  }

  // A served branch `trunk` and a work branch `side` carrying one more commit:
  // what a squash merge leaves behind.
  const branched = join(base, "branched");
  git(base, ["init", "--quiet", "-b", "trunk", branched]);
  await Bun.write(join(branched, "a.ts"), "one\n");
  git(branched, ["add", "-A"]);
  git(branched, ["commit", "--quiet", "-m", "on trunk"]);
  trunkCommit = git(branched, ["rev-parse", "HEAD"]);
  git(branched, ["switch", "--quiet", "-c", "side"]);
  await Bun.write(join(branched, "a.ts"), "one\ntwo\n");
  git(branched, ["commit", "--quiet", "-am", "on side"]);
  sideCommit = git(branched, ["rev-parse", "HEAD"]);
  git(branched, ["switch", "--quiet", "trunk"]);

  // A branch named like the short sha of the first commit, pointing at the
  // second: `rev-parse` answers the ref, not the object.
  const shadowed = join(base, "shadowed");
  git(base, ["init", "--quiet", "-b", "trunk", shadowed]);
  await Bun.write(join(shadowed, "a.ts"), "one\n");
  git(shadowed, ["add", "-A"]);
  git(shadowed, ["commit", "--quiet", "-m", "first"]);
  shadowedShort = git(shadowed, ["rev-parse", "--short=7", "HEAD"]);
  await Bun.write(join(shadowed, "a.ts"), "one\ntwo\n");
  git(shadowed, ["commit", "--quiet", "-am", "second"]);
  git(shadowed, ["branch", shadowedShort]);

  // A repository whose HEAD names a branch that does not exist: its bare clone
  // has no served branch to hold a citation to.
  const danglingHead = join(base, "dangling-head");
  git(base, ["init", "--quiet", "-b", "trunk", danglingHead]);
  await Bun.write(join(danglingHead, "a.ts"), "one\n");
  git(danglingHead, ["add", "-A"]);
  git(danglingHead, ["commit", "--quiet", "-m", "one"]);
  danglingHeadCommit = git(danglingHead, ["rev-parse", "HEAD"]);
  git(danglingHead, ["symbolic-ref", "HEAD", "refs/heads/nothere"]);

  // A repository named `source` under a foreign owner, distinct from the
  // organisation's `source`: the resolver must clone each on its own.
  const upstream = join(base, "owners", "upstream-owner", "source");
  git(base, ["init", "--quiet", "-b", "trunk", upstream]);
  await Bun.write(join(upstream, "tool.ts"), "upstream\n");
  git(upstream, ["add", "-A"]);
  git(upstream, ["commit", "--quiet", "-m", "upstream"]);
  upstreamCommit = git(upstream, ["rev-parse", "HEAD"]);
});

afterAll(() => {
  if (base.length > 0) rmSync(base, { recursive: true, force: true });
});

function resolver(allowProtocol = "file", maxConcurrentGit = 4): CitationResolver {
  scratchCount += 1;
  const scratch = mkdtempSync(join(base, `scratch-${scratchCount}-`));
  return new CitationResolver({
    urlFor: (repository, owner) =>
      owner === null
        ? `file://${join(base, repository)}`
        : `file://${join(base, "owners", owner, repository)}`,
    allowProtocol,
    scratch,
    timeoutMs: 60_000,
    maxConcurrentGit,
  });
}

type Cited = Pick<PinnedCitation, "repository" | "sha" | "path" | "lines">;
const cite = (sha: string, path: string | null = null, lines: string | null = null): Cited => ({
  repository: "source",
  sha,
  path,
  lines: lines === null ? null : parseLineSpec(lines),
});

describe("CitationResolver against local repositories", () => {
  test("resolves a full sha, a short sha, a path and every line form", async () => {
    const r = resolver();
    for (const citation of [
      cite(newer),
      cite(newer.slice(0, 7)),
      cite(newer, "src/a.ts"),
      cite(newer.slice(0, 7), "src/a.ts", "5"),
      cite(newer, "src/a.ts", "1-5"),
      cite(newer, "src/a.ts", "1,5"),
      cite(older, "src/a.ts", "1-3"),
      cite(older, "src"),
    ]) {
      const resolution = await r.resolve(citation);
      expect(resolution.verdict, JSON.stringify([citation, resolution])).toBe("resolved");
    }
  }, 60_000);

  test("sha-not-on-served-branch: a local pin must name a commit of the served branch", async () => {
    const r = resolver();
    const ask = (sha: string, servedBranchOnly: boolean): Promise<Resolution> =>
      r.resolve({ repository: "branched", sha, path: "a.ts", lines: null, servedBranchOnly });
    expect((await ask(trunkCommit.slice(0, 7), true)).verdict).toBe("resolved");
    const side = await ask(sideCommit.slice(0, 7), true);
    expect(side.verdict).toBe("sha-not-on-served-branch");
    expect(side.note).toContain("is not on trunk, the served branch of branched");
    // A pinned citation of another repository may still name any branch.
    expect((await ask(sideCommit.slice(0, 7), false)).verdict).toBe("resolved");
  }, 60_000);

  test("served-branch-unreadable: no served branch to hold a citation of this repository to", async () => {
    const resolution = await resolver().resolve({
      repository: "dangling-head",
      sha: danglingHeadCommit,
      path: "a.ts",
      lines: null,
      servedBranchOnly: true,
    });
    // The repository answered: this is not the network, so not `repository-unreachable`.
    expect(resolution.verdict, resolution.note).toBe("served-branch-unreadable");
    expect(resolution.note).toContain(
      "is on the served branch of dangling-head could not be decided",
    );
  }, 60_000);

  test("a foreign owner's repository is cloned apart from the organisation's of the same name", async () => {
    const r = resolver();
    const upstream = await r.resolve({
      owner: "upstream-owner",
      repository: "source",
      sha: upstreamCommit.slice(0, 7),
      path: "tool.ts",
      lines: parseLineSpec("1"),
    });
    expect(upstream.verdict).toBe("resolved");
    // The organisation's `source` does not carry that commit.
    expect((await r.resolve(cite(upstreamCommit.slice(0, 7), "tool.ts"))).verdict).toBe(
      "sha-not-found",
    );
    expect((await r.resolve(cite(newer, "src/a.ts"))).verdict).toBe("resolved");
    expect(r.repositoriesAddressed).toBe(2);
    // GitHub resolves an owner in any case and a repository with or without
    // `.git`: one clone each, whatever the spelling.
    const respelt = await r.resolve({
      owner: "UPSTREAM-OWNER",
      repository: "Source.git",
      sha: upstreamCommit,
      path: "tool.ts",
      lines: null,
    });
    expect(respelt.verdict).toBe("resolved");
    expect(r.repositoriesAddressed).toBe(2);
    const unsafe = await r.resolve({ ...cite(newer), owner: "../x" });
    expect(unsafe.verdict).toBe("invalid-citation");
  }, 60_000);

  test("sha-ambiguous: a branch named like the cited short sha never answers for it", async () => {
    const resolution = await resolver().resolve({
      repository: "shadowed",
      sha: shadowedShort,
      path: "a.ts",
      lines: null,
    });
    expect(resolution.verdict).toBe("sha-ambiguous");
    expect(resolution.note).toContain("is also the name of a branch or tag of shadowed");
  }, 60_000);

  test("repository-not-found: the repository does not exist", async () => {
    const resolution = await resolver().resolve({
      ...cite(newer),
      repository: "deleted-repository",
    });
    expect(resolution.verdict).toBe("repository-not-found");
  }, 60_000);

  test("sha-not-found: a well-formed sha the repository does not carry", async () => {
    const resolution = await resolver().resolve(cite("deadbee", "src/a.ts"));
    expect(resolution.verdict).toBe("sha-not-found");
  }, 60_000);

  test("sha-ambiguous: a short sha naming two commits", async () => {
    expect(ambiguousPrefix).toHaveLength(4);
    const resolution = await resolver().resolve({
      repository: "crowded",
      sha: ambiguousPrefix,
      path: null,
      lines: null,
    });
    expect(resolution.verdict).toBe("sha-ambiguous");
    for (const candidate of ambiguousCandidates) {
      expect(resolution.note).toContain(candidate.slice(0, 7));
    }
  }, 60_000);

  test("path-absent: the path does not exist at the cited commit", async () => {
    const r = resolver();
    expect((await r.resolve(cite(newer, "src/missing.ts"))).verdict).toBe("path-absent");
    expect((await r.resolve(cite(newer, "src/missing.ts", "1"))).verdict).toBe("path-absent");
  }, 60_000);

  test("line-range-outside-file: lines are read at the pinned commit, not at the tip", async () => {
    const r = resolver();
    const outside = await r.resolve(cite(older, "src/a.ts", "4"));
    expect(outside.verdict).toBe("line-range-outside-file");
    expect(outside.note).toContain("has 3 line(s)");
    expect((await r.resolve(cite(older, "src/a.ts", "1,9"))).verdict).toBe(
      "line-range-outside-file",
    );
    expect((await r.resolve(cite(newer, "src/a.ts", "4"))).verdict).toBe("resolved");
    // Lines cannot be cited in a directory.
    expect((await r.resolve(cite(newer, "src", "1"))).verdict).toBe("line-range-outside-file");
  }, 60_000);

  test("a transport outside the allowed one is refused by git itself", async () => {
    const resolution = await resolver("https").resolve(cite(newer, "src/a.ts"));
    expect(resolution.verdict).toBe("repository-unreachable");
    expect(resolution.note).toContain("not allowed");
  }, 60_000);

  test("an unsafe path never reaches git, even through the exported resolver", async () => {
    const resolution = await resolver().resolve(cite(newer, "../outside"));
    expect(resolution.verdict).toBe("invalid-citation");
  });

  test("a path in the tree whose object cannot be fetched is unreachable, never resolved", async () => {
    const r = resolver();
    const lazy = (path: string | null): Cited => ({
      repository: "lazy",
      sha: lazyCommit,
      path,
      lines: null,
    });
    // The first resolution clones (blobless); then the promisor disappears.
    expect((await r.resolve(lazy(null))).verdict).toBe("resolved");
    renameSync(join(base, "lazy"), join(base, "lazy-gone"));
    try {
      const resolution = await r.resolve(lazy("src/a.ts"));
      expect(resolution.verdict).toBe("repository-unreachable");
      expect(resolution.note).toContain("could not be fetched");
      // Absent stays absent: a missing path is not mistaken for a network failure.
      expect((await r.resolve(lazy("src/missing.ts"))).verdict).toBe("path-absent");
    } finally {
      renameSync(join(base, "lazy-gone"), join(base, "lazy"));
    }
  }, 60_000);

  test("a repository that answers ls-remote but cannot be cloned is unreachable", async () => {
    const resolution = await resolver().resolve({
      repository: "broken",
      sha: brokenCommit,
      path: "a.ts",
      lines: null,
    });
    expect(resolution.verdict).toBe("repository-unreachable");
    expect(resolution.note).toContain("answered ls-remote but could not be cloned");
  }, 60_000);

  test("no more git processes run at once than the cap", async () => {
    const r = resolver("file", 2);
    const citations = [
      cite(newer, "src/a.ts", "1"),
      cite(newer, "src/a.ts", "2"),
      cite(older, "src/a.ts", "3"),
      cite(newer, "docs/readme.md", "1"),
      cite(older, "docs/readme.md"),
      cite(newer.slice(0, 9)),
    ];
    const resolutions = await Promise.all(citations.map((citation) => r.resolve(citation)));
    expect(resolutions.map((resolution) => resolution.verdict)).toEqual(
      citations.map(() => "resolved"),
    );
    expect(r.peakConcurrentGit).toBeGreaterThanOrEqual(1);
    expect(r.peakConcurrentGit).toBeLessThanOrEqual(2);
  }, 60_000);
});

// ------------------------------------------------------------- verdict ---

const CONFIG: PinnedCitationsConfig = {
  organization: ORG,
  scope: ["docs/"],
  adr: {
    directory: "docs/adr/",
    bareCitationsGuardedAbove: 10,
    unnumbered: [],
    extensions: ["ts", "md"],
  },
  exemptions: [
    {
      file: "docs/specifications/S.md",
      citation: "libre-ai/ai-work-supervision@0123456789abcdef0123456789abcdef01234567:docs/prd.md",
      because: "fictitious example",
    },
  ],
  foreignOwners: [],
};

/** A resolver that answers from a table, so the verdict logic runs without git. */
interface TableResolver {
  readonly asked: string[];
  /** Whether each asked citation required the served branch, in the order asked. */
  readonly servedOnly: boolean[];
  readonly resolve: (citation: Asked) => Promise<Resolution>;
}

function tableResolver(table: Record<string, Resolution>): TableResolver {
  const asked: string[] = [];
  const servedOnly: boolean[] = [];
  return {
    asked,
    servedOnly,
    resolve: async (citation: Asked): Promise<Resolution> => {
      // A foreign owner is part of the key: `<owner>/<repository>@<sha>`.
      const owner = citation.owner ?? null;
      const key = `${owner === null ? "" : `${owner}/`}${citation.repository}@${citation.sha}`;
      asked.push(key);
      servedOnly.push(citation.servedBranchOnly === true);
      return table[key] ?? { verdict: "sha-not-found", note: "absent from the table" };
    },
  };
}

const trackedHere = new Set(["docs/a.md", "tools/x.ts"]);
const readTracked = async (path: string): Promise<string | null> =>
  path === "docs/a.md" ? "1\n2\n3\n" : path === "tools/x.ts" ? "x\n" : null;

describe("evaluateCitations", () => {
  test("volume sums: resolved + exempted + failed = examined, failures named by verdict", async () => {
    const files = [
      {
        path: "docs/specifications/S.md",
        text: [
          "libre-ai/live@abcdef1:a.ts:1",
          "libre-ai/gone@abcdef2:b.ts",
          "libre-ai/ai-work-supervision@0123456789abcdef0123456789abcdef01234567:docs/prd.md",
          "libre-ai/live@ABCDEF1",
        ].join("\n"),
      },
    ];
    const fake = tableResolver({
      "live@abcdef1": { verdict: "resolved", note: "ok" },
      "gone@abcdef2": { verdict: "repository-not-found", note: "deleted" },
    });
    const { report, volume } = await evaluateCitations(
      { config: CONFIG, files, tracked: trackedHere, readTracked, selfRepository: SELF },
      fake,
    );
    expect(volume.pinned).toBe(4);
    expect(volume.pinnedResolved + volume.pinnedExempted + volume.pinnedFailed).toBe(volume.pinned);
    expect([volume.pinnedResolved, volume.pinnedExempted, volume.pinnedFailed]).toEqual([1, 1, 2]);
    expect(volume.byVerdict).toEqual({
      resolved: 1,
      "repository-not-found": 1,
      "invalid-citation": 1,
    });
    // The exempted citation is asked too, so a citation that resolves again is caught;
    // the invalid one never reaches the resolver.
    expect(fake.asked).toEqual([
      "live@abcdef1",
      "gone@abcdef2",
      "ai-work-supervision@0123456789abcdef0123456789abcdef01234567",
    ]);
    expect(volume.found).toBe(4);
    expect(report.outcome).toBe("violations");
    expect(report.violations.some((v) => v.includes("repository-not-found: deleted"))).toBe(true);
    expect(report.violations.some((v) => v.includes("independent walk"))).toBe(false);
    expect(report.volumeSummary).toContain("4 pinned citation(s) examined in 1 tracked file(s)");
    expect(report.volumeSummary).toContain("= 1 resolved + 1 exempted (with reason) + 2 failed");
    expect(report.volumeSummary).toContain(
      "against 4 candidate segment(s) (159 character(s)) found by an independent walk",
    );
  });

  test("an invalid citation passes only when listed with a reason, and counts as exempted", async () => {
    // A template, not a sha: invalid by the grammar, so only the exemption saves it.
    const written = "libre-ai/governance/.github/...@<sha>";
    const config: PinnedCitationsConfig = {
      ...CONFIG,
      exemptions: [
        {
          file: "docs/design.md",
          citation: written,
          because: "a placeholder for an action pin, naming no commit",
        },
      ],
    };
    const files = [
      { path: "docs/design.md", text: `pinned by sha (\`uses: ${written}\`) — a bump` },
    ];
    const fake = tableResolver({});
    const { report, volume } = await evaluateCitations(
      { config, files, tracked: trackedHere, readTracked, selfRepository: SELF },
      fake,
    );
    expect(report.outcome).toBe("pass");
    expect([volume.found, volume.pinned, volume.pinnedExempted, volume.pinnedFailed]).toEqual([
      1, 1, 1, 0,
    ]);
    expect(report.checks.map((check) => check.note)).toEqual([
      "exempt: a placeholder for an action pin, naming no commit",
    ]);
    // An invalid citation never reaches git.
    expect(fake.asked).toEqual([]);
  });

  test("reconciliation fails on the number of segments, their text, or the verdicts given", () => {
    const walk = ["libre-ai/x@abcdef1*docs/x.md", "libre-ai/y@abcdef2"];
    expect(reconcileCandidates(walk, walk, 2)).toBeNull();
    // Same count, different text: a parser that cut the first segment at `*`.
    expect(reconcileCandidates(walk, ["libre-ai/x@abcdef1", "libre-ai/y@abcdef2"], 2)).toBe(
      'the independent walk found 2 candidate segment(s) (47 character(s)), the parser judged 2 (37 character(s)) and 2 received a verdict; first difference at segment 1: walk "libre-ai/x@abcdef1*docs/x.md", parser "libre-ai/x@abcdef1"',
    );
    // A segment the parser does not judge.
    expect(reconcileCandidates(walk, walk.slice(0, 1), 1)).toContain("the parser judged 1");
    // A segment judged but given no verdict.
    expect(reconcileCandidates(walk, walk, 1)).toContain("and 1 received a verdict");
  });

  test("the reconciliation holds on every character a parser could split on, and on every candidate edge", async () => {
    // One fixture for the whole class: each line carries a character that a
    // parser splitting on more than whitespace (M02-M09) would cut at, or a
    // segment a different candidate test (M20-M22) would admit or miss.
    const config: PinnedCitationsConfig = { ...CONFIG, exemptions: [] };
    const files = [
      {
        path: "docs/a.md",
        text: [
          "libre-ai/x@abcdef1*docs/x.md",
          "libre-ai/x@abcdef1:package.json(9999)",
          "libre-ai/x@abcdef1|docs/x.md",
          "libre-ai/x@abcdef1'#L9999",
          "libre-ai/x@abcdef1:package.json<9999>",
          "libre-ai/x@abcdef1{~1}:package.json",
          "libre-ai/x@abcdef1[0]:package.json:9999",
          '"libre-ai/x@abcdef1:package.json":9999',
          "libre-ai/project-governance names a repository",
          "git@github.com:libre-ai/x.git puts its '@' first",
          "_libre-ai/x@abcdef1:a.ts_ and see.libre-ai/x@abcdef1",
        ].join("\n"),
      },
    ];
    const { report, volume } = await evaluateCitations(
      { config, files, tracked: trackedHere, readTracked, selfRepository: SELF },
      tableResolver({}),
    );
    const reconciliation = report.checks.filter((check) => check.item === "pinned citations");
    expect(reconciliation).toEqual([]);
    expect([volume.found, volume.pinned]).toEqual([10, 10]);
  });

  test("the quote pair is a wrapping only when it encloses the whole citation", () => {
    // Split on `"`, a parser would resolve `…:package.json` and drop `:9999`.
    const { pinned, rejected } = scanText(
      '"libre-ai/project-governance@c466a5c:package.json":9999',
      ORG,
      [],
    );
    expect(pinned).toEqual([]);
    expect(rejected.map((r) => [r.text, r.reason])).toEqual([
      [
        '"libre-ai/project-governance@c466a5c:package.json":9999',
        "'\"' is written against libre-ai/: a citation is wrapped only in backticks, emphasis, brackets, parentheses or quotes",
      ],
    ]);
  });

  test("a citation ending in ':' is refused: its path would be in the next segment", () => {
    const { pinned, rejected } = scanText("libre-ai/x@c466a5c: package.json:9999", ORG, []);
    expect(pinned).toEqual([]);
    expect(rejected.map((r) => [r.text, r.reason])).toEqual([
      [
        "libre-ai/x@c466a5c:",
        "the citation ends with ':': a ':' introduces a path or a line spec, written in the same segment",
      ],
    ]);
  });

  test("every segment the independent walk sees is examined: found equals examined", async () => {
    const config: PinnedCitationsConfig = { ...CONFIG, exemptions: [] };
    const files = [
      {
        path: "docs/a.md",
        text: [
          "libre-ai/live@abcdef1 and `libre-ai/live@abcdef1:a.ts:1`.",
          "libre-ai/a/b@abcdef1 libre-ai/x@v2 libre-ai/x@abcdef1q (libre-ai/x@abcdef1#L3)",
          "@libre-ai/ui@1.0.0 and github.com/libre-ai/x@abcdef1 and libre-ai/project-governance",
        ].join("\n"),
      },
    ];
    const { report, volume } = await evaluateCitations(
      { config, files, tracked: trackedHere, readTracked, selfRepository: SELF },
      tableResolver({ "live@abcdef1": { verdict: "resolved", note: "ok" } }),
    );
    // 8 candidates: 2 resolve; `a/b@…` is a valid action reference the table does
    // not know (sha-not-found); `@v2`, `@abcdef1q`, `#L3`, `@libre-ai/…` and
    // `github.com/libre-ai/…` are invalid. The bare repository mention is no candidate.
    expect([volume.found, volume.pinned, volume.pinnedResolved, volume.pinnedFailed]).toEqual([
      8, 8, 2, 6,
    ]);
    expect(report.violations.some((v) => v.includes("independent walk"))).toBe(false);
  });

  test("an exemption whose citation resolves again fails", async () => {
    const config: PinnedCitationsConfig = {
      ...CONFIG,
      exemptions: [
        { file: "docs/a.md", citation: "libre-ai/restored@abcdef1", because: "deleted 2026-09-16" },
      ],
    };
    const { report, volume } = await evaluateCitations(
      {
        config,
        files: [{ path: "docs/a.md", text: "libre-ai/restored@abcdef1" }],
        tracked: trackedHere,
        readTracked,
        selfRepository: SELF,
      },
      tableResolver({ "restored@abcdef1": { verdict: "resolved", note: "commit abcdef1…" } }),
    );
    expect(report.outcome).toBe("violations");
    expect(volume.byVerdict).toEqual({ "exemption-now-resolves": 1 });
    expect(report.violations[0]).toContain(
      'exemption-now-resolves: commit abcdef1… — remove the exemption ("deleted 2026-09-16")',
    );
  });

  test("a citation of a deleted repository passes only when listed with a reason", async () => {
    const files = [{ path: "docs/a.md", text: "libre-ai/gone@abcdef2" }];
    const fake = tableResolver({
      "gone@abcdef2": { verdict: "repository-not-found", note: "deleted" },
    });
    const red = await evaluateCitations(
      { config: CONFIG, files, tracked: trackedHere, readTracked, selfRepository: SELF },
      fake,
    );
    expect(
      red.report.violations.some((v) => v.startsWith("docs/a.md:1 libre-ai/gone@abcdef2")),
    ).toBe(true);

    const listed: PinnedCitationsConfig = {
      ...CONFIG,
      exemptions: [
        {
          file: "docs/a.md",
          citation: "libre-ai/gone@abcdef2",
          because: "deleted 2026-09-16, kept as history",
        },
      ],
    };
    const green = await evaluateCitations(
      { config: listed, files, tracked: trackedHere, readTracked, selfRepository: SELF },
      fake,
    );
    expect(green.report.outcome).toBe("pass");
    expect(green.report.checks[0]?.note).toBe(
      "exempt: deleted 2026-09-16, kept as history (still repository-not-found)",
    );
  });

  test("an exemption matching nothing fails", async () => {
    const files = [{ path: "docs/a.md", text: "libre-ai/live@abcdef1" }];
    const fake = tableResolver({ "live@abcdef1": { verdict: "resolved", note: "ok" } });
    const { report } = await evaluateCitations(
      { config: CONFIG, files, tracked: trackedHere, readTracked, selfRepository: SELF },
      fake,
    );
    expect(report.violations).toEqual([
      "docs/specifications/S.md: libre-ai/ai-work-supervision@0123456789abcdef0123456789abcdef01234567:docs/prd.md: exemption matches no citation in that file — remove it, an unused permission is checked by nobody",
    ]);
  });

  test("an exemption covers its own file only: the same citation elsewhere is judged", async () => {
    const citation =
      "libre-ai/ai-work-supervision@0123456789abcdef0123456789abcdef01234567:docs/prd.md";
    const files = [
      { path: "docs/specifications/S.md", text: citation },
      { path: "docs/other.md", text: citation },
    ];
    const { report, volume } = await evaluateCitations(
      { config: CONFIG, files, tracked: trackedHere, readTracked, selfRepository: SELF },
      tableResolver({}),
    );
    expect([volume.pinnedExempted, volume.pinnedFailed]).toEqual([1, 1]);
    expect(report.violations).toEqual([
      `docs/other.md:1 ${citation}: sha-not-found: absent from the table`,
    ]);
  });

  test("an empty scope and an unreadable file are failures, never zeros", async () => {
    const fake = tableResolver({});
    const empty = await evaluateCitations(
      { config: CONFIG, files: [], tracked: trackedHere, readTracked, selfRepository: SELF },
      fake,
    );
    expect(empty.report.outcome).toBe("violations");
    expect(empty.report.violations.join("\n")).toContain(
      "the declared scope holds no tracked file",
    );

    const unreadable = await evaluateCitations(
      {
        config: CONFIG,
        files: [{ path: "docs/x.md", text: null }],
        tracked: trackedHere,
        readTracked,
        selfRepository: SELF,
      },
      fake,
    );
    expect(unreadable.volume.filesUnreadable).toBe(1);
    expect(unreadable.report.violations.join("\n")).toContain(
      "docs/x.md: tracked file under the scope could not be read",
    );
  });

  test("a scope with files but no citation asserts nothing, and that fails", async () => {
    const config: PinnedCitationsConfig = { ...CONFIG, exemptions: [] };
    const { report } = await evaluateCitations(
      {
        config,
        files: [{ path: "docs/a.md", text: "no citation" }],
        tracked: trackedHere,
        readTracked,
        selfRepository: SELF,
      },
      tableResolver({}),
    );
    expect(report.outcome).toBe("empty");
  });

  test("bare citations: judged above the threshold, counted below it", async () => {
    const config: PinnedCitationsConfig = { ...CONFIG, exemptions: [] };
    const files = [
      {
        path: "docs/adr/0011-new.md",
        text: [
          "resolves: `docs/a.md:3`",
          "outside: `docs/a.md:2-4`",
          "elsewhere: `packages/core/src/x.ts:12`",
          "unqualified: `schemas-and-contracts@a82d7b5:packages/envelope/src/index.ts:180`",
          "pinned: libre-ai/live@abcdef1:packages/core/src/x.ts:12",
        ].join("\n"),
      },
      {
        path: "docs/adr/0010-old.md",
        text: "`docs/a.md:3` and `packages/core/src/x.ts:12` and governance@33dcc5a",
      },
      {
        path: "docs/notes.md",
        text: "`packages/core/src/x.ts:12` is not an ADR; orchestrator@1004b04",
      },
    ];
    const { report, volume, information } = await evaluateCitations(
      { config, files, tracked: trackedHere, readTracked, selfRepository: SELF },
      tableResolver({ "live@abcdef1": { verdict: "resolved", note: "ok" } }),
    );
    expect([
      volume.guardedAdrs,
      volume.guardedBare,
      volume.guardedBareResolved,
      volume.guardedBareFailed,
    ]).toEqual([1, 3, 1, 2]);
    expect(volume.guardedUnqualified).toBe(1);
    expect([
      volume.legacyAdrs,
      volume.legacyBare,
      volume.legacyBareResolving,
      volume.legacyBareUnverifiable,
    ]).toEqual([1, 2, 1, 1]);
    expect(volume.unjudgedUnqualified).toBe(2);
    const failed = report.violations.join("\n");
    expect(failed).toContain("docs/adr/0011-new.md:2 docs/a.md:2-4");
    expect(failed).toContain("has 3 line(s); cited 2-4 lie outside");
    expect(failed).toContain("docs/adr/0011-new.md:3 packages/core/src/x.ts:12");
    expect(failed).toContain("pin it as libre-ai/<repository>@<sha>:packages/core/src/x.ts:12");
    expect(failed).toContain("docs/adr/0011-new.md:4 schemas-and-contracts@a82d7b5");
    // Nothing of the legacy ADR or of the non-ADR file is judged.
    expect(failed).not.toContain("0010-old.md");
    expect(failed).not.toContain("docs/notes.md");
    expect(information[0]).toContain(
      "1 ADR(s) at or below 10 carry 2 bare path:line citation(s); 1 resolve",
    );
    expect(information[1]).toContain("2 unqualified pin(s)");
  });

  test("local and foreign pins: judged above the threshold, exempted by data, counted below it", async () => {
    const config: PinnedCitationsConfig = {
      ...CONFIG,
      exemptions: [
        {
          file: "docs/adr/0011-new.md",
          citation: "ed25519:AAAAC3NzaC1lZDI1NTE5",
          because: "a key type written in prose, not a commit",
        },
      ],
      foreignOwners: [{ owner: "tt-a1i", because: "upstream of a drill" }],
    };
    const files = [
      {
        path: "docs/adr/0011-new.md",
        text: [
          "resolves: `c466a5c:AGENTS.md:80`",
          "not here: `abcdef9:docs/a.md`",
          "malformed: `c466a5c:AGENTS.md:9-3`",
          `pinned: libre-ai/live@abcdef1 and libre-ai/${SELF}@c466a5c:AGENTS.md`,
          "listed owner: `tt-a1i/archify@25cf370:AGENTS.md:15`; unlisted: `someone/x@abcdef2:a.md`; listed, not there: `tt-a1i/archify@deadbee:AGENTS.md`",
          "the organisation in another case: `Libre-AI/live@abcdef1:a.md`",
          "a key type in prose: ed25519:AAAAC3NzaC1lZDI1NTE5",
        ].join("\n"),
      },
      {
        path: "docs/adr/0010-old.md",
        text: "`abcdef9:docs/a.md:3`, `c466a5c:x.ts`, `C466A5C:x.ts` and tt-a1i/archify@25cf370:README.md",
      },
      { path: "docs/notes.md", text: "`abcdef9:docs/a.md:3` is not in an ADR" },
    ];
    const fake = tableResolver({
      "live@abcdef1": { verdict: "resolved", note: "ok" },
      [`${SELF}@c466a5c`]: { verdict: "resolved", note: "AGENTS.md:80 lies in its 80 line(s)" },
      "tt-a1i/archify@25cf370": { verdict: "resolved", note: "AGENTS.md:15 lies in it" },
    });
    const { report, volume, information } = await evaluateCitations(
      { config, files, tracked: trackedHere, readTracked, selfRepository: SELF },
      fake,
    );
    expect(volume.guardedLocal).toEqual({ resolved: 1, exempted: 1, failed: 3 });
    expect(volume.guardedForeign).toEqual({ resolved: 1, exempted: 0, failed: 2 });
    // The refused `C466A5C:x.ts` of the legacy ADR is counted too.
    expect([volume.legacyLocal, volume.legacyForeign]).toEqual([3, 1]);
    // A citation of this repository, local or qualified, is held to the served
    // branch; another repository's, of the organisation or a listed owner, is
    // not. The unlisted owner and the refused candidates are never asked.
    expect(fake.asked).toEqual([
      "live@abcdef1",
      `${SELF}@c466a5c`,
      `${SELF}@c466a5c`,
      `${SELF}@abcdef9`,
      `${SELF}@ed25519`,
      "tt-a1i/archify@25cf370",
      "tt-a1i/archify@deadbee",
    ]);
    expect(fake.servedOnly).toEqual([false, true, true, true, true, false, false]);
    // A local pin is neither bare nor unqualified: no other counter sees it.
    expect([volume.guardedBare, volume.guardedUnqualified, volume.legacyBare]).toEqual([0, 0, 0]);
    expect(report.violations).toEqual([
      "docs/adr/0011-new.md:2 abcdef9:docs/a.md: local pin in an ADR above 10: sha-not-found: absent from the table",
      "docs/adr/0011-new.md:3 c466a5c:AGENTS.md:9-3: invalid pin in an ADR above 10: '9-3' is not a line spec (L, a-b, a,b; 1-based, a <= b)",
      "docs/adr/0011-new.md:6 Libre-AI/live@abcdef1:a.md: invalid pin in an ADR above 10: 'Libre-AI' is the organisation written in another case: write libre-ai/live@…",
      `docs/adr/0011-new.md:5 someone/x@abcdef2:a.md: pin of another owner in an ADR above 10: someone is not a listed foreign owner: list it in foreignOwners of ${CONFIG_PATH} with a reason, so its repositories can be asked`,
      // A listed owner is asked, and what it does not carry fails like any pin.
      "docs/adr/0011-new.md:5 tt-a1i/archify@deadbee:AGENTS.md: pin of another owner in an ADR above 10: sha-not-found: absent from the table",
    ]);
    expect(report.volumeSummary).toContain(
      `local pins (<sha>:<path>, asked of libre-ai/${SELF}; refused candidates included) there: ` +
        "5 examined = 1 resolved + 1 exempted (with reason) + 3 failed",
    );
    expect(report.volumeSummary).toContain(
      "pins of another owner there (1 owner(s) listed, 1 cited): 3 examined = 1 resolved + 0 exempted (with reason) + 2 failed",
    );
    expect(information[2]).toContain("3 local pin(s) (<sha>:<path>, repository implicit)");
    expect(information[3]).toContain("1 pin(s) of another owner");
  });

  test("an exempt local pin that resolves fails, and so does a listed owner nobody cites", async () => {
    const config: PinnedCitationsConfig = {
      ...CONFIG,
      exemptions: [
        { file: "docs/adr/0011-new.md", citation: "c466a5c:AGENTS.md:80", because: "was missing" },
      ],
      foreignOwners: [{ owner: "nobody-cites", because: "listed in advance" }],
    };
    const { report } = await evaluateCitations(
      {
        config,
        files: [{ path: "docs/adr/0011-new.md", text: "`c466a5c:AGENTS.md:80`" }],
        tracked: trackedHere,
        readTracked,
        selfRepository: SELF,
      },
      tableResolver({ [`${SELF}@c466a5c`]: { verdict: "resolved", note: "it resolves" } }),
    );
    expect(report.violations).toEqual([
      'docs/adr/0011-new.md:1 c466a5c:AGENTS.md:80: exemption-now-resolves: it resolves — remove the exemption ("was missing")',
      "foreignOwners: nobody-cites: listed foreign owner cited by no ADR above 10 — remove it, an unused permission is checked by nobody",
    ]);
  });

  test("an exemption never lets an unlisted owner's pin pass, and an owner cited only below the threshold is unused", async () => {
    const config: PinnedCitationsConfig = {
      ...CONFIG,
      exemptions: [
        { file: "docs/adr/0011-new.md", citation: "octocat/x@abcdef1:a.md", because: "tried" },
      ],
      foreignOwners: [{ owner: "old-only", because: "cited by an older ADR" }],
    };
    const fake = tableResolver({});
    const { report, volume } = await evaluateCitations(
      {
        config,
        files: [
          { path: "docs/adr/0011-new.md", text: "`octocat/x@abcdef1:a.md`" },
          { path: "docs/adr/0010-old.md", text: "`old-only/x@abcdef1:a.md`" },
        ],
        tracked: trackedHere,
        readTracked,
        selfRepository: SELF,
      },
      fake,
    );
    expect(fake.asked).toEqual([]);
    expect(volume.guardedForeign).toEqual({ resolved: 0, exempted: 0, failed: 1 });
    expect(volume.legacyForeign).toBe(1);
    expect(report.violations).toEqual([
      `docs/adr/0011-new.md:1 octocat/x@abcdef1:a.md: pin of another owner in an ADR above 10: octocat is not a listed foreign owner: list it in foreignOwners of ${CONFIG_PATH} with a reason, so its repositories can be asked`,
      "foreignOwners: old-only: listed foreign owner cited by no ADR above 10 — remove it, an unused permission is checked by nobody",
      "docs/adr/0011-new.md: octocat/x@abcdef1:a.md: exemption matches no citation in that file — remove it, an unused permission is checked by nobody",
    ]);
  });

  test("this repository in any spelling is held to its served branch, and owners match in any case", async () => {
    const asked: string[] = [];
    const everything = {
      resolve: async (citation: Asked): Promise<Resolution> => {
        asked.push(
          `${citation.owner ?? ""}/${citation.repository} served=${citation.servedBranchOnly === true}`,
        );
        return { verdict: "resolved", note: "ok" };
      },
    };
    const { report } = await evaluateCitations(
      {
        config: { ...CONFIG, exemptions: [], foreignOwners: [{ owner: "tt-a1i", because: "r" }] },
        files: [
          {
            path: "docs/adr/0011-new.md",
            text: [
              "`libre-ai/This-Repository@c466a5c:AGENTS.md`",
              "`libre-ai/this-repository.git@c466a5c:AGENTS.md`",
              "`libre-ai/other@c466a5c:AGENTS.md`",
              "`TT-A1I/archify@25cf370:AGENTS.md:15`",
            ].join("\n"),
          },
        ],
        tracked: trackedHere,
        readTracked,
        selfRepository: SELF,
      },
      everything,
    );
    expect(asked).toEqual([
      "/This-Repository served=true",
      "/this-repository.git served=true",
      "/other served=false",
      "TT-A1I/archify served=false",
    ]);
    expect(report.violations).toEqual([]);
  });

  test("a local pin fails when the name of this repository could not be derived", async () => {
    const config: PinnedCitationsConfig = { ...CONFIG, exemptions: [] };
    const fake = tableResolver({});
    const { report, volume } = await evaluateCitations(
      {
        config,
        files: [{ path: "docs/adr/0011-new.md", text: "`c466a5c:AGENTS.md:80`" }],
        tracked: trackedHere,
        readTracked,
        selfRepository: null,
      },
      fake,
    );
    expect(volume.guardedLocal).toEqual({ resolved: 0, exempted: 0, failed: 1 });
    expect(fake.asked).toEqual([]);
    expect(report.violations).toEqual([
      "docs/adr/0011-new.md:1 c466a5c:AGENTS.md:80: local pin in an ADR above 10: the name of this repository could not be derived from its origin remote, so no repository can be asked: write libre-ai/<repository>@c466a5c:AGENTS.md",
    ]);
    expect(report.volumeSummary).toContain("asked of an underived repository");
  });

  test("a bare citation of a tracked file that cannot be read fails, never resolves", async () => {
    const config: PinnedCitationsConfig = { ...CONFIG, exemptions: [] };
    const tracked = new Set(["docs/a.md", "docs/unreadable.md"]);
    const files = [
      {
        path: "docs/adr/0011-new.md",
        text: "pinned: libre-ai/live@abcdef1 and bare: `docs/unreadable.md:1`",
      },
    ];
    const { report, volume } = await evaluateCitations(
      { config, files, tracked, readTracked, selfRepository: SELF },
      tableResolver({ "live@abcdef1": { verdict: "resolved", note: "ok" } }),
    );
    expect([volume.guardedBare, volume.guardedBareResolved, volume.guardedBareFailed]).toEqual([
      1, 0, 1,
    ]);
    expect(report.violations).toEqual([
      "docs/adr/0011-new.md:1 docs/unreadable.md:1: bare citation in an ADR above 10: docs/unreadable.md is tracked but could not be read",
    ]);
  });

  test("a listed unnumbered ADR that is not tracked fails", async () => {
    const config: PinnedCitationsConfig = {
      ...CONFIG,
      exemptions: [],
      adr: {
        ...CONFIG.adr,
        unnumbered: [{ path: "docs/adr/2026-01-01-gone.md", because: "legacy" }],
      },
    };
    const { report } = await evaluateCitations(
      {
        config,
        files: [{ path: "docs/a.md", text: "libre-ai/live@abcdef1" }],
        tracked: trackedHere,
        readTracked,
        selfRepository: SELF,
      },
      tableResolver({ "live@abcdef1": { verdict: "resolved", note: "ok" } }),
    );
    expect(report.violations.join("\n")).toContain(
      "docs/adr/2026-01-01-gone.md: listed as an unnumbered legacy ADR",
    );
  });
});

// ---------------------------------------------------------------- config ---

describe("validateConfig", () => {
  test("refuses an exemption without a reason, or listed twice", () => {
    expect(() =>
      validateConfig({
        ...CONFIG,
        exemptions: [{ file: "docs/a.md", citation: "libre-ai/x@abcdef1", because: " " }],
      }),
    ).toThrow("non-empty because");
    expect(() =>
      validateConfig({ ...CONFIG, exemptions: [{ citation: "libre-ai/x@abcdef1", because: "r" }] }),
    ).toThrow("needs a file");
    const twice = { file: "docs/a.md", citation: "libre-ai/x@abcdef1", because: "r" };
    expect(() => validateConfig({ ...CONFIG, exemptions: [twice, twice] })).toThrow(
      "duplicate exemption",
    );
  });

  test("refuses a foreign owner without a reason, unsafe, the organisation, or listed twice", () => {
    const owner = (name: string, because = "r") => ({
      ...CONFIG,
      foreignOwners: [{ owner: name, because }],
    });
    expect(() => validateConfig(owner("tt-a1i", " "))).toThrow("non-empty because");
    expect(() => validateConfig(owner("../x"))).toThrow("GitHub owner name");
    expect(() => validateConfig(owner("-x"))).toThrow("GitHub owner name");
    expect(() => validateConfig({ ...CONFIG, foreignOwners: undefined })).toThrow("foreign owner");
    // Owner names are case-insensitive on GitHub.
    expect(() => validateConfig(owner("Libre-AI"))).toThrow("is the organisation itself");
    expect(() =>
      validateConfig({
        ...CONFIG,
        foreignOwners: [
          { owner: "tt-a1i", because: "r" },
          { owner: "TT-A1I", because: "r" },
        ],
      }),
    ).toThrow("duplicate foreign owner");
    expect(validateConfig(owner("tt-a1i")).foreignOwners).toEqual([
      { owner: "tt-a1i", because: "r" },
    ]);
    expect(() =>
      validateConfig({
        ...CONFIG,
        foreignOwners: [{ owner: "tt-a1i", because: "r", host: "evil.example" }],
      }),
    ).toThrow("unknown key(s): host");
  });

  test("refuses a scope that is not a list of directories", () => {
    expect(() => validateConfig({ ...CONFIG, scope: [] })).toThrow("scope");
    expect(() => validateConfig({ ...CONFIG, scope: ["docs"] })).toThrow("scope");
  });

  test("the committed data file is valid, and its threshold names an ADR that exists", async () => {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    const config = validateConfig(await Bun.file(join(root, CONFIG_PATH)).json());
    const adrs = execFileSync("git", ["ls-files", "--", config.adr.directory], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    const numbers = adrs
      .map((path) => /^(\d{4})-[a-z]/i.exec(path.slice(config.adr.directory.length))?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number);
    expect(numbers).toContain(config.adr.bareCitationsGuardedAbove);
    for (const entry of config.adr.unnumbered) expect(adrs).toContain(entry.path);
  });
});
