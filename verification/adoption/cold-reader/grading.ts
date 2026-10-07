/**
 * Cold-reader grading grid (positioning L3).
 *
 * The heterogeneous cold-reader decorrelates reviewers: a model from ANOTHER
 * provider, with zero project context, answers a fixed questionnaire from the
 * public surfaces alone. Model answers vary; the grading grid must not. This
 * module is the deterministic half: a strictly parsed, versioned
 * questionnaire whose expected elements each cite the public source that
 * states them, and a scoring rule pinned by tests.
 *
 * Scoring rule: an expected element is covered when AT LEAST ONE of its
 * alternative patterns matches the answer, case-insensitively. Patterns are
 * alternatives (synonyms/phrasings of the same fact), not a conjunction —
 * requiring all of them would grade wording, not understanding.
 */

export const QUESTIONNAIRE_SCHEMA_VERSION = "libre-ai.cold-reader-questionnaire.v1";

export interface ExpectedElement {
  readonly id: string;
  readonly description: string;
  /** Public URL that states this element — the grid must stay sourceable. */
  readonly source: string;
  /** Case-insensitive regex alternatives; one match covers the element. */
  readonly patterns: readonly string[];
}

export interface QuestionnaireItem {
  readonly id: string;
  readonly question: string;
  readonly expectedElements: readonly ExpectedElement[];
}

export interface Questionnaire {
  readonly schemaVersion: typeof QUESTIONNAIRE_SCHEMA_VERSION;
  readonly items: readonly QuestionnaireItem[];
}

export interface ElementResult {
  readonly id: string;
  readonly covered: boolean;
}

export interface QuestionScore {
  readonly questionId: string;
  readonly covered: number;
  readonly total: number;
  readonly elements: readonly ElementResult[];
}

export interface QuestionnaireScore {
  readonly perQuestion: readonly QuestionScore[];
  readonly coveredTotal: number;
  readonly expectedTotal: number;
}

function fail(field: string, expectation: string): never {
  throw new Error(`invalid questionnaire: ${field} ${expectation}`);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(field, "must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(field, "must be a non-empty string");
  }
  return value;
}

function asArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(field, "must be a non-empty array");
  }
  return value;
}

function parseElement(value: unknown, field: string): ExpectedElement {
  const record = asRecord(value, field);
  const patterns = asArray(record.patterns, `${field}.patterns`).map((pattern, index) => {
    const text = asString(pattern, `${field}.patterns[${index}]`);
    try {
      // Compile at parse time: a broken pattern must fail when the grid is
      // edited, not silently mis-grade a run months later.
      new RegExp(text, "i");
    } catch (error) {
      fail(
        `${field}.patterns[${index}]`,
        `must be a valid pattern: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return text;
  });
  return {
    id: asString(record.id, `${field}.id`),
    description: asString(record.description, `${field}.description`),
    source: asString(record.source, `${field}.source`),
    patterns,
  };
}

export function parseQuestionnaire(text: string): Questionnaire {
  const root = asRecord(JSON.parse(text), "questionnaire");
  if (root.schemaVersion !== QUESTIONNAIRE_SCHEMA_VERSION) {
    fail("schemaVersion", `must be ${QUESTIONNAIRE_SCHEMA_VERSION}`);
  }
  const seen = new Set<string>();
  const items = asArray(root.items, "items").map((value, index) => {
    const field = `items[${index}]`;
    const record = asRecord(value, field);
    const id = asString(record.id, `${field}.id`);
    if (seen.has(id)) {
      fail(`${field}.id`, `is a duplicate question id: ${id}`);
    }
    seen.add(id);
    return {
      id,
      question: asString(record.question, `${field}.question`),
      expectedElements: asArray(record.expectedElements, `${field}.expectedElements`).map(
        (element, elementIndex) =>
          parseElement(element, `${field}.expectedElements[${elementIndex}]`),
      ),
    };
  });
  return { schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION, items };
}

export function gradeAnswer(item: QuestionnaireItem, answer: string): QuestionScore {
  const elements = item.expectedElements.map((element) => ({
    id: element.id,
    covered: element.patterns.some((pattern) => new RegExp(pattern, "i").test(answer)),
  }));
  return {
    questionId: item.id,
    covered: elements.filter((element) => element.covered).length,
    total: elements.length,
    elements,
  };
}

export function gradeQuestionnaire(
  questionnaire: Questionnaire,
  answers: ReadonlyMap<string, string>,
): QuestionnaireScore {
  const perQuestion = questionnaire.items.map((item) =>
    gradeAnswer(item, answers.get(item.id) ?? ""),
  );
  return {
    perQuestion,
    coveredTotal: perQuestion.reduce((sum, score) => sum + score.covered, 0),
    expectedTotal: perQuestion.reduce((sum, score) => sum + score.total, 0),
  };
}
