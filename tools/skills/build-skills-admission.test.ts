import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { touchesGatedPaths } from "../quality/check-review-evidence";
import {
  ADMISSION_CHECKS,
  type AdmissionRead,
  type AdmissionSources,
  buildReceipt,
  buildReceiptEntry,
  deriveAdmissionState,
  evaluateAdmission,
  listSkillDirectories,
  POLICY_FORMAT,
  POLICY_PATH,
  RECEIPT_PATH,
  readAdmission,
  readRequiredChecks,
  renderReceipt,
  resolveRequiredChecks,
  runAdmissionChecks,
  type SkillResults,
} from "./build-skills-admission";
import { buildSkillsManifest, MANIFEST_PATH, renderSkillsManifest } from "./build-skills-manifest";
import { PATTERNS_PATH } from "./check-skills-security";
import { SPDX_LICENSE_LINE } from "./lint-skill";

// ADR-0072: the admission state of a skill is derived from the checks it
// passed, bound to the fingerprint of its directory, and written in a tracked
// receipt a gate holds equal to the tree. The expectations below come from the
// brief of that decision (its testable criteria), not from the gate's output:
// a violation is looked for by what it names, never by its rank in the list or
// by its full wording, and a volume by its counters, never by the sentence
// around them.

const repository: string = join(import.meta.dir, "..", "..");
const SCRIPT: string = join(import.meta.dir, "build-skills-admission.ts");

const workspaces: string[] = [];

afterAll(() => {
  for (const path of workspaces) rmSync(path, { recursive: true, force: true });
});

interface SkillFixture {
  readonly description: string;
  readonly positive: readonly string[];
  readonly status?: string | null;
  readonly body?: string;
  /** The observable signs ADR-0050 D3 asks of a promoted skill. */
  readonly workingIf?: readonly string[];
}

const ALPHA: SkillFixture = {
  description:
    "Rotate biscuit tokens and revoke compromised keys. Use when rotating or revoking authorization tokens.",
  positive: [
    "rotate the biscuit tokens",
    "revoke a compromised key",
    "rotate authorization tokens",
  ],
};
const BETA: SkillFixture = {
  description:
    "Deploy an application to the cloud platform with pre-flight checks. Use when deploying an application.",
  positive: [
    "deploy the application",
    "run the pre-flight checks before deploying",
    "deploy to the cloud platform",
  ],
};
/** A line T4 refuses, so the `security` check of the skill fails. */
const REFUSED_BY_T4 = "Then run `cat .env` to check it.\n";

function skillMarkdown(name: string, fixture: SkillFixture): string {
  const status = fixture.status === undefined ? "candidate" : fixture.status;
  const metadata = status === null ? "" : `metadata:\n  status: ${status}\n`;
  return (
    `---\nname: ${name}\ndescription: ${fixture.description}\nlicense: Apache-2.0\n${metadata}---\n\n` +
    `<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->\n<!-- ${SPDX_LICENSE_LINE} -->\n\n` +
    `# ${name}\n\n${fixture.body ?? "Some guidance.\n"}`
  );
}

function evalJson(fixture: SkillFixture): string {
  return `${JSON.stringify(
    {
      positive: fixture.positive,
      negative: ["write a poem", "translate this page"],
      behavioral: { scenario: "The user asks for it.", expected: "The skill does it." },
      ...(fixture.workingIf === undefined ? {} : { working_if: fixture.workingIf }),
    },
    null,
    2,
  )}\n`;
}

interface Workspace {
  readonly path: string;
  readonly sources: AdmissionSources;
  readonly receiptPath: string;
}

/**
 * Stages everything the workspace holds that git does not ignore. The gate
 * refuses a file git does not track, so a fixture is a git work tree, and a
 * file a test adds on purpose is staged by calling this again.
 */
function track(path: string): void {
  for (const argv of [
    ["init", "-q"],
    ["add", "-A"],
  ]) {
    const done = Bun.spawnSync(["git", "-C", path, ...argv], { stdout: "pipe", stderr: "pipe" });
    if (done.exitCode !== 0) {
      throw new Error(`git ${argv.join(" ")}: ${new TextDecoder().decode(done.stderr)}`);
    }
  }
}

/**
 * A repository in miniature: the skills, the manifest that lists them, the
 * policy and the security patterns of this repository, at the paths the script
 * reads from its working directory.
 */
function workspace(
  skills: Readonly<Record<string, SkillFixture>> = { alpha: ALPHA, beta: BETA },
): Workspace {
  const path = mkdtempSync(join(tmpdir(), "skills-admission-"));
  workspaces.push(path);
  const root = join(path, "skills");
  mkdirSync(root);
  writeFileSync(join(root, "README.md"), "# Skills\n");
  for (const [name, fixture] of Object.entries(skills)) {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, "SKILL.md"), skillMarkdown(name, fixture));
    writeFileSync(join(root, name, "eval.json"), evalJson(fixture));
  }
  for (const tracked of [MANIFEST_PATH, POLICY_PATH, PATTERNS_PATH, RECEIPT_PATH]) {
    mkdirSync(join(path, tracked, ".."), { recursive: true });
  }
  writeFileSync(
    join(path, MANIFEST_PATH),
    renderSkillsManifest(buildSkillsManifest(Object.keys(skills))),
  );
  copyFileSync(join(repository, POLICY_PATH), join(path, POLICY_PATH));
  copyFileSync(join(repository, PATTERNS_PATH), join(path, PATTERNS_PATH));
  writeFileSync(join(path, ".gitignore"), "*.log\n");
  track(path);
  return {
    path,
    sources: {
      root,
      manifestPath: join(path, MANIFEST_PATH),
      patternsPath: join(path, PATTERNS_PATH),
      policyPath: join(path, POLICY_PATH),
    },
    receiptPath: join(path, RECEIPT_PATH),
  };
}

