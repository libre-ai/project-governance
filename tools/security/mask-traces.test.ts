import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type KnownValue,
  type MaskedBatch,
  maskBatch,
  reverifyBatch,
  type TraceDocument,
} from "./mask-traces";

const TOOL: string = join(import.meta.dir, "mask-traces.ts");

// Every value below is assembled at run time and has the shape of a
// credential without being one: the repository's own secret scanner must not
// read a committed token in this file.
const GITHUB_TOKEN = `ghp_${"A1b2C3d4E5".repeat(4)}`;
const ENV_SECRET = `bench-${"s3cr3t".repeat(3)}`;
const ASSIGNED = `zq${"9x8w7v".repeat(2)}`;
const EMAIL = ["someone", "personal-domain.fr"].join("@");
// Assembled for the same reason: the context-hygiene gate refuses a literal
// macOS home directory in a tracked file.
const MAC_HOMES = `/${"Users"}/`;

function masked(
  documents: readonly TraceDocument[],
  secretValues: readonly string[] = [],
): MaskedBatch {
  return maskBatch(documents, { secretValues });
}

function contentOf(batch: MaskedBatch, path: string): string {
  const document = batch.documents.find((candidate) => candidate.path === path);
  if (document === undefined) throw new Error(`${path} missing from the masked batch`);
  return document.content;
}

describe("batch scope (F-G4: found once, masked everywhere)", () => {
  test("a value found by context in one file is masked bare in another", () => {
    const batch = masked([
      { path: "a.txt", content: `config: token=${ASSIGNED}\n` },
      { path: "b.txt", content: `echoed ${ASSIGNED} later\n` },
    ]);
    expect(batch.failures).toEqual([]);
    expect(contentOf(batch, "a.txt")).not.toContain(ASSIGNED);
    expect(contentOf(batch, "b.txt")).toBe("echoed [REDACTED:credential-assignment] later\n");
  });

  test("a token found in a JSON file is masked in a text file of the same batch", () => {
    const batch = masked([
      { path: "run.json", content: `${JSON.stringify({ fin: `auth ${GITHUB_TOKEN}` })}\n` },
      { path: "notes.md", content: `the token ${GITHUB_TOKEN.slice(0)} again\n` },
    ]);
    expect(contentOf(batch, "notes.md")).toBe("the token [REDACTED:github-token] again\n");
  });

  test("a provided secret value is masked in every file, whatever its shape", () => {
    const batch = masked(
      [
        { path: "a.jsonl", content: `${JSON.stringify({ out: ENV_SECRET })}\n` },
        { path: "b.txt", content: `${ENV_SECRET}${ENV_SECRET}\n` },
      ],
      [ENV_SECRET],
    );
    expect(contentOf(batch, "a.jsonl")).toBe('{"out":"[REDACTED:secret-env]"}\n');
    expect(contentOf(batch, "b.txt")).toBe("[REDACTED:secret-env][REDACTED:secret-env]\n");
  });

  test("a provided value too short to mask safely is refused", () => {
    const batch = masked([{ path: "a.txt", content: "x" }], ["short"]);
    expect(batch.failures).toEqual([
      { path: "(secret values)", reason: "a provided secret value is shorter than 8 characters" },
    ]);
    expect(batch.documents).toEqual([]);
  });
});

describe("families", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["email", `mail ${EMAIL} now`, "mail [REDACTED:email] now"],
    ["macOS home", `at ${MAC_HOMES}alice/dev/x.ts:3`, `at ${MAC_HOMES}[REDACTED:home]/dev/x.ts:3`],
    ["Linux home", "cwd /home/bob/work", "cwd /home/[REDACTED:home]/work"],
    ["Windows home", "C:\\Users\\carol\\x", "C:\\Users\\[REDACTED:home]\\x"],
    // A documentation range (RFC 5737): masked like any address that is not private.
    ["public IPv4", "from 203.0.113.7:443", "from [REDACTED:ipv4]:443"],
    ["private IPv4 kept", "on 10.0.0.1 and 192.168.1.20", "on 10.0.0.1 and 192.168.1.20"],
    ["loopback kept", "http://127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["version kept", "Bun 1.4.0 and 2.56.1", "Bun 1.4.0 and 2.56.1"],
    ["github token", `t ${GITHUB_TOKEN}`, "t [REDACTED:github-token]"],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(contentOf(masked([{ path: "a.txt", content: input }]), "a.txt")).toBe(expected);
    });
  }
});

