import { describe, expect, test } from "bun:test";
import type { GhResult, LabelSpec, RunGh } from "./sync-labels";
import { parseLabelsFile, planLabelSync, runLabelSync } from "./sync-labels";

const spec = (name: string, color = "0e8a16", description = "A label."): LabelSpec => ({
  name,
  color,
  description,
});

describe("planLabelSync", () => {
  test("a missing label is planned for creation", () => {
    const plan = planLabelSync([spec("ready")], []);
    expect(plan.create).toEqual([spec("ready")]);
    expect(plan.update).toEqual([]);
    expect(plan.keep).toBe(0);
  });

  test("a label with another color is planned for update", () => {
    const plan = planLabelSync([spec("ready", "0e8a16")], [spec("ready", "ffffff")]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([spec("ready", "0e8a16")]);
    expect(plan.keep).toBe(0);
  });

  test("a label with another description is planned for update", () => {
    const plan = planLabelSync(
      [spec("ready", "0e8a16", "New.")],
      [spec("ready", "0e8a16", "Old.")],
    );
    expect(plan.update).toEqual([spec("ready", "0e8a16", "New.")]);
  });

  test("an extra existing label is kept, never deleted", () => {
    const plan = planLabelSync([spec("ready")], [spec("ready"), spec("bug", "d73a4a")]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.keep).toBe(2);
  });

  test("an identical set plans nothing and reports keep=N", () => {
    const labels = [spec("a"), spec("b", "112233"), spec("c", "445566")];
    const plan = planLabelSync(labels, labels);
    expect(plan).toEqual({ create: [], update: [], keep: 3 });
  });

  test("names are compared without case: Ready and ready are one label", () => {
    const same = planLabelSync([spec("ready")], [spec("Ready")]);
    expect(same).toEqual({ create: [], update: [], keep: 1 });
    const other = planLabelSync([spec("ready", "0e8a16")], [spec("Ready", "ffffff")]);
    expect(other.create).toEqual([]);
    expect(other.update).toEqual([spec("ready", "0e8a16")]);
  });

  test("colors are compared without a leading # and without case", () => {
    const plan = planLabelSync([spec("ready", "0E8A16")], [spec("ready", "#0e8a16")]);
    expect(plan).toEqual({ create: [], update: [], keep: 1 });
  });

  test("a desired label declared twice, whatever the case, is an error", () => {
    expect(() => planLabelSync([spec("ready"), spec("Ready")], [])).toThrow(
      "desired label declared twice",
    );
  });

  test("an existing label listed twice is an error: the universe would not sum", () => {
    expect(() => planLabelSync([], [spec("bug"), spec("BUG")])).toThrow(
      "existing label listed twice",
    );
  });

  test("update + keep sums to the existing labels, and create is the desired remainder", () => {
    const desired = [spec("a"), spec("b", "111111"), spec("c"), spec("d")];
    const existing = [spec("a"), spec("B", "222222"), spec("x"), spec("y"), spec("z")];
    const plan = planLabelSync(desired, existing);
    expect(plan.create.map((label) => label.name)).toEqual(["c", "d"]);
    expect(plan.update.map((label) => label.name)).toEqual(["b"]);
    expect(plan.update.length + plan.keep).toBe(existing.length);
    expect(plan.keep).toBe(4);
  });

  test("the input arrays are not mutated", () => {
    const desired = Object.freeze([spec("a")]);
    const existing = Object.freeze([spec("b")]);
    expect(() => planLabelSync(desired, existing)).not.toThrow();
  });
});

describe("parseLabelsFile", () => {
  const valid = [
    "- name: ready",
    '  color: "0e8a16"',
    "  description: Ready to start.",
    "- name: kind:idea",
    '  color: "fbca04"',
    "  description: A deferred idea.",
  ].join("\n");

  const reasonOf = (text: string): string => {
    const parsed = parseLabelsFile(text);
    if (parsed.ok) throw new Error("expected a refusal");
    return parsed.reason;
  };

  test("a well-formed file yields its labels, colors normalised to lowercase", () => {
    const parsed = parseLabelsFile(valid.replace("0e8a16", "0E8A16"));
    expect(parsed).toEqual({
      ok: true,
      value: [
        spec("ready", "0e8a16", "Ready to start."),
        spec("kind:idea", "fbca04", "A deferred idea."),
      ],
    });
  });

  test("invalid YAML is refused with its cause", () => {
    expect(reasonOf("- name: [unclosed")).toContain("not valid YAML");
  });

  test("an empty file is refused", () => {
    expect(reasonOf("")).toContain("sequence");
  });

  test("a root that is not a sequence is refused", () => {
    expect(reasonOf("name: ready\ncolor: 0e8a16\n")).toContain("sequence");
  });

  test("an empty sequence is refused: nothing declared is not a vocabulary", () => {
    expect(reasonOf("[]")).toContain("at least one");
  });

  test("an entry that is not a mapping is refused", () => {
    expect(reasonOf("- ready")).toContain("entry 0 must be a mapping");
  });

  test.each(["name", "color", "description"])("an entry without %s is refused", (field) => {
    const entry: Record<string, string> = {
      name: "ready",
      color: "0e8a16",
      description: "Ready.",
    };
    delete entry[field];
    const text = Object.entries(entry)
      .map(([key, value], index) => `${index === 0 ? "- " : "  "}${key}: "${value}"`)
      .join("\n");
    expect(reasonOf(text)).toContain(`entry 0 has no ${field}`);
  });

  test("a field of the wrong type is refused", () => {
    expect(reasonOf('- name: 7\n  color: "0e8a16"\n  description: x')).toContain(
      "entry 0 name must be a string",
    );
    expect(reasonOf("- name: ready\n  color: 123456\n  description: x")).toContain(
      "entry 0 color must be a string",
    );
    expect(reasonOf('- name: ready\n  color: "0e8a16"\n  description: [x]')).toContain(
      "entry 0 description must be a string",
    );
  });

  test("an unknown key is refused", () => {
    expect(
      reasonOf('- name: ready\n  color: "0e8a16"\n  description: x\n  colour: "fff"'),
    ).toContain('entry 0 has an unknown key "colour"');
  });

  test.each([
    ["5 digits", "0e8a1"],
    ["7 digits", "0e8a16f"],
    ["a non-hex digit", "0e8a1g"],
    ["a leading #", "#0e8a16"],
    ["empty", ""],
  ])("a color with %s is refused", (_label, color) => {
    expect(reasonOf(`- name: ready\n  color: "${color}"\n  description: x`)).toContain(
      "entry 0 color must be 6 hexadecimal digits",
    );
  });

  test("an empty or blank name is refused", () => {
    expect(reasonOf('- name: ""\n  color: "0e8a16"\n  description: x')).toContain(
      "entry 0 name must not be empty",
    );
    expect(reasonOf('- name: "   "\n  color: "0e8a16"\n  description: x')).toContain(
      "entry 0 name must not be empty",
    );
  });

  test("a name with surrounding whitespace is refused", () => {
    expect(reasonOf('- name: " ready"\n  color: "0e8a16"\n  description: x')).toContain(
      "surrounding whitespace",
    );
  });

  test("a duplicate name, whatever the case, is refused and both entries are named", () => {
    const text = [
      '- name: ready\n  color: "0e8a16"\n  description: x',
      '- name: Ready\n  color: "0e8a16"\n  description: y',
    ].join("\n");
    const reason = reasonOf(text);
    expect(reason).toContain("entry 1");
    expect(reason).toContain("duplicates entry 0");
  });
});

describe("parseLabelsFile: unreadable characters", () => {
  // Built from code points: a literal NUL or BOM in this source would be as invisible
  // to a reviewer as it is to the parser.
  const char = (codePoint: number): string => String.fromCodePoint(codePoint);
  const FIRST = ["- name: ready", '  color: "0e8a16"', "  description: ok"];
  const SECOND = ["- name: bad", '  color: "zzzzzz"', "  description: x"];

  const reasonOf = (text: string): string => {
    const parsed = parseLabelsFile(text);
    if (parsed.ok) throw new Error(`expected a refusal, got ${parsed.value.length} label(s)`);
    return parsed.reason;
  };

  test("a NUL ending a value line no longer hides the invalid entry after it", () => {
    const lines = [...FIRST.slice(0, 2), `${FIRST[2]}${char(0)}`, ...SECOND];
    expect(reasonOf(lines.join("\n"))).toBe(
      "labels file contains an unreadable character U+0000 on line 3",
    );
  });

  test("a NUL at the end of the last line is refused", () => {
    const text = `${[...FIRST, ...SECOND].join("\n")}${char(0)}`;
    expect(reasonOf(text)).toBe("labels file contains an unreadable character U+0000 on line 6");
  });

  test.each([
    ["U+0001", 0x0001],
    ["U+007F", 0x007f],
    ["U+0085", 0x0085],
    ["U+00A0", 0x00a0],
    ["U+2028", 0x2028],
    ["a lone surrogate", 0xd800],
  ])("%s inside a value is refused with its line", (_label, codePoint) => {
    const text = [...FIRST.slice(0, 2), `${FIRST[2]}${char(codePoint)}`].join("\n");
    const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
    expect(reasonOf(text)).toBe(`labels file contains an unreadable character U+${hex} on line 3`);
  });

  test("a byte order mark at the start is refused", () => {
    expect(reasonOf(`${char(0xfeff)}${FIRST.join("\n")}`)).toBe(
      "labels file contains an unreadable character U+FEFF on line 1",
    );
  });

  test("CRLF line endings still load", () => {
    const parsed = parseLabelsFile(`${FIRST.join("\r\n")}\r\n`);
    expect(parsed).toEqual({
      ok: true,
      value: [{ name: "ready", color: "0e8a16", description: "ok" }],
    });
  });
});

// --- the orchestrator, with a fake gh ---------------------------------------

const DESIRED_TEXT = [
  "- name: ready",
  '  color: "0e8a16"',
  "  description: Ready to start.",
  "- name: kind:idea",
  '  color: "fbca04"',
  "  description: A deferred idea.",
].join("\n");

const ok = (stdout: string): GhResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): GhResult => ({ code: 1, stdout: "", stderr });

