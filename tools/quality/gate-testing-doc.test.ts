import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";

/**
 * Structure check of docs/method/GATE-TESTING.md.
 *
 * The note is a method other suites fill in: its section order, the columns of its two tables,
 * its two questions and its normative sentences are an interface. Every expected value below
 * comes from the brief of the note, not from the note. Each control is then replayed against a
 * mutated copy of the note (a substitution, exactly one occurrence, different from the
 * original), which is the method the note describes applied to the note itself.
 *
 * A normative rule is anchored on its complete sentence, and every other sentence of the note
 * that touches the same subject must be one the rule lists: a contradicting sentence added
 * anywhere (a deletion admitted, an identical mutant admitted, an optional answer) is refused,
 * not only the removal of the expected one.
 */

const ROOT: string = resolve(import.meta.dir, "..", "..");
const DOCUMENT: string = "docs/method/GATE-TESTING.md";
const INSTANCE: string = "distribution/templates/langgraph-gates/langgraph-gates.test.ts";

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
const EXECUTABLES_SECTION: string = "Exécutables réduits à des doublures et environnement purgé";
const MUTANT_SECTION: string = "Preuve par mutant";
const QUESTION_SECTION: string = "Les deux questions de chaque test";

const CASE_HEADER: string =
  "| Nom | État initial | Arguments | Code de sortie attendu | Motif attendu sur la sortie d'erreur | Appels attendus au journal (et appels interdits) |";
const MUTANT_HEADER: string =
  "| Identifiant du mutant | Fichier | Texte décisif remplacé et son remplacement no-op | Cas rouge(s) qui le tuent | Équivalence expliquée (vide si tué) |";

const QUESTION_ONE: string = "1. Quelle erreur concrète fait rougir ce test ?";
const QUESTION_TWO: string =
  "2. Un refactor équivalent, ou un meilleur résultat tout aussi valide, le ferait-il rougir aussi ?";

const NO_OP_SENTENCE: string = "La ligne décisive est remplacée par un no-op, jamais supprimée.";
const IDENTICAL_SENTENCE: string =
  "Un mutant identique à l'original fait échouer la suite, car le remplacement ne change rien.";
const ANSWER_SENTENCE: string =
  "Pour tout test ajouté ou modifié, la description de la demande de fusion répond par écrit aux deux questions suivantes.";
const OBLIGATION_SENTENCE: string = "Chacune des deux réponses est obligatoire.";
const SPAWN_CLEAN_IS: string =
  "`spawnClean`, dans `distribution/templates/langgraph-gates/langgraph-gates.test.ts`, est une instance du `HOME` jetable et de l'environnement construit de rien : le fils reçoit deux variables, et un test épingle qu'il n'en reçoit pas d'autre.";
const SPAWN_CLEAN_IS_NOT: string =
  "`spawnClean` n'est pas une instance du `PATH` réduit : il transmet le `PATH` hérité, pour trouver `git`.";
// The line of the instance the two sentences above describe: if it changes, the claim is stale.
const SPAWN_CLEAN_ENV: string =
  'const CLEAN_ENV = { PATH: process.env.PATH ?? "", HOME: scratch };';

interface NormativeRule {
  readonly id: string;
  /** Every sentence of the note that matches this subject must be listed in `allowed`. */
  readonly subject: RegExp;
  readonly required: readonly { readonly section: string; readonly sentence: string }[];
  readonly allowed: readonly string[];
}

