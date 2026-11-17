import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Structure check of docs/method/GATE-TESTING.md.
 *
 * The note is a method other suites fill in: its section order, the columns of its two tables
 * and its two questions are an interface. Every expected value below comes from the brief of
 * the note, not from the note. Each control is then replayed against a mutated copy of the
 * note (a substitution, exactly one occurrence, different from the original), which is the
 * method the note describes applied to the note itself.
 */

const ROOT: string = resolve(import.meta.dir, "..", "..");
const DOCUMENT: string = "docs/method/GATE-TESTING.md";

const SECTIONS: readonly string[] = [
  "Portée et statut",
  "Faux client à état et journal d'appels",
  "Exécutables réduits à des doublures et environnement purgé",
  "Table de cas",
  "Preuve par mutant",
  "Gardes sans mutant (liste non discriminée)",
  "Les deux questions de chaque test",
  "Instances dans ce dépôt",
];
const MUTANT_SECTION: string = "Preuve par mutant";
const QUESTION_SECTION: string = "Les deux questions de chaque test";

const CASE_HEADER: string =
  "| Nom | État initial | Arguments | Code de sortie attendu | Motif attendu sur la sortie d'erreur | Appels attendus au journal (et appels interdits) |";
const MUTANT_HEADER: string =
  "| Identifiant du mutant | Fichier | Texte décisif remplacé et son remplacement no-op | Cas rouge(s) qui le tuent | Équivalence expliquée (vide si tué) |";

const QUESTION_ONE: string = "1. Quelle erreur concrète fait rougir ce test ?";
const QUESTION_TWO: string =
  "2. Un refactor équivalent, ou un meilleur résultat tout aussi valide, le ferait-il rougir aussi ?";

const NEVER_DELETED: string = "jamais supprimée";
const SAME_AS_ORIGINAL: string = "Un mutant identique à l'original";

const REQUIRED_CITATIONS: readonly string[] = [
  "docs/method/LANGGRAPH-ENTRY-GATES.md",
  "docs/method/MODULE-DESIGN.md",
  "tools/attestation/neutralise-check.ts",
];

// A repository path written in a code span: a known root, path characters, a file extension.
const CITED_PATH: RegExp = /`((?:docs|tools|distribution|ecosystem)\/[\w./-]+\.[a-z]+)`/g;
const MACHINE_LOCAL_PATH: RegExp = /\/(?:Users|home)\/[^/\s]+\//;
const DEFAULT_BRANCH: RegExp = /\b(?:main|master)\b/;
const HOST: RegExp =
  /\b[a-z][a-z0-9+.-]*:\/\/|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|fr|eu|app|cloud)\b/i;
// The two dated measures of other repositories the brief retired.
const RETIRED_NUMBERS: readonly RegExp[] = [
  /\b20\s+mutants?\b/i,
  /\bdix-sept\b/i,
  /\b17\s+scripts?\b/i,
];

type Exists = (path: string) => boolean;

function headings(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line: string): boolean => line.startsWith("## "))
    .map((line: string): string => line.slice(3).trim());
}

