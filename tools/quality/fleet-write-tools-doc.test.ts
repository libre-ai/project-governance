import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Structure lock of docs/method/FLEET-WRITE-TOOLS.md. It reads the document,
// the authority map and the tracked tree; it launches no tool and calls no
// network. The expected values below come from the brief of the document
// (eight rules, four exit codes, five tools in service), not from its text.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DOCUMENT_PATH = "docs/method/FLEET-WRITE-TOOLS.md";
const AUTHORITY_MAP_PATH = "docs/README.md";
const HYGIENE_SCRIPT_PATH = "tools/quality/check-context-hygiene.sh";

const RULES = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"] as const;
const EXIT_CODES = ["0", "1", "2", "3"] as const;
const TOOLS_IN_SERVICE = [
  "tools/fleet/bump-generation.ts",
  "tools/fleet/sync-labels.ts",
  "tools/presentation/heal-card-status.ts",
  "tools/presentation/heal-org-readme.ts",
  "tools/security/check-branch-protection.ts",
] as const;
const CELL_VALUES = ["conforme", "écart", "sans objet"] as const;
type CellValue = (typeof CELL_VALUES)[number];

const HYGIENE_EXEMPTION = "allow-local-path";

interface DenyPattern {
  readonly label: string;
  readonly pattern: RegExp;
  /** Whether a line carrying the exemption marker escapes this pattern. */
  readonly exemptible: boolean;
}

type Patterns =
  | { readonly ok: true; readonly patterns: readonly DenyPattern[] }
  | { readonly ok: false; readonly reason: string };

/**
 * The deny patterns of the context-hygiene gate, read from the gate itself so
 * this test never carries them in readable form and cannot drift from them.
 */
function hygienePatterns(script: string): Patterns {
  const encoded = [
    ...script.matchAll(/^(\w+)="\$\(printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d\)"$/gm),
  ];
  const generic = /^generic='([^']+)'/m.exec(script);
  if (encoded.length !== 2 || generic === null) {
    return {
      ok: false,
      reason: `${HYGIENE_SCRIPT_PATH}: expected 2 encoded deny patterns and 1 generic one, found ${encoded.length} and ${generic === null ? 0 : 1}`,
    };
  }
  const patterns: DenyPattern[] = encoded.map((match) => {
    const name = match[1] as string;
    // The gate greps the banned identifier case-insensitively, without exemption.
    const banned = name === "banned";
    return {
      label: `hygiene pattern ${name}`,
      pattern: new RegExp(atob(match[2] as string), banned ? "i" : ""),
      exemptible: !banned,
    };
  });
  patterns.push({
    label: "hygiene pattern generic",
    pattern: new RegExp(generic[1] as string),
    exemptible: true,
  });
  return { ok: true, patterns };
}

// Forge host names, default-branch literals under their usual spellings, and
// the shapes of real credentials. None may appear in the document.
const FORGE_HOST =
  /\b(?:[a-z0-9-]+\.)*(?:github|githubusercontent|gitlab|bitbucket|codeberg|gitea)\.(?:com|org|io)\b/i;
