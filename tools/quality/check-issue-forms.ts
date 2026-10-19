/**
 * Issue-form validator for the organisation's `ISSUE_TEMPLATE` forms.
 *
 *   bun tools/quality/check-issue-forms.ts --forms <ISSUE_TEMPLATE dir> --labels <labels.yml>
 *
 * Why: the four forms (work package, decision request, idea, question) are the
 * only way the web creates the issues the work-package gate and the owner's
 * decision queue read. A form that drifts (a required field made optional, a
 * label the vocabulary does not know, a field id used twice) produces issue
 * bodies the gate refuses or, worse, silently misreads. The work-package form
 * must render EXACTLY the two headings the norm prescribes
 * (docs/specifications/WORK-PACKAGES.md, "Issue body"): `### PRD-ref` then
 * `### WP`, which GitHub derives from the `label` of each field.
 *
 * How a form's kind is identified: by its `kind:*` label, never by its file
 * name. The label is what the gates and the labels vocabulary share, and a
 * renamed file must not change which rules apply. A form with no `kind:*`
 * label, two of them, or an unknown one cannot be classified and is refused.
 *
 * The validator fails closed (gate-integrity §2): every unreadable or
 * ambiguous input is a named violation, never an empty list. YAML itself is
 * ambiguous in ways the parser resolves silently (a repeated key keeps the
 * last value; an alias, a merge key or a flow mapping hides a repeat), so the
 * text is first scanned line by line and those shapes are refused. The scan
 * understands block mappings only; that is why a flow mapping is refused
 * rather than parsed.
 *
 * The script prints the volume it examined, and exits non-zero on a
 * violation, an unreadable directory or labels file, and a directory with no
 * form in it: an empty directory is not a success. `config.yml` (the
 * ISSUE_TEMPLATE contact-links file) and any non-YAML entry are not forms;
 * they are counted apart so that entries = forms + ignored.
 *
 * Exit status: 0 when every form is valid; 1 on any violation or unreadable
 * source; 2 on a usage error.
 */

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { LabelSpec } from "../fleet/sync-labels";
import { parseLabelsFile } from "../fleet/sync-labels";

// --- field model ------------------------------------------------------------

type FieldType = "input" | "textarea" | "dropdown" | "checkboxes";

interface Field {
  readonly label: string;
  readonly type: FieldType;
  readonly required: boolean;
}

const ROOT_KEYS: readonly string[] = ["name", "description", "title", "labels", "body"];
const ELEMENT_KEYS: readonly string[] = ["type", "id", "attributes", "validations"];
const FIELD_TYPES: readonly string[] = ["input", "textarea", "dropdown", "checkboxes"];
const ELEMENT_TYPES: readonly string[] = ["markdown", ...FIELD_TYPES];

/** GitHub accepts only these characters in an element id. */
const ELEMENT_ID = /^[A-Za-z0-9_-]+$/;
const KIND_PREFIX = "kind:";
const OPTION_PREFIX = "Option ";
const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

interface FieldSpec {
  readonly label: string;
  readonly type: FieldType;
  /** `true`: the field must be present and required. `false`: it may be absent, but never required. */
  readonly required: boolean;
}

/**
 * What each kind of form must contain, besides markdown elements. The
 * decision-request options are checked apart (their number is bounded, not
 * fixed).
 */
const SPECS: Readonly<Record<string, readonly FieldSpec[]>> = {
  "kind:work-package": [
    { label: "PRD-ref", type: "input", required: true },
    { label: "WP", type: "input", required: true },
  ],
  "kind:decision-request": [
    { label: "Context", type: "textarea", required: true },
    { label: "Recommendation", type: "textarea", required: false },
  ],
  "kind:idea": [
    { label: "Statement", type: "textarea", required: true },
    { label: "Why deferred", type: "textarea", required: true },
  ],
  "kind:question": [
    { label: "Statement", type: "textarea", required: true },
    { label: "Document carrying the missing fact", type: "input", required: true },
  ],
};

const DECISION_REQUEST = "kind:decision-request";

