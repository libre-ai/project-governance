import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import { discoverDetectors, parseDetectorHeader, printable } from "./fleet-gates";

/**
 * Discovery of the fleet detectors. The expected values come from the brief
 * (lot L091, idea h-plugins-flotte-02), not from the output of the code: five
 * keys in the first 20 lines, a target that is an integer or `info`, a scope
 * `repo` or `parc`, unique identifiers, and an empty directory that fails.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: the tests assert their absence.
const CONTROL = /[\u{0}-\u{1f}\u{7f}]/u;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function directory(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "fleet-gates-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

function header(changes: Record<string, string | null> = {}): string {
  const keys: Record<string, string | null> = {
    identifiant: "pins-orphelins",
    titre: "Epinglages orphelins",
    fragilite: "un epinglage survit a la suppression de sa cible",
    cible: "0",
    portee: "repo",
    ...changes,
  };
  const lines = Object.entries(keys).flatMap(([key, value]) =>
    value === null ? [] : [`# ${key}: ${value}`],
  );
  return ["#!/usr/bin/env bash", ...lines, "", "echo ok", ""].join("\n");
}

describe("parseDetectorHeader", () => {
  test("a complete header yields the five keys, the target as an integer", () => {
    const parsed = parseDetectorHeader(header({ cible: "12" }));
    expect(parsed).toEqual({
      ok: true,
      header: {
        id: "pins-orphelins",
        title: "Epinglages orphelins",
        fragility: "un epinglage survit a la suppression de sa cible",
        target: 12,
        scope: "repo",
      },
    });
  });

  test("the target `info` is accepted and carries no integer", () => {
    const parsed = parseDetectorHeader(header({ cible: "info", portee: "parc" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.header.target).toBeNull();
      expect(parsed.header.scope).toBe("parc");
    }
  });

  test("a header without the scope key is refused, the missing key named", () => {
    const parsed = parseDetectorHeader(header({ portee: null }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join("\n")).toContain("portee");
  });

  test("a target `abc` is refused", () => {
    const parsed = parseDetectorHeader(header({ cible: "abc" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join("\n")).toContain("cible");
  });

  test.each(["-1", "1.5", "01", "INFO", ""])("the target %p is refused", (cible) => {
    expect(parseDetectorHeader(header({ cible })).ok).toBe(false);
  });

  test("a scope outside `repo` and `parc` is refused", () => {
    const parsed = parseDetectorHeader(header({ portee: "flotte" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join("\n")).toContain("portee");
  });

  test("a key repeated in the header is refused", () => {
    const parsed = parseDetectorHeader(`${header()}\n`.replace("\n\n", "\n# titre: autre\n\n"));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join("\n")).toContain("titre");
  });

  test("a key past line 20 does not count", () => {
    const late = `${"# bruit\n".repeat(20)}# portee: repo\n`;
    const parsed = parseDetectorHeader(header({ portee: null }) + late);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join("\n")).toContain("portee");
  });

  test("a key on line 20 counts", () => {
    const lines = [
      "# identifiant: a",
      "# titre: t",
      "# fragilite: f",
      "# cible: 1",
      ...Array.from({ length: 15 }, () => "# bruit"),
      "# portee: repo",
    ];
    expect(lines).toHaveLength(20);
    expect(parseDetectorHeader(lines.join("\n")).ok).toBe(true);
  });

  test("an identifier that is not a lowercase slug is refused", () => {
    expect(parseDetectorHeader(header({ identifiant: "Pins Orphelins" })).ok).toBe(false);
  });

  // The schema is closed: a key it does not know is a typo or an extension
  // nobody reads, so it is refused rather than silently dropped.
  test.each([
    ["seuil", "99"],
    ["cibel", "3"],
    ["Cible", "3"],
    ["portée", "repo"],
    ["max_findings", "2"],
  ])("an unknown key %p is refused, the key named", (key, value) => {
    const parsed = parseDetectorHeader(header({ [key]: value }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join("\n")).toContain(key);
  });

  test("a URL in a header comment stays prose, not a key", () => {
    const text = header().replace("\n#", "\n# https://example.org/doc\n#");
    expect(parseDetectorHeader(text).ok).toBe(true);
  });

  test.each([
    "9007199254740992",
    "99999999999999999999",
  ])("a target %p past the safe integers is refused", (cible) => {
    const parsed = parseDetectorHeader(header({ cible }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join("\n")).toContain("cible");
  });

  test("the largest safe integer is a valid target", () => {
    const parsed = parseDetectorHeader(header({ cible: "9007199254740991" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.header.target).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("a refused value is printed with its control characters escaped", () => {
    const parsed = parseDetectorHeader(header({ cible: "1\rforged\u001b[31m" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      const text = parsed.errors.join("\n");
      expect(text).not.toMatch(CONTROL);
      expect(text).toContain("\\u000d");
      expect(text).toContain("\\u001b");
    }
  });
});

describe("printable", () => {
  test("escapes C0, DEL, C1 and the Unicode line separators, keeps the rest", () => {
    expect(printable("a\nb\tc\u{7f}\u{85}\u{2028}\u{2029}\u{202e}« é »")).toBe(
      "a\\u000ab\\u0009c\\u007f\\u0085\\u2028\\u2029\\u202e« é »",
    );
  });
});

describe("discoverDetectors", () => {
  test("detectors come back sorted by file name, with an absolute path", async () => {
    const root = directory({
      "b.sh": header({ identifiant: "b" }),
      "a.py": header({ identifiant: "a" }).replace("#!/usr/bin/env bash", "#!/usr/bin/env python3"),
    });
    const found = await discoverDetectors(root);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.detectors.map((detector) => detector.id)).toEqual(["a", "b"]);
    expect(found.detectors.every((detector) => isAbsolute(detector.path))).toBe(true);
    expect(found.detectors[0]?.path).toBe(join(root, "a.py"));
  });

  test("a relative directory still yields absolute paths", async () => {
    const root = directory({ "a.sh": header() });
    const rel = relative(process.cwd(), root);
    expect(isAbsolute(rel)).toBe(false);
    const found = await discoverDetectors(rel);
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.detectors[0]?.path).toBe(join(root, "a.sh"));
  });

  test("the header reader stays linear on a line of spaces", () => {
    const line = `# titre:${" ".repeat(100_000)}x${" ".repeat(100_000)}y`;
    const start = performance.now();
    parseDetectorHeader(line);
    expect(performance.now() - start).toBeLessThan(100);
  });

  test("two detectors with the same identifier fail the discovery", async () => {
    const root = directory({ "a.sh": header(), "b.sh": header() });
    const found = await discoverDetectors(root);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.errors.join("\n")).toContain("pins-orphelins");
  });

  test("a directory with no detector fails the discovery", async () => {
    const found = await discoverDetectors(directory({}));
    expect(found.ok).toBe(false);
  });

  test("a directory holding only non-script files fails the discovery", async () => {
    const found = await discoverDetectors(directory({ "README.md": "# titre: x\n" }));
    expect(found.ok).toBe(false);
  });

  test("a data file next to the detectors is not taken for one", async () => {
    const root = directory({
      "a.sh": header(),
      "exemptions.yaml": "# identifiant: x\n",
      "README.md": "# rien\n",
    });
    const found = await discoverDetectors(root);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.detectors).toHaveLength(1);
      expect(found.examined).toBe(3);
      expect(found.ignored).toBe(2);
    }
  });

  test("a detector set aside in a pending folder is neither run nor counted", async () => {
    const root = directory({
      "a.sh": header(),
      "en-attente/b.sh": header({ identifiant: "b" }),
    });
    const found = await discoverDetectors(root);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.detectors.map((detector) => detector.id)).toEqual(["pins-orphelins"]);
      expect(found.folders).toBe(1);
      expect(found.examined).toBe(2);
    }
  });

  test("a script with a bad header fails the discovery and names the file", async () => {
    const root = directory({ "a.sh": header(), "bad.sh": header({ cible: "abc" }) });
    const found = await discoverDetectors(root);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.errors.join("\n")).toContain("bad.sh");
  });

  test("a symbolic link is counted apart, never followed", async () => {
    const root = directory({ "a.sh": header() });
    const outside = directory({ "x.sh": header({ identifiant: "dehors" }) });
    symlinkSync(join(outside, "x.sh"), join(root, "lien.sh"));
    const found = await discoverDetectors(root);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.detectors).toHaveLength(1);
      expect(found.links).toBe(1);
      expect(found.examined).toBe(
        found.detectors.length + found.ignored + found.links + found.folders,
      );
    }
  });

  // A gate present but undeclared must not pass as « other file »: whatever
  // looks like a script (extension of any case, shebang, executable bit) is a
  // candidate, and without a header it is refused.
  test.each([
    ["an upper-case extension", "gate.SH", "#!/bin/sh\necho x\n", 0o644],
    ["a TypeScript script", "gate.ts", "console.log(1);\n", 0o644],
    ["a mixed-case Python script", "gate.Py", "print(1)\n", 0o644],
    ["an extensionless file with a shebang", "gate", "#!/usr/bin/env bash\necho x\n", 0o644],
    ["an extensionless executable", "gate", "echo x\n", 0o755],
  ])("%s without a header is refused, the file named", async (_label, name, content, mode) => {
    const root = directory({ "a.sh": header() });
    writeFileSync(join(root, name), content);
    chmodSync(join(root, name), mode);
    const found = await discoverDetectors(root);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.errors.join("\n")).toContain(name);
  });

  test("an extensionless executable with a valid header is a detector", async () => {
    const root = directory({ "a.sh": header(), gate: header({ identifiant: "b" }) });
    chmodSync(join(root, "gate"), 0o755);
    const found = await discoverDetectors(root);
    expect(found.ok).toBe(true);
    if (found.ok)
      expect(found.detectors.map((detector) => detector.id)).toEqual(["pins-orphelins", "b"]);
  });

  test("a file name with a line break is escaped in the refusal", async () => {
    const root = directory({ "a.sh": header(), "x\nforged.sh": header({ cible: "abc" }) });
    const found = await discoverDetectors(root);
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.errors.join("|")).not.toMatch(CONTROL);
      expect(found.errors.join("|")).toContain("x\\u000aforged.sh");
    }
  });

  test("the command line prints a path with a line break escaped", async () => {
    const root = directory({ "x\nforged.sh": header() });
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "check-fleet-gates.ts"), root], {
      env: { PATH: process.env.PATH ?? "", GATE_VERBOSE: "1" },
    });
    expect(run.exitCode).toBe(0);
    const out = run.stdout.toString();
    expect(out).toContain("x\\u000aforged.sh");
    expect(out.split("\n").some((line) => line.startsWith("forged.sh"))).toBe(false);
  });

  test("an unreadable directory fails, never an empty success", async () => {
    const found = await discoverDetectors(join(directory({}), "absent"));
    expect(found.ok).toBe(false);
  });
});