const BRANCH_LITERAL =
  /`(?:main|master|develop|trunk)`|\b(?:main|master):|ref=(?:main|master)\b|refs\/heads\/|origin\/(?:main|master)\b|--(?:branch|base)\s+\S|branch(?:es)?:\s*\[?\s*(?:main|master)\b/;
const TOKEN_SHAPE =
  /\bgh[pousr]_[A-Za-z0-9]{16,}|\bgithub_pat_[A-Za-z0-9_]{10,}|\bglpat-[A-Za-z0-9_-]{10,}|\bBearer\s+[A-Za-z0-9._-]{8,}|\bxox[abp]-[A-Za-z0-9-]{8,}|\bAKIA[0-9A-Z]{16}\b/;

interface Counts {
  readonly rules: number;
  readonly exitCodes: number;
  readonly tools: number;
  readonly cells: number;
  readonly conforme: number;
  readonly ecart: number;
  readonly sansObjet: number;
  readonly explained: number;
  readonly lines: number;
}

interface Report {
  readonly problems: readonly string[];
  readonly counts: Counts;
}

interface Input {
  readonly document: string;
  readonly authorityMap: string;
  readonly tracked: ReadonlySet<string>;
  readonly hygieneScript: string;
}

/** Text of a level-2 section, heading excluded; null when the heading is absent. */
function section(lines: readonly string[], title: string): string[] | null {
  const start = lines.indexOf(`## ${title}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Body rows of the first Markdown table of a section: header and rule dropped. */
function tableRows(lines: readonly string[]): string[][] {
  const first = lines.findIndex((line) => line.startsWith("|"));
  if (first === -1) return [];
  const rest = lines.slice(first);
  const end = rest.findIndex((line) => !line.startsWith("|"));
  const table = end === -1 ? rest : rest.slice(0, end);
  return table.slice(2).map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );
}

const flat = (lines: readonly string[]): string => lines.join(" ").replace(/\s+/g, " ");

function inspect(input: Input): Report {
  const problems: string[] = [];
  const lines = input.document.split("\n");

  // --- header: level-1 title, then the Portée and Statut bullets ------------
  if (!/^# \S/.test(lines[0] ?? ""))
    problems.push("the document does not open with a level-1 title");
  const firstSection = lines.findIndex((line) => line.startsWith("## "));
  const header = lines.slice(1, firstSection === -1 ? lines.length : firstSection);
  const bullets = header.filter((line) => line.startsWith("- "));
  if (!(bullets[0] ?? "").startsWith("- **Portée :**"))
    problems.push("the first bullet under the title is not « Portée »");
  if (!(bullets[1] ?? "").startsWith("- **Statut :**"))
    problems.push("the second bullet under the title is not « Statut »");

  // --- the eight rules -------------------------------------------------------
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^### R\d+\b/.test(line));
  const names = headings.map(({ line }) => (/^### (R\d+)\b/.exec(line) as RegExpExecArray)[1]);
  if (names.join(" ") !== RULES.join(" "))
    problems.push(`rule headings are [${names.join(" ")}], expected [${RULES.join(" ")}]`);
  for (const { line, index } of headings) {
    const rest = lines.slice(index + 1);
    const end = rest.findIndex((next) => next.startsWith("#"));
    const body = (end === -1 ? rest : rest.slice(0, end)).join("").trim();
    if (body === "") problems.push(`rule heading « ${line} » has an empty body`);
  }
  const rulesSection = section(lines, "Les huit règles");
  if (rulesSection === null) problems.push("section « Les huit règles » is missing");
  else if (rulesSection.filter((line) => /^### R\d+\b/.test(line)).length !== headings.length)
    problems.push("a rule heading sits outside the section « Les huit règles »");

  // --- exit codes ------------------------------------------------------------
  const codesSection = section(lines, "Codes de sortie");
  const codes = codesSection === null ? [] : tableRows(codesSection).map((row) => row[0] ?? "");
  if (codesSection === null) problems.push("section « Codes de sortie » is missing");
  else if (codes.join(" ") !== EXIT_CODES.join(" "))
    problems.push(`exit codes are [${codes.join(" ")}], expected [${EXIT_CODES.join(" ")}]`);

  // --- state of the tools in service -----------------------------------------
  const stateSection = section(lines, "État des outils en service");
  const rows = stateSection === null ? [] : tableRows(stateSection);
  if (stateSection === null) problems.push("section « État des outils en service » is missing");
  if (input.tracked.size === 0)
    problems.push("the tracked tree could not be read: no path to check the table against");
  const tally: Record<CellValue, number> = { conforme: 0, écart: 0, "sans objet": 0 };
  const gaps: { tool: string; rule: string }[] = [];
  const tools: string[] = [];
  let cells = 0;
  for (const row of rows) {
    const tool = /^`([^`]+)`$/.exec(row[0] ?? "")?.[1];
    if (tool === undefined) {
      problems.push(`a state row does not open with a backticked path: ${row[0] ?? ""}`);
      continue;
    }
    tools.push(tool);
    if (!input.tracked.has(tool)) problems.push(`${tool} is cited by the table but is not tracked`);
    if (row.length !== RULES.length + 1)
      problems.push(`${tool}: ${row.length - 1} rule cell(s), expected ${RULES.length}`);
    row.slice(1).forEach((cell, index) => {
      cells += 1;
      const rule = RULES[index] ?? `column ${index + 1}`;
      const value = CELL_VALUES.find((candidate) => candidate === cell);
      if (value === undefined) {
        problems.push(`${tool} ${rule}: cell « ${cell} » is none of ${CELL_VALUES.join(", ")}`);
        return;
      }
      tally[value] += 1;
      if (value === "écart") gaps.push({ tool, rule });
    });
  }
  if ([...tools].sort().join(" ") !== [...TOOLS_IN_SERVICE].sort().join(" "))
    problems.push(
      `the table lists [${tools.join(" ")}], expected the five tools in service [${TOOLS_IN_SERVICE.join(" ")}]`,
    );

  // --- every gap is named, with its rule and its path -------------------------
  const items = (stateSection ?? [])
    .map((line) => /^- \*\*(R\d+)\*\* · `([^`]+)` : (.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      rule: match[1] as string,
      tool: match[2] as string,
      text: (match[3] as string).trim(),
    }));
  for (const gap of gaps) {
    const found = items.filter((item) => item.rule === gap.rule && item.tool === gap.tool);
    if (found.length !== 1 || (found[0]?.text ?? "").length < 20)
      problems.push(
        `${gap.tool} ${gap.rule}: cell « écart » without exactly one sentence naming it`,
      );
  }
  for (const item of items) {
    if (!gaps.some((gap) => gap.rule === item.rule && gap.tool === item.tool))
      problems.push(`${item.tool} ${item.rule}: a gap is explained but the cell is not « écart »`);
  }

  // --- what the document does not change --------------------------------------
  const unchanged = section(lines, "Ce que ce document ne change pas");
  const unchangedText = unchanged === null ? "" : flat(unchanged);
  if (unchanged === null) problems.push("section « Ce que ce document ne change pas » is missing");
  if (!/Les outils en service ne changent pas/.test(unchangedText))
    problems.push("no sentence says that the tools in service do not change");
  if (!/Le code 3 ne vaut que pour les outils neufs ou modifiés/.test(unchangedText))
    problems.push("no sentence restricts exit code 3 to new or modified tools");

  // --- nothing machine-local, no forge host, no branch literal, no token ------
  const hygiene = hygienePatterns(input.hygieneScript);
  if (!hygiene.ok) problems.push(hygiene.reason);
  const deny: DenyPattern[] = [
    ...(hygiene.ok ? hygiene.patterns : []),
    { label: "forge host name", pattern: FORGE_HOST, exemptible: false },
    { label: "hardcoded branch name", pattern: BRANCH_LITERAL, exemptible: false },
    { label: "token-shaped string", pattern: TOKEN_SHAPE, exemptible: false },
  ];
  lines.forEach((line, index) => {
    for (const { label, pattern, exemptible } of deny) {
      if (exemptible && line.includes(HYGIENE_EXEMPTION)) continue;
      if (pattern.test(line)) problems.push(`line ${index + 1}: ${label}`);
    }
  });

  // --- the authority map cites the document -----------------------------------
  const mapLine = input.authorityMap
    .split("\n")
    .filter((line) => line.startsWith("|") && line.includes(`\`${DOCUMENT_PATH}\``));
  if (mapLine.length !== 1)
    problems.push(
      `${AUTHORITY_MAP_PATH} cites ${DOCUMENT_PATH} on ${mapLine.length} table line(s), expected 1`,
    );
  else if (!mapLine[0]?.startsWith("| Outils d'écriture de flotte (contrat) "))
    problems.push(
      `${AUTHORITY_MAP_PATH}: the line citing ${DOCUMENT_PATH} does not carry its subject`,
    );

  return {
    problems,
    counts: {
      rules: headings.length,
      exitCodes: codes.length,
      tools: tools.length,
      cells,
      conforme: tally.conforme,
      ecart: tally.écart,
      sansObjet: tally["sans objet"],
      explained: items.length,
      lines: lines.length,
    },
  };
}

