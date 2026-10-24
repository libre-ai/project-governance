import { concludeGate, GateReport } from "./gate-report";

/**
 * Door gate — every pull request declares whether the change it carries can
 * be walked back, and a one-way change names its second instrument; and it
 * declares the origin of the problem it treats (see "Origin" below).
 *
 * Why: reversibility was nowhere written down at PR time. A two-way door
 * (revert the squash and the world is as before) and a one-way door (a
 * repository deletion, a published release, a ruleset change, a migration
 * that drops data) went through the same template-less description, and the
 * only place the distinction lived was the author's head. gate-integrity §3
 * adds the second half: an irreversible act is never certified on the green
 * of a single instrument, so a one-way declaration must say which different
 * instrument measured it.
 *
 * The declaration block (owner decision, 2026-10-24, after three
 * separate-role reviews of #141). Declarations are the first lines of the
 * description, and only those lines are ever read:
 *
 *     <!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
 *     <!-- SPDX-License-Identifier: CC-BY-4.0 -->
 *     Door: two-way
 *     Origin: proposal
 *
 *     ...the rest of the description...
 *
 * - T1. After an initial BOM is removed and CRLF/CR are normalised, the body
 *   opens with zero or more header lines, each a single complete HTML comment
 *   filling the whole line (`<!--` at column 0, `-->` at its end, no other
 *   `-->`, `<!--` or `--!>` inside, not the short forms `<!-->` and
 *   `<!--->`). The declaration block comes right after them: consecutive
 *   lines, each `Key: value` at column 0 with a key of DECLARATION_KEYS. It
 *   ends at the first blank line, which is required, or at the end of the
 *   body. A non-blank line that is not a declaration, right after the block,
 *   fails the gate; a body that does not open this way has no block, and an
 *   absent key then names that reason. `Owner-arbitration:` and `Not-added:`
 *   belong to the block and are judged by other gates.
 *   Why this reads only what GitHub displays: a whole-line comment at
 *   column 0 is an HTML block that ends on its own line, so the next line
 *   opens a paragraph; nothing before that paragraph can still be open; and
 *   the blank line closes it.
 * - T2' (re-review 4: modelling the end of a link, its `'` or `( )` title,
 *   nested images, a backtick in a destination, failed). The syntax that can
 *   hide text is removed instead of modelled. Code spans first, as CommonMark
 *   on the line: a backtick run opens, and closes at the next run of the same
 *   length on the same line; an unclosed run refuses the line. Inside a code
 *   span everything is admitted. Outside, a value carries no `[` or `]` (no
 *   link or image, inline or by reference, even escaped), no `~`, and no `<`
 *   except a whole autolink `<https://host...>` or `<http://host...>`. No
 *   HTML. A refused line fails the gate, and no line after it in the block is
 *   read: the construct it opens may hide them (a `<details>` collapses them).
 * - T3. A key line at column 0 elsewhere in the body fails the gate by name,
 *   unless it sits in an HTML comment or a fence that opened at column 0, at
 *   the start of its line, right after a raw blank line (re-review 3, M1/M2:
 *   a `<!--` in a code span, or indented four spaces, opens no comment for
 *   GitHub, which then displays the key line). A comment closes on `-->` or
 *   `--!>`, as HTML5 closes it. After a line that opens a type-1 HTML block
 *   (`<pre`, `<script`, `<style`, `<textarea`), no line is exempt (re-review
 *   4). Nothing outside the block is ever read, so this rule can only refuse
 *   more or name fewer, never read.
 *
 * The values, then:
 *
 * - exactly one `Door:` line, whose value is `one-way` or `two-way`
 *   (lowercase, nothing else on the line). The unfilled template line
 *   `Door: one-way | two-way` is refused: choosing is the point;
 * - `Second-instrument:` is required when the door is one-way, with at least
 *   SECOND_INSTRUMENT_MIN_LENGTH characters that are not a placeholder
 *   (`n/a`, `none`, `tbd`, `-`). On a two-way door it is optional.
 *
 * This is a declaration gate, like check-review-evidence's
 * `Owner-arbitration:` marker: it makes forgetting the declaration
 * impossible to merge silently. It cannot prove the declaration true — a
 * one-way change typed `two-way` passes. The reviewer reads the claim; the
 * gate guarantees there is one to read.
 *
 * Implicit two-way authors (2026-10-14): a pull request opened by an account
 * in IMPLICIT_TWO_WAY_AUTHORS and carrying no Door line is judged `two-way`,
 * and the verdict says so. `Door declaration` became a required check that
 * day, and Dependabot writes its own descriptions: without this, every
 * dependency bump would block until a human edited the bot's text. A version
 * bump is two-way by construction — reverting the squash restores the
 * previous manifest and lockfile. The author is read from
 * `pull_request.user.login`; logins ending in `[bot]` belong to GitHub Apps
 * and cannot be taken by a person. A Door line written by such an author is
 * still judged as written.
 *
 * Origin (ADR-0056 D1, 2026-10-23): the block declares where the problem
 * comes from, by exactly one line:
 *
 *     Origin: observed 2026-10-07 <source>
 *     Origin: inspection
 *     Origin: synthetic
 *     Origin: proposal
 *
 * - the value is one of ORIGIN_VALUES, lowercase, as `Door:` refuses
 *   `Two-Way`. The key itself is case-sensitive, as `Door:` is: an
 *   `origin:` line is not a declaration;
 * - `observed` (a failure that happened in real use) carries an ISO 8601
 *   calendar date, `YYYY-MM-DD`, that exists on the calendar, is not after
 *   the run's day plus one (a time-zone margin) and not before
 *   OBSERVED_DATE_FLOOR; then a source (pull request, issue, `path:line`,
 *   session note) that is not a placeholder word and that keeps at least one
 *   letter or digit (`\p{L}`, `\p{N}`) once `&...;` entities and the Hangul
 *   fillers (U+115F, U+1160, U+3164, U+FFA0, letters that render as blank)
 *   are removed. Invisible format characters (`\p{Cf}`, U+200B) are neither
 *   letters nor digits, so they never count;
 * - `inspection`, `synthetic` and `proposal` carry nothing else on the line,
 *   as a `Door:` value does: `Origin: proposal mostly` is refused. ADR-0056
 *   D1 sends the other origins of a multi-origin problem to the body.
 *
 * The date floor is 1970-01-01: an observation names a pull request, an
 * issue, a `path:line` or a session note, and none of these carries a
 * timestamp before the Unix epoch — git and the forge store their dates as
 * seconds since it. A floor at the fleet's own first commit would refuse an
 * observed failure dated by an older upstream issue, which ADR-0056 D1
 * admits as a source. The clock is read once, in the command; every
 * function of this module takes `now` as an argument.
 *
 * An author in IMPLICIT_TWO_WAY_AUTHORS writing no Origin line is waived, as
 * for `Door:`. Like `Door:`, this proves a declaration exists, never that it
 * is true.
 *
 * The volume line prints lines examined plus lines removed (inside a comment
 * or a fence, nothing else left on them). The partition holds by
 * construction: lines examined are counted as the body's lines minus the
 * removed ones, so the sum says nothing more than the removed count does.
 *
 * Runs on `pull_request` events (including `edited`, so fixing the
 * description re-runs it). Elsewhere it declares that it judged nothing. On a
 * pull_request run, an event payload that is absent or unreadable is a
 * failure, never an empty body.
 */

