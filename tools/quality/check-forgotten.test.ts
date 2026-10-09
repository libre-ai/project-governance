import { describe, expect, test } from "bun:test";
import {
  buildReport,
  EMPTY_REGISTER_NOTE,
  type Finding,
  type ForgottenRegister,
  findForbiddenCitations,
  findResurrections,
  findWildForgetting,
  memoizeResolver,
  parseRegister,
  REGISTER_PATH,
} from "./check-forgotten";
import { renderGateReport } from "./gate-report";

const REGISTER: ForgottenRegister = {
  entries: [
    {
      id: "forgotten.tree",
      evicted_paths: ["docs/dead/tree/"],
      recoverable_at: "cafebabe",
    },
    {
      id: "forgotten.file",
      evicted_paths: ["prompts/done.md"],
      recoverable_at: "cafebabe",
    },
  ],
  citation_allowlist: ["ecosystem/FORGOTTEN.yaml"],
};

const SHARED_ANCHOR: ForgottenRegister = {
  entries: [
    { id: "forgotten.one", evicted_paths: ["docs/dead/tree/"], recoverable_at: "cafebabe" },
    { id: "forgotten.two", evicted_paths: ["prompts/done.md"], recoverable_at: "cafebabe" },
    { id: "forgotten.three", evicted_paths: ["docs/dead/tree/"], recoverable_at: "cafebabe" },
  ],
  citation_allowlist: [],
};

