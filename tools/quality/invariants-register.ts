/**
 * The one reader of the invariants register (`docs/decisions/INVARIANTS.md`).
 *
 * Two gates read the register's rows and their standing: the threat-model
 * citations gate and the brick map. Until 2026-11-16 each carried its own
 * expression, and they disagreed on the only retired row the register holds:
 * the brick map read I-35 withdrawn, the citations gate read it in force and
 * printed "0 retired". Its expression ended on `\b` after « Retiré », and a
 * word boundary of a non-Unicode expression never holds between « é » and a
 * space — both are non-word characters to it. Every citation of the withdrawn
 * invariant therefore resolved as live.
 *
 * One reader cannot disagree with itself, so both gates call this one.
 *
 * A row is retired when its invariant cell, emphasis marks aside, is struck
 * through (`~~…`) or opens with the word « Retiré », « Retirée », « Retirés »,
 * « Retirées » or "Retired", in any case. The word must END there: a living
 * invariant that opens with « Retirer une installation… » or "Retirement…"
 * stays in force. The end of the word is tested on Unicode letters, never on
 * `\b`.
 */

export interface RegisterEntry {
  readonly id: string;
  readonly retired: boolean;
}

export interface ParsedRegister {
  readonly entries: ReadonlyMap<string, RegisterEntry>;
  readonly duplicates: readonly string[];
}

const REGISTER_ROW = /^\|\s*(I-[0-9]+)\s*\|(.*)$/;
const RETIRED_CELL = /^[\s*_]*(?:~~|retir(?:ée?s?|ed)(?!\p{L}))/iu;

/** `| I-NN | text … |` rows, in the order written; a repeated id is reported. */
export function parseInvariantsRegister(text: string): ParsedRegister {
  const entries = new Map<string, RegisterEntry>();
  const duplicates: string[] = [];
  for (const line of text.split("\n")) {
    const match = REGISTER_ROW.exec(line);
    if (match === null) continue;
    const id = match[1] ?? "";
    if (entries.has(id)) duplicates.push(id);
    entries.set(id, { id, retired: RETIRED_CELL.test(match[2] ?? "") });
  }
  return { entries, duplicates };
}