export const SECOND_INSTRUMENT_MIN_LENGTH = 12;

/** Accounts whose undeclared pull requests are two-way by construction (version bumps). */
export const IMPLICIT_TWO_WAY_AUTHORS: readonly string[] = ["dependabot[bot]"];

export type DeclarationKey =
  | "Door"
  | "Second-instrument"
  | "Origin"
  | "Owner-arbitration"
  | "Not-added";
/** Keys judged here. */
type JudgedKey = "Door" | "Second-instrument" | "Origin";
/**
 * Keys of the declaration block. The last two are read by other gates
 * (check-review-evidence, ADR-0056 D5) and sit beside Door in the fleet
 * template; they are never judged here.
 */
export const DECLARATION_KEYS: readonly DeclarationKey[] = [
  "Door",
  "Second-instrument",
  "Origin",
  "Owner-arbitration",
  "Not-added",
];
const KEY_ALTERNATION = DECLARATION_KEYS.join("|");
// `s`: a line holds no `\n`, and U+2028/U+2029 inside it are not line ends.
const KEY_LINE = new RegExp(`^(${KEY_ALTERNATION}):(.*)$`, "s");
const INDENTED_KEY_LINE = new RegExp(`^[ \\t]+(${KEY_ALTERNATION}):`);
/**
 * T1: one complete comment filling the line, not opened by `<!-->` or
 * `<!--->` (complete on their own, so text would follow them). No `s` flag: a
 * line with U+2028 or U+2029 is not a header, which only refuses more.
 */