function entryOf(read: AdmissionRead, name: string) {
  const entry = read.receipt.skills.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error(`no receipt entry for "${name}"`);
  return entry;
}

function resultsOf(read: AdmissionRead, name: string): Record<string, string> {
  return Object.fromEntries(entryOf(read, name).checks.map((check) => [check.id, check.result]));
}

/** The violations of a tree against the receipt it generated before a change. */
function violations(read: AdmissionRead, committed: string | null): string[] {
  return evaluateAdmission(read, committed).violations;
}

/** The lines that carry every fragment given, wherever they stand. */
function naming(lines: readonly string[], ...fragments: readonly string[]): string[] {
  return lines.filter((line) => fragments.every((fragment) => line.includes(fragment)));
}

/** The counters of a volume line, by name. */
function counters(volume: string | null): Record<string, number> {
  return Object.fromEntries(
    [...(volume ?? "").matchAll(/([a-z-]+)=(\d+)/g)].map(([, key, value]) => [key, Number(value)]),
  );
}

const ALL_PASS: SkillResults = {
  structure: "pass",
  routing: "pass",
  "non-cascade": "pass",
  security: "pass",
  distribution: "pass",
};

describe("deriveAdmissionState", () => {
  const required = [...ADMISSION_CHECKS];

  test("every required check passed: candidate", () => {
    expect(deriveAdmissionState(required, ALL_PASS)).toBe("candidate");
  });

  // Criterion: a required check removed from the results, or marked failed,
  // gives `incomplete`, never `candidate`.
  test.each(required)("required check %s without a result: incomplete", (id) => {
    const rest = Object.fromEntries(Object.entries(ALL_PASS).filter(([key]) => key !== id));
    expect(Object.keys(rest)).toHaveLength(required.length - 1);
    expect(deriveAdmissionState(required, rest)).toBe("incomplete");
  });

  test.each([
    "fail",
    "unavailable",
    "skipped",
    "PASS",
    true,
    null,
  ])("a required check whose result is %p: incomplete", (result) => {
    expect(deriveAdmissionState(required, { ...ALL_PASS, security: result })).toBe("incomplete");
  });

  test("a check that is not required does not count", () => {
    expect(deriveAdmissionState(["structure"], { ...ALL_PASS, security: "fail" })).toBe(
      "candidate",
    );
  });

  test("an empty required list derives nothing: incomplete", () => {
    expect(deriveAdmissionState([], ALL_PASS)).toBe("incomplete");
  });
});

describe("resolveRequiredChecks", () => {
  const written = (required: readonly unknown[]): Record<string, unknown> => ({
    schema_version: POLICY_FORMAT,
    because: "why",
    required_checks: required,
  });

  test("a readable, coherent list is followed, in the order of the known checks", () => {
    expect(resolveRequiredChecks(written(["security", "structure"]))).toEqual({
      required: ["structure", "security"],
      defect: null,
    });
  });

  // Criterion: an unreadable or contradictory list means everything is required.
  test.each([
    ["an unreadable file", undefined, "unreadable, or not valid JSON"],
    ["not an object", ["structure"], "expected an object"],
    ["no list", { ...written([]), required_checks: "structure" }, "expected an object"],
    ["an empty list", written([]), "is empty"],
    ["an unknown check", written(["structure", "vibes"]), '"vibes"'],
    ["an entry that is not a name", written(["structure", 3]), "names 3"],
    ["a check listed twice", written(["structure", "structure"]), "twice"],
    // A key the script does not read must not be able to look like a rule:
    // `required_check` (singular) beside the real list, or an `except` list.
    ["a key that is not read", { ...written(["structure"]), except: ["security"] }, '"except"'],
    [
      "another schema version",
      { ...written(["structure"]), schema_version: "libre-ai.skills-admission-policy.v2" },
      "schema_version",
    ],
    ["no schema version", { required_checks: ["structure"] }, "schema_version"],
  ])("%s: every known check is required, and the defect is named", (_label, policy, defect) => {
    const resolved = resolveRequiredChecks(policy);
    expect(resolved.required).toEqual([...ADMISSION_CHECKS]);
    expect(resolved.defect ?? "(no defect named)").toContain(defect);
  });

  test("the policy of this repository is readable and requires every known check", () => {
    expect(readRequiredChecks(readFileSync(join(repository, POLICY_PATH), "utf8"))).toEqual({
      required: [...ADMISSION_CHECKS],
      defect: null,
    });
  });

  test("the policy is on the guarded surface: removing a check needs review evidence", () => {
    expect(touchesGatedPaths([POLICY_PATH, `${POLICY_PATH}.bak`, RECEIPT_PATH])).toEqual([
      POLICY_PATH,
    ]);
  });
});