// --- YAML ambiguity scan ----------------------------------------------------

const KEY_LINE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#:'"][^:#]*?)[ \t]*:(?:[ \t]+(.*))?$/;
const BLOCK_SCALAR = /^[|>][+-]?\d?[ \t]*(?:#.*)?$/;

interface Scope {
  readonly indent: number;
  readonly keys: Set<string>;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** True when `line` closes a quoted scalar opened on an earlier line. */
function closesQuote(line: string, quote: string): boolean {
  const text = line.trimEnd();
  if (!text.endsWith(quote)) return false;
  if (quote === "'") return true;
  let backslashes = 0;
  for (let index = text.length - 2; index >= 0 && text[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 0;
}

/** Reasons the text is ambiguous, each naming its line. Empty when nothing is. */
function findAmbiguity(text: string): string[] {
  const reasons: string[] = [];
  const scopes: Scope[] = [];
  let blockIndent: number | null = null;
  let openQuote: string | null = null;

  const inspectValue = (value: string, lineNumber: number): void => {
    if (value.startsWith("&") || value.startsWith("*")) {
      reasons.push(`line ${lineNumber}: an anchor or an alias hides a repeated key`);
    } else if (value.startsWith("{")) {
      reasons.push(`line ${lineNumber}: a flow mapping hides a repeated key; use a block mapping`);
    } else if (value.startsWith("[") && value.includes("{")) {
      reasons.push(
        `line ${lineNumber}: a flow mapping inside a flow sequence hides a repeated key`,
      );
    } else if (value.startsWith("!")) {
      reasons.push(`line ${lineNumber}: a YAML tag changes the type of a value silently`);
    }
  };

  for (const [index, raw] of text.split(/\r\n?|\n/).entries()) {
    const lineNumber = index + 1;
    if (blockIndent !== null) {
      if (raw.trim() === "" || indentOf(raw) > blockIndent) continue;
      blockIndent = null;
    }
    if (openQuote !== null) {
      if (closesQuote(raw, openQuote)) openQuote = null;
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const indent = indentOf(raw);
    let rest = raw.slice(indent);
    let keyIndent = indent;
    let isItem = false;
    for (
      let dash = /^-(?:[ \t]+|$)/.exec(rest);
      dash !== null;
      dash = /^-(?:[ \t]+|$)/.exec(rest)
    ) {
      isItem = true;
      keyIndent += dash[0].length;
      rest = rest.slice(dash[0].length);
    }

    // After the dashes are stripped, `{type: a, type: b}` would match KEY_LINE with the key
    // "{type" and hide its repeat from inspectValue; a flow collection is refused before that.
    if (rest.startsWith("{") || rest.startsWith("[")) {
      reasons.push(
        `line ${lineNumber}: a flow collection as a list item hides a repeated key; use a block mapping`,
      );
      continue;
    }

    const keyMatch = KEY_LINE.exec(rest.trimEnd());
    if (keyMatch === null) {
      inspectValue(rest.trim(), lineNumber);
      if (BLOCK_SCALAR.test(rest.trim())) blockIndent = indent;
      continue;
    }

    while (scopes.length > 0) {
      const top = scopes[scopes.length - 1] as Scope;
      if (isItem ? top.indent >= keyIndent : top.indent > keyIndent) scopes.pop();
      else break;
    }
    let scope: Scope | null = scopes[scopes.length - 1] ?? null;
    if (scope === null || scope.indent !== keyIndent) {
      scope = { indent: keyIndent, keys: new Set() };
      scopes.push(scope);
    }

    const key = (keyMatch[1] as string).replace(/^(["'])(.*)\1$/, "$2");
    if (key === "<<") reasons.push(`line ${lineNumber}: a merge key hides a repeated key`);
    if (scope.keys.has(key)) reasons.push(`line ${lineNumber}: key "${key}" is repeated`);
    scope.keys.add(key);

    const value = (keyMatch[2] ?? "").trim();
    inspectValue(value, lineNumber);
    if (BLOCK_SCALAR.test(value)) blockIndent = keyIndent;
    const quote = value[0];
    if (
      (quote === '"' || quote === "'") &&
      !(value.length > 1 && closesQuote(value.slice(1), quote))
    ) {
      openQuote = quote;
    }
  }
  return reasons;
}

// --- structure --------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

interface ElementReading {
  readonly field: Field | null;
  readonly violations: readonly string[];
  readonly id: string | null;
}

function readElement(element: unknown, position: number): ElementReading {
  const where = `body[${position}]`;
  if (!isRecord(element)) {
    return { field: null, id: null, violations: [`${where} must be a mapping`] };
  }
  const violations: string[] = [];
  for (const key of Object.keys(element)) {
    if (!ELEMENT_KEYS.includes(key)) violations.push(`${where} has an unknown key "${key}"`);
  }

  const type = element.type;
  if (typeof type !== "string" || !ELEMENT_TYPES.includes(type)) {
    violations.push(
      `${where} has an unknown type ${JSON.stringify(type)} (expected one of ${ELEMENT_TYPES.join(", ")})`,
    );
    return { field: null, id: null, violations };
  }

  let id: string | null = null;
  if ("id" in element) {
    if (typeof element.id !== "string" || !ELEMENT_ID.test(element.id)) {
      violations.push(
        `${where} id must be letters, digits, "-" or "_": ${JSON.stringify(element.id)}`,
      );
    } else {
      id = element.id;
    }
  }

  const attributes = element.attributes;
  if (!isRecord(attributes)) {
    violations.push(`${where} (${type}) has no attributes mapping`);
  } else if (type === "markdown") {
    if (!isFilledString(attributes.value)) {
      violations.push(`${where} (markdown) needs a non-empty attributes.value`);
    }
  } else if (!isFilledString(attributes.label)) {
    violations.push(`${where} (${type}) needs a non-empty attributes.label`);
  }

  let required = false;
  if ("validations" in element) {
    const validations = element.validations;
    if (!isRecord(validations)) {
      violations.push(`${where} validations must be a mapping`);
    } else {
      for (const key of Object.keys(validations)) {
        if (key !== "required") violations.push(`${where} validations has an unknown key "${key}"`);
      }
      if ("required" in validations) {
        if (typeof validations.required === "boolean") required = validations.required;
        else violations.push(`${where} validations.required must be a boolean`);
      }
    }
  }

  if (type === "markdown" || !isRecord(attributes) || !isFilledString(attributes.label)) {
    return { field: null, id, violations };
  }
  return { field: { label: attributes.label, type: type as FieldType, required }, id, violations };
}

function checkLabels(labels: unknown, knownLabels: ReadonlySet<string>): readonly string[] {
  if (!Array.isArray(labels) || labels.length === 0) {
    return ["labels must be a non-empty list of strings"];
  }
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const label of labels) {
    if (!isFilledString(label)) {
      violations.push(`labels must be a list of strings, found ${JSON.stringify(label)}`);
      continue;
    }
    if (seen.has(label)) violations.push(`label "${label}" is listed twice`);
    seen.add(label);
    if (!knownLabels.has(label)) {
      violations.push(`label "${label}" is not in the organisation vocabulary (labels.yml)`);
    }
  }
  return violations;
}

/** Identifies the form by its `kind:*` label; the violations say why it cannot be. */
function readKind(labels: unknown): {
  readonly kind: string | null;
  readonly violations: string[];
} {
  if (!Array.isArray(labels)) return { kind: null, violations: [] };
  const kinds = (labels as readonly unknown[]).filter(
    (label: unknown): label is string => typeof label === "string" && label.startsWith(KIND_PREFIX),
  );
  if (kinds.length === 0) {
    return {
      kind: null,
      violations: [`no "${KIND_PREFIX}*" label: the form kind cannot be identified`],
    };
  }
  if (kinds.length > 1) {
    return {
      kind: null,
      violations: [
        `several "${KIND_PREFIX}*" labels (${kinds.join(", ")}): the form kind is ambiguous`,
      ],
    };
  }
  const kind = kinds[0] as string;
  if (!(kind in SPECS)) {
    return { kind: null, violations: [`unknown form kind "${kind}"`] };
  }
  return { kind, violations: [] };
}

function checkSpecs(kind: string, fields: readonly Field[]): string[] {
  const violations: string[] = [];
  const specs = SPECS[kind] as readonly FieldSpec[];
  const expected = new Set<string>(specs.map((spec: FieldSpec): string => spec.label));

  for (const spec of specs) {
    const field = fields.find((candidate: Field): boolean => candidate.label === spec.label);
    if (!field) {
      if (spec.required) violations.push(`${kind}: missing field "${spec.label}"`);
      continue;
    }
    if (field.type !== spec.type) {
      violations.push(`${kind}: field "${spec.label}" must be a ${spec.type}, found ${field.type}`);
    }
    if (spec.required && !field.required) {
      violations.push(`${kind}: field "${spec.label}" must be required`);
    }
    if (!spec.required && field.required) {
      violations.push(
        `${kind}: field "${spec.label}" must stay optional: it exists only when there is something to say`,
      );
    }
  }

  const options: readonly Field[] =
    kind === DECISION_REQUEST
      ? fields.filter(
          (field: Field): boolean =>
            field.type === "textarea" && field.label.startsWith(OPTION_PREFIX),
        )
      : [];
  if (kind === DECISION_REQUEST) {
    if (options.length < 2 || options.length > OPTION_LETTERS.length) {
      violations.push(`${kind}: needs 2 to 4 options, found ${options.length}`);
    }
    for (const [position, option] of options.entries()) {
      const letter = OPTION_LETTERS[position];
      if (letter === undefined) continue;
      if (option.label !== `${OPTION_PREFIX}${letter}`) {
        violations.push(
          `${kind}: option ${position + 1} must be labelled "${OPTION_PREFIX}${letter}", found "${option.label}"`,
        );
      }
      if (position < 2 && !option.required) {
        violations.push(`${kind}: field "${option.label}" must be required`);
      }
      if (position >= 2 && option.required) {
        violations.push(`${kind}: field "${option.label}" must stay optional`);
      }
    }
  }

  for (const field of fields) {
    if (expected.has(field.label) || options.includes(field)) continue;
    violations.push(`${kind}: unexpected field "${field.label}"`);
  }
  return violations;
}

/**
 * Violations of one issue form, `[]` when it is valid. Pure: no I/O, so a
 * caller that cannot read a form reports that itself.
 */
export function validateIssueForm(
  yamlText: string,
  knownLabels: ReadonlySet<string>,
): readonly string[] {
  const ambiguity = findAmbiguity(yamlText);
  if (ambiguity.length > 0) return ambiguity.map((reason) => `ambiguous YAML, ${reason}`);

  let document: unknown;
  try {
    document = Bun.YAML.parse(yamlText);
  } catch (error) {
    return [`not valid YAML: ${(error as Error).message}`];
  }
  if (!isRecord(document)) return ["the form root must be a mapping"];

  const violations: string[] = [];
  for (const key of Object.keys(document)) {
    if (!ROOT_KEYS.includes(key)) violations.push(`unknown root key "${key}"`);
  }
  if (!isFilledString(document.name)) violations.push("name must be a non-empty string");
  if (!isFilledString(document.description))
    violations.push("description must be a non-empty string");
  if ("title" in document && typeof document.title !== "string") {
    violations.push("title must be a string");
  }

  if ("labels" in document) {
    violations.push(...checkLabels(document.labels, knownLabels));
  } else {
    violations.push("labels is missing: the form kind cannot be identified");
  }
  const { kind, violations: kindViolations } = readKind(document.labels);
  if ("labels" in document) violations.push(...kindViolations);

  const body = document.body;
  if (!Array.isArray(body) || body.length === 0) {
    violations.push("body must be a non-empty list of elements");
    return violations;
  }

  const fields: Field[] = [];
  const ids = new Set<string>();
  const labelKeys = new Set<string>();
  for (const [position, element] of body.entries()) {
    const reading = readElement(element, position);
    violations.push(...reading.violations);
    if (reading.id !== null) {
      if (ids.has(reading.id)) violations.push(`id "${reading.id}" is used twice`);
      ids.add(reading.id);
    }
    if (reading.field !== null) {
      const labelKey = reading.field.label.trim().toLowerCase();
      if (labelKeys.has(labelKey)) {
        violations.push(`label "${reading.field.label}" is used by two fields`);
      }
      labelKeys.add(labelKey);
      fields.push(reading.field);
    }
  }

  if (kind !== null) violations.push(...checkSpecs(kind, fields));
  return violations;
}

// --- directory run ----------------------------------------------------------

const NOT_FORMS: readonly string[] = ["config.yml", "config.yaml"];
const FORM_EXTENSION = /\.ya?ml$/;

interface Options {
  readonly formsDir: string;
  readonly labelsPath: string;
}

function parseArguments(argv: readonly string[]): Options | string {
  const usage = "usage: check-issue-forms.ts --forms <ISSUE_TEMPLATE dir> --labels <labels.yml>";
  let formsDir: string | null = null;
  let labelsPath: string | null = null;
  for (let index = 0; index < argv.length; index += 2) {
    const flag: string = argv[index] as string;
    const value: string | null = argv[index + 1] ?? null;
    if (value === null || value.startsWith("--")) return `${usage}\nmissing value for ${flag}`;
    if (flag === "--forms") formsDir = value;
    else if (flag === "--labels") labelsPath = value;
    else return `${usage}\nunknown argument ${flag}`;
  }
  if (formsDir === null || labelsPath === null) return usage;
  return { formsDir, labelsPath };
}

/** Runs the check on a directory and returns the exit status; `say` receives every output line. */
export async function runIssueFormCheck(
  argv: readonly string[],
  say: (line: string) => void,
): Promise<number> {
  const options = parseArguments(argv);
  if (typeof options === "string") {
    say(options);
    return 2;
  }

  let vocabulary: ReadonlySet<string>;
  try {
    const parsed = parseLabelsFile(await readFile(options.labelsPath, "utf8"));
    if (!parsed.ok) {
      say(`${options.labelsPath}: ${parsed.reason}`);
      return 1;
    }
    vocabulary = new Set<string>(parsed.value.map((label: LabelSpec): string => label.name));
  } catch (error) {
    say(`cannot read ${options.labelsPath}: ${(error as Error).message}`);
    return 1;
  }

  let entries: Dirent[];
  try {
    entries = await readdir(options.formsDir, { withFileTypes: true });
  } catch (error) {
    say(`cannot read the forms directory ${options.formsDir}: ${(error as Error).message}`);
    return 1;
  }

  const names: string[] = entries
    .filter(
      (entry: Dirent): boolean =>
        entry.isFile() && FORM_EXTENSION.test(entry.name) && !NOT_FORMS.includes(entry.name),
    )
    .map((entry: Dirent): string => entry.name)
    .sort();
  const ignored = entries.length - names.length;

  let violationCount = 0;
  for (const name of names) {
    let violations: readonly string[];
    try {
      violations = validateIssueForm(
        await readFile(join(options.formsDir, name), "utf8"),
        vocabulary,
      );
    } catch (error) {
      violations = [`cannot read the form: ${(error as Error).message}`];
    }
    for (const violation of violations) say(`${name}: ${violation}`);
    violationCount += violations.length;
  }

  say(
    `${names.length} ${names.length === 1 ? "formulaire examiné" : "formulaires examinés"}, ` +
      `${violationCount} ${violationCount === 1 ? "violation" : "violations"}`,
  );
  say(
    `${entries.length} entrées dans ${options.formsDir} = ${names.length} examinés + ` +
      `${ignored} ignoré${ignored > 1 ? "s" : ""} (config.yml, non YAML, non fichier)`,
  );
  if (names.length === 0) {
    say("no form found: an empty directory is not a success");
    return 1;
  }
  return violationCount > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await runIssueFormCheck(process.argv.slice(2), (line) => console.log(line)));
}
