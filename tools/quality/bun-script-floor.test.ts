import { describe, expect, test } from "bun:test";
import {
  enforcesFloorFirst,
  FLOOR_HOOK,
  findFloorBypasses,
  findNestedHookViolations,
  findRootFloorViolations,
  floorBypassNote,
} from "./bun-script-floor";

const ROOT = "check:bun:runtime";
const NESTED = "check:bun";

// The gate required `pretest` to EXIST and to equal the floor command. Both
// manifests of this repository satisfied that while nothing fired the hook:
// the root until 2026-10-08 (f032f23, `check` ended in a bare `bun test`), the
// workspace manifest until 2026-10-09 (`check` was `bun test src`). Existence
// and firing are two assertions, and only the first was ever made.
describe("findFloorBypasses", () => {
  test("a script that reaches the suite with a bare bun test is named", () => {
    expect(findFloorBypasses({ check: "bun test src", test: "bun test src" }, ROOT)).toEqual([
      "check",
    ]);
  });

  test("the root shape measured before f032f23", () => {
    expect(
      findFloorBypasses(
        {
          check: "bun run check:bun && bun run lint && bun test && bun run check:secret-scan",
          pretest: "bun run check:bun",
          test: "bun test",
        },
        ROOT,
      ),
    ).toEqual(["check"]);
  });

  test("reaching it as bun run test is not a bypass", () => {
    expect(
      findFloorBypasses(
        {
          check: "bun run test",
          precheck: "bun run check:bun",
          pretest: "bun run check:bun",
          test: "bun test src",
        },
        ROOT,
      ),
    ).toEqual([]);
  });

  test("test is exempt: the hook has already fired when its body runs", () => {
    expect(findFloorBypasses({ test: "bun test" }, ROOT)).toEqual([]);
  });

  test("bunx and a longer binary name are not bun test", () => {
    expect(
      findFloorBypasses({ a: "bunx test-runner", b: "bun testify", c: "bun run tests" }, ROOT),
    ).toEqual([]);
  });

  test("several bypasses come back sorted, so one manifest reports one way", () => {
    expect(findFloorBypasses({ zeta: "bun test", alpha: "bun  test unit" }, ROOT)).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  test("no scripts, no bypass", () => {
    expect(findFloorBypasses({}, ROOT)).toEqual([]);
  });
});

// Owner decision 2026-10-09: the floor run first, chained only by `&&`,
// enforces it as surely as the hook — the suite cannot run unless it passed.
describe("floor run first", () => {
  test("accepted: the runtime floor is the first command, chained by &&", () => {
    expect(
      findFloorBypasses({ "check:unit": "bun run check:bun:runtime && bun test src" }, ROOT),
    ).toEqual([]);
  });

  test("refused: a bare bun test with no floor at all", () => {
    expect(findFloorBypasses({ "check:unit": "bun test src" }, ROOT)).toEqual(["check:unit"]);
  });

  test("refused: the floor after another command", () => {
    expect(
      findFloorBypasses(
        { "check:unit": "bun run lint && bun run check:bun:runtime && bun test src" },
        ROOT,
      ),
    ).toEqual(["check:unit"]);
  });

  test("refused: the floor only in an || branch", () => {
    expect(
      findFloorBypasses(
        {
          a: "bun test src || bun run check:bun:runtime",
          b: "bun run check:bun:runtime || bun test src",
          c: "bun run check:bun:runtime && bun run lint || bun test src",
        },
        ROOT,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  test("refused: a sequence that runs the suite whether or not the floor passed", () => {
    expect(
      findFloorBypasses(
        {
          semicolon: "bun run check:bun:runtime && bun run lint; bun test src",
          background: "bun run check:bun:runtime & bun test src",
          later: "bun run check:bun:runtime && bun run lint & bun test src",
          newline: "bun run check:bun:runtime && true\nbun test src",
        },
        ROOT,
      ),
    ).toEqual(["background", "later", "newline", "semicolon"]);
  });

  test("refused: a floor name the manifest kind does not bind", () => {
    // At the root the runtime floor is check:bun:runtime; check:bun there is
    // the f032f23 shape, which must stay refused.
    expect(findFloorBypasses({ x: "bun run check:bun && bun test src" }, ROOT)).toEqual(["x"]);
    expect(findFloorBypasses({ x: "bun run check:bun:runtime && bun test src" }, NESTED)).toEqual([
      "x",
    ]);
    expect(findFloorBypasses({ x: "bun run check:bun && bun test src" }, NESTED)).toEqual([]);
  });

  test("refused: a near-miss spelling of the floor", () => {
    expect(
      findFloorBypasses(
        {
          a: "bun run check:bun:runtimes && bun test",
          b: "bun run check:bun:runtime &&bun test",
          c: " bun run check:bun:runtime && bun test",
        },
        ROOT,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  test("a pipe after the floor keeps the suite behind it", () => {
    expect(enforcesFloorFirst("bun run check:bun:runtime && bun test | tee out.txt", ROOT)).toBe(
      true,
    );
  });
});

// The scripts that turned red under generation N (2026-10-09), read from the
// served branches. All start with the root runtime floor and chain by `&&`.
const MEASURED_FLOOR_FIRST: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "execution-continuity-evaluator": {
    "check:review-tools":
      "bun run check:bun:runtime && bun install --cwd tools/review --frozen-lockfile && bun test --cwd tools/review",
    "check:capabilities":
      "bun run check:bun:runtime && bun test verification/agent-orchestrator/capability-boundary.test.ts",
    "check:authorized-execution-authority":
      "bun run check:bun:runtime && bun test tools/quality/authorized-execution-authority.test.ts",
    "check:rust-coverage-config":
      "bun run check:bun:runtime && bun test tools/quality/rust-coverage-gate.test.ts",
    "check:pattern-catalog":
      "bun run check:bun:runtime && cd tools/quality/pattern-catalog-coverage && bun test --coverage ../orchestration-pattern-catalog.test.ts && cd ../../.. && bun tools/quality/orchestration-pattern-catalog.ts",
    test: "cargo test --locked",
  },
  "execution-sandbox": {
    "check:capabilities":
      "bun run check:bun:runtime && bun test verification/agent-harness/capability-boundary.test.ts",
    "check:contract-fixtures":
      "bun run check:bun:runtime && bun test verification/agent-harness/contract-fixtures.test.ts verification/agent-harness/sdk-input-pin.test.ts && bun verification/agent-harness/check-contract-fixtures.ts",
    "check:linux-e2e-gate":
      "bun run check:bun:runtime && bun test verification/agent-harness/linux-e2e-gate.test.ts",
    "check:coverage-gate":
      "bun run check:bun:runtime && bun test verification/agent-harness/coverage-gate.test.ts",
    test: "cargo test --locked",
  },
  "ai-model-policy": {
    "check:app":
      "bun run check:bun:runtime && bun test --cwd packages/policy-core-ref && bun test --cwd apps/model-policy",
  },
  "ai-work-supervision": {
    "check:app":
      "bun run check:bun:runtime && bun test --cwd apps/missions && bun test --cwd apps/specifications && bun test --cwd packages/auth-web",
  },
  "learning-session-facilitation": {
    "check:app": "bun run check:bun:runtime && bun test --cwd apps/sessions",
  },
  "personal-knowledge-workspace (before #8)": {
    "check:app": "bun run check:bun:runtime && bun test --cwd apps/notebook",
  },
};

describe("measured fleet scripts", () => {
  for (const [repository, scripts] of Object.entries(MEASURED_FLOOR_FIRST)) {
    test(`${repository}: every bun test script is accepted`, () => {
      expect(findFloorBypasses(scripts, ROOT)).toEqual([]);
    });
  }

  test("the measured set is the size it was measured at", () => {
    const scriptCount = Object.values(MEASURED_FLOOR_FIRST)
      .flatMap((scripts) => Object.keys(scripts))
      .filter((name) => name !== "test").length;
    expect(scriptCount).toBe(13);
  });
});

test("the note says which hook does not fire and both ways to fix it", () => {
  const note = floorBypassNote("check", ROOT);
  expect(note).toContain("check");
  expect(note).toContain("pretest");
  expect(note).toContain("bun run test");
  expect(note).toContain("bun run check:bun:runtime");
  expect(note).toContain("&&");
});

// Adversarial review of PR #55 (2026-10-09): each of these ran the suite
// after a failed floor while the gate passed. Quotes and backslashes are
// normalised away and options before `test` tolerated before detection.
describe("bun test however it is spelled", () => {
  const spellings: Readonly<Record<string, string>> = {
    quoted: 'bun "test" src',
    single: "bun 'test'",
    "split-test": "bun t''est",
    "split-bun": "b''un test",
    backslash: "bun te\\st",
    smol: "bun --smol test",
    "bun-bun": "bun --bun test",
    "several-options": "bun --smol --bun -c=x test",
  };

  test("every spelling is detected as bun test", () => {
    expect(findFloorBypasses(spellings, NESTED)).toEqual(Object.keys(spellings).sort());
  });

  test("still not bun test: bun run test, bunx, a longer word, an option value apart", () => {
    expect(
      findFloorBypasses(
        { a: "bun run test", b: "bunx test", c: "bun testify", d: 'bun "run" test' },
        NESTED,
      ),
    ).toEqual([]);
  });

  test("a carriage return is a line break, so it breaks the && chain", () => {
    expect(enforcesFloorFirst("bun run check:bun:runtime && true\rbun test", ROOT)).toBe(false);
  });
});

describe("findRootFloorViolations", () => {
  const names = (scripts: Record<string, string>) =>
    findRootFloorViolations(scripts).map((violation) => violation.script);

  test("c00-c05: a suite behind || after the floor is refused however spelled", () => {
    const attacks = {
      c00: "bun run check:bun:runtime && false || bun test",
      c01: 'bun run check:bun:runtime && false || bun "test"',
      c02: "bun run check:bun:runtime && false || bun --smol test",
      c03: "bun run check:bun:runtime && false || bun t''est",
      c04: "bun run check:bun:runtime && false || b''un test",
      c05: "bun run check:bun:runtime && false || $(echo bun) test",
    };
    expect(names(attacks)).toEqual(Object.keys(attacks));
  });

  test("the floor first, chained by &&, is accepted", () => {
    expect(names({ "check:unit": "bun run check:bun:runtime && bun test src" })).toEqual([]);
  });

  test("presuite with nothing declared as suite is an ordinary script", () => {
    expect(names({ presuite: "bun --smol test probe" })).toEqual(["presuite"]);
    expect(names({ presuite: "bun run check:bun:runtime && bun test probe" })).toEqual([]);
  });

  test("the hook of a declared script is exempt only at its exact value", () => {
    const lint = "bun run check:bun:runtime && biome ci .";
    expect(names({ lint, prelint: FLOOR_HOOK })).toEqual([]);
    expect(names({ lint, prelint: "bun test probe" })).toEqual(["prelint"]);
    expect(names({ lint, prelint: `${FLOOR_HOOK} && bun test probe` })).toEqual(["prelint"]);
    expect(names({ test: "bun test", pretest: FLOOR_HOOK })).toEqual([]);
  });

  test("a hook on the floor scripts themselves is refused: it would recurse", () => {
    expect(
      names({
        "check:bun:runtime": "bun tools/quality/check-bun-minimum.ts",
        "precheck:bun:runtime": FLOOR_HOOK,
        "check:bun": "bun run check:bun:runtime && bun tools/quality/check-bun-manifests.ts",
        "precheck:bun": FLOOR_HOOK,
      }),
    ).toEqual(["precheck:bun", "precheck:bun:runtime"]);
  });

  test("check, build and check:toolchain chain only by && after check:bun", () => {
    expect(
      names({
        check: "bun run check:bun && bun run lint",
        build: "bun run check:bun && false || bun run x",
        "check:toolchain": "bun run check:bun:runtime && bun x.ts",
      }),
    ).toEqual(["build", "check:toolchain"]);
  });

  test("the floor scripts and test are bound elsewhere, by exact value", () => {
    expect(
      names({ "check:bun:runtime": "anything", "check:bun": "anything", test: "anything" }),
    ).toEqual([]);
  });
});

describe("findNestedHookViolations", () => {
  const names = (scripts: Record<string, string>) =>
    findNestedHookViolations(scripts).map((violation) => violation.script);

  test("every script needs its hook", () => {
    expect(names({ "check:bun": "bun x.ts", test: "bun test", check: "bun run test" })).toEqual([
      "precheck",
      "pretest",
    ]);
  });

  test("presuite with nothing declared as suite needs a hook of its own", () => {
    expect(names({ "check:bun": "bun x.ts", presuite: "bun test" })).toEqual(["prepresuite"]);
  });

  test("a declared hook is exactly the floor, reported once", () => {
    expect(names({ test: "bun test", pretest: "bun test probe" })).toEqual(["pretest"]);
    expect(names({ test: "bun test", pretest: FLOOR_HOOK })).toEqual([]);
  });

  test("a hook on check:bun is refused: it would recurse", () => {
    expect(names({ "check:bun": "bun x.ts", "precheck:bun": FLOOR_HOOK })).toEqual([
      "precheck:bun",
    ]);
  });
});