interface ApiLabel {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly description: string | null;
  readonly default: boolean;
}

const apiLabel = (name: string, color: string, description: string | null): ApiLabel => ({
  id: 1,
  name,
  color,
  description,
  default: false,
});

const LIST_ARGS = "repo list libre-ai --limit 200 --json name,isArchived,isPrivate";
const labelsArgs = (repo: string): string => `api --paginate --slurp repos/libre-ai/${repo}/labels`;

interface Harness {
  readonly lines: string[];
  readonly calls: string[];
  readonly code: Promise<number>;
}

function harness(
  argv: readonly string[],
  answers: Record<string, GhResult>,
  labelsText: string | Error = DESIRED_TEXT,
): Harness {
  const lines: string[] = [];
  const calls: string[] = [];
  const runGh: RunGh = async (args) => {
    const key = args.join(" ");
    calls.push(key);
    return answers[key] ?? fail(`unexpected gh call: ${key}`);
  };
  const code = runLabelSync(argv, {
    runGh,
    readFile: async () => {
      if (labelsText instanceof Error) throw labelsText;
      return labelsText;
    },
    say: (line) => lines.push(line),
  });
  return { lines, calls, code };
}

const FOUR_REPOSITORIES = JSON.stringify([
  { name: "alpha", isArchived: false, isPrivate: false },
  { name: "bravo", isArchived: false, isPrivate: true },
  { name: "old", isArchived: true, isPrivate: false },
  { name: "broken", isArchived: false, isPrivate: false },
]);