describe("anti-resurrection", () => {
  test("flags a file back under an evicted directory", () => {
    const findings = findResurrections(REGISTER, ["docs/dead/tree/DESIGN.md", "README.md"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toContain("docs/dead/tree/DESIGN.md");
  });

  test("flags an evicted single file back in the tree", () => {
    expect(findResurrections(REGISTER, ["prompts/done.md"])).toHaveLength(1);
  });

  test("a sibling path that merely shares a prefix is not a resurrection", () => {
    expect(
      findResurrections(REGISTER, ["docs/dead/tree-notes.md", "prompts/done.md.bak"]),
    ).toHaveLength(0);
  });

  test("passes on a clean tree", () => {
    expect(findResurrections(REGISTER, ["README.md", "docs/positioning/website.md"])).toHaveLength(
      0,
    );
  });
});

describe("anti-citation", () => {
  test("flags a living document that names an evicted path", () => {
    const findings = findForbiddenCitations(REGISTER, [
      { path: "docs/plan.md", text: "voir docs/dead/tree/DESIGN.md pour la cible" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("citation");
  });

  test("matches a citation written without the trailing slash", () => {
    expect(
      findForbiddenCitations(REGISTER, [{ path: "docs/plan.md", text: "cf docs/dead/tree" }]),
    ).toHaveLength(1);
  });

  test("the register itself may name what it forgets", () => {
    expect(
      findForbiddenCitations(REGISTER, [
        { path: "ecosystem/FORGOTTEN.yaml", text: "docs/dead/tree/ and prompts/done.md" },
      ]),
    ).toHaveLength(0);
  });
});

describe("anti-wild-forgetting", () => {
  test("fails when recoverable_at does not resolve", () => {
    const findings = findWildForgetting(REGISTER, () => null);
    expect(findings).toHaveLength(2);
    expect(findings[0]?.detail).toContain("does not resolve");
  });

  test("fails when the recorded commit does not carry the evicted content", () => {
    const findings = findWildForgetting(REGISTER, () => ["README.md"]);
    expect(findings).toHaveLength(2);
    expect(findings[0]?.detail).toContain("does not carry");
  });

  test("passes when the commit carries every evicted path", () => {
    const findings = findWildForgetting(REGISTER, () => [
      "docs/dead/tree/DESIGN.md",
      "prompts/done.md",
    ]);
    expect(findings).toHaveLength(0);
  });
});

// The defect these two describe, measured on 2026-10-08: success was one
// `report.check(…, true, …)` with a literal `true`. It covered four entries and
// fifty-seven evicted files, and a register reduced to `entries: []` produced
// the same single true assertion with exit 0. The eviction recorded that day
// (`forgotten.migration-drift-gate`) rests on this gate, so the guard against a
// resurrection could not see its own emptiness.
describe("the verdict counts what it covers", () => {
  test("one assertion per entry, each named by its entry", () => {
    const report = buildReport(REGISTER, []);

    expect(report.asserted).toBe(2);
    expect(report.checks.map((check) => check.item)).toEqual(["forgotten.tree", "forgotten.file"]);
    expect(report.outcome).toBe("pass");
  });

  test("the success line carries the volume, not only the assertion count", () => {
    const register: ForgottenRegister = {
      entries: [
        { id: "forgotten.a", evicted_paths: ["docs/a/"], recoverable_at: "aa", file_count: 49 },
        {
          id: "forgotten.b",
          evicted_paths: ["p/one.md", "p/two.md"],
          recoverable_at: "bb",
          file_count: 2,
        },
      ],
      citation_allowlist: [],
    };
    const rendered = renderGateReport("Forgetting", buildReport(register, []));

    expect(rendered.lines[0]).toBe(
      "Forgetting verified: 2 assertion(s) hold — 2 register entries, 3 evicted path(s), " +
        "51 evicted file(s) declared: forgotten.a, forgotten.b",
    );
  });

  // An eviction makes another gate go quiet: the files leave the tree, so the
  // gate that reported on them stops, and nothing in its output ties that
  // silence to a decision. This line is the tie, and it is the only one a CI
  // reader sees — `GATE_VERBOSE`, which carries the per-entry notes, is set
  // nowhere in CI. Measured on 2026-10-09: the eviction of that day moved the
  // counters from 5 entries / 7 paths / 58 files to 6 / 8 / 62, and a reader
  // could see that something had been forgotten without being able to see what.
  test("the success line names the entries, not only their count", () => {
    const line = renderGateReport("Forgetting", buildReport(REGISTER, [])).lines[0] ?? "";

    for (const entry of REGISTER.entries) expect(line).toContain(entry.id);
  });

  // Locks the absence of a truncation threshold: entries are appended, so a cap
  // would hide the newest eviction — the one whose arrival moves the counters,
  // and the only reason the line names anything at all.
  test("it names every entry, however many the register carries", () => {
    const many: ForgottenRegister = {
      entries: Array.from({ length: 12 }, (_, index) => ({
        id: `forgotten.entry-${index}`,
        evicted_paths: [`docs/gone-${index}/`],
        recoverable_at: "cafebabe",
      })),
      citation_allowlist: [],
    };

    const line = renderGateReport("Forgetting", buildReport(many, [])).lines[0] ?? "";

    for (const entry of many.entries) expect(line).toContain(entry.id);
  });

  test("an empty register fails, and says why emptiness is a defect here", () => {
    const report = buildReport({ entries: [], citation_allowlist: [] }, []);

    expect(report.outcome).toBe("violations");
    expect(report.violations).toEqual([`${REGISTER_PATH}: ${EMPTY_REGISTER_NOTE}`]);
    expect(renderGateReport("Forgetting", report).ok).toBe(false);
    expect(EMPTY_REGISTER_NOTE).toContain("no eviction is enforced");
    expect(EMPTY_REGISTER_NOTE).toContain("ADR-0019");
  });

  test("a finding fails its own entry and leaves the other entries asserted", () => {
    const findings: Finding[] = [
      { rule: "resurrection", entry: "forgotten.file", detail: "prompts/done.md is back" },
    ];
    const report = buildReport(REGISTER, findings);

    expect(report.asserted).toBe(2);
    expect(report.violations).toEqual(["forgotten.file: [resurrection] prompts/done.md is back"]);
    expect(report.checks[0]).toMatchObject({ item: "forgotten.tree", ok: true });
  });

  test("a finding attributed to an unknown entry is reported, not dropped", () => {
    const findings: Finding[] = [
      { rule: "citation", entry: "forgotten.absent", detail: "docs/x.md cites it" },
    ];
    const report = buildReport(REGISTER, findings);

    expect(report.outcome).toBe("violations");
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain("absent from the register");
  });
});

// Measured on the register of 2026-10-08: four entries, three sharing one
// anchor, and the anchors live in the archived hub since ADR-0020 — so the
// resolver issued three identical `gh api` calls to the same URL.
describe("memoizeResolver", () => {
  test("resolves each distinct commit once, however many entries share it", () => {
    const asked: string[] = [];
    const resolve = memoizeResolver((commit) => {
      asked.push(commit);
      return ["docs/dead/tree/DESIGN.md", "prompts/done.md"];
    });

    expect(findWildForgetting(SHARED_ANCHOR, resolve)).toHaveLength(0);
    expect(asked).toEqual(["cafebabe"]);
  });

  test("an unresolvable commit is cached as unresolvable, not retried per entry", () => {
    let calls = 0;
    const resolve = memoizeResolver(() => {
      calls += 1;
      return null;
    });

    const findings = findWildForgetting(SHARED_ANCHOR, resolve);
    expect(findings).toHaveLength(3);
    expect(findings.every((finding) => finding.detail.includes("does not resolve"))).toBe(true);
    expect(calls).toBe(1);
  });

  test("distinct commits are resolved distinctly — the key is the commit", () => {
    const asked: string[] = [];
    const register: ForgottenRegister = {
      entries: [
        { id: "forgotten.a", evicted_paths: ["a.md"], recoverable_at: "1111" },
        { id: "forgotten.b", evicted_paths: ["b.md"], recoverable_at: "2222" },
      ],
      citation_allowlist: [],
    };
    const resolve = memoizeResolver((commit) => {
      asked.push(commit);
      return commit === "1111" ? ["a.md"] : ["README.md"];
    });

    const findings = findWildForgetting(register, resolve);
    expect(asked).toEqual(["1111", "2222"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.entry).toBe("forgotten.b");
  });
});

describe("register parsing", () => {
  test("reads entries and allow-list", () => {
    const register = parseRegister(`
version: 1
entries:
  - id: forgotten.example
    evicted_paths:
      - docs/gone/
    recoverable_at: deadbeef
citation_allowlist:
  - ecosystem/FORGOTTEN.yaml
`);
    expect(register.entries).toHaveLength(1);
    expect(register.entries[0]?.id).toBe("forgotten.example");
    expect(register.citation_allowlist).toContain("ecosystem/FORGOTTEN.yaml");
  });

  test("rejects a register without entries", () => {
    expect(() => parseRegister("version: 1\n")).toThrow("missing `entries`");
  });

  test("defaults the allow-list to empty", () => {
    const register = parseRegister(`
entries:
  - id: forgotten.example
    evicted_paths: [docs/gone/]
    recoverable_at: deadbeef
`);
    expect(register.citation_allowlist).toEqual([]);
  });
});

describe("the real register", () => {
  test("every entry declares paths and a recovery commit", async () => {
    const register = parseRegister(await Bun.file(REGISTER_PATH).text());
    expect(register.entries.length).toBeGreaterThan(0);
    for (const entry of register.entries) {
      expect(entry.id).toMatch(/^forgotten\./);
      expect(entry.evicted_paths.length).toBeGreaterThan(0);
      expect(entry.recoverable_at).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});
