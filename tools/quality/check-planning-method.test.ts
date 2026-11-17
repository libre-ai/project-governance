import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Structure check of the planning method (`docs/method/PLANNING.md`).
 *
 * The method says an agent plan carries no duration, no date, no time tier and
 * no team-size justification. What an agent actually emits cannot be tested on
 * a document; what can be is that the document itself does not teach the forms
 * it forbids, that its refused example really contains them, and that the date
 * a human imposed in the conforming example is repeated unchanged.
 *
 * Exempt zones are a design decision of this check, fixed here:
 *  - the `Statut` item of the header (repository convention: a method document
 *    dates its proposal);
 *  - the tagged block of the refused example (its purpose is the motif);
 *  - every verbatim citation, guillemets included, of the human-imposed date
 *    inside the conforming example.
 * Nothing else is exempt, and the counters printed on success sum to the
 * document: scanned + exempt = total characters.
 */

const REPO_ROOT = resolve(import.meta.dir, "../..");
const DOCUMENT = "docs/method/PLANNING.md";
const AUTHORITY_MAP = "docs/README.md";

const EXPECTED_H2 = [
  "Cible",
  "Phases",
  "Qualité",
  "Dates imposées",
  "Exemple de plan conforme",
  "Exemple de plan refusé",
] as const;
const PLAN_RUBRICS = ["Cible", "Phases", "Qualité"] as const;

const ANTI_EXAMPLE_START = "<!-- planning:anti-example:start -->";
const ANTI_EXAMPLE_END = "<!-- planning:anti-example:end -->";
const IMPOSED_DATE_MARKER = "<!-- planning:imposed-date:fictional -->";

/** A word edge that also holds next to an accented letter (`\b` is ASCII-only). */
const EDGE_BEFORE = "(?<![\\p{L}\\p{N}])";
const EDGE_AFTER = "(?![\\p{L}\\p{N}])";

const DURATION_UNITS =
  "heures?|jours?|semaines?|mois|trimestres?|ans?|années?|sprints?|hours?|days?|weeks?|months?|quarters?|years?";
const MONTHS =
  "janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|january|february|march|april|may|june|july|august|september|october|november|december";

type FamilyId = "a" | "b" | "c" | "d" | "e";

interface Family {
  readonly id: FamilyId;
  readonly label: string;
  readonly patterns: readonly RegExp[];
}

/** The five forbidden families of the brief, in its order. */
const FAMILIES: readonly Family[] = [
  {
    id: "a",
    label: "number followed by a duration unit",
    patterns: [
      new RegExp(`${EDGE_BEFORE}\\d+(?:[.,]\\d+)?\\s*(?:${DURATION_UNITS})${EDGE_AFTER}`, "giu"),
    ],
  },
  { id: "b", label: "ISO date", patterns: [/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/gu] },
  {
    id: "c",
    label: "named month followed by a year",
    patterns: [new RegExp(`${EDGE_BEFORE}(?:${MONTHS})\\s+\\d{4}${EDGE_AFTER}`, "giu")],
  },
  {
    id: "d",
    label: "time tier",
    patterns: [
      new RegExp(`${EDGE_BEFORE}(?:court|moyen|long)\\s+terme${EDGE_AFTER}`, "giu"),
      new RegExp(`${EDGE_BEFORE}T[1-4]${EDGE_AFTER}`, "gu"),
    ],
  },
  {
    id: "e",
    label: "team-size justification",
    patterns: [/[ée]quipe r[ée]duite|petite [ée]quipe|nombre de d[ée]veloppeurs/giu],
  },
];

interface Finding {
  readonly family: FamilyId;
  readonly match: string;
  readonly line: number;
}

function findMotifs(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const family of FAMILIES) {
    for (const pattern of family.patterns) {
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split("\n").length;
        findings.push({ family: family.id, match: match[0], line });
      }
    }
  }
  return findings;
}

/** Read a file that must be tracked by git; a missing or empty source is an error, never a zero. */
function readTracked(path: string): string {
  const tracked = Bun.spawnSync(["git", "ls-files", "--error-unmatch", "--", path], {
    cwd: REPO_ROOT,
  });
  if (tracked.exitCode !== 0) {
    throw new Error(`${path}: not tracked by git (${tracked.stderr.toString().trim()})`);
  }
  const text = readFileSync(resolve(REPO_ROOT, path), "utf8").normalize("NFC");
  if (text.trim().length === 0) {
    throw new Error(`${path}: empty, nothing to inspect`);
  }
  return text;
}

