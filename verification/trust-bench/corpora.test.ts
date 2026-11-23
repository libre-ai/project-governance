import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanPersonalIdentifiers } from "../../tools/quality/check-personal-data-boundary";
import {
  CORPUS_DIRECTORY,
  changedLines,
  checkCorpusDirectory,
  diffText,
  fingerprint,
  type ObservedCase,
  type ObservedCorpus,
  parseCorpusIndex,
  parseObservedCorpus,
  writeDiffs,
} from "./corpora";

/**
 * The corpora of the bench, and the one drawn from real defects of the fleet.
 *
 * What each test would miss if it went away:
 * - a corpus file nobody declares would be scored with no origin, and its
 *   figures could be read as those of the other corpus;
 * - a defect with no pinned public proof would be a claim, not an observation;
 * - a case built by hand (origin other than observed) would pad the observed
 *   corpus, which the owner's decision forbids;
 * - a field naming an author would publish personal data (ADR-0012);
 * - a rebuilt diff of other files, another size or another text than the case
 *   records would score a reviewer on another change than the one described;
 * - a witness merged less than 14 days before the survey, or of another size
 *   class than its defect, would not be the clean control the rule describes.
 *
 * The rebuilt diffs are exercised on a repository made here: the tests do not
 * reach the network, so they do not read the fleet's clones.
 */

const ROOT = join(import.meta.dir, "../..");
const OBSERVED = join(ROOT, "verification/trust-bench/corpus/flotte-observee.json");
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "trust-bench-corpora-test-"));
  roots.push(dir);
  return dir;
};

const observedText = readFileSync(OBSERVED, "utf8");
type Raw = { cas: Record<string, unknown>[] } & Record<string, unknown>;
const observed = JSON.parse(observedText) as Raw;
/** A deep copy of a corpus, changed by `edit`, then parsed. */
function parseEdited(edit: (corpus: Raw) => void, from: Raw = observed) {
  const copy = structuredClone(from);
  edit(copy);
  return parseObservedCorpus(copy);
}
function errorsOf(outcome: ReturnType<typeof parseObservedCorpus>): string {
  return outcome.ok ? "" : outcome.errors.join("\n");
}
const pick = (corpus: Raw, attendu: boolean): Record<string, unknown> => {
  const found = corpus.cas.find((cas) => cas.attendu === attendu);
  if (found === undefined) throw new Error(`no case with attendu ${attendu}`);
  return found;
};

