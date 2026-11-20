/**
 * Targeted line editor with explicit refusals: applies a list of line edits to a
 * tree, and either applies every one of them or writes nothing at all.
 *
 *   bun tools/fleet/line-edits.ts <root> <edits.tsv>
 *
 * The edit list is UTF-8, one edit per line, exactly four tab-separated fields
 * (empty lines are ignored):
 *
 *   <path>\t<line>\t<action>\t<argument>
 *
 *   path      relative to <root>; not empty, not absolute, no `..` segment
 *   line      1-based decimal number, ALWAYS a line of the original file: a
 *             deletion or an insertion never shifts another edit
 *   action    mark     append a space and the argument as a comment (table below)
 *             replace  argument `old=>new`: replace the first literal `old`
 *             delete   drop the line, only if it equals the argument once both
 *                      are trimmed
 *             insert   insert the argument before the line; a literal `\n`
 *                      separates several lines, each prefixed with the leading
 *                      indentation of the target line
 *
 * Comment written by `mark`, by file extension (M is the argument):
 *
 *   .md outside a code fence                  ` <!-- M -->`
 *   .md inside a ``` or ~~~ code fence        ` # M`
 *   .yml .yaml .sh .bash .toml .py            ` # M`
 *   .rs .js .ts                               ` // M`
 *   anything else, or no extension            refused
 *
 * The extension is the one of the real file: through a link `l.sh -> f.md`, the
 * file is Markdown. A marker holding `-->` or `--!>` is refused where it would
 * be written in an HTML comment.
 *
 * The whole list is validated against the original content before the first
 * write. An edit that cannot be applied is a refusal printed on stderr as
 * `<path>:<line>: <reason>`, never an omission: one refusal and no file is
 * written. Otherwise each changed file is rewritten atomically (temporary file
 * in the same directory, then rename, mode kept). The presence or absence of a
 * final newline is kept as found.
 *
 * Writing is in two phases: every temporary file is prepared first, and a
 * failure there removes them all and replaces no file. Limit: the renames that
 * follow are not transactional across files. If one fails after others
 * succeeded, the tool removes the remaining temporaries, names on stderr the
 * files rewritten and the files left unchanged, and reports `PARTIAL WRITE` on
 * stdout: that tree is half edited, and only this case leaves it so.
 *
 * Exit status: 0 when every edit was applied; 1 when at least one edit was
 * refused or a temporary file could not be prepared (nothing written), or when
 * a rename failed (partial write, named as above); 2 on a usage error or a
 * malformed edit list, an empty one included (nothing written).
 */

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";

import type { Parsed } from "../quality/prd-model";

const ACTIONS = ["mark", "replace", "delete", "insert"] as const;
type EditAction = (typeof ACTIONS)[number];

export interface LineEdit {
  readonly path: string;
  /** 1-based, in the original file. */
  readonly line: number;
  readonly action: EditAction;
  readonly argument: string;
}

interface Refusal {
  readonly path: string;
  readonly line: number;
  readonly reason: string;
}

type FilePlan =
  | { readonly ok: true; readonly content: string; readonly applied: number }
  | { readonly ok: false; readonly refusals: readonly Refusal[] };

// --- edit list ----------------------------------------------------------------

const LINE_NUMBER = /^[1-9][0-9]*$/;

const isAction = (value: string): value is EditAction =>
  (ACTIONS as readonly string[]).includes(value);

/**
 * Reads the edit list. Any defect refuses the whole list and names its TSV line:
 * a list read as fewer edits than it declares would apply the rest as if the
 * dropped ones had never been asked for. For the same reason a list without any
 * edit is a defect, not a success over nothing.
 */
