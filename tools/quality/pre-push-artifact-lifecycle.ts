import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit } from "./git-diff";

// Pre-push guard of the artifact lifecycle gate.
//
// Usage, as a git `pre-push` hook (git runs it from the top of the work tree):
//
//   bun tools/quality/pre-push-artifact-lifecycle.ts <remote> [<url>]
//
// git writes one line per pushed ref on the standard input,
//
//   <local ref> SP <local sha> SP <remote ref> SP <remote sha> LF
//
// and only once: this guard reads them all before judging any. For each ref it
// measures what the remote does not have, and runs check-artifact-lifecycle.ts
// on that interval only, on the tree of the PUSHED commit:
//
//   - a deleted ref (local sha all zeros): nothing to examine;
//   - a ref the remote already has at the same commit: nothing new;
//   - a ref the remote has at a commit known here, sharing history with the
//     pushed one: the interval remote..local;
//   - otherwise (a new branch, or a remote commit unknown here): the interval
//     from the merge base with the branch the remote SERVES, read from the
//     protocol (`git ls-remote --symref <remote> HEAD`), never a written name;
//   - no base found that way: the whole gate, and the reason is printed.
//
// The gate judges the index and the work tree it is given, and `--range` only
// narrows which added paths it judges. The pushed commit is therefore judged
// in a detached temporary worktree of that commit, removed afterwards, unless
// it is the checked-out commit and neither the index nor a tracked file of the
// work tree differs from it: then the work tree is the commit, and the gate
// runs there with its untracked files, examined once. A ref that is not that
// commit is judged without the untracked files of this machine, which belong
// to no pushed commit; when no pushed ref is that commit, the guard prints
// that the untracked files were not examined.
//
// A red gate refuses the push and prints why. ARTIFACT_LIFECYCLE_ALLOW_PUSH=1
// lifts VIOLATIONS only (gate exit 1): the push passes, saying so and saying
// that the CI job (reusable-artifact-lifecycle.yml) replays the same gate; this
// hook is the fast layer, the CI is the layer that enforces. Every other refusal
// blocks the push with its own code, override or not, and says the override
// does not lift it: a refusal of the guard itself (usage, unreadable input, no
// work tree: 2), and of the gate (unreadable source or malformed exemptions
// entry: 2, malformed marker: 4, unevaluable merged() marker: 3, a gate that
// cannot start: 2, a code outside its contract: that code). The gate ranks a
// violation above an unavailable marker, so its exit 1 can hide one: the guard
// reads the gate's counter line and blocks with 3 when it reports one; an exit 1
// without exactly one counter line is an unreadable report, 2. Across refs, a
// code the override cannot lift wins over a violation. A gate that is not found
// is a skipped gate, printed on every push, never silence.
//
// Every line goes to the standard error, which git relays to the pusher.
// Installing the hook is an act of the owner of each work tree; nothing here
// installs it.

const GUARD = "artifact-lifecycle pre-push";
const GATE_FILE = join(import.meta.dir, "check-artifact-lifecycle.ts");
export const OVERRIDE_VARIABLE = "ARTIFACT_LIFECYCLE_ALLOW_PUSH";
const CI_JOB = "reusable-artifact-lifecycle.yml";
const USAGE = `usage: bun tools/quality/pre-push-artifact-lifecycle.ts <remote> [<url>] < refs`;

/** The only gate code the override lifts (check-artifact-lifecycle.ts). */
const VIOLATIONS = 1;
/** Gate codes the override never lifts, most severe first. */
const BLOCKING_PRECEDENCE: readonly number[] = [2, 4, 3];
/** The counter line the gate prints with every verdict it reaches. */
const MARKER_COUNTERS =
  /^markers: total=\d+ valid=\d+ overdue=\d+ unavailable=(\d+) malformed=\d+$/;

export interface PushedRef {
  readonly localRef: string;
  readonly localSha: string;
  readonly remoteRef: string;
  readonly remoteSha: string;
}

const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const isZero = (sha: string): boolean => /^0+$/.test(sha);

/** The lines git writes on the hook's standard input; a failure names the first malformed line. */
export function parsePushedRefs(
  input: string,
):
  | { readonly ok: true; readonly refs: PushedRef[] }
  | { readonly ok: false; readonly line: number } {
  const refs: PushedRef[] = [];
  const lines = input.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const [index, line] of lines.entries()) {
    const fields = line.split(" ");
    const [localRef = "", localSha = "", remoteRef = "", remoteSha = ""] = fields;
    if (
      fields.length !== 4 ||
      localRef === "" ||
      remoteRef === "" ||
      !OBJECT_NAME.test(localSha) ||
      !OBJECT_NAME.test(remoteSha)
    ) {
      return { ok: false, line: index + 1 };
    }
    refs.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return { ok: true, refs };
}