describe("corpus index", () => {
  const index = parseCorpusIndex(readFileSync(join(ROOT, CORPUS_DIRECTORY, "index.json"), "utf8"));

  test("every corpus file of the directory is declared once, with its origin", () => {
    if (!index.ok) throw new Error(index.errors.join("\n"));
    expect(checkCorpusDirectory(index.value, readdirSync(join(ROOT, CORPUS_DIRECTORY)))).toEqual(
      [],
    );
    expect(index.value.map((entry) => entry.origine).sort()).toEqual(["observed", "synthetic"]);
  });

  test("an undeclared corpus file, and a declared file that is absent, are errors", () => {
    if (!index.ok) throw new Error(index.errors.join("\n"));
    const errors = checkCorpusDirectory(index.value, [
      "index.json",
      "pi-evidence.json",
      "autre.json",
    ]).join("\n");
    expect(errors).toContain("autre.json");
    expect(errors).toContain("flotte-observee.json");
  });

  test("an origin outside synthetic and observed is refused", () => {
    const outcome = parseCorpusIndex(
      JSON.stringify({ corpus: [{ fichier: `${CORPUS_DIRECTORY}/x.json`, origine: "mixed" }] }),
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("observed corpus", () => {
  const outcome = parseObservedCorpus(observed);

  test("loads: every case observed, counts as recorded, defects and witnesses both present", () => {
    if (!outcome.ok) throw new Error(errorsOf(outcome));
    const corpus = outcome.value;
    const defects = corpus.cas.filter((cas) => cas.attendu);
    expect(corpus.origine).toBe("observed");
    expect(corpus.cas.every((cas) => cas.origine === "observed")).toBe(true);
    expect(defects.length).toBe(corpus.releve.defauts_retenus);
    expect(corpus.cas.length - defects.length).toBe(corpus.releve.temoins_retenus);
    expect(defects.length).toBeGreaterThan(0);
    expect(corpus.cas.length - defects.length).toBeGreaterThan(0);
  });

  test("every defect carries a pinned public proof in its own repository, at another commit", () => {
    if (!outcome.ok) throw new Error(errorsOf(outcome));
    for (const cas of outcome.value.cas.filter((candidate) => candidate.attendu)) {
      expect(cas.preuves?.length ?? 0, cas.id).toBeGreaterThan(0);
      for (const proof of cas.preuves ?? []) {
        const match = /^(libre-ai\/[a-z0-9.-]+)@([0-9a-f]{40}):(.+)$/.exec(proof);
        expect(match, `${cas.id} ${proof}`).not.toBeNull();
        expect(match?.[1], proof).toBe(cas.depot);
        expect(match?.[2], proof).not.toBe(cas.commit);
      }
    }
  });

  test("holds no personal data: no identifier on any line, no field outside the closed list", () => {
    expect(
      scanPersonalIdentifiers([
        { path: "verification/trust-bench/corpus/flotte-observee.json", content: observedText },
      ]),
    ).toEqual([]);
    expect(
      errorsOf(
        parseEdited((corpus) => {
          pick(corpus, true).auteur = "someone";
        }),
      ),
    ).toContain("auteur");
  });

  test("a defect without a proof, or with a proof that is not pinned, is refused", () => {
    expect(
      errorsOf(
        parseEdited((corpus) => {
          pick(corpus, true).preuves = [];
        }),
      ),
    ).toContain("preuves");
    expect(
      errorsOf(
        parseEdited((corpus) => {
          pick(corpus, true).preuves = ["libre-ai/project-governance@2024a48:package.json"];
        }),
      ),
    ).toContain("pinned");
  });

  test("a case that is not observed is refused, and so is a corpus that is not", () => {
    expect(
      errorsOf(
        parseEdited((corpus) => {
          pick(corpus, true).origine = "synthetic";
        }),
      ),
    ).toContain("origine");
    expect(
      errorsOf(
        parseEdited((corpus) => {
          corpus.origine = "synthetic";
        }),
      ),
    ).toContain("origine");
  });

  test("recorded counts that differ from the cases are refused", () => {
    expect(
      errorsOf(
        parseEdited((corpus) => {
          (corpus.releve as Record<string, unknown>).defauts_retenus = 99;
        }),
      ),
    ).toContain("defauts_retenus");
  });

  test("a witness younger than 14 days, unpaired, or of another size class is refused", () => {
    expect(
      errorsOf(
        parseEdited((corpus) => {
          pick(corpus, false).fusionne_le = (corpus.releve as { date: string }).date;
        }),
      ),
    ).toContain("14");
    expect(
      errorsOf(
        parseEdited((corpus) => {
          pick(corpus, false).apparie_a = "R99";
        }),
      ),
    ).toContain("apparie_a");
    expect(
      errorsOf(
        parseEdited((corpus) => {
          // Paired to a defect of the same repository, at least three times its size.
          const witness = pick(corpus, false);
          const size = witness.lignes_modifiees as number;
          const larger = corpus.cas.find(
            (cas) =>
              cas.attendu === true &&
              cas.depot === witness.depot &&
              (cas.lignes_modifiees as number) >= 3 * size,
          );
          if (larger === undefined) throw new Error("no defect three times larger");
          witness.apparie_a = larger.id;
        }),
      ),
    ).toContain("taille");
  });

  test("a duplicate or reserved identifier is refused", () => {
    expect(
      errorsOf(
        parseEdited((corpus) => {
          pick(corpus, false).id = pick(corpus, true).id;
        }),
      ),
    ).toContain("double");
    expect(
      errorsOf(
        parseEdited((corpus) => {
          pick(corpus, true).id = "SAIN";
        }),
      ),
    ).toContain("SAIN");
  });
});

// ---------------------------------------------------------------------------
// Rebuilt diffs, on a repository made here.

function git(dir: string, ...args: string[]): string {
  const run = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: { PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
  return run.stdout.toString().trim();
}
/** A repository `clones/fixture` with a base commit, a defect and a witness, and a corpus naming them. */
function fixture(): { clones: string; corpus: ObservedCorpus } {
  const clones = scratch();
  const repo = join(clones, "fixture");
  mkdirSync(repo);
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "user.email", "t@t.invalid");
  writeFileSync(join(repo, "gate.ts"), "export const limit = 600;\nexport const name = 'gate';\n");
  writeFileSync(join(repo, "other.ts"), "export const other = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  writeFileSync(join(repo, "gate.ts"), "export const limit = 6;\nexport const name = 'gate';\n");
  writeFileSync(join(repo, "other.ts"), "export const other = 2;\n");
  git(repo, "commit", "-q", "-am", "defect");
  const defect = git(repo, "rev-parse", "HEAD");
  writeFileSync(join(repo, "other.ts"), "// kept\nexport const other = 2;\n");
  git(repo, "commit", "-q", "-am", "witness");
  const witness = git(repo, "rev-parse", "HEAD");
  const record = (id: string, from: string, to: string, chemins: string[]): ObservedCase => {
    const text = diffText(repo, from, to, chemins);
    return {
      id,
      attendu: id.startsWith("R"),
      origine: "observed",
      nature: "fixture",
      depot: "libre-ai/fixture",
      commit: to,
      base: from,
      chemins,
      lignes_modifiees: changedLines(text),
      empreinte_diff: fingerprint(text),
    };
  };
  return {
    clones,
    corpus: {
      corpus: "fixture",
      origine: "observed",
      releve: { date: "2026-11-23", defauts_retenus: 1, temoins_retenus: 1, reverts_trouves: 0 },
      cas: [record("R01", base, defect, ["gate.ts"]), record("S01", defect, witness, ["other.ts"])],
    },
  };
}
const withCase = (corpus: ObservedCorpus, id: string, change: Partial<ObservedCase>) => ({
  ...corpus,
  cas: corpus.cas.map((cas) => (cas.id === id ? { ...cas, ...change } : cas)),
});

describe("writeDiffs", () => {
  test("rebuilds each diff from its clone, restricted to its paths, and names it by its id", () => {
    const { clones, corpus } = fixture();
    const dir = join(scratch(), "diffs");
    expect(writeDiffs(corpus, clones, dir)).toBe(2);
    const defect = readFileSync(join(dir, "R01.diff"), "utf8");
    expect(defect).toContain("-export const limit = 600;");
    expect(defect).toContain("+export const limit = 6;");
    // The other file of the same commit is outside the case.
    expect(defect).not.toContain("other.ts");
    expect(readFileSync(join(dir, "S01.diff"), "utf8")).toContain("+// kept");
  });

  test("a diff of another text, size or file set than recorded is refused, and nothing is written", () => {
    const { clones, corpus } = fixture();
    const [defect] = corpus.cas;
    if (defect === undefined) throw new Error("empty fixture");
    const cases: [string, Partial<ObservedCase>, string][] = [
      ["fingerprint", { empreinte_diff: "0".repeat(64) }, "empreinte"],
      ["size", { lignes_modifiees: defect.lignes_modifiees + 1 }, "ligne(s)"],
      // A recorded path the commit does not change: the diff names fewer files than the case.
      ["paths", { chemins: ["gate.ts", "absent.ts"] }, "nomme"],
      ["empty", { chemins: ["absent.ts"] }, "vide"],
    ];
    for (const [name, change, message] of cases) {
      const dir = join(scratch(), "diffs");
      expect(() => writeDiffs(withCase(corpus, "R01", change), clones, dir), name).toThrow(message);
      expect(existsSync(dir), name).toBe(false);
    }
  });

  test("a missing clone is refused with the command that makes it", () => {
    const { corpus } = fixture();
    expect(() => writeDiffs(corpus, scratch(), join(scratch(), "diffs"))).toThrow(
      "git clone --bare --filter=blob:none https://github.com/libre-ai/fixture.git",
    );
  });

  test("writes nothing when one target already exists", () => {
    const { clones, corpus } = fixture();
    const dir = scratch();
    writeFileSync(join(dir, "S01.diff"), "kept\n");
    expect(() => writeDiffs(corpus, clones, dir)).toThrow("existe déjà");
    expect(readdirSync(dir)).toEqual(["S01.diff"]);
    expect(readFileSync(join(dir, "S01.diff"), "utf8")).toBe("kept\n");
  });

  test("the diff ignores a configuration that would change its text", () => {
    const { clones, corpus } = fixture();
    const repo = join(clones, "fixture");
    git(repo, "config", "diff.noprefix", "true");
    git(repo, "config", "diff.mnemonicPrefix", "true");
    git(repo, "config", "core.abbrev", "7");
    git(repo, "config", "diff.renames", "copies");
    expect(writeDiffs(corpus, clones, join(scratch(), "diffs"))).toBe(2);
  });
});
