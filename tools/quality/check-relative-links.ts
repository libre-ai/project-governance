/**
 * Relative links and anchors of the tracked Markdown, checked offline.
 *
 * WHAT IT CHECKS. Every link and image of every tracked Markdown file whose
 * target is a relative path, in three forms counted apart (`Forms:` line):
 * inline `[text](target)`; reference definitions `[label]: target`, each
 * checked once where it is written (the usages `[x][label]`, `[x][]` and
 * `[label]` point to it; a definition is checked even when unused, a usage
 * without a definition is plain text, and `[^n]:` is a footnote); and HTML
 * `<a href>` / `<img src>` written on one line. Targets resolve from the
 * directory of the SOURCE file — never from the repository root, because a
 * fallback on the root hides a wrong relative path behind a link that happens
 * to be right from somewhere else. A target ending in `/` must be a directory.
 * When the target is a Markdown file (or the source itself, for `#fragment`),
 * the fragment must match a heading slug (case-insensitive; duplicates
 * numbered `-1`, `-2`, skipping a slug already taken) or an explicit anchor of
 * the target: `id=` on any tag, `name=` on `<a>`, each preceded by a blank,
 * compared case-sensitively. Nothing is fetched.
 *
 * A TARGET MUST BE DELIVERED BY GIT: a tracked file, or a directory holding
 * one, and so must the end of a symlink chain. A file that exists only in the
 * working tree (ignored, build output, forgotten `git add`) is reported as
 * `not tracked`, because it is missing from every fresh clone and from the
 * rendered repository.
 *
 * WHAT IT DOES NOT CHECK, and says so on its output. External links (`http:`,
 * `https:`, `mailto:`, `//host`) are counted as `external`, not verified. Site
 * absolute paths (`/x`), other schemes and empty targets are counted as
 * `other`, not verified: a site-absolute link is relative to a site root this
 * gate does not know, and resolving it from the repository root would report
 * the wrong thing. Autolinks (always absolute) and HTML tags split over several
 * lines are not read. Fragments on a non-Markdown target (`code.ts#L10`) cannot
 * be checked and are accepted. These are measured limits, not oversights.
 *
 * WHAT IS NEVER A LINK. Code: fenced blocks (a closing fence has the same
 * character as the opening one and is at least as long, so a three-backtick
 * line inside a four-backtick fence stays inside; a fence inside a blockquote
 * ends with the quote), indented blocks (four columns past the enclosing list
 * item's content, after a blank line), inline code spans (also over several
 * lines of one paragraph). Also HTML comments (also multi-line) and YAML front
 * matter. A leading `---` block counts as front matter only if every line
 * inside looks like YAML; otherwise it is prose.
 *
 * THE FILE LIST IS BUILT HERE, from `git ls-files`: a glob handed to a checker
 * that exits 0 on an empty match would turn a moved directory into a green.
 * Zero files examined is a failure (exit 3). A green with zero verified
 * relative link prints `EMPTY GREEN` instead of a bare `OK`, so a claim of
 * coverage has to read the `ok=` counter first.
 *
 * Counters sum, and a mismatch is itself a failure (exit 7):
 *   tracked = examined + excluded + non-regular
 *   total   = ok + errors + external + other
 *   total   = inline + reference + html
 *
 * Usage: bun tools/quality/check-relative-links.ts [check] <repository>
 *          [--exclude <prefix>=<reason>]... [--fallback-ext md,mdx]
 *
 * An exclusion is a path prefix (whole segments) with a mandatory reason; a
 * prefix that matches no tracked Markdown file is a named warning. The fallback
 * extensions complete extensionless site routes (`guide` -> `guide.md`); a name
 * that already contains a dot is not completed. The more permissive resolution
 * is printed in the volume line.
 *
 * Exit codes: 0 pass, 2 usage, 3 zero files examined, 5 broken link, 6 broken
 * anchor, 7 counters do not sum, 8 git or file read failure, 9 invalid
 * fallback extension value.
 */

import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { runGit } from "./git-diff";

