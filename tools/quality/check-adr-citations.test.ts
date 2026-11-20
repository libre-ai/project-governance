import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type Citation,
  CONFIG_PATH,
  classifyCitation,
  countRawCitations,
  type EvaluateInput,
  evaluate,
  findCitations,
  findRedirects,
  patternMatches,
  readScope,
  type Scope,
  sumViolation,
} from "./check-adr-citations";

const SCOPE: Scope = {
  convention: "ADR-NNNN is this repository's series",
  localForm: "ADR-NNNN",
  documents: ["docs/decisions/*.md"],
  foreignRepositories: ["control-plane"],
};
const DOC = "docs/decisions/INVARIANTS.md";
const ADR_0047 = "docs/adr/0047-decision-binding-vectors-lock.md";
const ACCEPTED_ADR = "# ADR-0047\n\n- **Statut :** Accepted\n- **Arbitrage :** owner\n";

/** A tree of tracked files, all present unless listed in `absent`. */
function input(files: Record<string, string>, absent: readonly string[] = []): EvaluateInput {
  const tracked = Object.keys(files);
  return {
    scope: SCOPE,
    tracked,
    present: new Set(tracked.filter((path) => !absent.includes(path))),
    read: (path) => files[path] ?? null,
  };
}

function withDocument(text: string, extra: Record<string, string> = {}): EvaluateInput {
  return input({ [DOC]: text, [ADR_0047]: ACCEPTED_ADR, ...extra });
}

function citation(text: string): Citation {
  const found = findCitations(DOC, text);
  const first = found[0];
  if (found.length !== 1 || first === undefined) {
    throw new Error(`expected one citation in ${JSON.stringify(text)}, got ${found.length}`);
  }
  return first;
}

const LOCAL = new Set(["0047"]);
const FOREIGN = new Set(["control-plane"]);

describe("bare citations (F3, F4)", () => {
  test("`ADR 0047` with no repository before it is a bare citation, at path:line", () => {
    const { violations, counters } = evaluate(withDocument("# Invariants\n\nSee ADR 0047.\n"));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toStartWith(`${DOC}:3: bare ADR citation \`ADR 0047\``);
    expect(counters.bare).toBe(1);
  });

  test("`ADR 0047` at the start of a line has no qualifier and is bare", () => {
    expect(classifyCitation(citation("ADR 0047 binds vectors"), LOCAL, FOREIGN)).toBe("bare");
  });

  test("`ADR-003` (three digits) is bare", () => {
    const { violations } = evaluate(withDocument("Cites ADR-003 here.\n"));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(`${DOC}:1: bare ADR citation \`ADR-003\``);
    expect(violations[0]).toContain("four digits");
  });

  test("`ADR-3`, `ADR0047` and a non-ASCII hyphen are bare", () => {
    for (const text of ["ADR-3", "ADR0047", "ADR\u{2011}0047", "ADR\u{00a0}0047", "ADR  0047"]) {
      expect(classifyCitation(citation(text), LOCAL, FOREIGN)).toBe("bare");
    }
  });
});

