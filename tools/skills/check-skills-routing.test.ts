import { describe, expect, test } from "bun:test";
import {
  buildCorpusIdf,
  buildRoutingCorpus,
  checkPositiveTrigger,
  cosineSimilarity,
  DEFAULT_RANK1_FLOOR,
  formatRoutingSummary,
  gradeRoutingCases,
  loadSkillSources,
  PAIRWISE_ERROR_THRESHOLD,
  PAIRWISE_WARNING_THRESHOLD,
  pairwiseOverlap,
  parseSkillSource,
  type RoutingCaseResult,
  type RoutingCaseSummary,
  rankForQuery,
  type SkillDescriptor,
  type SkillSourceText,
  stem,
  summarizeRoutingCases,
  tfidfVector,
  tokenize,
} from "./check-skills-routing";

describe("stem", () => {
  test("leaves short words untouched", () => {
    expect(stem("use")).toBe("use");
    expect(stem("api")).toBe("api");
  });

  test("strips a plural -s without eating the root", () => {
    expect(stem("tokens")).toBe("token");
  });

  test("strips -ing", () => {
    expect(stem("deploying")).toBe("deploy");
  });

  test("strips -ies as -y", () => {
    expect(stem("policies")).toBe("policy");
  });

  test("is idempotent-ish across close variants (routing signal, not a linguistic claim)", () => {
    expect(stem("authorization")).toBe(stem("authorizations"));
  });
});

describe("tokenize", () => {
  test("lowercases, strips punctuation, drops stopwords, and stems", () => {
    const tokens = tokenize("Use when Implementing Biscuit Authorization in Rust services.");
    expect(tokens).not.toContain("use");
    expect(tokens).not.toContain("when");
    expect(tokens).not.toContain("in");
    expect(tokens).toContain("biscuit");
    expect(tokens).toContain("rust");
  });

  test("keeps hyphenated compounds as one token", () => {
    expect(tokenize("multi-tenant isolation")).toContain("multi-tenant");
  });
});

