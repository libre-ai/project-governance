/**
 * Write a rendered doctrine section into an agent instruction file that also
 * carries hand-written text.
 *
 *   bun tools/doctrine/write-instruction-section.ts <target> <section> [--max-bytes <n>] [--count-with <file>]...
 *
 * The section is read from <section>, already rendered: choosing the rules is
 * someone else's job. It lands in <target> between two marker LINES. Those
 * markers are not the whole-file sentinel of docs/method/DOCTRINE-REPLICATION.md:
 * the sentinel declares a file generated end to end, the markers bound a
 * generated zone inside a file a human writes.
 *
 * Why exact lines and not substrings: a document that explains the markers
 * quotes them in prose, and a substring count reads that quotation as a real
 * marker. A marker here is a line equal to the marker once one trailing `\r`
 * is removed, so a CRLF file is recognised and a quotation is not.
 *
 * Why latin1 everywhere: it maps every byte to one code unit and back, so the
 * bytes outside the section survive the splice unchanged even when they are not
 * valid UTF-8, and a string length is a byte count for the budget. The markers
 * are ASCII, so they compare the same under either decoding.
 *
 * Every disk access goes through `InstructionFileSystem`, so a test can make the
 * temporary write or the rename fail and observe that the target is untouched.
 */
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export const DOCTRINE_SECTION_BEGIN = "<!-- libre-ai:doctrine:begin -->";
export const DOCTRINE_SECTION_END = "<!-- libre-ai:doctrine:end -->";

/** Code 1 is deliberately unused: nothing in this repository renders and refuses rules. */
export const EXIT_CODES = Object.freeze({
  written: 0,
  usage: 2,
  unreadable: 3,
  markers: 4,
  write: 5,
  overBudget: 6,
} as const);

type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export type SpliceMode = "created" | "appended" | "replaced";

export type SpliceResult =
  | { readonly ok: true; readonly mode: SpliceMode; readonly content: string }
  | { readonly ok: false; readonly code: 4; readonly reason: string };

interface Line {
  /** Offset of the first character of the line. */
  readonly start: number;
  /** Offset just past the line content, before an optional `\r` and the `\n`. */
  readonly contentEnd: number;
  readonly text: string;
}

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (true) {
    const newline = text.indexOf("\n", start);
    const rawEnd = newline === -1 ? text.length : newline;
    const contentEnd = rawEnd > start && text[rawEnd - 1] === "\r" ? rawEnd - 1 : rawEnd;
    lines.push({ start, contentEnd, text: text.slice(start, contentEnd) });
    if (newline === -1) return lines;
    start = newline + 1;
  }
}

function markerIndexes(lines: readonly Line[], marker: string): number[] {
  const indexes: number[] = [];
  lines.forEach((line, index) => {
    if (line.text === marker) indexes.push(index);
  });
  return indexes;
}

function describeMarkers(begins: readonly number[], ends: readonly number[]): string {
  const at = (indexes: readonly number[]) =>
    indexes.length === 0 ? "" : ` (line ${indexes.map((index) => index + 1).join(", ")})`;
  return `${begins.length} begin marker(s)${at(begins)}, ${ends.length} end marker(s)${at(ends)}`;
}

type SectionBody =
  | { readonly ok: true; readonly body: string }
  | Extract<SpliceResult, { ok: false }>;

/**
 * The section without what follows its end marker line: trailing blank lines
 * and the final line break belong to the file layout, not to the section.
 */
function sectionBody(section: string): SectionBody {
  const lines = linesOf(section);
  const begins = markerIndexes(lines, DOCTRINE_SECTION_BEGIN);
  const ends = markerIndexes(lines, DOCTRINE_SECTION_END);
  let lastNonEmpty = -1;
  lines.forEach((line, index) => {
    if (line.text.trim() !== "") lastNonEmpty = index;
  });
  const endIndex = ends[0];
  if (
    begins.length !== 1 ||
    ends.length !== 1 ||
    begins[0] !== 0 ||
    endIndex !== lastNonEmpty ||
    endIndex === undefined
  ) {
    return {
      ok: false,
      code: EXIT_CODES.markers,
      reason:
        `section: ${describeMarkers(begins, ends)}; expected exactly one begin marker on line 1 ` +
        "and exactly one end marker on the last non-empty line",
    };
  }
  const endLine = lines[endIndex];
  if (endLine === undefined) {
    return { ok: false, code: EXIT_CODES.markers, reason: "section: end marker line not found" };
  }
  return { ok: true, body: section.slice(0, endLine.contentEnd) };
}