describe("formats", () => {
  test("JSON stays valid and keeps its structure", () => {
    const source = {
      cas: "D01",
      fin: `at ${MAC_HOMES}alice/x ${EMAIL}`,
      n: 3,
      nested: [{ ip: "198.51.100.20" }],
    };
    const batch = masked([{ path: "r.json", content: `${JSON.stringify(source, null, 2)}\n` }]);
    const parsed = JSON.parse(contentOf(batch, "r.json"));
    expect(parsed).toEqual({
      cas: "D01",
      fin: `at ${MAC_HOMES}[REDACTED:home]/x [REDACTED:email]`,
      n: 3,
      nested: [{ ip: "[REDACTED:ipv4]" }],
    });
  });

  test("a value split by a JSON escape is still masked: masking reads the decoded string", () => {
    const content = `{"fin":"${EMAIL.replace("@", "\\u0040")}"}\n`;
    const batch = masked([{ path: "r.json", content }]);
    expect(JSON.parse(contentOf(batch, "r.json"))).toEqual({ fin: "[REDACTED:email]" });
  });

  test("every JSONL line stays valid, blank lines kept", () => {
    const content = `${JSON.stringify({ a: EMAIL })}\n\n${JSON.stringify({ b: 1 })}\n`;
    const out = contentOf(masked([{ path: "r.jsonl", content }]), "r.jsonl");
    expect(out.split("\n")).toEqual(['{"a":"[REDACTED:email]"}', "", '{"b":1}', ""]);
  });

  test("a file with nothing to mask is returned byte for byte", () => {
    const content = '{\n  "short": [1, 2],   "kept": "as written"\n}\n';
    expect(contentOf(masked([{ path: "r.json", content }]), "r.json")).toBe(content);
  });

  test("an unparsable JSON file fails the whole batch", () => {
    const batch = masked([
      { path: "ok.txt", content: EMAIL },
      { path: "broken.json", content: "{not json" },
    ]);
    expect(batch.failures.map((failure) => failure.path)).toEqual(["broken.json"]);
    expect(batch.documents).toEqual([]);
  });

  test("two keys that would mask to the same name fail instead of merging", () => {
    const content = JSON.stringify({ [EMAIL]: 1, [EMAIL.replace("someone", "other")]: 2 });
    const batch = masked([{ path: "r.json", content }]);
    expect(batch.failures[0]?.reason).toContain("two keys");
  });
});

describe("reverification by other instruments (F-G5)", () => {
  test("the masked output of a batch passes all three instruments", () => {
    const batch = masked(
      [
        { path: "a.txt", content: `token=${ASSIGNED} ${GITHUB_TOKEN} ${EMAIL} ${ENV_SECRET}\n` },
        { path: "b.json", content: `${JSON.stringify({ x: ASSIGNED })}\n` },
      ],
      [ENV_SECRET],
    );
    const report = reverifyBatch(batch.documents, batch.known);
    expect(report.findings).toEqual([]);
    expect(report.examined).toEqual({ credential: 2, personal: 2, literal: 2 });
  });

  test("a credential the masker missed is caught by the credential scanner", () => {
    const report = reverifyBatch([{ path: "a.txt", content: `left ${GITHUB_TOKEN}\n` }], []);
    expect(report.findings).toEqual([{ path: "a.txt", line: 1, instrument: "credential scanner" }]);
  });

  test("an address the masker missed is caught by the personal-data scanner", () => {
    const report = reverifyBatch([{ path: "a.txt", content: `x\n${EMAIL}\n` }], []);
    expect(report.findings).toContainEqual({
      path: "a.txt",
      line: 2,
      instrument: "personal-data scanner",
    });
  });

  test("a known value left anywhere, escaped or not, is caught by the literal search", () => {
    const known: KnownValue[] = [{ family: "secret-env", value: 'with"quote-and-more' }];
    const report = reverifyBatch(
      [{ path: "a.json", content: '{"x":"with\\"quote-and-more"}' }],
      known,
    );
    expect(report.findings).toEqual([{ path: "a.json", line: 1, instrument: "literal search" }]);
  });
});