interface Heading {
  readonly level: number;
  readonly title: string;
  /** Offset of the first character of the heading line. */
  readonly start: number;
  /** Offset of the first character after the heading line. */
  readonly bodyStart: number;
}

/** Markdown headings outside fenced code blocks. */
function headings(text: string): Heading[] {
  const found: Heading[] = [];
  let offset = 0;
  let inFence = false;
  for (const line of text.split("\n")) {
    const bodyStart = offset + line.length + 1;
    if (line.startsWith("```")) {
      inFence = !inFence;
    } else if (!inFence) {
      const match = /^(#{1,6}) (.+)$/.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined) {
        found.push({ level: match[1].length, title: match[2].trim(), start: offset, bodyStart });
      }
    }
    offset = bodyStart;
  }
  return found;
}

interface Span {
  readonly start: number;
  readonly end: number;
}

/** Body of the first heading with this level and title, up to the next heading of the same or a higher level. */
function sectionSpan(text: string, level: number, title: string, within?: Span): Span {
  const scope = within ?? { start: 0, end: text.length };
  const all = headings(text).filter(
    (heading) => heading.start >= scope.start && heading.start < scope.end,
  );
  const index = all.findIndex((heading) => heading.level === level && heading.title === title);
  const heading = all[index];
  if (heading === undefined) {
    throw new Error(`section «${"#".repeat(level)} ${title}» not found`);
  }
  const next = all.slice(index + 1).find((candidate) => candidate.level <= level);
  return { start: heading.bodyStart, end: next?.start ?? scope.end };
}

function slice(text: string, span: Span): string {
  return text.slice(span.start, span.end);
}

function indexOfOnce(text: string, needle: string): number {
  const first = text.indexOf(needle);
  if (first === -1 || text.indexOf(needle, first + 1) !== -1) {
    throw new Error(`expected exactly one «${needle}»`);
  }
  return first;
}

/** The tagged block of the refused example, markers included. */
function antiExampleSpan(text: string): Span {
  const start = indexOfOnce(text, ANTI_EXAMPLE_START);
  const end = indexOfOnce(text, ANTI_EXAMPLE_END);
  if (end < start) {
    throw new Error("anti-example markers are out of order");
  }
  const refused = sectionSpan(text, 2, "Exemple de plan refusé");
  if (start < refused.start || end > refused.end) {
    throw new Error("the anti-example block must sit in «Exemple de plan refusé»");
  }
  return { start, end: end + ANTI_EXAMPLE_END.length };
}

/** The `Statut` list item of the header: from its bullet to the next blank line, bullet or heading. */
function statusSpan(text: string): Span {
  const firstH2 = headings(text).find((heading) => heading.level === 2);
  const header = text.slice(0, firstH2?.start ?? text.length);
  const match = /^- \*\*Statut :\*\*.*(?:\n(?!\s*$|- |#).*)*/mu.exec(header);
  if (match === null) {
    throw new Error("header: no «- **Statut :**» item before the first H2");
  }
  return { start: match.index, end: match.index + match[0].length };
}

/** Quoted strings of the example's «Dates imposées» rubric that carry a date. */
function imposedDateQuotes(text: string): string[] {
  const example = sectionSpan(text, 2, "Exemple de plan conforme");
  const rubric = slice(text, sectionSpan(text, 3, "Dates imposées", example));
  const quotes = [...rubric.matchAll(/«[^»]+»/gu)].map((match) => match[0]);
  return quotes.filter((quote) =>
    findMotifs(quote).some((finding) => finding.family === "b" || finding.family === "c"),
  );
}

interface ExemptZone extends Span {
  readonly kind: "status" | "anti-example" | "imposed-date-citation";
}

function exemptZones(text: string): ExemptZone[] {
  const zones: ExemptZone[] = [
    { kind: "status", ...statusSpan(text) },
    { kind: "anti-example", ...antiExampleSpan(text) },
  ];
  const example = sectionSpan(text, 2, "Exemple de plan conforme");
  for (const quote of imposedDateQuotes(text)) {
    let from = example.start;
    for (;;) {
      const at = text.indexOf(quote, from);
      if (at === -1 || at >= example.end) break;
      zones.push({ kind: "imposed-date-citation", start: at, end: at + quote.length });
      from = at + quote.length;
    }
  }
  return zones;
}

/** Blank the exempt zones, keeping offsets and line numbers. */
function maskExempt(text: string): { masked: string; exemptChars: number } {
  // UTF-16 units, the same unit as the offsets of the zones.
  const chars = text.split("");
  let exemptChars = 0;
  for (const zone of exemptZones(text)) {
    for (let index = zone.start; index < zone.end; index += 1) {
      if (chars[index] !== "\n" && chars[index] !== " ") {
        chars[index] = " ";
        exemptChars += 1;
      }
    }
  }
  return { masked: chars.join(""), exemptChars };
}

/** Motifs left once the exempt zones are blanked. */
function violations(text: string): Finding[] {
  return findMotifs(maskExempt(text).masked);
}

/** References the method must not carry: identifiers of the registers, branches, forges, organisations. */
function forbiddenReferences(text: string): string[] {
  const patterns: readonly RegExp[] = [
    /(?<![\p{L}\p{N}-])[ID]-\d+/gu,
    /\bbranch(?:e|es)?\b/giu,
    /origin\/|refs\/heads\//gu,
    /`(?:main|master|develop|trunk)`/gu,
    /https?:\/\//giu,
    /\b(?:github|gitlab|bitbucket|codeberg)\b/giu,
    /@[a-z0-9-]+\/[a-z0-9-]+/giu,
    /libre-ai/giu,
  ];
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));
}