export const EXIT = {
  ok: 0,
  usage: 2,
  noFiles: 3,
  brokenLink: 5,
  brokenAnchor: 6,
  counters: 7,
  git: 8,
  extensions: 9,
} as const;

export type LinkForm = "inline" | "reference" | "html";

export interface Link {
  readonly line: number;
  readonly dest: string;
  readonly form: LinkForm;
}

export interface GateResult {
  readonly exitCode: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
}

interface Exclusion {
  readonly prefix: string;
  readonly reason: string;
}

type Parsed =
  | {
      readonly ok: true;
      readonly repository: string;
      readonly exclusions: readonly Exclusion[];
      readonly fallbackExtensions: readonly string[];
    }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

type Extensions =
  | { readonly ok: true; readonly extensions: readonly string[] }
  | { readonly ok: false };

/** `md,mdx`: non-empty items of letters and digits. No dot, no separator other than the comma. */
export function parseFallbackExtensions(value: string): Extensions {
  const items = value.split(",");
  if (items.some((item) => !/^[A-Za-z0-9]+$/.test(item))) return { ok: false };
  return { ok: true, extensions: items };
}

/** A prefix is a relative path of whole segments, inside the repository. */
function normalisePrefix(raw: string): string | null {
  const trimmed = raw.replace(/^(?:\.\/)+/, "").replace(/\/+$/, "");
  if (trimmed === "" || trimmed.includes("\\") || trimmed.includes("\0")) return null;
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    return null;
  return trimmed;
}

function usageError(message: string): Parsed {
  return { ok: false, exitCode: EXIT.usage, message };
}

function parseArguments(argv: readonly string[]): Parsed {
  let repository: string | null = null;
  const exclusions: Exclusion[] = [];
  let fallback: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    const optionValue = (name: string): string | null => {
      if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
      index += 1;
      return argv[index] ?? null;
    };
    if (argument === "--exclude" || argument.startsWith("--exclude=")) {
      const value = optionValue("--exclude");
      const equals = value === null ? -1 : value.indexOf("=");
      if (value === null || equals === -1) return usageError("--exclude needs <prefix>=<reason>");
      const prefix = normalisePrefix(value.slice(0, equals));
      const reason = value.slice(equals + 1).trim();
      if (prefix === null)
        return usageError(`--exclude: not a relative path prefix: ${value.slice(0, equals)}`);
      if (reason === "") return usageError(`--exclude ${prefix}: the reason is mandatory`);
      exclusions.push({ prefix, reason });
    } else if (argument === "--fallback-ext" || argument.startsWith("--fallback-ext=")) {
      if (fallback !== null) return usageError("--fallback-ext given twice");
      fallback = optionValue("--fallback-ext");
      if (fallback === null) return usageError("--fallback-ext needs a value");
    } else if (argument.startsWith("-")) {
      return usageError(`unknown option: ${argument}`);
    } else if (index === 0 && argument === "check") {
      // The subcommand word of the brief (`check <repository>`), nothing to record;
      // a repository literally named `check` is written `./check`.
      repository = null;
    } else if (repository === null) {
      repository = argument;
    } else {
      return usageError(`unexpected argument: ${argument}`);
    }
  }

  // The extension value is judged before any file or process is touched.
  let fallbackExtensions: readonly string[] = [];
  if (fallback !== null) {
    const parsed = parseFallbackExtensions(fallback);
    if (!parsed.ok) {
      return {
        ok: false,
        exitCode: EXIT.extensions,
        message: `--fallback-ext: expected comma-separated extensions of letters and digits, got "${fallback}"`,
      };
    }
    fallbackExtensions = parsed.extensions;
  }
  if (repository === null)
    return usageError(
      "usage: check-relative-links [check] <repository> [--exclude <prefix>=<reason>]... [--fallback-ext md,mdx]",
    );
  return { ok: true, repository, exclusions, fallbackExtensions };
}

// ------------------------------------------------------------ reading Markdown

