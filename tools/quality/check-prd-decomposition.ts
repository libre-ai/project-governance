import type { Fact, LinkPorts } from "./check-work-package-link";
import { concludeGate, GateReport } from "./gate-report";
import {
  atLeast,
  type Criterion,
  type MaturityLevel,
  type Parsed,
  parseCriteria,
  parseWorkPackages,
  type RawDocument,
  readDocumentMaturity,
  readRawLines,
  type WorkPackage,
} from "./prd-model";
import { loadWorkPackagePolicy, type WorkPackagePolicy } from "./work-package-policy";
import { type RunGit, realPorts } from "./work-package-ports";

/**
 * Coverage of an approved PRD by its work-package table, at one commit.
 *
 * The work-package gate (check-work-package-link.ts) judges ONE work package,
 * the one a pull request declares. Nothing judged the decomposition as a
 * whole: a criterion of docs/cahier-des-charges.md that no row of the table
 * of docs/prd.md cites was never reported, and a specification without any
 * criterion read as a valid empty list. This command reads both documents at
 * the commit it is given and reports, in one run:
 *
 * 1. the PRD is approved (docs/specifications/WORK-PACKAGES.md, "Approved
 *    PRD"): the commit is on the branch the repository serves, and the
 *    maturity of the document is at least `approvedFrom`;
 * 2. the specification declares at least one criterion;
 * 3. every declared criterion carries a `Validation :` clause;
 * 4. every declared criterion is cited by at least one row of the table;
 * 5. every criterion a row cites is declared.
 *
 * Read-only: it calls two ports, `readFileAt` and `isAncestorOfServedHead`,
 * and never the issue, the trailers or the diff. An identifier is compared as
 * written, the equality the work-package gate uses: `CA-01` and `CA-1` are
 * two spellings, and a row cites a criterion as the specification writes it.
 *
 * A source that cannot be read (a document absent at the commit, a text
 * outside the alphabet of a PRD, a refused table or criterion, an ancestry
 * that cannot be evaluated) is a violation naming its reason, and the
 * counters that depended on it read `unreadable`, never zero.
 */

const GATE_NAME = "PRD decomposition";
const PRD_PATH = "docs/prd.md";
const REQUIREMENTS_PATH = "docs/cahier-des-charges.md";

/** The policy is trusted data of THIS repository, resolved from the module, never from the checkout. */
const POLICY_PATH: string = `${import.meta.dir}/../../ecosystem/work-package-policy.v1.yaml`;

const USAGE: string =
  "usage: bun tools/quality/check-prd-decomposition.ts <owner>/<repo>@<commit of 40 lowercase hexadecimal characters>";

// The grammar of `PRD-ref` (check-work-package-link.ts, OWNER_SOURCE and
// REPOSITORY_NAME_SOURCE) without its `:docs/prd.md` suffix. Duplicated: that
// module does not export it, and its exports are left as they are.
const ARGUMENT: RegExp =
  /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.{1,2}@)[A-Za-z0-9._-]{1,100})@([0-9a-f]{40})$/;

const UNREADABLE = "unreadable";

/** A PRD at one commit of one repository. */
export interface PrdCommit {
  readonly repo: string;
  readonly sha: string;
}

type DecompositionPorts = Pick<LinkPorts, "readFileAt" | "isAncestorOfServedHead">;

/**
 * The seven counters of the volume line. Every one starts `unreadable` and is
 * set only by the step that measured it, so a step that did not run can never
 * print a zero.
 */
interface Volume {
  criteria: string;
  workPackages: string;
  covered: string;
  uncovered: string;
  withoutValidation: string;
  citedUndeclared: string;
  maturity: string;
}

const renderVolume = (volume: Volume): string =>
  `criteria declared: ${volume.criteria}, work packages read: ${volume.workPackages}, ` +
  `covered: ${volume.covered}, uncovered: ${volume.uncovered}, ` +
  `without validation: ${volume.withoutValidation}, cited undeclared: ${volume.citedUndeclared}, ` +
  `maturity: ${volume.maturity}`;