describe("cosineSimilarity", () => {
  test("is 1 for identical vectors", () => {
    const vector = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    expect(cosineSimilarity(vector, vector)).toBeCloseTo(1, 10);
  });

  test("is 0 for disjoint vocabularies", () => {
    const a = new Map([["a", 1]]);
    const b = new Map([["b", 1]]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  test("is 0 when either vector is empty (no divide-by-zero)", () => {
    expect(cosineSimilarity(new Map(), new Map([["a", 1]]))).toBe(0);
  });
});

describe("buildCorpusIdf / tfidfVector", () => {
  test("a term in every document scores lower idf than a term in one document", () => {
    const idf = buildCorpusIdf([
      ["common", "rare"],
      ["common", "other"],
    ]);
    const common = idf.get("common");
    const rare = idf.get("rare");
    expect(common).toBeDefined();
    expect(rare).toBeDefined();
    expect(common as number).toBeLessThan(rare as number);
  });

  test("tfidfVector of an empty document is an empty vector", () => {
    const idf = buildCorpusIdf([["a"]]);
    expect(tfidfVector([], idf).size).toBe(0);
  });
});

describe("pairwiseOverlap", () => {
  test("two near-identical descriptions cross the error threshold", () => {
    const skills: SkillDescriptor[] = [
      {
        name: "one",
        description: "Deploy the application to Clever Cloud with pre-flight checks.",
      },
      {
        name: "two",
        description: "Deploy the application to Clever Cloud with pre-flight checks and status.",
      },
    ];
    const [pair] = pairwiseOverlap(skills);
    expect(pair?.similarity).toBeGreaterThanOrEqual(PAIRWISE_ERROR_THRESHOLD);
  });

  test("two unrelated descriptions stay under the warning threshold", () => {
    const skills: SkillDescriptor[] = [
      {
        name: "one",
        description: "Rotate Biscuit signing keys and revoke a leaked authorization token.",
      },
      {
        name: "two",
        description: "Screen a data flow for the Art. 35 GDPR impact assessment scaffold.",
      },
    ];
    const [pair] = pairwiseOverlap(skills);
    expect(pair?.similarity).toBeLessThan(PAIRWISE_WARNING_THRESHOLD);
  });

  test("compares every unordered pair exactly once", () => {
    const skills: SkillDescriptor[] = [
      { name: "a", description: "alpha" },
      { name: "b", description: "beta" },
      { name: "c", description: "gamma" },
    ];
    expect(pairwiseOverlap(skills)).toHaveLength(3);
  });
});

describe("rankForQuery / checkPositiveTrigger", () => {
  const skills: SkillDescriptor[] = [
    {
      name: "biscuit-auth",
      description:
        "Apply Biscuit token authorization, authority blocks, attenuation, authorizer policies, Ed25519 keys.",
    },
    {
      name: "rgpd-dpia",
      description:
        "Point to the DPIA Art. 35 GDPR scaffold for automated decision-making and special-category data.",
    },
  ];
  const corpus = buildRoutingCorpus(skills);

  test("a trigger sharing vocabulary with one skill ranks it first", () => {
    const ranking = rankForQuery(
      "Debug why the Biscuit authorizer policy denies this token.",
      corpus,
    );
    expect(ranking[0]?.name).toBe("biscuit-auth");
  });

  test("checkPositiveTrigger fails when the target does not win rank 1", () => {
    const ranking = rankForQuery(
      "Debug why the Biscuit authorizer policy denies this token.",
      corpus,
    );
    const result = checkPositiveTrigger("rgpd-dpia", ranking, 0.01);
    expect(result.ok).toBe(false);
  });

  test("checkPositiveTrigger fails when the winning score is below the floor", () => {
    const ranking = rankForQuery(
      "Debug why the Biscuit authorizer policy denies this token.",
      corpus,
    );
    const result = checkPositiveTrigger("biscuit-auth", ranking, 0.99);
    expect(result.ok).toBe(false);
  });

  test("checkPositiveTrigger passes when the target wins above the floor", () => {
    const ranking = rankForQuery(
      "Debug why the Biscuit authorizer policy denies this token.",
      corpus,
    );
    const result = checkPositiveTrigger("biscuit-auth", ranking, 0.01);
    expect(result.ok).toBe(true);
  });

  test("checkPositiveTrigger flags a perfect tie at rank 1 as tied", () => {
    // Two skills score identically — the winner is only decided by array
    // order (rankForQuery's stable sort), not by a real signal.
    const ranking = [
      { name: "biscuit-auth", score: 0.5 },
      { name: "rgpd-dpia", score: 0.5 },
    ];
    const result = checkPositiveTrigger("biscuit-auth", ranking, 0.01);
    expect(result.ok).toBe(true);
    expect(result.tied).toBe(true);
  });

  test("checkPositiveTrigger reports no tie when the winner is unambiguous", () => {
    const ranking = [
      { name: "biscuit-auth", score: 0.7 },
      { name: "rgpd-dpia", score: 0.3 },
    ];
    const result = checkPositiveTrigger("biscuit-auth", ranking, 0.01);
    expect(result.tied).toBe(false);
  });
});

function skillMarkdown(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}

function evalJson(positive: readonly unknown[]): string {
  return JSON.stringify({ skill: "unused", positive, negative: [], behavioral: {} });
}

const BISCUIT_DESCRIPTION =
  "Apply Biscuit token authorization, authority blocks, attenuation, authorizer policies, Ed25519 keys.";
const DPIA_DESCRIPTION =
  "Point to the DPIA Art. 35 GDPR scaffold for automated decision-making and special-category data.";
const BISCUIT_TRIGGER = "Debug why the Biscuit authorizer policy denies this token.";
const DPIA_TRIGGER = "Does this automated decision-making feature need an Art. 35 DPIA?";

function gradeTexts(sources: readonly SkillSourceText[]): RoutingCaseResult[] {
  return gradeRoutingCases(sources.map(parseSkillSource), DEFAULT_RANK1_FLOOR);
}

function expectCountersSumToTotal(results: readonly RoutingCaseResult[]): RoutingCaseSummary {
  const summary = summarizeRoutingCases(results);
  expect(summary.total).toBe(results.length);
  expect(summary.pass + summary.fail + summary.ungraded).toBe(summary.total);
  return summary;
}

describe("gradeRoutingCases / summarizeRoutingCases", () => {
  test("a well-formed corpus grades every positive trigger pass, with rank and score", () => {
    const results = gradeTexts([
      {
        name: "biscuit-auth",
        skillMarkdown: skillMarkdown("biscuit-auth", BISCUIT_DESCRIPTION),
        evalJson: evalJson([BISCUIT_TRIGGER]),
      },
      {
        name: "rgpd-dpia",
        skillMarkdown: skillMarkdown("rgpd-dpia", DPIA_DESCRIPTION),
        evalJson: evalJson([DPIA_TRIGGER]),
      },
    ]);
    expect(results.map((result) => result.caseId)).toEqual([
      "biscuit-auth/positive/1",
      "rgpd-dpia/positive/1",
    ]);
    for (const result of results) {
      expect(result.kind).toBe("positive");
      expect(result.blocking).toBe(true);
      expect(result.outcome).toBe("pass");
      expect(result.rank).toBe(1);
      expect(result.score).toBeGreaterThanOrEqual(DEFAULT_RANK1_FLOOR);
    }
    expect(expectCountersSumToTotal(results)).toEqual({ total: 2, pass: 2, fail: 0, ungraded: 0 });
  });

  test("a trigger that loses rank 1 is a fail, never ungraded", () => {
    // The DPIA skill claims a Biscuit trigger: it is readable and routable,
    // it simply routes elsewhere — a real miss.
    const results = gradeTexts([
      {
        name: "biscuit-auth",
        skillMarkdown: skillMarkdown("biscuit-auth", BISCUIT_DESCRIPTION),
        evalJson: evalJson([BISCUIT_TRIGGER]),
      },
      {
        name: "rgpd-dpia",
        skillMarkdown: skillMarkdown("rgpd-dpia", DPIA_DESCRIPTION),
        evalJson: evalJson([BISCUIT_TRIGGER]),
      },
    ]);
    const lost = results.find((result) => result.caseId === "rgpd-dpia/positive/1");
    expect(lost?.outcome).toBe("fail");
    expect(lost?.rank).toBe(2);
    expect(lost?.winner?.name).toBe("biscuit-auth");
    expect(expectCountersSumToTotal(results)).toEqual({ total: 2, pass: 1, fail: 1, ungraded: 0 });
  });

  test("an invalid eval.json is ungraded, not fail, and still counted", () => {
    const results = gradeTexts([
      {
        name: "biscuit-auth",
        skillMarkdown: skillMarkdown("biscuit-auth", BISCUIT_DESCRIPTION),
        evalJson: "{ not json",
      },
      {
        name: "rgpd-dpia",
        skillMarkdown: skillMarkdown("rgpd-dpia", DPIA_DESCRIPTION),
        evalJson: evalJson([DPIA_TRIGGER]),
      },
    ]);
    const unreadable = results.find((result) => result.skill === "biscuit-auth");
    expect(unreadable?.caseId).toBe("biscuit-auth/positive/*");
    expect(unreadable?.outcome).toBe("ungraded");
    expect(unreadable?.blocking).toBe(true);
    expect(unreadable?.reason).toContain("not valid JSON");
    expect(expectCountersSumToTotal(results)).toEqual({ total: 2, pass: 1, fail: 0, ungraded: 1 });
  });

  test("a missing eval.json, or one without a positive array, is ungraded", () => {
    const results = gradeTexts([
      {
        name: "biscuit-auth",
        skillMarkdown: skillMarkdown("biscuit-auth", BISCUIT_DESCRIPTION),
        evalJson: null,
      },
      {
        name: "rgpd-dpia",
        skillMarkdown: skillMarkdown("rgpd-dpia", DPIA_DESCRIPTION),
        evalJson: JSON.stringify({ positive: "not an array" }),
      },
    ]);
    expect(results.map((result) => [result.caseId, result.outcome])).toEqual([
      ["biscuit-auth/positive/*", "ungraded"],
      ["rgpd-dpia/positive/*", "ungraded"],
    ]);
    expect(expectCountersSumToTotal(results)).toEqual({ total: 2, pass: 0, fail: 0, ungraded: 2 });
  });

  test("an empty positive array is ungraded — zero triggers is never zero cases", () => {
    const results = gradeTexts([
      {
        name: "biscuit-auth",
        skillMarkdown: skillMarkdown("biscuit-auth", BISCUIT_DESCRIPTION),
        evalJson: evalJson([]),
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("ungraded");
  });

  test("a non-string trigger entry is ungraded at its own index", () => {
    const results = gradeTexts([
      {
        name: "biscuit-auth",
        skillMarkdown: skillMarkdown("biscuit-auth", BISCUIT_DESCRIPTION),
        evalJson: evalJson([BISCUIT_TRIGGER, 42]),
      },
    ]);
    expect(results.map((result) => [result.caseId, result.outcome])).toEqual([
      ["biscuit-auth/positive/1", "pass"],
      ["biscuit-auth/positive/2", "ungraded"],
    ]);
  });

  test("a broken frontmatter makes each of the skill's triggers ungraded", () => {
    const results = gradeTexts([
      {
        name: "biscuit-auth",
        skillMarkdown: "no frontmatter fence at all\n",
        evalJson: evalJson([BISCUIT_TRIGGER, "Write authorizer policies."]),
      },
      {
        name: "rgpd-dpia",
        skillMarkdown: skillMarkdown("rgpd-dpia", DPIA_DESCRIPTION),
        evalJson: evalJson([DPIA_TRIGGER]),
      },
    ]);
    const broken = results.filter((result) => result.skill === "biscuit-auth");
    expect(broken.map((result) => result.caseId)).toEqual([
      "biscuit-auth/positive/1",
      "biscuit-auth/positive/2",
    ]);
    for (const result of broken) {
      expect(result.outcome).toBe("ungraded");
      expect(result.reason).toContain("frontmatter");
    }
    expect(expectCountersSumToTotal(results)).toEqual({ total: 3, pass: 1, fail: 0, ungraded: 2 });
  });

  test("an empty description is ungraded, like a broken frontmatter", () => {
    const results = gradeTexts([
      {
        name: "biscuit-auth",
        skillMarkdown: "---\nname: biscuit-auth\n---\n\n# biscuit-auth\n",
        evalJson: evalJson([BISCUIT_TRIGGER]),
      },
    ]);
    expect(results[0]?.outcome).toBe("ungraded");
    expect(results[0]?.reason).toContain("description");
  });

  test("an empty result list sums to zero on every counter", () => {
    expect(expectCountersSumToTotal([])).toEqual({ total: 0, pass: 0, fail: 0, ungraded: 0 });
  });
});

describe("formatRoutingSummary", () => {
  test("names every counter, ungraded included", () => {
    expect(formatRoutingSummary({ total: 4, pass: 2, fail: 1, ungraded: 1 })).toBe(
      "4 positive case(s): 2 pass, 1 fail, 1 ungraded",
    );
  });
});

describe("real corpus", () => {
  test("every positive trigger under skills/ passes: 18 pass, 0 fail, 0 ungraded", async () => {
    const sources = await loadSkillSources(`${import.meta.dir}/../../skills`);
    const results = gradeRoutingCases(sources.map(parseSkillSource), DEFAULT_RANK1_FLOOR);
    expect(expectCountersSumToTotal(results)).toEqual({
      total: 18,
      pass: 18,
      fail: 0,
      ungraded: 0,
    });
  });
});
