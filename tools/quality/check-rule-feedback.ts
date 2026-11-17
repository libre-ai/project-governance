/**
 * Validator of a rule feedback ticket: the issue body the "Rule feedback" form
 * renders, filled and closed.
 *
 *   bun tools/quality/check-rule-feedback.ts check <ticket file>
 *   bun tools/quality/check-rule-feedback.ts --fields
 *
 * Why: a reader of a served rule reports a divergent reading through a ticket
 * that carries identifiers only (rule, excerpt digest, pack, snapshot,
 * overlays, core version) plus a nature and a one-line proposal. The command
 * that prints the ticket runs this validator before anything is sent, so a
 * ticket that pastes a rule text, a project description or a stray line never
 * leaves the machine. The validator is the only reader of the ticket shape.
 *
 * Shape (the body GitHub renders for an issue form, docs/specifications/
 * WORK-PACKAGES.md "Issue body"): eight sections, in the order of
 * `RULE_FEEDBACK_FIELDS`, each written `### <label>`, an empty line, the value
 * on one line, and an empty line between sections. CRLF line ends and one
 * final line end are admitted. Anything else is refused: text before, between
 * or after the sections, an unknown, repeated, missing or misplaced section, a
 * comment, a value on two lines, a space at the start or end of a line, and
 * any character `findUnreadableCharacter` refuses. The body is never read
 * heuristically.
 *
 * Forms. The common forms (rule identifier, excerpt digest, slug, edition,
 * overlay reference, level, trigger type) are NOT written here: they are read
 * at run time from `contracts/schemas/rule-common.v1.schema.json` of the
 * pinned checkout of the contracts authority (`CHECKOUT_DIR`, fetched by
 * `bun run fetch:contracts-authority`), rule R1 of
 * `contracts/rule-common-v1/SEMANTICS.md`. A missing or stale checkout, an
 * unreadable schema, an absent pointer or a leaf outside the shape R2 allows is
 * a named failure, never an empty or permissive form. Patterns are matched on
 * the whole value (R2: ECMA-262 `test`, anchored, no `m` flag) and lengths are
 * counted in code points. The forms that belong to the ticket alone (rule R6:
 * snapshot version, core version, the three natures, the proposal line, the
 * overlay list and its `none`) are defined below.
 *
 * Output: one counts line, then `pass` or `refused: <reason>`. A reason names
 * a field label or a line number, never a value read from the ticket: the
 * ticket is untrusted input and the output lands in logs.
 *
 * Exit status: 0 when the ticket is valid, and for `--fields`; 1 when the
 * ticket is refused, or the ticket file, the pin, the checkout or the schema
 * cannot be read; 2 on a usage error.
 */

import { readFile } from "node:fs/promises";

import {
  CHECKOUT_DIR,
  checkoutState,
  FETCH_COMMAND,
  readPin,
} from "../../crates/ecosystem-engine/scripts/contracts-authority";
import { findUnreadableCharacter } from "./yaml-text-guard";

/**
 * The eight section labels, in order: the single source of the list. The
 * labels are those of the issue form (owner decision of 2026-11-17: the
 * form's labels prevail over the validator brief's).
 */
export const RULE_FEEDBACK_FIELDS: readonly string[] = [
  "Rule identifier",
  "Excerpt digest",
  "Pack",
  "Snapshot",
  "Overlays",
  "Core version",
  "Nature",
  "Proposal",
];

const SCHEMA_PATH = `${CHECKOUT_DIR}/contracts/schemas/rule-common.v1.schema.json`;

const USAGE = "usage: bun tools/quality/check-rule-feedback.ts check <ticket file> | --fields";

// ---------------------------------------------------------------------------
// Forms of the ticket alone (SEMANTICS.md R6)
// ---------------------------------------------------------------------------

/** The closed value that stands for "nothing" in `Overlays` and `Proposal`. */
const NONE = "none";

const NATURES: readonly string[] = ["rephrasing", "trigger", "level"];

/** Snapshot version: a decimal integer from 1, at most 16 digits. */
const SNAPSHOT_VERSION: RegExp = /^[1-9][0-9]{0,15}$/;

/**
 * Core version: `MAJOR.MINOR.PATCH`, each component without a leading zero,
 * then an optional SemVer 2.0 pre-release (`-` and dot-separated identifiers,
 * a numeric identifier without a leading zero). No build metadata.
 */
