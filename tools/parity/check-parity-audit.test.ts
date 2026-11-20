import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyName, parseRange, parseRepositoryMap } from "./check-parity-audit";

// Expected values come from the lot definition and the method
// (docs/method/PARITY-AUDIT-METHOD.md, section « Fiches de ligne et
// complétude »): a removed fiche exits 1, an unallowed revision or a section
// out of order exits 4, an absent matrix exits 2 with nothing on stdout.

const ALPHA = "a".repeat(40);
const BETA = "0123456789abcdef0123456789abcdef01234567";

const MATRIX = `${[
  "| # | fonctionnalité | alpha @ v1 | beta @ v2 | verdict | décision | source | preuve |",
  "| - | -------------- | ---------- | --------- | ------- | -------- | ------ | ------ |",
  "| 1 | import | natif | partiel | reprendre | | alpha | |",
  "| 2 | export | partiel | natif | adapter | | beta | |",
  "| 3 | recherche | non mesuré | non mesuré | réécrire | | | |",
  "| 4 | partage public | natif | natif | exclure | D34 | | |",
].join("\n")}\n`;

const MAP = JSON.stringify({ format: 1, copies: { alpha: ALPHA, beta: BETA }, depots: ["a", "b"] });

function fiche(fields: readonly string[], sections: readonly string[]): string {
  return [
    "---",
    ...fields,
    "---",
    ...sections.flatMap((title) => [`## ${title}`, "", "non mesuré", ""]),
  ].join("\n");
}

const REFERENCES = ["alpha @ v1", "beta @ v2"];
const KEPT = [...REFERENCES, "Retenu", "Test d'acceptation"];

const FICHES: Readonly<Record<string, string>> = {
  "01-import.md": `${fiche(
    [
      "format: 1",
      "ligne: 1",
      "verdict: reprendre",
      "depot: a",
      `source: alpha@${ALPHA}:src/io.ts:10-20`,
    ],
    KEPT,
  )}\nmesuré : alpha@${ALPHA}:src/io.ts:12.\n`,
  "02.md": fiche(
    ["format: 1", "ligne: 2", "verdict: adapter", "depot: b", `source: beta@${BETA}:lib/x.ts`],
    KEPT,
  ),
  "03.md": fiche(
    ["format: 1", "ligne: 3", "verdict: réécrire", "depot: a", "source: aucune"],
    KEPT,
  ),
  "04.md": fiche(
    ["format: 1", "ligne: 4", "verdict: exclure", "decision: D34"],
    [...REFERENCES, "Motif"],
  ),
  "notes.txt": "not a fiche\n",
};

const COMPLETE_COUNTS = [
  "lines=4 fiches=4 source=3 verdict=4 depot=3 source_sha_allowed=3 excluded=1",
  "examined: files=5 ignored=1 misnamed=0 unplaced=0 out_of_range=0 in_range=4 malformed=0 citations=3 citations_allowed=3 copies_allowed=2 matrix_lines=4",
];

