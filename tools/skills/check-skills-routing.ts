/**
 * Skill routing gate (T2) — anti-doublon and rank-1 admission check.
 *
 * Admission of a new skill under `skills/` requires (owner arbitration,
 * 2026-08-18 skills-collection ADR): no internal duplicate (a description
 * that reads as another skill already does), and a working eval — its
 * positive triggers must actually route to it. This gate mechanizes both,
 * with a homemade TF-IDF cosine model over stemmed, stopword-filtered
 * frontmatter descriptions. No dependency: the stemmer is a light
 * suffix-stripper, not a linguistic Porter implementation — it only needs to
 * be *consistent* across the compared texts, not linguistically correct, for
 * cosine similarity to be meaningful as a coarse overlap signal.
 *
 * Two independent checks:
 *
 * 1. Pairwise description overlap. Every unordered pair of admitted skills is
 *    compared. >=75% cosine similarity is an error (the descriptions collide
 *    — rewrite one, never loosen this threshold per the owner arbitration).
 *    >=50% is a warning: recorded as a passing check (it is not disqualifying
 *    on its own) but also printed directly, because GateReport hides passing
 *    notes outside GATE_VERBOSE and a 50-75% warning that never surfaces
 *    would not be a warning at all.
 *
 * 2. Rank-1 floor per positive eval trigger. Each skill's own eval.json
 *    positive triggers are scored against every admitted skill's
 *    description; the trigger's own skill must rank first, above a
 *    configurable floor (SKILLS_RANK1_FLOOR env var, default tuned against
 *    this repository's real corpus — never loosened to make a bad
 *    description pass; rewrite the description instead).
 *
 * Negative triggers are deliberately NOT scored here. A negative trigger
 * shares enough vocabulary with its own skill's description (that is what
 * makes it a *near* miss) that in a 6-skill corpus with no competing
 * "generic review" or "generic deploy" skill to lose to, the skill often
 * still wins its own negative trigger by default — the check would then
 * fail on exactly the triggers that are doing their job. Mechanizing that
 * honestly would need a corpus of every other real skill in the ecosystem,
 * which this gate does not have. T1 (lint-skill.ts) already asserts that
 * every skill's eval.json carries its negative triggers; grading whether
 * they in fact fail to fire stays a reviewer's job, alongside the
 * behavioral case this gate also never grades.
 */

export const PAIRWISE_ERROR_THRESHOLD = 0.75;
export const PAIRWISE_WARNING_THRESHOLD = 0.5;
export const DEFAULT_RANK1_FLOOR = 0.12;

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "then",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "as",
  "is",
  "are",
  "be",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "use",
  "used",
  "using",
  "when",
  "not",
  "never",
  "own",
  "into",
  "over",
  "before",
  "after",
  "at",
  "by",
  "from",
  "than",
  "so",
  "no",
  "any",
  "one",
  "which",
  "what",
  "how",
  "you",
  "your",
]);

// Longest, most specific suffix first: order controls which one strips, and a
// plural must strip to the same root as its singular ("izations"/"ization"
// ahead of the shorter "ations"/"ation", or "authorizations" would lose only
// "ations" and land on "authoriz" while "authorization" lands on "author").
// A word must still be >=3 characters after stripping, so short roots ("as",
// "is") never vanish.
const SUFFIXES: readonly string[] = [
  "izations",
  "ization",
  "ications",
  "ication",
  "ations",
  "ation",
  "ingly",
  "edly",
  "ing",
  "ies",
  "ed",
  "ly",
  "es",
  "s",
];

// Known false stem, left uncorrected on purpose (adversarial review,
// 2026-08-19): "apply" ends in the letters "ly" by coincidence, not as an
// adverb suffix, so it strips to "app" instead of staying "apply" (or
// stemming to "appl" alongside "applies"/"applying"). Fixing the general
// case (distinguishing a real "-ly" adverb from a verb that merely ends in
// those two letters) needs part-of-speech context this suffix-stripper does
// not have — the fix would be a smaller, still-heuristic special case, not a
// real correction. Left as documented debt because it has no effect on this
// gate's real corpus (no admitted skill description or eval trigger turns on
// "apply" ranking correctly against another term), and per Match the Form to
// the Failure (docs/method/SKILLS-ANATOMY.md's source corpus): don't harden
// a rule against a failure nothing in the real corpus exercises.
/** Lightweight suffix-stripping stemmer — see module doc for what it is not. */
export function stem(token: string): string {
  const lower = token.toLowerCase();
  if (lower.length <= 4) return lower;
  for (const suffix of SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length - suffix.length >= 3) {
      if (suffix === "ies") return `${lower.slice(0, -3)}y`;
      return lower.slice(0, lower.length - suffix.length);
    }
  }
  return lower;
}

// Tokenization assumes ASCII words (`[a-z0-9]` after lowercasing, plus
// internal hyphen/apostrophe) because every skill's frontmatter `description`
// is required to be English (ADR-0025 D6) — there is no accented or non-Latin
// text in this gate's real input to normalize. A body written in French
// (most of this collection's SKILL.md bodies) never reaches this function:
// only the frontmatter description is tokenized for routing, never the body.
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) ?? [];
  return words.filter((word) => word.length > 1 && !STOPWORDS.has(word)).map(stem);
}

