// Skill lint (T1) — pure structural checks over one SKILL.md and its eval.json.
//
// Kept apart from check-skills.ts (the CLI/gate wrapper) for two reasons: the
// frontmatter parser here is reused by check-skills-routing.ts (T2), which needs
// the same `name`/`description` fields without re-implementing the parse; and a
// pure function taking file *contents* (never touching the filesystem itself) is
// unit-testable without fixtures on disk, matching this repository's
// lib-pure-plus-.test.ts convention (see tools/quality/check-retired-names.ts).

export interface ParsedSkillFile {
  readonly frontmatter: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface FrontmatterError {
  readonly error: string;
}

/**
 * Minimal frontmatter parser: `---` fence, `key: value` scalar lines, `---`
 * fence, body. No list/nested-object support — every field this repository's
 * skills declare (name, description, license, status,
 * disable-model-invocation) is a single-line scalar, so a full YAML parser
 * would be a dependency bought for nothing this file needs.
 */
export function parseFrontmatter(source: string): ParsedSkillFile | FrontmatterError {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { error: "SKILL.md must open with a `---` frontmatter fence on line 1" };
  }
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) {
    return { error: "frontmatter opened with `---` but never closed with a second `---`" };
  }
  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, closingIndex)) {
    if (line.trim() === "") continue;
    // A real top-level key always starts at column 0 in this flat-scalar
    // format (see the parser's doc comment). A line that starts with
    // whitespace is a YAML folded/continuation line for the previous key —
    // unsupported here. Silently indexOf(":")-parsing it as its own key
    // would, for a continuation that happens to contain a colon (e.g. "Use
    // when: X" wrapped onto its own line), plant a bogus key while quietly
    // truncating the real field's value to its first line. Fail loud
    // instead of folding it wrong.
    if (/^\s/.test(line)) {
      return {
        error: `multi-line scalars are not supported in skill frontmatter — put the whole value on one line: "${line}"`,
      };
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      return { error: `malformed frontmatter line (no ":"): "${line}"` };
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    frontmatter[key] = value;
  }
  const body = lines.slice(closingIndex + 1).join("\n");
  return { frontmatter, body };
}

