import { describe, expect, test } from "bun:test";
import {
  classifySource,
  type DefectCode,
  dayNumber,
  evaluateWaivers,
  readAuditCommandSource,
  readCargoSource,
  readMetadata,
  readOsvSource,
  readWaiverFile,
  type SourceReading,
  unreadableSource,
  volumeLine,
} from "./advisory-waivers";

// allow-audit-flag-fixture: the fixtures below write `bun audit --ignore=`
// command lines that are only ever parsed, never executed.

// The fixtures below replay the two states of `libre-ai/feed-radar`'s
// `.cargo/audit.toml` that the original gate was written against (feed-radar
// commits 64f9b9d5 and 4f0f2bbc, restored from the donor mirror archived
// 2026-10-07): eight undated waivers, then three dated ones.

const REF = "docs/adr/0005-dependency-advisory-waivers.md";
const tracked = new Set([REF, "docs/adr/README.md"]);
// Files only: since the 2026-10-09 review (c44) a directory is not a record.
const isTrackedFile = (ref: string) => tracked.has(ref);

const UNDATED_AUDIT = `# cargo-audit config
[advisories]
ignore = [
    "RUSTSEC-2026-0174", # http-types via async-stripe
    "RUSTSEC-2024-0384", # instant via async-stripe path
    "RUSTSEC-2024-0436", # paste via UI dependencies
    "RUSTSEC-2026-0173", # proc-macro-error2 via UI/validator dependencies
    "RUSTSEC-2023-0071", # rsa via sqlx-mysql
    "RUSTSEC-2026-0097", # rand 0.7 via async-stripe/http-types
    "RUSTSEC-2026-0194", # quick-xml NsReader via feed-rs 2.3
    "RUSTSEC-2026-0195", # quick-xml via feed-rs 2.3
]
`;

const DATED_AUDIT = `# waiver-review-anchor: 2026-07-26
[advisories]
ignore = [
    "RUSTSEC-2026-0174", # http-types 2.12.0 via optional stripe; expires=2026-09-30; ref=${REF}
    "RUSTSEC-2024-0384", # instant 0.1.13, same optional path; expires=2026-09-30; ref=${REF}
    "RUSTSEC-2026-0097", # rand 0.7.3, same optional path; expires=2026-09-30; ref=${REF}
]
`;

function audit(text: string, file = ".cargo/audit.toml"): SourceReading {
  return readCargoSource(file, "cargo-audit", text);
}

function codes(readings: SourceReading[], today = "2026-08-15"): DefectCode[] {
  return evaluateWaivers(readings, { today, isTrackedFile }).defects.map((defect) => defect.code);
}

/** One dated, referenced, justified entry with the given line metadata. */
function single(metadata: string, anchor = "2026-07-26"): string {
  return `# waiver-review-anchor: ${anchor}\n[advisories]\nignore = [\n  "RUSTSEC-2026-0174", # ${metadata}\n]\n`;
}

describe("dayNumber", () => {
  test("reads real calendar dates, leap days included", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("2024-02-29")).toBe((dayNumber("2024-03-01") ?? 0) - 1);
    expect((dayNumber("2026-09-30") ?? 0) - (dayNumber("2026-07-26") ?? 0)).toBe(66);
  });

  test("refuses dates that do not exist or are not ISO 8601", () => {
    for (const value of ["2026-02-29", "2026-13-01", "2026-04-31", "2026-9-30", "30/09/2026", ""]) {
      expect(dayNumber(value)).toBeNull();
    }
  });
});

describe("readMetadata", () => {
  test("separates the date, the record and the justification", () => {
    expect(readMetadata(` rand 0.7.3 via stripe; expires=2026-09-30; ref=${REF}`)).toEqual({
      expires: "2026-09-30",
      ref: REF,
      justification: "rand 0.7.3 via stripe",
    });
  });

  test("an entry carrying only its tokens has no justification", () => {
    expect(readMetadata(` expires=2026-09-30; ref=${REF}`).justification).toBe("");
  });
});

