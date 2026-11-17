import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

// Structure check of docs/method/HARNESS-ADAPTERS.md. The document is method,
// held by review; what a machine can hold is its shape: sections, the adapter
// table, the paths and the invariant it cites, and the absence of any volatile
// fact. The expected values below come from the lot's brief, not from the
// document: a reordered table or a dropped section must redden, not re-baseline.

const REPO_ROOT = join(import.meta.dir, "..", "..");
const DOC_PATH = "docs/method/HARNESS-ADAPTERS.md";
const INVARIANTS_PATH = "docs/decisions/INVARIANTS.md";

const SECTIONS = [
  "Portée",
  "Couches de documentation",
  "Ordre des adaptateurs",
  "Règle de revue",
  "Commande d'installation rejouée",
  "Ce que ce document ne fait pas",
] as const;

// Least demanding of the harness first.
const ADAPTERS = [
  /hook à l'édition/i,
  /brief injecté dans le prompt d'un sous-agent/i,
  /rendu de session/i,
  /protocole d'outils \(MCP\)/i,
] as const;

const ADAPTER_SECTION = "Ordre des adaptateurs";
const INSTALL_SECTION = "Commande d'installation rejouée";
const INSTALL_INVARIANT = "I-38";
// The only place where the word "brique" may name something: the map, named
// together with its decision. The decision elsewhere in the paragraph exempts nothing.
const BRICK_MAP_REFERENCE = /carte\s+des\s+briques\s*\(ADR-0064\)/gi;
const BRICK_WORD = /\bbriques?\b/i;

// French numerals are compositional: the word closest to the noun is enough to
// recognise a count ("vingt-deux", "quatre-vingts", "vingt et un", "cent").
// "un"/"une" alone is an article, and "et une" a conjunction: they count only
// after a tens word ("vingt et un").
const COUNT_WORDS = [
  "deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize",
  "vingts?|trente|quarante|cinquante|soixante|cents?|milles?",
  "(?:vingt|trente|quarante|cinquante|soixante)[-\\s]+et[-\\s]+une?",
].join("|");
const COUNTED_COLLECTION = new RegExp(`\\b(?:\\d+|${COUNT_WORDS})\\s+(?:skills?|plugins?)\\b`, "i");
const CALENDAR_DURATION = new RegExp(
  `\\b(?:\\d+|une?|${COUNT_WORDS}|quelques|plusieurs)\\s+(?:secondes?|minutes?|heures?|jours?|semaines?|mois|trimestres?|ans?|années?)\\b`,
  "i",
);
// Default-branch names and ref forms. "main" is also a French noun: the
// document words itself around it rather than weakening the check.
const BRANCH_NAME = /\b(?:main|master|trunk|develop)\b|refs\/heads\/|\borigin\//;
const THIRD_PARTY = /\b(?:Anthropic|OpenAI|Google|Microsoft|GitHub|GitLab|Mistral)\b/i;
// Identifiers of the registry and of decisions carry digits without being a count.
const IDENTIFIER = /\b(?:I-\d+|ADR-\d{4})\b/g;
const RANK_CELL = /^\|\s*\d+\s*\|/;

type FindingCode =
  | "title"
  | "sections"
  | "adapter-table"
  | "cited-path"
  | "invariant"
  | "volatile"
  | "brique"
  | "duration"
  | "third-party";

interface Finding {
  code: FindingCode;
  detail: string;
}

interface Sources {
  /** Text of the invariant registry. */
  invariants: string;
  /** Whether a repository-relative path exists. */
  pathExists: (path: string) => boolean;
}

function proseLines(markdown: string): string[] {
  const kept: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) kept.push(line);
  }
  return kept;
}

function headings(markdown: string, marker: "# " | "## "): string[] {
  return proseLines(markdown)
    .filter((line) => line.startsWith(marker))
    .map((line) => line.slice(marker.length).trim());
}

