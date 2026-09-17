// A gate reports what it inspected, not only whether it passed.
//
// Every check is recorded — item, verdict, evidence — so a green gate can answer
// *what did you verify*, not only *did you pass*. Violations are derived from the
// failed checks rather than accumulated separately: one list cannot drift from
// the other when there is only one list.
//
// The rule this module exists to enforce: **a gate that asserted nothing fails.**
// Two gates of this repository ran green over zero items. `check-migration-drift`
// (K4 AUTH-05) sent every remaining path through its skip list; then
// `check-specification-lock` emptied its own application list when `docs/apps/`
// stopped existing here (ADR-0020 dispatch). Neither was visible from the exit
// code, because both printed a reassuring sentence and exited 0. Emptiness is now
// a failure unless the gate declares in code why it is legitimate — a declaration
// a reviewer can read, and grep.

export interface GateCheck {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

export type GateOutcome = "pass" | "violations" | "empty";

export class GateReport {
  #checks: GateCheck[] = [];
  #emptyReason: string | null = null;

  /** Record one inspected item. `note` is the evidence, on success as on failure. */
  check(item: string, ok: boolean, note: string): this {
    this.#checks.push({ item, ok, note });
    return this;
  }

  /**
   * Declare that asserting nothing is legitimate here, and why.
   *
   * The reason is printed on the empty run, so the operator reads the
   * justification rather than inferring it from silence.
   */
  allowEmpty(because: string): this {
    this.#emptyReason = because;
    return this;
  }

  get checks(): readonly GateCheck[] {
    return this.#checks;
  }

  /** The failed checks, rendered as `item: note`. Derived, never stored. */
  get violations(): string[] {
    return this.#checks.filter((check) => !check.ok).map((check) => `${check.item}: ${check.note}`);
  }

  get asserted(): number {
    return this.#checks.length;
  }

  get emptyReason(): string | null {
    return this.#emptyReason;
  }

  get outcome(): GateOutcome {
    if (this.violations.length > 0) return "violations";
    if (this.#checks.length === 0 && this.#emptyReason === null) return "empty";
    return "pass";
  }
}

export interface RenderedGate {
  readonly ok: boolean;
  readonly lines: string[];
}

/**
 * Pure rendering, so the wording is testable without spawning a process.
 *
 * A passing gate prints its assertion count; the full list is available behind
 * `GATE_VERBOSE` because a hundred green items in CI is noise, while the count
 * plus the ability to expand is what an operator actually reads. A failing gate
 * always prints every failed check — that output is the reason it failed.
 */
export function renderGateReport(gate: string, report: GateReport, verbose = false): RenderedGate {
  if (report.outcome === "violations") {
    return {
      ok: false,
      lines: [
        ...report.violations.map((violation) => `${gate}: ${violation}`),
        `${gate} failed: ${report.violations.length} of ${report.asserted} assertion(s) did not hold.`,
      ],
    };
  }

  if (report.outcome === "empty") {
    return {
      ok: false,
      lines: [
        `${gate} asserted nothing: the gate ran without inspecting a single item, so its green ` +
          "result carries no evidence. Either its target moved and the gate must follow it, or " +
          "asserting nothing is legitimate here and the gate must say so with allowEmpty(reason).",
      ],
    };
  }

  const summary =
    report.asserted === 0
      ? `${gate} verified nothing, as declared: ${report.emptyReason}`
      : `${gate} verified: ${report.asserted} assertion(s) hold`;
  const detail = verbose ? report.checks.map((check) => `  ${check.item} — ${check.note}`) : [];
  return { ok: true, lines: [summary, ...detail] };
}

/**
 * Render, print, and exit non-zero on failure.
 *
 * The effectful half, kept apart from `renderGateReport` so every wording and
 * every verdict above is unit-tested without a subprocess.
 */
export function concludeGate(gate: string, report: GateReport): void {
  const rendered = renderGateReport(gate, report, Boolean(process.env.GATE_VERBOSE));
  for (const line of rendered.lines) {
    if (rendered.ok) console.log(line);
    else console.error(line);
  }
  if (!rendered.ok) process.exit(1);
}