describe("classifySource", () => {
  test("names every waiver mechanism the policy covers", () => {
    expect(classifySource(".cargo/audit.toml")).toBe("cargo-audit");
    expect(classifySource("crates/sdk/.cargo/audit.toml")).toBe("cargo-audit");
    expect(classifySource("crates/sdk/deny.toml")).toBe("cargo-deny");
    expect(classifySource("osv-scanner.toml")).toBe("osv-scanner");
    expect(classifySource(".github/workflows/ci.yml")).toBe("audit-command");
    expect(classifySource("packages/ui/package.json")).toBe("audit-command");
    expect(classifySource("scripts/audit.sh")).toBe("audit-command");
    expect(classifySource("docs/security/ADVISORY-WAIVER-POLICY.md")).toBeNull();
    expect(classifySource("audit.toml")).toBeNull();
    // cargo-deny 0.19.5 reads these two as well (c02, c03).
    expect(classifySource(".deny.toml")).toBe("cargo-deny");
    expect(classifySource(".cargo/deny.toml")).toBe("cargo-deny");
    expect(classifySource(".github/actions/sec/action.yml")).toBe("audit-command");
    expect(classifySource("Makefile")).toBe("audit-command");
    expect(classifySource("justfile")).toBe("audit-command");
    expect(classifySource("scripts/audit.bash")).toBe("audit-command");
  });
});

describe("readWaiverFile — the one reading other controls reuse", () => {
  test("a named mechanism is read by its name", () => {
    const reading = readWaiverFile("deny.toml", '[advisories]\nignore = ["RUSTSEC-2026-0174"]\n');
    expect(reading?.kind).toBe("cargo-deny");
    expect(reading?.entries.map((entry) => entry.id)).toEqual(["RUSTSEC-2026-0174"]);
  });

  test("any other text file is a source only when it carries a waiver-shaped flag", () => {
    expect(readWaiverFile("README.md", "Run `bun audit` before a release.\n")).toBeNull();
    const reading = readWaiverFile("docs/run.md", "bun audit --ignore=GHSA-7p8r-x3mc-p8w7\n");
    expect(reading?.kind).toBe("other-text");
    expect(reading?.unattributed).toEqual([1]);
  });

  test("a fixture marker exempts only a file that has no reader", () => {
    const flagged = "# allow-audit-flag-fixture\nbun audit --ignore=GHSA-7p8r-x3mc-p8w7\n";
    expect(readWaiverFile("tools/x.test.ts", flagged)?.skipped).toBe("fixture-marked");
    // A workflow cannot exempt itself: the marker is not read there.
    const workflow = readWaiverFile(".github/workflows/ci.yml", `- run: ${flagged}`);
    expect(workflow?.skipped).toBeNull();
    expect(workflow?.entries.map((entry) => entry.id)).toEqual(["GHSA-7p8r-x3mc-p8w7"]);
  });
});

describe("feed-radar replay", () => {
  test("the eight undated waivers of 2026-07-25 are eight UNDATED and the missing anchor", () => {
    const found = codes([audit(UNDATED_AUDIT)]);
    expect(found.filter((code) => code === "UNDATED")).toHaveLength(8);
    expect(found.filter((code) => code === "UNREFERENCED")).toHaveLength(8);
    expect(found).toContain("NO-ANCHOR");
  });

  test("the three dated waivers are clean while the clock is far from their expiry", () => {
    const evaluation = evaluateWaivers([audit(DATED_AUDIT)], {
      today: "2026-08-15",
      isTrackedFile,
    });
    expect(evaluation.defects).toEqual([]);
    expect(evaluation.waivers).toBe(3);
    expect(evaluation.clean).toHaveLength(3);
    expect(evaluation.expiringSoon).toBe(0);
  });

  test("inside the warning window they warn, still pass, and are counted", () => {
    const evaluation = evaluateWaivers([audit(DATED_AUDIT)], {
      today: "2026-09-10",
      isTrackedFile,
    });
    expect(evaluation.defects).toEqual([]);
    expect(evaluation.expiringSoon).toBe(3);
    expect(evaluation.warnings[0]).toContain("in 20 day(s)");
  });

  test("on the expiry day they still hold; the day after they fail", () => {
    expect(codes([audit(DATED_AUDIT)], "2026-09-30")).toEqual([]);
    expect(codes([audit(DATED_AUDIT)], "2026-10-01")).toEqual(["EXPIRED", "EXPIRED", "EXPIRED"]);
  });
});

