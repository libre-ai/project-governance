import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";

/**
 * Structure of the ADR template (docs/method/ADR-TEMPLATE.md).
 *
 * The template is a method document an author copies: nothing else reads it,
 * so nothing else notices when a rubric is dropped or when the empirical
 * verification slides below the decision it is supposed to precede. This test
 * is that reader. The expected lists below come from the lot brief (header
 * lines, sections, labels), not from the current text of the template.
 *
 * What a reviewer still judges on a real ADR (a measure without a date or a
 * command, a false premise) is not automatable on a document and is not
 * claimed here.
 *
 * Reads tracked files by relative path, spawns grep, git and the doctrine
 * governance script read-only; writes nothing, no network.
 */

const TEMPLATE_PATH = "docs/method/ADR-TEMPLATE.md";
const GOVERNANCE_SCRIPT = "tools/quality/check-doctrine-governance.sh";
const AUTHORITY_MAP = "docs/README.md";
const ADR_DIRECTORY = "docs/adr";

const TITLE = /^# ADR-NNNN — \S/;
const HEADER_ORDER = ["Statut", "Arbitrage", "Date", "Connexes", "Invariants"];
/** Recent ADRs write "Date de rédaction"; the brief accepts both spellings. */
const HEADER_ALIASES: Readonly<Record<string, string>> = { "Date de rédaction": "Date" };
const SECTION_ORDER = [
  "Vérification empirique",
  "Contexte",
  "Décision",
  "Conséquences",
  "Alternatives rejetées",
  "Vérification",
];
const EMPIRICAL_LABELS = [
  "**Commande :**",
  "**Date de rejeu :**",
  "**Sortie attendue :**",
  "**Documentation :**",
  "**Date de consultation :**",
  "Non applicable",
  "**Motif :**",
  "inféré",
];

const COMMENT = /<!--[\s\S]*?-->/g;

/** The text an author keeps once the guidance comments are removed. */
function visible(text: string): string {
  return text.replace(COMMENT, "");
}

/** The guidance comments alone: usage rules and the optional replacement blocks. */
function commented(text: string): string {
  return (text.match(COMMENT) ?? []).join("\n");
}

function headerLabels(text: string): string[] {
  const lines = visible(text).split("\n");
  const firstSection = lines.findIndex((line) => line.startsWith("## "));
  const head = firstSection === -1 ? lines : lines.slice(0, firstSection);
  const labels: string[] = [];
  for (const line of head) {
    const label = /^- \*\*(.+?) :\*\*/.exec(line)?.[1];
    if (label !== undefined) labels.push(HEADER_ALIASES[label] ?? label);
  }
  return labels;
}

function sectionTitles(text: string): string[] {
  const titles: string[] = [];
  for (const line of visible(text).split("\n")) {
    const title = /^## (.+?)\s*$/.exec(line)?.[1];
    if (title !== undefined) titles.push(title);
  }
  return titles;
}

/** Every way the visible skeleton departs from the brief; empty when it conforms. */
function structureViolations(text: string): string[] {
  const violations: string[] = [];
  const firstLine = text.split("\n")[0] ?? "";
  if (!TITLE.test(firstLine)) {
    violations.push(`first line is not an unnumbered «# ADR-NNNN — …» title: «${firstLine}»`);
  }
  const required = headerLabels(text).filter((label) => HEADER_ORDER.includes(label));
  if (required.join(" > ") !== HEADER_ORDER.join(" > ")) {
    violations.push(
      `header lines are «${required.join(" > ")}», expected «${HEADER_ORDER.join(" > ")}»`,
    );
  }
  const sections = sectionTitles(text);
  if (sections.join(" > ") !== SECTION_ORDER.join(" > ")) {
    violations.push(
      `sections are «${sections.join(" > ")}», expected «${SECTION_ORDER.join(" > ")}»`,
    );
  }
  return violations;
}

/** Raw text of one section, guidance comments included, up to the next heading. */
function sectionBody(text: string, title: string, nextTitle: string): string {
  const start = text.indexOf(`\n## ${title}\n`);
  const end = text.indexOf(`\n## ${nextTitle}\n`);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`cannot slice «${title}» up to «${nextTitle}» in ${TEMPLATE_PATH}`);
  }
  return text.slice(start, end);
}

function replaceOnce(text: string, search: string, replacement: string): string {
  if (text.split(search).length !== 2) {
    throw new Error(`mutation needs exactly one «${search}» in ${TEMPLATE_PATH}`);
  }
  return text.replace(search, replacement);
}

function swapHeadings(text: string, first: string, second: string): string {
  const placeholder = "\n## @@swap@@\n";
  const step = replaceOnce(text, `\n## ${first}\n`, placeholder);
  return replaceOnce(step, `\n## ${second}\n`, `\n## ${first}\n`).replace(
    placeholder,
    `\n## ${second}\n`,
  );
}