function sectionLines(markdown: string, title: string): string[] {
  const lines = proseLines(markdown);
  const start = lines.indexOf(`## ${title}`);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

function tableRows(lines: string[]): string[][] {
  const rows = lines
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
  // Drop the header and its separator; what remains is data.
  return rows.slice(1).filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
}

function citedPaths(markdown: string): string[] {
  const spans = [...markdown.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
  return spans.filter((span) => span.includes("/") && !/\s/.test(span));
}

function evaluateDocument(markdown: string, sources: Sources): Finding[] {
  const findings: Finding[] = [];
  const add = (code: FindingCode, detail: string): void => {
    findings.push({ code, detail });
  };

  const titles = headings(markdown, "# ");
  if (titles.length !== 1) add("title", `${titles.length} level-1 title(s), expected 1`);

  const sections = headings(markdown, "## ");
  if (sections.join("\n") !== SECTIONS.join("\n")) {
    add("sections", `found [${sections.join(" ; ")}]`);
  }

  const rows = tableRows(sectionLines(markdown, ADAPTER_SECTION));
  if (rows.length !== ADAPTERS.length) {
    add("adapter-table", `${rows.length} row(s), expected ${ADAPTERS.length}`);
  }
  rows.forEach((cells, index) => {
    const rank = index + 1;
    if (cells.length !== 3 || cells.some((cell) => cell === "")) {
      add("adapter-table", `row ${rank}: expected three non-empty columns`);
      return;
    }
    const expected = ADAPTERS[index];
    if (cells[0] !== String(rank) || expected === undefined || !expected.test(cells[1] ?? "")) {
      add("adapter-table", `row ${rank}: rank "${cells[0]}", adapter "${cells[1]}"`);
    }
  });

  // A path cited twice is asked once: one missing file is one finding.
  for (const path of new Set(citedPaths(markdown))) {
    if (!sources.pathExists(path)) add("cited-path", path);
  }

  if (!sectionLines(markdown, INSTALL_SECTION).join("\n").includes(INSTALL_INVARIANT)) {
    add("invariant", `${INSTALL_INVARIANT} is not cited under "${INSTALL_SECTION}"`);
  }
  for (const id of new Set(markdown.match(/\bI-\d+\b/g) ?? [])) {
    const registered = sources.invariants.split("\n").some((line) => line.startsWith(`| ${id} |`));
    if (!registered) add("invariant", `${id} is not a row of ${INVARIANTS_PATH}`);
  }

  // The brief's wording criteria cover the whole document, fenced blocks
  // included: a command in a block asserts a version or a branch as much as prose.
  for (const line of markdown.split("\n")) {
    const bare = line.replace(RANK_CELL, "|").replace(IDENTIFIER, "");
    if (/\d/.test(bare)) add("volatile", `digit outside an identifier: ${line.trim()}`);
    if (COUNTED_COLLECTION.test(line)) add("volatile", `counted collection: ${line.trim()}`);
    if (BRANCH_NAME.test(line)) add("volatile", `branch name: ${line.trim()}`);
    if (CALENDAR_DURATION.test(line)) add("duration", line.trim());
    if (THIRD_PARTY.test(line)) add("third-party", line.trim());
  }

  // Paths in code spans are names, not wording; the map reference may wrap a line.
  const wording = markdown.replace(/`[^`\n]+`/g, "").replace(BRICK_MAP_REFERENCE, "");
  for (const line of wording.split("\n")) {
    if (BRICK_WORD.test(line)) add("brique", line.trim().slice(0, 80));
  }

  return findings;
}

// A missing document or registry throws here and fails the file: an unreadable
// source is never an empty one.
const DOCUMENT = readFileSync(join(REPO_ROOT, DOC_PATH), "utf8");
// A repository path is one git tracks: the disk also answers for "../…" and for
// ignored files. A failing or empty listing throws, never reads as "nothing exists".
const TRACKED = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((path) => path !== "");
if (TRACKED.length === 0) throw new Error("git listed no tracked file");
const TRACKED_SET = new Set(TRACKED);
const SOURCES: Sources = {
  invariants: readFileSync(join(REPO_ROOT, INVARIANTS_PATH), "utf8"),
  pathExists: (path) => {
    if (TRACKED_SET.has(path)) return true;
    const directory = path.endsWith("/") ? path : `${path}/`;
    return TRACKED.some((tracked) => tracked.startsWith(directory));
  },
};

function codes(markdown: string): FindingCode[] {
  return [...new Set(evaluateDocument(markdown, SOURCES).map((finding) => finding.code))];
}

function replaced(search: string, replacement: string): string {
  // A mutation that changes nothing would prove nothing.
  expect(DOCUMENT).toContain(search);
  return DOCUMENT.replace(search, replacement);
}

function rowOf(rank: number): string {
  const row = DOCUMENT.split("\n").find((line) => line.startsWith(`| ${rank} |`));
  if (row === undefined) throw new Error(`no adapter row of rank ${rank}`);
  return row;
}

describe("the delivered document", () => {
  test("holds every structural rule", () => {
    expect(evaluateDocument(DOCUMENT, SOURCES)).toEqual([]);
  });

  test("the checks had something to read", () => {
    expect(headings(DOCUMENT, "## ")).toHaveLength(SECTIONS.length);
    expect(tableRows(sectionLines(DOCUMENT, ADAPTER_SECTION))).toHaveLength(ADAPTERS.length);
    const paths = citedPaths(DOCUMENT);
    for (const expected of [
      "docs/method/SKILLS-ANATOMY.md",
      "skills/README.md",
      "tools/skills/build-skills-manifest.ts",
      "ecosystem/briques.ts",
      INVARIANTS_PATH,
    ]) {
      expect(paths).toContain(expected);
    }
  });
});

describe("title and sections", () => {
  test("a second level-1 title", () => {
    expect(codes(`${DOCUMENT}\n# Autre titre\n`)).toEqual(["title"]);
  });

  test("a removed section", () => {
    expect(codes(replaced("## Règle de revue\n", ""))).toEqual(["sections"]);
  });

  test("two sections in the wrong order", () => {
    const swapped = replaced("## Portée\n", "## @@\n")
      .replace("## Couches de documentation\n", "## Portée\n")
      .replace("## @@\n", "## Couches de documentation\n");
    expect(codes(swapped)).toEqual(["sections"]);
  });

  test("a section the brief does not list", () => {
    expect(codes(`${DOCUMENT}\n## Annexe\n`)).toEqual(["sections"]);
  });
});