describe("qualified citations (F1, F2)", () => {
  test("`control-plane ADR 0047` is a qualified foreign citation", () => {
    const { violations, counters } = evaluate(
      withDocument("| I-08 | co-sourced by the control-plane ADR 0047 |\n"),
    );
    expect(violations).toEqual([]);
    expect(counters.foreign).toBe(1);
    expect(counters.bare).toBe(0);
  });

  test("a qualifier in backticks or bold is unwrapped", () => {
    expect(classifyCitation(citation("`control-plane` ADR 0047"), LOCAL, FOREIGN)).toBe(
      "foreign-qualified",
    );
    expect(classifyCitation(citation("**control-plane** ADR 0047"), LOCAL, FOREIGN)).toBe(
      "foreign-qualified",
    );
  });

  test("`inconnu ADR 0047`, a repository absent from foreignRepositories, is a violation", () => {
    const { violations, counters } = evaluate(withDocument("Per inconnu ADR 0047.\n"));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(`${DOC}:1: bare ADR citation \`ADR 0047\``);
    expect(violations[0]).toContain(
      '"inconnu" before it is not a repository listed in foreignRepositories',
    );
    expect(counters.foreign).toBe(0);
  });

  test("`ADR-0047` with docs/adr/0047-*.md tracked is a local citation", () => {
    const { violations, counters } = evaluate(withDocument("Per ADR-0047.\n"));
    expect(violations).toEqual([]);
    expect(counters.local).toBe(1);
  });

  test("`ADR-9999` with no docs/adr/9999-*.md is a violation", () => {
    const { violations, counters } = evaluate(withDocument("Per ADR-9999.\n"));
    expect(violations).toEqual([
      `${DOC}:1: \`ADR-9999\` cites this repository's series, and no tracked docs/adr/9999-*.md exists`,
    ]);
    expect(counters.local).toBe(1);
  });

  test("a local ADR file tracked but absent from the checkout does not make `ADR-0047` resolve", () => {
    const { violations } = evaluate(
      input({ [DOC]: "Per ADR-0047.\n", [ADR_0047]: ACCEPTED_ADR }, [ADR_0047]),
    );
    expect(violations).toEqual([
      `${DOC}:1: \`ADR-0047\` cites this repository's series, and no tracked docs/adr/0047-*.md exists`,
      `${ADR_0047}:0: ADR file cannot be read, so it cannot be judged as a redirection`,
    ]);
  });

  test("the hyphen form is never read as foreign, and a space form is never local", () => {
    expect(classifyCitation(citation("ADR-0048"), LOCAL, FOREIGN)).toBe("unknown-local");
    expect(classifyCitation(citation("ADR 0047"), LOCAL, FOREIGN)).toBe("bare");
  });

  test("a repository name before the hyphen form is a qualifier, and the pair is a violation", () => {
    // `control-plane ADR-0047` would otherwise be checked against the local 0047:
    // the very collision this gate exists to keep apart.
    for (const text of [
      "control-plane ADR-0047",
      "`inconnu` ADR-0047",
      "project-governance ADR-0047",
      "libre-ai/control-plane ADR-0047",
    ]) {
      expect(classifyCitation(citation(text), LOCAL, FOREIGN)).toBe("bare");
    }
    const { violations, counters } = evaluate(withDocument("Per control-plane ADR-0047.\n"));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toStartWith(`${DOC}:1: bare ADR citation \`ADR-0047\``);
    expect(violations[0]).toContain('"control-plane" before it names a repository');
    expect(counters.local).toBe(0);
  });

  test("a prose word before the hyphen form is not a qualifier", () => {
    for (const text of ["par ADR-0047", "amende ADR-0047", "the ADR-0047", "I-23, ADR-0047"]) {
      expect(classifyCitation(citation(text), LOCAL, FOREIGN)).toBe("local");
    }
  });
});

describe("separators and lists", () => {
  test("any non-alphanumeric run between `ADR` and the digits is read, and is bare", () => {
    for (const text of [
      "ADR #0047",
      "ADR_0047",
      "ADR:0047",
      "ADR.0047",
      "ADR\u{200b}0047",
      "ADR\u{00ad}0047",
      "ADR - 0047",
      "ADR/0047",
    ]) {
      expect(classifyCitation(citation(text), LOCAL, FOREIGN)).toBe("bare");
      const { violations, counters } = evaluate(withDocument(`See ${text}.\n`));
      expect(violations).toHaveLength(1);
      expect(counters.bare).toBe(1);
    }
  });

  test("every number of a slash list is read", () => {
    const found = findCitations(DOC, "(ADR-0047/9999/0048)");
    expect(found.map((c) => c.digits)).toEqual(["0047", "9999", "0048"]);
    const { violations, counters } = evaluate(withDocument("See ADR-0047/9999.\n"));
    expect(violations).toEqual([
      `${DOC}:1: \`ADR-0047/9999\` cites this repository's series, and no tracked docs/adr/9999-*.md exists`,
    ]);
    expect(counters.citations).toBe(2);
  });

  test("the plural list form `ADRs 0047 and 9999` is read and is bare", () => {
    const { violations, counters } = evaluate(withDocument("See ADRs 0047 and 9999.\n"));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("bare ADR citation `ADRs 0047`");
    expect(violations[0]).toContain("cite each decision");
    expect(counters.bare).toBe(1);
  });
});

