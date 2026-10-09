// allow-audit-flag-fixture: this file writes `bun audit --ignore=` command lines
// into throw-away repositories; none of them is executed against an audit.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Adversarial review of PR #56 (2026-10-09): every case below was a bypass
// (the gate passed a waiver it should have refused) or a false red (it refused
// a waiver the policy admits) on da0c3b6. Each case is a whole repository,
// committed, and judged by the gate exactly as a consumer's workflow runs it.
// The case numbers are those of the review.

const GATE = join(import.meta.dir, "check-advisory-waivers.ts");
const TODAY = "2026-10-09";
const ANCHOR = "# waiver-review-anchor: 2026-10-01\n";
const roots: string[] = [];

function git(root: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
}

function gate(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "waiver-adversarial-"));
  roots.push(root);
  git(root, "init", "--quiet");
  const all = { "docs/r.md": "record\n", "package.json": '{"name":"x"}\n', ...files };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, "add", "--all");
  const result = Bun.spawnSync(["bun", GATE, `--root=${root}`, `--today=${TODAY}`], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GATE_VERBOSE: "" },
  });
  return {
    exitCode: result.exitCode,
    output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
  };
}

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function expectRed(files: Record<string, string>, ...needles: string[]) {
  const { exitCode, output } = gate(files);
  for (const needle of needles) expect(output).toContain(needle);
  expect(exitCode).toBe(1);
  return output;
}

function expectGreen(files: Record<string, string>) {
  const { exitCode, output } = gate(files);
  expect(output).not.toContain("failed");
  expect(exitCode).toBe(0);
  return output;
}

const VALID = `${ANCHOR}[advisories]\nignore = [\n  "RUSTSEC-2026-0001", # reason text; expires=2026-12-31; ref=docs/r.md\n]\n`;
const UNDATED_DENY = '[advisories]\nignore = [\n  "RUSTSEC-2026-0001",\n]\n';

describe("control cases", () => {
  test("c00: a dated, referenced, justified waiver passes", () => {
    expectGreen({ "deny.toml": VALID });
  });

  test("c01: an undated waiver fails", () => {
    expectRed({ "deny.toml": `${ANCHOR}${UNDATED_DENY}` }, "UNDATED deny.toml:4 RUSTSEC-2026-0001");
  });
});

describe("item 1: a decoy inside a multi-line string is never the list", () => {
  test("c30: decoy in a basic multi-line string before the real list", () => {
    const text = `${ANCHOR}[advisories]\nyanked = "deny"\nx = """\nignore = [\n  "RUSTSEC-2026-0001", # decoy; expires=2026-12-31; ref=docs/r.md\n]\n"""\nignore = [\n  "RUSTSEC-2026-0001",\n]\n`;
    expectRed({ "deny.toml": text }, "UNDATED deny.toml:10 RUSTSEC-2026-0001");
  });

  test("c31: decoy in a literal multi-line string of another table", () => {
    const text = `${ANCHOR}[graph]\nnote = '''\n[advisories]\nignore = ["RUSTSEC-2026-0001"] # decoy; expires=2026-12-31; ref=docs/r.md\n'''\n[advisories]\nignore = ["RUSTSEC-2026-0001"]\n`;
    expectRed({ "deny.toml": text }, "UNDATED deny.toml:8 RUSTSEC-2026-0001");
  });

  test("c38: decoy in a bans reason before [advisories]", () => {
    const text = `${ANCHOR}[[bans.deny]]\ncrate = "openssl"\nreason = '''\n[advisories]\nignore = ["RUSTSEC-2026-0001"] # decoy; expires=2026-12-31; ref=docs/r.md\n'''\n\n[advisories]\nignore = ["RUSTSEC-2026-0001"]\n`;
    expectRed({ "deny.toml": text }, "UNDATED deny.toml:10 RUSTSEC-2026-0001");
  });

  test("c37: decoy after the real list stays a failure", () => {
    const text = `${ANCHOR}[advisories]\nignore = ["RUSTSEC-2026-0001"]\n\n[[bans.deny]]\ncrate = "openssl"\nreason = '''\n[advisories]\nignore = ["RUSTSEC-2026-0001"] # decoy; expires=2026-12-31; ref=docs/r.md\n'''\n`;
    expectRed({ "deny.toml": text }, "UNDATED deny.toml:3 RUSTSEC-2026-0001");
  });
});