describe("tier 1 refusals", () => {
  test("NO-ID: an empty id", () => {
    const text = `# waiver-review-anchor: 2026-07-26\n[advisories]\nignore = [\n  "", # x; expires=2026-09-30; ref=${REF}\n]\n`;
    expect(codes([audit(text)])).toEqual(["NO-ID"]);
  });

  test("UNDATED: no expires= on the line", () => {
    expect(codes([audit(single(`stripe path; ref=${REF}`))])).toEqual(["UNDATED"]);
  });

  test("MALFORMED-DATE: a date that does not exist", () => {
    expect(codes([audit(single(`stripe path; expires=2026-02-30; ref=${REF}`))])).toEqual([
      "MALFORMED-DATE",
    ]);
  });

  test("UNREFERENCED: no ref=", () => {
    expect(codes([audit(single("stripe path; expires=2026-09-30"))])).toEqual(["UNREFERENCED"]);
  });

  test("UNRESOLVED-REF: a ref to a record the repository does not track", () => {
    expect(
      codes([audit(single("stripe path; expires=2026-09-30; ref=docs/adr/0099-gone.md"))]),
    ).toEqual(["UNRESOLVED-REF"]);
    expect(codes([audit(single("stripe path; expires=2026-09-30; ref=../outside.md"))])).toEqual([
      "UNRESOLVED-REF",
    ]);
  });

  test("an https ref resolves; a directory or the waiver file itself does not", () => {
    expect(
      codes([audit(single("stripe path; expires=2026-09-30; ref=https://rustsec.org/a/1.html"))]),
    ).toEqual([]);
    expect(codes([audit(single("stripe path; expires=2026-09-30; ref=docs/adr"))])).toEqual([
      "UNRESOLVED-REF",
    ]);
    const self = audit(
      single("stripe path; expires=2026-09-30; ref=docs/adr/README.md"),
      "docs/adr/README.md",
    );
    expect(codes([self])).toEqual(["UNRESOLVED-REF"]);
  });

  test("UNJUSTIFIED: a word, or a path, is not a justification", () => {
    expect(codes([audit(single(`ok; expires=2026-09-30; ref=${REF}`))])).toEqual(["UNJUSTIFIED"]);
    expect(codes([audit(single(`stripe; expires=2026-09-30; ref=${REF}`))])).toEqual([
      "UNJUSTIFIED",
    ]);
    expect(codes([audit(single(`see ${REF}; expires=2026-09-30; ref=${REF}`))])).toEqual([
      "UNJUSTIFIED",
    ]);
  });

  test("UNJUSTIFIED: only the tokens", () => {
    expect(codes([audit(single(`expires=2026-09-30; ref=${REF}`))])).toEqual(["UNJUSTIFIED"]);
  });

  test("NO-ANCHOR: waivers without a review anchor", () => {
    const text = `[advisories]\nignore = [\n  "RUSTSEC-2026-0174", # stripe path; expires=2026-09-30; ref=${REF}\n]\n`;
    expect(codes([audit(text)])).toEqual(["NO-ANCHOR"]);
  });

  test("MALFORMED-ANCHOR: an anchor that is not a date", () => {
    expect(
      codes([audit(single(`stripe path; expires=2026-09-30; ref=${REF}`, "2026-7-26"))]),
    ).toEqual(["MALFORMED-ANCHOR"]);
  });

  test("LAPSED: already expired when the list was last reviewed", () => {
    // With an anchor no later than today, a lapsed entry is also expired; the
    // two verdicts name different defects (a bad commit vs. the clock).
    expect(
      codes(
        [audit(single(`stripe path; expires=2026-07-01; ref=${REF}`, "2026-07-26"))],
        "2026-07-26",
      ),
    ).toEqual(["LAPSED", "EXPIRED"]);
  });

  test("OVER-HORIZON: dated more than 365 days past the anchor", () => {
    expect(codes([audit(single(`stripe path; expires=2099-01-01; ref=${REF}`))])).toEqual([
      "OVER-HORIZON",
    ]);
    // 2026-07-26 + 365 days is the last admissible date.
    expect(codes([audit(single(`stripe path; expires=2027-07-26; ref=${REF}`))])).toEqual([]);
    expect(codes([audit(single(`stripe path; expires=2027-07-27; ref=${REF}`))])).toEqual([
      "OVER-HORIZON",
    ]);
  });

  test("INCOHERENT: one advisory, two files, two dates", () => {
    const deny = readCargoSource(
      "deny.toml",
      "cargo-deny",
      single(`stripe path; expires=2026-09-29; ref=${REF}`),
    );
    expect(codes([audit(single(`stripe path; expires=2026-09-30; ref=${REF}`)), deny])).toEqual([
      "INCOHERENT",
    ]);
  });

  test("the same advisory with the same date in two files is coherent", () => {
    const deny = readCargoSource(
      "deny.toml",
      "cargo-deny",
      single(`stripe path; expires=2026-09-30; ref=${REF}`),
    );
    expect(codes([audit(single(`stripe path; expires=2026-09-30; ref=${REF}`)), deny])).toEqual([]);
  });
});

