// Skill lint (T1) — pure structural checks over one SKILL.md and its eval.json.
//
// Kept apart from check-skills.ts (the CLI/gate wrapper) for two reasons: the
// frontmatter parser here is reused by check-skills-routing.ts (T2), which needs
// the same `name`/`description` fields without re-implementing the parse; and a
// pure function taking file *contents* (never touching the filesystem itself) is
// unit-testable without fixtures on disk, matching this repository's
// lib-pure-plus-.test.ts convention (see tools/quality/check-retired-names.ts).

export interface ParsedSkillFile {
  /** Top-level scalar fields; `metadata` is not among them. */
  readonly frontmatter: Readonly<Record<string, string>>;
  /** The `metadata` block mapping (Agent Skills spec), empty when absent. */
  readonly metadata: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The one key whose value is a block mapping (ADR-0053). */
export const METADATA_KEY = "metadata";
const METADATA_ENTRY = /^ {2}[A-Za-z0-9_-]+:(?:\s.*)?$/;

export interface FrontmatterError {
  readonly error: string;
}

/**
 * Frontmatter parser: `---` fence, flat `key: value` scalar lines, `---`
 * fence, body. Two passes over the block, both required:
 *
 * 1. A line pass enforces the flat shape this collection admits — every key
 *    at column 0, one line per field, no key repeated. YAML itself allows
 *    folded values (a different shape) and its parser keeps the last of two
 *    duplicated keys silently, so neither can be left to the YAML pass.
 * 2. A YAML pass (`Bun.YAML`, built into the runtime — no dependency) must
 *    accept the block, and its values are the ones returned. Every harness
 *    that loads a skill reads this block as YAML: splitting on the first
 *    colon accepted `description: Use when: X`, which is a YAML syntax error,
 *    so a skill linted green here and failed to load there. Only scalar
 *    values are admitted; booleans and numbers are returned as their text.
 *
 * One exception to the flat shape (ADR-0053, 2026-10-14): `metadata`, the
 * Agent Skills field for free keys, is a block mapping — `metadata:` alone on
 * its line, then one `  key: value` line per entry, indented by two spaces,
 * scalar values only. The block form is the only one admitted because the
 * Agent Skills reference validator (`skills-ref`, strict YAML) rejects the
 * flow form `metadata: { key: value }` as a disallowed flow mapping (measured
 * 2026-10-14).
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
  const blockLines = lines.slice(1, closingIndex);
  const keys: string[] = [];
  let inMetadata = false;
  for (const line of blockLines) {
    if (line.trim() === "") continue;
    if (inMetadata && /^\s/.test(line)) {
      if (!METADATA_ENTRY.test(line)) {
        return {
          error: `a ${METADATA_KEY} entry is one "  key: value" line, indented by exactly two spaces: "${line}"`,
        };
      }
      continue;
    }
    inMetadata = false;
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
    if (keys.includes(key)) {
      return { error: `duplicated frontmatter key "${key}"` };
    }
    keys.push(key);
    if (key === METADATA_KEY) {
      if (line.slice(separatorIndex + 1).trim() !== "") {
        return {
          error: `${METADATA_KEY} must be a block mapping — "${METADATA_KEY}:" alone on its line, then "  key: value" lines; the Agent Skills reference validator rejects the inline form`,
        };
      }
      inMetadata = true;
    }
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = Bun.YAML.parse(blockLines.join("\n"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: `frontmatter is not valid YAML (${message}) — quote a value that contains ": " or starts with a YAML indicator`,
    };
  }
  const yamlRecord =
    typeof parsedYaml === "object" && parsedYaml !== null && !Array.isArray(parsedYaml)
      ? (parsedYaml as Record<string, unknown>)
      : parsedYaml === null && keys.length === 0
        ? {}
        : null;
  if (yamlRecord === null) {
    return { error: "frontmatter must be a YAML mapping of flat key: value fields" };
  }
  const frontmatter: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  for (const key of keys) {
    const value = yamlRecord[key];
    if (key === METADATA_KEY) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { error: `${METADATA_KEY} must be a mapping of key: value entries` };
      }
      for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
        if (
          typeof entryValue !== "string" &&
          typeof entryValue !== "number" &&
          typeof entryValue !== "boolean"
        ) {
          return { error: `${METADATA_KEY}.${entryKey} must be a scalar` };
        }
        metadata[entryKey] = String(entryValue).trim();
      }
      continue;
    }
    if (value === null || value === undefined) {
      frontmatter[key] = "";
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      frontmatter[key] = String(value).trim();
    } else {
      return {
        error: `frontmatter field "${key}" must be a scalar, found a ${Array.isArray(value) ? "list" : "mapping"}`,
      };
    }
  }
  const body = lines.slice(closingIndex + 1).join("\n");
  return { frontmatter, metadata, body };
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

export const REQUIRED_FRONTMATTER_FIELDS = ["name", "description", "license"] as const;
export const ALLOWED_STATUS = new Set(["candidate", "promoted"]);
/**
 * Top-level keys a SKILL.md may carry (ADR-0053): the Agent Skills fields,
 * which the reference validator admits and nothing else, plus
 * `disable-model-invocation`, which Claude Code needs to keep a skill
 * user-invoked and which the reference validator rejects — the one known
 * departure, written down in skills/README.md. Anything else, `status`
 * included, belongs under `metadata`.
 */
export const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
  "disable-model-invocation",
]);
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
export const MIN_WORKING_SIGNS = 2;

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

  const unknownKeys = Object.keys(parsed.frontmatter).filter(
    (key) => !ALLOWED_TOP_LEVEL_KEYS.has(key),
  );
  findings.push({
    rule: "frontmatter-keys",
    ok: unknownKeys.length === 0,
    note:
      unknownKeys.length === 0
        ? "every top-level key is an Agent Skills field or disable-model-invocation"
        : `top-level key(s) outside the Agent Skills fields: ${unknownKeys.join(", ")} — move them under "metadata:"${unknownKeys.includes("status") ? " (status lives in metadata.status since ADR-0053)" : ""}`,
  });

  const name = parsed.frontmatter.name;
  const nameOk = name === dirName;
  findings.push({
    rule: "frontmatter-name-matches-directory",
    ok: nameOk,
    note: nameOk
      ? `name matches directory "${dirName}"`
      : `frontmatter name "${name ?? ""}" does not match directory "${dirName}"`,
  });

  const status = parsed.metadata.status;
  const statusOk = status !== undefined && ALLOWED_STATUS.has(status);
  findings.push({
    rule: "frontmatter-status",
    ok: statusOk,
    note: statusOk
      ? `metadata.status "${status}"`
      : `metadata.status must be one of ${[...ALLOWED_STATUS].join("|")}, found "${status ?? ""}"`,
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
 *
 * `working_if` (ADR-0050 D3): the observable signs the owner checks on real
 * use before promoting a skill. Only its form is checked — a list of at least
 * MIN_WORKING_SIGNS distinct non-empty strings; whether a sign is observable
 * rather than an intention stays a review judgment, for the reason above. It
 * is optional on a `candidate` (adding one is a change of the skill, which
 * ADR-0050 D1 gates on an observed failure, so the lint cannot demand it of
 * skills admitted before D3) and required on a `promoted` skill, since the
 * promotion is pronounced on those signs.
 */
export function lintEvalFile(raw: unknown, status?: string): LintFinding[] {
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

  findings.push(lintWorkingIf(record.working_if, status));

  return findings;
}

function lintWorkingIf(workingIf: unknown, status: string | undefined): LintFinding {
  const rule = "eval-working-if";
  if (workingIf === undefined) {
    return status === "promoted"
      ? {
          rule,
          ok: false,
          note: `a promoted skill must carry "working_if": at least ${MIN_WORKING_SIGNS} observable signs (ADR-0050 D3)`,
        }
      : {
          rule,
          ok: true,
          note: `absent — optional while ${status ?? "not promoted"}, required before promotion (ADR-0050 D3)`,
        };
  }
  const signs = Array.isArray(workingIf) ? workingIf : null;
  const wellFormed =
    signs !== null &&
    signs.length >= MIN_WORKING_SIGNS &&
    signs.every((sign) => typeof sign === "string" && sign.trim().length > 0);
  if (!wellFormed) {
    return {
      rule,
      ok: false,
      note: `"working_if" must be an array of at least ${MIN_WORKING_SIGNS} non-empty strings`,
    };
  }
  const distinct = new Set((signs as string[]).map((sign) => sign.trim()));
  return distinct.size === signs.length
    ? { rule, ok: true, note: `${signs.length} working sign(s)` }
    : {
        rule,
        ok: false,
        note: `"working_if" repeats a sign: ${signs.length - distinct.size} duplicate(s)`,
      };
}