describe("item 2: osv-scanner expires only on ignoreUntil", () => {
  test("c10: no ignoreUntil, an expires= in the reason", () => {
    const text = `${ANCHOR}[[IgnoredVulns]]\nid = "GHSA-aaaa-bbbb-cccc"\nreason = "not reachable; expires=2026-12-31; ref=docs/r.md"\n`;
    expectRed(
      { "osv-scanner.toml": text },
      "UNDATED osv-scanner.toml:2 GHSA-aaaa-bbbb-cccc",
      "MISPLACED-EXPIRY osv-scanner.toml:2 GHSA-aaaa-bbbb-cccc",
    );
  });

  test("c11: ignoreUntil past the horizon, a near expires= in the reason", () => {
    const text = `${ANCHOR}[[IgnoredVulns]]\nid = "GHSA-aaaa-bbbb-cccc"\nignoreUntil = 2099-01-01\nreason = "not reachable; expires=2026-12-31; ref=docs/r.md"\n`;
    expectRed(
      { "osv-scanner.toml": text },
      "OVER-HORIZON osv-scanner.toml:2 GHSA-aaaa-bbbb-cccc",
      "MISPLACED-EXPIRY",
    );
  });
});

describe("item 3: every osv-scanner waiver form is read", () => {
  test("c12: PackageOverrides ignore = true and vulnerability.ignore = true", () => {
    const text =
      '[[PackageOverrides]]\nname = "lodash"\necosystem = "npm"\nignore = true\n\n[[PackageOverrides]]\nname = "openssl"\necosystem = "crates.io"\nvulnerability.ignore = true\n';
    expectRed(
      { "osv-scanner.toml": text },
      "UNDATED osv-scanner.toml:1 PackageOverrides npm/lodash",
      "UNDATED osv-scanner.toml:6 PackageOverrides crates.io/openssl",
      "NO-ANCHOR osv-scanner.toml",
    );
  });

  test("c13: an inline IgnoredVulns array", () => {
    const text = 'IgnoredVulns = [ { id = "GHSA-aaaa-bbbb-cccc", reason = "x" } ]\n';
    expectRed({ "osv-scanner.toml": text }, "UNDATED osv-scanner.toml:1 GHSA-aaaa-bbbb-cccc");
  });

  test('c14: a quoted [["IgnoredVulns"]] header', () => {
    const text = '[["IgnoredVulns"]]\nid = "GHSA-aaaa-bbbb-cccc"\n';
    expectRed({ "osv-scanner.toml": text }, "UNDATED osv-scanner.toml:1 GHSA-aaaa-bbbb-cccc");
  });

  test("a lower-case [[ignoredvulns]] header, which osv-scanner's decoder honours", () => {
    const text = '[[ignoredvulns]]\nid = "GHSA-aaaa-bbbb-cccc"\n';
    expectRed({ "osv-scanner.toml": text }, "UNDATED osv-scanner.toml:1 GHSA-aaaa-bbbb-cccc");
  });

  test("an IgnoredVulns occurrence the reader cannot locate is UNPARSEABLE, not zero", () => {
    const text = '[[IgnoredVulns]]\nid = "GHSA-aaaa-bbbb-cccc"\nreason = "see IgnoredVulns"\n';
    expectRed({ "osv-scanner.toml": text }, "UNPARSEABLE osv-scanner.toml");
  });

  test("an `ignore = true` the reader does not attribute is UNPARSEABLE, not zero", () => {
    const text = '[[PackageOverrides]]\nname = "a"\nreason = "ignore = true"\n';
    expectRed({ "osv-scanner.toml": text }, "UNPARSEABLE osv-scanner.toml");
  });
});

describe("item 4: .deny.toml is a cargo-deny source", () => {
  test("c02: an undated waiver in .deny.toml fails", () => {
    expectRed({ ".deny.toml": UNDATED_DENY }, "UNDATED .deny.toml:3 RUSTSEC-2026-0001");
  });

  test("c03: an undated waiver in .cargo/deny.toml fails", () => {
    expectRed({ ".cargo/deny.toml": UNDATED_DENY }, "UNDATED .cargo/deny.toml:3 RUSTSEC-2026-0001");
  });
});