const HEADER_COMMENT_LINE = /^<!--(?!-?>)(?:(?!-->|<!--|--!>).)*-->$/;
const BOM = String.fromCodePoint(0xfeff);
const BLANK_LINE = /^[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const COMMENT_CLOSE = /--!?>/;
/** CommonMark HTML block type 1, at the start of a line, any case. */
const RAW_TEXT_BLOCK_OPEN = /^ {0,3}<(?:pre|script|style|textarea)(?:[\s>]|$)/i;
/** T2: a complete autolink, read at a `<`; its URL holds nothing that opens a construct. */
const AUTOLINK_AT = /<https?:\/\/[^\s<>"`[\]()/?#]+[^\s<>"`[\]()]*>/y;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
/** T2': refused outside code spans; `<` too, unless it opens a whole autolink. */
const REFUSED_OUTSIDE_CODE: ReadonlySet<string> = new Set(["[", "]", "~", "<"]);

const DOOR_VALUES = new Set(["one-way", "two-way"]);
const PLACEHOLDER = /^(?:n\/?a|none|tbd|todo|-+|\.+)$/i;

/** ADR-0056 D1, closed vocabulary. */
export const ORIGIN_VALUES = ["observed", "inspection", "synthetic", "proposal"] as const;
export type OriginValue = (typeof ORIGIN_VALUES)[number];
const ORIGIN_VALUE_SET: ReadonlySet<string> = new Set(ORIGIN_VALUES);
const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Earliest admitted date of an `observed` origin (see the header). */
export const OBSERVED_DATE_FLOOR = "1970-01-01";
const DAY_MS = 86_400_000;
const SOURCE_PLACEHOLDER_WORD = /^(?:n\/?a|none|tbd|todo)$/i;
/** Hangul fillers: `\p{Lo}` letters that render as blank (U+115F, U+1160, U+3164, U+FFA0). */
const HANGUL_FILLER_CODE_POINTS: readonly number[] = [0x115f, 0x1160, 0x3164, 0xffa0];
const HANGUL_FILLERS = new RegExp(`[${String.fromCodePoint(...HANGUL_FILLER_CODE_POINTS)}]`, "g");

export interface StrippedBody {
  /** The cleaned body, with the input's line layout (final newline included). */
  readonly text: string;
  /** Comments and fences removed, each counted once. */
  readonly removedBlocks: number;
  /** The cleaned lines; `[]` for an empty body, no line for a final newline. */
  readonly lines: readonly string[];
  /** Lines that held something and hold nothing but blanks once comments and fences are removed. */
  readonly removedLines: number;
  /** Per line: it starts inside a comment or a fence (a fence's closing line included). */
  readonly inside: readonly boolean[];
  /**
   * Per line: it starts inside a comment or a fence that opened at column 0,
   * at the start of its line, right after a raw blank line or the body start.
   * Only such a construct exempts a key line from T3.
   */
  readonly insideClean: readonly boolean[];
}

function splitLines(body: string): { readonly lines: string[]; readonly finalNewline: boolean } {
  const normalised = body.replace(/\r\n?/g, "\n");
  if (normalised === "") return { lines: [], finalNewline: false };
  const lines = normalised.split("\n");
  const finalNewline = normalised.endsWith("\n");
  if (finalNewline) lines.pop();
  return { lines, finalNewline };
}

/**
 * Remove HTML comments and fenced code blocks, best effort, keeping the line
 * layout, and say for each line whether it starts inside one. Used only for
 * T3 exemptions and the volume line, never to read a value.
 */
export function stripNonDeclarations(body: string): StrippedBody {
  const { lines: source, finalNewline } = splitLines(body);
  const lines: string[] = [];
  const inside: boolean[] = [];
  const insideClean: boolean[] = [];
  let removedBlocks = 0;
  let removedLines = 0;
  let fence: { readonly marker: string; readonly length: number } | null = null;
  let inComment = false;
  // Whether the construct open at the start of the current line opened clean.
  let openedClean = false;
  // A type-1 HTML block (`<pre`, `<script`, `<style`, `<textarea`) runs to its
  // closing tag through blank lines, and holds raw text a fence does not
  // hide: after a line that opens one, no exemption holds to the end.
  let afterRawTextBlock = false;

  source.forEach((line, index) => {
    // The body start reads as a raw blank line above (source[-1] is absent).
    const afterBlank = BLANK_LINE.test(source[index - 1] ?? "");
    inside.push(fence !== null || inComment);
    insideClean.push((fence !== null || inComment) && openedClean && !afterRawTextBlock);
    if (RAW_TEXT_BLOCK_OPEN.test(line)) afterRawTextBlock = true;
    if (fence !== null) {
      const run = FENCE_CLOSE.exec(line)?.[1] ?? "";
      if (run[0] === fence.marker && run.length >= fence.length) fence = null;
      lines.push("");
      removedLines += 1;
      return;
    }
    if (!inComment) {
      const open = FENCE_OPEN.exec(line);
      const run = open?.[1] ?? "";
      const info = open === null ? "" : line.slice(open[0].length);
      if (open !== null && !(run[0] === "`" && info.includes("`"))) {
        fence = { marker: run[0] ?? "", length: run.length };
        openedClean = line.startsWith(run) && afterBlank;
        removedBlocks += 1;
        lines.push("");
        removedLines += 1;
        return;
      }
    }

    let rest = line;
    let kept = "";
    let touched = false;
    for (;;) {
      if (inComment) {
        touched = true;
        // HTML5 closes a comment on `-->` or on `--!>`, whichever comes first.
        const close = COMMENT_CLOSE.exec(rest);
        // Unclosed on this line: nothing of it is kept, the comment goes on.
        if (close === null) break;
        rest = rest.slice(close.index + close[0].length);
        inComment = false;
        continue;
      }
      const start = rest.indexOf("<!--");
      if (start === -1) {
        kept += rest;
        break;
      }
      touched = true;
      removedBlocks += 1;
      kept += rest.slice(0, start);
      const after = rest.slice(start + 4);
      if (after.startsWith(">")) {
        rest = after.slice(1);
      } else if (after.startsWith("->")) {
        rest = after.slice(2);
      } else {
        inComment = true;
        // Clean only if this comment is the first thing of its line.
        openedClean = start === 0 && rest === line && afterBlank;
        rest = after;
      }
    }
    lines.push(kept);
    if (touched && BLANK_LINE.test(kept)) removedLines += 1;
  });

  const text = lines.join("\n") + (finalNewline ? "\n" : "");
  return { text, removedBlocks, lines, removedLines, inside, insideClean };
}

/**
 * T2': the reason a value could open a construct over the next line, or null.
 * Scanned left to right as CommonMark does: a backslash escapes ASCII
 * punctuation, and a backtick run opens a code span closed by the next run of
 * the same length on the line (raw text inside, everything admitted there).
 * Outside code spans the syntax that can hide text is removed, not modelled:
 * no `[` or `]` (no link, no image, even escaped), no `~`, and no `<` except a
 * whole http(s) autolink. Parentheses and quotes are then inert.
 */
export function constructOpenedBy(value: string): string | null {
  let index = 0;
  while (index < value.length) {
    const character = value[index] ?? "";
    if (character === "\\" && ASCII_PUNCTUATION.test(value[index + 1] ?? "")) {
      const escaped = value[index + 1] ?? "";
      // An escape keeps a backtick from opening a span; a refused character
      // stays refused escaped, so the rule needs no model of escapes.
      if (REFUSED_OUTSIDE_CODE.has(escaped)) return `carries '${escaped}' (escaped or not)`;
      index += 2;
      continue;
    }
    if (character === "`") {
      let run = 0;
      while (value[index + run] === "`") run += 1;
      let close = index + run;
      let closed = false;
      while (close < value.length) {
        if (value[close] !== "`") {
          close += 1;
          continue;
        }
        let length = 0;
        while (value[close + length] === "`") length += 1;
        if (length === run) {
          closed = true;
          break;
        }
        close += length;
      }
      if (!closed) return `opens a code span (a run of ${run} backtick(s)) that it does not close`;
      index = close + run;
      continue;
    }
    if (character === "<") {
      AUTOLINK_AT.lastIndex = index;
      const autolink = AUTOLINK_AT.exec(value);
      if (autolink === null) return "carries '<' that is not a complete http(s) autolink";
      index += autolink[0].length;
      continue;
    }
    if (REFUSED_OUTSIDE_CODE.has(character)) {
      return `carries '${character}' (no link, image or strikethrough outside a code span)`;
    }
    index += 1;
  }
  return null;
}

