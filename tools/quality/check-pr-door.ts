import { concludeGate, GateReport } from "./gate-report";

/**
 * Door gate — every pull request declares whether the change it carries can
 * be walked back, and a one-way change names its second instrument.
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
 * Runs on `pull_request` events (including `edited`, so fixing the
 * description re-runs it). Elsewhere it declares that it judged nothing. On a
 * pull_request run, an event payload that is absent or unreadable is a
 * failure, never an empty body.
 */

export const SECOND_INSTRUMENT_MIN_LENGTH = 12;

const DOOR_LINE = /^[ \t]*Door:(.*)$/gm;
const SECOND_INSTRUMENT_LINE = /^[ \t]*Second-instrument:(.*)$/gm;
const DOOR_VALUES = new Set(["one-way", "two-way"]);
const PLACEHOLDER = /^(?:<[^>]*>|n\/?a|none|tbd|todo|-+|\.+)$/i;

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
}

export function readDoorDeclaration(body: string): DoorDeclaration {
  const { text, removedBlocks } = stripNonDeclarations(body);
  const doorValues = [...text.matchAll(DOOR_LINE)].map((match) => (match[1] ?? "").trim());
  const secondInstruments = [...text.matchAll(SECOND_INSTRUMENT_LINE)].map((match) =>
    (match[1] ?? "").trim(),
  );
  const linesExamined = text === "" ? 0 : text.split("\n").length;
  return { linesExamined, removedBlocks, doorValues, secondInstruments };
}

function isSubstantive(value: string): boolean {
  return value.length >= SECOND_INSTRUMENT_MIN_LENGTH && !PLACEHOLDER.test(value);
}

/** Pure verdict over one pull request description. */
export function evaluateDoor(body: string, label = "pull request description"): GateReport {
  const report = new GateReport();
  const declaration = readDoorDeclaration(body);
  const { doorValues, secondInstruments } = declaration;

  if (doorValues.length === 0) {
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

  report.volume(
    `${declaration.linesExamined} description line(s) examined after removing ${declaration.removedBlocks} comment/code block(s); ` +
      `${doorValues.length} Door line(s), ${secondInstruments.length} Second-instrument line(s)`,
  );
  return report;
}

export type EventRead =
  | { readonly ok: true; readonly number: number | null; readonly body: string }
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
  const record = pullRequest as { number?: unknown; body?: unknown };
  const body = record.body;
  if (body !== null && body !== undefined && typeof body !== "string") {
    return { ok: false, reason: "pull_request.body is neither a string nor null" };
  }
  return {
    ok: true,
    number: typeof record.number === "number" ? record.number : null,
    body: body ?? "",
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
      concludeGate(gate, evaluateDoor(read.body, label));
    }
  }
}