interface ProseLine {
  readonly line: number;
  readonly raw: string;
  /** The line with its inline code spans blanked, so a link-looking span is not a link. */
  readonly masked: string;
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
/** Blockquote markers at the start of a line: `>`, each with one optional space. */
const QUOTE_PREFIX = /^ {0,3}>(?: ?)/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/;

/**
 * Blank the content of inline code spans: a run of n backticks closes at the
 * next run of exactly n. Line breaks are kept, so a span may cover several
 * lines of one paragraph and the text still splits back into its lines.
 */
function maskCodeSpans(text: string): string {
  const runs = [...text.matchAll(/`+/g)];
  let masked = text;
  for (let index = 0; index < runs.length; index += 1) {
    const open = runs[index] as RegExpMatchArray;
    const close = runs.slice(index + 1).find((run) => run[0].length === open[0].length);
    if (close === undefined) continue;
    const from = open.index as number;
    const to = (close.index as number) + close[0].length;
    masked =
      masked.slice(0, from) + masked.slice(from, to).replace(/[^\n]/g, " ") + masked.slice(to);
    index = runs.indexOf(close);
  }
  return masked;
}

/** Strip the blockquote markers of a line; returns the depth and the content after them. */
function unquote(line: string): { readonly depth: number; readonly content: string } {
  let depth = 0;
  let content = line;
  for (let match = QUOTE_PREFIX.exec(content); match !== null; match = QUOTE_PREFIX.exec(content)) {
    depth += 1;
    content = content.slice(match[0].length);
  }
  return { depth, content };
}

/** Leading indentation in columns, a tab advancing to the next multiple of four. */
function indentOf(content: string): number {
  let column = 0;
  for (const char of content) {
    if (char === " ") column += 1;
    else if (char === "\t") column += 4 - (column % 4);
    else break;
  }
  return column;
}

/** One line of a YAML mapping or sequence, a comment, a blank, or a continuation. */
const YAML_LINE = /^(?:\s*|\s*#.*|\s+\S.*|\s*-(?:\s.*)?|[^\s[\](){}<>`"'#][^:]*:(?:\s.*)?)$/;

/** Blank the HTML comments of a line (searched outside code spans), keeping its length. */
function blankComments(
  raw: string,
  masked: string,
  inComment: boolean,
): { readonly raw: string; readonly masked: string; readonly inComment: boolean } {
  let outRaw = raw;
  let outMasked = masked;
  let open = inComment;
  let position = 0;
  const blank = (text: string, from: number, to: number): string =>
    text.slice(0, from) + " ".repeat(to - from) + text.slice(to);
  while (position < masked.length) {
    if (open) {
      const close = masked.indexOf("-->", position);
      const to = close === -1 ? masked.length : close + 3;
      outRaw = blank(outRaw, position, to);
      outMasked = blank(outMasked, position, to);
      position = to;
      if (close !== -1) open = false;
    } else {
      const from = masked.indexOf("<!--", position);
      if (from === -1) break;
      // The close is searched after the opener, so `<!-->` does not close itself.
      const close = masked.indexOf("-->", from + 4);
      const to = close === -1 ? masked.length : close + 3;
      outRaw = blank(outRaw, from, to);
      outMasked = blank(outMasked, from, to);
      position = to;
      open = close === -1;
    }
  }
  return { raw: outRaw, masked: outMasked, inComment: open };
}

interface KeptLine {
  readonly line: number;
  readonly raw: string;
  /** Lines of one paragraph share a group: a code span may run across them, never beyond. */
  readonly group: number;
}

/**
 * The lines outside code, front matter and HTML comments, numbered from 1.
 *
 * Code is: a fenced block (also inside a blockquote, where the end of the
 * quote ends the fence), an indented block (four columns past the content of
 * the enclosing list item, after a blank line; a list continuation or a lazy
 * paragraph line is prose), and inline code spans, which may run over the
 * lines of one paragraph. An unclosed fence or comment runs to the end. A
 * leading `---` block is front matter only when every line inside looks like
 * YAML.
 */
function proseLines(text: string): ProseLine[] {
  const lines = text.split(/\r?\n/);
  let start = 0;
  if (lines[0]?.trimEnd() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
    if (end !== -1 && lines.slice(1, end).every((line) => YAML_LINE.test(line))) start = end + 1;
  }

  const kept: KeptLine[] = [];
  let group = 0;
  let fence: { readonly char: string; readonly length: number; readonly depth: number } | null =
    null;
  let previousBlank = true;
  let inIndentedCode = false;
  let lastDepth = 0;
  /** Content columns of the open list items, innermost last. */
  const lists: number[] = [];
  // Comment state on a per-line view, only to keep a commented line out of code detection;
  // the blanking itself is redone below on the paragraph view.
  let inCommentEstimate = false;
  for (let index = start; index < lines.length; index += 1) {
    const raw = lines[index] as string;
    const { depth, content } = unquote(raw);
    if (fence !== null) {
      if (depth >= fence.depth) {
        const close = FENCE_CLOSE.exec(content)?.[1];
        if (close !== undefined && close[0] === fence.char && close.length >= fence.length)
          fence = null;
        continue;
      }
      // The blockquote holding the fence has ended, and the fence with it.
      fence = null;
    }
    if (depth !== lastDepth) group += 1;
    lastDepth = depth;

    if (content.trim() === "") {
      previousBlank = true;
      inIndentedCode = false;
      group += 1;
      kept.push({ line: index + 1, raw, group });
      continue;
    }

    const indent = indentOf(content);
    const item = LIST_ITEM.exec(content);
    if (previousBlank || item !== null) {
      while (lists.length > 0 && (lists[lists.length - 1] as number) > indent) lists.pop();
    }
    const base = lists[lists.length - 1] ?? 0;
    if (!inCommentEstimate && (previousBlank || inIndentedCode) && indent >= base + 4) {
      inIndentedCode = true;
      previousBlank = false;
      group += 1;
      continue;
    }
    previousBlank = false;
    inIndentedCode = false;

    const open = FENCE_OPEN.exec(content);
    const marker = open?.[1];
    // A backtick fence's info string may not contain a backtick: otherwise it is a code span.
    if (marker !== undefined && !(marker[0] === "`" && (open?.[2] ?? "").includes("`"))) {
      fence = { char: marker[0] as string, length: marker.length, depth };
      group += 1;
      continue;
    }

    if (item !== null) {
      const gap = (item[3] as string).length;
      lists.push(indent + (item[2] as string).length + (gap === 0 || gap > 4 ? 1 : gap));
    }
    inCommentEstimate = blankComments(raw, maskCodeSpans(raw), inCommentEstimate).inComment;
    // A heading or a table row is a block of its own line; a list item opens a new paragraph.
    const ownLine = /^ {0,3}#{1,6}(?:\s|$)/.test(content) || /^\s*\|/.test(content);
    if (ownLine || item !== null) group += 1;
    kept.push({ line: index + 1, raw, group });
    if (ownLine) group += 1;
  }

  const masked = new Map<number, string>();
  for (let from = 0; from < kept.length; ) {
    let to = from;
    while (to < kept.length && (kept[to] as KeptLine).group === (kept[from] as KeptLine).group)
      to += 1;
    const block = kept.slice(from, to);
    const parts = maskCodeSpans(block.map((entry) => entry.raw).join("\n")).split("\n");
    for (const [offset, entry] of block.entries())
      masked.set(entry.line, parts[offset] ?? entry.raw);
    from = to;
  }

  const prose: ProseLine[] = [];
  let inComment = false;
  for (const entry of kept) {
    const visible = blankComments(entry.raw, masked.get(entry.line) ?? entry.raw, inComment);
    inComment = visible.inComment;
    prose.push({ line: entry.line, raw: visible.raw, masked: visible.masked });
  }
  return prose;
}

/** The destination starting at `from` (just after `](`), and the index of the closing parenthesis. */
function readDestination(
  text: string,
  from: number,
): { readonly dest: string; readonly end: number } | null {
  let position = from;
  while (text[position] === " " || text[position] === "\t") position += 1;
  let dest: string;
  if (text[position] === "<") {
    const close = text.indexOf(">", position + 1);
    if (close === -1) return null;
    dest = text.slice(position + 1, close);
    position = close + 1;
  } else {
    const begin = position;
    let depth = 0;
    while (position < text.length) {
      const char = text[position] as string;
      if (char === "\\") {
        position += 2;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") {
        if (depth === 0) break;
        depth -= 1;
      } else if (/\s/.test(char)) break;
      position += 1;
    }
    dest = text.slice(begin, position);
  }
  while (text[position] === " " || text[position] === "\t") position += 1;
  const quote = text[position];
  if (quote === '"' || quote === "'" || quote === "(") {
    const close = text.indexOf(quote === "(" ? ")" : quote, position + 1);
    if (close === -1) return null;
    position = close + 1;
    while (text[position] === " " || text[position] === "\t") position += 1;
  }
  return text[position] === ")" ? { dest, end: position } : null;
}

/**
 * A link reference definition, `[label]: <dest> "title"`, also inside a
 * blockquote. A label starting with `^` is a footnote, not a link.
 */
const REFERENCE_DEFINITION = /^(?: {0,3}>\s?)*\s*\[(?!\^)(?:[^\]\\]|\\.)+\]:[ \t]*(<[^>\n]*>|\S+)/;
/** `href` on an `<a>` tag and `src` on an `<img>` tag, the attribute preceded by a blank. */
const HTML_LINK = /<(?:a(?=\s)[^>]*?\shref|img(?=\s)[^>]*?\ssrc)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Every link and image destination outside code, each with its line and form,
 * in reading order: inline `[x](dest)`, reference definitions `[y]: dest`
 * (each definition once, where it is written: the usages `[x][y]`, `[x][]`
 * and `[y]` point to it), and HTML `<a href>` / `<img src>` on one line.
 */
export function extractLinks(text: string): Link[] {
  const links: (Link & { readonly column: number })[] = [];
  for (const { line, masked } of proseLines(text)) {
    for (let index = 0; index < masked.length - 1; index += 1) {
      if (masked[index] !== "]" || masked[index + 1] !== "(" || masked[index - 1] === "\\")
        continue;
      const parsed = readDestination(masked, index + 2);
      if (parsed === null) continue;
      links.push({ line, dest: parsed.dest, form: "inline", column: index });
      index = parsed.end;
    }
    const definition = REFERENCE_DEFINITION.exec(masked);
    const target = definition?.[1];
    if (target !== undefined) {
      const dest = target.startsWith("<") ? target.slice(1, -1) : target;
      links.push({ line, dest, form: "reference", column: masked.indexOf(target) });
    }
    for (const match of masked.matchAll(HTML_LINK)) {
      const dest = match[1] ?? match[2] ?? "";
      links.push({ line, dest, form: "html", column: match.index as number });
    }
  }
  return links
    .sort((a, b) => a.line - b.line || a.column - b.column)
    .map(({ line, dest, form }) => ({ line, dest, form }));
}

function slugOf(heading: string): string {
  return (
    heading
      .replace(/\s+#+\s*$/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]*>/g, "")
      .replace(/[`*~]/g, "")
      // `_word_` and `__word__` are emphasis; an unpaired or intra-word underscore stays.
      .replace(/(^|[\s(])(_+)([^\s_](?:[^_]*[^\s_])?)\2(?=$|[\s).,!?:;])/g, "$1$3")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_ -]/gu, "")
      .replace(/ /g, "-")
  );
}

export interface Anchors {
  /** Heading slugs, lower case: a fragment is compared to them case-insensitively. */
  readonly slugs: ReadonlySet<string>;
  /** Explicit HTML anchors, as written: an `id` is case-sensitive. */
  readonly ids: ReadonlySet<string>;
}

/** `id=` on any tag and `name=` on `<a>` only, the attribute preceded by a blank. */
const HTML_ANCHOR =
  /<(?:[a-zA-Z][a-zA-Z0-9-]*(?=\s)[^>]*?\sid|a(?=\s)[^>]*?\sname)=["']([^"']+)["']/g;

/**
 * Heading slugs (ATX and setext) and explicit `id`/`name` anchors. A duplicate
 * slug is numbered `-1`, `-2`, skipping any slug already taken, so `a`, `a-1`,
 * `a` gives `a`, `a-1`, `a-2`.
 */
export function headingAnchors(text: string): Anchors {
  const slugs = new Set<string>();
  const ids = new Set<string>();
  const occurrences = new Map<string, number>();
  const add = (heading: string): void => {
    const original = slugOf(heading);
    let slug = original;
    while (slugs.has(slug)) {
      const count = (occurrences.get(original) ?? 0) + 1;
      occurrences.set(original, count);
      slug = `${original}-${count}`;
    }
    slugs.add(slug);
  };
  const prose = proseLines(text);
  for (const [index, { line, raw, masked }] of prose.entries()) {
    const atx = /^ {0,3}#{1,6}(?:\s+(.*))?$/.exec(raw);
    if (atx !== null) add(atx[1] ?? "");
    const next = prose[index + 1];
    const isParagraph = raw.trim() !== "" && !/^\s*(?:#|>|[-*+]\s|\d+[.)]\s)/.test(raw);
    if (
      next !== undefined &&
      next.line === line + 1 &&
      isParagraph &&
      /^ {0,3}(?:=+|-{2,})\s*$/.test(next.raw)
    ) {
      add(raw);
    }
    for (const match of masked.matchAll(HTML_ANCHOR)) ids.add(match[1] as string);
  }
  return { slugs, ids };
}

// ------------------------------------------------------------------- the check

type Kind = "external" | "other" | "relative";

function classify(dest: string): Kind {
  if (/^(?:https?:|mailto:)/i.test(dest) || dest.startsWith("//")) return "external";
  if (dest === "" || dest.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(dest)) return "other";
  return "relative";
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

const isMarkdownPath = (path: string): boolean => /\.(?:md|markdown)$/i.test(path);

interface Problem {
  readonly kind: "broken" | "anchor";
  readonly reason: string;
}

interface Context {
  readonly root: string;
  readonly realRoot: string;
  readonly fallbackExtensions: readonly string[];
  readonly anchorCache: Map<string, Anchors>;
  /** Tracked paths and every directory above them, `/`-separated, the root as `""`. */
  readonly tracked: ReadonlySet<string>;
}

/** Every tracked path and each of its parent directories (the root is `""`). */
function trackedSet(entries: readonly { readonly path: string }[]): Set<string> {
  const set = new Set<string>([""]);
  for (const { path } of entries) {
    set.add(path);
    for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1))
      set.add(path.slice(0, slash));
  }
  return set;
}

export interface Counters {
  readonly tracked: number;
  readonly examined: number;
  readonly excluded: number;
  readonly nonRegular: number;
  readonly extracted: number;
  readonly ok: number;
  readonly broken: number;
  readonly anchors: number;
  readonly external: number;
  readonly other: number;
  readonly inline: number;
  readonly reference: number;
  readonly html: number;
}

/** The three sums of the header; each side is counted by a different step of `run`. */
export function countersSum(c: Counters): boolean {
  return (
    c.tracked === c.examined + c.excluded + c.nonRegular &&
    c.extracted === c.ok + c.broken + c.anchors + c.external + c.other &&
    c.extracted === c.inline + c.reference + c.html
  );
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * The candidate that exists AND is delivered by git: a tracked file, or a
 * directory holding one. A target present only in the working tree (ignored,
 * never added) is `untracked`, because it is missing from every fresh clone.
 */
function existingTarget(
  context: Context,
  target: string,
): { readonly found: string | null; readonly untracked: boolean } {
  const base = target.slice(target.lastIndexOf("/") + 1);
  const candidates = [
    target,
    ...(base.includes(".")
      ? []
      : context.fallbackExtensions.map((extension) => `${target}.${extension}`)),
  ];
  let untracked = false;
  for (const candidate of candidates) {
    try {
      statSync(candidate);
    } catch {
      continue;
    }
    if (context.tracked.has(relative(context.root, candidate).split(sep).join("/")))
      return { found: candidate, untracked: false };
    untracked = true;
  }
  return { found: null, untracked };
}

function checkRelative(context: Context, source: string, dest: string): Problem | null {
  const hash = dest.indexOf("#");
  const beforeFragment = hash === -1 ? dest : dest.slice(0, hash);
  const rawFragment = hash === -1 ? "" : dest.slice(hash + 1);
  const query = beforeFragment.indexOf("?");
  const rawPath = query === -1 ? beforeFragment : beforeFragment.slice(0, query);
  const path = decode(rawPath);
  if (path === null) return { kind: "broken", reason: "invalid percent-encoding" };

  const sourcePath = resolve(context.root, source);
  const target = path === "" ? sourcePath : resolve(dirname(sourcePath), path);
  if (!isInside(context.root, target))
    return { kind: "broken", reason: "link points outside the repository" };
  const { found, untracked } = existingTarget(context, target);
  if (found === null)
    return {
      kind: "broken",
      reason: untracked ? "link target not tracked" : "link target not found",
    };
  let real: string;
  try {
    real = realpathSync(found);
  } catch {
    return { kind: "broken", reason: "link target not found" };
  }
  if (!isInside(context.realRoot, real))
    return { kind: "broken", reason: "link resolves outside the repository" };
  // A tracked symlink delivers only its own text: what it points to must be delivered too.
  if (!context.tracked.has(relative(context.realRoot, real).split(sep).join("/")))
    return { kind: "broken", reason: "link target not tracked" };
  const isFile = statSync(real).isFile();
  // `b.md/` names a directory; a renderer serves nothing at that path for a file.
  if (path.endsWith("/") && isFile)
    return { kind: "broken", reason: "link target is not a directory" };

  if (rawFragment === "" || !isMarkdownPath(real) || !isFile) return null;
  const fragment = decode(rawFragment);
  if (fragment === null) return { kind: "anchor", reason: "invalid percent-encoding in anchor" };
  let anchors = context.anchorCache.get(real);
  if (anchors === undefined) {
    anchors = headingAnchors(readFileSync(real, "utf8"));
    context.anchorCache.set(real, anchors);
  }
  return anchors.ids.has(fragment) || anchors.slugs.has(fragment.toLowerCase())
    ? null
    : { kind: "anchor", reason: "anchor not found" };
}

interface TrackedEntry {
  readonly mode: string;
  readonly path: string;
}

/** `git ls-files -z --stage` records: `<mode> <sha> <stage>\t<path>`. */
function parseStage(output: string): TrackedEntry[] | null {
  const entries = new Map<string, TrackedEntry>();
  for (const record of output.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const mode = /^(\d{6}) /.exec(record)?.[1];
    if (tab === -1 || mode === undefined) return null;
    const path = record.slice(tab + 1);
    if (!entries.has(path)) entries.set(path, { mode, path });
  }
  return [...entries.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const inPrefix = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

export function run(argv: readonly string[]): GateResult {
  const parsed = parseArguments(argv);
  if (!parsed.ok) return { exitCode: parsed.exitCode, out: [], err: [parsed.message] };

  const root = resolve(parsed.repository);
  let realRoot: string;
  try {
    if (!statSync(root).isDirectory())
      return { exitCode: EXIT.usage, out: [], err: [`not a directory: ${parsed.repository}`] };
    realRoot = realpathSync(root);
  } catch {
    return {
      exitCode: EXIT.usage,
      out: [],
      err: [`unreadable repository path: ${parsed.repository}`],
    };
  }

  const listing = runGit(["-C", root, "ls-files", "-z", "--stage"]);
  if (listing.exitCode !== 0) {
    return { exitCode: EXIT.git, out: [], err: [`git ls-files failed: ${listing.stderr.trim()}`] };
  }
  const entries = parseStage(listing.stdout);
  if (entries === null)
    return {
      exitCode: EXIT.git,
      out: [],
      err: ["git ls-files printed a record this gate cannot read"],
    };

  const markdown = entries.filter((entry) => isMarkdownPath(entry.path));
  const err: string[] = [];
  const excludedFor = (path: string): Exclusion | undefined =>
    parsed.exclusions.find((exclusion) => inPrefix(path, exclusion.prefix));
  for (const exclusion of parsed.exclusions) {
    if (!markdown.some((entry) => inPrefix(entry.path, exclusion.prefix))) {
      err.push(
        `warning: exclusion prefix ${exclusion.prefix} matches no tracked Markdown file (${exclusion.reason})`,
      );
    }
  }

  const candidates = markdown.filter((entry) => excludedFor(entry.path) === undefined);
  const excluded = markdown.filter((entry) => excludedFor(entry.path) !== undefined).length;
  const regular = candidates.filter((entry) => entry.mode === "100644" || entry.mode === "100755");
  const nonRegular = candidates.length - regular.length;

  const context: Context = {
    root,
    realRoot,
    fallbackExtensions: parsed.fallbackExtensions,
    anchorCache: new Map(),
    tracked: trackedSet(entries),
  };
  let extracted = 0;
  const counts = { total: 0, ok: 0, broken: 0, anchors: 0, external: 0, other: 0 };
  const forms: Record<LinkForm, number> = { inline: 0, reference: 0, html: 0 };
  const failures: string[] = [];
  let examined = 0;

  for (const entry of regular) {
    let text: string;
    try {
      if (!lstatSync(resolve(root, entry.path)).isFile())
        throw new Error("not a regular file in the working tree");
      text = readFileSync(resolve(root, entry.path), "utf8");
    } catch (error) {
      failures.push(
        `${entry.path}: tracked file unreadable: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      continue;
    }
    examined += 1;
    const links = extractLinks(text);
    extracted += links.length;
    for (const { line, dest, form } of links) {
      counts.total += 1;
      forms[form] += 1;
      const kind = classify(dest);
      if (kind === "external") counts.external += 1;
      else if (kind === "other") counts.other += 1;
      else {
        const problem = checkRelative(context, entry.path, dest);
        if (problem === null) counts.ok += 1;
        else {
          if (problem.kind === "broken") counts.broken += 1;
          else counts.anchors += 1;
          err.push(`${entry.path}:${line}: ${problem.reason}: ${dest}`);
        }
      }
    }
  }

  const prefixes = parsed.exclusions.length;
  const out = [
    `Files: tracked=${markdown.length} examined=${examined} excluded=${excluded} non-regular=${nonRegular} prefixes=${prefixes} fallback-ext=${parsed.fallbackExtensions.length === 0 ? "none" : parsed.fallbackExtensions.join(",")}`,
    `Links: total=${counts.total} ok=${counts.ok} errors=${counts.broken + counts.anchors} (broken=${counts.broken} anchors=${counts.anchors}) external=${counts.external} (not verified) other=${counts.other} (not verified) scope=offline relative links and anchors`,
    `Forms: inline=${forms.inline} reference=${forms.reference} html=${forms.html}`,
  ];
  for (const exclusion of parsed.exclusions)
    out.push(`Excluded: ${exclusion.prefix}: ${exclusion.reason}`);

  if (failures.length > 0) return { exitCode: EXIT.git, out, err: [...err, ...failures] };
  const sums = countersSum({
    tracked: markdown.length,
    examined,
    excluded,
    nonRegular,
    extracted,
    ok: counts.ok,
    broken: counts.broken,
    anchors: counts.anchors,
    external: counts.external,
    other: counts.other,
    inline: forms.inline,
    reference: forms.reference,
    html: forms.html,
  });
  if (!sums) return { exitCode: EXIT.counters, out, err: [...err, "counters do not sum"] };
  if (examined === 0)
    return { exitCode: EXIT.noFiles, out, err: [...err, "no Markdown file left to examine"] };
  if (counts.broken > 0) return { exitCode: EXIT.brokenLink, out, err };
  if (counts.anchors > 0) return { exitCode: EXIT.brokenAnchor, out, err };
  out.push(
    counts.ok === 0
      ? "OK (EMPTY GREEN: no relative link was verified, this run covers nothing)"
      : "OK",
  );
  return { exitCode: EXIT.ok, out, err };
}

if (import.meta.main) {
  const result = run(process.argv.slice(2));
  for (const line of result.out) console.log(line);
  for (const line of result.err) console.error(line);
  process.exit(result.exitCode);
}