describe("command line", () => {
  const scratch = mkdtempSync(join(tmpdir(), "mask-traces-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  let count = 0;

  function workspace(files: Readonly<Record<string, string>>): string {
    count += 1;
    const root = join(scratch, String(count));
    mkdirSync(root);
    for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
    return root;
  }

  function run(cwd: string, args: readonly string[], env: Record<string, string> = {}) {
    const result = Bun.spawnSync(["bun", TOOL, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), ...env },
    });
    return {
      exitCode: result.exitCode,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
  }

  test("writes the masked batch, prints counts, never a value", () => {
    const root = workspace({
      "a.txt": `secret ${ENV_SECRET} and token=${ASSIGNED}\n`,
      "b.json": `${JSON.stringify({ x: ASSIGNED, y: EMAIL })}\n`,
    });
    const { exitCode, output } = run(
      root,
      ["--out", "masked", "--secret-env", "BENCH_SECRET", "a.txt", "b.json"],
      {
        BENCH_SECRET: ENV_SECRET,
      },
    );
    expect(exitCode).toBe(0);
    for (const value of [ENV_SECRET, ASSIGNED, EMAIL]) expect(output).not.toContain(value);
    expect(output).toContain("2 file(s) read");
    expect(output).toContain("0 finding(s)");
    expect(readFileSync(join(root, "masked", "a.txt"), "utf8")).toBe(
      "secret [REDACTED:secret-env] and token=[REDACTED:credential-assignment]\n",
    );
  });

  test("an unreadable file fails and writes nothing", () => {
    const root = workspace({ "a.txt": "x\n", "locked.txt": "y\n" });
    chmodSync(join(root, "locked.txt"), 0o000);
    const { exitCode, output } = run(root, ["--out", "masked", "a.txt", "locked.txt"]);
    chmodSync(join(root, "locked.txt"), 0o600);
    // A process running as root reads a mode-0 file: the case is then a missing file.
    expect(exitCode).toBe(2);
    expect(output).toContain("locked.txt");
    expect(existsSync(join(root, "masked"))).toBe(false);
  });

  test("a missing file fails and writes nothing", () => {
    const root = workspace({ "a.txt": "x\n" });
    const { exitCode } = run(root, ["--out", "masked", "a.txt", "absent.txt"]);
    expect(exitCode).toBe(2);
    expect(existsSync(join(root, "masked"))).toBe(false);
  });

  test("a named secret variable that is unset fails: an unread source is not an empty one", () => {
    const root = workspace({ "a.txt": "x\n" });
    const { exitCode, output } = run(root, [
      "--out",
      "masked",
      "--secret-env",
      "ABSENT_SECRET",
      "a.txt",
    ]);
    expect(exitCode).toBe(2);
    expect(output).toContain("ABSENT_SECRET");
  });

  test("an existing output directory is refused: inputs are never overwritten", () => {
    const root = workspace({ "a.txt": "x\n" });
    mkdirSync(join(root, "masked"));
    expect(run(root, ["--out", "masked", "a.txt"]).exitCode).toBe(2);
  });
});
