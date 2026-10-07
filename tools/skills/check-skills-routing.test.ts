import { describe, expect, test } from "bun:test";
import {
  buildCorpusIdf,
  buildRoutingCorpus,
  checkPositiveTrigger,
  cosineSimilarity,
  PAIRWISE_ERROR_THRESHOLD,
  PAIRWISE_WARNING_THRESHOLD,
  pairwiseOverlap,
  rankForQuery,
  type SkillDescriptor,
  stem,
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