describe("tier 2 refusals", () => {
  test("FUTURE-ANCHOR: an anchor after today cannot record a review", () => {
    expect(
      codes(
        [audit(single(`stripe path; expires=2026-09-30; ref=${REF}`, "2026-08-20"))],
        "2026-08-15",
      ),
    ).toEqual(["FUTURE-ANCHOR"]);
    // One day of tolerance for a commit made east of UTC.
    expect(
      codes(
        [audit(single(`stripe path; expires=2026-09-30; ref=${REF}`, "2026-08-16"))],
        "2026-08-15",
      ),
    ).toEqual([]);
  });
});

describe("sources that cannot be read are failures, never zero waivers", () => {
  test("UNREADABLE", () => {
    const reading = unreadableSource("deny.toml", "cargo-deny", "ENOENT");
    const evaluation = evaluateWaivers([reading], { today: "2026-08-15", isTrackedFile });
    expect(evaluation.defects.map((defect) => defect.code)).toEqual(["UNREADABLE"]);
    expect(evaluation.classified).toBe(1);
    expect(evaluation.inspected).toBe(1);
    expect(evaluation.waivers).toBe(0);
  });

  test("UNPARSEABLE: invalid TOML", () => {
    expect(codes([audit("[advisories\nignore = [")])).toEqual(["UNPARSEABLE"]);
  });

  test("a dotted `advisories.ignore` key is read like the table form", () => {
    // The PR #56 line scanner could not see it and refused the file; the
    // positional parser reads it, so its entry is judged instead.
    const text = `advisories.ignore = ["RUSTSEC-2026-0174"]\n`;
    expect(audit(text).entries.map((entry) => entry.line)).toEqual([1]);
    expect(codes([audit(text)])).toContain("UNDATED");
  });

  test("UNPARSEABLE: `advisories.ignore` that is not an array", () => {
    expect(codes([audit(`[advisories]\nignore = "RUSTSEC-2026-0174"\n`)])).toEqual(["UNPARSEABLE"]);
  });

  test("UNPARSEABLE: an osv table line that is not key = value", () => {
    const reading = readOsvSource(
      "osv-scanner.toml",
      "[[IgnoredVulns]]\nid = 'GHSA-x'\nnonsense\n",
    );
    expect(reading.error).toContain("line 3");
  });

  test("an array never closed and an unterminated string are refused with their line", () => {
    expect(audit('[advisories]\nignore = [\n  "RUSTSEC-2026-0174",\n').error).toContain(
      "not valid TOML: line 4",
    );
    expect(audit('[advisories]\nignore = [\n  "RUSTSEC-2026-0174,\n]\n').error).toContain(
      "not valid TOML: line 3: unterminated string",
    );
  });

  test("a deny.toml without an ignore list is a readable source with no waiver", () => {
    const reading = readCargoSource("deny.toml", "cargo-deny", `[advisories]\nyanked = "deny"\n`);
    expect(reading.error).toBeNull();
    expect(reading.entries).toEqual([]);
    expect(codes([reading])).toEqual([]);
  });
});

