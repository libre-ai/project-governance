import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DOCTRINE_SECTION_BEGIN,
  DOCTRINE_SECTION_END,
  EXIT_CODES,
  type InstructionFileSystem,
  nodeFileSystem,
  spliceDoctrineSection,
  writeInstructionSection,
} from "./write-instruction-section";

const BEGIN = DOCTRINE_SECTION_BEGIN;
const END = DOCTRINE_SECTION_END;
const section = (body: string) => `${BEGIN}\n${body}\n${END}`;
const SECTION = section("- rule one\n- rule two");

let directory = "";
let target = "";
let sectionFile = "";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "write-instruction-section-"));
  target = join(directory, "INSTRUCTIONS.md");
  sectionFile = join(directory, "section.md");
  writeFileSync(sectionFile, `${SECTION}\n`);
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const run = (args: readonly string[], fileSystem: InstructionFileSystem = nodeFileSystem) =>
  writeInstructionSection(args, fileSystem);
const bytes = (path: string) => readFileSync(path);

describe("target markers are counted as exact lines", () => {
  test("two begins and one end: code 4, target untouched, counts and lines named", () => {
    const original = `intro\n${BEGIN}\nold\n${BEGIN}\nolder\n${END}\nouter\n`;
    writeFileSync(target, original);
    const before = bytes(target);
    const outcome = run([target, sectionFile]);
    expect(outcome.code).toBe(4);
    expect(bytes(target).equals(before)).toBe(true);
    expect(outcome.message).toContain("2 begin marker(s) (line 2, 4)");
    expect(outcome.message).toContain("1 end marker(s) (line 6)");
  });

  test("end before begin: code 4, target untouched", () => {
    writeFileSync(target, `a\n${END}\nb\n${BEGIN}\nc\n`);
    const before = bytes(target);
    expect(run([target, sectionFile]).code).toBe(4);
    expect(bytes(target).equals(before)).toBe(true);
  });

  test("one begin and no end, or one end and no begin: code 4", () => {
    expect(spliceDoctrineSection(`a\n${BEGIN}\n`, SECTION)).toMatchObject({ ok: false, code: 4 });
    expect(spliceDoctrineSection(`a\n${END}\n`, SECTION)).toMatchObject({ ok: false, code: 4 });
  });

  test("one begin and two ends, or two full pairs: code 4", () => {
    const oneBeginTwoEnds = `${BEGIN}\nx\n${END}\ny\n${END}\n`;
    expect(spliceDoctrineSection(oneBeginTwoEnds, SECTION)).toMatchObject({ ok: false, code: 4 });
    const twoPairs = `${section("a")}\n${section("b")}\n`;
    expect(spliceDoctrineSection(twoPairs, SECTION)).toMatchObject({ ok: false, code: 4 });
  });

  test("one pair: only the lines from begin to end change", () => {
    const before = "# Project\n\nHand-written prose.\n\n";
    const after = "\n\nMore prose.\n";
    const original = `${before}${section("stale")}${after}`;
    const result = spliceDoctrineSection(original, SECTION);
    expect(result).toEqual({ ok: true, mode: "replaced", content: `${before}${SECTION}${after}` });
  });

  test("no marker, no final newline: original, '\\n', blank line, section, '\\n'", () => {
    writeFileSync(target, "# Project\nprose");
    const outcome = run([target, sectionFile]);
    expect(outcome.code).toBe(0);
    expect(outcome.message).toBe(
      `section written (appended, 4 lines, ${Buffer.byteLength(SECTION)} bytes)`,
    );
    expect(readFileSync(target, "utf8")).toBe(`# Project\nprose\n\n${SECTION}\n`);
  });

  test("absent target: created with the section and '\\n'", () => {
    const outcome = run([target, sectionFile]);
    expect(outcome.code).toBe(0);
    expect(outcome.message).toStartWith("section written (created, ");
    expect(readFileSync(target, "utf8")).toBe(`${SECTION}\n`);
  });

  test("a marker quoted inside a prose line is not a marker", () => {
    const original = `The block starts at ${BEGIN} and ends at ${END}.\n`;
    expect(spliceDoctrineSection(original, SECTION)).toEqual({
      ok: true,
      mode: "appended",
      content: `${original}\n${SECTION}\n`,
    });
  });

  test("CRLF target with \\r-terminated markers is one pair, replaced in place", () => {
    const original = `a\r\n${BEGIN}\r\nstale\r\n${END}\r\nb\r\n`;
    const result = spliceDoctrineSection(original, SECTION);
    expect(result).toEqual({ ok: true, mode: "replaced", content: `a\r\n${SECTION}\r\nb\r\n` });
  });
});