const root = mkdtempSync(join(tmpdir(), "parity-audit-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let fixtures = 0;

interface Fixture {
  readonly matrix: string;
  readonly map: string;
  readonly fiches: string;
}

/** A fresh audit directory; `null` removes a fiche of the complete set. */
function fixture(
  changes: Readonly<Record<string, string | null>> = {},
  overrides: { readonly matrix?: string; readonly map?: string } = {},
): Fixture {
  fixtures += 1;
  const directory = join(root, `audit-${fixtures}`);
  const fiches = join(directory, "fiches");
  mkdirSync(fiches, { recursive: true });
  const matrix = join(directory, "matrix.md");
  const map = join(directory, "map.json");
  writeFileSync(matrix, overrides.matrix ?? MATRIX);
  writeFileSync(map, overrides.map ?? MAP);
  for (const [name, text] of Object.entries({ ...FICHES, ...changes })) {
    if (text !== null) writeFileSync(join(fiches, name), text);
  }
  return { matrix, map, fiches };
}

const script = join(import.meta.dir, "check-parity-audit.ts");

function run(...args: string[]): { code: number; stdout: string; stderr: string } {
  // A purged environment: the child measures its case, not the ambient run.
  const result = Bun.spawnSync([process.execPath, script, ...args], { env: {} });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function check(audit: Fixture, ...extra: string[]): ReturnType<typeof run> {
  return run("--matrix", audit.matrix, "--map", audit.map, "--fiches", audit.fiches, ...extra);
}

describe("a complete audit", () => {
  test("exits 0 and prints the two counter lines", () => {
    const result = check(fixture());
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toEqual(COMPLETE_COUNTS);
  });

  test("a range counts only its rows and sets the others apart", () => {
    const result = check(fixture(), "--lines", "2-3");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("lines=2 fiches=2 ");
    expect(result.stdout).toContain(" out_of_range=2 in_range=2 ");
  });
});

describe("a gap in the count exits 1", () => {
  test("a removed fiche: fiches=L-1", () => {
    const result = check(fixture({ "02.md": null }));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("lines=4 fiches=3 ");
    expect(result.stderr).toContain("gap: missing fiche for line(s) 2");
  });

  test("a removed fiche inside a range", () => {
    expect(check(fixture({ "02.md": null }), "--lines", "2").code).toBe(1);
  });

  test("a fiche whose verdict disagrees with the matrix", () => {
    const changed = FICHES["02.md"]?.replace("verdict: adapter", "verdict: reprendre") ?? "";
    const result = check(fixture({ "02.md": changed }));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(" verdict=3 ");
  });

  test("a kept row without a target repository", () => {
    const changed = FICHES["02.md"]?.replace("depot: b\n", "") ?? "";
    const result = check(fixture({ "02.md": changed }));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(" source=3 verdict=4 depot=2 ");
  });

  test("a kept row without a source", () => {
    const changed = FICHES["02.md"]?.replace(/source: .*\n/, "") ?? "";
    const result = check(fixture({ "02.md": changed }));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(" source=2 ");
  });

  test("a fiche for a row the matrix does not have", () => {
    const result = check(fixture({ "09.md": FICHES["02.md"] ?? "" }));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(" unplaced=1 ");
  });
});

describe("a malformed fiche exits 4", () => {
  const replaced = (name: string, from: string | RegExp, to: string): Record<string, string> => ({
    [name]: (FICHES[name] ?? "").replace(from, to),
  });

  test.each([
    ["a revision the map does not allow (a branch)", replaced("02.md", BETA, "main")],
    ["a revision in upper case", replaced("02.md", BETA, BETA.toUpperCase())],
    ["a short revision", replaced("02.md", BETA, BETA.slice(0, 7))],
    ["a copy the map does not list", replaced("02.md", `beta@${BETA}`, `gamma@${BETA}`)],
    [
      "an unallowed citation in a section",
      { "02.md": `${FICHES["02.md"]}\nvoir alpha@v1.2.0:src/a.ts\n` },
    ],
    [
      "a section out of order",
      replaced(
        "02.md",
        /## Retenu([\s\S]*)## Test d'acceptation/,
        "## Test d'acceptation$1## Retenu",
      ),
    ],
    ["a missing section", replaced("02.md", "## beta @ v2", "### beta @ v2")],
    ["an extra section", { "02.md": `${FICHES["02.md"]}\n## Annexe\n` }],
    ["an unknown verdict", replaced("02.md", "verdict: adapter", "verdict: copier")],
    ["an unknown field", replaced("02.md", "format: 1\n", "format: 1\nauteur: x\n")],
    ["fields out of order", replaced("02.md", "format: 1\nligne: 2", "ligne: 2\nformat: 1")],
    ["another format version", replaced("02.md", "format: 1", "format: 2")],
    ["a line field that is not the file number", replaced("02.md", "ligne: 2", "ligne: 3")],
    ["a target repository the map does not list", replaced("02.md", "depot: b", "depot: c")],
    [
      "aucune with another verdict than réécrire",
      replaced("02.md", `source: beta@${BETA}:lib/x.ts`, "source: aucune"),
    ],
    [
      "aucune beside a citation",
      replaced("03.md", "source: aucune", `source: aucune\nsource: beta@${BETA}:x`),
    ],
    [
      "a source that is not one citation",
      replaced("02.md", `source: beta@${BETA}:lib/x.ts`, "source: lib-x (MIT)"),
    ],
    [
      "an excluded row with a source",
      replaced("04.md", "verdict: exclure", `verdict: exclure\nsource: beta@${BETA}:x`),
    ],
    [
      "an excluded row with a target repository",
      replaced("04.md", "verdict: exclure", "verdict: exclure\ndepot: a"),
    ],
    ["an excluded row without a decision", replaced("04.md", "\ndecision: D34", "")],
    ["a kept row citing a decision", replaced("02.md", `lib/x.ts\n`, "lib/x.ts\ndecision: D34\n")],
    ["a name without two digits", { "02.md": null, "2.md": FICHES["02.md"] ?? "" }],
    ["two fiches for the same line", { "02-bis.md": FICHES["02.md"] ?? "" }],
    ["an empty file", { "02.md": "" }],
  ])("%s", (_label, changes) => {
    const result = check(fixture(changes));
    expect(result.stderr).toContain("malformed: ");
    expect(result.code).toBe(4);
  });

  test("4 wins over 1", () => {
    const result = check(fixture({ "01-import.md": null, "02.md": "" }));
    expect(result.stdout).toContain(" fiches=3 ");
    expect(result.code).toBe(4);
  });

  test("an unallowed citation is counted, not dropped", () => {
    const result = check(fixture(replaced("02.md", BETA, "main")));
    expect(result.stdout).toContain(" citations=3 citations_allowed=2 ");
  });

  // The token is `<name>@<ref>:` whatever follows: an empty or decorated
  // suffix is still a citation, judged like any other (the method: « Tout
  // jeton `<nom>@<réf>:<suite>` d'une fiche est une citation »).
  test.each([
    ["a back-quoted path", "mesuré : alpha@main:`src/x.ts`"],
    ["a path after a space", "mesuré : alpha@main: src/x.ts"],
    ["a double-quoted path", 'mesuré : alpha@main:"src/x.ts"'],
    ["a single-quoted path", "mesuré : alpha@main:'src/x.ts'"],
    ["a path in parentheses", "mesuré : alpha@main:(src/x.ts)"],
    ["nothing after the colon", "mesuré : alpha@main:"],
    ["a back-quoted ref", "mesuré : alpha@`main`:src/x.ts"],
  ])("a citation at a branch with %s is counted and refused", (_label, line) => {
    const result = check(fixture({ "02.md": `${FICHES["02.md"]}\n${line}\n` }));
    expect(result.stdout).toContain(" citations=4 citations_allowed=3 ");
    expect(result.stderr).toContain("malformed: 02.md: citation not allowed by the map: alpha@");
    expect(result.code).toBe(4);
  });

  test("an allowed copy and revision with a decorated path is refused", () => {
    const line = `mesuré : alpha@${ALPHA}:\`src/io.ts\``;
    const result = check(fixture({ "02.md": `${FICHES["02.md"]}\n${line}\n` }));
    expect(result.stdout).toContain(" citations=4 citations_allowed=3 ");
    expect(result.code).toBe(4);
  });
});

describe("a fenced code block is not a section", () => {
  test.each([
    ["```", "```"],
    ["~~~", "~~~"],
    ["````md", "````"],
  ])("a `## ` line inside a %s fence", (open, close) => {
    const body = `\n${open}\n## not a section\n${close}\n`;
    const changed = (FICHES["02.md"] ?? "").replace(
      "## Retenu\n\nnon mesuré\n",
      `## Retenu\n${body}`,
    );
    const result = check(fixture({ "02.md": changed }));
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  });

  test("a section after a closed fence still counts", () => {
    const changed = `${FICHES["02.md"]}\n\`\`\`\ncode\n\`\`\`\n## Annexe\n`;
    expect(check(fixture({ "02.md": changed })).code).toBe(4);
  });

  test("a shorter fence does not close a longer one", () => {
    const body = "\n````\n```\n## not a section\n```\n````\n";
    const changed = (FICHES["02.md"] ?? "").replace(
      "## Retenu\n\nnon mesuré\n",
      `## Retenu\n${body}`,
    );
    expect(check(fixture({ "02.md": changed })).code).toBe(0);
  });
});

describe("a count not reached exits 2 with nothing on stdout", () => {
  const complete = fixture();
  const unreached = (result: ReturnType<typeof run>): void => {
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
    expect(result.code).toBe(2);
  };

  test("an absent matrix", () => {
    const result = check({ ...complete, matrix: join(root, "absent.md") });
    unreached(result);
    expect(result.stderr).toContain("cannot read the matrix");
  });

  test("an absent fiche directory", () => {
    unreached(check({ ...complete, fiches: join(root, "absent") }));
  });

  test("an absent or unreadable map, or a map without a copy", () => {
    unreached(check({ ...complete, map: join(root, "absent.json") }));
    unreached(check(fixture({}, { map: "{" })));
    unreached(
      check(fixture({}, { map: JSON.stringify({ format: 1, copies: {}, depots: ["a"] }) })),
    );
  });

  test("a matrix without a row, or with a repeated row number", () => {
    const header = MATRIX.split("\n").slice(0, 2).join("\n");
    unreached(check(fixture({}, { matrix: `${header}\n` })));
    unreached(check(fixture({}, { matrix: MATRIX.replace("| 2 | export", "| 1 | export") })));
  });

  test.each([["3-2"], ["5"], ["5-9"], ["0"], ["x"]])("the range %s", (range) => {
    unreached(check(complete, "--lines", range));
  });

  test("a broken link named as a fiche", () => {
    const audit = fixture({ "02.md": null });
    symlinkSync(join(root, "nowhere.md"), join(audit.fiches, "02.md"));
    unreached(check(audit));
  });

  // A link is never read: its target lives outside the audited directory, so
  // the fiche the count would rest on is not the one the directory holds.
  test("a link to a valid fiche outside the directory", () => {
    const audit = fixture({ "02.md": null });
    const outside = join(root, `outside-${fixtures}.md`);
    writeFileSync(outside, FICHES["02.md"] ?? "");
    symlinkSync(outside, join(audit.fiches, "02.md"));
    const result = check(audit);
    unreached(result);
    expect(result.stderr).toContain("02.md: named as a fiche, not a regular file");
  });

  test("a directory named as a fiche", () => {
    const audit = fixture({ "02.md": null });
    mkdirSync(join(audit.fiches, "02.md"));
    unreached(check(audit));
  });

  test("a named pipe named as a fiche is refused before it is read", () => {
    const audit = fixture({ "02.md": null });
    expect(Bun.spawnSync(["mkfifo", join(audit.fiches, "02.md")]).exitCode).toBe(0);
    unreached(check(audit));
  });

  test("a usage error", () => {
    unreached(run());
    unreached(run("--matrix", complete.matrix, "--map", complete.map));
    unreached(check(complete, "--fiches", complete.fiches));
    unreached(check(complete, "--extra", "x"));
  });

  // Root lists a directory whatever its mode: the case cannot be replayed
  // there, and the skip is printed, never silent.
  const isRoot = process.getuid?.() === 0;
  if (isRoot) console.error("skipped: an unlistable directory (cannot be replayed as root)");
  test.skipIf(isRoot)("an unlistable fiche directory", () => {
    const audit = fixture();
    chmodSync(audit.fiches, 0o000);
    try {
      unreached(check(audit));
    } finally {
      chmodSync(audit.fiches, 0o755);
    }
  });
});

describe("parsers", () => {
  test("a fiche is named on two digits at least", () => {
    expect(classifyName("01.md")).toEqual({ kind: "named", line: 1 });
    expect(classifyName("12-slug.md")).toEqual({ kind: "named", line: 12 });
    expect(classifyName("103.md")).toEqual({ kind: "named", line: 103 });
    for (const name of ["1.md", "001.md", "00.md", "a.md", "01 x.md"]) {
      expect(classifyName(name)).toEqual({ kind: "misnamed" });
    }
    for (const name of [".01.md", "01.txt", "README"]) {
      expect(classifyName(name)).toEqual({ kind: "ignored" });
    }
  });

  test("a range is N or A-B with A <= B", () => {
    expect(parseRange("3")).toEqual({ from: 3, to: 3 });
    expect(parseRange("2-5")).toEqual({ from: 2, to: 5 });
    for (const spec of ["5-2", "0", "-1", "1-", "a"]) expect(parseRange(spec)).toBeNull();
  });

  test("a map revision is a full lower-case sha", () => {
    const map = (revision: string): unknown => ({
      format: 1,
      copies: { alpha: revision },
      depots: ["a"],
    });
    expect(parseRepositoryMap(map(ALPHA)).ok).toBe(true);
    for (const revision of ["main", ALPHA.toUpperCase(), ALPHA.slice(0, 7)]) {
      expect(parseRepositoryMap(map(revision)).ok).toBe(false);
    }
  });
});

describe("docs/method/PARITY-AUDIT-METHOD.md", () => {
  const method = readFileSync(
    join(import.meta.dir, "..", "..", "docs", "method", "PARITY-AUDIT-METHOD.md"),
    "utf8",
  );

  test("the command the method quotes is the one this file tests", () => {
    expect(method).toContain(
      "bun tools/parity/check-parity-audit.ts --matrix <fichier-matrice> --map <carte.json> --fiches <répertoire>",
    );
    // Every counter the tool prints is named by the method.
    const names = COMPLETE_COUNTS.join(" ").match(/[a-z_]+(?==)/g) ?? [];
    expect(names.length).toBe(18);
    for (const name of names) expect(method).toContain(`\`${name}\``);
    expect(method).toContain("## Fiches de ligne et complétude");
  });
});
