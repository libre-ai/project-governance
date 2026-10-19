import { describe, expect, test } from "bun:test";
import {
  type Declaration,
  evaluateWorkPackageLink,
  exemptionHolds,
  type Fact,
  type LinkPorts,
  type PrFacts,
  readLinkDeclaration,
} from "./check-work-package-link";
import type { ExemptRule, WorkPackagePolicy } from "./work-package-policy";

const FENCE = "`".repeat(3);
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);

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
  body: "",
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  ...overrides,
});

const unused = (name: string) => async (): Promise<never> => {
  throw new Error(`port ${name} must not be called by the skeleton`);
};

function portsWith(
  changed: Fact<readonly string[]>,
  seen: Array<[string, string]> = [],
): LinkPorts {
  return {
    readIssue: unused("readIssue"),
    readFileAt: unused("readFileAt"),
    isAncestorOfServedHead: unused("isAncestorOfServedHead"),
    changedFiles: async (baseSha, headSha) => {
      seen.push([baseSha, headSha]);
      return changed;
    },
  };
}

describe("readLinkDeclaration", () => {
  test("exactly one Work-package line is a link", () => {
    expect(
      readLinkDeclaration("## Summary\n\nWork-package: libre-ai/product-research#12 WP-3\n"),
    ).toEqual({ kind: "link", repo: "libre-ai/product-research", issue: 12, wp: "WP-3" });
  });

  test("exactly one Exempt line is an exemption", () => {
    expect(readLinkDeclaration("Exempt: docs-only\n")).toEqual({
      kind: "exempt",
      cls: "docs-only",
    });
  });

  test("an empty description names zero declaration lines", () => {
    const declaration = readLinkDeclaration("");
    expect(declaration.kind).toBe("invalid");
    expect(declaration.kind === "invalid" && declaration.reason).toContain("0 declaration line");
  });

  test("a description without any declaration names zero declaration lines", () => {
    const declaration = readLinkDeclaration("## Summary\nA fix.\n\nDoor: two-way\n");
    expect(declaration.kind === "invalid" && declaration.reason).toContain("0 declaration line");
  });

  test("two Work-package lines name the count, even when they agree", () => {
    const line = "Work-package: libre-ai/x#1 WP-1";
    const declaration = readLinkDeclaration(`${line}\n${line}\n`);
    expect(declaration.kind).toBe("invalid");
    expect(declaration.kind === "invalid" && declaration.reason).toContain("2 declaration line");
  });

  test("a Work-package line and an Exempt line are one declaration too many", () => {
    const declaration = readLinkDeclaration("Work-package: libre-ai/x#1 WP-1\nExempt: docs-only\n");
    expect(declaration.kind).toBe("invalid");
    expect(declaration.kind === "invalid" && declaration.reason).toContain("2 declaration line");
  });

  test("two Exempt lines are refused", () => {
    expect(readLinkDeclaration("Exempt: revert\nExempt: revert\n").kind).toBe("invalid");
  });

  test("a Work-package line inside an HTML comment is ignored", () => {
    const declaration = readLinkDeclaration(
      "<!--\nWork-package: <owner>/<repo>#<n> WP-<k>\n-->\nExempt: revert\n",
    );
    expect(declaration).toEqual({ kind: "exempt", cls: "revert" });
  });

  test("a Work-package line inside a fenced block is ignored", () => {
    const body = `Example:\n${FENCE}text\nWork-package: libre-ai/x#1 WP-1\n${FENCE}\nWork-package: libre-ai/y#2 WP-2\n`;
    expect(readLinkDeclaration(body)).toEqual({
      kind: "link",
      repo: "libre-ai/y",
      issue: 2,
      wp: "WP-2",
    });
  });

  test("a declaration only inside a comment leaves zero lines", () => {
    const declaration = readLinkDeclaration("<!-- Work-package: libre-ai/x#1 WP-1 -->\n");
    expect(declaration.kind === "invalid" && declaration.reason).toContain("0 declaration line");
  });

  test("an unterminated comment hides what follows it", () => {
    expect(readLinkDeclaration("<!-- never closed\nWork-package: libre-ai/x#1 WP-1\n").kind).toBe(
      "invalid",
    );
  });

  test("CRLF line ends are read as line ends", () => {
    expect(readLinkDeclaration("Summary\r\nExempt: revert\r\n")).toEqual({
      kind: "exempt",
      cls: "revert",
    });
  });

  test("leading indentation before the keyword is tolerated, as for Door", () => {
    expect(readLinkDeclaration("  Exempt: revert\n")).toEqual({ kind: "exempt", cls: "revert" });
  });

  test.each([
    ["the template placeholder left as is", "Work-package: <owner>/<repo>#<n> WP-<k>"],
    ["issue number zero", "Work-package: libre-ai/x#0 WP-1"],
    ["issue number with a leading zero", "Work-package: libre-ai/x#01 WP-1"],
    [
      "issue number beyond the safe integer range",
      "Work-package: libre-ai/x#99999999999999999999 WP-1",
    ],
    ["WP-0", "Work-package: libre-ai/x#1 WP-0"],
    ["WP-01", "Work-package: libre-ai/x#1 WP-01"],
    ["a lowercase WP prefix", "Work-package: libre-ai/x#1 wp-1"],
    ["a mixed-case WP prefix", "Work-package: libre-ai/x#1 Wp-1"],
    ["an extra space after the colon", "Work-package:  libre-ai/x#1 WP-1"],
    ["an extra space before WP", "Work-package: libre-ai/x#1  WP-1"],
    ["a trailing space", "Work-package: libre-ai/x#1 WP-1 "],
    ["a trailing word", "Work-package: libre-ai/x#1 WP-1 done"],
    ["no space after the colon", "Work-package:libre-ai/x#1 WP-1"],
    ["a missing owner", "Work-package: x#1 WP-1"],
    ["a missing issue number", "Work-package: libre-ai/x WP-1"],
    ["a missing work package", "Work-package: libre-ai/x#1"],
    ["a dot repository name", "Work-package: libre-ai/..#1 WP-1"],
    ["a nested path as repository", "Work-package: libre-ai/x/y#1 WP-1"],
    ["a no-break space between the parts", `Work-package: libre-ai/x#1${NO_BREAK_SPACE}WP-1`],
    ["a line separator after the value", `Work-package: libre-ai/x#1 WP-1${LINE_SEPARATOR}`],
    ["an empty value", "Work-package:"],
  ])("a malformed Work-package value is invalid: %s", (_label, line) => {
    const declaration = readLinkDeclaration(`${line}\n`);
    expect(declaration.kind).toBe("invalid");
  });

  test("a malformed value names the offending text", () => {
    const declaration = readLinkDeclaration("Work-package: libre-ai/x#0 WP-1\n");
    expect(declaration.kind === "invalid" && declaration.reason).toContain('" libre-ai/x#0 WP-1"');
  });

  test("a keyword in another case is not a declaration line", () => {
    const declaration = readLinkDeclaration("work-package: libre-ai/x#1 WP-1\n");
    expect(declaration.kind === "invalid" && declaration.reason).toContain("0 declaration line");
  });

  test("a keyword not at the start of the line is not a declaration line", () => {
    const declaration = readLinkDeclaration("> Work-package: libre-ai/x#1 WP-1\n");
    expect(declaration.kind === "invalid" && declaration.reason).toContain("0 declaration line");
  });

  test("a declaration glued behind a line separator is not a second line", () => {
    const declaration = readLinkDeclaration(
      `Work-package: libre-ai/x#1 WP-1${LINE_SEPARATOR}Exempt: revert\n`,
    );
    expect(declaration.kind).toBe("invalid");
  });

  test.each([
    ["an empty class", "Exempt:"],
    ["a blank class", "Exempt:  "],
    ["a class in capitals", "Exempt: Docs-only"],
    ["a class with a space", "Exempt: docs only"],
    ["a class with a trailing space", "Exempt: docs-only "],
    ["an extra space before the class", "Exempt:  docs-only"],
    ["a class starting with a digit", "Exempt: 1st"],
    ["a prototype name", "Exempt: __proto__"],
  ])("a malformed Exempt value is invalid: %s", (_label, line) => {
    expect(readLinkDeclaration(`${line}\n`).kind).toBe("invalid");
  });

  test("an empty Exempt class says it is empty", () => {
    const declaration = readLinkDeclaration("Exempt:\n");
    expect(declaration.kind === "invalid" && declaration.reason).toContain("empty");
  });
});