describe("equivalent mechanisms (owner decision 2026-10-09)", () => {
  test("cargo-audit severity_threshold is a waiver and needs its metadata", () => {
    const bare = audit('[advisories]\nseverity_threshold = "high"\n');
    expect(bare.entries.map((entry) => entry.id)).toEqual([
      'advisories.severity_threshold = "high"',
    ]);
    expect(codes([bare])).toContain("UNDATED");
    const dated = audit(
      `# waiver-review-anchor: 2026-07-26\n[advisories]\nseverity_threshold = "high" # low findings triaged weekly; expires=2026-09-30; ref=${REF}\n`,
    );
    expect(codes([dated])).toEqual([]);
  });

  test("cargo-deny scope and level keys at their defaults are not waivers", () => {
    const reading = readCargoSource(
      "deny.toml",
      "cargo-deny",
      '[advisories]\nunmaintained = "all"\nunsound = "all"\nvulnerability = "deny"\nnotice = "deny"\n',
    );
    expect(reading.entries).toEqual([]);
  });

  test("a narrowed scope and a notice downgrade are waivers", () => {
    const reading = readCargoSource(
      "deny.toml",
      "cargo-deny",
      '[advisories]\nunmaintained = "workspace"\nnotice = "allow"\n',
    );
    expect(reading.entries.map((entry) => `${entry.line} ${entry.id}`)).toEqual([
      '2 advisories.unmaintained = "workspace"',
      '3 advisories.notice = "allow"',
    ]);
  });
});

