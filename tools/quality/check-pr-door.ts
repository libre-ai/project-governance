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
 *   (`<...>`, `n/a`, `none`, `tbd`, `-`). On a two-way door it is optional;
 * - HTML comments and fenced code blocks are removed before reading, so the
 *   template's own guidance, or a quoted example, never counts as a
 *   declaration.
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
 * problem it treats comes from, by exactly one line at the same place as
 * `Door:` — start of line, outside comments and code blocks:
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
 *   calendar date, `YYYY-MM-DD`, that exists on the calendar, then a source
 *   (pull request, issue, `path:line`, session note) that is not a
 *   placeholder. A `<...>` source is a placeholder unless it is an autolink
 *   (`<https://...>`);
 * - `inspection`, `synthetic` and `proposal` carry nothing else on the line,
 *   as a `Door:` value does: `Origin: proposal mostly` is refused (and
 *   `Origin: proposal, mostly` too, `proposal,` being no value). ADR-0056
 *   D1 sends the other origins of a multi-origin problem to the body, not to
 *   the line, and trailing text on the line would be the place where an
 *   `observed` claim slips in without its date. The unfilled template line
 *   `Origin: observed | inspection | synthetic | proposal` is refused by the
 *   same rule (its `observed` carries `|` where the date goes).
 *
 * An author in IMPLICIT_TWO_WAY_AUTHORS writing no Origin line is waived, as
 * for `Door:` — the verdict says so and names no value, because the gate does
 * not know which origin a bot's bump has. An Origin line written by such an
 * author is judged as written. Like `Door:`, this proves a declaration exists,
 * never that it is true.
 *
 * Runs on `pull_request` events (including `edited`, so fixing the
 * description re-runs it). Elsewhere it declares that it judged nothing. On a
 * pull_request run, an event payload that is absent or unreadable is a
 * failure, never an empty body.
 */

export const SECOND_INSTRUMENT_MIN_LENGTH = 12;

/** Accounts whose undeclared pull requests are two-way by construction (version bumps). */
export const IMPLICIT_TWO_WAY_AUTHORS: readonly string[] = ["dependabot[bot]"];

const DOOR_LINE = /^[ \t]*Door:(.*)$/gm;
const SECOND_INSTRUMENT_LINE = /^[ \t]*Second-instrument:(.*)$/gm;
const DOOR_VALUES = new Set(["one-way", "two-way"]);
const PLACEHOLDER = /^(?:<[^>]*>|n\/?a|none|tbd|todo|-+|\.+)$/i;

const ORIGIN_LINE = /^[ \t]*Origin:(.*)$/gm;
/** ADR-0056 D1, closed vocabulary. */
export const ORIGIN_VALUES = ["observed", "inspection", "synthetic", "proposal"] as const;
export type OriginValue = (typeof ORIGIN_VALUES)[number];
const ORIGIN_VALUE_SET: ReadonlySet<string> = new Set(ORIGIN_VALUES);
const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Same placeholders as Second-instrument, except a `<https://...>` autolink,
// which is how markdown writes a bare URL and is a real source.
const SOURCE_PLACEHOLDER = /^(?:<(?!https?:\/\/)[^>]*>|n\/?a|none|tbd|todo|-+|\.+)$/i;

export interface StrippedBody {
  readonly text: string;
  readonly removedBlocks: number;
}

/** Remove HTML comments and fenced code blocks, keeping line count stable. */
export function stripNonDeclarations(body: string): StrippedBody {
  let removedBlocks = 0;
  const blank = (match: string): string => {
    removedBlocks += 1;
    return match.replace(/[^\n]/g, "");
  };
  const text = body
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, blank)
    .replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*$|(?![\s\S]))/gm, blank);
  return { text, removedBlocks };
}

export interface DoorDeclaration {
  readonly linesExamined: number;
  readonly removedBlocks: number;
  readonly doorValues: readonly string[];
  readonly secondInstruments: readonly string[];
  readonly originValues: readonly string[];
}

export function readDoorDeclaration(body: string): DoorDeclaration {
  const { text, removedBlocks } = stripNonDeclarations(body);
  const doorValues = [...text.matchAll(DOOR_LINE)].map((match) => (match[1] ?? "").trim());
  const secondInstruments = [...text.matchAll(SECOND_INSTRUMENT_LINE)].map((match) =>
    (match[1] ?? "").trim(),
  );
  const originValues = [...text.matchAll(ORIGIN_LINE)].map((match) => (match[1] ?? "").trim());
  const linesExamined = text === "" ? 0 : text.split("\n").length;
  return { linesExamined, removedBlocks, doorValues, secondInstruments, originValues };
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

export type OriginJudgement =
  | {
      readonly ok: true;
      readonly value: OriginValue;
      readonly date: string | null;
      readonly source: string | null;
    }
  | { readonly ok: false; readonly reason: string };

const ORIGIN_VOCABULARY = ORIGIN_VALUES.map((value) => `"${value}"`).join(", ");

/** Pure verdict over the text that follows one `Origin:` key. */
export function judgeOrigin(declared: string): OriginJudgement {
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
  const source = sourceTokens.join(" ");
  if (source === "") {
    return {
      ok: false,
      reason: `Origin: observed ${date} needs a source after its date (pull request, issue, path:line, session note)`,
    };
  }
  if (SOURCE_PLACEHOLDER.test(source)) {
    return {
      ok: false,
      reason: `Origin: observed source "${source}" is a placeholder — name the pull request, issue, path:line or session note`,
    };
  }
  return { ok: true, value: origin, date, source };
}

/** Pure verdict over one pull request description. */
export function evaluateDoor(
  body: string,
  label = "pull request description",
  author: string | null = null,
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
      "no `Door: one-way` or `Door: two-way` line (outside comments and code blocks)",
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
          ? "a one-way door needs a `Second-instrument:` line naming an independent measurement (gate-integrity §3)"
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
      `no \`Origin:\` line (outside comments and code blocks) — one of ${ORIGIN_VOCABULARY}, \`observed\` with its date and source (ADR-0056 D1)`,
    );
  } else if (originValues.length > 1) {
    report.check(
      `${label} — Origin`,
      false,
      `${originValues.length} Origin lines (${originValues.map((value) => `"${value}"`).join(", ")}) — declare exactly one`,
    );
  } else {
    const judgement = judgeOrigin(originValues[0] ?? "");
    report.check(
      `${label} — Origin`,
      judgement.ok,
      judgement.ok
        ? `Origin: ${[judgement.value, judgement.date, judgement.source].filter((part) => part !== null).join(" ")}`
        : judgement.reason,
    );
  }

  report.volume(
    `${declaration.linesExamined} description line(s) examined after removing ${declaration.removedBlocks} comment/code block(s); ` +
      `${doorValues.length} Door line(s), ${secondInstruments.length} Second-instrument line(s), ${originValues.length} Origin line(s)` +
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
      concludeGate(gate, evaluateDoor(read.body, label, read.author));
    }
  }
}