const CORE_VERSION: RegExp =
  /^(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})(?:-(?:0|[1-9][0-9]{0,8}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]{0,8}|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?$/;
const CORE_VERSION_MAX_LENGTH = 64;

/** A rephrasing proposal is one line of 1 to this many code points. */
const PROPOSAL_MAX_LENGTH = 1000;

/** Separator of the overlay references, in stack order. */
const OVERLAY_SEPARATOR = ",";

const HEADING_PREFIX = "### ";
const COMMENT_OPENING = "<!--";
/** What GitHub renders for an empty answer; every field is required, so it is never a value. */
const NO_RESPONSE = "_No response_";

// ---------------------------------------------------------------------------
// Common forms, read from the pinned contract (SEMANTICS.md R1, R2, R3)
// ---------------------------------------------------------------------------

interface StringForm {
  readonly pattern: RegExp;
  readonly minLength: number | null;
  readonly maxLength: number | null;
}

/** The common forms, already read: the pure validator reads no file. */
interface RuleFeedbackShapes {
  readonly ruleId: StringForm;
  readonly excerptDigest: StringForm;
  readonly slug: StringForm;
  readonly edition: StringForm;
  readonly overlayReference: StringForm;
  readonly level: readonly string[];
  readonly triggerType: readonly string[];
}

type StringFormName = "ruleId" | "excerptDigest" | "slug" | "edition" | "overlayReference";
type ListFormName = "level" | "triggerType";

const STRING_FORMS: readonly StringFormName[] = [
  "ruleId",
  "excerptDigest",
  "slug",
  "edition",
  "overlayReference",
];
const LIST_FORMS: readonly ListFormName[] = ["level", "triggerType"];

const STRING_LEAF_KEYS: ReadonlySet<string> = new Set([
  "type",
  "pattern",
  "minLength",
  "maxLength",
]);

type Loaded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLength = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

function readStringLeaf(name: string, leaf: unknown): Loaded<StringForm> {
  const pointer = `#/$defs/${name}`;
  if (!isRecord(leaf)) return { ok: false, reason: `${pointer} is not an object` };
  for (const key of Object.keys(leaf)) {
    if (!STRING_LEAF_KEYS.has(key)) {
      return { ok: false, reason: `${pointer} carries the keyword "${key}", outside rule R2` };
    }
  }
  if (leaf.type !== "string") return { ok: false, reason: `${pointer} is not a string form` };
  const source: unknown = leaf.pattern;
  if (typeof source !== "string") return { ok: false, reason: `${pointer} has no pattern` };
  // R3: anchored at both ends, so `test` decides the whole value.
  if (!source.startsWith("^") || !source.endsWith("$") || source.endsWith("\\$")) {
    return { ok: false, reason: `${pointer} has a pattern that is not anchored (rule R3)` };
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(source, "u");
  } catch {
    return { ok: false, reason: `${pointer} has a pattern that does not compile with the u flag` };
  }
  const minLength: unknown = leaf.minLength ?? null;
  const maxLength: unknown = leaf.maxLength ?? null;
  if (
    (minLength !== null && !isLength(minLength)) ||
    (maxLength !== null && !isLength(maxLength))
  ) {
    return { ok: false, reason: `${pointer} has a length bound that is not a natural integer` };
  }
  return { ok: true, value: { pattern, minLength, maxLength } };
}

function readListLeaf(name: string, leaf: unknown): Loaded<readonly string[]> {
  const pointer = `#/$defs/${name}`;
  if (!isRecord(leaf)) return { ok: false, reason: `${pointer} is not an object` };
  const keys: readonly string[] = Object.keys(leaf);
  if (keys.length !== 1 || keys[0] !== "enum") {
    return { ok: false, reason: `${pointer} is not a closed list holding "enum" alone (rule R2)` };
  }
  const values: unknown = leaf.enum;
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    !values.every((value: unknown): boolean => typeof value === "string" && value.length > 0)
  ) {
    return { ok: false, reason: `${pointer} is not a non-empty list of strings` };
  }
  return { ok: true, value: values as readonly string[] };
}