describe("source formats", () => {
  test("deny.toml inline tables carry the metadata in `reason` or the comment", () => {
    const text = `# waiver-review-anchor: 2026-07-26
[advisories]
ignore = [
  { id = "RUSTSEC-2026-0174", reason = "stripe path; expires=2026-09-30; ref=${REF}" },
  { id = "RUSTSEC-2024-0384" }, # instant via stripe; expires=2026-09-30; ref=${REF}
  { id = "RUSTSEC-2026-0097", reason = "rand via stripe" },
]
`;
    const reading = readCargoSource("deny.toml", "cargo-deny", text);
    expect(reading.error).toBeNull();
    expect(reading.entries.map((entry) => entry.id)).toEqual([
      "RUSTSEC-2026-0174",
      "RUSTSEC-2024-0384",
      "RUSTSEC-2026-0097",
    ]);
    expect(codes([reading])).toEqual(["UNDATED", "UNREFERENCED"]);
  });

  test("a single-line ignore list is read entry by entry", () => {
    const text = `# waiver-review-anchor: 2026-07-26\n[advisories]\nignore = ["RUSTSEC-2026-0174", "RUSTSEC-2024-0384"] # stripe path; expires=2026-09-30; ref=${REF}\n`;
    const reading = audit(text);
    expect(reading.entries).toHaveLength(2);
    expect(codes([reading])).toEqual([]);
  });

  test("an empty ignore list is the goal state", () => {
    const reading = audit("[advisories]\nignore = []\n");
    expect(reading.error).toBeNull();
    expect(codes([reading])).toEqual([]);
  });

  test("osv-scanner: ignoreUntil is the expiry, reason carries ref and justification", () => {
    const text = `# waiver-review-anchor: 2026-07-26
[[IgnoredVulns]]
id = "GHSA-7p8r-x3mc-p8w7"
ignoreUntil = 2026-09-30
reason = "host confusion unreachable from our call sites; ref=${REF}"

[[IgnoredVulns]]
id = "CVE-2026-12345"
ignoreUntil = 2026-09-30T00:00:00Z
reason = "no justification record"
`;
    const reading = readOsvSource("osv-scanner.toml", text);
    expect(reading.entries.map((entry) => entry.id)).toEqual([
      "GHSA-7p8r-x3mc-p8w7",
      "CVE-2026-12345",
    ]);
    expect(codes([reading])).toEqual(["UNREFERENCED"]);
  });

  test("audit commands: an ignore flag on a commented line is a dated waiver", () => {
    const workflow = `# waiver-review-anchor: 2026-07-26
jobs:
  audit:
    steps:
      - run: bun audit --ignore=GHSA-7p8r-x3mc-p8w7 # host confusion unreachable; expires=2026-09-30; ref=${REF}
      - run: cargo audit --ignore RUSTSEC-2026-0174 --ignore RUSTSEC-2024-0384 # stripe path; expires=2026-09-30; ref=${REF}
      - run: bun audit
`;
    const reading = readAuditCommandSource(".github/workflows/ci.yml", workflow);
    expect(reading.entries.map((entry) => entry.id)).toEqual([
      "GHSA-7p8r-x3mc-p8w7",
      "RUSTSEC-2026-0174",
      "RUSTSEC-2024-0384",
    ]);
    expect(codes([reading])).toEqual([]);
  });

  test("audit commands: a package.json exclusion cannot be dated, so it fails", () => {
    const manifest = `{ "scripts": { "audit": "bun audit --ignore=GHSA-7p8r-x3mc-p8w7,GHSA-1234-abcd-ef56" } }`;
    const reading = readAuditCommandSource("package.json", manifest);
    expect(reading.entries).toHaveLength(2);
    const found = codes([reading]);
    expect(found).toContain("NO-ANCHOR");
    expect(found.filter((code) => code === "UNDATED")).toHaveLength(2);
  });

  test("audit commands: a continued command is followed onto its next line", () => {
    const script =
      "bun audit \\\n  --ignore=GHSA-7p8r-x3mc-p8w7\necho done --ignore=not-an-audit\n";
    const reading = readAuditCommandSource("scripts/audit.sh", script);
    expect(reading.entries.map((entry) => entry.id)).toEqual(["GHSA-7p8r-x3mc-p8w7"]);
  });

  test("prose about `bun audit` without a flag is not a waiver", () => {
    const reading = readAuditCommandSource(
      ".github/workflows/ci.yml",
      "# A bare `bun audit` turned the state of the world into a verdict\n- run: bun audit\n",
    );
    expect(reading.entries).toEqual([]);
  });
});

describe("volumeLine", () => {
  test("states waivers, files and the expiring count", () => {
    const evaluation = evaluateWaivers(
      [audit(DATED_AUDIT), readCargoSource("deny.toml", "cargo-deny", "[advisories]\n")],
      { today: "2026-09-10", isTrackedFile },
    );
    expect(volumeLine(evaluation)).toBe(
      "3 waiver(s) read across 2 inspected of 2 classified file(s) (0 skipped), 3 expiring within 30 days (1 cargo-audit, 1 cargo-deny, 0 osv-scanner, 0 audit-command, 0 other-text source(s))",
    );
  });

  test("an invalid clock is refused rather than silently read as epoch", () => {
    expect(() => evaluateWaivers([], { today: "2026-9-10", isTrackedFile })).toThrow();
  });
});
