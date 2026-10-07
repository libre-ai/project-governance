import { describe, expect, test } from "bun:test";
import {
  DECLARED_FILE_ALLOWANCES,
  evaluateKernelStatusAuthority,
  isExemptDirectory,
  KERNEL_FILE,
  scanForKernelStatusClaims,
} from "./check-kernel-status-authority";

// Kernel status authority gate (domain F/H, 2026-08-18): LOOP-SECURITY-KERNEL.md's
// status table is the single normative source for K1-K5 status; nothing else may
// restate one without being either a declared historical trace or a pointer that
// carries no status word of its own.

describe("scanForKernelStatusClaims", () => {
  test("K-number then status word", () => {
    expect(scanForKernelStatusClaims("K1 agent identity is in service today")).toEqual([
      { line: 1, text: "K1 agent identity is in service today" },
    ]);
  });

  test("status word then K-number (reverse order)", () => {
    expect(scanForKernelStatusClaims("the five controls are `in service` — K1 compris")).toEqual([
      { line: 1, text: "the five controls are `in service` — K1 compris" },
    ]);
  });

  test("case-insensitive, matches THREAT-MODEL.md's capitalised table cells", () => {
    expect(scanForKernelStatusClaims("| K1 agent facts | **Specified** |")).toHaveLength(1);
    expect(
      scanForKernelStatusClaims("| K4 CODEOWNERS + doctrine gate | **In service** |"),
    ).toHaveLength(1);
  });

  test("does not false-positive on 'unreviewed' near a K-number", () => {
    // "unreviewed" contains "reviewed" as a substring but not as a word — the
    // pattern requires a word boundary, so a finding classification like
    // "K4 `reject` findings (unreviewed HEAD ...)" must not trip the gate.
    expect(
      scanForKernelStatusClaims("K4 `reject` findings (unreviewed HEAD, no security pass)"),
    ).toEqual([]);
  });

  test("a bare K-number with no nearby status word is not a claim", () => {
    expect(scanForKernelStatusClaims("K4-A minor: the integration test no longer claims")).toEqual(
      [],
    );
  });

  test("a status word far beyond the window does not pair with the K-number", () => {
    const filler = "x".repeat(150);
    expect(scanForKernelStatusClaims(`K1 ${filler} in service`)).toEqual([]);
  });

  test("multiple matching lines are all reported, with correct line numbers", () => {
    const text = [
      "intro",
      "K2 classification: in service",
      "middle",
      "K5 register: specified",
    ].join("\n");
    expect(scanForKernelStatusClaims(text)).toEqual([
      { line: 2, text: "K2 classification: in service" },
      { line: 4, text: "K5 register: specified" },
    ]);
  });

  test("plain prose naming a control without a status word is not a claim", () => {
    expect(
      scanForKernelStatusClaims("K1-K5 close that hole. Each control names its requirement."),
    ).toEqual([]);
  });

  test("a wide markdown table row matches regardless of column distance", () => {
    // Reproduces POLARIS.md's actual K1 row shape: "K1" opens the row, the
    // status cell closes it 250+ characters later — well past the 100-char
    // prose window, and this must still be caught because the row is one
    // record about K1, not two unrelated mentions.
    const row =
      "| **K1** | Identité d'agent : flotte / mission / capacités / révocation per-`agent_id` | " +
      "Faits Biscuit lockés + `authority-v2` + `agent-runs-v2` + `AgentRevocationStore` fail-closed | " +
      "**IN SERVICE** (2026-07-20) |";
    expect(row.length).toBeGreaterThan(200);
    expect(scanForKernelStatusClaims(row)).toEqual([{ line: 1, text: row }]);
  });

  test("a wide table row with neither token close together but both present still matches", () => {
    const padding = "x".repeat(150);
    const row = `| K3 | ${padding} | specified |`;
    expect(scanForKernelStatusClaims(row)).toHaveLength(1);
  });

  test("a table row naming a control with no status word anywhere is not a claim", () => {
    const row = "| K2 | classification never authority | requirement text only |";
    expect(scanForKernelStatusClaims(row)).toEqual([]);
  });

  test("prose (not a table row) still respects the 100-character window", () => {
    const padding = "x".repeat(150);
    const prose = `K3 ${padding} specified`;
    expect(scanForKernelStatusClaims(prose)).toEqual([]);
  });
});