function trackedPaths(): Set<string> {
  const result = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: ROOT, stdout: "pipe" });
  if (result.exitCode !== 0) return new Set();
  return new Set(
    new TextDecoder()
      .decode(result.stdout)
      .split("\0")
      .filter((path) => path !== ""),
  );
}

const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

const REAL: Input = {
  document: read(DOCUMENT_PATH),
  authorityMap: read(AUTHORITY_MAP_PATH),
  tracked: trackedPaths(),
  hygieneScript: read(HYGIENE_SCRIPT_PATH),
};

const problemsOf = (change: Partial<Input>): readonly string[] =>
  inspect({ ...REAL, ...change }).problems;

/** The document with one edit; the edit must change it, or the mutation proves nothing. */
function mutated(edit: (document: string) => string): string {
  const after = edit(REAL.document);
  if (after === REAL.document) throw new Error("the mutation left the document unchanged");
  return after;
}

const dropRule = (document: string, rule: string): string => {
  const lines = document.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`### ${rule} `));
  if (start === -1) return document;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("#"));
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
};

describe("docs/method/FLEET-WRITE-TOOLS.md", () => {
  test("holds its structure, and the counters sum to the cells examined", () => {
    const report = inspect(REAL);
    expect(report.problems).toEqual([]);
    const { counts } = report;
    expect(counts.rules).toBe(8);
    expect(counts.exitCodes).toBe(4);
    expect(counts.tools).toBe(5);
    expect(counts.cells).toBe(40);
    expect(counts.conforme + counts.ecart + counts.sansObjet).toBe(counts.cells);
    expect(counts.explained).toBe(counts.ecart);
    console.log(
      `Fleet write tools document verified: ${counts.lines} line(s) read, ${counts.rules} rule(s), ` +
        `${counts.exitCodes} exit code(s), ${counts.tools} tool(s), ${counts.cells} cell(s) = ` +
        `${counts.conforme} conforme + ${counts.ecart} écart + ${counts.sansObjet} sans objet, ` +
        `${counts.explained} gap(s) explained, ${REAL.tracked.size} tracked path(s)`,
    );
  });

  test("the five tools of the table are tracked files", () => {
    for (const tool of TOOLS_IN_SERVICE) expect(REAL.tracked.has(tool)).toBe(true);
  });
});

