import { concludeGate, GateReport } from "./gate-report";

// `allowEmpty(reason)` is an escape hatch, and escape hatches spread.
//
// It exists because a guard can legitimately lose its target — check-retired-names
// has no apps/, crates/ or packages/ family left here since the ADR-0020 dispatch,
// so asserting nothing is the truth rather than a defect. But nothing in the
// mechanism distinguishes that from silencing a gate that has become inconvenient.
// A gate quieted through allowEmpty would be worse than the inert gates it was
// built to catch: it would look deliberate, and it would carry a written excuse.
//
// So each allowance is nominative. Adding one means editing the list below, which
// a reviewer sees; it can no longer be a line slipped into an unrelated change.
// This gate is deliberately dumb — it greps. A cleverer implementation reading the
// call graph would fail open on the case that matters (a new file nobody declared),
// and failing open is the whole defect class this guard belongs to.

interface Allowance {
  readonly file: string;
  /** Why asserting nothing is the truth here, not a silenced gate. */
  readonly because: string;
}

export const DECLARED_ALLOWANCES: readonly Allowance[] = [
  {
    file: "tools/quality/check-retired-names.ts",
    because:
      "no apps/, crates/ or packages/ family lives in this repository since the ADR-0020 dispatch — the guard travels with the families it protects",
  },
  {
    file: "tools/quality/check-review-evidence.ts",
    because:
      "most pull requests do not touch docs/adr/**, docs/decisions/INVARIANTS.md or docs/decisions/DECISION-REGISTER.md — asserting nothing on those runs is the truth, not a silenced gate (it also allows-empty on non-pull_request runs, where no PR diff or description exists to inspect)",
  },
  {
    file: "tools/quality/check-kernel-status-authority.ts",
    because:
      "defensive only: with three declared file allowances always present in this repository, the scan can never legitimately find zero markdown files to check — the branch exists so a future repository restructuring that empties the glob fails loudly instead of silently, not because it fires today",
  },
  {
    file: "tools/skills/check-skills.ts",
    because:
      "the skills/ directory travels with the collection ADR-0025 admits — a repository state before the first skill is admitted, or after every skill is deprecated, legitimately holds zero <name>/SKILL.md to lint",
  },
  {
    file: "tools/skills/check-skills-routing.ts",
    because:
      "same absence as check-skills.ts, plus a second legitimate empty state: pairwise description overlap needs at least 2 routable skills to compare, so a collection admitting its first skill correctly asserts nothing on that half of T2",
  },
];

const SCANNED_DIRECTORIES = ["tools", "ecosystem"];
/**
 * Files that name `allowEmpty` because it is their subject, not their behaviour:
 * the definition site, and this scanner — which cannot search for a string
 * without containing it. Same self-exclusion `check-objectives.ts` makes for its
 * own forbidden-statement list.
 */
const SUBJECT_NOT_CALLER = [
  "tools/quality/gate-report.ts",
  "tools/quality/check-empty-allowances.ts",
];

export interface AllowanceScan {
  readonly declared: readonly string[];
  readonly found: readonly string[];
  readonly undeclared: readonly string[];
  readonly stale: readonly string[];
}

/** Pure comparison, so the verdict is testable without touching the filesystem. */
export function compareAllowances(
  declared: readonly Allowance[],
  found: readonly string[],
): AllowanceScan {
  const declaredFiles = declared.map((entry) => entry.file);
  return {
    declared: declaredFiles,
    found,
    undeclared: found.filter((file) => !declaredFiles.includes(file)),
    // A declaration whose allowEmpty is gone is not harmless: it keeps a written
    // permission alive for a file that no longer needs it, ready to cover a
    // future one silently.
    stale: declaredFiles.filter((file) => !found.includes(file)),
  };
}

if (import.meta.main) {
  const found: string[] = [];
  for (const directory of SCANNED_DIRECTORIES) {
    const glob = new Bun.Glob(`${directory}/**/*.ts`);
    for await (const path of glob.scan({ cwd: ".", onlyFiles: true })) {
      if (SUBJECT_NOT_CALLER.includes(path) || path.endsWith(".test.ts")) continue;
      if ((await Bun.file(path).text()).includes("allowEmpty(")) found.push(path);
    }
  }

  const scan = compareAllowances(DECLARED_ALLOWANCES, found.sort());
  const report = new GateReport();

  for (const entry of DECLARED_ALLOWANCES) {
    const present = scan.found.includes(entry.file);
    report.check(
      entry.file,
      present,
      present
        ? `declared empty-allowance in force: ${entry.because}`
        : "declared an empty-allowance that no longer exists — remove the declaration rather than leaving a standing permission",
    );
  }

  for (const file of scan.undeclared) {
    report.check(
      file,
      false,
      "calls allowEmpty() without a declaration in check-empty-allowances.ts — a gate that asserts nothing is a decision, and a decision is reviewed, not inferred",
    );
  }

  concludeGate("Empty allowances", report);
}