describe("adapter table", () => {
  test("two rows permuted, ranks kept with their rows", () => {
    const first = rowOf(1);
    const second = rowOf(2);
    const permuted = DOCUMENT.replace(`${first}\n${second}`, `${second}\n${first}`);
    expect(permuted).not.toBe(DOCUMENT);
    expect(codes(permuted)).toEqual(["adapter-table"]);
  });

  test("two adapters exchanged under unchanged ranks", () => {
    const third = rowOf(3).replace("| 3 |", "| 4 |");
    const fourth = rowOf(4).replace("| 4 |", "| 3 |");
    const exchanged = DOCUMENT.replace(`${rowOf(3)}\n${rowOf(4)}`, `${fourth}\n${third}`);
    expect(exchanged).not.toBe(DOCUMENT);
    expect(codes(exchanged)).toEqual(["adapter-table"]);
  });

  test("a removed row", () => {
    expect(codes(replaced(`${rowOf(4)}\n`, ""))).toEqual(["adapter-table"]);
  });

  test("a fifth row", () => {
    const extra = `${rowOf(4)}\n| 5 | Autre voie | Autre exigence |`;
    expect(codes(replaced(rowOf(4), extra))).toEqual(["adapter-table"]);
  });

  test("an empty column", () => {
    const row = rowOf(2);
    const emptied = `${row.slice(0, row.indexOf("|", 6) + 1)}  |`;
    expect(codes(replaced(row, emptied))).toEqual(["adapter-table"]);
  });
});

describe("citations", () => {
  test("a path that does not exist", () => {
    expect(codes(`${DOCUMENT}\nVoir \`docs/method/ABSENT.md\`.\n`)).toEqual(["cited-path"]);
  });

  test("every cited path is asked of the repository", () => {
    expect(codes(DOCUMENT)).toEqual([]);
    const none: Sources = { ...SOURCES, pathExists: () => false };
    const refused = evaluateDocument(DOCUMENT, none).filter((f) => f.code === "cited-path");
    expect(refused.map((f) => f.detail).sort()).toEqual([...new Set(citedPaths(DOCUMENT))].sort());
  });

  // The repository is what git tracks: a path that only resolves on this disk
  // (outside the root, or ignored) is not a repository path.
  test.each([
    ["a path climbing out of the root", `../${basename(REPO_ROOT)}/package.json`],
    ["a path climbing back into the root", "tools/../package.json"],
    ["an ignored path present on disk", "node_modules/typescript/package.json"],
  ])("%s", (_name, path) => {
    // The worktree's own name may carry digits: only the path finding is asked here.
    const cited = evaluateDocument(`${DOCUMENT}\nVoir \`${path}\`.\n`, SOURCES)
      .filter((finding) => finding.code === "cited-path")
      .map((finding) => finding.detail);
    expect(cited).toEqual([path]);
  });

  test("a command is not a path", () => {
    expect(citedPaths("`bun run check:skills-manifest` et `a/b c`")).toEqual([]);
  });

  test("the install section no longer cites I-38", () => {
    const [before, after] = DOCUMENT.split(`## ${INSTALL_SECTION}\n`);
    const cut = `${before}## ${INSTALL_SECTION}\n${(after ?? "").replace("I-38", "l'invariant")}`;
    expect(cut).not.toBe(DOCUMENT);
    expect(codes(cut)).toEqual(["invariant"]);
  });

  test("an invariant the registry does not carry", () => {
    const empty: Sources = { ...SOURCES, invariants: "| ID | Invariant |\n| I-3 | Autre |\n" };
    expect(evaluateDocument(DOCUMENT, empty)).toEqual([
      { code: "invariant", detail: `I-38 is not a row of ${INVARIANTS_PATH}` },
    ]);
  });
});

