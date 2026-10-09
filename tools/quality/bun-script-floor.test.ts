import { describe, expect, test } from "bun:test";
import { findFloorBypasses, floorBypassNote } from "./bun-script-floor";

// The gate required `pretest` to EXIST and to equal the floor command. Both
// manifests of this repository satisfied that while nothing fired the hook:
// the root until 2026-10-08 (f032f23, `check` ended in a bare `bun test`), the
// workspace manifest until 2026-10-09 (`check` was `bun test src`). Existence
// and firing are two assertions, and only the first was ever made.
describe("findFloorBypasses", () => {
  test("a script that reaches the suite with a bare bun test is named", () => {
    expect(findFloorBypasses({ check: "bun test src", test: "bun test src" })).toEqual(["check"]);
  });

  test("the root shape measured before f032f23", () => {
    expect(
      findFloorBypasses({
        check: "bun run check:bun && bun run lint && bun test && bun run check:secret-scan",
        pretest: "bun run check:bun",
        test: "bun test",
      }),
    ).toEqual(["check"]);
  });

  test("reaching it as bun run test is not a bypass", () => {
    expect(
      findFloorBypasses({
        check: "bun run test",
        precheck: "bun run check:bun",
        pretest: "bun run check:bun",
        test: "bun test src",
      }),
    ).toEqual([]);
  });

  test("test is exempt: the hook has already fired when its body runs", () => {
    expect(findFloorBypasses({ test: "bun test" })).toEqual([]);
  });

  test("bunx and a longer binary name are not bun test", () => {
    expect(
      findFloorBypasses({ a: "bunx test-runner", b: "bun testify", c: "bun run tests" }),
    ).toEqual([]);
  });

  test("several bypasses come back sorted, so one manifest reports one way", () => {
    expect(findFloorBypasses({ zeta: "bun test", alpha: "bun  test unit" })).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  test("no scripts, no bypass", () => {
    expect(findFloorBypasses({})).toEqual([]);
  });
});

test("the note says which hook does not fire and what to write instead", () => {
  const note = floorBypassNote("check");
  expect(note).toContain("check");
  expect(note).toContain("pretest");
  expect(note).toContain("bun run test");
});