export type TermVector = ReadonlyMap<string, number>;

/** Smoothed IDF over a corpus of already-tokenized documents; always positive. */
export function buildCorpusIdf(
  documents: readonly (readonly string[])[],
): ReadonlyMap<string, number> {
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of new Set(document)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const corpusSize = documents.length;
  const idf = new Map<string, number>();
  for (const [term, count] of documentFrequency) {
    idf.set(term, Math.log((corpusSize + 1) / (count + 1)) + 1);
  }
  return idf;
}

const UNSEEN_TERM_IDF = Math.log(2) + 1;

export function tfidfVector(
  document: readonly string[],
  idf: ReadonlyMap<string, number>,
): TermVector {
  if (document.length === 0) return new Map();
  const termFrequency = new Map<string, number>();
  for (const term of document) termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
  const vector = new Map<string, number>();
  for (const [term, count] of termFrequency) {
    vector.set(term, (count / document.length) * (idf.get(term) ?? UNSEEN_TERM_IDF));
  }
  return vector;
}

export function cosineSimilarity(a: TermVector, b: TermVector): number {
  let dot = 0;
  for (const [term, weightA] of a) {
    const weightB = b.get(term);
    if (weightB !== undefined) dot += weightA * weightB;
  }
  let normA = 0;
  for (const weight of a.values()) normA += weight * weight;
  let normB = 0;
  for (const weight of b.values()) normB += weight * weight;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface SkillDescriptor {
  readonly name: string;
  readonly description: string;
}

export interface PairwiseOverlap {
  readonly a: string;
  readonly b: string;
  readonly similarity: number;
}

/** Builds the corpus IDF once, then compares every unordered pair of skills. */
export function pairwiseOverlap(skills: readonly SkillDescriptor[]): PairwiseOverlap[] {
  const tokenized = skills.map((skill) => tokenize(skill.description));
  const idf = buildCorpusIdf(tokenized);
  const vectors = tokenized.map((document) => tfidfVector(document, idf));
  const results: PairwiseOverlap[] = [];
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const skillA = skills[i];
      const skillB = skills[j];
      const vectorA = vectors[i];
      const vectorB = vectors[j];
      if (!skillA || !skillB || !vectorA || !vectorB) continue;
      results.push({
        a: skillA.name,
        b: skillB.name,
        similarity: cosineSimilarity(vectorA, vectorB),
      });
    }
  }
  return results;
}

export interface RankedSkill {
  readonly name: string;
  readonly score: number;
}

/** Corpus prepared once and reused across every trigger query, for one skill set. */
export interface RoutingCorpus {
  readonly skills: readonly SkillDescriptor[];
  readonly idf: ReadonlyMap<string, number>;
  readonly vectors: readonly TermVector[];
}

export function buildRoutingCorpus(skills: readonly SkillDescriptor[]): RoutingCorpus {
  const tokenized = skills.map((skill) => tokenize(skill.description));
  const idf = buildCorpusIdf(tokenized);
  const vectors = tokenized.map((document) => tfidfVector(document, idf));
  return { skills, idf, vectors };
}

/** Ranks every skill's description against one query string, best match first. */
export function rankForQuery(query: string, corpus: RoutingCorpus): RankedSkill[] {
  const queryVector = tfidfVector(tokenize(query), corpus.idf);
  return corpus.skills
    .map((skill, index) => ({
      name: skill.name,
      score: cosineSimilarity(queryVector, corpus.vectors[index] ?? new Map()),
    }))
    .sort((left, right) => right.score - left.score);
}

export interface Rank1Check {
  readonly ok: boolean;
  readonly winner: RankedSkill | undefined;
  readonly targetScore: number;
  /** True when a second skill scores exactly the winner's score — the rank-1
   *  call then rests on array/alphabetical order (`rankForQuery`'s stable
   *  sort), not on a real signal, and the report note should say so rather
   *  than imply the winner earned first place outright. */
  readonly tied: boolean;
}

/** Positive trigger: the target skill must rank first, above the floor. */
export function checkPositiveTrigger(
  target: string,
  ranking: readonly RankedSkill[],
  floor: number,
): Rank1Check {
  const winner = ranking[0];
  const targetScore = ranking.find((entry) => entry.name === target)?.score ?? 0;
  const ok = winner?.name === target && targetScore >= floor;
  const tied =
    winner !== undefined && ranking.filter((entry) => entry.score === winner.score).length > 1;
  return { ok, winner, targetScore, tied };
}

