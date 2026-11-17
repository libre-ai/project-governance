import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Structure test of docs/method/SPECIFICATION-FANOUT.md.
//
// WHY. A method document drifts by silent edits: a step dropped, two mandate
// headings swapped, a loop over a worktree directory pasted as an example. None
// of these breaks a link or a gate, so this test pins the shape the brief fixed
// (nine ordered steps, seven ordered mandate headings, three common blocks, four
// invariants, three lessons) and the hygiene rules the document states about
// itself (no sha, no hard-coded default branch, no machine path, no host name,
// no calendar duration, no count without the command that derives it).
//
// It reads the one file and nothing else: no network, no git.

const DOCUMENT = join(import.meta.dir, "..", "..", "docs", "method", "SPECIFICATION-FANOUT.md");

const STEPS: readonly string[] = [
  "1. Mesurer l'état réel",
  "2. Worktrees à la tête servie",
  "3. Gabarit de sortie et contrôleur déterministe",
  "4. Mandats assemblés et lintés",
  "5. Pilote unique sur le plus petit dépôt",
  "6. Vague A : les transverses",
  "7. Fusion des demandes vertes par le propriétaire",
  "8. Vague B : un agent par dépôt",
  "9. Consolidation puis relecture indépendante",
];

const TRAILING_SECTIONS: readonly string[] = ["Mandat", "Invariants", "Leçons", "Hors périmètre"];

const RUBRIQUES: readonly string[] = [
  "Rôle",
  "Périmètre",
  "Contraintes",
  "Faits volatils",
  "Format de sortie",
  "Critère de fin",
  "Délégation",
];

const BLOCS: readonly string[] = [
  "Bloc a — dépôts privés hors périmètre",
  "Bloc b — outils",
  "Bloc c — délégation de profondeur nulle",
];

// An invariant or a lesson is its bold label plus the normative sentence of its
// body: a copy that kept the label and reversed the body would pass a check on
// the label alone. Whitespace is normalised, so rewrapping stays green.
interface NormativeItem {
  readonly label: string;
  readonly normative: readonly string[];
}

const INVARIANTS: readonly NormativeItem[] = [
  {
    label: "Écritures de forge par le seul propriétaire.",
    normative: [
      "Les agents ne font que des lectures (`GET`) ; ni push, ni demande de fusion, ni issue.",
    ],
  },
  {
    label: "Dépôts privés hors périmètre.",
    normative: ["Aucun agent ne les lit, ne les liste ni ne les interroge."],
  },
  {
    label: "Rien ne fusionne sans pipeline vert.",
    normative: ["L'état `merged` se relit à l'API de la forge, jamais dans un rapport."],
  },
  {
    label: "Relecteur d'une autre famille de modèle que l'auteur.",
    normative: ["Un relecteur de la même famille partage les angles morts de l'auteur."],
  },
];

const LECONS: readonly NormativeItem[] = [
  {
    label: "Budget d'appels et liste des projets lisibles dans le mandat.",
    normative: ["le mandat borne donc les appels et nomme les projets lisibles."],
  },
  {
    label: "Confinement par discipline, aucun bac à sable de lecture.",
    normative: [
      "Un worktree isole les écritures, pas les lectures",
      "Le confinement tient au mandat et à sa vérification, il n'est pas garanti par l'outillage.",
    ],
  },
  {
    label: "Un inventaire écrit dans chaque dépôt est du code mort.",
    normative: [
      "Ce qui dure est la commande de scan ; le rapport consolidé est jetable et vit hors dépôt ; chaque action qu'il propose porte sa preuve sur sa propre ligne.",
    ],
  },
];

// Counts of structure that the brief itself fixes; any other number written in
// words is a count without its command.
const STRUCTURE_COUNTS: readonly string[] = [
  "neuf étapes",
  "sept rubriques",
  "trois blocs",
  "quatre invariants",
  "trois leçons",
];