/** Read the common forms from the text of `rule-common.v1.schema.json`. */
function readShapes(schemaText: string): Loaded<RuleFeedbackShapes> {
  let schema: unknown;
  try {
    schema = JSON.parse(schemaText);
  } catch {
    return { ok: false, reason: "the schema is not valid JSON" };
  }
  if (!isRecord(schema) || !isRecord(schema.$defs)) {
    return { ok: false, reason: "the schema has no $defs object" };
  }
  const defs: Record<string, unknown> = schema.$defs;
  const strings = new Map<StringFormName, StringForm>();
  for (const name of STRING_FORMS) {
    if (!Object.hasOwn(defs, name)) return { ok: false, reason: `#/$defs/${name} is absent` };
    const leaf: Loaded<StringForm> = readStringLeaf(name, defs[name]);
    if (!leaf.ok) return leaf;
    strings.set(name, leaf.value);
  }
  const lists = new Map<ListFormName, readonly string[]>();
  for (const name of LIST_FORMS) {
    if (!Object.hasOwn(defs, name)) return { ok: false, reason: `#/$defs/${name} is absent` };
    const leaf: Loaded<readonly string[]> = readListLeaf(name, defs[name]);
    if (!leaf.ok) return leaf;
    lists.set(name, leaf.value);
  }
  return {
    ok: true,
    value: {
      ruleId: strings.get("ruleId") as StringForm,
      excerptDigest: strings.get("excerptDigest") as StringForm,
      slug: strings.get("slug") as StringForm,
      edition: strings.get("edition") as StringForm,
      overlayReference: strings.get("overlayReference") as StringForm,
      level: lists.get("level") as readonly string[],
      triggerType: lists.get("triggerType") as readonly string[],
    },
  };
}

const codePoints = (text: string): number => [...text].length;

function matchesForm(form: StringForm, value: string): boolean {
  const length: number = codePoints(value);
  if (form.minLength !== null && length < form.minLength) return false;
  if (form.maxLength !== null && length > form.maxLength) return false;
  return form.pattern.test(value);
}

// ---------------------------------------------------------------------------
// The pure validator
// ---------------------------------------------------------------------------

interface RuleFeedbackCounts {
  /** Lines of the ticket, after CRLF normalisation and one final line end removed. */
  readonly lines: number;
  /** Section headings read whose label is one of the eight. */
  readonly sections: number;
  /** valid + invalid + unread = the eight fields. */
  readonly valid: number;
  readonly invalid: number;
  readonly unread: number;
}

interface Section {
  readonly label: string;
  readonly headingLine: number;
  readonly value: string;
}

interface Verdict {
  readonly counts: RuleFeedbackCounts;
  readonly refusal: string | null;
}

const fieldReason = (label: string, why: string): string => `field "${label}": ${why}`;

/** Lines with CRLF normalised and at most one final line end removed. */
function ticketLines(text: string): readonly string[] {
  const normalised: string = text.replaceAll("\r\n", "\n");
  const trimmed: string = normalised.endsWith("\n") ? normalised.slice(0, -1) : normalised;
  return trimmed.split("\n");
}

/** Every line read on its own, before the structure: comment and edge spaces. */
function lineProblem(lines: readonly string[]): string | null {
  for (const [index, line] of lines.entries()) {
    if (line.includes(COMMENT_OPENING)) return `line ${index + 1}: a comment is not allowed`;
    if (line === NO_RESPONSE) return `line ${index + 1}: an empty answer is not allowed`;
    if (line.startsWith(" ") || line.endsWith(" ")) {
      return `line ${index + 1}: a space at the start or end of a line is not allowed`;
    }
  }
  return null;
}

/** The sections, in the order read, or the first line that departs from the shape. */
function readSections(lines: readonly string[]): {
  readonly sections: readonly Section[];
  readonly problem: string | null;
} {
  const sections: Section[] = [];
  let index = 0;
  for (;;) {
    const heading: string = lines[index] as string;
    if (!heading.startsWith(HEADING_PREFIX)) {
      return { sections, problem: `line ${index + 1}: out of form, expected a section heading` };
    }
    const separator: string | undefined = lines[index + 1];
    if (separator !== "") {
      const why = separator === undefined ? "the ticket ends" : "out of form";
      return { sections, problem: `line ${index + 2}: ${why}, expected an empty line` };
    }
    const value: string | undefined = lines[index + 2];
    if (value === undefined || value === "" || value.startsWith(HEADING_PREFIX)) {
      const why = value === undefined ? "the ticket ends" : "out of form";
      return { sections, problem: `line ${index + 3}: ${why}, expected a value` };
    }
    sections.push({ label: heading.slice(HEADING_PREFIX.length), headingLine: index + 1, value });
    const next: string | undefined = lines[index + 3];
    if (next === undefined) return { sections, problem: null };
    if (next !== "") {
      return { sections, problem: `line ${index + 4}: out of form, a value holds one line` };
    }
    if (lines[index + 4] === undefined) {
      return {
        sections,
        problem: `line ${index + 4}: out of form, nothing may follow the last value`,
      };
    }
    index += 4;
  }
}