describe("findCitations", () => {
  test("reads every citation of a line, with its line number", () => {
    const found = findCitations(DOC, "a\nADR-0001 and control-plane ADR 0047, ADR-12\n");
    expect(found.map((c) => [c.line, c.text, c.qualifier])).toEqual([
      [2, "ADR-0001", null],
      [2, "ADR 0047", "control-plane"],
      [2, "ADR-12", "0047,"],
    ]);
  });

  test("ignores `ADR` glued to a word and lowercase `adr-`", () => {
    expect(findCitations(DOC, "XADR-0001 docs/adr/0047-x.md adr-0060 ADRs")).toEqual([]);
  });
});

describe("redirection pages", () => {
  const PAGE = "docs/adr/0070-old-number.md";
  const TARGET = "docs/adr/0071-new-number.md";

  test("a target that is not a tracked file is a violation", () => {
    const { violations, counters } = evaluate(
      withDocument("Per ADR-0047.\n", {
        [PAGE]: "# Moved\n\nRedirection : docs/adr/0071-new-number.md\n",
      }),
    );
    expect(violations).toEqual([
      `${PAGE}:3: redirection target "docs/adr/0071-new-number.md" is not a tracked file`,
    ]);
    expect(counters.redirects).toBe(1);
    expect(counters.deadRedirects).toBe(1);
  });

  test("a tracked, present target passes, in bare, backtick or link form", () => {
    for (const declaration of [
      `Redirection : ${TARGET}`,
      `- **Redirection :** \`${TARGET}\``,
      `Redirection : [ADR-0071](${TARGET})`,
    ]) {
      const { violations, counters } = evaluate(
        withDocument("Per ADR-0047.\n", {
          [PAGE]: `# Moved\n\n${declaration}\n`,
          [TARGET]: ACCEPTED_ADR,
        }),
      );
      expect(violations).toEqual([]);
      expect(counters.redirects).toBe(1);
      expect(counters.deadRedirects).toBe(0);
    }
  });

  test("a target tracked but absent from the checkout is dead", () => {
    const { violations, counters } = evaluate(
      input(
        {
          [DOC]: "Per ADR-0047.\n",
          [ADR_0047]: ACCEPTED_ADR,
          [PAGE]: `Redirection : ${TARGET}\n`,
          [TARGET]: ACCEPTED_ADR,
        },
        [TARGET],
      ),
    );
    expect(violations).toEqual([
      `${TARGET}:0: ADR file cannot be read, so it cannot be judged as a redirection`,
      `${PAGE}:1: redirection target "${TARGET}" is tracked and absent from the checkout`,
    ]);
    expect(counters.deadRedirects).toBe(1);
  });

  test("a redirection page carrying a Statut or Arbitrage line is a violation", () => {
    for (const field of [
      "- **Statut :** Accepted",
      "- **Arbitrage :** owner",
      "Status: accepted",
      "## Statut",
      "### Status — accepted",
      "| Statut | accepted |",
      "| **Arbitrage** | owner |",
    ]) {
      const { violations } = evaluate(
        withDocument("Per ADR-0047.\n", {
          [PAGE]: `# Moved\n\nRedirection : ${TARGET}\n\n${field}\n`,
          [TARGET]: ACCEPTED_ADR,
        }),
      );
      expect(violations).toEqual([
        `${PAGE}:5: redirection page carries a decision field (Statut, Status or Arbitrage)`,
      ]);
    }
  });

  test("a redirection mention that does not parse, a self target and an escaping path are violations", () => {
    const cases: Record<string, string> = {
      "Redirection vers le nouveau dépôt": "malformed redirection declaration",
      [`Redirection : ${PAGE}`]: "redirection page points at itself",
      "Redirection : ../outside.md": "is not a path from the repository root",
      "Redirection : https://example.org/x": "is not a path from the repository root",
    };
    for (const [line, motif] of Object.entries(cases)) {
      const { violations, counters } = evaluate(
        withDocument("Per ADR-0047.\n", { [PAGE]: `# Moved\n${line}\n` }),
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain(motif);
      expect(counters.deadRedirects).toBe(1);
    }
  });

  test("a declaration after the tenth line does not make a redirection page", () => {
    const late = `${"line\n".repeat(10)}Redirection : ${TARGET}\n`;
    expect(findRedirects(new Map([[PAGE, late]]))).toEqual([]);
    const early = `${"line\n".repeat(9)}Redirection : ${TARGET}\n`;
    expect(findRedirects(new Map([[PAGE, early]]))).toHaveLength(1);
  });

  test("no redirection page: the counters say zero, and the run passes", () => {
    const { violations, counters } = evaluate(withDocument("Per ADR-0047.\n"));
    expect(violations).toEqual([]);
    expect(counters.redirects).toBe(0);
    expect(counters.deadRedirects).toBe(0);
  });
});

describe("scope: empty, unreadable or unresolved is a failure", () => {
  const VALID = JSON.stringify({
    convention: "x",
    localForm: "ADR-NNNN",
    documents: ["docs/decisions/*.md"],
    foreignRepositories: ["control-plane"],
  });

  test("a valid scope is read", () => {
    expect(readScope(VALID).documents).toEqual(["docs/decisions/*.md"]);
  });

  test("empty, not JSON, or without documents: throws", () => {
    expect(() => readScope("")).toThrow("empty");
    expect(() => readScope("{")).toThrow("not JSON");
    expect(() => readScope(VALID.replace('["docs/decisions/*.md"]', "[]"))).toThrow("documents");
    expect(() => readScope(VALID.replace('"ADR-NNNN"', '"ADR NNNN"'))).toThrow("localForm");
    expect(() => readScope(VALID.replace('"convention"', '"extra":1,"convention"'))).toThrow(
      "unknown key",
    );
    expect(() => readScope(VALID.replace("docs/decisions/*.md", "docs/**/*.md"))).toThrow(
      "pattern",
    );
    expect(() => readScope(VALID.replace('"control-plane"', '"a b"'))).toThrow("repository name");
  });

  test("a pattern resolving no tracked file fails, and no document at all fails", () => {
    const { violations, counters } = evaluate(input({ [ADR_0047]: ACCEPTED_ADR }));
    expect(violations).toEqual([
      `${CONFIG_PATH}: document pattern "docs/decisions/*.md" resolves no tracked file`,
      `${CONFIG_PATH}: no document resolved; the gate has nothing to read`,
    ]);
    expect(counters.documents).toBe(0);
  });

  test("a tracked document that cannot be read fails, never counts as zero citations", () => {
    const unreadable = input({ [DOC]: "x", [ADR_0047]: ACCEPTED_ADR });
    const { violations, counters } = evaluate({ ...unreadable, read: () => null });
    expect(violations).toContain(`${DOC}:0: declared document cannot be read`);
    expect(counters.documents).toBe(0);
  });

  test("`*` matches within a segment only", () => {
    expect(patternMatches("docs/architecture/*.md", "docs/architecture/TARGET.md")).toBe(true);
    expect(patternMatches("docs/architecture/*.md", "docs/architecture/forge/README.md")).toBe(
      false,
    );
    expect(patternMatches("AGENTS.md", "AGENTSxmd")).toBe(false);
  });
});

describe("counters", () => {
  test("the seven counters are reported and citations = local + foreign + bare", () => {
    const { counters } = evaluate(
      withDocument("ADR-0047, ADR-9999, control-plane ADR 0047, ADR 0001, ADR-3\n", {
        "docs/adr/0070-old.md": "Redirection : docs/adr/0071-new.md\n",
      }),
    );
    expect(counters).toEqual({
      documents: 1,
      citations: 5,
      local: 2,
      foreign: 1,
      bare: 2,
      redirects: 1,
      deadRedirects: 1,
    });
    expect(counters.citations).toBe(counters.local + counters.foreign + counters.bare);
  });

  test("citations are counted from the raw matches of the whole text, not from the classified list", () => {
    expect(countRawCitations("ADR-0047/0048\nADR 0001 and ADR\u{200b}12\nadr-1 XADR-1\n")).toBe(4);
  });

  test("the sum check fails when the classified citations do not add up to the raw count", () => {
    const counters = {
      documents: 1,
      citations: 3,
      local: 1,
      foreign: 1,
      bare: 0,
      redirects: 0,
      deadRedirects: 0,
    };
    expect(sumViolation(counters)).toBe(
      "internal: citations=3 (raw matches) differs from local+foreign+bare=2",
    );
    expect(sumViolation({ ...counters, bare: 1 })).toBeNull();
  });
});

// ------------------------------------------------------------- process ---

/**
 * The gate run as a process against a fixture repository: the effectful half
 * (`git ls-files`, reading the scope file, the exit code, the printed line) is
 * not reached by the unit tests above. Each child gets a scrubbed environment so
 * that an ambient `GIT_DIR` or global config cannot point it at another index.
 */
const GATE = join(import.meta.dir, "check-adr-citations.ts");
const ENV = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  NO_COLOR: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, argv: readonly string[]): void {
  const result = Bun.spawnSync(["git", ...argv], { cwd, stdout: "pipe", stderr: "pipe", env: ENV });
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(`fixture setup failed: git ${argv.join(" ")} — ${result.stderr.toString()}`);
  }
}