describe("isExemptDirectory", () => {
  test("exempts docs/reviews/, distribution/evidence/ and distribution/feeds/", () => {
    expect(isExemptDirectory("docs/reviews/authority-v2/PROMOTION-DOSSIER.md")).toBe(true);
    expect(isExemptDirectory("distribution/evidence/gate-acceptance-log.md")).toBe(true);
    expect(isExemptDirectory("distribution/feeds/changelog.md")).toBe(true);
  });

  test("does not exempt a sibling directory with a similar prefix", () => {
    expect(isExemptDirectory("docs/security/THREAT-MODEL.md")).toBe(false);
    expect(isExemptDirectory("distribution/index/README.md")).toBe(false);
    expect(isExemptDirectory("docs/reviewed-elsewhere.md")).toBe(false);
  });
});

describe("evaluateKernelStatusAuthority", () => {
  test("a file with no K-status claim passes, asserted", () => {
    // The three declared allowances are not part of this fixture, so they
    // fail as "did not scan" (covered below) — this assertion is scoped to
    // README.md's own check, not the run's overall outcome.
    const report = evaluateKernelStatusAuthority([{ path: "README.md", text: "hello" }]);
    const readme = report.checks.find((c) => c.item === "README.md");
    expect(readme?.ok).toBe(true);
  });

  test("an undeclared file asserting a K-status fails", () => {
    const report = evaluateKernelStatusAuthority([
      { path: "docs/method/SOMETHING.md", text: "K3 is in service as of today" },
    ]);
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toContain("docs/method/SOMETHING.md");
    expect(report.violations[0]).toContain(KERNEL_FILE);
  });

  test("a declared allowance carrying its claim passes", () => {
    const allowanceFile = DECLARED_FILE_ALLOWANCES[0]?.file;
    if (!allowanceFile) throw new Error("expected at least one declared allowance");
    // The other declared allowances are absent from this fixture and fail
    // separately (covered below) — this assertion is scoped to this one
    // file's own check.
    const report = evaluateKernelStatusAuthority([
      { path: allowanceFile, text: "K1 agent facts: **Specified**" },
    ]);
    const own = report.checks.find((c) => c.item === allowanceFile);
    expect(own?.ok).toBe(true);
  });

  test("every declared allowance is checked for staleness", () => {
    // None of the declared files are in this run's file list, so every
    // allowance is flagged: it names a file this run did not scan.
    const report = evaluateKernelStatusAuthority([{ path: "README.md", text: "hello" }]);
    expect(report.outcome).toBe("violations");
    expect(report.violations).toHaveLength(DECLARED_FILE_ALLOWANCES.length);
    for (const violation of report.violations) {
      expect(violation).toContain("did not scan");
    }
  });

  test("a declared allowance whose file no longer carries a K-status claim is stale", () => {
    const allowanceFile = DECLARED_FILE_ALLOWANCES[0]?.file;
    if (!allowanceFile) throw new Error("expected at least one declared allowance");
    const others = DECLARED_FILE_ALLOWANCES.slice(1).map((a) => ({
      path: a.file,
      text: "K1 in service (placeholder claim so this fixture is not itself stale)",
    }));
    const report = evaluateKernelStatusAuthority([
      { path: allowanceFile, text: "nothing about the kernel here" },
      ...others,
    ]);
    const staleness = report.violations.find((v) => v.startsWith(`${allowanceFile} (allowance)`));
    expect(staleness).toContain("no longer there");
  });

  test("zero files scanned still declares emptiness in code, even though allowance staleness fails", () => {
    const report = evaluateKernelStatusAuthority([]);
    expect(report.emptyReason).not.toBeNull();
    // Outcome is still "violations": every declared file allowance reports
    // as unscanned, which is real information (this run's glob found
    // nothing at all) rather than being silently swallowed by the
    // empty-run declaration.
    expect(report.outcome).toBe("violations");
  });
});