export function parseEditList(text: string): Parsed<readonly LineEdit[]> {
  const malformed = (line: number, reason: string): Parsed<readonly LineEdit[]> => ({
    ok: false,
    reason: `line ${line}: ${reason}`,
  });
  // A CRLF list would otherwise carry its CR into every argument, then into the files.
  if (text.includes("\r")) {
    const line = text.slice(0, text.indexOf("\r")).split("\n").length;
    return malformed(line, "the edit list contains a carriage return (CR)");
  }
  const edits: LineEdit[] = [];
  for (const [index, row] of text.split("\n").entries()) {
    if (row === "") continue;
    const fields = row.split("\t");
    const [path, line, action, argument] = fields;
    if (
      fields.length !== 4 ||
      path === undefined ||
      line === undefined ||
      action === undefined ||
      argument === undefined
    ) {
      return malformed(index + 1, `expected 4 tab-separated fields, found ${fields.length}`);
    }
    if (path === "") return malformed(index + 1, "the path is empty");
    if (path.startsWith("/")) return malformed(index + 1, `the path is absolute: ${path}`);
    if (path.split("/").includes("..")) {
      return malformed(index + 1, `the path has a ".." segment: ${path}`);
    }
    if (!LINE_NUMBER.test(line)) {
      return malformed(index + 1, `the line number is not a positive integer: ${line}`);
    }
    if (!isAction(action)) {
      return malformed(index + 1, `unknown action "${action}" (${ACTIONS.join(", ")})`);
    }
    edits.push({ path, line: Number(line), action, argument });
  }
  if (edits.length === 0) return { ok: false, reason: "the edit list holds no edit" };
  return { ok: true, value: edits };
}

// --- planning (pure) ----------------------------------------------------------

const HASH_EXTENSIONS: readonly string[] = [".yml", ".yaml", ".sh", ".bash", ".toml", ".py"];
const SLASH_EXTENSIONS: readonly string[] = [".rs", ".js", ".ts"];

/**
 * The text `mark` appends, leading space included; null when the extension has
 * no known comment form. `inFence` only matters for Markdown, where an HTML
 * comment inside a code fence would be displayed instead of hidden.
 */
export function commentFor(path: string, inFence: boolean, marker: string): string | null {
  const extension = extname(path);
  if (extension === ".md") return inFence ? ` # ${marker}` : ` <!-- ${marker} -->`;
  if (HASH_EXTENSIONS.includes(extension)) return ` # ${marker}`;
  if (SLASH_EXTENSIONS.includes(extension)) return ` // ${marker}`;
  return null;
}

/**
 * Both end an HTML comment (`--!>` with a parse error): a marker holding one
 * would leave its tail as visible text. Hash and slash comments end at the end
 * of the line, which a marker cannot hold.
 */
const HTML_COMMENT_CLOSERS: readonly string[] = ["-->", "--!>"];

type FenceState = "outside" | "inside" | "delimiter";