/** The body of a level-2 section, up to the next level-2 heading; empty when it is absent. */
function sectionBody(markdown: string, title: string): string {
  const lines: string[] = markdown.split("\n");
  const start: number = lines.indexOf(`## ${title}`);
  if (start === -1) return "";
  const rest: string[] = lines.slice(start + 1);
  const end: number = rest.findIndex((line: string): boolean => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

function citedPaths(markdown: string): string[] {
  const paths: Set<string> = new Set();
  for (const match of markdown.matchAll(CITED_PATH)) {
    const path: string | undefined = match[1];
    if (path !== undefined) paths.add(path);
  }
  return [...paths].sort();
}

/** Every structural problem of the note, by stable identifier; empty when it conforms. */
function problemsOf(markdown: string, exists: Exists): string[] {
  const problems: string[] = [];
  const lines: string[] = markdown.split("\n");

  if (JSON.stringify(headings(markdown)) !== JSON.stringify(SECTIONS)) problems.push("sections");
  if (!lines.includes(CASE_HEADER)) problems.push("case-table-header");
  if (!lines.includes(MUTANT_HEADER)) problems.push("mutant-table-header");

  const questions: string[] = sectionBody(markdown, QUESTION_SECTION).split("\n");
  if (!questions.includes(QUESTION_ONE)) problems.push("question-one");
  if (!questions.includes(QUESTION_TWO)) problems.push("question-two");

  const proof: string = sectionBody(markdown, MUTANT_SECTION);
  if (!proof.includes(NEVER_DELETED)) problems.push("never-deleted");
  if (!proof.includes(SAME_AS_ORIGINAL)) problems.push("differs-from-original");

  const cited: string[] = citedPaths(markdown);
  for (const path of REQUIRED_CITATIONS) {
    if (!cited.includes(path)) problems.push(`not-cited:${path}`);
  }
  for (const path of cited) {
    if (!exists(path)) problems.push(`cited-but-absent:${path}`);
  }

  if (MACHINE_LOCAL_PATH.test(markdown)) problems.push("machine-local-path");
  if (DEFAULT_BRANCH.test(markdown)) problems.push("default-branch-name");
  if (HOST.test(markdown)) problems.push("host-name");
  if (RETIRED_NUMBERS.some((pattern: RegExp): boolean => pattern.test(markdown))) {
    problems.push("retired-number");
  }
  return problems;
}

/** A mutated copy: `from` occurs exactly once and `to` differs from it, or the suite fails. */
function mutate(markdown: string, from: string, to: string): string {
  const first: number = markdown.indexOf(from);
  if (from === to || first === -1 || markdown.indexOf(from, first + 1) !== -1) {
    throw new Error(`a mutation needs exactly one occurrence of, and a change to: ${from}`);
  }
  return markdown.replace(from, (): string => to);
}

const inTree: Exists = (path: string): boolean => existsSync(join(ROOT, path));
const note: string = readFileSync(join(ROOT, DOCUMENT), "utf8");

const heading = (index: number): string => `## ${SECTIONS[index] ?? ""}\n`;
// Assembled from parts: the hygiene gates of this repository scan this file too.
const LOCAL_PATH: string = ["", "Users", "someone", "notes.md"].join("/");
const BRANCH_NAME: string = ["ma", "in"].join("");
const HOST_NAME: string = ["forge", "example", "org"].join(".");
const ANCHOR: string = "Un outil de flotte (un gate";

interface RedCase {
  readonly name: string;
  readonly mutant: (markdown: string) => string;
  readonly exists?: Exists;
  readonly problem: string;
}

const RED_CASES: readonly RedCase[] = [
  {
    name: "a section whose heading is removed",
    mutant: (markdown) => mutate(markdown, heading(3), "Table de cas\n"),
    problem: "sections",
  },
  {
    name: "two sections exchanged",
    mutant: (markdown) =>
      mutate(
        mutate(mutate(markdown, heading(1), "## @@\n"), heading(2), heading(1)),
        "## @@\n",
        heading(2),
      ),
    problem: "sections",
  },
  {
    name: "a section added",
    mutant: (markdown) => mutate(markdown, heading(7), `## Annexe\n\n${heading(7)}`),
    problem: "sections",
  },
  {
    name: "two columns of the case table exchanged",
    mutant: (markdown) =>
      mutate(markdown, "| Nom | État initial | Arguments |", "| Nom | Arguments | État initial |"),
    problem: "case-table-header",
  },
  {
    name: "a column of the mutant table dropped",
    mutant: (markdown) => mutate(markdown, "| Identifiant du mutant | Fichier |", "| Fichier |"),
    problem: "mutant-table-header",
  },
  {
    name: "the first question moved out of its section",
    mutant: (markdown) => `${mutate(markdown, `${QUESTION_ONE}\n`, "")}\n${QUESTION_ONE}\n`,
    problem: "question-one",
  },
  {
    name: "the second question reworded",
    mutant: (markdown) => mutate(markdown, "le ferait-il rougir aussi ?", "le casserait-il ?"),
    problem: "question-two",
  },
  {
    name: "the no-op said to be a deletion",
    mutant: (markdown) => mutate(markdown, NEVER_DELETED, "ou supprimée"),
    problem: "never-deleted",
  },
  {
    name: "the no-op rule moved out of the proof section",
    mutant: (markdown) =>
      `${mutate(markdown, NEVER_DELETED, "jamais retirée")}\n${NEVER_DELETED}\n`,
    problem: "never-deleted",
  },
  {
    name: "a mutant identical to the original no longer refused",
    mutant: (markdown) => mutate(markdown, SAME_AS_ORIGINAL, "Un mutant"),
    problem: "differs-from-original",
  },
  ...REQUIRED_CITATIONS.map(
    (path: string): RedCase => ({
      name: `${path} no longer cited`,
      mutant: (markdown) => mutate(markdown, `\`${path}\``, "une autre note"),
      problem: `not-cited:${path}`,
    }),
  ),
  ...REQUIRED_CITATIONS.map(
    (path: string): RedCase => ({
      name: `${path} cited but absent from the tree`,
      mutant: (markdown) => markdown,
      exists: (candidate: string): boolean => candidate !== path && inTree(candidate),
      problem: `cited-but-absent:${path}`,
    }),
  ),
  {
    name: "a cited path that no file answers",
    mutant: (markdown) => mutate(markdown, ANCHOR, `\`tools/quality/no-such-tool.ts\` ${ANCHOR}`),
    problem: "cited-but-absent:tools/quality/no-such-tool.ts",
  },
  {
    name: "a machine-local path",
    mutant: (markdown) => mutate(markdown, ANCHOR, `${LOCAL_PATH} ${ANCHOR}`),
    problem: "machine-local-path",
  },
  {
    name: "a default branch name written down",
    mutant: (markdown) => mutate(markdown, ANCHOR, `La branche ${BRANCH_NAME}. ${ANCHOR}`),
    problem: "default-branch-name",
  },
  {
    name: "a host name",
    mutant: (markdown) => mutate(markdown, ANCHOR, `Sur ${HOST_NAME}. ${ANCHOR}`),
    problem: "host-name",
  },
  {
    name: "a URL",
    mutant: (markdown) => mutate(markdown, ANCHOR, `Voir https://localhost/x. ${ANCHOR}`),
    problem: "host-name",
  },
  {
    name: "the retired count of mutants",
    mutant: (markdown) => mutate(markdown, ANCHOR, `Bilan : 20 mutants. ${ANCHOR}`),
    problem: "retired-number",
  },
  {
    name: "the retired count of scripts, in words",
    mutant: (markdown) => mutate(markdown, ANCHOR, `Un script sur dix-sept. ${ANCHOR}`),
    problem: "retired-number",
  },
  {
    name: "the retired count of scripts, in digits",
    mutant: (markdown) => mutate(markdown, ANCHOR, `Un des 17 scripts. ${ANCHOR}`),
    problem: "retired-number",
  },
];

describe("docs/method/GATE-TESTING.md", () => {
  test("conforms, and prints what was examined", () => {
    const cited: string[] = citedPaths(note);
    console.log(
      `gate-testing-doc: ${headings(note).length} section(s) of ${SECTIONS.length} expected; ` +
        `${cited.length} cited path(s), ${cited.filter(inTree).length} present; ` +
        `${RED_CASES.length} red case(s)`,
    );
    expect(problemsOf(note, inTree)).toEqual([]);
    expect(headings(note)).toEqual([...SECTIONS]);
    expect(cited).toEqual(expect.arrayContaining([...REQUIRED_CITATIONS]));
  });

  test("an empty document fails every presence control", () => {
    expect(problemsOf("", inTree)).toEqual([
      "sections",
      "case-table-header",
      "mutant-table-header",
      "question-one",
      "question-two",
      "never-deleted",
      "differs-from-original",
      ...REQUIRED_CITATIONS.map((path: string): string => `not-cited:${path}`),
    ]);
  });

  test("a mutation that matches nowhere, twice, or changes nothing is refused", () => {
    expect(() => mutate(note, "no such text anywhere", "x")).toThrow();
    expect(() => mutate(note, "## ", "### ")).toThrow();
    expect(() => mutate(note, NEVER_DELETED, NEVER_DELETED)).toThrow();
  });

  // Each red case is a pair: the note has no problem, its mutant has exactly the one named.
  test.each(
    RED_CASES.map((redCase: RedCase): [string, RedCase] => [redCase.name, redCase]),
  )("red: %s", (_name: string, redCase: RedCase) => {
    const mutant: string = redCase.mutant(note);
    expect(problemsOf(mutant, redCase.exists ?? inTree)).toEqual([redCase.problem]);
  });
});