interface Run {
  readonly report: GateReport;
  readonly label: string;
  readonly volume: Volume;
}

/** Control 1a: the commit is on the branch the repository serves. */
async function checkServed(run: Run, ref: PrdCommit, ports: DecompositionPorts): Promise<void> {
  const item: string = `${run.label} — served branch`;
  const served: Fact<boolean> = await ports.isAncestorOfServedHead(ref.repo, ref.sha);
  if (!served.ok) {
    run.report.check(item, false, `ancestry of the commit unreadable (${served.reason})`);
    return;
  }
  // Strictly `true`: a sloppy port answering "true" or 1 must not read as ancestry.
  const onServedBranch: boolean = served.value === true;
  run.report.check(
    item,
    onServedBranch,
    onServedBranch
      ? `the commit is on the served branch of ${ref.repo}`
      : `the commit is not on the served branch of ${ref.repo}: the PRD is not approved`,
  );
}

/** One document at the commit; unreadable is a violation naming its path and the reason. */
async function readSource(
  run: Run,
  ref: PrdCommit,
  path: string,
  ports: DecompositionPorts,
): Promise<string | null> {
  const file: Fact<string> = await ports.readFileAt(ref.repo, ref.sha, path);
  if (!file.ok) {
    run.report.check(`${run.label} — ${path}`, false, `${path} unreadable (${file.reason})`);
    return null;
  }
  return file.value;
}

/** Control 1b: the maturity of the document is at least the threshold of the policy. */
function checkMaturity(run: Run, prd: RawDocument, floor: MaturityLevel): void {
  const item: string = `${run.label} — maturity`;
  const read: Parsed<MaturityLevel | null> = readDocumentMaturity(prd);
  if (!read.ok) {
    run.report.check(item, false, `${PRD_PATH} unreadable as a PRD (${read.reason})`);
    return;
  }
  const level: MaturityLevel | null = read.value;
  if (level === null) {
    run.volume.maturity = "none";
    run.report.check(
      item,
      false,
      `no \`Maturité du document :\` line gives a level (absent, unknown or contradictory): the PRD is not approved (threshold: ${floor})`,
    );
    return;
  }
  run.volume.maturity = level;
  const approved: boolean = atLeast(level, floor);
  run.report.check(
    item,
    approved,
    approved
      ? `maturity ${level} is at least ${floor}`
      : `maturity ${level} is below ${floor}: the PRD is not approved`,
  );
}

/** The PRD read once: its maturity is judged, its table returned; null when the table cannot be read. */
function readPrd(run: Run, text: string, floor: MaturityLevel): readonly WorkPackage[] | null {
  const item: string = `${run.label} — ${PRD_PATH}`;
  const read: Parsed<RawDocument> = readRawLines(text);
  if (!read.ok) {
    run.report.check(item, false, `${PRD_PATH} unreadable as a PRD (${read.reason})`);
    return null;
  }
  checkMaturity(run, read.value, floor);
  const table: Parsed<readonly WorkPackage[]> = parseWorkPackages(read.value);
  if (!table.ok) {
    run.report.check(item, false, `work-package table of ${PRD_PATH} unreadable (${table.reason})`);
    return null;
  }
  run.volume.workPackages = String(table.value.length);
  return table.value;
}