export type ServedBranch =
  | { readonly ok: true; readonly name: string; readonly sha: string | null }
  | { readonly ok: false; readonly reason: string };

/** Pure parse of `git ls-remote --symref <remote> HEAD`. */
export function parseServedBranch(output: string): ServedBranch {
  let name: string | null = null;
  let sha: string | null = null;
  for (const line of output.split("\n")) {
    const symref = /^ref: refs\/heads\/(\S+)\tHEAD$/.exec(line);
    if (symref !== null) name = symref[1] ?? null;
    const head = /^([0-9a-f]{40}|[0-9a-f]{64})\tHEAD$/.exec(line);
    if (head !== null) sha = head[1] ?? null;
  }
  if (name === null) return { ok: false, reason: "the remote names no served branch" };
  return { ok: true, name, sha };
}

export interface Ports {
  /** Whether `sha` names a commit present in the local object store. */
  isCommit(sha: string): boolean;
  /** The commit a local ref points to, or null. */
  resolveRef(ref: string): string | null;
  /** The merge base of two commits, or null when they share no history. */
  mergeBase(a: string, b: string): string | null;
  /** The branch the remote serves, asked to the remote itself. */
  servedBranch(remote: string): ServedBranch;
}

export type Plan =
  | { readonly kind: "skip"; readonly ref: string; readonly why: string }
  | {
      readonly kind: "gate";
      readonly ref: string;
      /** The pushed commit, whose tree is judged. */
      readonly sha: string;
      /** `<base>..<local>`, or null for the whole gate. */
      readonly range: string | null;
      readonly why: string;
    };

/** The base a pushed commit is measured from when the remote ref says nothing usable. */
function servedBase(
  remote: string,
  localSha: string,
  ports: Ports,
): { base: string | null; why: string } {
  const served = ports.servedBranch(remote);
  if (!served.ok) return { base: null, why: `${served.reason}: whole gate` };
  const candidates = [served.sha, ports.resolveRef(`refs/remotes/${remote}/${served.name}`)].filter(
    (sha): sha is string => sha !== null && ports.isCommit(sha),
  );
  for (const candidate of candidates) {
    const base = ports.mergeBase(candidate, localSha);
    if (base !== null) {
      return { base, why: `from the merge base with the served branch ${served.name}` };
    }
  }
  return {
    base: null,
    why: `no merge base with the served branch ${served.name} is known here: whole gate`,
  };
}

/** What to examine for each pushed ref. Pure but for its ports. */
export function planPush(remote: string, refs: readonly PushedRef[], ports: Ports): Plan[] {
  return refs.map((pushed): Plan => {
    const ref = pushed.remoteRef;
    if (isZero(pushed.localSha)) return { kind: "skip", ref, why: "deleted, nothing to examine" };
    if (pushed.localSha === pushed.remoteSha) {
      return { kind: "skip", ref, why: "the remote has it, nothing new" };
    }
    if (!isZero(pushed.remoteSha) && ports.isCommit(pushed.remoteSha)) {
      const base = ports.mergeBase(pushed.remoteSha, pushed.localSha);
      if (base !== null) {
        return {
          kind: "gate",
          ref,
          sha: pushed.localSha,
          range: `${base}..${pushed.localSha}`,
          why: "what the remote does not have",
        };
      }
    }
    const { base, why } = servedBase(remote, pushed.localSha, ports);
    return {
      kind: "gate",
      ref,
      sha: pushed.localSha,
      range: base === null ? null : `${base}..${pushed.localSha}`,
      why,
    };
  });
}

export interface GateRun {
  /** Null: the gate could not be started. */
  readonly exitCode: number | null;
  readonly output: string;
  /** Whether the untracked files of the work tree were part of this run. */
  readonly untrackedExamined: boolean;
}

export interface Runner {
  /** Whether the gate is where this guard expects it. */
  gateAvailable(): boolean;
  /**
   * The gate on the tree of commit `sha`. `untracked` asks for the untracked
   * files of the work tree too; the runner examines them only where the work
   * tree is that commit, and says whether it did.
   */
  runGate(sha: string, range: string | null, untracked: boolean): GateRun;
}

// A ref name is text of the pushing repository: a line break would forge a line.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u{0}-\u{1f}\u{7f}-\u{9f}\u{2028}\u{2029}]/gu;
const printable = (text: string): string => text.replace(CONTROL, "?");

export interface Outcome {
  readonly exitCode: number;
  readonly lines: string[];
}