function readRank1Floor(): number {
  const raw = process.env.SKILLS_RANK1_FLOOR;
  if (raw === undefined || raw === "") return DEFAULT_RANK1_FLOOR;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`SKILLS_RANK1_FLOOR must be a number in [0, 1], got "${raw}"`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const { existsSync } = await import("node:fs");
  const { concludeGate, GateReport } = await import("../quality/gate-report");
  const { parseFrontmatter } = await import("./lint-skill");

  const report = new GateReport();
  const skillsRoot = "skills";

  if (!existsSync(skillsRoot)) {
    report.allowEmpty(`no ${skillsRoot}/ directory in this repository`);
    concludeGate("Skills routing (T2)", report);
    return;
  }

  const glob = new Bun.Glob("*/SKILL.md");
  const dirs: string[] = [];
  for await (const path of glob.scan({ cwd: skillsRoot, onlyFiles: true })) {
    const dir = path.split("/")[0];
    if (dir) dirs.push(dir);
  }
  dirs.sort();

  if (dirs.length === 0) {
    report.allowEmpty(`${skillsRoot}/ exists but holds no <name>/SKILL.md — nothing admitted yet`);
    concludeGate("Skills routing (T2)", report);
    return;
  }

  const skills: SkillDescriptor[] = [];
  const positiveTriggers = new Map<string, string[]>();

  for (const dir of dirs) {
    const source = await Bun.file(`${skillsRoot}/${dir}/SKILL.md`).text();
    const parsed = parseFrontmatter(source);
    if ("error" in parsed) {
      report.check(
        `${dir} — frontmatter`,
        false,
        `cannot route: ${parsed.error} (see T1 for the structural gate)`,
      );
      continue;
    }
    const description = parsed.frontmatter.description ?? "";
    if (description.length === 0) {
      report.check(
        `${dir} — frontmatter description`,
        false,
        "empty description — cannot be routed or compared (see T1)",
      );
      continue;
    }
    skills.push({ name: dir, description });

    const evalPath = `${skillsRoot}/${dir}/eval.json`;
    if (existsSync(evalPath)) {
      let raw: { positive?: unknown };
      try {
        raw = (await Bun.file(evalPath).json()) as { positive?: unknown };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.check(
          evalPath,
          false,
          `invalid JSON (${message}) — rank-1 routing cannot be checked (see T1)`,
        );
        continue;
      }
      const positive = Array.isArray(raw.positive)
        ? raw.positive.filter((v): v is string => typeof v === "string")
        : [];
      positiveTriggers.set(dir, positive);
    }
  }

  if (skills.length < 2) {
    report.allowEmpty(
      `only ${skills.length} skill(s) carry a routable description — pairwise overlap needs at least 2 to compare`,
    );
  } else {
    for (const pair of pairwiseOverlap(skills)) {
      const percent = (pair.similarity * 100).toFixed(1);
      if (pair.similarity >= PAIRWISE_ERROR_THRESHOLD) {
        report.check(
          `overlap ${pair.a} <-> ${pair.b}`,
          false,
          `${percent}% cosine overlap >= ${PAIRWISE_ERROR_THRESHOLD * 100}% error threshold — descriptions collide, rewrite one (never loosen the threshold)`,
        );
      } else if (pair.similarity >= PAIRWISE_WARNING_THRESHOLD) {
        const note = `${percent}% cosine overlap >= ${PAIRWISE_WARNING_THRESHOLD * 100}% warning band — descriptions are close, consider rewriting`;
        report.check(`overlap ${pair.a} <-> ${pair.b}`, true, note);
        console.warn(`::warning::Skills routing (T2): ${pair.a} <-> ${pair.b}: ${note}`);
      } else {
        report.check(`overlap ${pair.a} <-> ${pair.b}`, true, `${percent}% cosine overlap`);
      }
    }
  }

  if (skills.length > 0) {
    const floor = readRank1Floor();
    const corpus = buildRoutingCorpus(skills);
    for (const skill of skills) {
      const triggers = positiveTriggers.get(skill.name);
      if (!triggers) {
        report.check(
          `${skill.name} — eval triggers`,
          false,
          "no eval.json found — rank-1 routing cannot be checked (see T1)",
        );
        continue;
      }
      triggers.forEach((trigger, index) => {
        const ranking = rankForQuery(trigger, corpus);
        const result = checkPositiveTrigger(skill.name, ranking, floor);
        const tiedSuffix = result.tied ? " (tied)" : "";
        report.check(
          `${skill.name} — positive trigger ${index + 1}`,
          result.ok,
          result.ok
            ? `rank-1 "${skill.name}" at ${result.targetScore.toFixed(3)}${tiedSuffix} (floor ${floor}): "${truncateTrigger(trigger)}"`
            : `expected rank-1 "${skill.name}" (>= floor ${floor}), got "${result.winner?.name ?? "none"}" at ${(result.winner?.score ?? 0).toFixed(3)}${tiedSuffix}, "${skill.name}" scored ${result.targetScore.toFixed(3)}: "${truncateTrigger(trigger)}"`,
        );
      });
    }
  }

  concludeGate("Skills routing (T2)", report);
}

function truncateTrigger(trigger: string, max = 88): string {
  return trigger.length > max ? `${trigger.slice(0, max)}…` : trigger;
}

if (import.meta.main) await main();