/** `CA-2` before `CA-10`: by number, without converting digits of any length to a float. */
function byNumber(left: Criterion, right: Criterion): number {
  const leftDigits: string = left.id.slice(3).replace(/^0+(?=\d)/, "");
  const rightDigits: string = right.id.slice(3).replace(/^0+(?=\d)/, "");
  if (leftDigits.length !== rightDigits.length) return leftDigits.length - rightDigits.length;
  if (leftDigits !== rightDigits) return leftDigits < rightDigits ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Controls 2 and 3: at least one criterion, each with its clause. Null when the criteria cannot be read. */
function readCriteria(run: Run, text: string): readonly Criterion[] | null {
  const item: string = `${run.label} — ${REQUIREMENTS_PATH}`;
  const parsed: Parsed<readonly Criterion[]> = parseCriteria(text);
  if (!parsed.ok) {
    run.report.check(item, false, `${REQUIREMENTS_PATH} unreadable as criteria (${parsed.reason})`);
    return null;
  }
  const criteria: readonly Criterion[] = [...parsed.value].sort(byNumber);
  run.volume.criteria = String(criteria.length);
  // The reader answers an empty list for a document without a criterion bullet
  // (the work-package gate depends on that); the emptiness is judged here.
  const declaresSome: boolean = criteria.length > 0;
  run.report.check(
    item,
    declaresSome,
    declaresSome
      ? `${criteria.length} criterion(s) declared`
      : `${REQUIREMENTS_PATH} declares no criterion: there is nothing a work package could cover`,
  );
  let withoutValidation: number = 0;
  for (const criterion of criteria) {
    if (!criterion.hasValidation) withoutValidation += 1;
    run.report.check(
      `${run.label} — ${criterion.id} validation`,
      criterion.hasValidation,
      criterion.hasValidation
        ? `declared at line ${criterion.line} with a \`Validation :\` clause`
        : `declared at line ${criterion.line} without a \`Validation :\` clause`,
    );
  }
  run.volume.withoutValidation = String(withoutValidation);
  return criteria;
}

/** Control 4: every declared criterion is cited, as written, by at least one row. */
function checkCoverage(
  run: Run,
  criteria: readonly Criterion[],
  table: readonly WorkPackage[],
): void {
  let coveredCount: number = 0;
  for (const criterion of criteria) {
    const citing: readonly string[] = table
      .filter((row: WorkPackage): boolean => row.criteria.includes(criterion.id))
      .map((row: WorkPackage): string => row.id);
    const covered: boolean = citing.length > 0;
    if (covered) coveredCount += 1;
    run.report.check(
      `${run.label} — ${criterion.id} coverage`,
      covered,
      covered
        ? `cited by ${citing.join(", ")}`
        : `declared at line ${criterion.line}, cited by no row of the work-package table`,
    );
  }
  run.volume.covered = String(coveredCount);
  run.volume.uncovered = String(criteria.length - coveredCount);
}

/** Control 5: every criterion a row cites is declared, as written, by the specification. */
function checkCitations(
  run: Run,
  criteria: readonly Criterion[],
  table: readonly WorkPackage[],
): void {
  let undeclared: number = 0;
  for (const row of table) {
    // A row citing one criterion twice is one citation.
    for (const cited of new Set<string>(row.criteria)) {
      const criterion: Criterion | undefined = criteria.find(
        (candidate: Criterion): boolean => candidate.id === cited,
      );
      const declared: boolean = criterion !== undefined;
      if (!declared) undeclared += 1;
      run.report.check(
        `${run.label} — ${row.id} cites ${cited}`,
        declared,
        criterion !== undefined
          ? `declared at line ${criterion.line}`
          : `${REQUIREMENTS_PATH} does not declare it`,
      );
    }
  }
  run.volume.citedUndeclared = String(undeclared);
}

/**
 * The five controls over the two documents at `ref`. Every control that can
 * run does: an unapproved PRD still has its coverage reported, so one run
 * names every fault.
 */
export async function evaluatePrdDecomposition(
  ref: PrdCommit,
  floor: MaturityLevel,
  ports: DecompositionPorts,
): Promise<GateReport> {
  const run: Run = {
    report: new GateReport(),
    label: `PRD ${ref.repo}@${ref.sha}`,
    volume: {
      criteria: UNREADABLE,
      workPackages: UNREADABLE,
      covered: UNREADABLE,
      uncovered: UNREADABLE,
      withoutValidation: UNREADABLE,
      citedUndeclared: UNREADABLE,
      maturity: UNREADABLE,
    },
  };
  await checkServed(run, ref, ports);
  const prdText: string | null = await readSource(run, ref, PRD_PATH, ports);
  const requirementsText: string | null = await readSource(run, ref, REQUIREMENTS_PATH, ports);
  const table: readonly WorkPackage[] | null =
    prdText === null ? null : readPrd(run, prdText, floor);
  const criteria: readonly Criterion[] | null =
    requirementsText === null ? null : readCriteria(run, requirementsText);
  if (criteria !== null && table !== null) {
    checkCoverage(run, criteria, table);
    checkCitations(run, criteria, table);
  }
  return run.report.volume(renderVolume(run.volume));
}

/** The controls with the threshold read from the text of the policy; an unreadable policy is a violation. */
export async function evaluateWithPolicyText(
  ref: PrdCommit,
  policyText: string,
  ports: DecompositionPorts,
): Promise<GateReport> {
  const policy: Parsed<WorkPackagePolicy> = loadWorkPackagePolicy(policyText);
  if (!policy.ok) {
    return new GateReport().check(
      "policy",
      false,
      `work-package policy unreadable: ${policy.reason}`,
    );
  }
  return evaluatePrdDecomposition(ref, policy.value.approvedFrom, ports);
}

/** The single argument `<owner>/<repo>@<40 hex>`, or why the command line is refused. */
export function readArguments(argv: readonly string[]): Parsed<PrdCommit> {
  if (argv.length !== 1) {
    return { ok: false, reason: `expected exactly one argument, got ${argv.length}` };
  }
  const match: RegExpExecArray | null = ARGUMENT.exec(argv[0] ?? "");
  if (match === null) {
    // The argument is not echoed: it is text from outside.
    return { ok: false, reason: "the argument is not <owner>/<repo>@<full lowercase commit>" };
  }
  return { ok: true, value: { repo: match[1] ?? "", sha: match[2] ?? "" } };
}

type Environment = Readonly<Record<string, string | undefined>>;

export type CommandOutcome =
  | { readonly kind: "usage"; readonly reason: string }
  | { readonly kind: "report"; readonly report: GateReport };

/**
 * The command: arguments first, so a refused command line reads nothing (no
 * file, no git); then the policy of this repository, then the real ports with
 * the working copy as the place the two documents are read from.
 */
export async function runCommand(
  argv: readonly string[],
  env: Environment,
  workspace: string,
  run?: RunGit,
): Promise<CommandOutcome> {
  const ref: Parsed<PrdCommit> = readArguments(argv);
  if (!ref.ok) {
    return { kind: "usage", reason: ref.reason };
  }
  let policyText: string;
  try {
    policyText = await Bun.file(POLICY_PATH).text();
  } catch (error) {
    const message: string = error instanceof Error ? error.message : String(error);
    return {
      kind: "report",
      report: new GateReport().check(
        "policy",
        false,
        `work-package policy unreadable at ${POLICY_PATH} (${message})`,
      ),
    };
  }
  const token: string | undefined = env.GITHUB_TOKEN;
  const ports: LinkPorts = realPorts({
    token: token === undefined || token === "" ? null : token,
    workspace,
    prRepo: ref.value.repo,
    env,
    ...(run === undefined ? {} : { run }),
  });
  return { kind: "report", report: await evaluateWithPolicyText(ref.value, policyText, ports) };
}

if (import.meta.main) {
  const outcome: CommandOutcome = await runCommand(Bun.argv.slice(2), process.env, process.cwd());
  if (outcome.kind === "usage") {
    console.error(`${GATE_NAME}: ${outcome.reason}`);
    console.error(USAGE);
    process.exit(2);
  }
  // A failing gate prints its violations only; the volume says what was read.
  if (outcome.report.outcome !== "pass" && outcome.report.volumeSummary !== null) {
    console.error(`${GATE_NAME} examined: ${outcome.report.volumeSummary}`);
  }
  concludeGate(GATE_NAME, outcome.report);
}