describe("item 5: audit commands cannot escape the reading", () => {
  test("c20: a folded YAML block scalar", () => {
    const workflow =
      "on: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: >\n          bun audit\n          --ignore=GHSA-aaaa-bbbb-cccc\n";
    expectRed(
      { ".github/workflows/ci.yml": workflow },
      "UNDATED .github/workflows/ci.yml:8 GHSA-aaaa-bbbb-cccc",
    );
  });

  test("c21: a composite action", () => {
    const action =
      "runs:\n  using: composite\n  steps:\n    - shell: bash\n      run: bun audit --ignore=GHSA-aaaa-bbbb-cccc\n";
    expectRed(
      { ".github/actions/sec/action.yml": action },
      "UNDATED .github/actions/sec/action.yml:5 GHSA-aaaa-bbbb-cccc",
    );
  });

  test("c22: Makefile, justfile, .bash and a spawn array in TypeScript", () => {
    expectRed(
      {
        Makefile: "audit:\n\tbun audit --ignore=GHSA-aaaa-bbbb-cccc\n",
        justfile: "audit:\n  cargo audit --ignore RUSTSEC-2026-0001\n",
        "scripts/audit.bash": "#!/bin/bash\nbun audit --ignore=GHSA-1111-2222-3333\n",
        "scripts/audit.ts": 'Bun.spawnSync(["bun","audit","--ignore=GHSA-4444-5555-6666"]);\n',
      },
      "UNDATED Makefile:2 GHSA-aaaa-bbbb-cccc",
      "UNDATED justfile:2 RUSTSEC-2026-0001",
      "UNDATED scripts/audit.bash:2 GHSA-1111-2222-3333",
      "UNPARSEABLE scripts/audit.ts:1",
    );
  });

  test("c24: a command continued with a backslash before `audit`", () => {
    const workflow =
      "on: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: |\n          bun \\\n            audit --ignore=GHSA-aaaa-bbbb-cccc\n          cargo \\\n            audit --ignore RUSTSEC-2026-0001\n";
    expectRed(
      { ".github/workflows/ci.yml": workflow },
      "UNDATED .github/workflows/ci.yml:8 GHSA-aaaa-bbbb-cccc",
      "UNDATED .github/workflows/ci.yml:10 RUSTSEC-2026-0001",
    );
  });

  test("c25: bun pm audit, cargo +toolchain audit, bun audit --audit-level", () => {
    const workflow =
      "on: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: bun pm audit --ignore=GHSA-aaaa-bbbb-cccc\n      - run: cargo +stable audit --ignore RUSTSEC-2026-0001\n      - run: bun audit --audit-level=critical\n";
    expectRed(
      { ".github/workflows/ci.yml": workflow },
      "UNDATED .github/workflows/ci.yml:6 GHSA-aaaa-bbbb-cccc",
      "UNDATED .github/workflows/ci.yml:7 RUSTSEC-2026-0001",
      "UNDATED .github/workflows/ci.yml:8 bun audit --audit-level=critical",
    );
  });

  test("an --ignore near `audit` in a plain multi-line YAML scalar is UNPARSEABLE", () => {
    const workflow =
      "jobs:\n  a:\n    steps:\n      - run: bun audit\n          --ignore=GHSA-aaaa-bbbb-cccc\n";
    expectRed({ ".github/workflows/ci.yml": workflow }, "UNPARSEABLE .github/workflows/ci.yml:5");
  });
});

describe("item 6: an id behind a variable", () => {
  test('c23: --ignore="$IDS" is MALFORMED-ID', () => {
    const workflow = `${ANCHOR}on: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    env:\n      IDS: GHSA-aaaa-bbbb-cccc,GHSA-dddd-eeee-ffff\n    steps:\n      - run: bun audit --ignore="$IDS" # see list; expires=2026-12-31; ref=docs/r.md\n`;
    expectRed({ ".github/workflows/ci.yml": workflow }, "MALFORMED-ID .github/workflows/ci.yml:9");
  });
});

describe("item 7: a cargo-deny crate spec is an id", () => {
  test("c32: { crate = ..., reason = ... } passes", () => {
    const text = `${ANCHOR}[advisories]\nignore = [\n  { crate = "openssl@0.10.0", reason = "not reachable; expires=2026-12-31; ref=docs/r.md" },\n]\n`;
    expectGreen({ "deny.toml": text });
  });
});

describe("item 8: an osv multi-line reason is read, not refused", () => {
  test("c15: the reason is parsed; only the rule-based defects remain", () => {
    const text = `${ANCHOR}[[IgnoredVulns]]\nid = "GHSA-aaaa-bbbb-cccc"\nignoreUntil = 2026-12-31\nreason = """\nexpires=2026-11-01 ref=docs/r.md\n"""\n`;
    const output = expectRed({ "osv-scanner.toml": text }, "MISPLACED-EXPIRY", "UNJUSTIFIED");
    expect(output).not.toContain("UNPARSEABLE");
  });

  test("c15 compliant: a multi-line reason with a justification passes", () => {
    const text = `${ANCHOR}[[IgnoredVulns]]\nid = "GHSA-aaaa-bbbb-cccc"\nignoreUntil = 2026-12-31\nreason = """\nhost confusion is unreachable from our call sites;\nref=docs/r.md\n"""\n`;
    expectGreen({ "osv-scanner.toml": text });
  });
});