// Cardinal number words. "un"/"une" are left out: in French they are mostly
// articles, and a single item is not a count that needs deriving.
const NUMBER_WORD =
  /(?<![\p{L}-])(deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|cents?|milles?|millions?|milliers?|centaines?|dizaines?|douzaines?)(?![\p{L}-])/iu;

interface Line {
  readonly number: number;
  readonly text: string;
}

interface Split {
  readonly prose: readonly Line[];
  readonly code: readonly Line[];
}

// CommonMark fences: a run of at least three backticks or tildes opens a block,
// and only a run of the same character, at least as long, closes it.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function split(text: string): Split {
  const prose: Line[] = [];
  const code: Line[] = [];
  let open: string | null = null;
  text.split("\n").forEach((raw, index) => {
    const line: Line = { number: index + 1, text: raw };
    const fence = FENCE.exec(raw)?.[1];
    if (fence !== undefined) {
      if (open === null) {
        open = fence;
        return;
      }
      if (fence[0] === open[0] && fence.length >= open.length && raw.trim() === fence) {
        open = null;
        return;
      }
    }
    (open === null ? prose : code).push(line);
  });
  return { prose, code };
}

// Shell lines continued by a trailing backslash are joined, so a loop split over
// several lines is tested as one command. The joined line keeps the number of
// its first physical line.
function logicalLines(code: readonly Line[]): Line[] {
  const joined: Line[] = [];
  let pending: Line | null = null;
  for (const line of code) {
    const text: string = pending === null ? line.text : `${pending.text} ${line.text.trimStart()}`;
    const start: number = pending === null ? line.number : pending.number;
    if (text.endsWith("\\")) {
      pending = { number: start, text: text.slice(0, -1) };
      continue;
    }
    pending = null;
    joined.push({ number: start, text });
  }
  if (pending !== null) {
    joined.push(pending);
  }
  return joined;
}

// A list item and its indented continuation lines, whitespace normalised.
function listItems(lines: readonly Line[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    if (line.text.startsWith("- ")) {
      items.push(line.text.slice(2).trim());
    } else if (line.text.startsWith("  ") && items.length > 0) {
      items[items.length - 1] = `${items[items.length - 1]} ${line.text.trim()}`;
    } else if (line.text.trim() === "" || !line.text.startsWith("  ")) {
      items.push("");
    }
  }
  return items.filter((item) => item !== "");
}

function normativeViolations(lines: readonly Line[], expected: readonly NormativeItem[]): string[] {
  const items = listItems(lines).filter((item) => item.startsWith("**"));
  const labels = items.map((item) => /^\*\*(.+?)\*\*/.exec(item)?.[1] ?? "");
  if (JSON.stringify(labels) !== JSON.stringify(expected.map((entry) => entry.label))) {
    return [JSON.stringify(labels)];
  }
  const violations: string[] = [];
  expected.forEach((entry, index) => {
    const body = items[index] ?? "";
    for (const sentence of entry.normative) {
      if (!body.includes(sentence)) {
        violations.push(`${JSON.stringify(entry.label)} lost ${JSON.stringify(sentence)}`);
      }
    }
  });
  return violations;
}

// Consecutive non-empty prose lines, so a statement wrapped over two lines is
// read whole.
function paragraphs(prose: readonly Line[]): Line[][] {
  const groups: Line[][] = [[]];
  for (const line of prose) {
    if (line.text.trim() === "" || line.text.startsWith("#")) {
      groups.push([]);
    } else {
      groups[groups.length - 1]?.push(line);
    }
  }
  return groups.filter((group) => group.length > 0);
}

function h2Headings(prose: readonly Line[]): string[] {
  return prose.filter((line) => line.text.startsWith("## ")).map((line) => line.text.slice(3));
}

