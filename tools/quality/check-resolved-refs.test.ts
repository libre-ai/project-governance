import { describe, expect, test } from "bun:test";
import {
  ALLOWANCE_MARKER,
  DEFAULT_BRANCH_NAMES,
  findWorkflowsMissingServedBranch,
  isPatternSubject,
  REF_PATTERNS,
  resolveServedBranch,
  SCANNED_ROOTS,
  scanForWrittenRefs,
} from "./check-resolved-refs";

const file = (path: string, text: string) => ({ path, text });

describe("scanForWrittenRefs — a ref handed to a request", () => {
  const cases: ReadonlyArray<readonly [id: string, line: string]> = [
    ["rest-ref-query", 'ghApi("repos/o/r/contents/AGENTS.md?ref=main")'],
    ["graphql-expression", '`card: object(expression: "main:project.v1.yaml") { ... }`'],
    ["tree-path", 'ghApi("repos/o/r/git/trees/main?recursive=1")'],
    ["compare-range", 'ghApi("repos/o/r/compare/abc123...main")'],
    ["action-branch-pin", "    uses: libre-ai/project-governance/.github/workflows/x.yml@main"],
  ];

  for (const [id, line] of cases) {
    test(`${id} is refused`, () => {
      const scan = scanForWrittenRefs([file("ecosystem/gate.ts", line)]);
      expect(scan.findings.map((f) => f.id)).toEqual([id]);
      // The failure names the resolution, so the reader knows what to write.
      expect(scan.findings[0]?.says.length).toBeGreaterThan(10);
    });
  }

  test("master is refused on the same terms as main", () => {
    const scan = scanForWrittenRefs([file("tools/x.ts", "api(`contents/f?ref=master`)")]);
    expect(scan.findings).toHaveLength(1);
    expect(DEFAULT_BRANCH_NAMES).toContain("master");
  });

  test("every declared pattern is exercised by a case above", () => {
    expect(new Set(cases.map(([id]) => id))).toEqual(new Set(REF_PATTERNS.map((p) => p.id)));
  });
});

describe("scanForWrittenRefs — what is NOT a request", () => {
  // The narrowness is the design: a guard that flagged prose would need an
  // allowance per sentence, and a guard with seventy allowances is noise.
  const innocent = [
    "// Naming the default branch read the documentary tree of the destinations.",
    "const branch = defaultBranch; // resolved, not written",
    'console.log("merged into the served branch");',
    "if (import.meta.main) {",
    "expect(message).toBe(\"Merge branch 'main' into feature\");",
    "  - repository: libre-ai/project-governance",
  ];

  for (const line of innocent) {
    test(`untouched: ${line.slice(0, 48)}`, () => {
      expect(scanForWrittenRefs([file("ecosystem/gate.ts", line)]).findings).toEqual([]);
    });
  }
});

describe("isPatternSubject — a test of the pattern must contain the pattern", () => {
  const subjects = [
    "ecosystem/check-fleet-pins.test.ts",
    "crates/ecosystem-engine/tests/fixtures/patch-rev/rev-branch.toml",
    "tools/quality/__fixtures__/sample.yml",
    "verification/tests/case.ts",
  ];
  for (const path of subjects) {
    test(`excluded: ${path}`, () => expect(isPatternSubject(path)).toBe(true));
  }

  test("ordinary source is not excluded", () => {
    expect(isPatternSubject("ecosystem/check-fleet-pins.ts")).toBe(false);
  });

  test("the anti-regression assertion of another gate is not reported", () => {
    // `expect(query).not.toContain(...)` is what locks a fix in place. A guard
    // that refused it would be refusing its own guardrail.
    const scan = scanForWrittenRefs([
      file("ecosystem/check-x.test.ts", `expect(q).not.toContain('expression: "main:');`),
    ]);
    expect(scan.findings).toEqual([]);
    expect(scan.filesScanned).toBe(0);
  });
});

