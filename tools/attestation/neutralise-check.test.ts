import { describe, expect, test } from "bun:test";

import { markers, neutralise } from "./neutralise-check";

describe("neutralise", () => {
  test("forces the whole condition to false, `||` included, and leaves the rest alone", () => {
    const source = ["// neutralise:a", "if (x === 1 || y(2)) flag();", "if (z) other();", ""].join(
      "\n",
    );
    expect(neutralise(source, "a")).toBe(
      ["// neutralise:a", "if (false && (x === 1 || y(2))) flag();", "if (z) other();", ""].join(
        "\n",
      ),
    );
  });

  test("handles an `else if` and a condition that spans lines", () => {
    const source = ["// neutralise:b", "} else if (", "  p ||", "  q", ") r();", ""].join("\n");
    expect(neutralise(source, "b")).toBe(
      ["// neutralise:b", "} else if (false && (", "  p ||", "  q", ")) r();", ""].join("\n"),
    );
    // The condition must open on the line below the marker. Here a later line holds an `if`,
    // and mutating it would silently neutralise an unrelated check, so nothing is mutated.
    expect(
      neutralise(["// neutralise:e", "plain();", "if (x) y();", ""].join("\n"), "e"),
    ).toBeNull();
    const direct = ["// neutralise:c", "} else if (p || (q && r)) s();", ""].join("\n");
    expect(neutralise(direct, "c")).toBe(
      ["// neutralise:c", "} else if (false && (p || (q && r))) s();", ""].join("\n"),
    );
  });

  test("routes a bare add(...) call to a discarding function", () => {
    const source = ["// neutralise:d", '  add("s", "k", oid);', ""].join("\n");
    const mutant = neutralise(source, "d");
    expect(mutant).toContain('discard("s", "k", oid);');
    expect(mutant).toContain("function discard(");
  });

  test("an unknown marker yields nothing, and markers() lists every id", () => {
    expect(neutralise("// neutralise:a\nif (x) y();\n", "zzz")).toBeNull();
    expect(markers("// neutralise:a\n// neutralise:b-c\n")).toEqual(["a", "b-c"]);
  });
});