// The reader decides what a declaration line is the way a CommonMark renderer
// shows the description: a keyword inside a fence, inside a comment, or
// indented into a code block is displayed as code or hidden, so it must not be
// read as a declaration.
describe("readLinkDeclaration follows the rendering", () => {
  const FENCE4 = "`".repeat(4);
  const TAB = String.fromCodePoint(0x09);
  const WP = "Work-package: a/b#1 WP-1";
  const WP_LINK: Declaration = { kind: "link", repo: "a/b", issue: 1, wp: "WP-1" };
  const REVERT: Declaration = { kind: "exempt", cls: "revert" };
  const text = (...parts: string[]): string => parts.join("\n");
  const reasonOf = (declaration: Declaration): string =>
    declaration.kind === "invalid" ? declaration.reason : "";

  describe("fences", () => {
    test("a four-backtick fence is not closed by a three-backtick line", () => {
      // Rendered: the Work-package line is code, only `Exempt: revert` is outside.
      expect(readLinkDeclaration(text(FENCE4, FENCE, WP, FENCE4, "Exempt: revert"))).toEqual(
        REVERT,
      );
    });

    test("a closing fence carrying an info string does not close", () => {
      expect(
        readLinkDeclaration(text(FENCE, "x", `${FENCE}ts`, WP, FENCE, "Exempt: revert")),
      ).toEqual(REVERT);
    });

    test("a closing run may be longer than the opening run", () => {
      expect(readLinkDeclaration(text(FENCE, WP, FENCE4, "Exempt: revert"))).toEqual(REVERT);
    });

    test("a closing fence may carry up to three spaces of indentation and trailing spaces", () => {
      expect(readLinkDeclaration(text(FENCE, WP, `   ${FENCE}  `, "Exempt: revert"))).toEqual(
        REVERT,
      );
    });

    test("a tilde fence hides what it encloses", () => {
      expect(readLinkDeclaration(text("~~~", WP, "~~~", "Exempt: revert"))).toEqual(REVERT);
    });

    test("a tilde fence is not closed by backticks", () => {
      expect(readLinkDeclaration(text("~~~", FENCE, WP, "~~~", "Exempt: revert"))).toEqual(REVERT);
    });

    test("a backtick fence is not closed by tildes", () => {
      expect(readLinkDeclaration(text(FENCE, "~~~", WP, FENCE, "Exempt: revert"))).toEqual(REVERT);
    });

    test("an opening backtick fence whose info string has a backtick is not a fence", () => {
      expect(readLinkDeclaration(text(`${FENCE}a\`b`, WP))).toEqual(WP_LINK);
    });

    test("an opening tilde fence may carry a backtick in its info string", () => {
      expect(readLinkDeclaration(text("~~~a`b", WP, "~~~", "Exempt: revert"))).toEqual(REVERT);
    });

    test("a fence indented by three spaces opens", () => {
      expect(readLinkDeclaration(text(`   ${FENCE}`, WP, FENCE, "Exempt: revert"))).toEqual(REVERT);
    });

    test("a fence indented by four spaces is code, not a fence", () => {
      expect(readLinkDeclaration(text(`    ${FENCE}`, WP))).toEqual(WP_LINK);
    });

    test("an unclosed fence hides everything after it", () => {
      const declaration = readLinkDeclaration(text(FENCE, WP, "Exempt: revert"));
      expect(declaration.kind).toBe("invalid");
      expect(reasonOf(declaration)).toContain("0 declaration line");
    });

    test("a declaration before an unclosed fence stays the only declaration", () => {
      expect(readLinkDeclaration(text("Exempt: revert", FENCE, WP))).toEqual(REVERT);
    });

    test("CRLF line ends do not break fence reading", () => {
      expect(readLinkDeclaration(`${FENCE}\r\n${WP}\r\n${FENCE}\r\nExempt: revert\r\n`)).toEqual(
        REVERT,
      );
    });

    test("lone CR line ends do not break fence reading", () => {
      expect(readLinkDeclaration(`${FENCE}\r${WP}\r${FENCE}\rExempt: revert\r`)).toEqual(REVERT);
    });
  });

  describe("indentation", () => {
    test("three spaces of indentation still make a declaration", () => {
      expect(readLinkDeclaration("   Exempt: revert\n")).toEqual(REVERT);
    });

    test("four spaces make a code block, not a declaration, and the message says so", () => {
      const declaration = readLinkDeclaration("    Exempt: revert\n");
      expect(declaration.kind).toBe("invalid");
      expect(reasonOf(declaration)).toContain("0 declaration line");
      expect(reasonOf(declaration)).toContain(
        "a declaration indented by 4+ spaces or a tab is a code block, not a declaration",
      );
    });

    test("a tab makes a code block, not a declaration, and the message says so", () => {
      const declaration = readLinkDeclaration(`${TAB}${WP}\n`);
      expect(declaration.kind).toBe("invalid");
      expect(reasonOf(declaration)).toContain("a tab is a code block");
    });

    test("spaces then a tab make a code block", () => {
      expect(reasonOf(readLinkDeclaration(`  ${TAB}Exempt: revert\n`))).toContain(
        "indented by 4+ spaces or a tab",
      );
    });

    test("the hint is absent when nothing was over-indented", () => {
      expect(reasonOf(readLinkDeclaration("Summary only\n"))).not.toContain("indented by 4+");
    });

    test("an over-indented line is ignored when a real declaration exists", () => {
      expect(readLinkDeclaration(text("    Work-package: x/y#9 WP-9", "Exempt: revert"))).toEqual(
        REVERT,
      );
    });

    test("an over-indented line inside a fence is not reported as a hint", () => {
      expect(reasonOf(readLinkDeclaration(text(FENCE, `    ${WP}`, FENCE)))).not.toContain(
        "indented by 4+",
      );
    });
  });

  describe("comments", () => {
    test("a comment opened mid-line and closed on the next line leaves no declaration", () => {
      const declaration = readLinkDeclaration(text("Hello <!-- start", `--> ${WP}`));
      expect(declaration.kind).toBe("invalid");
      expect(reasonOf(declaration)).toContain("0 declaration line");
    });

    test("text after a comment end is not at the start of the line", () => {
      expect(reasonOf(readLinkDeclaration(`<!-- a --> ${WP}`))).toContain("0 declaration line");
    });

    test("a declaration on the line after a closed comment counts", () => {
      expect(readLinkDeclaration(text("<!-- a", "b -->", "Exempt: revert"))).toEqual(REVERT);
    });

    test("a second comment opened on the line where the first ends hides the next lines", () => {
      expect(readLinkDeclaration(text("<!-- a --> <!-- b", "Exempt: revert", "-->", WP))).toEqual(
        WP_LINK,
      );
    });

    test("a fence marker inside a comment does not open a fence", () => {
      expect(readLinkDeclaration(text("<!--", FENCE, "-->", "Exempt: revert"))).toEqual(REVERT);
    });

    test("a comment marker inside a fence does not open a comment", () => {
      expect(readLinkDeclaration(text(FENCE, "<!--", FENCE, "Exempt: revert"))).toEqual(REVERT);
    });

    test("an unterminated comment hides everything after it, CRLF included", () => {
      expect(reasonOf(readLinkDeclaration(`x <!--\r\n${WP}\r\n`))).toContain("0 declaration line");
    });

    test("lone CR line ends do not break comment reading", () => {
      expect(readLinkDeclaration(`<!--\r${WP}\r-->\rExempt: revert\r`)).toEqual(REVERT);
    });
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

describe("evaluateWorkPackageLink", () => {
  test("a well-formed link passes and prints its volume", async () => {
    const seen: Array<[string, string]> = [];
    const report = await evaluateWorkPackageLink(
      pr({ body: "Work-package: libre-ai/product-research#12 WP-3\n" }),
      policy,
      portsWith({ ok: false, reason: "must not be asked on the link path" }, seen),
    );
    // The link path reads no diff: asking for one would be a wasted, failable read.
    expect(seen).toEqual([]);
    expect(report.outcome).toBe("pass");
    expect(report.violations).toEqual([]);
    expect(report.volumeSummary).toContain("1 declaration line");
    expect(report.volumeSummary).toContain("libre-ai/product-research#12 WP-3");
  });

  test("an invalid declaration is a named violation", async () => {
    const report = await evaluateWorkPackageLink(
      pr({ body: "" }),
      policy,
      portsWith({ ok: true, value: [] }),
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("0 declaration line");
    expect(report.volumeSummary).toContain("0 declaration line");
  });

  test("two declarations are a violation", async () => {
    const report = await evaluateWorkPackageLink(
      pr({ body: "Work-package: libre-ai/x#1 WP-1\nExempt: revert\n" }),
      policy,
      portsWith({ ok: true, value: [] }),
    );
    expect(report.outcome).toBe("violations");
    expect(report.volumeSummary).toContain("2 declaration line");
  });

  test("a holding exemption passes and prints the files examined", async () => {
    const seen: Array<[string, string]> = [];
    const report = await evaluateWorkPackageLink(
      pr({ body: "Exempt: docs-only\n" }),
      policy,
      portsWith({ ok: true, value: ["README.md", "docs/a.txt"] }, seen),
    );
    expect(report.outcome).toBe("pass");
    expect(seen).toEqual([["a".repeat(40), "b".repeat(40)]]);
    expect(report.volumeSummary).toContain("2 file(s) examined");
  });

  test("an exemption whose predicate is false is a violation", async () => {
    const report = await evaluateWorkPackageLink(
      pr({ body: "Exempt: docs-only\n" }),
      policy,
      portsWith({ ok: true, value: ["src/a.ts"] }),
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("src/a.ts");
  });

  test("an exemption class absent from the policy is a violation naming it", async () => {
    const report = await evaluateWorkPackageLink(
      pr({ body: "Exempt: chore\n" }),
      policy,
      portsWith({ ok: true, value: ["README.md"] }),
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("chore");
  });

  test("an exempt declaration with an unreadable diff is a violation, never a pass", async () => {
    const report = await evaluateWorkPackageLink(
      pr({ body: "Exempt: docs-only\n" }),
      policy,
      portsWith({ ok: false, reason: "git diff failed" }),
    );
    expect(report.outcome).toBe("violations");
    expect(report.violations.join("\n")).toContain("git diff failed");
  });

  test("an unreadable diff is a violation even for an author-based exemption", async () => {
    const report = await evaluateWorkPackageLink(
      pr({ body: "Exempt: dependabot\n", author: "dependabot[bot]" }),
      policy,
      portsWith({ ok: false, reason: "git diff failed" }),
    );
    expect(report.outcome).toBe("violations");
  });

  test("a docs-only exemption on an empty diff is a violation", async () => {
    const report = await evaluateWorkPackageLink(
      pr({ body: "Exempt: docs-only\n" }),
      policy,
      portsWith({ ok: true, value: [] }),
    );
    expect(report.outcome).toBe("violations");
  });

  test("a prototype-named class cannot reach an inherited rule", async () => {
    const inherited = { ...policy, exempt: {} as Record<string, ExemptRule> };
    const report = await evaluateWorkPackageLink(
      pr({ body: "Exempt: constructor\n" }),
      inherited,
      portsWith({ ok: true, value: ["README.md"] }),
    );
    expect(report.outcome).toBe("violations");
  });
});