/**
 * A red verdict. Violations (exit 1): refused with the override named, or let
 * through by it. Any other code: refused with that code, override or not.
 */
function conclude(code: number, override: boolean, say: (text: string) => void): number {
  if (code !== VIOLATIONS) {
    say(
      `push REFUSED (exit ${code}): not a violation; ${OVERRIDE_VARIABLE}=1 lifts violations only (exit 1)${override ? ", it is set and does not apply" : ""}`,
    );
    return code;
  }
  if (override) {
    say(
      `OVERRIDE ${OVERRIDE_VARIABLE}=1 active: push allowed despite exit ${code}; the CI job ${CI_JOB} replays the same gate`,
    );
    return 0;
  }
  say(
    `push REFUSED (gate exit ${code}). Override: ${OVERRIDE_VARIABLE}=1 git push ...; the CI job ${CI_JOB} replays the same gate`,
  );
  return code;
}

/**
 * The codes one gate run stands for. An exit 1 also stands for 3 when the
 * gate's counter line reports an unavailable marker, and for 2 when that line
 * is not there exactly once.
 */
function runCodes(exitCode: number, output: string): number[] {
  if (exitCode !== VIOLATIONS) return [exitCode];
  const counters = output
    .split("\n")
    .map((line) => MARKER_COUNTERS.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  const [only] = counters;
  if (counters.length !== 1 || only === undefined) return [VIOLATIONS, 2];
  return Number(only[1]) > 0 ? [VIOLATIONS, 3] : [VIOLATIONS];
}

/** A refusal of the guard itself (usage, unreadable input): exit 2, never lifted by the override. */
export function refuse(reason: string, override: boolean): Outcome {
  const lines: string[] = [];
  const say = (text: string): void => {
    lines.push(`${GUARD}: ${printable(text)}`);
  };
  say(reason);
  return { exitCode: conclude(2, override, say), lines };
}

/** Run the planned gates, aggregate their codes, apply the override. */
export function guard(plans: readonly Plan[], runner: Runner, override: boolean): Outcome {
  const lines: string[] = [];
  const say = (text: string): void => {
    lines.push(`${GUARD}: ${printable(text)}`);
  };
  for (const plan of plans) say(`${plan.ref}: ${plan.why}`);
  const gated = plans.filter(
    (plan): plan is Extract<Plan, { kind: "gate" }> => plan.kind === "gate",
  );
  if (gated.length === 0) {
    say(`refs=${plans.length} examined=0: pass`);
    return { exitCode: 0, lines };
  }
  if (!runner.gateAvailable()) {
    say(`gate SKIPPED: check-artifact-lifecycle.ts not found; the CI job ${CI_JOB} enforces it`);
    return { exitCode: 0, lines };
  }
  const codes: number[] = [];
  let redRuns = 0;
  // The untracked files belong to the work tree, not to a ref: examined once,
  // with the first ref whose commit the work tree is.
  let untrackedExamined = false;
  for (const plan of gated) {
    const run = runner.runGate(plan.sha, plan.range, !untrackedExamined);
    untrackedExamined ||= run.untrackedExamined;
    lines.push(...run.output.split("\n").filter((line) => line !== ""));
    if (run.exitCode !== 0) redRuns += 1;
    if (run.exitCode === null) {
      say(`${plan.ref}: the gate could not be started`);
      codes.push(2);
      continue;
    }
    const stood = runCodes(run.exitCode, run.output);
    if (stood.includes(3) && run.exitCode === VIOLATIONS) {
      say(`${plan.ref}: exit 1 with an unavailable marker, which the override does not lift`);
    }
    if (stood.includes(2) && run.exitCode === VIOLATIONS) {
      say(`${plan.ref}: exit 1 without exactly one marker counter line: unreadable report`);
    }
    codes.push(...stood);
  }
  if (!untrackedExamined) {
    say(
      "untracked files of the work tree NOT examined: no pushed ref is the checked-out commit with an index and tracked files equal to it",
    );
  }
  // A code the override cannot lift wins over a violation; a code outside the
  // gate's contract is one of them, after the known ones.
  const red =
    BLOCKING_PRECEDENCE.find((code) => codes.includes(code)) ??
    codes.find((code) => code !== 0 && code !== VIOLATIONS) ??
    (codes.includes(VIOLATIONS) ? VIOLATIONS : 0);
  say(`refs=${plans.length} examined=${gated.length} red=${redRuns}`);
  if (red === 0) {
    say("pass");
    return { exitCode: 0, lines };
  }
  return { exitCode: conclude(red, override, say), lines };
}

// ------------------------------------------------------------------ real ports

function gitPorts(root: string): Ports {
  const git = (argv: readonly string[]) => runGit(["-C", root, ...argv]);
  return {
    isCommit: (sha) =>
      git(["cat-file", "-e", "--end-of-options", `${sha}^{commit}`]).exitCode === 0,
    resolveRef: (ref) => {
      const run = git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
      return run.exitCode === 0 ? run.stdout.trim() : null;
    },
    mergeBase: (a, b) => {
      const run = git(["merge-base", "--end-of-options", a, b]);
      return run.exitCode === 0 ? run.stdout.trim() : null;
    },
    servedBranch: (remote) => {
      const run = git(["ls-remote", "--symref", remote, "HEAD"]);
      if (run.exitCode !== 0) return { ok: false, reason: "the remote did not answer ls-remote" };
      return parseServedBranch(run.stdout);
    },
  };
}

// Variables that point git at a repository, an index or a work tree: inherited
// by the gate run in a temporary worktree, they would send it back to this one.
const LOCATING_VARIABLES: ReadonlySet<string> = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
]);

