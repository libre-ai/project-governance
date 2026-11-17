import { describe, expect, test } from "bun:test";
import {
  guard,
  type Plan,
  type Ports,
  type PushedRef,
  parsePushedRefs,
  parseServedBranch,
  planPush,
  type Runner,
} from "./pre-push-artifact-lifecycle";

// The pre-push guard without git: its stdin contract, the choice of interval
// for each pushed ref, and the verdict. The process tests run it under a real
// `git push` against a fixture remote.

const ZERO = "0".repeat(40);
const LOCAL = "a".repeat(40);
const REMOTE = "b".repeat(40);
const SERVED = "c".repeat(40);
const BASE = "d".repeat(40);

function pushed(localSha: string, remoteSha: string, ref = "refs/heads/feature"): PushedRef {
  return { localRef: ref, localSha, remoteRef: ref, remoteSha };
}

/** Ports over a fixed object store: `commits` exist, `bases` maps "a b" to their merge base. */
function ports(
  options: {
    commits?: readonly string[];
    bases?: Readonly<Record<string, string>>;
    served?: ReturnType<Ports["servedBranch"]>;
    tracking?: Readonly<Record<string, string>>;
  } = {},
): Ports & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    isCommit: (sha) => (options.commits ?? []).includes(sha),
    resolveRef: (ref) => options.tracking?.[ref] ?? null,
    mergeBase: (a, b) => options.bases?.[`${a} ${b}`] ?? null,
    servedBranch: (remote) => {
      asked.push(remote);
      return options.served ?? { ok: false, reason: "no answer" };
    },
  };
}

describe("parsePushedRefs", () => {
  test("reads the four fields of every line git writes", () => {
    const input = `refs/heads/a ${LOCAL} refs/heads/a ${ZERO}\n(delete) ${ZERO} refs/heads/b ${REMOTE}\n`;
    expect(parsePushedRefs(input)).toEqual({
      ok: true,
      refs: [
        { localRef: "refs/heads/a", localSha: LOCAL, remoteRef: "refs/heads/a", remoteSha: ZERO },
        { localRef: "(delete)", localSha: ZERO, remoteRef: "refs/heads/b", remoteSha: REMOTE },
      ],
    });
  });

  test("an empty input is no ref, not an error", () => {
    expect(parsePushedRefs("")).toEqual({ ok: true, refs: [] });
  });

  test("a line that is not four fields with object names is refused with its number", () => {
    expect(parsePushedRefs(`refs/heads/a ${LOCAL} refs/heads/a ${ZERO}\nnonsense\n`)).toEqual({
      ok: false,
      line: 2,
    });
    expect(parsePushedRefs(`refs/heads/a xyz refs/heads/a ${ZERO}\n`)).toEqual({
      ok: false,
      line: 1,
    });
  });
});

describe("parseServedBranch", () => {
  test("reads a served branch that is not called main", () => {
    expect(parseServedBranch(`ref: refs/heads/trunk-served\tHEAD\n${SERVED}\tHEAD\n`)).toEqual({
      ok: true,
      name: "trunk-served",
      sha: SERVED,
    });
  });

  test("a remote without a symbolic HEAD names no served branch", () => {
    expect(parseServedBranch(`${SERVED}\tHEAD\n`).ok).toBe(false);
    expect(parseServedBranch("").ok).toBe(false);
  });
});

