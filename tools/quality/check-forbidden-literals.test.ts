import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  FORBIDDEN_LITERAL_MARKER,
  type LiteralFamily,
  type LiteralScan,
  scanForbiddenLiterals,
} from "./check-forbidden-literals";

// Every refused form is assembled here at run time. Written out, they would be
// read by the repository's other guards, which do not all exempt test files.
const glue = (...parts: readonly string[]): string => parts.join("");
const address = (...octets: readonly number[]): string => octets.join(".");

const CURL = glue("cu", "rl");
const WGET = glue("wg", "et");
const CHMOD = glue("ch", "mod");
const SEVENS = "7".repeat(3);
const PIPE = " | ";
const TOLERANCE = glue("continue", "-on-", "error: true");
const REASONED = `# ${FORBIDDEN_LITERAL_MARKER} rapport consultatif`;
const BARE = `# ${FORBIDDEN_LITERAL_MARKER}`;

const DOWNLOAD_LINE = glue(CURL, " -fsSL https://x.example/i.sh", PIPE, "sudo bash");
const PERMISSION_LINE = `${CHMOD} ${SEVENS} d`;
const ADDRESS_LINE = `ssh deploy@${address(10, 0, 3, 17)}`;
const WORKFLOW = ".github/workflows/x.yml";

function scanLine(path: string, line: string): LiteralScan {
  return scanForbiddenLiterals([{ path, text: `first\n${line}\nlast\n` }]);
}

function families(scan: LiteralScan): LiteralFamily[] {
  return scan.findings.map((finding) => finding.family);
}

function sums(scan: LiteralScan): boolean {
  return (
    scan.tracked ===
    scan.examined +
      scan.excludedProse +
      scan.excludedLockfile +
      scan.excludedPatternSubject +
      scan.excludedBinary
  );
}

describe("download handed to an interpreter", () => {
  test("is counted once in a script, with its file, line, family and text", () => {
    const scan = scanLine("tools/x.sh", DOWNLOAD_LINE);
    expect(scan.findings).toEqual([
      { file: "tools/x.sh", line: 2, family: "download-to-interpreter", text: DOWNLOAD_LINE },
    ]);
    expect(scan.examined).toBe(1);
  });

  test("is not counted in prose, which is excluded and counted apart", () => {
    const scan = scanLine("docs/x.md", DOWNLOAD_LINE);
    expect(scan.findings).toEqual([]);
    expect(scan.excludedProse).toBe(1);
    expect(scan.examined).toBe(0);
  });

  test("is not counted on a line that is only a comment", () => {
    for (const prefix of ["#", "  # ", "//", " * ", "/*", "<!--"]) {
      expect(scanLine("tools/x.sh", `${prefix}${DOWNLOAD_LINE}`).findings).toEqual([]);
    }
  });

  test("the second downloader relayed to a versioned interpreter is counted", () => {
    expect(families(scanLine("tools/x.sh", glue(WGET, " -qO- u", PIPE, "python3")))).toEqual([
      "download-to-interpreter",
    ]);
  });

  test("a download written to a file, a logical or, and a non-interpreter are not counted", () => {
    expect(scanLine("tools/x.sh", `${CURL} -o f u`).findings).toEqual([]);
    expect(scanLine("tools/x.sh", glue(CURL, " -f u || bash fallback.sh")).findings).toEqual([]);
    expect(scanLine("tools/x.sh", glue(CURL, " -f u", PIPE, "shasum -a 256")).findings).toEqual([]);
  });
});

describe("permission opened to everyone", () => {
  test("each of the five forms is counted once", () => {
    const forms = [
      `${CHMOD} ${SEVENS} d`,
      `${CHMOD} 0${SEVENS} d`,
      `${CHMOD} a+rwx d`,
      `${CHMOD} o+w d`,
      `${CHMOD}Sync(p, 0o${SEVENS})`,
    ];
    for (const form of forms) {
      expect(families(scanLine("tools/x.sh", form))).toEqual(["world-writable-permission"]);
    }
  });

  test("a closed mode is not counted, nor the open digits without the command", () => {
    expect(scanLine("tools/x.sh", `${CHMOD} 755 d`).findings).toEqual([]);
    expect(scanLine("tools/x.ts", `${CHMOD}Sync(p, 0o755)`).findings).toEqual([]);
    expect(scanLine("tools/x.ts", `const port = ${SEVENS};`).findings).toEqual([]);
  });
});