const RULES: readonly NormativeRule[] = [
  {
    id: "never-deleted",
    subject: /supprim|effac|enlev|retranch/i,
    required: [{ section: MUTANT_SECTION, sentence: NO_OP_SENTENCE }],
    allowed: [
      NO_OP_SENTENCE,
      "Remplacée, jamais supprimée.",
      "Supprimer une ligne déséquilibre la structure et fait rougir tout, pour la mauvaise raison.",
    ],
  },
  {
    id: "differs-from-original",
    subject: /identique|inchang|ne change rien/i,
    required: [{ section: MUTANT_SECTION, sentence: IDENTICAL_SENTENCE }],
    allowed: [IDENTICAL_SENTENCE],
  },
  {
    id: "answers-required",
    subject: /r[ée]pon[ds]|facultati|optionnel|dispens/i,
    required: [
      { section: QUESTION_SECTION, sentence: ANSWER_SENTENCE },
      { section: QUESTION_SECTION, sentence: OBLIGATION_SENTENCE },
    ],
    allowed: [
      ANSWER_SENTENCE,
      OBLIGATION_SENTENCE,
      "La réponse à la première est le no-op de la table des mutants : la ligne neutralisée et le cas qui rougit.",
      "Si la réponse à la seconde est oui, le test verrouille l'implémentation et non le comportement : son attendu se réécrit à partir du contrat.",
    ],
  },
  {
    id: "spawnclean-instance",
    subject: /spawnClean/,
    required: [
      { section: EXECUTABLES_SECTION, sentence: SPAWN_CLEAN_IS },
      { section: EXECUTABLES_SECTION, sentence: SPAWN_CLEAN_IS_NOT },
    ],
    allowed: [SPAWN_CLEAN_IS, SPAWN_CLEAN_IS_NOT],
  },
];

const REQUIRED_CITATIONS: readonly string[] = [
  "docs/method/LANGGRAPH-ENTRY-GATES.md",
  "docs/method/MODULE-DESIGN.md",
  "tools/attestation/neutralise-check.ts",
];

// A repository-relative path written in a code span, with or without an extension.
const CODE_SPAN_PATH: RegExp = /`([\w.-]+(?:\/[\w.-]+)+\/?)`/g;
// The target of a markdown link, relative to the directory of the note.
const LINK_TARGET: RegExp = /\]\(([^)\s]+)\)/g;
const SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:/i;

const MACHINE_LOCAL_PATHS: readonly RegExp[] = [
  /(?<![\w.~-])\/(?:Users|home|root)\b/,
  /(?<![\w.~-])(?:\/private)?\/(?:var\/folders|tmp)\b/,
  /\b[A-Za-z]:\\(?:Users|Documents and Settings)\b/i,
];
// Reference forms only: the French word « main » stays free.
const DEFAULT_BRANCH_REFS: readonly RegExp[] = [
  /\b(?:origin|upstream)\/(?:main|master)\b/,
  /\b(?:main|master):/,
  /[?&]ref=(?:main|master)\b/,
  /--branch[= ]+(?:main|master)\b/,
  /\bbranches:\s*\[\s*["']?(?:main|master)\b/,
  /\brefs\/heads\/(?:main|master)\b/,
];
const URL_SCHEME: RegExp = /\b[a-z][a-z0-9+.-]*:\/\//i;
const IPV4: RegExp = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
const LOCALHOST: RegExp = /\blocalhost\b/i;
// Dotted names whose last label is alphabetic; a file name of the repository is not a host.
const DOTTED_NAME: RegExp = /(?<![\w/.-])(?:[a-z0-9-]+\.)+([a-z]{2,})(?![\w.-]*[\w])/gi;
const FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "md",
  "ts",
  "js",
  "mjs",
  "json",
  "yaml",
  "yml",
  "txt",
  "sh",
  "toml",
  "lock",
]);
// The two dated measures of other repositories the brief retired, in digits or in words. A
// digit group inside a date or a longer number is not a count.
const RETIRED_NUMBERS: readonly RegExp[] = [
  /(?<![\d.,-])(?:17|20)(?![\d.,-]*\d)/,
  /\bdix[\s-]+sept\b/i,
  /\bvingts?\b/i,
];

type Tracked = (path: string) => boolean;

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

/**
 * The prose sentences of a markdown text: paragraphs and list items joined across their
 * wrapped lines, emphasis removed, split after a full stop, a question or an exclamation
 * mark. Headings and table rows are not prose.
 */
function sentences(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length > 0) blocks.push(current.join(" "));
    current = [];
  };
  for (const raw of markdown.split("\n")) {
    const line: string = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("|")) {
      flush();
      continue;
    }
    const item: RegExpMatchArray | null = line.match(/^(?:-|\d+\.)\s+(.*)$/);
    if (item !== null) {
      flush();
      current.push(item[1] ?? "");
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks.flatMap((block: string): string[] =>
    block
      .replaceAll("**", "")
      .replace(/\s+/g, " ")
      .split(/(?<=[.?!])\s+/)
      .map((sentence: string): string => sentence.trim())
      .filter((sentence: string): boolean => sentence !== ""),
  );
}