/**
 * Pure splice. `current` is the target content, `null` when the target does not
 * exist. Every byte outside the replaced lines is kept as it was.
 */
export function spliceDoctrineSection(current: string | null, section: string): SpliceResult {
  const parsed = sectionBody(section);
  if (!parsed.ok) return parsed;
  const { body } = parsed;

  if (current === null) return { ok: true, mode: "created", content: `${body}\n` };

  const lines = linesOf(current);
  const begins = markerIndexes(lines, DOCTRINE_SECTION_BEGIN);
  const ends = markerIndexes(lines, DOCTRINE_SECTION_END);

  if (begins.length === 0 && ends.length === 0) {
    // One blank line between the hand-written text and the section; an empty
    // file has no text to separate from.
    const separator = current === "" ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    return { ok: true, mode: "appended", content: `${current}${separator}${body}\n` };
  }

  const beginLine = begins.length === 1 ? lines[begins[0] ?? -1] : undefined;
  const endLine = ends.length === 1 ? lines[ends[0] ?? -1] : undefined;
  if (beginLine !== undefined && endLine !== undefined && beginLine.start < endLine.start) {
    return {
      ok: true,
      mode: "replaced",
      content: current.slice(0, beginLine.start) + body + current.slice(endLine.contentEnd),
    };
  }

  // Which copy to keep is the owner's call, so the message gives every position.
  return {
    ok: false,
    code: EXIT_CODES.markers,
    reason:
      `target: ${describeMarkers(begins, ends)}; expected none, or one begin before one end ` +
      "— resolve the markers by hand, the target was left untouched",
  };
}

export type PathKind =
  | { readonly kind: "absent" }
  | { readonly kind: "file"; readonly mode: number }
  | { readonly kind: "other"; readonly detail: string };

/** Every disk access the command makes. Contents are latin1 strings (see header). */
export interface InstructionFileSystem {
  /** Without following a symbolic link. */
  inspect(path: string): PathKind;
  read(path: string): string;
  /** Create `path`, failing if it exists, and flush it to disk. */
  writeNew(path: string, content: string, mode: number | null): void;
  rename(from: string, to: string): void;
  remove(path: string): void;
}

export const nodeFileSystem: InstructionFileSystem = {
  inspect(path) {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) return { kind: "other", detail: "a symbolic link" };
      if (!stat.isFile()) return { kind: "other", detail: "not a regular file" };
      return { kind: "file", mode: stat.mode & 0o7777 };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { kind: "absent" };
      }
      throw error;
    }
  },
  read(path) {
    return readFileSync(path, "latin1");
  },
  writeNew(path, content, mode) {
    const descriptor = openSync(path, "wx");
    try {
      writeSync(descriptor, Buffer.from(content, "latin1"));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (mode !== null) chmodSync(path, mode);
  },
  rename(from, to) {
    renameSync(from, to);
  },
  remove(path) {
    rmSync(path, { force: true });
  },
};

export interface Outcome {
  readonly code: ExitCode;
  readonly message: string;
}

const USAGE =
  "usage: bun tools/doctrine/write-instruction-section.ts <target> <section> " +
  "[--max-bytes <n>] [--count-with <file>]...";

interface Arguments {
  readonly target: string;
  readonly section: string;
  readonly maxBytes: number | null;
  readonly countWith: readonly string[];
}

function usage(reason: string): Outcome {
  return { code: EXIT_CODES.usage, message: `${reason}\n${USAGE}` };
}