describe("IPv4 address in a network context", () => {
  test("a routable address after a connection word is counted", () => {
    expect(families(scanLine("tools/x.sh", ADDRESS_LINE))).toEqual(["network-ipv4-literal"]);
  });

  test("loopback, unspecified, broadcast and documentation ranges are not counted", () => {
    const uncounted = [
      `ssh u@${address(127, 0, 0, 1)}`,
      `${CURL} http://${address(203, 0, 113, 5)}/`,
      `scp f u@${address(192, 0, 2, 1)}:`,
      `ssh ${address(198, 51, 100, 7)}`,
      `host ${address(0, 0, 0, 0)}`,
      `${CURL} ${address(255, 255, 255, 255)}`,
    ];
    for (const line of uncounted) {
      expect(scanLine("tools/x.sh", line).findings).toEqual([]);
    }
  });

  test("four numbers without a network context are not an address", () => {
    expect(scanLine("tools/x.sh", `version ${address(1, 2, 3, 4)}`).findings).toEqual([]);
  });

  test("an octet above 255 is not an address", () => {
    expect(scanLine("tools/x.sh", `ssh ${address(999, 1, 1, 1)}`).findings).toEqual([]);
  });
});

describe("tolerated failure in a workflow", () => {
  test("is counted without a marker", () => {
    expect(families(scanLine(WORKFLOW, `        ${TOLERANCE}`))).toEqual([
      "unjustified-failure-tolerance",
    ]);
  });

  test("is exempted by a reasoned marker, and listed", () => {
    const scan = scanLine(WORKFLOW, `        ${TOLERANCE} ${REASONED}`);
    expect(scan.findings).toEqual([]);
    expect(scan.allowed.map((finding) => finding.family)).toEqual([
      "unjustified-failure-tolerance",
    ]);
    expect(scan.allowed[0]?.line).toBe(2);
  });

  test("a marker without a reason exempts nothing", () => {
    for (const bare of [BARE, `${BARE}   `, `<!-- ${FORBIDDEN_LITERAL_MARKER} -->`]) {
      const scan = scanLine(WORKFLOW, `        ${TOLERANCE} ${bare}`);
      expect(families(scan)).toEqual(["unjustified-failure-tolerance"]);
      expect(scan.allowed).toEqual([]);
    }
  });

  test("the same line outside the workflows directory is not counted", () => {
    expect(scanLine("tools/x.yml", `        ${TOLERANCE}`).findings).toEqual([]);
  });
});

describe("the reasoned marker", () => {
  test("exempts each of the four families, each listed in allowed", () => {
    const cases: readonly (readonly [string, string, LiteralFamily])[] = [
      ["tools/x.sh", DOWNLOAD_LINE, "download-to-interpreter"],
      ["tools/x.sh", PERMISSION_LINE, "world-writable-permission"],
      ["tools/x.sh", ADDRESS_LINE, "network-ipv4-literal"],
      [WORKFLOW, TOLERANCE, "unjustified-failure-tolerance"],
    ];
    for (const [path, line, family] of cases) {
      const scan = scanLine(path, `${line} ${REASONED}`);
      expect(scan.findings).toEqual([]);
      expect(scan.allowed.map((finding) => finding.family)).toEqual([family]);
    }
  });
});

describe("families owned by other gates", () => {
  test("a default-branch option and a machine path give no finding here", () => {
    const branchOption = glue("git clone --branch ", "ma", "in", " repo");
    const machinePath = glue("cat ", "/", "Users", "/x/notes");
    const scan = scanForbiddenLiterals([
      { path: "tools/x.sh", text: `${branchOption}\n${machinePath}\n` },
    ]);
    expect(scan.findings).toEqual([]);
    expect(scan.allowed).toEqual([]);
    expect(scan.examined).toBe(1);
  });
});

describe("exclusions and counters", () => {
  test("tests and fixtures carrying a form are excluded and counted", () => {
    const scan = scanForbiddenLiterals([
      { path: "tools/tests/x.sh", text: DOWNLOAD_LINE },
      { path: "tools/fixtures/x.sh", text: PERMISSION_LINE },
      { path: "tools/x.test.ts", text: ADDRESS_LINE },
    ]);
    expect(scan.findings).toEqual([]);
    expect(scan.excludedPatternSubject).toBe(3);
    expect(scan.examined).toBe(0);
  });

  test("every file lands in exactly one counter, and the counters sum to the input", () => {
    const scan = scanForbiddenLiterals([
      { path: "tools/a.sh", text: DOWNLOAD_LINE },
      { path: "tools/b.ts", text: "export {};\n" },
      { path: "docs/a.md", text: DOWNLOAD_LINE },
      { path: "docs/b.txt", text: PERMISSION_LINE },
      { path: "bun.lock", text: ADDRESS_LINE },
      { path: "crates/x/Cargo.lock", text: ADDRESS_LINE },
      { path: "tools/x.py.lock", text: ADDRESS_LINE },
      { path: "tools/fixtures/a.sh", text: DOWNLOAD_LINE },
      { path: "brand/logo.png", text: null },
    ]);
    expect({
      tracked: scan.tracked,
      examined: scan.examined,
      prose: scan.excludedProse,
      lockfile: scan.excludedLockfile,
      subject: scan.excludedPatternSubject,
      binary: scan.excludedBinary,
    }).toEqual({ tracked: 9, examined: 2, prose: 2, lockfile: 3, subject: 1, binary: 1 });
    expect(sums(scan)).toBe(true);
    expect(families(scan)).toEqual(["download-to-interpreter"]);
  });

  test("an empty input sums too", () => {
    const scan = scanForbiddenLiterals([]);
    expect(scan.tracked).toBe(0);
    expect(sums(scan)).toBe(true);
  });
});