describe("readRequiredChecks", () => {
  const head = `"schema_version": "${POLICY_FORMAT}"`;

  // Review of #274, C3: a parser keeps the last of two keys of the same name.
  // The five checks, then the key again with one: the file shows both lists,
  // and a reader of the first believes the five are required.
  test("a key written twice: every known check is required, and the defect is named", () => {
    const all = JSON.stringify([...ADMISSION_CHECKS]);
    const twice = `{ ${head}, "required_checks": ${all}, "required_checks": ["distribution"] }`;
    expect(JSON.parse(twice).required_checks).toEqual(["distribution"]);
    const resolved = readRequiredChecks(twice);
    expect(resolved.required).toEqual([...ADMISSION_CHECKS]);
    expect(resolved.defect ?? "(no defect named)").toContain("twice");
  });

  test("a key name hidden behind an escape is not followed either", () => {
    const hidden = `{ ${head}, "required_check\\u0073": ["distribution"] }`;
    expect(JSON.parse(hidden).required_checks).toEqual(["distribution"]);
    expect(readRequiredChecks(hidden).required).toEqual([...ADMISSION_CHECKS]);
  });

  test("a file that cannot be read or parsed: every known check is required", () => {
    for (const text of [null, "", '{ "required_checks": [']) {
      const resolved = readRequiredChecks(text);
      expect(resolved.required).toEqual([...ADMISSION_CHECKS]);
      expect(resolved.defect ?? "(no defect named)").toContain("unreadable");
    }
  });

  // What must NOT read as a defect: the layout of the file, and a string that
  // holds spaces, a quote or a backslash.
  test("white space between tokens changes nothing, and a string is left as written", () => {
    const because = JSON.stringify('two  spaces, a "quote", a back\\slash\tand a tab');
    const packed = `{${head},"because":${because},"required_checks":["security","structure"]}`;
    const spread = `{\n\t${head} ,\r\n  "because" : ${because},\n  "required_checks": [\n    "security",\n    "structure"\n  ]\n}\n`;
    for (const text of [packed, spread]) {
      expect(readRequiredChecks(text)).toEqual({
        required: ["structure", "security"],
        defect: null,
      });
    }
  });
});

