import { existsSync } from "node:fs";
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
// on that interval only, plus the untracked files of the work tree:
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
// A red gate refuses the push (exit: the code of the gate) and prints how to
// override. ARTIFACT_LIFECYCLE_ALLOW_PUSH=1 lets a red push through, saying so
// and saying that the CI job (reusable-artifact-lifecycle.yml) replays the same
// gate: this hook is the fast layer, the CI is the layer that enforces. A gate
// that cannot run is a skipped gate, printed on every push, never silence.
//
// Every line goes to the standard error, which git relays to the pusher.
// Installing the hook is an act of the owner of each work tree; nothing here
// installs it.

const GUARD = "artifact-lifecycle pre-push";
const GATE_FILE = join(import.meta.dir, "check-artifact-lifecycle.ts");
export const OVERRIDE_VARIABLE = "ARTIFACT_LIFECYCLE_ALLOW_PUSH";
const CI_JOB = "reusable-artifact-lifecycle.yml";
const USAGE = `usage: bun tools/quality/pre-push-artifact-lifecycle.ts <remote> [<url>] < refs`;

/** Exit codes of the gate, most severe first (check-artifact-lifecycle.ts). */
const GATE_PRECEDENCE: readonly number[] = [2, 4, 1, 3];

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
          range: `${base}..${pushed.localSha}`,
          why: "what the remote does not have",
        };
      }
    }
    const { base, why } = servedBase(remote, pushed.localSha, ports);
    return { kind: "gate", ref, range: base === null ? null : `${base}..${pushed.localSha}`, why };
  });
}

export interface GateRun {
  /** Null: the gate could not be started. */
  readonly exitCode: number | null;
  readonly output: string;
}

export interface Runner {
  /** Whether the gate is where this guard expects it. */
  gateAvailable(): boolean;
  runGate(range: string | null, untracked: boolean): GateRun;
}

// A ref name is text of the pushing repository: a line break would forge a line.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u{0}-\u{1f}\u{7f}-\u{9f}\u{2028}\u{2029}]/gu;
const printable = (text: string): string => text.replace(CONTROL, "?");

export interface Outcome {
  readonly exitCode: number;
  readonly lines: string[];
}

/** Run the planned gates, aggregate their codes, apply the override. */
export function guard(plans: readonly Plan[], runner: Runner, override: boolean): Outcome {
  const lines: string[] = [];
  const say = (text: string): void => {
    lines.push(`${GUARD}: ${printable(text)}`);
  };
  for (const plan of plans) say(`${plan.ref}: ${plan.why}`);
  const gated = plans.filter((plan) => plan.kind === "gate");
  if (gated.length === 0) {
    say(`refs=${plans.length} examined=0: pass`);
    return { exitCode: 0, lines };
  }
  if (!runner.gateAvailable()) {
    say(`gate SKIPPED: check-artifact-lifecycle.ts not found; the CI job ${CI_JOB} enforces it`);
    return { exitCode: 0, lines };
  }
  const codes: number[] = [];
  for (const [index, plan] of gated.entries()) {
    // The untracked files belong to the work tree, not to a ref: examined once.
    const run = runner.runGate(plan.range, index === 0);
    lines.push(...run.output.split("\n").filter((line) => line !== ""));
    if (run.exitCode === null) {
      say(`${plan.ref}: the gate could not be started`);
      codes.push(2);
    } else codes.push(run.exitCode);
  }
  // A code outside the gate's contract is red too, after the known ones.
  const red =
    GATE_PRECEDENCE.find((code) => codes.includes(code)) ?? codes.find((code) => code !== 0) ?? 0;
  say(
    `refs=${plans.length} examined=${gated.length} red=${codes.filter((code) => code !== 0).length}`,
  );
  if (red === 0) {
    say("pass");
    return { exitCode: 0, lines };
  }
  if (override) {
    say(
      `OVERRIDE ${OVERRIDE_VARIABLE}=1 active: push allowed despite exit ${red}; the CI job ${CI_JOB} replays the same gate`,
    );
    return { exitCode: 0, lines };
  }
  say(
    `push REFUSED (gate exit ${red}). Override: ${OVERRIDE_VARIABLE}=1 git push ...; the CI job ${CI_JOB} replays the same gate`,
  );
  return { exitCode: red, lines };
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

function gateRunner(root: string, env: Readonly<Record<string, string | undefined>>): Runner {
  return {
    gateAvailable: () => existsSync(GATE_FILE),
    runGate: (range, untracked) => {
      const argv = ["check", root];
      if (range !== null) argv.push("--range", range);
      if (!untracked) argv.push("--no-untracked");
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
    },
  };
}

async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  const [remote = ""] = argv;
  // A remote opening with "-" would be read by git as an option.
  if (remote === "" || remote.startsWith("-") || argv.length > 2) {
    console.error(`${GUARD}: ${USAGE}`);
    return 2;
  }
  const top = runGit(["rev-parse", "--show-toplevel"]);
  if (top.exitCode !== 0) {
    console.error(`${GUARD}: not inside a git work tree`);
    return 2;
  }
  const root = top.stdout.replace(/\n$/, "");
  const parsed = parsePushedRefs(await Bun.stdin.text());
  if (!parsed.ok) {
    console.error(`${GUARD}: unexpected line ${parsed.line} on the standard input`);
    return 2;
  }
  const outcome = guard(
    planPush(remote, parsed.refs, gitPorts(root)),
    gateRunner(root, env),
    env[OVERRIDE_VARIABLE] === "1",
  );
  console.error(outcome.lines.join("\n"));
  return outcome.exitCode;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2), process.env));