function fixture(root: string, files: Record<string, string>): string {
  mkdirSync(root, { recursive: true });
  git(root, ["init", "--quiet"]);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    git(root, ["add", "--", path]);
  }
  return root;
}

function runGate(cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", GATE], { cwd, stdout: "pipe", stderr: "pipe", env: ENV });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("the gate as a process", () => {
  let workspace: string;
  const SCOPE_FILE = JSON.stringify(SCOPE);

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), "adr-citations-probe-"));
  });
  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test("a clean tree exits 0 and prints its counters", () => {
    const root = fixture(join(workspace, "clean"), {
      [CONFIG_PATH]: SCOPE_FILE,
      [DOC]: "Per ADR-0047 and the control-plane ADR 0047.\n",
      [ADR_0047]: ACCEPTED_ADR,
    });
    const run = runGate(root);
    expect(run.stdout.trim()).toBe(
      "ADR citations verified — documents=1 citations=2 (local=1 foreign=1 bare=0) redirects=0 dead-redirects=0",
    );
    expect(run.exitCode).toBe(0);
  });

  test("a bare citation exits 1 with path:line", () => {
    const root = fixture(join(workspace, "bare"), {
      [CONFIG_PATH]: SCOPE_FILE,
      [DOC]: "Per ADR 0047.\n",
      [ADR_0047]: ACCEPTED_ADR,
    });
    const run = runGate(root);
    expect(run.stderr).toContain(`${DOC}:1: bare ADR citation`);
    expect(run.exitCode).toBe(1);
  });

  test("an empty scope file exits 1, never 0", () => {
    const root = fixture(join(workspace, "empty"), { [CONFIG_PATH]: "", [ADR_0047]: ACCEPTED_ADR });
    const run = runGate(root);
    expect(run.stderr).toContain(`ADR citations failed: ${CONFIG_PATH}: empty`);
    expect(run.exitCode).toBe(1);
  });

  test("a missing scope file exits 1, never 0", () => {
    const root = fixture(join(workspace, "missing"), { [ADR_0047]: ACCEPTED_ADR });
    const run = runGate(root);
    expect(run.stderr).toContain("ADR citations failed:");
    expect(run.exitCode).toBe(1);
  });
});
