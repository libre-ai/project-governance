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
 *   (`<...>`, `n/a`, `none`, `tbd`, `-`). On a two-way door it is optional.
 *
 * Where a declaration line is read (review of #141, 2026-10-23). The gate
 * must read the line GitHub displays, and only that line, so the body is cut
 * the way CommonMark cuts it:
 *
 * - lines end at `\n` only, after CRLF and CR are normalised. U+2028 and
 *   U+2029 end a line for a JavaScript `m` regex, not for CommonMark, so no
 *   `m` flag is used: each line is matched on its own;
 * - HTML comments are removed with their CommonMark extent: `<!-->` and
 *   `<!--->` are complete comments, any other `<!--` runs to the next `-->`,
 *   and an unclosed one swallows the rest of the body (fail closed);
 * - a fenced code block opens on a run of three or more backticks or tildes
 *   indented at most three spaces (a backtick run whose info string holds a
 *   backtick is inline code, not a fence), and closes only on a run of the
 *   same character, at least as long, followed by nothing but spaces. An
 *   unclosed fence runs to the end of the body;
 * - a key line indented by four or more columns, or by any tab, is an
 *   indented code block and never a declaration (fail closed: a tab inside
 *   three spaces is refused too, rather than computing tab stops);
 * - a key line is read only when it starts a block: it is the first line of
 *   the body, or the line above it is blank once cleaned, or the line above
 *   is itself a read declaration line (DECLARATION_KEYS, which also holds
 *   `Owner-arbitration:` and `Not-added:` of the fleet template). Anything
 *   else continues a paragraph, a link title or an HTML attribute, where
 *   GitHub shows the text inside other text or not at all (a tooltip).
 *
 * A key line not read for one of the last two reasons is counted, and named
 * in the refusal when it leaves its key absent.
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
 *   letter or digit (`\p{L}`, `\p{N}`) once HTML tags and `&...;` entities
 *   are removed — invisible format characters (`\p{Cf}`, U+200B) are neither,
 *   so they never count. An autolink `<https://host...>` is kept as text, and
 *   only with a host;
 * - `inspection`, `synthetic` and `proposal` carry nothing else on the line,
 *   as a `Door:` value does: `Origin: proposal mostly` is refused (and
 *   `Origin: proposal, mostly` too, `proposal,` being no value). ADR-0056
 *   D1 sends the other origins of a multi-origin problem to the body, not to
 *   the line, and trailing text on the line would be the place where an
 *   `observed` claim slips in without its date. The unfilled template line
 *   `Origin: observed YYYY-MM-DD <source> | inspection | synthetic | proposal`
 *   is refused by the date rule.
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

/** Keys judged here. */
type JudgedKey = "Door" | "Second-instrument" | "Origin";
/**
 * Keys whose lines chain: a declaration line may follow any of them. The last
 * two are read by other gates (check-review-evidence, ADR-0056 D5) and sit
 * beside Door in the fleet template; they are never judged here.
 */
const DECLARATION_KEYS: readonly string[] = [
  "Door",
  "Second-instrument",
  "Origin",
  "Owner-arbitration",
  "Not-added",
];
// `s`: a line holds no `\n`, and U+2028/U+2029 inside it are not line ends.
const KEY_LINE = new RegExp(`^([ \\t]*)(${DECLARATION_KEYS.join("|")}):(.*)$`, "s");
const BLANK_LINE = /^[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

const DOOR_VALUES = new Set(["one-way", "two-way"]);
const PLACEHOLDER = /^(?:<[^>]*>|n\/?a|none|tbd|todo|-+|\.+)$/i;

/** ADR-0056 D1, closed vocabulary. */
export const ORIGIN_VALUES = ["observed", "inspection", "synthetic", "proposal"] as const;
export type OriginValue = (typeof ORIGIN_VALUES)[number];
const ORIGIN_VALUE_SET: ReadonlySet<string> = new Set(ORIGIN_VALUES);
const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Earliest admitted date of an `observed` origin (see the header). */
export const OBSERVED_DATE_FLOOR = "1970-01-01";
const DAY_MS = 86_400_000;
const SOURCE_PLACEHOLDER_WORD = /^(?:n\/?a|none|tbd|todo)$/i;
const AUTOLINK_WITH_HOST = /<(https?:\/\/[^\s/?#<>]+[^\s<>]*)>/g;

export interface StrippedBody {
  /** The cleaned body, same line count as the input once CRLF/CR are normalised. */
  readonly text: string;
  readonly removedBlocks: number;
  /** The cleaned lines; `[]` for an empty body. */
  readonly lines: readonly string[];
  /** Lines that held something and hold nothing but blanks once comments and fences are removed. */
  readonly removedLines: number;
}

/**
 * Remove HTML comments and fenced code blocks with their CommonMark extent,
 * keeping the line count stable. Lines are cut at `\n` only.
 */
export function stripNonDeclarations(body: string): StrippedBody {
  const normalised = body.replace(/\r\n?/g, "\n");
  const source = normalised === "" ? [] : normalised.split("\n");
  const lines: string[] = [];
  let removedBlocks = 0;
  let removedLines = 0;
  let fence: { readonly marker: string; readonly length: number } | null = null;
  let inComment = false;

  for (const line of source) {
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(line);
      const run = close?.[1] ?? "";
      if (run[0] === fence.marker && run.length >= fence.length) fence = null;
      lines.push("");
      removedLines += 1;
      continue;
    }
    if (!inComment) {
      const open = FENCE_OPEN.exec(line);
      const run = open?.[1] ?? "";
      const info = open === null ? "" : line.slice(open[0].length);
      if (open !== null && !(run[0] === "`" && info.includes("`"))) {
        fence = { marker: run[0] ?? "", length: run.length };
        removedBlocks += 1;
        lines.push("");
        removedLines += 1;
        continue;
      }
    }

    let rest = line;
    let kept = "";
    let touched = false;
    for (;;) {
      if (inComment) {
        touched = true;
        const end = rest.indexOf("-->");
        // Unclosed on this line: nothing of it is kept, the comment goes on.
        if (end === -1) break;
        rest = rest.slice(end + 3);
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
        rest = after;
      }
    }
    lines.push(kept);
    if (touched && BLANK_LINE.test(kept)) removedLines += 1;
  }
  return { text: lines.join("\n"), removedBlocks, lines, removedLines };
}

export interface UnreadKeyLine {
  readonly key: string;
  /** 1-based line number in the body. */
  readonly line: number;
  readonly reason: "indented" | "continues";
}

export interface DoorDeclaration {
  readonly totalLines: number;
  /** totalLines - removedLines: the partition the volume line prints. */
  readonly linesExamined: number;
  readonly removedLines: number;
  readonly removedBlocks: number;
  readonly doorValues: readonly string[];
  readonly secondInstruments: readonly string[];
  readonly originValues: readonly string[];
  readonly unreadKeyLines: readonly UnreadKeyLine[];
}

export function readDoorDeclaration(body: string): DoorDeclaration {
  const { lines, removedBlocks, removedLines } = stripNonDeclarations(body);
  const values: Record<JudgedKey, string[]> = { Door: [], "Second-instrument": [], Origin: [] };
  const unreadKeyLines: UnreadKeyLine[] = [];
  let previousBlank = false;
  let previousDeclaration = false;

  lines.forEach((line, index) => {
    const match = KEY_LINE.exec(line);
    if (match === null) {
      previousBlank = BLANK_LINE.test(line);
      previousDeclaration = false;
      return;
    }
    const indent = match[1] ?? "";
    const key = match[2] ?? "";
    // The flags still describe the line above; read them before moving on.
    const startsBlock = index === 0 || previousBlank || previousDeclaration;
    previousBlank = false;
    if (indent.includes("\t") || indent.length >= 4) {
      unreadKeyLines.push({ key, line: index + 1, reason: "indented" });
      previousDeclaration = false;
      return;
    }
    if (!startsBlock) {
      unreadKeyLines.push({ key, line: index + 1, reason: "continues" });
      previousDeclaration = false;
      return;
    }
    previousDeclaration = true;
    if (key in values) values[key as JudgedKey].push((match[3] ?? "").trim());
  });

  return {
    totalLines: lines.length,
    linesExamined: lines.length - removedLines,
    removedLines,
    removedBlocks,
    doorValues: values.Door,
    secondInstruments: values["Second-instrument"],
    originValues: values.Origin,
    unreadKeyLines,
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
 * True when a source keeps a letter or a digit once HTML tags, `&...;`
 * entities and invisible format characters are removed. An autolink with a
 * host is kept as its URL text; `<https://>` has no host and is a tag.
 */
export function hasVisibleSource(source: string): boolean {
  // Invisible format characters (\p{Cf}, e.g. U+200B) are neither letters nor
  // digits, so the test below already ignores them: no removal step is needed.
  const visible = source
    .replace(AUTOLINK_WITH_HOST, " $1 ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[^\s;&]*;/g, " ");
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
      reason: `Origin: observed source "${source}" is a placeholder or has no letter or digit once tags, entities and invisible characters are removed — name the pull request, issue, path:line or session note`,
    };
  }
  return { ok: true, value: origin, date, source };
}

function unreadNote(declaration: DoorDeclaration, key: JudgedKey): string {
  const unread = declaration.unreadKeyLines.filter((entry) => entry.key === key);
  if (unread.length === 0) return "";
  const described = unread.map((entry) =>
    entry.reason === "indented"
      ? `line ${entry.line} is indented (four or more columns, or a tab: a code block)`
      : `line ${entry.line} continues the line above (a declaration starts the body, follows a blank line, or follows another declaration line)`,
  );
  return `; ${key} line(s) not read: ${described.join("; ")}`;
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
  const { doorValues, secondInstruments } = declaration;
  const implicitTwoWay =
    doorValues.length === 0 && author !== null && IMPLICIT_TWO_WAY_AUTHORS.includes(author);

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
      "no `Door: one-way` or `Door: two-way` line (outside comments and code blocks)" +
        unreadNote(declaration, "Door"),
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
          ? "a one-way door needs a `Second-instrument:` line naming an independent measurement (gate-integrity §3)" +
            unreadNote(declaration, "Second-instrument")
          : `Second-instrument is empty or a placeholder ("${secondInstruments[0]}") — name the instrument and its result, at least ${SECOND_INSTRUMENT_MIN_LENGTH} characters`,
    );
  }

  const { originValues } = declaration;
  const originWaived =
    originValues.length === 0 && author !== null && IMPLICIT_TWO_WAY_AUTHORS.includes(author);
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
      `no \`Origin:\` line (outside comments and code blocks) — one of ${ORIGIN_VOCABULARY}, \`observed\` with its date and source (ADR-0056 D1)` +
        unreadNote(declaration, "Origin"),
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

  report.volume(
    `${declaration.totalLines} description line(s) = ${declaration.linesExamined} examined + ${declaration.removedLines} removed in ${declaration.removedBlocks} comment/code block(s); ` +
      `${doorValues.length} Door line(s), ${secondInstruments.length} Second-instrument line(s), ${originValues.length} Origin line(s); ` +
      `${declaration.unreadKeyLines.length} key line(s) not read` +
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
