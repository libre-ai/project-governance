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
 * The form (the fleet pull request template in libre-ai/.github carries it
 * verbatim), each on its own line, at the start of the line:
 *
 *     Door: two-way
 *     Door: one-way
 *     Second-instrument: <what independent measurement was taken, and its result>
 *
 * - exactly one `Door:` line, whose value is `one-way` or `two-way`
 *   (lowercase, nothing else on the line). The unfilled template line
 *   `Door: one-way | two-way` is refused: choosing is the point;
 * - `Second-instrument:` is required when the door is one-way, with at least
 *   SECOND_INSTRUMENT_MIN_LENGTH characters that are not a placeholder
 *   (`n/a`, `none`, `tbd`, `-`). On a two-way door it is optional.
 *
 * Where a declaration line is read — a restricted grammar (two separate-role
 * reviews of #141, 2026-10-23). The gate must never read a declaration that
 * GitHub does not display. Emulating the renderer case by case failed twice,
 * so the gate accepts a narrow grammar and refuses everything else by name.
 * A wrong refusal is acceptable when it is named; an invented declaration
 * never is. Lines end at `\n` only, after CRLF and CR are normalised, and a
 * final newline opens no line.
 *
 * - G1. A declaration line is a line that starts, at column 0, with one of
 *   DECLARATION_KEYS followed by `:`. A declaration block is a run of
 *   consecutive declaration lines. `Owner-arbitration:` and `Not-added:` are
 *   read by other gates and never judged here, but they belong to blocks.
 * - G2. The raw line above a block is one of: nothing (the block opens the
 *   body); a raw blank line (spaces only); or the last line of an HTML comment
 *   or a fence that opened at the start of its own line (indent at most 3),
 *   right after the body start or a raw blank line, with nothing but blanks
 *   after its closing marker. A line that cleaning only emptied is never a
 *   boundary by itself: a comment or a fence can sit inside a link title or
 *   an HTML attribute that swallows the lines after it.
 * - G3. A value carries none of `<` `>` `[` `]` `` ` `` `"`, which can open
 *   a construct (tag, attribute, link, code span, title) over the following
 *   lines. The one exception: the source of `Origin: observed` may carry
 *   whole autolinks `<https://host...>` (or `http://`), whose URL holds none
 *   of those characters. A refused line stops its block: the lines after it
 *   in the run are not read.
 * - G0. No block is read after raw HTML that is not a complete comment:
 *   outside comments, fences and same-line code spans, any `<` followed by a
 *   letter, `/`, `?` or `!` (autolinks excepted) before the block refuses it.
 *   Measured through GitHub's renderer (POST /markdown, mode gfm) on
 *   2026-10-23: a `title="` attribute left open before a blank line renders
 *   nothing after it, and so do `<![CDATA[`, `<?` and `<!X`; `<details>`
 *   collapses the lines after it and `<video>` turns them into fallback
 *   content. A raw blank line does not end any of these. A complete
 *   void-element tag with no quote (`<br>`, `<img src=x>`, `<source>`) is
 *   not counted: it has no content to hide anything in (COMPLETE_VOID_TAG).
 * - Comments and fences, whose content is never a declaration, are read with
 *   their CommonMark extent: `<!-->` and `<!--->` are complete comments, any
 *   other `<!--` runs to the next `-->` (unclosed: to the end of the body); a
 *   fence opens on three or more backticks or tildes indented at most three
 *   spaces (a backtick run whose info string holds a backtick is inline code),
 *   and closes only on a run of the same character, at least as long,
 *   followed by nothing but spaces (unclosed: to the end of the body).
 * - G4. A key line met outside a valid block is refused by name with its
 *   reason, and so is a refused value. For the three judged keys (Door,
 *   Second-instrument, Origin), such a line fails the gate even when another
 *   line of the same key was read: a line the gate cannot read may be one
 *   GitHub displays. Key lines inside comments and code are counted, never
 *   failing: they are the template's own guidance.
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
 * Origin (ADR-0056 D1, 2026-10-23): the same description declares where the
 * problem it treats comes from, by exactly one line read as `Door:` is:
 *
 *     Origin: observed 2026-10-07 <source>
 *     Origin: inspection
 *     Origin: synthetic
 *     Origin: proposal
 *
 * - the value is one of ORIGIN_VALUES, lowercase, as `Door:` refuses
 *   `Two-Way`. The key itself is case-sensitive, as `Door:` is: an
 *   `origin:` line is not read, so the declaration is absent;
 * - `observed` (a failure that happened in real use) carries an ISO 8601
 *   calendar date, `YYYY-MM-DD`, that exists on the calendar, is not after
 *   the run's day plus one (a time-zone margin) and not before
 *   OBSERVED_DATE_FLOOR; then a source (pull request, issue, `path:line`,
 *   session note) that is not a placeholder word and that keeps at least one
 *   letter or digit (`\p{L}`, `\p{N}`) once `&...;` entities and the Hangul
 *   fillers (U+115F, U+1160, U+3164, U+FFA0, letters that render as blank)
 *   are removed. Invisible format characters (`\p{Cf}`, U+200B) are neither
 *   letters nor digits, so they never count. An autolink counts as its URL;
 * - `inspection`, `synthetic` and `proposal` carry nothing else on the line,
 *   as a `Door:` value does: `Origin: proposal mostly` is refused (and
 *   `Origin: proposal, mostly` too, `proposal,` being no value). ADR-0056
 *   D1 sends the other origins of a multi-origin problem to the body, not to
 *   the line, and trailing text on the line would be the place where an
 *   `observed` claim slips in without its date.
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
 * for `Door:` — the verdict says so and names no value, because the gate does
 * not know which origin a bot's bump has. An Origin line written by such an
 * author is judged as written. Like `Door:`, this proves a declaration exists,
 * never that it is true.
 *
 * The volume line is a partition of the body: lines examined plus lines
 * removed (inside a comment or a fence, nothing else left on them) equal the
 * lines of the body.
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
const JUDGED_KEYS: readonly JudgedKey[] = ["Door", "Second-instrument", "Origin"];
/**
 * Keys of a declaration block. The last two are read by other gates
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
const BLANK_LINE = /^[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const COMMENT_AT_LINE_START = /^ {0,3}<!--/;
/** G3: characters that can open a construct over the following lines. */
const CONSTRUCT_CHARACTER = /[<>[\]`"]/;
/** G3 exception, observed sources only: a whole autolink whose URL opens nothing. */
const SOURCE_AUTOLINK = /<https?:\/\/[^\s<>"`[\]/?#]+[^\s<>"`[\]]*>/g;
/** G0, after comments are removed: a tag, a closing tag, `<?` or `<!`. */
const RAW_HTML = /<[A-Za-z/?!]/;
const CODE_SPAN = /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
const ANY_AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|<[^\s<>@]+@[^\s<>]+>/g;
/**
 * G0 exception: a complete void-element tag, closed on its line, with no quote
 * in it, has no content and no open attribute, so it hides nothing after it
 * (measured on GitHub 2026-10-23: `<br>`, `<hr/>`, `<img src=x>`, `<input>`,
 * `<wbr>`, `<source>`, each followed by a blank line and `Door: two-way`,
 * render the Door paragraph). The template's `<source>` placeholder is one.
 */
const COMPLETE_VOID_TAG =
  /<(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)(?:\s[^<>"'`]*)?\/?>/gi;

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
  /** Per line: it ends a comment or fence that may precede a block (G2). */
  readonly boundary: readonly boolean[];
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
 * Remove HTML comments and fenced code blocks with their CommonMark extent,
 * keeping the line layout, and say for each line whether it starts inside one
 * and whether it ends one that may precede a declaration block (G2).
 */
export function stripNonDeclarations(body: string): StrippedBody {
  const { lines: source, finalNewline } = splitLines(body);
  const lines: string[] = [];
  const inside: boolean[] = [];
  const boundary: boolean[] = [];
  let removedBlocks = 0;
  let removedLines = 0;
  let fence: { readonly marker: string; readonly length: number; readonly clean: boolean } | null =
    null;
  let inComment = false;
  let commentClean = false;

  source.forEach((line, index) => {
    // A construct opened here is clean when it opens the body or follows a raw
    // blank line; the body start reads as a blank line above (source[-1] is "").
    const afterBoundary = BLANK_LINE.test(source[index - 1] ?? "");
    inside.push(fence !== null || inComment);
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(line);
      const run = close?.[1] ?? "";
      // Only the closing line can be followed by a line outside the fence, so
      // the flag needs no `closes`: on any other line the next line is inside.
      boundary.push(fence.clean);
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
        fence = { marker: run[0] ?? "", length: run.length, clean: afterBoundary };
        removedBlocks += 1;
        boundary.push(false);
        lines.push("");
        removedLines += 1;
        return;
      }
    }

    let rest = line;
    let kept = "";
    let touched = false;
    let endsCleanComment = false;
    for (;;) {
      if (inComment) {
        touched = true;
        const end = rest.indexOf("-->");
        // Unclosed on this line: nothing of it is kept, the comment goes on.
        if (end === -1) break;
        rest = rest.slice(end + 3);
        inComment = false;
        endsCleanComment = commentClean && BLANK_LINE.test(rest);
        continue;
      }
      const start = rest.indexOf("<!--");
      if (start === -1) {
        kept += rest;
        break;
      }
      // Clean: the first comment of a line, at its start (indent at most 3),
      // on a line that opens the body or follows a raw blank line.
      commentClean = rest === line && COMMENT_AT_LINE_START.test(line) && afterBoundary;
      touched = true;
      removedBlocks += 1;
      kept += rest.slice(0, start);
      const after = rest.slice(start + 4);
      if (after.startsWith(">")) {
        rest = after.slice(1);
        endsCleanComment = commentClean && BLANK_LINE.test(rest);
      } else if (after.startsWith("->")) {
        rest = after.slice(2);
        endsCleanComment = commentClean && BLANK_LINE.test(rest);
      } else {
        inComment = true;
        rest = after;
      }
    }
    // A clean comment ends with a blank remainder, so no comment is open after it.
    boundary.push(endsCleanComment);
    lines.push(kept);
    if (touched && BLANK_LINE.test(kept)) removedLines += 1;
  });

  const text = lines.join("\n") + (finalNewline ? "\n" : "");
  return { text, removedBlocks, lines, removedLines, inside, boundary };
}

export type UnreadReason =
  | "inside"
  | "indented"
  | "continues"
  | "construct"
  | "after-refused"
  | "raw-html";

export interface UnreadKeyLine {
  readonly key: DeclarationKey;
  /** 1-based line number in the body. */
  readonly line: number;
  readonly reason: UnreadReason;
  /** The construct character (construct), the refused line (after-refused) or the HTML line (raw-html). */
  readonly detail: string;
}

export interface DeclarationBlocks {
  readonly totalLines: number;
  /** totalLines - removedLines: the partition the volume line prints. */
  readonly linesExamined: number;
  readonly removedLines: number;
  readonly removedBlocks: number;
  /** Values of the lines read, by key, in body order. */
  readonly values: Readonly<Record<DeclarationKey, readonly string[]>>;
  readonly unreadKeyLines: readonly UnreadKeyLine[];
}

/** G3: the first construct character of a value, or null. */
function constructCharacter(key: DeclarationKey, value: string): string | null {
  const examined =
    key === "Origin" && value.trimStart().startsWith("observed")
      ? value.replace(SOURCE_AUTOLINK, " ")
      : value;
  return CONSTRUCT_CHARACTER.exec(examined)?.[0] ?? null;
}

/** G0: does this cleaned line carry raw HTML outside code spans and autolinks? */
function carriesRawHtml(cleaned: string): boolean {
  return RAW_HTML.test(
    cleaned.replace(CODE_SPAN, " ").replace(ANY_AUTOLINK, " ").replace(COMPLETE_VOID_TAG, " "),
  );
}

/** Read every declaration block of a description with the restricted grammar (G0-G4). */
export function readDeclarationBlocks(body: string): DeclarationBlocks {
  const stripped = stripNonDeclarations(body);
  const raw = splitLines(body).lines;
  const values: Record<DeclarationKey, string[]> = {
    Door: [],
    "Second-instrument": [],
    Origin: [],
    "Owner-arbitration": [],
    "Not-added": [],
  };
  const unreadKeyLines: UnreadKeyLine[] = [];
  let firstRawHtml: number | null = null;
  // State of the current run of declaration lines: null outside a run.
  let run: { readonly reason: UnreadReason | null; readonly detail: string } | null = null;

  raw.forEach((line, index) => {
    // G0 judges what comes before a line: read the scan, then extend it with
    // this line, whatever the line is (a refused key line can open a tag too).
    const rawHtmlBefore = firstRawHtml;
    if (firstRawHtml === null && carriesRawHtml(stripped.lines[index] ?? "")) {
      firstRawHtml = index;
    }
    const inside = stripped.inside[index] ?? false;
    const keyMatch = KEY_LINE.exec(line);
    if (inside || keyMatch === null) {
      const indented = INDENTED_KEY_LINE.exec(line);
      const key = (keyMatch?.[1] ?? indented?.[1] ?? null) as DeclarationKey | null;
      if (key !== null) {
        unreadKeyLines.push({
          key,
          line: index + 1,
          reason: inside ? "inside" : "indented",
          detail: "",
        });
      }
      run = null;
      return;
    }
    const key = keyMatch[1] as DeclarationKey;
    const value = keyMatch[2] ?? "";
    if (run === null) {
      // The body start reads as a blank line above (raw[-1] is absent, so "").
      const startsBlock =
        BLANK_LINE.test(raw[index - 1] ?? "") || (stripped.boundary[index - 1] ?? false);
      run = !startsBlock
        ? { reason: "continues", detail: "" }
        : rawHtmlBefore !== null
          ? { reason: "raw-html", detail: String(rawHtmlBefore + 1) }
          : { reason: null, detail: "" };
    }
    if (run.reason !== null) {
      unreadKeyLines.push({ key, line: index + 1, reason: run.reason, detail: run.detail });
      return;
    }
    const character = constructCharacter(key, value);
    if (character !== null) {
      unreadKeyLines.push({ key, line: index + 1, reason: "construct", detail: character });
      run = {
        reason: "after-refused",
        detail: `${index + 1}, refused: declaration value carries '${character}' that can open a construct over the next lines`,
      };
      return;
    }
    values[key].push(value.trim());
  });

  return {
    totalLines: raw.length,
    linesExamined: raw.length - stripped.removedLines,
    removedLines: stripped.removedLines,
    removedBlocks: stripped.removedBlocks,
    values,
    unreadKeyLines,
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
 * Hangul fillers are removed, an autolink counting as its URL. The source has
 * already passed G3, so it holds no other `<`.
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

/**
 * Pure verdict over the text that follows one `Origin:` key, judged at `now`.
 * The text is one the block reader admitted (G3).
 */
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

function describeUnread(entry: UnreadKeyLine): string {
  switch (entry.reason) {
    case "inside":
      return `line ${entry.line} is inside a comment or a code block`;
    case "indented":
      return `line ${entry.line} is indented (a declaration starts at column 0)`;
    case "continues":
      return `line ${entry.line} continues the line above (a declaration block starts the body, follows a blank line, or follows a comment or fence that itself starts the body or follows a blank line)`;
    case "construct":
      return `line ${entry.line}: declaration value carries '${entry.detail}' that can open a construct over the next lines`;
    case "after-refused":
      return `line ${entry.line} follows line ${entry.detail}`;
    case "raw-html":
      return `line ${entry.line} follows raw HTML at line ${entry.detail}, which can hide the lines after it`;
  }
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
  const { doorValues, secondInstruments, originValues } = declaration;
  const unreadOf = (key: JudgedKey) =>
    declaration.unreadKeyLines.filter((entry) => entry.key === key);
  // G4: a judged key line outside comments and code that is not read.
  const strayOf = (key: JudgedKey) => unreadOf(key).filter((entry) => entry.reason !== "inside");
  const unreadNote = (key: JudgedKey): string => {
    const unread = unreadOf(key);
    return unread.length === 0
      ? ""
      : `; ${key} line(s) not read: ${unread.map(describeUnread).join("; ")}`;
  };
  const isImplicitAuthor = author !== null && IMPLICIT_TWO_WAY_AUTHORS.includes(author);
  // Keys whose absence check already failed and named every unread line.
  const failedAbsent = new Set<JudgedKey>();

  // An unread Door line written by such an author still fails, through G4 below.
  const implicitTwoWay = doorValues.length === 0 && isImplicitAuthor;
  if (implicitTwoWay) {
    report.check(
      `${label} — Door`,
      true,
      `Door: two-way (implicit: no Door line, author ${author} is in IMPLICIT_TWO_WAY_AUTHORS)`,
    );
  } else if (doorValues.length === 0) {
    failedAbsent.add("Door");
    report.check(
      `${label} — Door`,
      false,
      "no `Door: one-way` or `Door: two-way` line (outside comments and code blocks)" +
        unreadNote("Door"),
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
    if (secondInstruments.length === 0) failedAbsent.add("Second-instrument");
    report.check(
      `${label} — Second-instrument`,
      substantive.length > 0,
      substantive.length > 0
        ? `Second-instrument: ${substantive[0]}`
        : secondInstruments.length === 0
          ? "a one-way door needs a `Second-instrument:` line naming an independent measurement (gate-integrity §3)" +
            unreadNote("Second-instrument")
          : `Second-instrument is empty or a placeholder ("${secondInstruments[0]}") — name the instrument and its result, at least ${SECOND_INSTRUMENT_MIN_LENGTH} characters`,
    );
  }

  // Same for an unread Origin line: G4 below fails it.
  const originWaived = originValues.length === 0 && isImplicitAuthor;
  if (originWaived) {
    report.check(
      `${label} — Origin`,
      true,
      `Origin: waived (no Origin line, author ${author} is in IMPLICIT_TWO_WAY_AUTHORS)`,
    );
  } else if (originValues.length === 0) {
    failedAbsent.add("Origin");
    report.check(
      `${label} — Origin`,
      false,
      `no \`Origin:\` line (outside comments and code blocks) — one of ${ORIGIN_VOCABULARY}, \`observed\` with its date and source (ADR-0056 D1)` +
        unreadNote("Origin"),
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

  for (const key of JUDGED_KEYS) {
    const stray = strayOf(key);
    if (stray.length === 0 || failedAbsent.has(key)) continue;
    report.check(
      `${label} — ${key}`,
      false,
      `${stray.length} ${key} line(s) outside comments and code are not read: ${stray.map(describeUnread).join("; ")} — a line the gate cannot read may be one GitHub displays`,
    );
  }

  const insideCount = declaration.unreadKeyLines.filter(
    (entry) => entry.reason === "inside",
  ).length;
  report.volume(
    `${declaration.totalLines} description line(s) = ${declaration.linesExamined} examined + ${declaration.removedLines} removed in ${declaration.removedBlocks} comment/code block(s); ` +
      `${doorValues.length} Door line(s), ${secondInstruments.length} Second-instrument line(s), ${originValues.length} Origin line(s); ` +
      `${declaration.unreadKeyLines.length} key line(s) not read (${insideCount} inside comments or code)` +
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