export interface BlockRefusal {
  /** 1-based line number in the body. */
  readonly line: number;
  readonly reason: string;
}

export interface OutsideKeyLine {
  readonly key: DeclarationKey;
  readonly line: number;
  /**
   * Exempt from T3: inside a comment or a fence opened at column 0 right after
   * a raw blank line, before any type-1 HTML block (StrippedBody.insideClean).
   */
  readonly inside: boolean;
}

export interface DeclarationBlocks {
  readonly totalLines: number;
  /** totalLines - removedLines: the partition the volume line prints. */
  readonly linesExamined: number;
  readonly removedLines: number;
  readonly removedBlocks: number;
  readonly headerLines: number;
  /** 1-based, inclusive; null when the body does not open with declarations. */
  readonly block: { readonly first: number; readonly last: number } | null;
  /** When there is no block: the first line that is neither a header nor a declaration. */
  readonly firstOtherLine: number | null;
  /** Values of the block's lines that T2 admits, by key, in body order. */
  readonly values: Readonly<Record<DeclarationKey, readonly string[]>>;
  /** T1 end of block and T2 refusals; each fails the gate. */
  readonly refusals: readonly BlockRefusal[];
  /** Key lines at column 0 after the block (or anywhere, without a block). */
  readonly outsideKeyLines: readonly OutsideKeyLine[];
}