const FENCE = /^\s*(```|~~~)/;

/** A fence closes on the delimiter that opened it; the other one is fence content. */
function fenceStates(lines: readonly string[]): readonly FenceState[] {
  const states: FenceState[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const delimiter = FENCE.exec(line)?.[1];
    if (open === null && delimiter !== undefined) {
      open = delimiter;
      states.push("delimiter");
    } else if (open !== null && delimiter === open) {
      open = null;
      states.push("delimiter");
    } else {
      states.push(open === null ? "outside" : "inside");
    }
  }
  return states;
}

type LineChange =
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "set"; readonly text: string }
  | { readonly kind: "drop" }
  | { readonly kind: "insert"; readonly lines: readonly string[] };

const refused = (reason: string): LineChange => ({ kind: "refused", reason });

function changeFor(path: string, text: string, fence: FenceState, edit: LineEdit): LineChange {
  const { argument } = edit;
  switch (edit.action) {
    case "mark": {
      if (fence === "delimiter") return refused("mark on a code fence delimiter");
      if (text.trimEnd().endsWith("\\")) {
        return refused("mark on a line ending with a backslash (continuation)");
      }
      // Also refuses an empty marker: every line contains the empty string.
      if (text.includes(argument)) return refused("the line already carries the marker");
      if (
        extname(path) === ".md" &&
        fence !== "inside" &&
        HTML_COMMENT_CLOSERS.some((closer) => argument.includes(closer))
      ) {
        return refused("the marker would close the HTML comment (--> or --!>)");
      }
      const comment = commentFor(path, fence === "inside", argument);
      if (comment === null) return refused("mark has no comment form for this file extension");
      return { kind: "set", text: text + comment };
    }
    case "replace": {
      const arrow = argument.indexOf("=>");
      if (arrow === -1) return refused('replace needs an "old=>new" argument');
      const old = argument.slice(0, arrow);
      if (old === "") return refused("replace has an empty old part");
      const at = text.indexOf(old);
      if (at === -1) return refused(`replace: ${JSON.stringify(old)} is not on the line`);
      // Sliced, not String.replace: `$&` in the new part must stay literal.
      return {
        kind: "set",
        text: text.slice(0, at) + argument.slice(arrow + 2) + text.slice(at + old.length),
      };
    }
    case "delete":
      if (text.trim() !== argument.trim()) {
        return refused(`delete: the line is not ${JSON.stringify(argument.trim())}`);
      }
      return { kind: "drop" };
    case "insert": {
      const parts = argument.split("\\n");
      if (parts.every((part) => part === "")) return refused("insert has nothing to insert");
      const indentation = /^[ \t]*/.exec(text)?.[0] ?? "";
      return { kind: "insert", lines: parts.map((part) => indentation + part) };
    }
  }
}

/**
 * Plans every edit of ONE file against its original content. Each edit yields
 * either its change or exactly one refusal, so read = applied + refused holds.
 * Line numbers and the code-fence state are those of `original`, whatever the
 * other edits of the list do to the file.
 */
export function planFileEdits(
  path: string,
  original: string,
  edits: readonly LineEdit[],
): FilePlan {
  if (original.includes("\r")) {
    const reason = "the file contains a carriage return (CR)";
    return { ok: false, refusals: edits.map((edit) => ({ path, line: edit.line, reason })) };
  }
  const endsWithNewline = original.endsWith("\n");
  const lines: readonly string[] =
    original === "" ? [] : (endsWithNewline ? original.slice(0, -1) : original).split("\n");
  const fences: readonly FenceState[] | null = extname(path) === ".md" ? fenceStates(lines) : null;

  const editsOnLine = new Map<number, number>();
  for (const edit of edits) editsOnLine.set(edit.line, (editsOnLine.get(edit.line) ?? 0) + 1);

  const refusals: Refusal[] = [];
  const changes = new Map<number, LineChange>();
  for (const edit of edits) {
    const text = lines[edit.line - 1];
    let change: LineChange;
    if (text === undefined) {
      change = refused(`line is beyond the end of the file (${lines.length} line(s))`);
    } else if ((editsOnLine.get(edit.line) ?? 0) > 1) {
      change = refused("more than one edit targets this line");
    } else {
      change = changeFor(path, text, fences?.[edit.line - 1] ?? "outside", edit);
    }
    if (change.kind === "refused") refusals.push({ path, line: edit.line, reason: change.reason });
    else changes.set(edit.line, change);
  }
  if (refusals.length > 0) return { ok: false, refusals };

  const output: string[] = [];
  for (const [index, text] of lines.entries()) {
    const change = changes.get(index + 1);
    if (change === undefined || change.kind === "refused") output.push(text);
    else if (change.kind === "set") output.push(change.text);
    else if (change.kind === "insert") output.push(...change.lines, text);
  }
  const content = output.length === 0 ? "" : output.join("\n") + (endsWithNewline ? "\n" : "");
  return { ok: true, content, applied: edits.length };
}

// --- command ------------------------------------------------------------------

const USAGE = "usage: bun tools/fleet/line-edits.ts <root> <edits.tsv>";

/** Strict, and BOM-preserving: a decoded-then-written file must not lose its first bytes. */
const decodeStrict = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);

interface Target {
  /** The spelling of the first edit that named the file; used in every message. */
  readonly path: string;
  readonly real: string;
  readonly mode: number;
  readonly edits: LineEdit[];
}

type Located =
  | { readonly ok: true; readonly real: string; readonly mode: number }
  | { readonly ok: false; readonly reason: string };

function locate(rootReal: string, path: string): Located {
  let real: string;
  try {
    real = realpathSync(join(rootReal, path));
  } catch {
    return { ok: false, reason: "the file does not exist" };
  }
  if (!real.startsWith(rootReal.endsWith(sep) ? rootReal : rootReal + sep)) {
    return { ok: false, reason: "the path resolves outside the root" };
  }
  const status = statSync(real);
  if (!status.isFile()) return { ok: false, reason: "not a regular file" };
  return { ok: true, real, mode: status.mode & 0o7777 };
}

/** One planned rewrite: `path` is the spelling used in messages, `real` the file replaced. */
export interface PlannedWrite {
  readonly path: string;
  readonly real: string;
  readonly mode: number;
  readonly content: string;
}

/** The file-system calls of a write, injectable so a failing rename can be tested. */
export interface WriteOps {
  /** Creates `path` exclusively (EEXIST when it exists) and writes `content` to it. */
  readonly create: (path: string, content: string, mode: number) => void;
  readonly chmod: (path: string, mode: number) => void;
  readonly rename: (from: string, to: string) => void;
  readonly unlink: (path: string) => void;
}

const NODE_WRITE_OPS: WriteOps = {
  create: (path, content, mode) => writeFileSync(path, content, { flag: "wx", mode }),
  chmod: chmodSync,
  rename: renameSync,
  unlink: unlinkSync,
};

export type WriteOutcome =
  | { readonly ok: true; readonly written: number }
  /** A temporary file could not be prepared: no file was replaced. */
  | { readonly ok: false; readonly stage: "stage"; readonly path: string; readonly message: string }
  /** A rename failed: the files in `replaced` are rewritten, those in `kept` are not. */
  | {
      readonly ok: false;
      readonly stage: "rename";
      readonly path: string;
      readonly message: string;
      readonly replaced: readonly string[];
      readonly kept: readonly string[];
    };

/** Random, so the name of a file the tool did not create is never taken for its own. */
const temporaryFor = (real: string): string =>
  join(dirname(real), `.${basename(real)}.${randomBytes(8).toString("hex")}.line-edits.tmp`);

const errorCode = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "code" in error ? error.code : undefined;

const removeQuietly = (ops: WriteOps, path: string): void => {
  try {
    ops.unlink(path);
  } catch {
    // Already gone or never complete: there is nothing left to remove.
  }
};

/**
 * Rewrites every planned file in two phases, so a failure while preparing one
 * file leaves the whole tree as it was: every temporary file is written and
 * given its mode first, and only then is each one renamed over its file. A
 * failure in the first phase removes the temporary files already made and
 * renames nothing. A rename failing after another one succeeded cannot be
 * undone (renaming several files is not transactional): the outcome names the
 * files replaced and the files kept, and the remaining temporaries are removed.
 */
export function writeAll(
  writes: readonly PlannedWrite[],
  ops: WriteOps = NODE_WRITE_OPS,
): WriteOutcome {
  const staged: { readonly write: PlannedWrite; readonly temporary: string }[] = [];
  const abandon = (from: number): void => {
    for (const { temporary } of staged.slice(from)) removeQuietly(ops, temporary);
  };
  for (const write of writes) {
    const temporary = temporaryFor(write.real);
    try {
      ops.create(temporary, write.content, write.mode);
    } catch (error) {
      // EEXIST: the file belongs to someone else and stays. Otherwise a partial
      // file may have been created by this call, and it is ours to remove.
      if (errorCode(error) !== "EEXIST") removeQuietly(ops, temporary);
      abandon(0);
      return { ok: false, stage: "stage", path: write.path, message: (error as Error).message };
    }
    staged.push({ write, temporary });
    try {
      // The creation mode is filtered by the umask; the original mode is not.
      ops.chmod(temporary, write.mode);
    } catch (error) {
      abandon(0);
      return { ok: false, stage: "stage", path: write.path, message: (error as Error).message };
    }
  }
  for (const [index, { write, temporary }] of staged.entries()) {
    try {
      ops.rename(temporary, write.real);
    } catch (error) {
      abandon(index);
      return {
        ok: false,
        stage: "rename",
        path: write.path,
        message: (error as Error).message,
        replaced: staged.slice(0, index).map((entry) => entry.write.path),
        kept: staged.slice(index).map((entry) => entry.write.path),
      };
    }
  }
  return { ok: true, written: staged.length };
}

function main(argv: readonly string[]): number {
  const [root, listPath] = argv;
  if (argv.length !== 2 || root === undefined || listPath === undefined) {
    console.error(USAGE);
    return 2;
  }
  let rootReal: string;
  try {
    if (!statSync(root).isDirectory()) throw new Error("not a directory");
    rootReal = realpathSync(root);
  } catch {
    console.error(`the root is not an existing directory: ${root}`);
    console.error(USAGE);
    return 2;
  }
  let listText: string;
  try {
    listText = decodeStrict(readFileSync(listPath));
  } catch (error) {
    console.error(`cannot read the edit list ${listPath}: ${(error as Error).message}`);
    return 2;
  }
  const parsed = parseEditList(listText);
  if (!parsed.ok) {
    console.error(`${listPath}: ${parsed.reason}`);
    return 2;
  }
  const edits = parsed.value;

  // Grouped by real path: two spellings of one file must meet in the same plan,
  // or their edits would each be written over the other's.
  const refusals: Refusal[] = [];
  const targets = new Map<string, Target>();
  for (const edit of edits) {
    const located = locate(rootReal, edit.path);
    if (!located.ok) {
      refusals.push({ path: edit.path, line: edit.line, reason: located.reason });
      continue;
    }
    const known = targets.get(located.real);
    if (known === undefined) {
      targets.set(located.real, { path: edit.path, ...located, edits: [edit] });
    } else {
      known.edits.push(edit);
    }
  }

  const writes: PlannedWrite[] = [];
  for (const target of targets.values()) {
    const refuseAll = (reason: string): void => {
      for (const edit of target.edits) {
        refusals.push({ path: target.path, line: edit.line, reason });
      }
    };
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(target.real);
    } catch (error) {
      refuseAll(`cannot read the file: ${(error as Error).message}`);
      continue;
    }
    let original: string;
    try {
      original = decodeStrict(bytes);
    } catch {
      refuseAll("the file is not valid UTF-8");
      continue;
    }
    // Planned under the real file's name: through a link `l.sh -> f.md` the
    // content is Markdown, and so are its fences and its comment form. Messages
    // keep the spelling of the edit list.
    const plan = planFileEdits(relative(rootReal, target.real), original, target.edits);
    if (!plan.ok) {
      refusals.push(...plan.refusals.map((refusal) => ({ ...refusal, path: target.path })));
    } else if (plan.content !== original) {
      writes.push({
        path: target.path,
        real: target.real,
        mode: target.mode,
        content: plan.content,
      });
    }
  }

  if (refusals.length > 0) {
    for (const refusal of refusals) {
      console.error(`${refusal.path}:${refusal.line}: ${refusal.reason}`);
    }
    const concerned = new Set(refusals.map((refusal) => refusal.path)).size;
    console.log(
      `line-edits: ${edits.length} edit(s) read, 0 applied, ${refusals.length} refused ` +
        `in ${concerned} file(s), 0 file(s) written`,
    );
    return 1;
  }

  const outcome = writeAll(writes);
  if (outcome.ok) {
    console.log(
      `line-edits: ${edits.length} edit(s) read, ${edits.length} applied, ` +
        `${outcome.written} file(s) written`,
    );
    return 0;
  }
  if (outcome.stage === "stage") {
    console.error(`${outcome.path}: cannot write the file: ${outcome.message}`);
    console.log(
      `line-edits: ${edits.length} edit(s) read, 0 applied, write failed before any rename, ` +
        "0 file(s) written",
    );
    return 1;
  }
  console.error(`${outcome.path}: cannot replace the file: ${outcome.message}`);
  for (const path of outcome.replaced) console.error(`${path}: rewritten before the failure`);
  for (const path of outcome.kept) console.error(`${path}: left unchanged`);
  console.log(
    `line-edits: ${edits.length} edit(s) read, rename failed, PARTIAL WRITE: ` +
      `${outcome.replaced.length} of ${writes.length} file(s) written`,
  );
  return 1;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