describe("the lock goes red on each defect it exists for", () => {
  test("a title that is not level 1", () => {
    const document = mutated((text) => text.replace(/^# /, "## "));
    expect(problemsOf({ document })).toContain("the document does not open with a level-1 title");
  });

  test("a missing Portée bullet", () => {
    const document = mutated((text) => text.replace("- **Portée :**", "- **Objet :**"));
    expect(problemsOf({ document })).toContain(
      "the first bullet under the title is not « Portée »",
    );
  });

  test("a missing Statut bullet", () => {
    const document = mutated((text) => text.replace("- **Statut :**", "- **État :**"));
    expect(problemsOf({ document })).toContain(
      "the second bullet under the title is not « Statut »",
    );
  });

  test("R5 removed", () => {
    const document = mutated((text) => dropRule(text, "R5"));
    expect(problemsOf({ document })).toContain(
      "rule headings are [R1 R2 R3 R4 R6 R7 R8], expected [R1 R2 R3 R4 R5 R6 R7 R8]",
    );
  });

  test("two rules out of order", () => {
    const document = mutated((text) =>
      text
        .replace("### R1 ", "### R0 ")
        .replace("### R2 ", "### R1 ")
        .replace("### R0 ", "### R2 "),
    );
    expect(problemsOf({ document })).toContain(
      "rule headings are [R2 R1 R3 R4 R5 R6 R7 R8], expected [R1 R2 R3 R4 R5 R6 R7 R8]",
    );
  });

  test("a rule with an empty body", () => {
    const heading = REAL.document.split("\n").find((line) => line.startsWith("### R4 ")) as string;
    const document = mutated(
      (text) => `${dropRule(text, "R4").replace("### R5 ", `${heading}\n\n### R5 `)}`,
    );
    expect(problemsOf({ document })).toContain(`rule heading « ${heading} » has an empty body`);
  });

  test("a fifth exit code", () => {
    const document = mutated((text) => text.replace("\n| 3 | ", "\n| 4 | Autre |\n| 3 | "));
    expect(problemsOf({ document })).toContain("exit codes are [0 1 2 4 3], expected [0 1 2 3]");
  });

  test("an exit code removed", () => {
    const document = mutated((text) => text.replace(/\n\| 3 \|[^\n]*/, ""));
    expect(problemsOf({ document })).toContain("exit codes are [0 1 2], expected [0 1 2 3]");
  });

  test("a table path that is not tracked", () => {
    const document = mutated((text) =>
      text.replace("| `tools/fleet/sync-labels.ts` |", "| `tools/fleet/absent-tool.ts` |"),
    );
    expect(problemsOf({ document })).toContain(
      "tools/fleet/absent-tool.ts is cited by the table but is not tracked",
    );
  });

  test("a tracked tree that could not be read", () => {
    expect(problemsOf({ tracked: new Set() })).toContain(
      "the tracked tree could not be read: no path to check the table against",
    );
  });

  test("a tool of the five missing from the table", () => {
    const document = mutated((text) =>
      text.replace(/\n\| `tools\/fleet\/sync-labels\.ts` \|[^\n]*/, ""),
    );
    expect(
      problemsOf({ document }).some((problem) => problem.startsWith("the table lists [")),
    ).toBe(true);
  });

  test("a cell outside the three values", () => {
    const document = mutated((text) =>
      text.replace(
        "| `tools/fleet/sync-labels.ts` | conforme |",
        "| `tools/fleet/sync-labels.ts` | partiel |",
      ),
    );
    expect(problemsOf({ document })).toContain(
      "tools/fleet/sync-labels.ts R1: cell « partiel » is none of conforme, écart, sans objet",
    );
  });

  test("a gap without its sentence", () => {
    const document = mutated((text) =>
      text.replace(/\n- \*\*R3\*\* · `tools\/security\/check-branch-protection\.ts` : [^\n]*/, ""),
    );
    expect(problemsOf({ document })).toContain(
      "tools/security/check-branch-protection.ts R3: cell « écart » without exactly one sentence naming it",
    );
  });

  test("a sentence left behind for a cell that is no longer a gap", () => {
    const document = mutated((text) =>
      text.replace(
        "| `tools/presentation/heal-card-status.ts` | écart |",
        "| `tools/presentation/heal-card-status.ts` | conforme |",
      ),
    );
    expect(problemsOf({ document })).toContain(
      "tools/presentation/heal-card-status.ts R1: a gap is explained but the cell is not « écart »",
    );
  });

  test("the sentence on the tools in service removed", () => {
    const document = mutated((text) =>
      text.replace("Les outils en service ne changent pas", "Les outils en service évoluent"),
    );
    expect(problemsOf({ document })).toContain(
      "no sentence says that the tools in service do not change",
    );
  });

  test("the sentence on exit code 3 removed", () => {
    const document = mutated((text) =>
      text.replace("Le code 3 ne vaut que pour", "Le code 3 vaut aussi pour"),
    );
    expect(problemsOf({ document })).toContain(
      "no sentence restricts exit code 3 to new or modified tools",
    );
  });

  // The offending strings are assembled here so this file carries none of them.
  const lastLine = REAL.document.split("\n").length;
  const appended = (text: string): string => mutated((document) => `${document}${text}`);

  test("a machine-local path", () => {
    const document = appended(["", "Users", "someone", "work"].join("/"));
    expect(problemsOf({ document })).toContain(`line ${lastLine}: hygiene pattern generic`);
  });

  test("a forge host name", () => {
    const document = appended(["https://api", "github", "com/repos"].join("."));
    expect(problemsOf({ document })).toContain(`line ${lastLine}: forge host name`);
  });

  test("a hardcoded branch name", () => {
    const document = appended(`lire ${"`"}${"ma"}in${"`"}`);
    expect(problemsOf({ document })).toContain(`line ${lastLine}: hardcoded branch name`);
  });

  test("a token-shaped string", () => {
    const document = appended(`${"gh"}p_${"a".repeat(36)}`);
    expect(problemsOf({ document })).toContain(`line ${lastLine}: token-shaped string`);
  });

  test("a hygiene gate whose patterns can no longer be read", () => {
    const hygieneScript = REAL.hygieneScript.replace(/base64 -d/g, "base64 --decode");
    expect(hygieneScript).not.toBe(REAL.hygieneScript);
    expect(problemsOf({ hygieneScript })).toContain(
      `${HYGIENE_SCRIPT_PATH}: expected 2 encoded deny patterns and 1 generic one, found 0 and 1`,
    );
  });

  test("an authority map that does not cite the document", () => {
    const authorityMap = REAL.authorityMap.replace(
      `\`${DOCUMENT_PATH}\``,
      "`docs/method/AUTRE.md`",
    );
    expect(authorityMap).not.toBe(REAL.authorityMap);
    expect(problemsOf({ authorityMap })).toContain(
      `${AUTHORITY_MAP_PATH} cites ${DOCUMENT_PATH} on 0 table line(s), expected 1`,
    );
  });
});
