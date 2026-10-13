import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addedGenerations, generationShas } from "./added-generations";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const register = (...shas: string[]): string =>
  `schema_version: libre-ai.fleet-pins.v1\ngenerations:\n${shas
    .map((sha) => `  - sha: ${sha}\n    added_on: 2026-10-13\n    note: >-\n      x\n`)
    .join("")}`;

describe("generations added by a change", () => {
  test("the shas absent from the previous register are returned", () => {
    expect(addedGenerations(register(A), register(A, B))).toEqual([B]);
  });

  test("a retired generation is not an addition, and two additions are both returned", () => {
    expect(addedGenerations(register(A, B), register(B, C))).toEqual([C]);
    expect(addedGenerations(register(A), register(A, B, C))).toEqual([B, C]);
  });

  test("an unchanged register adds nothing, and says so by returning an empty list", () => {
    expect(addedGenerations(register(A), register(A))).toEqual([]);
  });

  test("a register whose parse and line count disagree fails instead of returning less", () => {
    // A flow-style entry parses as a generation but is not a `- sha:` line.
    const hidden = `generations:\n  - sha: ${A}\n  - {sha: ${B}}\n`;
    expect(() => generationShas(hidden)).toThrow("2 generation(s) but has 1 sha line(s)");
  });

  test("a register without a generations list, or with a short sha, fails", () => {
    expect(() => generationShas("schema_version: x\n")).toThrow("no generations list");
    expect(() => generationShas("generations:\n  - sha: abc123\n")).toThrow("full commit sha");
  });

  test("the committed register reads, with at least one generation", () => {
    const text = readFileSync(join(import.meta.dir, "../../ecosystem/fleet-pins.v1.yaml"), "utf8");
    expect(generationShas(text).length).toBeGreaterThan(0);
  });
});