function parseArguments(argv: readonly string[]): Arguments | Outcome {
  const positional: string[] = [];
  const countWith: string[] = [];
  let maxBytes: number | null = null;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] ?? "";
    if (argument === "--max-bytes" || argument === "--count-with") {
      const value = argv[index + 1];
      index++;
      if (value === undefined) return usage(`${argument} needs a value`);
      if (value.startsWith("-")) return usage(`${argument} value starts with '-': ${value}`);
      if (argument === "--count-with") {
        countWith.push(value);
        continue;
      }
      if (maxBytes !== null) return usage("--max-bytes given twice");
      const parsed = Number(value);
      if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(parsed)) {
        return usage(`--max-bytes must be a strictly positive decimal integer: ${value}`);
      }
      maxBytes = parsed;
      continue;
    }
    if (argument.startsWith("-"))
      return usage(`unknown option or path starting with '-': ${argument}`);
    positional.push(argument);
  }
  const [target, section] = positional;
  if (target === undefined || section === undefined) return usage("missing <target> or <section>");
  if (positional.length > 2) return usage(`unexpected argument: ${positional[2]}`);
  return { target, section, maxBytes, countWith };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unreadable(what: string, path: string, why: string): Outcome {
  return {
    code: EXIT_CODES.unreadable,
    message: `${what} ${path} is unreadable: ${why}; nothing written`,
  };
}

/** The whole command, minus the process: parse, read, splice, measure, write. */
export function writeInstructionSection(
  argv: readonly string[],
  fileSystem: InstructionFileSystem,
): Outcome {
  const parsed = parseArguments(argv);
  if ("code" in parsed) return parsed;
  const { target, section, maxBytes, countWith } = parsed;

  let sectionText: string;
  try {
    sectionText = fileSystem.read(section);
  } catch (error) {
    return unreadable("section", section, errorText(error));
  }

  let targetKind: PathKind;
  let current: string | null = null;
  try {
    targetKind = fileSystem.inspect(target);
    if (targetKind.kind === "other") return unreadable("target", target, targetKind.detail);
    if (targetKind.kind === "file") current = fileSystem.read(target);
  } catch (error) {
    return unreadable("target", target, errorText(error));
  }

  const counted: { readonly path: string; readonly bytes: number }[] = [];
  for (const path of countWith) {
    try {
      counted.push({ path, bytes: Buffer.byteLength(fileSystem.read(path), "latin1") });
    } catch (error) {
      return unreadable("--count-with", path, errorText(error));
    }
  }

  const spliced = spliceDoctrineSection(current, sectionText);
  if (!spliced.ok) return { code: spliced.code, message: `${spliced.reason}; nothing written` };

  if (maxBytes !== null) {
    const resultBytes = Buffer.byteLength(spliced.content, "latin1");
    const measured = counted.reduce((sum, file) => sum + file.bytes, resultBytes);
    if (measured > maxBytes) {
      const parts = [`${target} (after write) ${resultBytes} bytes`].concat(
        counted.map((file) => `${file.path} ${file.bytes} bytes`),
      );
      return {
        code: EXIT_CODES.overBudget,
        message:
          `over budget: measured ${measured} bytes > limit ${maxBytes} bytes ` +
          `[${parts.join("; ")}]; nothing written`,
      };
    }
  }

  // Same directory as the target, so the rename stays on one file system and is atomic.
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  try {
    fileSystem.writeNew(
      temporary,
      spliced.content,
      targetKind.kind === "file" ? targetKind.mode : null,
    );
    fileSystem.rename(temporary, target);
  } catch (error) {
    try {
      fileSystem.remove(temporary);
    } catch {
      // The write error below is the one to report; a leftover is named in it.
      return {
        code: EXIT_CODES.write,
        message: `write failed: ${errorText(error)}; temporary file ${temporary} may remain`,
      };
    }
    return {
      code: EXIT_CODES.write,
      message: `write failed: ${errorText(error)}; target ${target} left untouched`,
    };
  }

  return { code: EXIT_CODES.written, message: successLine(spliced.mode, sectionText) };
}

/** Lines and bytes of the section as written, without its trailing layout. */
function successLine(mode: SpliceMode, sectionText: string): string {
  const parsed = sectionBody(sectionText);
  const body = parsed.ok ? parsed.body : sectionText;
  const lines = linesOf(body).length;
  const bytes = Buffer.byteLength(body, "latin1");
  return `section written (${mode}, ${lines} lines, ${bytes} bytes)`;
}

if (import.meta.main) {
  const outcome = writeInstructionSection(process.argv.slice(2), nodeFileSystem);
  if (outcome.code === EXIT_CODES.written) console.log(outcome.message);
  else console.error(outcome.message);
  process.exit(outcome.code);
}