function citedPaths(markdown: string): string[] {
  const paths: Set<string> = new Set();
  for (const match of markdown.matchAll(CODE_SPAN_PATH)) {
    const path: string | undefined = match[1];
    if (path !== undefined) paths.add(path.replace(/\/$/, ""));
  }
  for (const match of markdown.matchAll(LINK_TARGET)) {
    const target: string = (match[1] ?? "").split("#")[0] ?? "";
    // A URL is the host control's business; a bare anchor points inside the note.
    if (target === "" || SCHEME.test(target)) continue;
    paths.add(posix.normalize(posix.join(posix.dirname(DOCUMENT), target)).replace(/\/$/, ""));
  }
  return [...paths].sort();
}

function hasHost(markdown: string): boolean {
  if (URL_SCHEME.test(markdown) || IPV4.test(markdown) || LOCALHOST.test(markdown)) return true;
  for (const match of markdown.matchAll(DOTTED_NAME)) {
    const last: string = (match[1] ?? "").toLowerCase();
    if (!FILE_EXTENSIONS.has(last)) return true;
  }
  return false;
}

/** Every structural problem of the note, by stable identifier; empty when it conforms. */
function problemsOf(markdown: string, tracked: Tracked, instance: string): string[] {
  const problems: string[] = [];
  const lines: string[] = markdown.split("\n");

  if (JSON.stringify(headings(markdown)) !== JSON.stringify(SECTIONS)) problems.push("sections");
  if (!lines.includes(CASE_HEADER)) problems.push("case-table-header");
  if (!lines.includes(MUTANT_HEADER)) problems.push("mutant-table-header");

  const questions: string[] = sectionBody(markdown, QUESTION_SECTION).split("\n");
  if (!questions.includes(QUESTION_ONE)) problems.push("question-one");
  if (!questions.includes(QUESTION_TWO)) problems.push("question-two");

  const all: string[] = sentences(markdown);
  for (const rule of RULES) {
    const missing: boolean = rule.required.some(
      ({ section, sentence }): boolean =>
        !sentences(sectionBody(markdown, section)).includes(sentence),
    );
    const contradicting: boolean = all.some(
      (sentence: string): boolean =>
        rule.subject.test(sentence) && !rule.allowed.includes(sentence),
    );
    if (missing || contradicting) problems.push(rule.id);
  }
  if (!instance.split("\n").includes(SPAWN_CLEAN_ENV)) problems.push("instance-claim:spawnClean");

  const cited: string[] = citedPaths(markdown);
  for (const path of REQUIRED_CITATIONS) {
    if (!cited.includes(path)) problems.push(`not-cited:${path}`);
  }
  for (const path of cited) {
    if (!tracked(path)) problems.push(`not-tracked:${path}`);
  }

  if (MACHINE_LOCAL_PATHS.some((pattern: RegExp): boolean => pattern.test(markdown))) {
    problems.push("machine-local-path");
  }
  if (DEFAULT_BRANCH_REFS.some((pattern: RegExp): boolean => pattern.test(markdown))) {
    problems.push("default-branch-name");
  }
  if (hasHost(markdown)) problems.push("host-name");
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

/** The tracked files of the repository; an unreadable index fails the suite, never a zero. */
function trackedFiles(): ReadonlySet<string> {
  const result = Bun.spawnSync(["git", "-C", ROOT, "ls-files", "-z"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const files: string[] = new TextDecoder()
    .decode(result.stdout)
    .split("\0")
    .filter((path: string): boolean => path !== "");
  if (result.exitCode !== 0 || files.length === 0) {
    throw new Error(
      `git ls-files gave no tracked file: ${new TextDecoder().decode(result.stderr)}`,
    );
  }
  return new Set(files);
}

const TRACKED: ReadonlySet<string> = trackedFiles();
const inIndex: Tracked = (path: string): boolean =>
  TRACKED.has(path) || [...TRACKED].some((file: string): boolean => file.startsWith(`${path}/`));
const note: string = readFileSync(join(ROOT, DOCUMENT), "utf8");
const instanceSource: string = readFileSync(join(ROOT, INSTANCE), "utf8");

const heading = (index: number): string => `## ${SECTIONS[index] ?? ""}\n`;
// Assembled from parts: the hygiene gates of this repository scan this file too.
const parts = (...pieces: string[]): string => pieces.join("");
const BRANCH: string = parts("ma", "in");
const ANCHOR: string = "Un outil de flotte (un gate";
const insert = (markdown: string, text: string): string =>
  mutate(markdown, ANCHOR, `${text} ${ANCHOR}`);
const append = (markdown: string, text: string): string => `${markdown}\n${text}\n`;

interface RedCase {
  readonly name: string;
  readonly mutant: (markdown: string) => string;
  readonly tracked?: Tracked;
  readonly instance?: (source: string) => string;
  readonly problems: readonly string[];
}

const RED_CASES: readonly RedCase[] = [
  {
    name: "a section whose heading is removed",
    mutant: (markdown) => mutate(markdown, heading(3), "Table de cas\n"),
    problems: ["sections"],
  },
  {
    name: "two sections exchanged",
    mutant: (markdown) =>
      mutate(
        mutate(mutate(markdown, heading(1), "## @@\n"), heading(2), heading(1)),
        "## @@\n",
        heading(2),
      ),
    // The spawnClean sentences now sit under the heading of the other section.
    problems: ["sections", "spawnclean-instance"],
  },
  {
    name: "a section added",
    mutant: (markdown) => mutate(markdown, heading(7), `## Annexe\n\n${heading(7)}`),
    problems: ["sections"],
  },
  {
    name: "two columns of the case table exchanged",
    mutant: (markdown) =>
      mutate(markdown, "| Nom | État initial | Arguments |", "| Nom | Arguments | État initial |"),
    problems: ["case-table-header"],
  },
  {
    name: "a column of the mutant table dropped",
    mutant: (markdown) => mutate(markdown, "| Identifiant du mutant | Fichier |", "| Fichier |"),
    problems: ["mutant-table-header"],
  },
  {
    name: "the first question moved out of its section",
    mutant: (markdown) => append(mutate(markdown, `${QUESTION_ONE}\n`, ""), QUESTION_ONE),
    problems: ["question-one"],
  },
  {
    name: "the second question reworded",
    mutant: (markdown) => mutate(markdown, "le ferait-il rougir aussi ?", "le casserait-il ?"),
    problems: ["question-two"],
  },
  {
    name: "the no-op said to be a deletion",
    mutant: (markdown) => mutate(markdown, "un no-op, jamais", "un no-op, ou"),
    problems: ["never-deleted"],
  },
  {
    name: "the no-op rule moved out of the proof section",
    mutant: (markdown) =>
      append(
        mutate(markdown, "La ligne décisive est remplacée par un no-op, jamais\n  supprimée. ", ""),
        NO_OP_SENTENCE,
      ),
    problems: ["never-deleted"],
  },
  {
    name: "a deleted line admitted in another section",
    mutant: (markdown) => insert(markdown, "Une ligne décisive supprimée est admise."),
    problems: ["never-deleted"],
  },
  {
    name: "a mutant identical to the original admitted instead of refused",
    mutant: (markdown) =>
      mutate(
        markdown,
        "l'original fait échouer la\n  suite,",
        "l'original est admis par la\n  suite,",
      ),
    problems: ["differs-from-original"],
  },
  {
    name: "an identical mutant and a deleted line admitted by an added sentence",
    mutant: (markdown) =>
      append(
        markdown,
        "Un mutant identique à l'original est admis, de même qu'une ligne supprimée.",
      ),
    problems: ["never-deleted", "differs-from-original"],
  },
  {
    name: "the answers made optional",
    mutant: (markdown) =>
      mutate(markdown, OBLIGATION_SENTENCE, "Chacune des deux réponses est facultative."),
    problems: ["answers-required"],
  },
  {
    name: "an optional answer admitted in another section",
    mutant: (markdown) => insert(markdown, "La réponse est facultative."),
    problems: ["answers-required"],
  },
  {
    name: "the obligation moved out of its section",
    mutant: (markdown) =>
      append(mutate(markdown, `${OBLIGATION_SENTENCE}\n`, ""), OBLIGATION_SENTENCE),
    problems: ["answers-required"],
  },
  {
    name: "spawnClean said to reduce PATH",
    mutant: (markdown) => mutate(markdown, "`spawnClean` n'est pas une", "`spawnClean` est une"),
    problems: ["spawnclean-instance"],
  },
  {
    name: "spawnClean named as the reduced-PATH implementation in another section",
    mutant: (markdown) => insert(markdown, "Le `PATH` réduit est implémenté par `spawnClean`."),
    problems: ["spawnclean-instance"],
  },
  {
    name: "the instance no longer passes the inherited PATH",
    mutant: (markdown) => markdown,
    instance: (source) =>
      mutate(
        source,
        SPAWN_CLEAN_ENV,
        'const CLEAN_ENV = { PATH: join(scratch, "bin"), HOME: scratch };',
      ),
    problems: ["instance-claim:spawnClean"],
  },
  ...REQUIRED_CITATIONS.map(
    (path: string): RedCase => ({
      name: `${path} no longer cited`,
      mutant: (markdown) => mutate(markdown, `\`${path}\``, "une autre note"),
      problems: [`not-cited:${path}`],
    }),
  ),
  ...REQUIRED_CITATIONS.map(
    (path: string): RedCase => ({
      name: `${path} cited but not tracked`,
      mutant: (markdown) => markdown,
      tracked: (candidate: string): boolean => candidate !== path && inIndex(candidate),
      problems: [`not-tracked:${path}`],
    }),
  ),
  {
    name: "a cited path in a code span that no tracked file answers",
    mutant: (markdown) => insert(markdown, "`tools/quality/no-such-tool.ts`"),
    problems: ["not-tracked:tools/quality/no-such-tool.ts"],
  },
  {
    name: "a cited directory without extension that is not tracked",
    mutant: (markdown) => insert(markdown, "`tools/no-such-directory/`"),
    problems: ["not-tracked:tools/no-such-directory"],
  },
  {
    name: "a link whose target no tracked file answers",
    mutant: (markdown) => insert(markdown, "[outil](../../tools/quality/no-such-tool.ts)"),
    problems: ["not-tracked:tools/quality/no-such-tool.ts"],
  },
  {
    name: "a link to a path present on disk but untracked",
    mutant: (markdown) => insert(markdown, "[dépôt](../../.git)"),
    problems: ["not-tracked:.git"],
  },
  ...[
    ["a home directory with a trailing slash", parts("/Us", "ers/someone/notes.md")],
    ["a home directory without a trailing slash", parts("/Us", "ers/someone")],
    ["a Linux home directory", parts("/ho", "me/someone")],
    ["a temporary folder of the system", parts("/va", "r/folders/wq/x")],
    ["a private temporary directory", parts("/priv", "ate/tmp/x")],
    ["a Windows profile", parts("C:", "\\Users\\someone")],
  ].map(
    ([name, text]): RedCase => ({
      name: `machine-local path: ${name}`,
      mutant: (markdown) => insert(markdown, `${text ?? ""}.`),
      problems: ["machine-local-path"],
    }),
  ),
  ...[
    ["a remote-tracking ref", parts("origin/", BRANCH)],
    ["a revision expression", parts(BRANCH, ":docs/README.md")],
    ["a REST ref parameter", parts("contents?ref=", BRANCH)],
    ["a branch option", parts("--branch ", BRANCH)],
    ["a workflow filter", parts("branches: [", BRANCH, "]")],
    ["a full ref", parts("refs/heads/", "mas", "ter")],
  ].map(
    ([name, text]): RedCase => ({
      name: `default branch: ${name}`,
      mutant: (markdown) => insert(markdown, `Voir ${text ?? ""}.`),
      problems: ["default-branch-name"],
    }),
  ),
  ...[
    ["a host name of a listed TLD", parts("forge.example", ".org")],
    ["a host name of an unlisted TLD", parts("forge.example", ".internal")],
    ["an IP address with a port", parts("10.0", ".0.1:8080")],
    ["a bare IP address", parts("192.168", ".1.10")],
    ["localhost", parts("local", "host:3000")],
    ["a URL", parts("https", "://x/y")],
  ].map(
    ([name, text]): RedCase => ({
      name: `host: ${name}`,
      mutant: (markdown) => insert(markdown, `Sur ${text ?? ""}.`),
      problems: ["host-name"],
    }),
  ),
  ...[
    ["mutants in digits", "Bilan : 20 mutants."],
    ["mutants in words", "Bilan : vingt mutants."],
    ["mutants, count after the noun", "Mutants : 20, tous tués."],
    ["scripts in words", "Un script sur dix-sept."],
    ["scripts in words, no hyphen", "Un script sur dix sept."],
    ["scripts in digits", "Un des 17 scripts."],
    ["scripts, « sur 17 »", "Un script sur 17."],
  ].map(
    ([name, text]): RedCase => ({
      name: `retired number: ${name}`,
      mutant: (markdown) => insert(markdown, text ?? ""),
      problems: ["retired-number"],
    }),
  ),
];

// Inputs a control must not refuse: each was a false positive or sits next to a refused form.
const GREEN_CASES: readonly (readonly [string, string])[] = [
  ["the French word « main »", `Écrit à la ${BRANCH}, puis relu.`],
  ["a date whose day is a retired number", "Mesuré le 2026-11-17 et le 2026-11-20."],
  ["a repository file name", "Voir `tools/quality/mutants.v1.json`."],
];

describe("docs/method/GATE-TESTING.md", () => {
  test("conforms, and prints what was examined", () => {
    const cited: string[] = citedPaths(note);
    const governed: number = sentences(note).filter((sentence: string): boolean =>
      RULES.some((rule: NormativeRule): boolean => rule.subject.test(sentence)),
    ).length;
    console.log(
      `gate-testing-doc: ${headings(note).length} section(s) of ${SECTIONS.length} expected; ` +
        `${cited.length} cited path(s), ${cited.filter(inIndex).length} tracked, ` +
        `${TRACKED.size} file(s) in the index; ${sentences(note).length} sentence(s), ` +
        `${governed} under ${RULES.length} normative rule(s); ` +
        `${RED_CASES.length} red case(s), ${GREEN_CASES.length} green case(s)`,
    );
    expect(problemsOf(note, inIndex, instanceSource)).toEqual([]);
    expect(headings(note)).toEqual([...SECTIONS]);
    expect(cited).toEqual(expect.arrayContaining([...REQUIRED_CITATIONS]));
  });

  test("an empty document fails every presence control", () => {
    expect(problemsOf("", inIndex, instanceSource)).toEqual([
      "sections",
      "case-table-header",
      "mutant-table-header",
      "question-one",
      "question-two",
      ...RULES.map((rule: NormativeRule): string => rule.id),
      ...REQUIRED_CITATIONS.map((path: string): string => `not-cited:${path}`),
    ]);
  });

  test("a mutation that matches nowhere, twice, or changes nothing is refused", () => {
    expect(() => mutate(note, "no such text anywhere", "x")).toThrow();
    expect(() => mutate(note, "## ", "### ")).toThrow();
    expect(() => mutate(note, NO_OP_SENTENCE, NO_OP_SENTENCE)).toThrow();
  });

  test("the untracked link target of the red cases exists on disk", () => {
    expect(existsSync(join(ROOT, ".git"))).toBe(true);
    expect(inIndex(".git")).toBe(false);
  });

  // Each red case is a pair: the note has no problem, its mutant has exactly the ones named.
  test.each(
    RED_CASES.map((redCase: RedCase): [string, RedCase] => [redCase.name, redCase]),
  )("red: %s", (_name: string, redCase: RedCase) => {
    const mutant: string = redCase.mutant(note);
    const instance: string = (redCase.instance ?? ((source: string): string => source))(
      instanceSource,
    );
    expect(problemsOf(mutant, redCase.tracked ?? inIndex, instance)).toEqual([...redCase.problems]);
  });

  test.each(
    GREEN_CASES.map(([name, text]): [string, string] => [name, text]),
  )("green: %s", (_name: string, text: string) => {
    expect(problemsOf(insert(note, text), inIndex, instanceSource)).toEqual([]);
  });
});