describe("volatile facts and wording", () => {
  test.each([
    ["a count of skills", "La collection porte huit skills.", "volatile"],
    ["a count of plugins", "Le catalogue liste 2 plugins.", "volatile"],
    ["a version", "Rejouée sur la version 1.4.0.", "volatile"],
    ["a branch name", "La branche main sert le catalogue.", "volatile"],
    ["a ref", "Lire origin/HEAD.", "volatile"],
    ["a calendar duration", "Le rejeu vaut trois semaines.", "duration"],
    ["a third-party organisation", "Le harnais de Anthropic.", "third-party"],
    ["the document's object named a brique", "Cette brique s'installe ainsi.", "brique"],
    ["a count past twelve", "La collection porte vingt skills.", "volatile"],
    ["a compound count", "Le catalogue liste vingt-deux plugins.", "volatile"],
    ["a count in hundreds", "La collection porte cent skills.", "volatile"],
    ["a count joined by et", "Le catalogue liste vingt et un plugins.", "volatile"],
  ] as const)("%s", (_name, sentence, code) => {
    expect(codes(`${DOCUMENT}\n${sentence}\n`)).toEqual([code]);
  });

  // The brief's criteria cover the whole document: a fenced block is still
  // something the document asserts.
  test.each([
    ["a version in a fenced block", "```sh\nbun add pkg@1.4.0\n```", "volatile"],
    ["a branch in a fenced block", "```sh\ngit push origin main\n```", "volatile"],
    ["a count in a fenced block", "```\nhuit skills\n```", "volatile"],
    ["a duration in a fenced block", "```\nrejeu en trois semaines\n```", "duration"],
    ["a third party in a fenced block", "```\ncompte GitHub requis\n```", "third-party"],
    ["a brique in a fenced block", "```\ncette brique\n```", "brique"],
  ] as const)("%s", (_name, block, code) => {
    expect(codes(`${DOCUMENT}\n${block}\n`)).toEqual([code]);
  });

  test("a decision cited in the same paragraph does not exempt another brique", () => {
    const paragraph =
      "La carte des briques (ADR-0064) décrit l'unité ; cette brique s'installe ainsi.";
    expect(codes(`${DOCUMENT}\n${paragraph}\n`)).toEqual(["brique"]);
    expect(codes(`${DOCUMENT}\nCette brique relève de ADR-0064.\n`)).toEqual(["brique"]);
  });

  test("a word that is not a count does not read as one", () => {
    expect(codes(`${DOCUMENT}\nLa liste des skills et une skill de plus.\n`)).toEqual([]);
  });

  test("identifiers and table ranks are not counts", () => {
    expect(codes(`${DOCUMENT}\nVoir ADR-0056 et I-38.\n`)).toEqual([]);
  });

  test("the brick map is named only next to its decision", () => {
    expect(codes(`${DOCUMENT}\nLa carte des briques (ADR-0064) décrit l'unité.\n`)).toEqual([]);
    expect(codes(`${DOCUMENT}\nLa carte des briques décrit l'unité.\n`)).toEqual(["brique"]);
  });

  test("a fenced block is not prose", () => {
    expect(headings("```\n# pas un titre\n```\n# Titre\n", "# ")).toEqual(["Titre"]);
  });
});