/** Whether the work tree at `root` is commit `sha`: HEAD is it, and no tracked file nor the index differs. */
function workTreeIs(root: string, sha: string): boolean {
  const head = runGit(["-C", root, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  if (head.exitCode !== 0 || head.stdout.trim() !== sha) return false;
  // --no-optional-locks: a status in a hook must not rewrite the index.
  const status = runGit([
    "--no-optional-locks",
    "-C",
    root,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=no",
    "--ignore-submodules=none",
  ]);
  return status.exitCode === 0 && status.stdout === "";
}

function spawnGate(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { readonly exitCode: number | null; readonly output: string } {
  try {
    const result = Bun.spawnSync([process.execPath, GATE_FILE, ...argv], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env },
    });
    const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
    return {
      exitCode: result.exitCode,
      output: `${decode(result.stdout)}${decode(result.stderr)}`,
    };
  } catch {
    return { exitCode: null, output: "" };
  }
}

function gateRunner(root: string, env: Readonly<Record<string, string | undefined>>): Runner {
  return {
    gateAvailable: () => existsSync(GATE_FILE),
    runGate: (sha, range, untracked) => {
      const narrowing = range === null ? [] : ["--range", range];
      if (workTreeIs(root, sha)) {
        const run = spawnGate(
          ["check", root, ...narrowing, ...(untracked ? [] : ["--no-untracked"])],
          env,
        );
        return { ...run, untrackedExamined: untracked };
      }
      // Anything else: a detached worktree of the pushed commit, so the gate
      // reads that commit's tree as its index and work tree. Its hooks are
      // off: checking out a commit to judge it runs nothing of the repository.
      const parent = mkdtempSync(join(tmpdir(), "artifact-lifecycle-pre-push-"));
      const tree = join(parent, "tree");
      try {
        const added = runGit([
          "-C",
          root,
          "-c",
          "core.hooksPath=/dev/null",
          "worktree",
          "add",
          "--quiet",
          "--detach",
          tree,
          sha,
        ]);
        if (added.exitCode !== 0) {
          return {
            exitCode: null,
            output: `${GUARD}: could not check out the pushed commit: ${printable(added.stderr.trim())}\n`,
            untrackedExamined: false,
          };
        }
        const isolated = Object.fromEntries(
          Object.entries(env).filter(([name]) => !LOCATING_VARIABLES.has(name)),
        );
        const run = spawnGate(["check", tree, ...narrowing, "--no-untracked"], isolated);
        return { ...run, untrackedExamined: false };
      } finally {
        runGit(["-C", root, "worktree", "remove", "--force", "--force", tree]);
        rmSync(parent, { recursive: true, force: true });
      }
    },
  };
}

async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  const override = env[OVERRIDE_VARIABLE] === "1";
  const report = (outcome: Outcome): number => {
    console.error(outcome.lines.join("\n"));
    return outcome.exitCode;
  };
  const [remote = ""] = argv;
  // A remote opening with "-" would be read by git as an option.
  if (remote === "" || remote.startsWith("-") || argv.length > 2) {
    return report(refuse(USAGE, override));
  }
  const top = runGit(["rev-parse", "--show-toplevel"]);
  if (top.exitCode !== 0) return report(refuse("not inside a git work tree", override));
  const root = top.stdout.replace(/\n$/, "");
  const parsed = parsePushedRefs(await Bun.stdin.text());
  if (!parsed.ok) {
    return report(refuse(`unexpected line ${parsed.line} on the standard input`, override));
  }
  return report(
    guard(planPush(remote, parsed.refs, gitPorts(root)), gateRunner(root, env), override),
  );
}

if (import.meta.main) process.exit(await main(process.argv.slice(2), process.env));