function insertAfter(text: string, anchor: string, addition: string): string {
  const at = indexOfOnce(text, anchor);
  return `${text.slice(0, at + anchor.length)}${addition}${text.slice(at + anchor.length)}`;
}

describe("planning method: source", () => {
  test("the document exists, is tracked by git and is not empty", () => {
    expect(readTracked(DOCUMENT).length).toBeGreaterThan(0);
  });

  test("an unreadable or untracked source is an error, never a pass on nothing", () => {
    expect(() => readTracked("docs/method/PLANNING-absent.md")).toThrow(/not tracked/);
  });
});

describe("planning method: structure", () => {
  const text = readTracked(DOCUMENT);

  test("opens with a Portée / Statut list, and the Portée says «Méthode, pas doctrine»", () => {
    const firstH2 = headings(text).find((heading) => heading.level === 2);
    const header = text.slice(0, firstH2?.start ?? 0);
    const scope = /^- \*\*Portée :\*\*.*(?:\n(?!\s*$|- |#).*)*/mu.exec(header);
    expect(scope).not.toBeNull();
    expect(scope?.[0].replace(/\s+/gu, " ")).toContain("Méthode, pas doctrine");
    const status = statusSpan(text);
    expect(status.start).toBeGreaterThan(scope?.index ?? Number.POSITIVE_INFINITY);
    // Nothing but the title precedes the list: the document opens with it.
    const beforeList = header.slice(0, scope?.index ?? 0).trim();
    expect(beforeList.split("\n")).toHaveLength(1);
    expect(beforeList.startsWith("# ")).toBe(true);
  });

  test("the H2 titles are exactly the six expected ones, in order", () => {
    const titles = headings(text)
      .filter((heading) => heading.level === 2)
      .map((heading) => heading.title);
    expect(titles).toEqual([...EXPECTED_H2]);
  });

  test("the conforming example carries Cible, Phases, Qualité in order, each phase naming its dependency", () => {
    const example = sectionSpan(text, 2, "Exemple de plan conforme");
    const rubrics = headings(text)
      .filter(
        (heading) =>
          heading.level === 3 && heading.start >= example.start && heading.start < example.end,
      )
      .map((heading) => heading.title);
    expect(rubrics.slice(0, PLAN_RUBRICS.length)).toEqual([...PLAN_RUBRICS]);

    const phases = slice(text, sectionSpan(text, 3, "Phases", example));
    const items = phases.split(/\n(?=\d+\. )/u).filter((item) => /^\d+\. /u.test(item));
    expect(items.length).toBeGreaterThanOrEqual(2);
    const silent = items.filter((item) => !/(?<![\p{L}])(?:consomme|car)(?![\p{L}])/u.test(item));
    expect(silent, "phases that name no dependency").toEqual([]);
  });

  test("the imposed date of the example is quoted, tagged, and repeated unchanged in its Phases", () => {
    const example = sectionSpan(text, 2, "Exemple de plan conforme");
    const rubric = slice(text, sectionSpan(text, 3, "Dates imposées", example));
    expect(rubric).toContain(IMPOSED_DATE_MARKER);
    const quotes = imposedDateQuotes(text);
    expect(quotes.length).toBeGreaterThanOrEqual(1);
    const phases = slice(text, sectionSpan(text, 3, "Phases", example));
    for (const quote of quotes) {
      expect(phases).toContain(quote);
    }
  });
});

describe("planning method: forbidden motifs", () => {
  const text = readTracked(DOCUMENT);

  test("no duration, date, time tier or team-size motif outside the exempt zones", () => {
    expect(violations(text)).toEqual([]);
  });

  test("adding «3 semaines» to the Phases rubric is caught (mutation by addition)", () => {
    const mutated = insertAfter(text, "\n## Phases\n", "\nLe module d'import prend 3 semaines.\n");
    expect(violations(mutated).map((finding) => finding.match)).toEqual(["3 semaines"]);
  });

  test.each([
    ["a", "Le magasin demande 4 days de travail."],
    ["b", "Le magasin est livré le 2031-03-15."],
    ["c", "Le magasin est livré en mars 2031."],
    ["d", "À moyen terme, le magasin est séparé."],
    ["d", "Le magasin est prévu en T3."],
    ["e", "Un seul module suffit pour une équipe réduite."],
  ] as const)("family %s is caught outside the exempt zones: %s", (family, sentence) => {
    const mutated = insertAfter(text, "\n## Qualité\n", `\n${sentence}\n`);
    expect(violations(mutated).map((finding) => finding.family)).toEqual([family]);
  });

  test("the refused example is tagged and carries at least one motif of each family", () => {
    const block = slice(text, antiExampleSpan(text));
    const present = new Set(findMotifs(block).map((finding) => finding.family));
    expect([...present].sort()).toEqual(FAMILIES.map((family) => family.id));
  });

  test("no register identifier, branch, forge or organisation reference", () => {
    expect(forbiddenReferences(text)).toEqual([]);
    expect(forbiddenReferences("voir I-40 et D-12, sur la branche `main`")).toEqual([
      "I-40",
      "D-12",
      "branche",
      "`main`",
    ]);
    // An ADR number is not a register identifier.
    expect(forbiddenReferences("ADR-0020")).toEqual([]);
  });
});

describe("planning method: authority map", () => {
  test("docs/README.md carries exactly one table row pointing to the document", () => {
    const rows = readTracked(AUTHORITY_MAP)
      .split("\n")
      .filter((line) => line.startsWith("|") && line.includes(`\`${DOCUMENT}\``));
    expect(rows).toHaveLength(1);
  });
});

describe("planning method: counters", () => {
  test("prints what was inspected, and the counters sum to the document", () => {
    const text = readTracked(DOCUMENT);
    const sections = headings(text).filter((heading) => heading.level === 2).length;
    const zones = exemptZones(text);
    const { masked, exemptChars } = maskExempt(text);
    const total = text.replace(/[\n ]/gu, "").length;
    const scanned = masked.replace(/[\n ]/gu, "").length;
    const patterns = FAMILIES.reduce((sum, family) => sum + family.patterns.length, 0);
    const byKind = (kind: ExemptZone["kind"]): number =>
      zones.filter((zone) => zone.kind === kind).length;

    console.log(
      `planning-method: sections=${sections}/${EXPECTED_H2.length} ` +
        `motif_families=${FAMILIES.length} patterns=${patterns} ` +
        `exempt_zones=${zones.length} (status=${byKind("status")} ` +
        `anti-example=${byKind("anti-example")} ` +
        `imposed-date-citation=${byKind("imposed-date-citation")}) ` +
        `chars: total=${total} scanned=${scanned} exempt=${exemptChars} ` +
        `violations=${violations(text).length}`,
    );

    expect(sections).toBe(EXPECTED_H2.length);
    expect(FAMILIES.map((family) => family.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(byKind("status")).toBe(1);
    expect(byKind("anti-example")).toBe(1);
    expect(byKind("imposed-date-citation")).toBeGreaterThanOrEqual(2);
    expect(scanned).toBeGreaterThan(0);
    expect(scanned + exemptChars).toBe(total);
  });
});