describe("runLabelSync", () => {
  test("4 repositories, 1 archived and 1 unreadable: counters sum, exit is non-zero, nothing is written", async () => {
    const run = harness(["--labels", "labels.yml"], {
      [LIST_ARGS]: ok(FOUR_REPOSITORIES),
      // alpha has Ready with another color, plus an unrelated label: 1 update, 1 create, keep 1.
      [labelsArgs("alpha")]: ok(
        JSON.stringify([
          [apiLabel("Ready", "ffffff", "Ready to start."), apiLabel("bug", "d73a4a", null)],
        ]),
      ),
      // bravo is already identical to ready; kind:idea is missing: 1 create, keep 1.
      [labelsArgs("bravo")]: ok(JSON.stringify([[apiLabel("ready", "0E8A16", "Ready to start.")]])),
      [labelsArgs("broken")]: fail("HTTP 403: Resource not accessible"),
    });
    expect(await run.code).toBe(1);
    const output = run.lines.join("\n");
    expect(output).toContain(
      "4 dépôts listés, 1 archivés exclus, 2 planifiés, 1 illisibles ; créer 2, mettre à jour 1, conserver 2",
    );
    // Labels read: 3 existing = 1 updated + 2 kept.
    expect(output).toContain("3 labels lus = 1 à mettre à jour + 2 conservés");
    expect(output).toContain("broken");
    expect(output).toContain("HTTP 403");
    // The archived repository is never read.
    expect(run.calls).not.toContain(labelsArgs("old"));
    // Read-only: every call is a list or a GET on labels.
    expect(
      run.calls.every(
        (call) => call.startsWith("repo list") || call.startsWith("api --paginate --slurp "),
      ),
    ).toBe(true);
    expect(run.calls.some((call) => /--method|-X |--field|-f |-F /.test(call))).toBe(false);
  });

  test("a fully readable universe exits 0", async () => {
    const run = harness(["--labels", "labels.yml", "--org", "libre-ai"], {
      [LIST_ARGS]: ok(
        JSON.stringify([
          { name: "alpha", isArchived: false, isPrivate: false },
          { name: "old", isArchived: true, isPrivate: false },
        ]),
      ),
      [labelsArgs("alpha")]: ok(JSON.stringify([[]])),
    });
    expect(await run.code).toBe(0);
    expect(run.lines.join("\n")).toContain(
      "2 dépôts listés, 1 archivés exclus, 1 planifiés, 0 illisibles ; créer 2, mettre à jour 0, conserver 0",
    );
  });

  test("labels spread over several pages are all counted", async () => {
    const run = harness(["--labels", "labels.yml"], {
      [LIST_ARGS]: ok(JSON.stringify([{ name: "alpha", isArchived: false, isPrivate: false }])),
      [labelsArgs("alpha")]: ok(
        JSON.stringify([
          [apiLabel("ready", "0e8a16", "Ready to start.")],
          [apiLabel("kind:idea", "fbca04", "A deferred idea.")],
        ]),
      ),
    });
    expect(await run.code).toBe(0);
    expect(run.lines.join("\n")).toContain("créer 0, mettre à jour 0, conserver 2");
  });

  test("--apply is refused before any call", async () => {
    const run = harness(["--labels", "labels.yml", "--apply"], {});
    expect(await run.code).not.toBe(0);
    expect(run.lines.join("\n")).toContain("apply is an owner act, not implemented here");
    expect(run.calls).toEqual([]);
  });

  test("--labels is mandatory", async () => {
    const run = harness([], {});
    expect(await run.code).not.toBe(0);
    expect(run.lines.join("\n")).toContain("--labels");
    expect(run.calls).toEqual([]);
  });

  test("an unknown argument is refused", async () => {
    const run = harness(["--labels", "labels.yml", "--force"], {});
    expect(await run.code).not.toBe(0);
    expect(run.lines.join("\n")).toContain("unknown argument --force");
  });

  test("an org name that is not a plain identifier is refused", async () => {
    const run = harness(["--labels", "labels.yml", "--org", "libre-ai/../x"], {});
    expect(await run.code).not.toBe(0);
    expect(run.calls).toEqual([]);
  });

  test("an unreadable or invalid labels file stops before any gh call", async () => {
    const missing = harness(["--labels", "nope.yml"], {}, new Error("ENOENT"));
    expect(await missing.code).not.toBe(0);
    expect(missing.calls).toEqual([]);
    const invalid = harness(["--labels", "labels.yml"], {}, "- name: ready");
    expect(await invalid.code).not.toBe(0);
    expect(invalid.lines.join("\n")).toContain("entry 0 has no color");
    expect(invalid.calls).toEqual([]);
  });

  test("a repository listing that fails is an error, never an empty universe", async () => {
    const run = harness(["--labels", "labels.yml"], { [LIST_ARGS]: fail("HTTP 502") });
    expect(await run.code).not.toBe(0);
    expect(run.lines.join("\n")).toContain("HTTP 502");
  });

  test("an empty repository listing is an error", async () => {
    const run = harness(["--labels", "labels.yml"], { [LIST_ARGS]: ok("[]") });
    expect(await run.code).not.toBe(0);
    expect(run.lines.join("\n")).toContain("no repository");
  });

  test("a listing that reaches the limit may be truncated and is an error", async () => {
    const many = Array.from({ length: 200 }, (_, index) => ({
      name: `r${index}`,
      isArchived: true,
      isPrivate: false,
    }));
    const run = harness(["--labels", "labels.yml"], { [LIST_ARGS]: ok(JSON.stringify(many)) });
    expect(await run.code).not.toBe(0);
    expect(run.lines.join("\n")).toContain("limit");
  });

  test("a listing that is not the expected JSON is an error", async () => {
    for (const body of ["not json", '{"name":"x"}', '[{"name":"x"}]']) {
      const run = harness(["--labels", "labels.yml"], { [LIST_ARGS]: ok(body) });
      expect(await run.code).not.toBe(0);
    }
  });

  test("labels that are not the expected JSON make the repository unreadable", async () => {
    for (const body of ["not json", "[]", '[{"name":"x"}]', '[[{"name":"x"}]]', "[[7]]"]) {
      const run = harness(["--labels", "labels.yml"], {
        [LIST_ARGS]: ok(JSON.stringify([{ name: "alpha", isArchived: false, isPrivate: false }])),
        [labelsArgs("alpha")]: ok(body),
      });
      expect(await run.code).toBe(1);
      expect(run.lines.join("\n")).toContain("1 illisibles");
    }
  });

  test("a repository whose name is not a plain identifier is unreadable and never reaches gh api", async () => {
    const run = harness(["--labels", "labels.yml"], {
      [LIST_ARGS]: ok(JSON.stringify([{ name: "a/../b", isArchived: false, isPrivate: false }])),
    });
    expect(await run.code).toBe(1);
    expect(run.calls).toEqual([LIST_ARGS]);
    expect(run.lines.join("\n")).toContain("1 illisibles");
  });

  test("a gh that throws makes the repository unreadable", async () => {
    const lines: string[] = [];
    const code = await runLabelSync(["--labels", "labels.yml"], {
      runGh: async (args) => {
        if (args[0] === "repo")
          return ok(JSON.stringify([{ name: "alpha", isArchived: false, isPrivate: false }]));
        throw new Error("spawn gh ENOENT");
      },
      readFile: async () => DESIRED_TEXT,
      say: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("spawn gh ENOENT");
  });
});