describe("buildReceipt", () => {
  const fingerprint = { fingerprint: "sha256:00", files: 1 };

  test("an entry lists every known check, says which are required, and carries the state", () => {
    const entry = buildReceiptEntry("alpha", fingerprint, { ...ALL_PASS, security: "fail" }, [
      "structure",
      "security",
    ]);
    expect(entry.checks).toEqual([
      { id: "structure", required: true, result: "pass" },
      { id: "routing", required: false, result: "pass" },
      { id: "non-cascade", required: false, result: "pass" },
      { id: "security", required: true, result: "fail" },
      { id: "distribution", required: false, result: "pass" },
    ]);
    expect(entry.state).toBe("incomplete");
  });

  test("the order the entries come in changes nothing", () => {
    const entries = ["beta", "alpha", "gamma"].map((name) =>
      buildReceiptEntry(name, fingerprint, ALL_PASS, [...ADMISSION_CHECKS]),
    );
    expect(renderReceipt(buildReceipt([...entries].reverse()))).toBe(
      renderReceipt(buildReceipt(entries)),
    );
    expect(buildReceipt(entries).skills.map((entry) => entry.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });
});

describe("listSkillDirectories", () => {
  test("each entry of the root is a skill, not a skill, or refused", () => {
    const { sources } = workspace();
    mkdirSync(join(sources.root, ".out-of-scope"));
    symlinkSync(join(sources.root, "alpha"), join(sources.root, "gamma"));
    const read = listSkillDirectories(sources.root);
    expect(read.entries).toBe(5);
    expect(read.skills).toEqual(["alpha", "beta"]);
    expect(read.notSkills).toEqual([".out-of-scope", "README.md"]);
    expect(read.refused).toEqual([
      {
        path: join(sources.root, "gamma"),
        reason: "symbolic link, never followed: it may stand for a skill",
      },
    ]);
  });

  test("a root that is absent or is a link is refused, not read as empty", () => {
    const { path, sources } = workspace();
    expect(listSkillDirectories(join(path, "missing")).refused.map((entry) => entry.path)).toEqual([
      join(path, "missing"),
    ]);
    symlinkSync(sources.root, join(path, "linked"));
    expect(listSkillDirectories(join(path, "linked")).refused.map((entry) => entry.path)).toEqual([
      join(path, "linked"),
    ]);
  });
});

describe("the receipt of a tree", () => {
  test("a clean collection: every check passes, every skill is candidate, the gate passes", async () => {
    const { sources } = workspace();
    const read = await readAdmission(sources);
    expect(read.receipt.skills.map((entry) => [entry.name, entry.state, entry.files])).toEqual([
      ["alpha", "candidate", 2],
      ["beta", "candidate", 2],
    ]);
    expect(resultsOf(read, "alpha")).toEqual({ ...ALL_PASS });
    const report = evaluateAdmission(read, renderReceipt(read.receipt));
    expect(report.violations).toEqual([]);
    expect(report.outcome).toBe("pass");
    expect(counters(report.volumeSummary)).toEqual({
      entries: 3,
      skills: 2,
      "not-a-skill": 1,
      refused: 0,
      fingerprinted: 2,
      "without-fingerprint": 0,
      "files-hashed": 4,
      untracked: 0,
      "required-checks": 5,
      states: 2,
      candidate: 2,
      incomplete: 0,
    });
  });

  // Criterion: one byte changed in a skill file, receipt not regenerated: the
  // gate fails and names the skill.
  test("one byte changed in a skill file without regenerating: red, the skill named", async () => {
    const { sources } = workspace();
    const committed = renderReceipt((await readAdmission(sources)).receipt);
    const path = join(sources.root, "beta", "SKILL.md");
    writeFileSync(path, readFileSync(path, "utf8").replace("Some guidance.", "Some guidance!"));
    const found = violations(await readAdmission(sources), committed);
    expect(naming(found, `${sources.root}/beta`, "fingerprint")).not.toEqual([]);
    // The state is still `candidate`: generating the receipt again is the remedy.
    expect(naming(found, `${sources.root}/beta`, "build:skills-admission")).not.toEqual([]);
    expect(naming(found, `${sources.root}/alpha`)).toEqual([]);
  });

  // Criterion: two generations on the same tree are the same bytes.
  test("two generations on the same tree are byte-identical, with no date and no machine path", async () => {
    const { path, sources } = workspace();
    const first = renderReceipt((await readAdmission(sources)).receipt);
    const second = renderReceipt((await readAdmission(sources)).receipt);
    expect(second).toBe(first);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}/);
    expect(first).not.toContain(path);
    expect(first).not.toMatch(/\/(Users|home|tmp|var|private)\//);
  });

  test("the same collection in another place gives the same receipt", async () => {
    const here = renderReceipt((await readAdmission(workspace().sources)).receipt);
    const there = renderReceipt((await readAdmission(workspace().sources)).receipt);
    expect(there).toBe(here);
  });

  // Criterion: a required check removed from the receipt, state left as it
  // was: the gate fails on that skill.
  test("a required check removed from the committed receipt: red, the skill named", async () => {
    const { sources } = workspace();
    const read = await readAdmission(sources);
    const tampered = {
      ...read.receipt,
      skills: read.receipt.skills.map((entry) =>
        entry.name === "alpha"
          ? { ...entry, checks: entry.checks.filter((check) => check.id !== "security") }
          : entry,
      ),
    };
    const found = violations(read, `${JSON.stringify(tampered, null, 2)}\n`);
    expect(naming(found, `${sources.root}/alpha`, "receipt")).not.toEqual([]);
    expect(naming(found, `${sources.root}/beta`)).toEqual([]);
  });

  test("a state rewritten by hand in the committed receipt: red", async () => {
    const { sources } = workspace({ alpha: { ...ALPHA, body: REFUSED_BY_T4 }, beta: BETA });
    const read = await readAdmission(sources);
    expect(entryOf(read, "alpha").state).toBe("incomplete");
    const forged = renderReceipt(read.receipt).replace('"incomplete"', '"candidate"');
    expect(naming(violations(read, forged), `${sources.root}/alpha`, "receipt")).not.toEqual([]);
  });

  test("a required check that fails: incomplete, and the declared status no longer agrees", async () => {
    const { sources } = workspace({ alpha: { ...ALPHA, body: REFUSED_BY_T4 }, beta: BETA });
    const read = await readAdmission(sources);
    expect(resultsOf(read, "alpha")).toEqual({ ...ALL_PASS, security: "fail" });
    expect(entryOf(read, "alpha").state).toBe("incomplete");
    expect(entryOf(read, "beta").state).toBe("candidate");
    const found = violations(read, renderReceipt(read.receipt));
    expect(
      naming(found, `${sources.root}/alpha/SKILL.md`, "candidate", "incomplete", "security=fail"),
    ).not.toEqual([]);
    expect(naming(found, `${sources.root}/beta`)).toEqual([]);
  });

  // Review of #274, C5: when a required check stops passing, generating the
  // receipt again records `incomplete` and the gate stays red. The gate must
  // not send the reader to the generator: it names the check to repair.
  test("a check that stops passing on an unchanged skill: the remedy named is the repair, not the generator", async () => {
    const { sources } = workspace();
    const before = await readAdmission(sources);
    const committed = renderReceipt(before.receipt);
    writeFileSync(sources.manifestPath, renderSkillsManifest(buildSkillsManifest(["alpha"])));
    const read = await readAdmission(sources);
    expect(entryOf(read, "beta").fingerprint).toBe(entryOf(before, "beta").fingerprint);
    const found = violations(read, committed);
    expect(naming(found, `${sources.root}/beta`, "receipt", "distribution=fail")).not.toEqual([]);
    expect(naming(found, "build:skills-admission")).toEqual([]);
  });

  test("a skill changed so that a required check fails: the same remedy", async () => {
    const { sources } = workspace();
    const committed = renderReceipt((await readAdmission(sources)).receipt);
    writeFileSync(
      join(sources.root, "alpha", "SKILL.md"),
      skillMarkdown("alpha", { ...ALPHA, body: REFUSED_BY_T4 }),
    );
    const found = violations(await readAdmission(sources), committed);
    expect(naming(found, `${sources.root}/alpha`, "fingerprint", "security=fail")).not.toEqual([]);
    expect(naming(found, "build:skills-admission")).toEqual([]);
  });

  test("each check, failing alone, is recorded on the skill it judges", async () => {
    const structure = workspace({ alpha: { ...ALPHA, status: "ready" }, beta: BETA });
    expect(resultsOf(await readAdmission(structure.sources), "alpha").structure).toBe("fail");

    const routing = workspace({
      alpha: { ...ALPHA, positive: [...BETA.positive] },
      beta: BETA,
    });
    const routed = await readAdmission(routing.sources);
    expect(resultsOf(routed, "alpha").routing).toBe("fail");
    expect(resultsOf(routed, "beta").routing).toBe("pass");

    const colliding = workspace({ alpha: ALPHA, beta: BETA, gamma: ALPHA });
    const collided = await readAdmission(colliding.sources);
    expect(resultsOf(collided, "alpha").routing).toBe("fail");
    expect(resultsOf(collided, "gamma").routing).toBe("fail");

    const userInvoked = (other: string): SkillFixture => ({
      ...ALPHA,
      description: `${ALPHA.description}\ndisable-model-invocation: true`,
      body: `Then invoke the ${other} skill.\n`,
    });
    const cascade = workspace({
      alpha: userInvoked("beta"),
      beta: { ...BETA, description: `${BETA.description}\ndisable-model-invocation: true` },
    });
    const cascaded = await readAdmission(cascade.sources);
    expect(resultsOf(cascaded, "alpha")["non-cascade"]).toBe("fail");
    expect(resultsOf(cascaded, "beta")["non-cascade"]).toBe("pass");

    const unlisted = workspace();
    writeFileSync(
      unlisted.sources.manifestPath,
      renderSkillsManifest(buildSkillsManifest(["alpha"])),
    );
    const listed = await readAdmission(unlisted.sources);
    expect(resultsOf(listed, "alpha").distribution).toBe("pass");
    expect(resultsOf(listed, "beta").distribution).toBe("fail");
    expect(entryOf(listed, "beta").state).toBe("incomplete");
  });

  // Review of #274, C2 (M16): T1 judges eval.json too. One positive trigger
  // where the admission minimum is three is a T1 failure, and nothing else:
  // the single trigger still routes to its skill.
  test("an eval.json under the admission minimum fails `structure`, on that skill only", async () => {
    const { sources } = workspace({
      alpha: { ...ALPHA, positive: ALPHA.positive.slice(0, 1) },
      beta: BETA,
    });
    const read = await readAdmission(sources);
    expect(resultsOf(read, "alpha")).toEqual({ ...ALL_PASS, structure: "fail" });
    expect(resultsOf(read, "beta").structure).toBe("pass");
  });

  // Review of #274, C2 (M10): no trigger that could be graded is not a skill
  // that routes. An empty `positive` list leaves T2 nothing to rank.
  test("a skill none of whose triggers could be graded does not pass `routing`", async () => {
    const { sources } = workspace({ alpha: { ...ALPHA, positive: [] }, beta: BETA });
    const read = await readAdmission(sources);
    expect(resultsOf(read, "alpha").routing).toBe("fail");
    expect(resultsOf(read, "beta").routing).toBe("pass");
  });

  // Review of #274, C2 (M8): T4 passes a skill only if it read every entry of
  // its directory. A file it cannot decode, a link and a file it cannot open
  // match no pattern, so a scan that forgets them calls the skill clean.
  test.each([
    [
      "a file that is not text",
      (directory: string) => writeFileSync(join(directory, "blob.bin"), new Uint8Array([255, 0])),
    ],
    [
      "a symbolic link",
      (directory: string) => symlinkSync(join(directory, "SKILL.md"), join(directory, "linked.md")),
    ],
    [
      "a file that cannot be opened",
      (directory: string) => chmodSync(join(directory, "eval.json"), 0),
    ],
  ])("%s in a skill directory fails `security`, on that skill only", async (_label, plant) => {
    const { sources } = workspace();
    plant(join(sources.root, "alpha"));
    const results = await runAdmissionChecks(["alpha", "beta"], sources);
    chmodSync(join(sources.root, "alpha", "eval.json"), 0o644);
    expect(results.get("alpha")?.security).toBe("fail");
    expect(results.get("beta")?.security).toBe("pass");
  });

  // A check that cannot judge is not a check that passed.
  test("a check whose own source cannot be read is unavailable, and the state incomplete", async () => {
    const { sources } = workspace();
    rmSync(sources.patternsPath);
    writeFileSync(sources.manifestPath, "{");
    const read = await readAdmission(sources);
    expect(resultsOf(read, "alpha")).toEqual({
      ...ALL_PASS,
      security: "unavailable",
      distribution: "unavailable",
    });
    expect(read.receipt.skills.map((entry) => entry.state)).toEqual(["incomplete", "incomplete"]);
  });

  // Review of #274, C2 (M12): no manifest is not a manifest that lists
  // everything.
  test("an absent manifest: `distribution` is unavailable, never a pass", async () => {
    const { sources } = workspace();
    rmSync(sources.manifestPath);
    const read = await readAdmission(sources);
    expect(resultsOf(read, "alpha")).toEqual({ ...ALL_PASS, distribution: "unavailable" });
    expect(read.receipt.skills.map((entry) => entry.state)).toEqual(["incomplete", "incomplete"]);
  });

  test("a policy that leaves a check out: the check still runs and is recorded, without counting", async () => {
    const { sources } = workspace({ alpha: { ...ALPHA, body: REFUSED_BY_T4 }, beta: BETA });
    writeFileSync(
      sources.policyPath,
      JSON.stringify({
        schema_version: POLICY_FORMAT,
        required_checks: ["structure", "routing", "non-cascade", "distribution"],
      }),
    );
    const read = await readAdmission(sources);
    expect(read.policy.defect).toBeNull();
    expect(entryOf(read, "alpha").checks.find((check) => check.id === "security")).toEqual({
      id: "security",
      required: false,
      result: "fail",
    });
    expect(entryOf(read, "alpha").state).toBe("candidate");
  });

  test.each([
    ["an unreadable policy", '{ "required_checks": ['],
    // Review of #274, C3, as the reviewer staged it: the five checks, then the
    // key again with the one check the failing skill passes.
    [
      "a policy whose key is written twice",
      `{ "schema_version": "${POLICY_FORMAT}", "required_checks": ${JSON.stringify([...ADMISSION_CHECKS])}, "required_checks": ["distribution"] }`,
    ],
  ])("%s: every check is required, and the gate names the policy", async (_label, policy) => {
    const { sources } = workspace({ alpha: { ...ALPHA, body: REFUSED_BY_T4 }, beta: BETA });
    writeFileSync(sources.policyPath, policy);
    const read = await readAdmission(sources);
    expect(entryOf(read, "alpha").state).toBe("incomplete");
    expect(entryOf(read, "alpha").checks.every((check) => check.required)).toBe(true);
    expect(naming(violations(read, renderReceipt(read.receipt)), sources.policyPath)).not.toEqual(
      [],
    );
  });

  // Criterion: a symbolic link in a skill directory is a named failure.
  test("a symbolic link in a skill directory: red, the link named, no receipt entry", async () => {
    const { path, sources } = workspace();
    const committed = renderReceipt((await readAdmission(sources)).receipt);
    writeFileSync(join(path, "outside.md"), "x\n");
    symlinkSync(join(path, "outside.md"), join(sources.root, "alpha", "linked.md"));
    // Tracked, as a link a commit carries: only its being a link refuses it.
    track(path);
    const read = await readAdmission(sources);
    expect(read.receipt.skills.map((entry) => entry.name)).toEqual(["beta"]);
    const found = violations(read, committed);
    expect(
      naming(found, join(sources.root, "alpha", "linked.md"), "symbolic link", '"alpha"'),
    ).not.toEqual([]);
    expect(counters(evaluateAdmission(read, committed).volumeSummary)).toMatchObject({
      skills: 2,
      fingerprinted: 1,
      "without-fingerprint": 1,
    });
  });

  // A dangling link: a reading that follows links sees no SKILL.md at all, and
  // the skill would leave the collection without a trace.
  test("a SKILL.md that is a link keeps its directory in the collection, and is refused", async () => {
    const { path, sources } = workspace();
    rmSync(join(sources.root, "alpha", "SKILL.md"));
    symlinkSync(join(path, "nowhere.md"), join(sources.root, "alpha", "SKILL.md"));
    const read = await readAdmission(sources);
    expect(read.collection.skills).toEqual(["alpha", "beta"]);
    expect([...read.unfingerprinted.keys()]).toEqual(["alpha"]);
  });

  // Review of #274, C2 (M15): an entry of the root that is refused (a link
  // that may stand for a skill) is a failure of the gate, not only a count.
  test("a link directly under the root: red, the link named", async () => {
    const { path, sources } = workspace();
    symlinkSync(join(sources.root, "alpha"), join(sources.root, "gamma"));
    // Tracked, as a link a commit carries: only its being a link refuses it.
    track(path);
    const read = await readAdmission(sources);
    const report = evaluateAdmission(read, renderReceipt(read.receipt));
    expect(naming(report.violations, join(sources.root, "gamma"), "symbolic link")).not.toEqual([]);
    expect(counters(report.volumeSummary)).toMatchObject({
      entries: 4,
      skills: 2,
      refused: 1,
      untracked: 0,
    });
  });

  // Review of #274, C2 (M14): a receipt of no skill is byte-identical to what
  // an empty collection generates. Equal is not enough: the gate would hold a
  // receipt of nothing.
  test("a collection with no skill: red, even against the receipt it generates", async () => {
    const { sources } = workspace({});
    const read = await readAdmission(sources);
    expect(read.receipt.skills).toEqual([]);
    const report = evaluateAdmission(read, renderReceipt(read.receipt));
    expect(naming(report.violations, `${sources.root}/`, "no skill directory")).not.toEqual([]);
    expect(report.outcome).toBe("violations");
  });

  // Review of #274, C6: a directory whose SKILL.md is missing or misspelt
  // leaves the collection. It is named on the line every run prints, not only
  // counted.
  test("an entry of the root that is not a skill is named in the volume", async () => {
    const { path, sources } = workspace();
    mkdirSync(join(sources.root, "ghost"));
    writeFileSync(join(sources.root, "ghost", "skill.txt"), "not a SKILL.md\n");
    track(path);
    const read = await readAdmission(sources);
    const report = evaluateAdmission(read, renderReceipt(read.receipt));
    expect(report.violations).toEqual([]);
    expect(counters(report.volumeSummary)).toMatchObject({ "not-a-skill": 2, untracked: 0 });
    expect(report.volumeSummary).toContain('"ghost"');
    expect(report.volumeSummary).toContain('"README.md"');
  });

  // Review of #274, C7: git ignores `*.log` in the fixture. Hashed, the file
  // gives a fingerprint the commit can never give: the workstation would be
  // green on a receipt CI refuses. It is refused by name, and nothing is
  // fingerprinted with it.
  test("a file git ignores in a skill directory: red, the file named, no fingerprint for that skill", async () => {
    const { sources } = workspace();
    const committed = renderReceipt((await readAdmission(sources)).receipt);
    writeFileSync(join(sources.root, "alpha", "debug.log"), "left by a run\n");
    const read = await readAdmission(sources);
    expect(read.receipt.skills.map((entry) => entry.name)).toEqual(["beta"]);
    const report = evaluateAdmission(read, committed);
    expect(
      naming(report.violations, join(sources.root, "alpha", "debug.log"), "not tracked", '"alpha"'),
    ).not.toEqual([]);
    expect(counters(report.volumeSummary)).toMatchObject({
      untracked: 1,
      fingerprinted: 1,
      "without-fingerprint": 1,
    });
  });

  test("an untracked file under the root, outside any skill: red, the file named", async () => {
    const { sources } = workspace();
    writeFileSync(join(sources.root, "notes.txt"), "never added\n");
    const read = await readAdmission(sources);
    const report = evaluateAdmission(read, renderReceipt(read.receipt));
    expect(naming(report.violations, join(sources.root, "notes.txt"), "not tracked")).not.toEqual(
      [],
    );
    expect(counters(report.volumeSummary)).toMatchObject({ untracked: 1, fingerprinted: 2 });
  });

  // Git cannot say what it tracks: that is not a tree with nothing untracked.
  test("a root that is not in a git work tree: red, and the count is not a zero", async () => {
    const { path, sources } = workspace();
    rmSync(join(path, ".git"), { recursive: true });
    const read = await readAdmission(sources);
    const report = evaluateAdmission(read, renderReceipt(read.receipt));
    expect(naming(report.violations, `${sources.root}/`, "untracked")).not.toEqual([]);
    expect(report.volumeSummary).toContain("untracked=unreadable");
  });

  test("a declared status that is not the derived state is named, promoted included", async () => {
    const { sources } = workspace({
      alpha: { ...ALPHA, status: "promoted" },
      beta: { ...BETA, status: null },
    });
    const read = await readAdmission(sources);
    const found = violations(read, renderReceipt(read.receipt));
    expect(naming(found, `${sources.root}/alpha/SKILL.md`, '"promoted"')).not.toEqual([]);
    expect(naming(found, `${sources.root}/beta/SKILL.md`, "no metadata.status")).not.toEqual([]);
  });

  // ADR-0072 D6 amends ADR-0050 D3: a promotion written the way D3 describes
  // it (`promoted`, with its observable signs) passes T1, every required
  // check, and still fails this gate, until the promotion record exists.
  test("a promotion that T1 accepts is refused by the gate", async () => {
    const { sources } = workspace({
      alpha: {
        ...ALPHA,
        status: "promoted",
        workingIf: ["the output cites the path of each gate", "the receipt is regenerated"],
      },
      beta: BETA,
    });
    const read = await readAdmission(sources);
    expect(resultsOf(read, "alpha")).toEqual({ ...ALL_PASS });
    expect(entryOf(read, "alpha").state).toBe("candidate");
    const found = violations(read, renderReceipt(read.receipt));
    expect(naming(found, `${sources.root}/alpha/SKILL.md`, '"promoted"')).not.toEqual([]);
    expect(naming(found, `${sources.root}/beta`)).toEqual([]);
  });

  test("an absent, unreadable or over-long committed receipt is a failure", async () => {
    const { receiptPath, sources } = workspace();
    const read = await readAdmission(sources);
    const against = (committed: string | null): string[] =>
      evaluateAdmission(read, committed, receiptPath).violations;
    expect(naming(against(null), receiptPath, "absent")).not.toEqual([]);
    expect(naming(against("{"), receiptPath, "not valid JSON")).not.toEqual([]);
    expect(naming(against('{"skills":[{}]}'), receiptPath, "`name`")).not.toEqual([]);
    const withGhost = buildReceipt([
      ...read.receipt.skills,
      buildReceiptEntry("ghost", { fingerprint: "sha256:00", files: 1 }, ALL_PASS, [
        ...ADMISSION_CHECKS,
      ]),
    ]);
    expect(naming(against(renderReceipt(withGhost)), receiptPath, "ghost")).not.toEqual([]);
  });

  test("a skill added without regenerating is named as missing from the receipt", async () => {
    const { sources } = workspace();
    const committed = renderReceipt((await readAdmission(sources)).receipt);
    const more = workspace({ alpha: ALPHA, beta: BETA, gamma: { ...BETA, positive: ["x y z"] } });
    const found = violations(await readAdmission(more.sources), committed);
    expect(naming(found, `${more.sources.root}/gamma`, "not in the receipt")).not.toEqual([]);
  });
});

interface Run {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The script as a process, with an environment emptied of the ambient run. */
function run(cwd: string, argv: readonly string[] = []): Run {
  const result = Bun.spawnSync(["bun", SCRIPT, ...argv], {
    cwd,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "" },
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

function statesIn(receiptPath: string): string[] {
  const receipt: { skills: { state: string }[] } = JSON.parse(readFileSync(receiptPath, "utf8"));
  return receipt.skills.map((entry) => entry.state);
}

describe("the script", () => {
  test("generates the receipt, then --check passes; one byte changed and it fails, naming the skill", () => {
    const { path, receiptPath } = workspace();
    const before = run(path, ["--check"]);
    expect(before.exitCode).toBe(1);
    expect(naming(before.stderr.split("\n"), RECEIPT_PATH, "absent")).not.toEqual([]);
    const generated = run(path);
    expect(generated.exitCode).toBe(0);
    expect(generated.stdout).toContain(RECEIPT_PATH);
    expect(counters(generated.stdout)).toMatchObject({ skills: 2, "files-hashed": 4 });
    const first = readFileSync(receiptPath, "utf8");
    expect(run(path).exitCode).toBe(0);
    expect(readFileSync(receiptPath, "utf8")).toBe(first);

    const passing = run(path, ["--check"]);
    expect(passing.stderr).toBe("");
    expect(passing.exitCode).toBe(0);
    expect(counters(passing.stdout)).toMatchObject({
      entries: 3,
      skills: 2,
      "files-hashed": 4,
      untracked: 0,
      candidate: 2,
      incomplete: 0,
    });

    writeFileSync(join(path, "skills", "beta", "eval.json"), `${evalJson(BETA)}\n`);
    const failing = run(path, ["--check"]);
    expect(failing.exitCode).toBe(1);
    const lines = failing.stderr.split("\n");
    expect(naming(lines, "skills/beta", "fingerprint")).not.toEqual([]);
    expect(naming(lines, "skills/alpha")).toEqual([]);
    // A failing run still says how much it examined.
    expect(counters(failing.stderr)).toMatchObject({ "files-hashed": 4 });
  });

  test("a skill that cannot be fingerprinted: nothing is written, and the script fails", () => {
    const { path, receiptPath } = workspace();
    symlinkSync(join(path, "skills", "README.md"), join(path, "skills", "alpha", "linked.md"));
    track(path);
    const generated = run(path);
    expect(generated.exitCode).toBe(1);
    expect(
      naming(generated.stderr.split("\n"), "skills/alpha/linked.md", "symbolic link"),
    ).not.toEqual([]);
    expect(existsSync(receiptPath)).toBe(false);
  });

  // Review of #274, C2 (M13, M15) and C7: what would make the receipt say
  // less, or something else, than what a clone holds stops the generator
  // before it writes.
  test.each([
    [
      "a policy that is not followed as written",
      POLICY_PATH,
      (path: string) => writeFileSync(join(path, POLICY_PATH), '{ "required_checks": ['),
    ],
    [
      "a tracked link directly under the root",
      "skills/gamma",
      (path: string) => {
        symlinkSync(join(path, "skills", "alpha"), join(path, "skills", "gamma"));
        track(path);
      },
    ],
    [
      "a file git ignores in a skill directory",
      "skills/alpha/debug.log",
      (path: string) => writeFileSync(join(path, "skills", "alpha", "debug.log"), "x\n"),
    ],
    [
      "an untracked file outside any skill",
      "skills/notes.txt",
      (path: string) => writeFileSync(join(path, "skills", "notes.txt"), "x\n"),
    ],
    [
      "a tree git cannot describe",
      "skills",
      (path: string) => rmSync(join(path, ".git"), { recursive: true }),
    ],
  ])("%s: nothing is written, the cause is named, and the script fails", (_label, named, plant) => {
    const { path, receiptPath } = workspace();
    plant(path);
    const generated = run(path);
    expect(generated.exitCode).toBe(1);
    expect(naming(generated.stderr.split("\n"), `${named}:`)).not.toEqual([]);
    expect(existsSync(receiptPath)).toBe(false);
  });

  // Review of #274, C5: the receipt of a skill whose required check fails is
  // a faithful receipt, and one the gate refuses. The generator writes it and
  // does not answer 0.
  test("a required check that fails: the receipt is written, the check is named, and the script fails", () => {
    const { path, receiptPath } = workspace({
      alpha: { ...ALPHA, body: REFUSED_BY_T4 },
      beta: BETA,
    });
    const generated = run(path);
    expect(generated.exitCode).toBe(1);
    expect(naming(generated.stderr.split("\n"), "skills/alpha", "security=fail")).not.toEqual([]);
    expect(statesIn(receiptPath)).toEqual(["incomplete", "candidate"]);
  });

  test("no argument selects or skips a check", () => {
    const { path, receiptPath } = workspace();
    rmSync(join(path, PATTERNS_PATH));
    expect(run(path, ["--checks", "structure", "--skip", "security"]).exitCode).toBe(1);
    expect(statesIn(receiptPath)).toEqual(["incomplete", "incomplete"]);
  });
});

describe("this repository", () => {
  /** `glob` magic: without it `*` also crosses a `/`. */
  const SKILL_FILES = ":(glob)skills/*/SKILL.md";
  const tracked = (pathspec: string): string[] =>
    new TextDecoder()
      .decode(Bun.spawnSync(["git", "ls-files", "--", pathspec], { cwd: repository }).stdout)
      .split("\n")
      .filter((line) => line.length > 0);

  // Criterion: on the real tree the gate prints its volume and its counters sum.
  test("the gate passes, prints its volume, and its counters sum", () => {
    const result = run(repository, ["--check"]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const volume = counters(result.stdout);
    expect(volume.skills).toBeGreaterThan(0);
    // `skills` is printed in two of the sums: the same number both times.
    expect([...result.stdout.matchAll(/\bskills=(\d+)/g)].map((match) => Number(match[1]))).toEqual(
      [volume.skills ?? Number.NaN, volume.skills ?? Number.NaN],
    );
    expect(volume.entries).toBe(
      (volume.skills ?? Number.NaN) +
        (volume["not-a-skill"] ?? Number.NaN) +
        (volume.refused ?? Number.NaN),
    );
    expect(volume.skills).toBe(
      (volume.fingerprinted ?? Number.NaN) + (volume["without-fingerprint"] ?? Number.NaN),
    );
    expect(volume.states).toBe(volume.fingerprinted ?? Number.NaN);
    expect(volume.states).toBe(
      (volume.candidate ?? Number.NaN) + (volume.incomplete ?? Number.NaN),
    );
    expect(volume.refused).toBe(0);
    expect(volume["without-fingerprint"]).toBe(0);
    expect(volume.untracked).toBe(0);
    expect(volume["required-checks"]).toBeGreaterThan(0);

    // A second instrument for the two volumes: git, not the walk of the gate.
    const skillFiles = tracked(SKILL_FILES).map((path) => path.split("/")[1] ?? "");
    expect(volume.skills).toBe(skillFiles.length);
    const hashed = skillFiles.flatMap((name) => tracked(`skills/${name}`));
    expect(volume["files-hashed"]).toBe(hashed.length);
  });

  test("the committed receipt lists the tracked skills, each with every known check", () => {
    const receipt: { skills: { name: string; checks: { id: string }[] }[] } = JSON.parse(
      readFileSync(join(repository, RECEIPT_PATH), "utf8"),
    );
    expect(receipt.skills.map((entry) => entry.name)).toEqual(
      tracked(SKILL_FILES).map((path) => path.split("/")[1] ?? ""),
    );
    for (const entry of receipt.skills) {
      expect(entry.checks.map((check) => check.id)).toEqual([...ADMISSION_CHECKS]);
    }
  });

  // What is held: the aggregate runs the gate, the gate is this script with
  // `--check`, and the generator is this script without it. How each command
  // is otherwise written is free.
  test("the gate is in the check chain, and the generator is a script", () => {
    const manifest: { scripts: Record<string, string> } = JSON.parse(
      readFileSync(join(repository, "package.json"), "utf8"),
    );
    const script = "tools/skills/build-skills-admission.ts";
    const words = (name: string): string[] => (manifest.scripts[name] ?? "").split(/\s+/);
    expect(words("check")).toContain("check:skills-admission");
    expect(words("check:skills-admission")).toContain(script);
    expect(words("check:skills-admission")).toContain("--check");
    expect(words("build:skills-admission")).toContain(script);
    expect(words("build:skills-admission")).not.toContain("--check");
  });
});