describe("planPush", () => {
  test("a deleted ref is skipped without asking anything", () => {
    const p = ports();
    expect(planPush("origin", [pushed(ZERO, REMOTE)], p)).toEqual([
      { kind: "skip", ref: "refs/heads/feature", why: "deleted, nothing to examine" },
    ]);
    expect(p.asked).toEqual([]);
  });

  test("a ref the remote already has is skipped", () => {
    expect(planPush("origin", [pushed(LOCAL, LOCAL)], ports())[0]?.kind).toBe("skip");
  });

  test("a known remote commit: the interval from its merge base with the pushed one", () => {
    const p = ports({ commits: [REMOTE], bases: { [`${REMOTE} ${LOCAL}`]: REMOTE } });
    expect(planPush("origin", [pushed(LOCAL, REMOTE)], p)).toEqual([
      {
        kind: "gate",
        ref: "refs/heads/feature",
        range: `${REMOTE}..${LOCAL}`,
        why: "what the remote does not have",
      },
    ]);
    expect(p.asked).toEqual([]);
  });

  test("a new branch: the interval from the merge base with the served branch, asked to the remote", () => {
    const p = ports({
      commits: [SERVED],
      bases: { [`${SERVED} ${LOCAL}`]: BASE },
      served: { ok: true, name: "trunk-served", sha: SERVED },
    });
    const [plan] = planPush("upstream", [pushed(LOCAL, ZERO)], p);
    expect(plan).toEqual({
      kind: "gate",
      ref: "refs/heads/feature",
      range: `${BASE}..${LOCAL}`,
      why: "from the merge base with the served branch trunk-served",
    });
    expect(p.asked).toEqual(["upstream"]);
  });

  test("a served commit unknown here falls back to the remote-tracking ref of the served branch", () => {
    const p = ports({
      commits: [BASE],
      bases: { [`${BASE} ${LOCAL}`]: BASE },
      served: { ok: true, name: "trunk-served", sha: SERVED },
      tracking: { "refs/remotes/origin/trunk-served": BASE },
    });
    expect(planPush("origin", [pushed(LOCAL, ZERO)], p)[0]).toMatchObject({
      range: `${BASE}..${LOCAL}`,
    });
  });

  test("a remote commit unknown here is measured from the served branch", () => {
    const p = ports({
      commits: [SERVED],
      bases: { [`${SERVED} ${LOCAL}`]: BASE },
      served: { ok: true, name: "trunk-served", sha: SERVED },
    });
    expect(planPush("origin", [pushed(LOCAL, REMOTE)], p)[0]).toMatchObject({
      range: `${BASE}..${LOCAL}`,
    });
  });

  test("no served branch: the whole gate, with the reason", () => {
    expect(planPush("origin", [pushed(LOCAL, ZERO)], ports())).toEqual([
      { kind: "gate", ref: "refs/heads/feature", range: null, why: "no answer: whole gate" },
    ]);
  });

  test("no merge base with the served branch: the whole gate, with the reason", () => {
    const p = ports({ commits: [SERVED], served: { ok: true, name: "trunk-served", sha: SERVED } });
    expect(planPush("origin", [pushed(LOCAL, ZERO)], p)[0]).toEqual({
      kind: "gate",
      ref: "refs/heads/feature",
      range: null,
      why: "no merge base with the served branch trunk-served is known here: whole gate",
    });
  });
});

function runner(
  codes: readonly (number | null)[],
  available = true,
): Runner & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    gateAvailable: () => available,
    runGate: (range, untracked) => {
      calls.push([range, untracked]);
      const index = calls.length - 1;
      const exitCode = index < codes.length ? (codes[index] as number | null) : 0;
      return { exitCode, output: `gate run ${calls.length}\n` };
    },
  };
}

const GATED: Plan = { kind: "gate", ref: "refs/heads/feature", range: "x..y", why: "why" };
const SKIPPED: Plan = { kind: "skip", ref: "refs/heads/old", why: "deleted, nothing to examine" };

describe("guard", () => {
  test("nothing to gate: pass without running the gate", () => {
    const r = runner([1]);
    const outcome = guard([SKIPPED], r, false);
    expect(outcome.exitCode).toBe(0);
    expect(r.calls).toEqual([]);
    expect(outcome.lines.at(-1)).toBe("artifact-lifecycle pre-push: refs=1 examined=0: pass");
  });

  test("the untracked files are examined with the first gated ref only", () => {
    const r = runner([0, 0]);
    expect(guard([GATED, SKIPPED, { ...GATED, range: null }], r, false).exitCode).toBe(0);
    expect(r.calls).toEqual([
      ["x..y", true],
      [null, false],
    ]);
  });

  test("a red gate refuses with the gate's code and names the override", () => {
    const outcome = guard([GATED], runner([1]), false);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.lines).toContain("gate run 1");
    expect(outcome.lines.at(-1)).toContain("push REFUSED (gate exit 1)");
    expect(outcome.lines.at(-1)).toContain("ARTIFACT_LIFECYCLE_ALLOW_PUSH=1");
  });

  test("the most severe code of the gate wins, whatever the order", () => {
    expect(guard([GATED, GATED, GATED], runner([3, 1, 4]), false).exitCode).toBe(4);
    expect(guard([GATED, GATED], runner([3, 2]), false).exitCode).toBe(2);
  });

  test("a gate that cannot start is an unreadable source, exit 2", () => {
    expect(guard([GATED], runner([null]), false).exitCode).toBe(2);
  });

  test("the override lets a red push through and says the CI replays the gate", () => {
    const outcome = guard([GATED], runner([1]), true);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.lines.at(-1)).toContain("OVERRIDE ARTIFACT_LIFECYCLE_ALLOW_PUSH=1 active");
    expect(outcome.lines.at(-1)).toContain("replays the same gate");
  });

  test("a gate that is not found is a skipped gate, printed", () => {
    const outcome = guard([GATED], runner([1], false), false);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.lines.at(-1)).toContain("gate SKIPPED");
    expect(outcome.lines.at(-1)).toContain("CI job");
  });

  test("a ref name holding a line break forges no line", () => {
    const outcome = guard([{ ...SKIPPED, ref: "refs/heads/a\npass" }], runner([]), false);
    // The lines reach git joined by line breaks: count them as git prints them.
    expect(outcome.lines.join("\n").split("\n")).toHaveLength(2);
  });
});