describe("the section file is validated", () => {
  test("section without an end marker: code 4, target untouched", () => {
    writeFileSync(target, "kept\n");
    writeFileSync(sectionFile, `${BEGIN}\nbody\n`);
    expect(run([target, sectionFile]).code).toBe(4);
    expect(readFileSync(target, "utf8")).toBe("kept\n");
  });

  test("section with two begin markers: code 4, target untouched", () => {
    writeFileSync(target, "kept\n");
    writeFileSync(sectionFile, `${BEGIN}\n${BEGIN}\nbody\n${END}\n`);
    expect(run([target, sectionFile]).code).toBe(4);
    expect(readFileSync(target, "utf8")).toBe("kept\n");
  });

  test("the section is written as is: no backslash or pattern interpretation", () => {
    const literal = section("a \\n b $& $1 \\\\ \\u0041");
    writeFileSync(sectionFile, literal);
    writeFileSync(target, `x\n${section("old")}\ny\n`);
    expect(run([target, sectionFile]).code).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(`x\n${literal}\ny\n`);
  });
});

describe("repeated runs", () => {
  test("a second run with the same section gives the same bytes", () => {
    writeFileSync(target, "# Project\nprose");
    expect(run([target, sectionFile]).code).toBe(0);
    const first = bytes(target);
    const second = run([target, sectionFile]);
    expect(second.message).toStartWith("section written (replaced, ");
    expect(bytes(target).equals(first)).toBe(true);
  });
});

describe("--max-bytes", () => {
  test("equal to result plus --count-with: written; one less: code 6 naming every file", () => {
    const global = join(directory, "global.md");
    writeFileSync(global, "global rules\n");
    writeFileSync(target, "prose\n");
    const resultBytes = Buffer.byteLength(`prose\n\n${SECTION}\n`);
    const total = resultBytes + Buffer.byteLength("global rules\n");

    const over = run([
      target,
      sectionFile,
      "--max-bytes",
      String(total - 1),
      "--count-with",
      global,
    ]);
    expect(over.code).toBe(6);
    expect(readFileSync(target, "utf8")).toBe("prose\n");
    expect(over.message).toContain(`measured ${total} bytes`);
    expect(over.message).toContain(`limit ${total - 1} bytes`);
    expect(over.message).toContain(`${target} (after write) ${resultBytes} bytes`);
    expect(over.message).toContain(`${global} 13 bytes`);

    const exact = run([target, sectionFile, "--max-bytes", String(total), "--count-with", global]);
    expect(exact.code).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(`prose\n\n${SECTION}\n`);
  });

  test("an unreadable --count-with is code 3, never a zero", () => {
    writeFileSync(target, "prose\n");
    const missing = join(directory, "missing.md");
    const outcome = run([target, sectionFile, "--max-bytes", "100000", "--count-with", missing]);
    expect(outcome.code).toBe(3);
    expect(readFileSync(target, "utf8")).toBe("prose\n");
  });
});

describe("atomic write", () => {
  test("a failing rename: code 5, target identical, no temporary file left", () => {
    writeFileSync(target, `x\n${section("old")}\n`);
    const before = bytes(target);
    const failingRename: InstructionFileSystem = {
      ...nodeFileSystem,
      rename() {
        throw new Error("rename refused");
      },
    };
    const outcome = run([target, sectionFile], failingRename);
    expect(outcome.code).toBe(5);
    expect(bytes(target).equals(before)).toBe(true);
    expect(readdirSync(directory).sort()).toEqual(["INSTRUCTIONS.md", "section.md"]);
  });

  test("a failing temporary write: code 5, target identical, no temporary file left", () => {
    writeFileSync(target, "kept\n");
    const failingWrite: InstructionFileSystem = {
      ...nodeFileSystem,
      writeNew(path, content, mode) {
        nodeFileSystem.writeNew(path, content.slice(0, 1), mode);
        throw new Error("disk full");
      },
    };
    expect(run([target, sectionFile], failingWrite).code).toBe(5);
    expect(readFileSync(target, "utf8")).toBe("kept\n");
    expect(readdirSync(directory).sort()).toEqual(["INSTRUCTIONS.md", "section.md"]);
  });

  test("bytes outside the section survive even when they are not UTF-8", () => {
    const prefix = Buffer.from([0xff, 0xfe, 0x0a]);
    const suffix = Buffer.from([0x0a, 0xc3, 0x28, 0x0a]);
    writeFileSync(target, Buffer.concat([prefix, Buffer.from(section("old")), suffix]));
    expect(run([target, sectionFile]).code).toBe(0);
    const expected = Buffer.concat([prefix, Buffer.from(SECTION), suffix]);
    expect(bytes(target).equals(expected)).toBe(true);
  });
});