async function loadTemplate(): Promise<string> {
  return await Bun.file(TEMPLATE_PATH).text();
}

interface DenyList {
  readonly name: string;
  readonly pattern: string;
  readonly ignoreCase: boolean;
}

/**
 * The three deny-lists of the governance script, read where they execute and
 * never copied here: a motif added to the script applies to the template on the
 * next run. A marker that is absent or ambiguous is an error, not an empty list.
 */
async function loadDenyLists(): Promise<DenyList[]> {
  const script = await Bun.file(GOVERNANCE_SCRIPT).text();
  const markers: ReadonlyArray<readonly [string, RegExp, boolean]> = [
    ["superseded", /\bsuperseded="([^"]+)"/g, false],
    ["preventive", /\bpreventive="([^"]+)"/g, false],
    ["retired brands", /matches=\$\(grep -rniE '([^']+)'/g, true],
  ];
  return markers.map(([name, marker, ignoreCase]) => {
    const found = [...script.matchAll(marker)];
    const pattern = found[0]?.[1];
    if (found.length !== 1 || pattern === undefined) {
      throw new Error(
        `${GOVERNANCE_SCRIPT}: expected one «${name}» deny-list, found ${found.length}`,
      );
    }
    return { name, pattern, ignoreCase };
  });
}

function grepArgs(list: DenyList, flags: string): string[] {
  return ["grep", `-${flags}E${list.ignoreCase ? "i" : ""}`, list.pattern];
}

/** Evaluated by the gate's own engine (grep -E): 0 match, 1 none, anything else is an error. */
function denyListHits(list: DenyList, text: string): boolean {
  const result = Bun.spawnSync(grepArgs(list, "q"), { stdin: Buffer.from(text) });
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`grep -E rejected the «${list.name}» deny-list: ${result.stderr.toString()}`);
  }
  return result.exitCode === 0;
}

/**
 * A string the deny-list really forbids, taken from the tracked files that are
 * allowed to cite it (and from the script itself), so the control below proves
 * detection without spelling a motif out in this file.
 */
function forbiddenSample(list: DenyList): string {
  const tracked = Bun.spawnSync(["git", "ls-files", "--", "*.md", GOVERNANCE_SCRIPT]);
  const files = tracked.stdout.toString().trim().split("\n").filter(Boolean);
  if (tracked.exitCode !== 0 || files.length === 0) {
    throw new Error(`git ls-files listed no file to sample from: ${tracked.stderr.toString()}`);
  }
  const result = Bun.spawnSync([...grepArgs(list, "oh"), ...files]);
  const sample = result.stdout.toString().split("\n").find(Boolean);
  if (sample === undefined) {
    throw new Error(`the «${list.name}» deny-list matches no tracked file: no control sample`);
  }
  return sample;
}