function section(prose: readonly Line[], heading: string): Line[] {
  const start = prose.findIndex((line) => line.text === `## ${heading}`);
  if (start < 0) {
    return [];
  }
  const rest = prose.slice(start + 1);
  const end = rest.findIndex((line) => line.text.startsWith("## "));
  return end < 0 ? rest : rest.slice(0, end);
}

function boldItems(lines: readonly Line[], marker: RegExp): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const match = marker.exec(line.text);
    if (match?.[1] !== undefined) {
      items.push(match[1]);
    }
  }
  return items;
}

// A loop over anything but plain repository names, tested on logical lines
// (backslash continuations joined): a `for` over a glob, a path, a command
// substitution or a variable expansion; `git worktree list` used anywhere, since
// its only use in a code block is as a source of worktrees; a listing (`ls`,
// `find`, `cat`) or a glob or path piped into anything; `find … -exec` and its
// variants, which iterate by themselves; and a list read from a file.
const LOOP_OVER_DIRECTORY_OR_FILE: readonly RegExp[] = [
  /\bfor\s+\w+\s+in\s+(?=[^;]*[*/$`])/,
  /\bgit\s+worktree\s+list\b/,
  /(?<![\w-])(ls|find|cat)(?![\w-])[^|]*\|/,
  /[*/][^|]*\|\s*(while|xargs|parallel)\b/,
  /\bfind\b.*\s-(exec|execdir|ok|okdir)\b/,
  /\bdone\s*<\s*\S/,
  /\bwhile\s+read\b[^;]*<\s*\S/,
  /\b(mapfile|readarray)\b[^;]*<\s*\S/,
  /\bxargs\b[^|;]*\s(-a|--arg-file)\b/,
];

// A command that derives a count: a line count, a JSON length, a git counter,
// a grep counter. A number is accepted only beside inline code holding one.
const DERIVING_COMMAND =
  /`[^`]*(\|\s*wc\b|\bwc\s+-[lwcm]|\bjq\b[^`]*\blength\b|\bgit\b[^`]*\s--count\b|\bgrep\b[^`]*\s-c\b|\bgrep\b[^`]*\s--count\b)[^`]*`/;

const FULL_SHA = /\b[0-9a-f]{40}\b/i;
const DEFAULT_BRANCH = /\b(main|master)\b/;
const MACHINE_PATH = /(\/Users\/|\/home\/|\/var\/folders\/|\/private\/|~\/|[A-Z]:\\)/;
const HOST_NAME = /(\bhttps?:\/\/|\blocalhost\b|\b[a-z0-9-]+\.(com|org|net|io|fr|dev|ai|eu)\b)/i;
const CALENDAR_DURATION =
  /\b(jours?|semaines?|mois|heures?|minutes?|ans|années?|trimestres?|days?|weeks?|months?|hours?)\b/i;
// An exit code named as such, or a number after a word that announces one
// ("sortie 1", "sort en 2", "exit 3", "rc=4", "renvoie 0", "statut 1").
const EXIT_CODE =
  /(codes? de (sortie|retour)|exit (code|status)|\b(sortie|sort|sortent|sortir|exit|exits|rc|status|statut|renvoie|retourne|returns?)\s*(en\s+|avec\s+|=\s*|:\s*)?\d+\b)/i;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const LIST_MARKER = /^\s*\d+\.\s/;

function inspect(text: string): string[] {
  const violations: string[] = [];
  const { prose, code } = split(text);
  const nonEmpty = prose.filter((line) => line.text.trim() !== "");
  const bullets = nonEmpty.filter((line) => line.text.startsWith("- "));

  if (!nonEmpty[0]?.text.startsWith("# ")) {
    violations.push("title: the document does not open on an H1");
  }
  if (!bullets[0]?.text.startsWith("- **Portée :**")) {
    violations.push("title: the first bullet is not Portée");
  }
  if (!bullets[1]?.text.startsWith("- **Statut :**")) {
    violations.push("title: the second bullet is not Statut");
  }

  const expectedHeadings = [...STEPS, ...TRAILING_SECTIONS];
  const headings = h2Headings(prose);
  if (JSON.stringify(headings) !== JSON.stringify(expectedHeadings)) {
    violations.push(`sections: ${JSON.stringify(headings)}`);
  }

  const mandat = section(prose, "Mandat");
  const rubriques = boldItems(mandat, /^\d+\. \*\*(.+?)\*\*/);
  if (JSON.stringify(rubriques) !== JSON.stringify(RUBRIQUES)) {
    violations.push(`rubriques: ${JSON.stringify(rubriques)}`);
  }
  const blocs = boldItems(mandat, /^- \*\*(Bloc [a-z] — .+?) :\*\*/);
  if (JSON.stringify(blocs) !== JSON.stringify(BLOCS)) {
    violations.push(`blocs: ${JSON.stringify(blocs)}`);
  }

  for (const violation of normativeViolations(section(prose, "Invariants"), INVARIANTS)) {
    violations.push(`invariants: ${violation}`);
  }
  for (const violation of normativeViolations(section(prose, "Leçons"), LECONS)) {
    violations.push(`leçons: ${violation}`);
  }

  const proseText = prose.map((line) => line.text).join("\n");
  if (!proseText.includes("git ls-remote --symref")) {
    violations.push("iteration: git ls-remote --symref is not cited");
  }
  if (!/liste blanche de\s+noms de\s+dépôts/.test(proseText)) {
    violations.push("iteration: the whitelist-of-repository-names rule is missing");
  }

  for (const line of logicalLines(code)) {
    if (LOOP_OVER_DIRECTORY_OR_FILE.some((pattern) => pattern.test(line.text))) {
      violations.push(`loop over a directory or a file, line ${line.number}`);
    }
  }

  const all = [...prose, ...code];
  for (const line of all) {
    if (FULL_SHA.test(line.text)) {
      violations.push(`sha, line ${line.number}`);
    }
    if (DEFAULT_BRANCH.test(line.text)) {
      violations.push(`default branch written in, line ${line.number}`);
    }
    if (MACHINE_PATH.test(line.text)) {
      violations.push(`machine path, line ${line.number}`);
    }
    if (HOST_NAME.test(line.text)) {
      violations.push(`host name, line ${line.number}`);
    }
  }

  if (!/\bL127\b/.test(proseText)) {
    violations.push("controller: L127 is not named");
  }
  if (EXIT_CODE.test(text)) {
    violations.push("controller: an exit code is described");
  }
  // Every line that speaks of the controller: the third step, and any paragraph
  // that cites L127 or the controller, wherever it sits in the document.
  const aboutController = new Set<Line>(section(prose, STEPS[2] ?? ""));
  for (const paragraph of paragraphs(prose)) {
    if (paragraph.some((line) => /\bL127\b|contrôleur/i.test(line.text))) {
      for (const line of paragraph) {
        aboutController.add(line);
      }
    }
  }
  for (const line of [...aboutController].sort((a, b) => a.number - b.number)) {
    if (/(^|[\s(`])--?[A-Za-z]/.test(line.text)) {
      violations.push(`controller: an option is described, line ${line.number}`);
    }
  }

  for (const line of prose) {
    if (line.text.startsWith("#")) {
      continue;
    }
    if (CALENDAR_DURATION.test(line.text)) {
      violations.push(`calendar duration, line ${line.number}`);
    }
    const counted = line.text.replace(ISO_DATE, "").replace(LIST_MARKER, "");
    if (/\b\d+\b/.test(counted) && !DERIVING_COMMAND.test(line.text)) {
      violations.push(`count without its command, line ${line.number}`);
    }
    const words = STRUCTURE_COUNTS.reduce(
      (rest, phrase) => rest.replace(new RegExp(phrase, "giu"), ""),
      line.text,
    );
    if (NUMBER_WORD.test(words) && !DERIVING_COMMAND.test(line.text)) {
      violations.push(`count in words without its command, line ${line.number}`);
    }
  }

  return violations;
}