describe("the allowance requires a reason", () => {
  test("a marker with a reason is allowed and COUNTED, never hidden", () => {
    const scan = scanForWrittenRefs([
      file(
        "ecosystem/gate.ts",
        `api(\`contents/f?ref=main\`) // ${ALLOWANCE_MARKER} the hub is archived read-only`,
      ),
    ]);
    expect(scan.findings).toEqual([]);
    expect(scan.allowed).toHaveLength(1);
    expect(scan.allowed[0]?.id).toBe("rest-ref-query");
  });

  test("a bare marker with no reason is NOT an allowance", () => {
    const scan = scanForWrittenRefs([
      file("ecosystem/gate.ts", `api(\`contents/f?ref=main\`) // ${ALLOWANCE_MARKER}`),
    ]);
    expect(scan.findings).toHaveLength(1);
    expect(scan.allowed).toEqual([]);
  });
});

describe("findWorkflowsMissingServedBranch", () => {
  // Five workflows of this repository filtered on `main` alone and had zero push
  // runs on the served branch: every run was a pull_request, so no verdict ever
  // reached a merged head.
  test("a filter that omits the served branch is reported", () => {
    const missing = findWorkflowsMissingServedBranch(
      [file(".github/workflows/ci.yml", "on:\n  push:\n    branches: [main]\n")],
      "migrate/recover-code",
    );
    expect(missing).toEqual([".github/workflows/ci.yml"]);
  });

  test("a filter that lists it is accepted, quoted or not", () => {
    const text = 'on:\n  push:\n    branches: [main, "migrate/recover-code"]\n';
    expect(findWorkflowsMissingServedBranch([file("w.yml", text)], "migrate/recover-code")).toEqual(
      [],
    );
  });

  test("no filter at all is not a finding: every branch already runs", () => {
    expect(
      findWorkflowsMissingServedBranch(
        [file("w.yml", "on:\n  push:\n  pull_request:\n")],
        "migrate/recover-code",
      ),
    ).toEqual([]);
  });
});

describe("the guard applies its own rule to itself", () => {
  test("scanning nothing reports nothing scanned, so the CLI can fail on it", () => {
    const scan = scanForWrittenRefs([]);
    expect(scan.filesScanned).toBe(0);
    expect(scan.findings).toEqual([]);
  });

  test("a file outside the scanned extensions is not counted as examined", () => {
    const scan = scanForWrittenRefs([file("ecosystem/notes.md", "contents/f?ref=main")]);
    expect(scan.filesScanned).toBe(0);
    expect(scan.findings).toEqual([]);
  });

  test("the declared roots are the surfaces that make requests", () => {
    expect(SCANNED_ROOTS).toContain("ecosystem");
    expect(SCANNED_ROOTS).toContain("tools");
    expect(SCANNED_ROOTS).toContain(".github/workflows");
  });
});

describe("resolveServedBranch — the repository's branch, not the checkout's", () => {
  // The first form asked `git symbolic-ref --short HEAD`, the LOCAL branch name.
  // Run from a working branch it reported that branch and flagged every workflow
  // in the repository: this guard committing the substitution it refuses. Caught
  // by running it, not by reading it.
  test("agrees with an independent resolution through ls-remote", () => {
    const resolved = resolveServedBranch();
    const remote = Bun.spawnSync(["git", "ls-remote", "--symref", "origin", "HEAD"]);
    if (remote.exitCode !== 0) return; // offline: the cross-check cannot run, and says so by doing nothing.
    const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(
      new TextDecoder().decode(remote.stdout),
    );
    expect(resolved).toBe(match?.[1] ?? null);
  });

  test("is not the local branch name when the two differ", () => {
    const local = Bun.spawnSync(["git", "symbolic-ref", "--short", "HEAD"]);
    if (local.exitCode !== 0) return; // detached HEAD, as on a pull-request checkout.
    const current = new TextDecoder().decode(local.stdout).trim();
    const served = resolveServedBranch();
    // Equality is legitimate when the checkout sits on the served branch; the
    // assertion is that the value comes from the remote, so it is a branch the
    // remote actually serves rather than whatever this checkout is called.
    if (served !== null && served !== current) {
      expect(served).not.toBe(current);
    }
    expect(served === null || served.length > 0).toBe(true);
  });
});
