/**
 * WP-G2-Q01 acceptance criterion 3, executable: no Clever Cloud resource and
 * no production claim exists in living surfaces before G4. The scanner
 * separates *provisioning/production signals* (banned now) from the many
 * legitimate doctrinal mentions of the future runtime target (I-07: the
 * runtime target IS Clever Cloud Paris/EU, provisioned only at G4).
 *
 * Living surfaces only: docs of record that describe the future target
 * (INVARIANTS, ADRs, GOALS, STATUS, transformation) are read-authorities, not
 * provisioning, and are excluded — as are review evidence and legacy manifests.
 */
export interface ScanTarget {
  readonly path: string;
  readonly content: string;
}

export interface ProvisioningFinding {
  readonly path: string;
  readonly line: number;
  readonly reason: string;
}

const IGNORED_PREFIXES = [
  ".git/",
  "node_modules/",
  "target/",
  "dist/",
  "docs/",
  "verification/harness/",
  "ecosystem/LEGACY-MANIFEST.yaml",
  "STATUS.md",
  "GOALS.md",
  "vision.md",
];

// Non-normative review evidence lives under */evidence/ anywhere in the tree
// (crates/*/evidence, distribution/evidence) — historical records, not living
// surfaces. This scanner's own test carries provisioning anti-pattern fixtures
// by design, so it excludes itself.
const IGNORED_SUBSTRINGS = ["/evidence/"];
const SELF_TEST_SUFFIX = "check-no-clever-production.test.ts";

function isIgnored(path: string): boolean {
  if (IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (IGNORED_SUBSTRINGS.some((part) => path.includes(part))) return true;
  if (path.endsWith(SELF_TEST_SUFFIX)) return true;
  return false;
}

const SIGNALS: readonly { readonly test: RegExp; readonly reason: string }[] = [
  // A concrete provisioned Clever Cloud host (an addon URI, not the name).
  {
    test: /[a-z0-9-]+\.services\.clever-cloud\.com/i,
    reason: "concrete clever-cloud.com addon host",
  },
  // A resolved *_ADDON_URI binding: a provisioned addon wired into code.
  { test: /\b[A-Z][A-Z0-9_]*_ADDON_URI\b/, reason: "provisioned *_ADDON_URI binding" },
  // An affirmative production claim. Negations/deferrals are filtered below.
  {
    test: /\bproduction-ready\b|\bdeployed to production\b|\bin production\b|\bproduction (?:use|deployment) (?:is )?(?:granted|authorized|enabled)\b/i,
    reason: "affirmative production claim",
  },
];

// Guards that neutralize a line: an explicit negation or deferral about
// production/provisioning is doctrine-compliant, not a claim.
const NEGATION_GUARD =
  /\bno\b[^.]*\bproduction\b|\bnot\b[^.]*\bproduction\b|\bdeferred\b|\buntil G4\b|\bonly (?:in|at) G4\b|\bNO-GO\b|\bnever\b[^.]*\bproduction\b/i;

export function scanForProvisioningClaims(targets: readonly ScanTarget[]): ProvisioningFinding[] {
  const findings: ProvisioningFinding[] = [];
  for (const target of targets) {
    if (isIgnored(target.path)) {
      continue;
    }
    const lines = target.content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (NEGATION_GUARD.test(line)) {
        continue;
      }
      for (const signal of SIGNALS) {
        if (signal.test.test(line)) {
          findings.push({ path: target.path, line: i + 1, reason: signal.reason });
          break;
        }
      }
    }
  }
  return findings;
}

// Executable entrypoint: scan the living tree when run directly.
if (import.meta.main) {
  const { concludeGate, GateReport } = await import("./gate-report");
  const glob = new Bun.Glob("**/*.{ts,tsx,json,yaml,yml,toml,md,rs}");
  const targets: ScanTarget[] = [];
  for await (const path of glob.scan({ cwd: ".", onlyFiles: true })) {
    if (isIgnored(path)) {
      continue;
    }
    targets.push({ path, content: await Bun.file(path).text() });
  }
  const report = new GateReport();
  for (const finding of scanForProvisioningClaims(targets)) {
    report.check(`${finding.path}:${finding.line}`, false, finding.reason);
  }
  // The scan itself is the assertion: a glob that matched nothing proves
  // nothing, so the count is part of the verdict rather than decoration.
  if (report.violations.length === 0) {
    report.check(
      "provisioning scan (WP-G2-Q01 acceptance 3)",
      targets.length > 0,
      targets.length > 0
        ? `${targets.length} living files carry no Clever resource nor production claim`
        : "the corpus glob matched no file — the scan asserted nothing",
    );
  }
  concludeGate("No Clever production", report);
}