/** Unknown, repeated, missing, then misplaced sections, in that order. */
function labelProblem(sections: readonly Section[]): string | null {
  const seen = new Set<string>();
  for (const section of sections) {
    if (!RULE_FEEDBACK_FIELDS.includes(section.label)) {
      return `line ${section.headingLine}: unknown field`;
    }
    if (seen.has(section.label)) {
      return `field "${section.label}" repeated at line ${section.headingLine}`;
    }
    seen.add(section.label);
  }
  for (const label of RULE_FEEDBACK_FIELDS) {
    if (!seen.has(label)) return `field "${label}" missing`;
  }
  for (const [position, section] of sections.entries()) {
    if (section.label !== RULE_FEEDBACK_FIELDS[position]) {
      return `field "${section.label}" out of order at line ${section.headingLine}`;
    }
  }
  return null;
}

/** `<slug>@<tail>`, split at the first `@`; a second `@` is left to the form of the tail. */
function splitAt(value: string): { readonly head: string; readonly tail: string } | null {
  const at: number = value.indexOf("@");
  if (at === -1) return null;
  return { head: value.slice(0, at), tail: value.slice(at + 1) };
}

function overlaysHold(value: string, shapes: RuleFeedbackShapes): boolean {
  if (value === NONE) return true;
  const references: readonly string[] = value.split(OVERLAY_SEPARATOR);
  if (new Set(references).size !== references.length) return false;
  return references.every((reference: string): boolean =>
    matchesForm(shapes.overlayReference, reference),
  );
}

function coreVersionHolds(value: string): boolean {
  return codePoints(value) <= CORE_VERSION_MAX_LENGTH && CORE_VERSION.test(value);
}

/** The reason a proposal does not fit its nature, or null when it does. */
function proposalProblem(
  nature: string,
  proposal: string,
  shapes: RuleFeedbackShapes,
): string | null {
  const label = "Proposal";
  if (proposal === NONE) return null;
  if (nature === "level") {
    return shapes.level.includes(proposal)
      ? null
      : fieldReason(label, "incompatible with the nature level, not a known level");
  }
  if (nature === "trigger") {
    const equals: number = proposal.indexOf("=");
    if (equals === -1) {
      return fieldReason(label, "incompatible with the nature trigger, expected type=value");
    }
    if (!shapes.triggerType.includes(proposal.slice(0, equals))) {
      return fieldReason(label, "incompatible with the nature trigger, unknown trigger type");
    }
    if (equals === proposal.length - 1) {
      return fieldReason(label, "incompatible with the nature trigger, empty trigger value");
    }
    return null;
  }
  return codePoints(proposal) > PROPOSAL_MAX_LENGTH
    ? fieldReason(label, `longer than ${PROPOSAL_MAX_LENGTH} characters`)
    : null;
}

/** Each field judged on its own value; `Proposal` is judged against `Nature`. */
function fieldVerdicts(
  values: ReadonlyMap<string, string>,
  shapes: RuleFeedbackShapes,
): readonly (string | null | "unread")[] {
  const value = (label: string): string => values.get(label) as string;
  const out = (label: string, holds: boolean): string | null =>
    holds ? null : fieldReason(label, "value out of form");

  const pack = splitAt(value("Pack"));
  const snapshot = splitAt(value("Snapshot"));
  const nature: string = value("Nature");
  const natureHolds: boolean = NATURES.includes(nature);
  return [
    out("Rule identifier", matchesForm(shapes.ruleId, value("Rule identifier"))),
    out("Excerpt digest", matchesForm(shapes.excerptDigest, value("Excerpt digest"))),
    out(
      "Pack",
      pack !== null &&
        matchesForm(shapes.slug, pack.head) &&
        matchesForm(shapes.edition, pack.tail),
    ),
    out(
      "Snapshot",
      snapshot !== null &&
        matchesForm(shapes.slug, snapshot.head) &&
        SNAPSHOT_VERSION.test(snapshot.tail),
    ),
    out("Overlays", overlaysHold(value("Overlays"), shapes)),
    out("Core version", coreVersionHolds(value("Core version"))),
    natureHolds ? null : fieldReason("Nature", "not one of the three natures"),
    natureHolds ? proposalProblem(nature, value("Proposal"), shapes) : "unread",
  ];
}

const unreadCounts = (lines: number, sections: number): RuleFeedbackCounts => ({
  lines,
  sections,
  valid: 0,
  invalid: 0,
  unread: RULE_FEEDBACK_FIELDS.length,
});

