import { describe, expect, test } from "bun:test";
import {
  gradeAnswer,
  gradeQuestionnaire,
  parseQuestionnaire,
  type QuestionnaireItem,
} from "./grading";
import questionnaireJson from "./questionnaire.json";

/**
 * Positioning L3 — the cold-reader grading grid is the versioned, testable
 * half of the heterogeneous review: model answers vary, the grid does not.
 * An expected element is covered when at least ONE of its alternative
 * patterns matches the answer, case-insensitively. These tests pin that
 * scoring rule and validate the committed questionnaire itself.
 */

const ITEM: QuestionnaireItem = {
  id: "what-is-it",
  question: "What is Libre AI?",
  expectedElements: [
    {
      id: "open-source",
      description: "an open-source software lab",
      source: "https://raw.githubusercontent.com/libre-ai/.github/main/profile/README.md",
      patterns: ["open[- ]source", "software lab"],
    },
    {
      id: "governed-agents",
      description: "built by AI agents under a governed method",
      source: "https://raw.githubusercontent.com/libre-ai/.github/main/profile/README.md",
      patterns: ["ai agents", "polaris"],
    },
  ],
};

describe("gradeAnswer", () => {
  test("covers an element when any one alternative pattern matches", () => {
    const score = gradeAnswer(ITEM, "It is an OPEN-SOURCE project run via Polaris.");
    expect(score.covered).toBe(2);
    expect(score.total).toBe(2);
    expect(score.elements).toEqual([
      { id: "open-source", covered: true },
      { id: "governed-agents", covered: true },
    ]);
  });

  test("matching is case-insensitive", () => {
    const score = gradeAnswer(ITEM, "a SOFTWARE LAB");
    expect(score.elements.find((e) => e.id === "open-source")?.covered).toBe(true);
  });

  test("leaves an element uncovered when no pattern matches", () => {
    const score = gradeAnswer(ITEM, "Something built by AI agents, hard to say more.");
    expect(score.covered).toBe(1);
    expect(score.elements).toEqual([
      { id: "open-source", covered: false },
      { id: "governed-agents", covered: true },
    ]);
  });
});

describe("gradeQuestionnaire", () => {
  test("aggregates per-question scores and totals", () => {
    const questionnaire = {
      schemaVersion: "libre-ai.cold-reader-questionnaire.v1" as const,
      items: [ITEM],
    };
    const graded = gradeQuestionnaire(
      questionnaire,
      new Map([["what-is-it", "an open source lab"]]),
    );
    expect(graded.expectedTotal).toBe(2);
    expect(graded.coveredTotal).toBe(1);
    expect(graded.perQuestion).toHaveLength(1);
  });

  test("a missing answer scores zero instead of crashing", () => {
    const questionnaire = {
      schemaVersion: "libre-ai.cold-reader-questionnaire.v1" as const,
      items: [ITEM],
    };
    const graded = gradeQuestionnaire(questionnaire, new Map());
    expect(graded.coveredTotal).toBe(0);
    expect(graded.perQuestion[0]?.covered).toBe(0);
  });
});

describe("parseQuestionnaire", () => {
  test("rejects an unknown schema version", () => {
    expect(() => parseQuestionnaire(JSON.stringify({ schemaVersion: "v0", items: [] }))).toThrow(
      /schemaVersion/,
    );
  });

  test("rejects an element without a public source", () => {
    const broken = {
      schemaVersion: "libre-ai.cold-reader-questionnaire.v1",
      items: [
        {
          id: "q",
          question: "?",
          expectedElements: [{ id: "e", description: "d", patterns: ["x"] }],
        },
      ],
    };
    expect(() => parseQuestionnaire(JSON.stringify(broken))).toThrow(/source/);
  });

  test("rejects an invalid regular expression at parse time, not at grading time", () => {
    const broken = {
      schemaVersion: "libre-ai.cold-reader-questionnaire.v1",
      items: [
        {
          id: "q",
          question: "?",
          expectedElements: [
            { id: "e", description: "d", source: "https://example.org", patterns: ["("] },
          ],
        },
      ],
    };
    expect(() => parseQuestionnaire(JSON.stringify(broken))).toThrow(/pattern/i);
  });

  test("rejects duplicate question ids", () => {
    const broken = {
      schemaVersion: "libre-ai.cold-reader-questionnaire.v1",
      items: [
        { id: "q", question: "?", expectedElements: [ITEM.expectedElements[0]] },
        { id: "q", question: "??", expectedElements: [ITEM.expectedElements[0]] },
      ],
    };
    expect(() => parseQuestionnaire(JSON.stringify(broken))).toThrow(/duplicate/i);
  });
});

describe("the committed questionnaire", () => {
  test("parses strictly and covers the four doctrinal questions", () => {
    const questionnaire = parseQuestionnaire(JSON.stringify(questionnaireJson));
    const ids = questionnaire.items.map((item) => item.id);
    expect(ids).toContain("what-is-libre-ai");
    expect(ids).toContain("where-is-the-evidence");
    expect(ids).toContain("how-to-verify-a-claim");
    expect(ids).toContain("how-to-contribute");
    expect(questionnaire.items.length).toBeGreaterThanOrEqual(4);
  });

  test("every expected element cites a public raw.githubusercontent.com source", () => {
    const questionnaire = parseQuestionnaire(JSON.stringify(questionnaireJson));
    for (const item of questionnaire.items) {
      expect(item.expectedElements.length).toBeGreaterThan(0);
      for (const element of item.expectedElements) {
        expect(element.source).toStartWith("https://raw.githubusercontent.com/libre-ai/");
      }
    }
  });
});