/** Read the declaration block at the top of a description (T1-T3). */
export function readDeclarationBlocks(body: string): DeclarationBlocks {
  const withoutBom = body.startsWith(BOM) ? body.slice(BOM.length) : body;
  const raw = splitLines(withoutBom).lines;
  const stripped = stripNonDeclarations(withoutBom);
  const values: Record<DeclarationKey, string[]> = {
    Door: [],
    "Second-instrument": [],
    Origin: [],
    "Owner-arbitration": [],
    "Not-added": [],
  };
  const refusals: BlockRefusal[] = [];

  let index = 0;
  while (index < raw.length && HEADER_COMMENT_LINE.test(raw[index] ?? "")) index += 1;
  const headerLines = index;
  const first = index;
  // A refused value may open a construct that hides the lines after it (a
  // <details> collapses them): from there on, no line of the block is read.
  let refusedAt: number | null = null;
  for (; index < raw.length; index += 1) {
    const match = KEY_LINE.exec(raw[index] ?? "");
    if (match === null) break;
    const key = match[1] as DeclarationKey;
    if (refusedAt !== null) {
      refusals.push({
        line: index + 1,
        reason: `the ${key} value is not read: it follows line ${refusedAt}, refused`,
      });
      continue;
    }
    const opened = constructOpenedBy(match[2] ?? "");
    if (opened !== null) {
      refusals.push({ line: index + 1, reason: `the ${key} value ${opened}` });
      refusedAt = index + 1;
      continue;
    }
    values[key].push((match[2] ?? "").trim());
  }
  const block = index > first ? { first: first + 1, last: index } : null;
  // At the end of the body there is no line, which reads as blank.
  const after = raw[index] ?? "";
  if (block !== null && !BLANK_LINE.test(after)) {
    refusals.push({
      line: index + 1,
      reason: `the declaration block must end with a blank line: line ${index + 1} is not a declaration${INDENTED_KEY_LINE.test(after) ? " (a declaration starts at column 0)" : ""}`,
    });
  }

  const outsideKeyLines: OutsideKeyLine[] = [];
  raw.forEach((line, lineIndex) => {
    if (lineIndex < index) return;
    const match = KEY_LINE.exec(line);
    if (match !== null) {
      outsideKeyLines.push({
        key: match[1] as DeclarationKey,
        line: lineIndex + 1,
        inside: stripped.insideClean[lineIndex] ?? false,
      });
    }
  });

  return {
    totalLines: raw.length,
    linesExamined: raw.length - stripped.removedLines,
    removedLines: stripped.removedLines,
    removedBlocks: stripped.removedBlocks,
    headerLines,
    block,
    firstOtherLine: block === null && first < raw.length ? first + 1 : null,
    values,
    refusals,
    outsideKeyLines,
  };
}