/** Body line count, blank lines included, leading/trailing blank runs trimmed. */
export function bodyLineCount(body: string): number {
  const lines = body.split("\n");
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

export interface LintFinding {
  readonly rule: string;
  readonly ok: boolean;
  readonly note: string;
}

export const REQUIRED_FRONTMATTER_FIELDS = ["name", "description", "license", "status"] as const;
export const ALLOWED_STATUS = new Set(["candidate", "promoted"]);
// Built from a split tag rather than one literal string: `reuse lint` greps
// source text blindly for the SPDX tag followed by a colon, with no notion
// that this occurrence is the constant's *definition*, not a real
// declaration on this file — the same false positive ADR-0025's collision
// table hit and fixed the same way (never spell the tag and colon out as one
// contiguous literal in prose or code that merely mentions it).
const SPDX_TAG = "SPDX-License-Identifier";
export const SPDX_LICENSE_LINE = `${SPDX_TAG}: Apache-2.0`;
export const BODY_LINE_TARGET = 120;
export const BODY_LINE_WARNING = 200;
export const MIN_POSITIVE_TRIGGERS = 3;
export const MIN_NEGATIVE_TRIGGERS = 2;

function truncate(value: string, max = 72): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Lint one SKILL.md's structure: frontmatter fields, name/directory agreement,
 * status enum, declared licence, an SPDX header (deliberately inline —
 * skills/** is a portable unit meant to be copied into another harness with
 * its licence travelling with the file, not only resolved through this
 * repository's REUSE.toml), and at least one Markdown heading in the body.
 *
 * The 120-line target is a writing budget, not a gate: it is asserted nowhere
 * here. Only the 200-line warning is surfaced, and as a non-blocking note —
 * see check-skills.ts, which prints it outside the GateReport rather than
 * failing a check over a style guideline (anti-gold-plating: a hard length
 * gate would protect nothing an eval and a reviewer don't already catch).
 */
export function lintSkillMarkdown(dirName: string, source: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const parsed = parseFrontmatter(source);
  if ("error" in parsed) {
    findings.push({ rule: "frontmatter-fence", ok: false, note: parsed.error });
    return findings;
  }
  findings.push({
    rule: "frontmatter-fence",
    ok: true,
    note: "opening and closing `---` fences present",
  });

  for (const field of REQUIRED_FRONTMATTER_FIELDS) {
    const value = parsed.frontmatter[field];
    const ok = Boolean(value && value.length > 0);
    findings.push({
      rule: `frontmatter-field:${field}`,
      ok,
      note: ok
        ? `present: "${truncate(value as string)}"`
        : `missing required frontmatter field "${field}"`,
    });
  }

  const name = parsed.frontmatter.name;
  const nameOk = name === dirName;
  findings.push({
    rule: "frontmatter-name-matches-directory",
    ok: nameOk,
    note: nameOk
      ? `name matches directory "${dirName}"`
      : `frontmatter name "${name ?? ""}" does not match directory "${dirName}"`,
  });

  const status = parsed.frontmatter.status;
  const statusOk = status !== undefined && ALLOWED_STATUS.has(status);
  findings.push({
    rule: "frontmatter-status",
    ok: statusOk,
    note: statusOk
      ? `status "${status}"`
      : `status must be one of ${[...ALLOWED_STATUS].join("|")}, found "${status ?? ""}"`,
  });

  const license = parsed.frontmatter.license;
  const licenseOk = license === "Apache-2.0";
  findings.push({
    rule: "frontmatter-license",
    ok: licenseOk,
    note: licenseOk
      ? "license: Apache-2.0"
      : `frontmatter license must be "Apache-2.0", found "${license ?? ""}"`,
  });

  const disableModelInvocation = parsed.frontmatter["disable-model-invocation"];
  const disableOk =
    disableModelInvocation === undefined ||
    disableModelInvocation === "true" ||
    disableModelInvocation === "false";
  findings.push({
    rule: "frontmatter-disable-model-invocation",
    ok: disableOk,
    note: disableOk
      ? disableModelInvocation === undefined
        ? "not set — model-invoked"
        : `disable-model-invocation: ${disableModelInvocation}`
      : `disable-model-invocation must be "true" or "false" if present, found "${disableModelInvocation}"`,
  });

  const hasSpdx = source.includes(SPDX_LICENSE_LINE);
  findings.push({
    rule: "spdx-header",
    ok: hasSpdx,
    note: hasSpdx
      ? `"${SPDX_LICENSE_LINE}" present`
      : `missing an inline "${SPDX_LICENSE_LINE}" header`,
  });

  const hasHeading = /^#{1,6}\s+\S/m.test(parsed.body);
  findings.push({
    rule: "body-has-heading",
    ok: hasHeading,
    note: hasHeading
      ? "body carries at least one Markdown heading"
      : "body has no Markdown heading — a SKILL.md is structured guidance, not a wall of prose",
  });

  return findings;
}

/**
 * Structural lint of a skill's eval.json: at least MIN_POSITIVE_TRIGGERS
 * positive triggers and MIN_NEGATIVE_TRIGGERS negative triggers (both
 * consumed for real by check-skills-routing.ts, T2), plus exactly one
 * behavioral case with a scenario and an expected outcome.
 *
 * The behavioral case's content is deliberately never graded here or in T2:
 * "does the agent actually behave as described" is a judgment call outside
 * what a TF-IDF routing gate or a structural lint can mechanize honestly.
 * Mechanizing only what is mechanizable, and saying so, beats a script that
 * pretends to grade behaviour and never really does.
 */
export function lintEvalFile(raw: unknown): LintFinding[] {
  const findings: LintFinding[] = [];
  if (typeof raw !== "object" || raw === null) {
    findings.push({ rule: "eval-shape", ok: false, note: "eval.json must be a JSON object" });
    return findings;
  }
  const record = raw as Record<string, unknown>;

  const positive = record.positive;
  const positiveOk =
    Array.isArray(positive) &&
    positive.length >= MIN_POSITIVE_TRIGGERS &&
    positive.every((entry) => typeof entry === "string" && entry.trim().length > 0);
  findings.push({
    rule: "eval-positive-triggers",
    ok: positiveOk,
    note: positiveOk
      ? `${(positive as unknown[]).length} positive trigger(s)`
      : `"positive" must be an array of at least ${MIN_POSITIVE_TRIGGERS} non-empty strings`,
  });

  const negative = record.negative;
  const negativeOk =
    Array.isArray(negative) &&
    negative.length >= MIN_NEGATIVE_TRIGGERS &&
    negative.every((entry) => typeof entry === "string" && entry.trim().length > 0);
  findings.push({
    rule: "eval-negative-triggers",
    ok: negativeOk,
    note: negativeOk
      ? `${(negative as unknown[]).length} negative trigger(s)`
      : `"negative" must be an array of at least ${MIN_NEGATIVE_TRIGGERS} non-empty strings`,
  });

  const behavioral = record.behavioral;
  const behavioralRecord =
    typeof behavioral === "object" && behavioral !== null
      ? (behavioral as Record<string, unknown>)
      : null;
  const behavioralOk =
    behavioralRecord !== null &&
    typeof behavioralRecord.scenario === "string" &&
    (behavioralRecord.scenario as string).trim().length > 0 &&
    typeof behavioralRecord.expected === "string" &&
    (behavioralRecord.expected as string).trim().length > 0;
  findings.push({
    rule: "eval-behavioral-case",
    ok: behavioralOk,
    note: behavioralOk
      ? "behavioral case present with non-empty scenario and expected fields"
      : '"behavioral" must be an object with non-empty "scenario" and "expected" string fields',
  });

  return findings;
}