describe("item 9: tokens need a word boundary", () => {
  test("c45: noexpires= and preref= are not tokens", () => {
    const text = `${ANCHOR}[advisories]\nignore = [\n  "RUSTSEC-2026-0001", # reason; noexpires=2026-12-31; preref=docs/r.md\n]\n`;
    expectRed({ "deny.toml": text }, "UNDATED deny.toml:4", "UNREFERENCED deny.toml:4");
  });
});

describe("item 10: a weak ref or justification", () => {
  const entry = (metadata: string) =>
    `${ANCHOR}[advisories]\nignore = [\n  "RUSTSEC-2026-0001", # ${metadata}\n]\n`;

  test("c41: a ref to the waiver file itself", () => {
    expectRed(
      { "deny.toml": entry("reason text; expires=2026-12-31; ref=deny.toml") },
      "UNRESOLVED-REF deny.toml:4",
    );
  });

  test("c44: a ref to a directory", () => {
    expectRed(
      { "deny.toml": entry("reason text; expires=2026-12-31; ref=docs") },
      "UNRESOLVED-REF deny.toml:4",
    );
  });

  test("c47: a two-letter justification", () => {
    expectRed(
      { "deny.toml": entry("expires=2026-12-31; ref=docs/r.md; ok") },
      "UNJUSTIFIED deny.toml:4",
    );
  });

  test("a justification that is only a path is not one", () => {
    expectRed(
      { "deny.toml": entry("see docs/adr/0005-waivers.md; expires=2026-12-31; ref=docs/r.md") },
      "UNJUSTIFIED deny.toml:4",
    );
  });
});

describe("item 11: equivalent mechanisms are waivers", () => {
  test("c36: [graph] exclude, unmaintained = none, unsound = none", () => {
    const text =
      '[graph]\nexclude = ["openssl"]\n[advisories]\nunmaintained = "none"\nunsound = "none"\n';
    expectRed(
      { "deny.toml": text },
      'UNDATED deny.toml:2 graph.exclude "openssl"',
      'UNDATED deny.toml:4 advisories.unmaintained = "none"',
      'UNDATED deny.toml:5 advisories.unsound = "none"',
    );
  });

  test("a vulnerability-level downgrade in deny.toml", () => {
    expectRed(
      { "deny.toml": '[advisories]\nvulnerability = "warn"\n' },
      'UNDATED deny.toml:2 advisories.vulnerability = "warn"',
    );
  });

  test("cargo deny check -A vulnerability on a command line", () => {
    const workflow =
      "jobs:\n  a:\n    steps:\n      - run: cargo deny check -A vulnerability advisories\n";
    expectRed(
      { ".github/workflows/ci.yml": workflow },
      "UNDATED .github/workflows/ci.yml:4 cargo deny -A vulnerability",
    );
  });

  test("the same mechanisms, dated and referenced, pass", () => {
    const text = `${ANCHOR}[graph]\nexclude = [\n  "openssl", # vendored and audited by hand; expires=2026-12-31; ref=docs/r.md\n]\n[advisories]\nunmaintained = "none" # no maintained alternative yet; expires=2026-12-31; ref=docs/r.md\n`;
    const workflow = `${ANCHOR}jobs:\n  a:\n    steps:\n      - run: cargo deny check -A unsound # tracked upstream issue; expires=2026-12-31; ref=docs/r.md\n`;
    expectGreen({ "deny.toml": text, ".github/workflows/ci.yml": workflow });
  });

  test("the fleet base deny.toml (Y43) carries no waiver", () => {
    const base =
      '[graph]\nall-features = true\n\n[advisories]\nyanked = "deny"\n\n[licenses]\nconfidence-threshold = 0.9\nprivate = { ignore = true }\nallow = [\n  "MIT",\n  "Apache-2.0 WITH LLVM-exception",\n]\n';
    const output = expectGreen({ "deny.toml": base });
    expect(output).toContain("0 waiver(s) read");
  });
});

describe("volume: inspected and skipped add up to classified", () => {
  test("a manifest with no audit command is classified and skipped with its reason", () => {
    const output = expectGreen({ "deny.toml": VALID });
    expect(output).toContain(
      "1 waiver(s) read across 1 inspected of 2 classified file(s) (1 skipped: 1 no audit command)",
    );
  });

  test("fixture-marked files are swept out by name, never silently", () => {
    const output = expectGreen({
      "tools/fixture.ts": "// allow-audit-flag-fixture\nconst x = 'bun audit --ignore=GHSA-a';\n",
    });
    expect(output).toContain("1 fixture-marked: tools/fixture.ts");
  });
});