/** Decide whether `text` is a valid ticket. Pure: no file is read. */
function validateRuleFeedback(text: string, shapes: RuleFeedbackShapes): Verdict {
  const lines: readonly string[] = ticketLines(text);
  const unreadable = findUnreadableCharacter(text);
  if (unreadable !== null) {
    return {
      counts: unreadCounts(lines.length, 0),
      refusal: `line ${unreadable.line}: unreadable character ${unreadable.codePoint}`,
    };
  }
  const perLine: string | null = lineProblem(lines);
  if (perLine !== null) return { counts: unreadCounts(lines.length, 0), refusal: perLine };

  const { sections, problem } = readSections(lines);
  const recognised: number = sections.filter((section: Section): boolean =>
    RULE_FEEDBACK_FIELDS.includes(section.label),
  ).length;
  const structural: string | null = problem ?? labelProblem(sections);
  if (structural !== null) {
    return { counts: unreadCounts(lines.length, recognised), refusal: structural };
  }

  const values = new Map<string, string>(
    sections.map((section: Section): [string, string] => [section.label, section.value]),
  );
  const verdicts = fieldVerdicts(values, shapes);
  const reasons: readonly string[] = verdicts.filter(
    (verdict): verdict is string => verdict !== null && verdict !== "unread",
  );
  const unread: number = verdicts.filter((verdict): boolean => verdict === "unread").length;
  return {
    counts: {
      lines: lines.length,
      sections: recognised,
      valid: verdicts.length - reasons.length - unread,
      invalid: reasons.length,
      unread,
    },
    refusal: reasons[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

function countsLine(counts: RuleFeedbackCounts): string {
  return (
    `rule feedback ticket: lines=${counts.lines} sections=${counts.sections} ` +
    `fields valid=${counts.valid} invalid=${counts.invalid} unread=${counts.unread} ` +
    `of ${RULE_FEEDBACK_FIELDS.length}`
  );
}

/** The common forms of the pinned checkout, or the named reason they cannot be read. */
async function loadShapes(): Promise<Loaded<RuleFeedbackShapes>> {
  let state: Awaited<ReturnType<typeof checkoutState>>;
  try {
    state = await checkoutState(await readPin());
  } catch (error) {
    return { ok: false, reason: `contracts authority pin unreadable: ${(error as Error).message}` };
  }
  if (state !== "current") {
    return {
      ok: false,
      reason: `contracts authority checkout ${CHECKOUT_DIR} is ${state}, run ${FETCH_COMMAND}`,
    };
  }
  let schemaText: string;
  try {
    schemaText = await readFile(SCHEMA_PATH, "utf8");
  } catch {
    return { ok: false, reason: `common forms unreadable: cannot read ${SCHEMA_PATH}` };
  }
  const shapes: Loaded<RuleFeedbackShapes> = readShapes(schemaText);
  return shapes.ok
    ? shapes
    : { ok: false, reason: `common forms unreadable: ${SCHEMA_PATH}: ${shapes.reason}` };
}

/** Run the command on `argv`; returns the exit status. */
export async function runRuleFeedbackCheck(
  argv: readonly string[],
  say: (line: string) => void,
): Promise<number> {
  if (argv.length === 1 && argv[0] === "--fields") {
    for (const label of RULE_FEEDBACK_FIELDS) say(label);
    return 0;
  }
  const ticketPath: string | undefined = argv[1];
  if (argv.length !== 2 || argv[0] !== "check" || ticketPath === undefined) {
    say(USAGE);
    return 2;
  }

  const shapes: Loaded<RuleFeedbackShapes> = await loadShapes();
  if (!shapes.ok) {
    say(countsLine(unreadCounts(0, 0)));
    say(`refused: ${shapes.reason}`);
    return 1;
  }
  let bytes: Uint8Array;
  try {
    bytes = await readFile(ticketPath);
  } catch {
    say(countsLine(unreadCounts(0, 0)));
    say("refused: cannot read the ticket file");
    return 1;
  }
  let text: string;
  try {
    // fatal: an invalid byte is a refusal, not a silent U+FFFD; ignoreBOM: a
    // byte order mark stays in the text, where the character guard refuses it.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    say(countsLine(unreadCounts(0, 0)));
    say("refused: the ticket file is not valid UTF-8");
    return 1;
  }
  const verdict: Verdict = validateRuleFeedback(text, shapes.value);
  say(countsLine(verdict.counts));
  if (verdict.refusal !== null) {
    say(`refused: ${verdict.refusal}`);
    return 1;
  }
  say("pass");
  return 0;
}

if (import.meta.main) {
  process.exit(await runRuleFeedbackCheck(process.argv.slice(2), (line) => console.log(line)));
}