const original = readFileSync(DOCUMENT, "utf8");
const scratch = mkdtempSync(join(tmpdir(), "specification-fanout-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

// The mutants run on a temporary copy, never on the tracked document.
function inspectCopy(name: string, mutate: (text: string) => string): string[] {
  const mutated = mutate(original);
  expect(mutated).not.toBe(original);
  const path = join(scratch, `${name}.md`);
  writeFileSync(path, mutated);
  return inspect(readFileSync(path, "utf8"));
}

function removeStep(text: string, heading: string): string {
  const start = text.indexOf(`## ${heading}\n`);
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(0, start) + text.slice(end + 1);
}

describe("docs/method/SPECIFICATION-FANOUT.md", () => {
  test("the tracked document satisfies every structure and hygiene rule", () => {
    expect(inspect(original)).toEqual([]);
  });

  test("removing a step turns it red", () => {
    const violations = inspectCopy("step-removed", (text) => removeStep(text, STEPS[5] ?? ""));
    expect(violations.some((v) => v.startsWith("sections:"))).toBe(true);
  });

  test("swapping two steps turns it red", () => {
    const violations = inspectCopy("steps-swapped", (text) =>
      text
        .replace("## 6. Vague A", "## @@A")
        .replace("## 8. Vague B", "## 6. Vague A")
        .replace("## @@A", "## 8. Vague B"),
    );
    expect(violations.some((v) => v.startsWith("sections:"))).toBe(true);
  });

  test("permuting two mandate headings turns it red", () => {
    const violations = inspectCopy("rubriques-permuted", (text) =>
      text
        .replace("3. **Contraintes**", "3. **@@**")
        .replace("4. **Faits volatils**", "4. **Contraintes**")
        .replace("3. **@@**", "3. **Faits volatils**"),
    );
    expect(violations.some((v) => v.startsWith("rubriques:"))).toBe(true);
  });

  test("dropping a common block turns it red", () => {
    const violations = inspectCopy("bloc-dropped", (text) =>
      text.replace("- **Bloc b — outils :**", "- Outils :"),
    );
    expect(violations.some((v) => v.startsWith("blocs:"))).toBe(true);
  });

  test("dropping an invariant or a lesson turns it red", () => {
    const invariant = inspectCopy("invariant-dropped", (text) =>
      text.replace("- **Rien ne fusionne sans pipeline vert.**", "- Rien ne fusionne."),
    );
    expect(invariant.some((v) => v.startsWith("invariants:"))).toBe(true);
    const lecon = inspectCopy("lecon-dropped", (text) =>
      text.replace("- **Confinement par discipline, aucun bac à sable de lecture.**", "- Note."),
    );
    expect(lecon.some((v) => v.startsWith("leçons:"))).toBe(true);
  });

  test("a missing H1 or title bullet turns it red", () => {
    const title = inspectCopy("title-demoted", (text) => text.replace(/^# /, "Titre : "));
    expect(title).toContain("title: the document does not open on an H1");
    const portee = inspectCopy("portee-dropped", (text) =>
      text.replace("- **Portée :**", "- **Objet :**"),
    );
    expect(portee).toContain("title: the first bullet is not Portée");
    const statut = inspectCopy("statut-dropped", (text) =>
      text.replace("- **Statut :**", "- **État :**"),
    );
    expect(statut).toContain("title: the second bullet is not Statut");
  });

  test("inserting a loop over a worktree directory turns it red", () => {
    const violations = inspectCopy("loop-worktrees", (text) =>
      text.replace("```sh\n", '```sh\nfor w in worktrees/*; do git -C "$w" status; done\n'),
    );
    expect(violations.some((v) => v.startsWith("loop over a directory or a file"))).toBe(true);
  });

  test("a loop over git worktree list or over a base file turns it red", () => {
    const listed = inspectCopy("loop-worktree-list", (text) =>
      text.replace("```sh\n", "```sh\nfor w in $(git worktree list --porcelain); do :; done\n"),
    );
    expect(listed.some((v) => v.startsWith("loop over a directory or a file"))).toBe(true);
    const based = inspectCopy("loop-base-file", (text) =>
      text.replace("```sh\n", "```sh\nwhile read depot; do :; done < base.txt\n"),
    );
    expect(based.some((v) => v.startsWith("loop over a directory or a file"))).toBe(true);
  });

  test("dropping the ls-remote citation or the whitelist rule turns it red", () => {
    const symref = inspectCopy("no-symref", (text) =>
      text.replaceAll("git ls-remote --symref", "git ls-remote"),
    );
    expect(symref).toContain("iteration: git ls-remote --symref is not cited");
    const whitelist = inspectCopy("no-whitelist", (text) =>
      text.replace(/liste blanche de\s+noms de\s+dépôts/g, "liste de dépôts"),
    );
    expect(whitelist).toContain("iteration: the whitelist-of-repository-names rule is missing");
  });

  test("a sha, a default branch, a machine path or a host name turns it red", () => {
    const append = (line: string) => (text: string) => `${text}\n${line}\n`;
    const sha = inspectCopy("sha", append(`Base : \`${"a1".repeat(20)}\`.`));
    expect(sha.some((v) => v.startsWith("sha,"))).toBe(true);
    const branch = inspectCopy("branch", append("Partir de `main`."));
    expect(branch.some((v) => v.startsWith("default branch"))).toBe(true);
    const path = inspectCopy("path", append("Voir `/home/agent/work`."));
    expect(path.some((v) => v.startsWith("machine path"))).toBe(true);
    const host = inspectCopy("host", append("Forge : `forge.example.org`."));
    expect(host.some((v) => v.startsWith("host name"))).toBe(true);
  });

  test("an unnamed controller or a described exit code turns it red", () => {
    const unnamed = inspectCopy("no-l127", (text) => text.replaceAll("L127", "Lxxx"));
    expect(unnamed).toContain("controller: L127 is not named");
    const exit = inspectCopy("exit-code", (text) =>
      text.replace("L127, qui", "L127 (code de sortie non nul en cas d'écart), qui"),
    );
    expect(exit).toContain("controller: an exit code is described");
    const option = inspectCopy("option", (text) =>
      text.replace("L127, qui", "L127, lancé avec --mode, qui"),
    );
    expect(option.some((v) => v.startsWith("controller: an option"))).toBe(true);
  });

  test("a calendar duration or a count without its command turns it red", () => {
    const duration = inspectCopy("duration", (text) =>
      text.replace("## Leçons\n", "## Leçons\n\nLe pilote a duré trois jours.\n"),
    );
    expect(duration.some((v) => v.startsWith("calendar duration"))).toBe(true);
    const count = inspectCopy("count", (text) =>
      text.replace("## Leçons\n", "## Leçons\n\nUn pilote a fait 205 appels.\n"),
    );
    expect(count.some((v) => v.startsWith("count without its command"))).toBe(true);
  });

  // Each form of iteration over worktrees or over a listing, one mutant per form.
  const loopForms: readonly (readonly [string, string])[] = [
    ["worktree-list-while", "git worktree list --porcelain | while read -r l; do :; done"],
    ["worktree-list-xargs", "git worktree list | xargs -n1 echo"],
    ["worktree-list-process", "while read -r l; do :; done < <(git worktree list)"],
    ["for-continued", "for w in\\\n  worktrees/*; do :; done"],
    ["find-exec", "find worktrees -mindepth 1 -maxdepth 1 -exec git -C {} status \\;"],
    ["find-execdir", "find worktrees -name .git -execdir git status \\;"],
    ["glob-piped", "printf '%s\\n' worktrees/* | xargs -n1 git -C"],
    ["mapfile", "mapfile -t depots < base.txt"],
    ["xargs-arg-file", "xargs -a base.txt -n1 git -C"],
    ["ls-piped", "ls worktrees | sort"],
  ];
  for (const [name, loop] of loopForms) {
    test(`a loop of the form ${name} turns it red`, () => {
      const violations = inspectCopy(name, (text) =>
        text.replace("```sh\n", `\`\`\`sh\n${loop}\n`),
      );
      expect(violations.some((v) => v.startsWith("loop over a directory or a file"))).toBe(true);
    });
  }

  test("a loop inside a tilde fence is read as code", () => {
    const violations = inspectCopy("tilde-fence", (text) =>
      text.replace("## Leçons\n", "## Leçons\n\n~~~sh\nfor w in worktrees/*; do :; done\n~~~\n"),
    );
    expect(violations.some((v) => v.startsWith("loop over a directory or a file"))).toBe(true);
  });

  test("a backtick line inside a tilde fence does not close it", () => {
    const violations = inspectCopy("tilde-fence-backticks", (text) =>
      text.replace(
        "## Leçons\n",
        "## Leçons\n\n~~~sh\n```\nfor w in worktrees/*; do :; done\n~~~\n",
      ),
    );
    expect(violations.some((v) => v.startsWith("loop over a directory or a file"))).toBe(true);
  });

  test("a count next to inline code that derives nothing turns it red", () => {
    const violations = inspectCopy("count-beside-code", (text) =>
      text.replace("## Leçons\n", "## Leçons\n\nUn pilote a fait 205 appels sur `depot-a`.\n"),
    );
    expect(violations.some((v) => v.startsWith("count without its command"))).toBe(true);
  });

  test("a count next to the command that derives it stays green", () => {
    const violations = inspectCopy("count-derived", (text) =>
      text.replace(
        "## Leçons\n",
        "## Leçons\n\nLe dépôt compte 30 fichiers (`git -C <worktree> ls-files | wc -l`).\n",
      ),
    );
    expect(violations.filter((v) => v.startsWith("count without its command"))).toEqual([]);
  });

  test("a count written in words turns it red", () => {
    const violations = inspectCopy("count-in-words", (text) =>
      text.replace(
        "## Leçons\n",
        "## Leçons\n\nUn pilote a fait deux cent cinq appels sur un dépôt de trente fichiers.\n",
      ),
    );
    expect(violations.some((v) => v.startsWith("count in words"))).toBe(true);
  });

  test("an exit code written as « sortie <n> » turns it red", () => {
    const violations = inspectCopy("exit-sortie", (text) =>
      text.replace("L127, qui", "L127 (sortie 1 sur un écart), qui"),
    );
    expect(violations).toContain("controller: an exit code is described");
  });

  test("a controller option outside the third step turns it red", () => {
    const violations = inspectCopy("option-elsewhere", (text) =>
      text.replace(
        "- Le contrôleur de la troisième étape",
        "- Le contrôleur, lancé avec --mode mandat, de la troisième étape",
      ),
    );
    expect(violations.some((v) => v.startsWith("controller: an option"))).toBe(true);
  });

  test("an invariant whose body is reversed under its label turns it red", () => {
    const violations = inspectCopy("invariant-reversed", (text) =>
      text.replace(
        "L'état `merged` se relit à l'API de\n  la forge, jamais dans un rapport.",
        "L'état `merged` se lit dans le\n  rapport de l'agent, sans relire l'API.",
      ),
    );
    expect(violations.some((v) => v.startsWith("invariants:"))).toBe(true);
  });

  test("a lesson whose body is reversed under its label turns it red", () => {
    const violations = inspectCopy("lecon-reversed", (text) =>
      text.replace(
        "Un worktree\n  isole les écritures, pas les lectures",
        "Un worktree\n  isole les lectures et les écritures",
      ),
    );
    expect(violations.some((v) => v.startsWith("leçons:"))).toBe(true);
  });
});