describe("unreadable inputs", () => {
  test("target that is a symbolic link: code 3, link and pointee intact", () => {
    const pointee = join(directory, "real.md");
    writeFileSync(pointee, "real\n");
    symlinkSync(pointee, target);
    const outcome = run([target, sectionFile]);
    expect(outcome.code).toBe(3);
    expect(outcome.message).toContain("a symbolic link");
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readFileSync(pointee, "utf8")).toBe("real\n");
  });

  test("target that is a directory, or an unreadable section: code 3", () => {
    mkdirSync(target);
    expect(run([target, sectionFile]).code).toBe(3);
    expect(run([join(directory, "other.md"), join(directory, "missing.md")]).code).toBe(3);
    expect(existsSync(join(directory, "other.md"))).toBe(false);
  });
});

describe("usage", () => {
  const untouchable: InstructionFileSystem = {
    inspect: () => {
      throw new Error("inspected");
    },
    read: () => {
      throw new Error("read");
    },
    writeNew: () => {
      throw new Error("written");
    },
    rename: () => {
      throw new Error("renamed");
    },
    remove: () => {
      throw new Error("removed");
    },
  };

  test.each([
    ["path starting with '-'", ["-target", "section"]],
    ["--max-bytes 0", ["t", "s", "--max-bytes", "0"]],
    ["--max-bytes abc", ["t", "s", "--max-bytes", "abc"]],
    ["unknown option", ["t", "s", "--force"]],
    ["missing section", ["t"]],
    ["extra argument", ["t", "s", "u"]],
    ["--count-with without value", ["t", "s", "--count-with"]],
    ["--count-with path starting with '-'", ["t", "s", "--count-with", "-g"]],
  ])("%s: code 2, nothing read or written", (_label, args) => {
    const outcome = run(args, untouchable);
    expect(outcome.code).toBe(2);
    expect(outcome.message).toContain("usage: bun tools/doctrine/write-instruction-section.ts");
  });
});

describe("command", () => {
  test("runs as a subprocess with an emptied environment", () => {
    writeFileSync(target, "prose\n");
    const child = Bun.spawnSync(
      [
        process.execPath,
        join(import.meta.dir, "write-instruction-section.ts"),
        target,
        sectionFile,
      ],
      { env: { PATH: process.env.PATH ?? "" }, stdout: "pipe", stderr: "pipe" },
    );
    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString()).toBe(
      `section written (appended, 4 lines, ${Buffer.byteLength(SECTION)} bytes)\n`,
    );
    expect(readFileSync(target, "utf8")).toBe(`prose\n\n${SECTION}\n`);
  });
});

describe("method document", () => {
  test("documents the command under its heading with exactly the EXIT_CODES values", () => {
    const document = readFileSync(
      join(import.meta.dir, "../../docs/method/DOCTRINE-REPLICATION.md"),
      "utf8",
    );
    const start = document.indexOf("\n## Rendu dans une section balisée\n");
    expect(start).toBeGreaterThan(-1);
    const next = document.indexOf("\n## ", start + 1);
    const body = document.slice(start, next === -1 ? undefined : next);
    expect(body).toContain("tools/doctrine/write-instruction-section.ts");
    const codes = [...body.matchAll(/^\| (\d+) +\|/gm)].map((match) => Number(match[1]));
    expect(codes.sort((a, b) => a - b)).toEqual(Object.values(EXIT_CODES).sort((a, b) => a - b));
  });
});