export interface DoorDeclaration extends DeclarationBlocks {
  readonly doorValues: readonly string[];
  readonly secondInstruments: readonly string[];
  readonly originValues: readonly string[];
}

export function readDoorDeclaration(body: string): DoorDeclaration {
  const blocks = readDeclarationBlocks(body);
  return {
    ...blocks,
    doorValues: blocks.values.Door,
    secondInstruments: blocks.values["Second-instrument"],
    originValues: blocks.values.Origin,
  };
}

function isSubstantive(value: string): boolean {
  return value.length >= SECOND_INSTRUMENT_MIN_LENGTH && !PLACEHOLDER.test(value);
}

/** True for `YYYY-MM-DD` naming a day that exists (no 2026-02-30, no month 13). */
export function isIsoCalendarDate(value: string): boolean {
  const parts = ISO_CALENDAR_DATE.exec(value);
  if (parts === null) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC maps years 0-99 to 1900-1999; setUTCFullYear restores them.
  date.setUTCFullYear(year);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * True when a source keeps a letter or a digit once `&...;` entities and the
 * Hangul fillers are removed. The source has passed T2: its only `<` start
 * autolinks, which count as their URL.
 */
export function hasVisibleSource(source: string): boolean {
  // Invisible format characters (\p{Cf}, e.g. U+200B) are neither letters nor
  // digits, so the test below already ignores them: no removal step is needed.
  const visible = source.replace(/&[^\s;&]*;/g, " ").replace(HANGUL_FILLERS, "");
  return /[\p{L}\p{N}]/u.test(visible);
}

export type OriginJudgement =
  | {
      readonly ok: true;
      readonly value: OriginValue;
      readonly date: string | null;
      readonly source: string | null;
    }
  | { readonly ok: false; readonly reason: string };

const ORIGIN_VOCABULARY = ORIGIN_VALUES.map((value) => `"${value}"`).join(", ");

/** Pure verdict over the text that follows one `Origin:` key, judged at `now`. */
export function judgeOrigin(declared: string, now: Date): OriginJudgement {
  const value = declared.trim();
  if (value === "") {
    return { ok: false, reason: `Origin line carries no value — one of ${ORIGIN_VOCABULARY}` };
  }
  const [keyword = "", ...restTokens] = value.split(/\s+/);
  if (!ORIGIN_VALUE_SET.has(keyword)) {
    return { ok: false, reason: `Origin value "${keyword}" is none of ${ORIGIN_VOCABULARY}` };
  }
  const origin = keyword as OriginValue;
  if (origin !== "observed") {
    return restTokens.length === 0
      ? { ok: true, value: origin, date: null, source: null }
      : {
          ok: false,
          reason: `Origin: ${origin} carries nothing else on its line, found "${restTokens.join(" ")}" — other origins are cited in the body (ADR-0056 D1)`,
        };
  }
  const [date, ...sourceTokens] = restTokens;
  if (date === undefined) {
    return {
      ok: false,
      reason:
        "Origin: observed needs its date and its source — `Origin: observed YYYY-MM-DD <source>`",
    };
  }
  if (!isIsoCalendarDate(date)) {
    return {
      ok: false,
      reason: `Origin: observed date "${date}" is not a valid ISO 8601 calendar date (YYYY-MM-DD)`,
    };
  }
  // ISO dates of the same width compare as strings.
  if (date < OBSERVED_DATE_FLOOR) {
    return {
      ok: false,
      reason: `Origin: observed date "${date}" is before ${OBSERVED_DATE_FLOOR}, earlier than any source can be dated`,
    };
  }
  if (Date.parse(`${date}T00:00:00Z`) > now.getTime() + DAY_MS) {
    return {
      ok: false,
      reason: `Origin: observed date "${date}" is after ${now.toISOString().slice(0, 10)} + 1 day — an observation is not in the future`,
    };
  }
  const source = sourceTokens.join(" ");
  if (source === "") {
    return {
      ok: false,
      reason: `Origin: observed ${date} needs a source after its date (pull request, issue, path:line, session note)`,
    };
  }
  if (SOURCE_PLACEHOLDER_WORD.test(source) || !hasVisibleSource(source)) {
    return {
      ok: false,
      reason: `Origin: observed source "${source}" is a placeholder or has no letter or digit once entities and blank-rendering characters are removed — name the pull request, issue, path:line or session note`,
    };
  }
  return { ok: true, value: origin, date, source };
}

/** Pure verdict over one pull request description, judged at `now`. */
export function evaluateDoor(
  body: string,
  label: string,
  author: string | null,
  now: Date,
): GateReport {
  const report = new GateReport();
  const declaration = readDoorDeclaration(body);
  const { doorValues, secondInstruments, originValues, block } = declaration;
  const isImplicitAuthor = author !== null && IMPLICIT_TWO_WAY_AUTHORS.includes(author);
  // Why a key is absent: no block at all, or a block without (or refusing) its line.
  const whereNot = (key: JudgedKey): string => {
    if (block === null) {
      const first =
        declaration.firstOtherLine === null
          ? "the description holds no line after its header comments"
          : `line ${declaration.firstOtherLine} is the first line that is neither a header comment nor a declaration`;
      return ` — declarations must be the first lines of the description (after a BOM and whole-line HTML comments): ${first}`;
    }
    const refused = declaration.refusals.filter((refusal) =>
      refusal.reason.startsWith(`the ${key} value`),
    );
    return (
      ` in the declaration block (lines ${block.first}-${block.last})` +
      (refused.length === 0
        ? ""
        : `; refused: ${refused.map((refusal) => `line ${refusal.line}`).join(", ")}`)
    );
  };

  const stray = declaration.outsideKeyLines.filter((entry) => !entry.inside);
  const blockProblems = [
    ...declaration.refusals.map((refusal) => `line ${refusal.line}: ${refusal.reason}`),
    ...stray.map(
      (entry) =>
        `line ${entry.line}: a \`${entry.key}:\` line outside the declaration block — declarations are read only from the block at the top of the description`,
    ),
  ];
  if (blockProblems.length > 0) {
    report.check(`${label} — declaration block`, false, blockProblems.join("; "));
  } else if (block !== null) {
    report.check(
      `${label} — declaration block`,
      true,
      `declaration block: lines ${block.first}-${block.last}`,
    );
  }

  const implicitTwoWay = doorValues.length === 0 && isImplicitAuthor;
  if (implicitTwoWay) {
    report.check(
      `${label} — Door`,
      true,
      `Door: two-way (implicit: no Door line, author ${author} is in IMPLICIT_TWO_WAY_AUTHORS)`,
    );
  } else if (doorValues.length === 0) {
    report.check(
      `${label} — Door`,
      false,
      `no \`Door: one-way\` or \`Door: two-way\` line${whereNot("Door")}`,
    );
  } else if (doorValues.length > 1) {
    report.check(
      `${label} — Door`,
      false,
      `${doorValues.length} Door lines (${doorValues.map((value) => `"${value}"`).join(", ")}) — declare exactly one`,
    );
  } else {
    const value = doorValues[0] ?? "";
    report.check(
      `${label} — Door`,
      DOOR_VALUES.has(value),
      DOOR_VALUES.has(value)
        ? `Door: ${value}`
        : `Door value "${value}" is neither "one-way" nor "two-way"`,
    );
  }

  const door = doorValues.length === 1 ? doorValues[0] : undefined;
  const substantive = secondInstruments.filter(isSubstantive);
  if (door === "one-way") {
    report.check(
      `${label} — Second-instrument`,
      substantive.length > 0,
      substantive.length > 0
        ? `Second-instrument: ${substantive[0]}`
        : secondInstruments.length === 0
          ? `a one-way door needs a \`Second-instrument:\` line naming an independent measurement (gate-integrity §3)${whereNot("Second-instrument")}`
          : `Second-instrument is empty or a placeholder ("${secondInstruments[0]}") — name the instrument and its result, at least ${SECOND_INSTRUMENT_MIN_LENGTH} characters`,
    );
  }

  const originWaived = originValues.length === 0 && isImplicitAuthor;
  if (originWaived) {
    report.check(
      `${label} — Origin`,
      true,
      `Origin: waived (no Origin line, author ${author} is in IMPLICIT_TWO_WAY_AUTHORS)`,
    );
  } else if (originValues.length === 0) {
    report.check(
      `${label} — Origin`,
      false,
      `no \`Origin:\` line — one of ${ORIGIN_VOCABULARY}, \`observed\` with its date and source (ADR-0056 D1)${whereNot("Origin")}`,
    );
  } else if (originValues.length > 1) {
    report.check(
      `${label} — Origin`,
      false,
      `${originValues.length} Origin lines (${originValues.map((value) => `"${value}"`).join(", ")}) — declare exactly one`,
    );
  } else {
    const judgement = judgeOrigin(originValues[0] ?? "", now);
    report.check(
      `${label} — Origin`,
      judgement.ok,
      judgement.ok
        ? `Origin: ${[judgement.value, judgement.date, judgement.source].filter((part) => part !== null).join(" ")}`
        : judgement.reason,
    );
  }

  const insideCount = declaration.outsideKeyLines.length - stray.length;
  report.volume(
    `${declaration.totalLines} description line(s) = ${declaration.linesExamined} examined + ${declaration.removedLines} removed in ${declaration.removedBlocks} comment/code block(s); ` +
      `${declaration.headerLines} header comment line(s), declaration block ${block === null ? "absent" : `lines ${block.first}-${block.last}`}; ` +
      `${doorValues.length} Door line(s), ${secondInstruments.length} Second-instrument line(s), ${originValues.length} Origin line(s); ` +
      `${declaration.outsideKeyLines.length} key line(s) outside the block (${insideCount} inside comments or code)` +
      (implicitTwoWay ? `; door implied by author ${author}` : "") +
      (originWaived ? `; origin waived for author ${author}` : ""),
  );
  return report;
}

export type EventRead =
  | {
      readonly ok: true;
      readonly number: number | null;
      readonly body: string;
      readonly author: string | null;
    }
  | { readonly ok: false; readonly reason: string };

/** Pure parse of the GitHub event payload text. */
export function readPullRequestEvent(payload: string): EventRead {
  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `event payload is not valid JSON (${message})` };
  }
  const pullRequest =
    typeof event === "object" && event !== null
      ? (event as { pull_request?: unknown }).pull_request
      : undefined;
  if (typeof pullRequest !== "object" || pullRequest === null) {
    return { ok: false, reason: "event payload carries no pull_request object" };
  }
  const record = pullRequest as { number?: unknown; body?: unknown; user?: unknown };
  const body = record.body;
  if (body !== null && body !== undefined && typeof body !== "string") {
    return { ok: false, reason: "pull_request.body is neither a string nor null" };
  }
  const login =
    typeof record.user === "object" && record.user !== null
      ? (record.user as { login?: unknown }).login
      : undefined;
  return {
    ok: true,
    number: typeof record.number === "number" ? record.number : null,
    body: body ?? "",
    author: typeof login === "string" ? login : null,
  };
}

if (import.meta.main) {
  const gate = "PR door";
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    concludeGate(
      gate,
      new GateReport().allowEmpty(
        `not a pull_request run (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}) — ` +
          "the declaration lives in a pull request description, judged at the PR gate",
      ),
    );
  } else {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    let read: EventRead;
    if (!eventPath) {
      read = { ok: false, reason: "GITHUB_EVENT_PATH is unset on a pull_request run" };
    } else {
      try {
        read = readPullRequestEvent(await Bun.file(eventPath).text());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        read = { ok: false, reason: `event payload unreadable at ${eventPath} (${message})` };
      }
    }
    if (!read.ok) {
      concludeGate(gate, new GateReport().check("pull request event", false, read.reason));
    } else {
      const label =
        read.number === null ? "pull request description" : `PR #${read.number} description`;
      // The only clock read of this module: every function above takes `now`.
      concludeGate(gate, evaluateDoor(read.body, label, read.author, new Date()));
    }
  }
}