/** Forms under which a branch gets written down instead of resolved. */
const WRITTEN_REFS: readonly RegExp[] = [
  /`(main|master|trunk|develop)`/,
  /\b(origin|refs\/heads|refs\/remotes)\/[\w./-]+/,
  /--branch[ =]\S/,
  /[?&]ref=\S/,
  /\bbranch(es)?\s*:\s*\[?\s*["']?[\w./-]+/i,
];
const MACHINE_PATHS: readonly RegExp[] = [
  /\/(Users|home)\/[^\s/]+\//,
  /\/(private\/)?var\/folders\//,
  /\b[A-Za-z]:\\/,
];

function servedBranch(): string | undefined {
  const result = Bun.spawnSync([
    "git",
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  const name = result.stdout
    .toString()
    .trim()
    .replace(/^origin\//, "");
  return result.exitCode === 0 && name.length > 0 ? name : undefined;
}

function hardcodedLines(text: string): string[] {
  const served = servedBranch();
  return text
    .split("\n")
    .filter(
      (line) =>
        MACHINE_PATHS.some((motif) => motif.test(line)) ||
        WRITTEN_REFS.some((motif) => motif.test(line)) ||
        (served !== undefined && line.includes(served)),
    );
}

describe("ADR template: file and skeleton", () => {
  test("is tracked by git and opens on an unnumbered ADR title", async () => {
    const tracked = Bun.spawnSync(["git", "ls-files", "--error-unmatch", "--", TEMPLATE_PATH]);
    expect(tracked.exitCode, tracked.stderr.toString()).toBe(0);
    const firstLine = (await loadTemplate()).split("\n")[0] ?? "";
    expect(firstLine).toMatch(TITLE);
    expect(firstLine).not.toMatch(/ADR-[0-9]{4}/);
  });

  test("carries the header lines and the six sections, each once, in the brief's order", async () => {
    const template = await loadTemplate();
    expect(headerLabels(template).filter((label) => HEADER_ORDER.includes(label))).toEqual(
      HEADER_ORDER,
    );
    expect(sectionTitles(template)).toEqual(SECTION_ORDER);
    expect(structureViolations(template)).toEqual([]);
  });

  test("accepts «Date de rédaction» for the Date line", async () => {
    const renamed = replaceOnce(await loadTemplate(), "- **Date :**", "- **Date de rédaction :**");
    expect(structureViolations(renamed)).toEqual([]);
  });

  test("is declared in the documentary authority map", async () => {
    expect(await Bun.file(AUTHORITY_MAP).text()).toContain(`\`${TEMPLATE_PATH}\``);
  });
});

describe("ADR template: mutations of an in-memory copy are refused", () => {
  test("a removed section", async () => {
    const mutant = replaceOnce(await loadTemplate(), "\n## Alternatives rejetées\n", "\n");
    expect(structureViolations(mutant)).toHaveLength(1);
  });

  test("two sections in the wrong order", async () => {
    const mutant = swapHeadings(await loadTemplate(), "Conséquences", "Alternatives rejetées");
    expect(structureViolations(mutant)).toHaveLength(1);
  });

  test("the empirical verification placed after the decision", async () => {
    const mutant = swapHeadings(await loadTemplate(), "Vérification empirique", "Décision");
    expect(sectionTitles(mutant).indexOf("Vérification empirique")).toBeGreaterThan(
      sectionTitles(mutant).indexOf("Décision"),
    );
    expect(structureViolations(mutant)).toHaveLength(1);
  });

  test("a header line moved out of order, and a numbered title", async () => {
    const template = await loadTemplate();
    const arbitrage = template.split("\n").find((line) => line.startsWith("- **Arbitrage :**"));
    if (arbitrage === undefined) throw new Error("no Arbitrage header line to move");
    const moved = replaceOnce(template, `${arbitrage}\n`, "").replace(
      "\n## Vérification empirique\n",
      `${arbitrage}\n\n## Vérification empirique\n`,
    );
    expect(structureViolations(moved)).toHaveLength(1);
    expect(structureViolations(template.replace("# ADR-NNNN", "# ADR-0001"))).toHaveLength(1);
  });
});

describe("ADR template: rubrics the brief requires", () => {
  test("the empirical verification offers its three forms and the «inféré» marker", async () => {
    const body = sectionBody(await loadTemplate(), "Vérification empirique", "Contexte");
    const missing = EMPIRICAL_LABELS.filter((label) => !body.includes(label));
    expect(missing).toEqual([]);
  });

  test("the replacement block: error note on top, original content, status and back-reference", async () => {
    const template = await loadTemplate();
    const guidance = commented(template);
    expect(guidance).toContain("> **Note d'erreur");
    expect(template.indexOf("> **Note d'erreur")).toBeLessThan(template.indexOf("- **Statut :**"));
    expect(guidance.split("\n")).toContain("## Contenu original (remplacé)");
    expect(template).toContain("remplacé par ADR-");
    expect(guidance.split("\n").filter((line) => line.startsWith("- **Remplace :**"))).toHaveLength(
      1,
    );
  });

  test("the amendment form and the correction by a new commit", async () => {
    const template = await loadTemplate();
    expect(template).toContain("accepted, amendé par ADR-");
    expect(template).toMatch(/nouveau commit,\s+jamais par une réécriture de l'historique publié/);
  });

  test("a copy passes the accepted-ADR guard as is: Arbitrage line and «No invariant»", async () => {
    const kept = visible(await loadTemplate());
    expect(kept).toContain("- **Arbitrage :**");
    expect(kept).toContain("No invariant");
  });
});

describe("ADR template: nothing a gate refuses", () => {
  test("no motif of the governance deny-lists, by the gate's own patterns", async () => {
    const template = await loadTemplate();
    const lists = await loadDenyLists();
    expect(lists.map((list) => list.name)).toEqual(["superseded", "preventive", "retired brands"]);
    for (const list of lists) {
      // Control first: the same call must see a forbidden string when one is there.
      expect(denyListHits(list, `${template}\n${forbiddenSample(list)}\n`), list.name).toBe(true);
      expect(denyListHits(list, template), list.name).toBe(false);
    }
  });

  test("no machine path and no written-down branch", async () => {
    const template = await loadTemplate();
    expect(hardcodedLines(template)).toEqual([]);
    const served = servedBranch() ?? "trunk";
    expect(hardcodedLines(`${template}\n- voir origin/${served}\n`)).toHaveLength(1);
    expect(hardcodedLines(`${template}\n- /home/someone/notes.md\n`)).toHaveLength(1);
  });

  test("the doctrine governance script stays green and does not count the template as an ADR", () => {
    const result = Bun.spawnSync(["bash", GOVERNANCE_SCRIPT]);
    const output = result.stdout.toString();
    expect(result.exitCode, output).toBe(0);
    const adrFiles = readdirSync(ADR_DIRECTORY).filter((name) => name.endsWith(".md")).length;
    expect(output).toContain(`Doctrine governance verified: ${adrFiles} ADR file(s),`);
  });
});
