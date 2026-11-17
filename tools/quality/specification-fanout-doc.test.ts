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

const INVARIANTS: readonly string[] = [
  "Écritures de forge par le seul propriétaire.",
  "Dépôts privés hors périmètre.",
  "Rien ne fusionne sans pipeline vert.",
  "Relecteur d'une autre famille de modèle que l'auteur.",
];

const LECONS: readonly string[] = [
  "Budget d'appels et liste des projets lisibles dans le mandat.",
  "Confinement par discipline, aucun bac à sable de lecture.",
  "Un inventaire écrit dans chaque dépôt est du code mort.",
];

interface Line {
  readonly number: number;
  readonly text: string;
}

interface Split {
  readonly prose: readonly Line[];
  readonly code: readonly Line[];
}

function split(text: string): Split {
  const prose: Line[] = [];
  const code: Line[] = [];
  let inFence = false;
  text.split("\n").forEach((raw, index) => {
    const line: Line = { number: index + 1, text: raw };
    if (raw.trimStart().startsWith("```")) {
      inFence = !inFence;
      return;
    }
    (inFence ? code : prose).push(line);
  });
  return { prose, code };
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

// A loop over anything but plain repository names: a glob, a path, a command
// substitution or variable expansion (`$(ls …)`, `$(git worktree list)`), a
// listing piped into a reader, or a list read from a file.
const LOOP_OVER_DIRECTORY_OR_FILE: readonly RegExp[] = [
  /\bfor\s+\w+\s+in\s+(?=[^;]*[*/$`])/,
  /\b(ls|find|cat)\b[^|]*\|\s*(while|xargs)\b/,
  /\bdone\s*<\s*\S/,
  /\bwhile\s+read\b[^;]*<\s*\S/,
];

const FULL_SHA = /\b[0-9a-f]{40}\b/i;
const DEFAULT_BRANCH = /\b(main|master)\b/;
const MACHINE_PATH = /(\/Users\/|\/home\/|\/var\/folders\/|\/private\/|~\/|[A-Z]:\\)/;
const HOST_NAME = /(\bhttps?:\/\/|\blocalhost\b|\b[a-z0-9-]+\.(com|org|net|io|fr|dev|ai|eu)\b)/i;
const CALENDAR_DURATION =
  /\b(jours?|semaines?|mois|heures?|minutes?|ans|années?|trimestres?|days?|weeks?|months?|hours?)\b/i;
const EXIT_CODE = /(codes? de (sortie|retour)|exit (code|status))/i;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const LIST_MARKER = /^\s*\d+\.\s/;
const INLINE_CODE = /`[^`]+`/;

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

  const invariants = boldItems(section(prose, "Invariants"), /^- \*\*(.+?)\*\*/);
  if (JSON.stringify(invariants) !== JSON.stringify(INVARIANTS)) {
    violations.push(`invariants: ${JSON.stringify(invariants)}`);
  }
  const lecons = boldItems(section(prose, "Leçons"), /^- \*\*(.+?)\*\*/);
  if (JSON.stringify(lecons) !== JSON.stringify(LECONS)) {
    violations.push(`leçons: ${JSON.stringify(lecons)}`);
  }

  const proseText = prose.map((line) => line.text).join("\n");
  if (!proseText.includes("git ls-remote --symref")) {
    violations.push("iteration: git ls-remote --symref is not cited");
  }
  if (!/liste blanche de\s+noms de\s+dépôts/.test(proseText)) {
    violations.push("iteration: the whitelist-of-repository-names rule is missing");
  }

  for (const line of code) {
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
  const controllerStep = section(prose, STEPS[2] ?? "");
  for (const line of controllerStep) {
    if (/(^|\s)--?[a-z]/.test(line.text)) {
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
    if (/\b\d+\b/.test(counted) && !INLINE_CODE.test(line.text)) {
      violations.push(`count without its command, line ${line.number}`);
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
});