const REPOSITORY = join(import.meta.dir, "..", "..");
const GATE_PATH = "tools/quality/check-forbidden-literals.ts";
const GATE = join(REPOSITORY, GATE_PATH);
const TEMPLATE_PATH = ".github/workflows/reusable-dependency-policy.yml";

describe("the gate read by itself", () => {
  test("its own source gives no finding and no allowance", () => {
    const scan = scanForbiddenLiterals([{ path: GATE_PATH, text: readFileSync(GATE, "utf8") }]);
    expect(scan.examined).toBe(1);
    expect(scan.findings).toEqual([]);
    expect(scan.allowed).toEqual([]);
  });
});

interface GateRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

// The child inherits nothing but a PATH: on a CI run the ambient git variables
// would make the probe measure the run rather than its own case.
function runGate(cwd: string, path: string, ceiling: string): GateRun {
  const result = Bun.spawnSync([process.execPath, GATE], {
    cwd,
    env: { PATH: path, GIT_CEILING_DIRECTORIES: ceiling },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function git(cwd: string, argv: readonly string[]): void {
  const result = Bun.spawnSync(["git", ...argv], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`git ${argv.join(" ")}: ${new TextDecoder().decode(result.stderr)}`);
  }
}

describe("the gate as a process", () => {
  const systemPath = process.env.PATH ?? "";
  let scratch = "";

  function repository(name: string, files: Readonly<Record<string, string>>): string {
    const root = join(scratch, name);
    mkdirSync(root, { recursive: true });
    git(root, ["init", "-q"]);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    git(root, ["add", "-A"]);
    return root;
  }

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "forbidden-literals-test-"));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test("outside a repository: exit 2, a diagnostic on stderr, no success line", () => {
    const outside = join(scratch, "outside");
    mkdirSync(outside);
    const run = runGate(outside, systemPath, scratch);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("could not resolve the repository root");
    expect(run.stdout).toBe("");
  });

  test("a git that exits in error: exit 2, no success line", () => {
    const bin = join(scratch, "bin");
    mkdirSync(bin);
    const standIn = join(bin, "git");
    writeFileSync(standIn, "#!/bin/sh\nexit 128\n");
    chmodSync(standIn, 0o755);
    const run = runGate(REPOSITORY, bin, scratch);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("could not");
    expect(run.stdout).toBe("");
  });

  test("a tracked file that cannot be read: exit 2 naming it, never a clean scan", () => {
    const root = repository("unreadable", { "tools/kept.sh": "true\n", "tools/gone.sh": "true\n" });
    rmSync(join(root, "tools/gone.sh"));
    const run = runGate(root, systemPath, scratch);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("could not read tracked file tools/gone.sh");
    expect(run.stdout).toBe("");
  });

  test("the fleet template as annotated: exit 0 with counters that sum", () => {
    const template = readFileSync(join(REPOSITORY, TEMPLATE_PATH), "utf8");
    const root = repository("annotated", {
      [TEMPLATE_PATH]: template,
      "docs/a.md": DOWNLOAD_LINE,
      "tools/tests/a.sh": DOWNLOAD_LINE,
      "bun.lock": "",
      "brand/logo.bin": "\u0000\u0001",
    });
    const run = runGate(root, systemPath, scratch);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(
      "tracked=5 examined=1 excluded-prose=1 excluded-lockfile=1 excluded-test-fixture=1 excluded-binary=1 findings=0 allowed=1",
    );
    expect(run.stdout).toContain(`  allowed  ${TEMPLATE_PATH}:`);
    expect(run.stdout).toContain("Forbidden literals verified");
  });

  test("the fleet template without its annotation: exit 1 naming the file and line", () => {
    const template = readFileSync(join(REPOSITORY, TEMPLATE_PATH), "utf8");
    const lines = template.split("\n");
    const at = lines.findIndex((line) => line.includes(FORBIDDEN_LITERAL_MARKER));
    expect(at).toBeGreaterThan(-1);
    const annotated = lines[at] ?? "";
    lines[at] = annotated.slice(0, annotated.indexOf("#")).trimEnd();
    const root = repository("bare", { [TEMPLATE_PATH]: lines.join("\n") });
    const run = runGate(root, systemPath, scratch);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain(
      `${TEMPLATE_PATH}:${at + 1}: unjustified-failure-tolerance: ${TOLERANCE}`,
    );
    expect(run.stdout).not.toContain("verified");
  });
});
