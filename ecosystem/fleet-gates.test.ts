import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import {
  discoverDetectors,
  parseDetectorHeader,
  parseRegistry,
  printable,
  REGISTRY_PATH,
} from "./fleet-gates";

/**
 * Discovery of the fleet detectors. The expected values come from the brief
 * (lot L091, idea h-plugins-flotte-02), not from the output of the code: five
 * keys in the first 20 lines, a target that is an integer or `info`, a scope
 * `repo` or `parc`, unique identifiers, and an empty directory that fails.
 * The registry `fleet-gates.v1.yaml` is the module the brief names; the
 * owner's decision of 2026-11-17 fixes its checks: a gate declared there but
 * absent fails, a script declaring itself a gate without an entry fails, and
 * a duplicated YAML key is refused.
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

type Entry = readonly [identifiant: string, fichier: string];

function registryText(entries: readonly Entry[]): string {
  if (entries.length === 0) return "version: 1\ndetecteurs: []\n";
  const items = entries.map(([id, file]) => `  - identifiant: ${id}\n    fichier: ${file}\n`);
  return `version: 1\ndetecteurs:\n${items.join("")}`;
}

/** A registry file, in its own directory, declaring `entries`. */
function registry(entries: readonly Entry[]): string {
  const root = mkdtempSync(join(tmpdir(), "fleet-gates-registry-"));
  roots.push(root);
  const path = join(root, "fleet-gates.v1.yaml");
  writeFileSync(path, registryText(entries));
  return path;
}

/** The detector `header()` declares, in `a.sh`. */
const PINS: Entry = ["pins-orphelins", "a.sh"];

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
    const found = await discoverDetectors(
      root,
      registry([
        ["b", "b.sh"],
        ["a", "a.py"],
      ]),
    );
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
    const found = await discoverDetectors(rel, registry([PINS]));
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
    const found = await discoverDetectors(root, registry([PINS]));
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.errors.join("\n")).toContain("pins-orphelins");
  });

  test("a directory with no detector fails the discovery", async () => {
    const found = await discoverDetectors(directory({}), registry([]));
    expect(found.ok).toBe(false);
  });

  test("a directory holding only non-script files fails the discovery", async () => {
    const found = await discoverDetectors(directory({ "README.md": "# titre: x\n" }), registry([]));
    expect(found.ok).toBe(false);
  });

  test("a data file next to the detectors is not taken for one", async () => {
    const root = directory({
      "a.sh": header(),
      "exemptions.yaml": "# identifiant: x\n",
      "README.md": "# rien\n",
    });
    const found = await discoverDetectors(root, registry([PINS]));
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
    const found = await discoverDetectors(root, registry([PINS]));
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.detectors.map((detector) => detector.id)).toEqual(["pins-orphelins"]);
      expect(found.folders).toBe(1);
      expect(found.examined).toBe(2);
    }
  });

  test("a script with a bad header fails the discovery and names the file", async () => {
    const root = directory({ "a.sh": header(), "bad.sh": header({ cible: "abc" }) });
    const found = await discoverDetectors(root, registry([PINS]));
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.errors.join("\n")).toContain("bad.sh");
  });

  test("a symbolic link is counted apart, never followed", async () => {
    const root = directory({ "a.sh": header() });
    const outside = directory({ "x.sh": header({ identifiant: "dehors" }) });
    symlinkSync(join(outside, "x.sh"), join(root, "lien.sh"));
    const found = await discoverDetectors(root, registry([PINS]));
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
    const found = await discoverDetectors(root, registry([PINS]));
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.errors.join("\n")).toContain(name);
  });

  test("an extensionless executable with a valid header is a detector", async () => {
    const root = directory({ "a.sh": header(), gate: header({ identifiant: "b" }) });
    chmodSync(join(root, "gate"), 0o755);
    const found = await discoverDetectors(root, registry([PINS, ["b", "gate"]]));
    expect(found.ok).toBe(true);
    if (found.ok)
      expect(found.detectors.map((detector) => detector.id)).toEqual(["pins-orphelins", "b"]);
  });

  test("a file name with a line break is escaped in the refusal", async () => {
    const root = directory({ "a.sh": header(), "x\nforged.sh": header({ cible: "abc" }) });
    const found = await discoverDetectors(root, registry([PINS]));
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.errors.join("|")).not.toMatch(CONTROL);
      expect(found.errors.join("|")).toContain("x\\u000aforged.sh");
    }
  });

  // A registered file name cannot hold a line break (the registry refuses it),
  // so the line break sits in the directory, which the success path prints.
  test("the command line prints a path with a line break escaped", async () => {
    const root = join(directory({ "x\nforged/a.sh": header() }), "x\nforged");
    const run = Bun.spawnSync(
      ["bun", join(import.meta.dir, "check-fleet-gates.ts"), root, registry([PINS])],
      { env: { PATH: process.env.PATH ?? "", GATE_VERBOSE: "1" } },
    );
    expect(run.exitCode).toBe(0);
    const out = run.stdout.toString();
    expect(out).toContain("x\\u000aforged/a.sh");
    expect(out.split("\n").some((line) => line.startsWith("forged"))).toBe(false);
    expect(out).toContain("registry: 1 entry, 1 found");
  });

  test("an unreadable directory fails, never an empty success", async () => {
    const found = await discoverDetectors(join(directory({}), "absent"), registry([]));
    expect(found.ok).toBe(false);
  });

  test("a gate declared in the registry but absent fails, the identifier and file named", async () => {
    const root = directory({ "a.sh": header() });
    const found = await discoverDetectors(root, registry([PINS, ["parti", "parti.sh"]]));
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.errors).toEqual([
        "registry: « parti » declared in parti.sh, no detector found there",
      ]);
    }
  });

  test("a gate declared in the registry whose file was refused fails on both counts", async () => {
    const root = directory({ "a.sh": header(), "b.sh": header({ identifiant: "b", cible: "x" }) });
    const found = await discoverDetectors(root, registry([PINS, ["b", "b.sh"]]));
    expect(found.ok).toBe(false);
    if (!found.ok) {
      const text = found.errors.join("\n");
      expect(text).toContain("b.sh: cible « x »");
      expect(text).toContain("registry: « b » declared in b.sh, no detector found there");
    }
  });

  test("a script declaring itself a gate without a registry entry fails, file and id named", async () => {
    const root = directory({ "a.sh": header(), "z.sh": header({ identifiant: "intrus" }) });
    const found = await discoverDetectors(root, registry([PINS]));
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.errors).toEqual([
        "z.sh: declares the gate « intrus », which has no entry for this file in the registry",
      ]);
    }
  });

  test("a registry entry whose file declares another identifier fails, both named", async () => {
    const root = directory({ "a.sh": header() });
    const found = await discoverDetectors(root, registry([["autre", "a.sh"]]));
    expect(found.ok).toBe(false);
    if (!found.ok) {
      const text = found.errors.join("\n");
      expect(text).toContain("a.sh: declares the gate « pins-orphelins »");
      expect(text).toContain("registry: « autre » declared in a.sh");
    }
  });

  test("the registry and the directory agree: counted on both sides", async () => {
    const root = directory({ "a.sh": header(), "b.sh": header({ identifiant: "b" }) });
    const found = await discoverDetectors(root, registry([PINS, ["b", "b.sh"]]));
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.registered).toBe(2);
      expect(found.detectors).toHaveLength(found.registered);
    }
  });

  test("an unreadable registry fails, never an empty registry", async () => {
    const root = directory({ "a.sh": header() });
    const found = await discoverDetectors(root, join(directory({}), "absent.yaml"));
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.errors.join("\n")).toContain("registry");
  });

  test("a malformed registry fails the discovery", async () => {
    const root = directory({ "a.sh": header() });
    const path = registry([PINS]);
    writeFileSync(path, `${registryText([PINS])}version: 1\n`);
    const found = await discoverDetectors(root, path);
    expect(found.ok).toBe(false);
  });
});

describe("parseRegistry", () => {
  test("a registry yields its entries in order", () => {
    expect(
      parseRegistry(
        registryText([
          ["b", "b.sh"],
          ["a", "a.py"],
        ]),
      ),
    ).toEqual({
      ok: true,
      entries: [
        { id: "b", file: "b.sh" },
        { id: "a", file: "a.py" },
      ],
    });
  });

  test("comments and blank lines are prose; an empty list is written []", () => {
    const text = `# Registry\n\nversion: 1\n# none yet\ndetecteurs: []\n`;
    expect(parseRegistry(text)).toEqual({ ok: true, entries: [] });
  });

  test("the registry of this repository is read", async () => {
    expect(parseRegistry(await Bun.file(REGISTRY_PATH).text()).ok).toBe(true);
  });

  const ENTRY = "  - identifiant: a\n    fichier: a.sh\n";
  test.each([
    ["version twice", `version: 1\nversion: 1\ndetecteurs:\n${ENTRY}`, "version"],
    ["detecteurs twice", `version: 1\ndetecteurs: []\ndetecteurs:\n${ENTRY}`, "detecteurs"],
    [
      "identifiant twice in an entry",
      `version: 1\ndetecteurs:\n${ENTRY}    identifiant: b\n`,
      "identifiant",
    ],
    [
      "fichier twice in an entry",
      `version: 1\ndetecteurs:\n${ENTRY}    fichier: b.sh\n`,
      "fichier",
    ],
  ])("a duplicated YAML key (%s) is refused, the key named", (_label, text, key) => {
    const parsed = parseRegistry(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join("\n")).toContain(`« ${key} » declared twice`);
  });

  test.each([
    ["an unknown top-level key", `version: 1\nseuil: 3\ndetecteurs:\n${ENTRY}`],
    ["an unknown entry key", `version: 1\ndetecteurs:\n${ENTRY}    cible: 3\n`],
    ["no version", `detecteurs:\n${ENTRY}`],
    ["version 2", `version: 2\ndetecteurs:\n${ENTRY}`],
    ["no list", "version: 1\n"],
    ["a list key without entries", "version: 1\ndetecteurs:\n"],
    ["an entry without fichier", "version: 1\ndetecteurs:\n  - identifiant: a\n"],
    ["an entry without identifiant", "version: 1\ndetecteurs:\n  - fichier: a.sh\n"],
    ["an entry before the list", `version: 1\n${ENTRY}detecteurs: []\n`],
    ["an entry after an empty list", `version: 1\ndetecteurs: []\n${ENTRY}`],
    [
      "a file in another directory",
      "version: 1\ndetecteurs:\n  - identifiant: a\n    fichier: ../a.sh\n",
    ],
    ["a hidden file", "version: 1\ndetecteurs:\n  - identifiant: a\n    fichier: .a.sh\n"],
    [
      "an identifier that is not a slug",
      "version: 1\ndetecteurs:\n  - identifiant: A b\n    fichier: a.sh\n",
    ],
    ["a trailing comment", "version: 1\ndetecteurs:\n  - identifiant: a # x\n    fichier: a.sh\n"],
    ["a quoted value", 'version: 1\ndetecteurs:\n  - identifiant: "a"\n    fichier: a.sh\n'],
    ["a tab", "version: 1\ndetecteurs:\n  - identifiant: a\n\tfichier: a.sh\n"],
    ["a NUL", `version: 1\ndetecteurs:\n${ENTRY}\u{0}`],
    ["a document marker", `---\nversion: 1\ndetecteurs:\n${ENTRY}`],
    [
      "two entries with one identifier",
      `version: 1\ndetecteurs:\n${ENTRY}  - identifiant: a\n    fichier: b.sh\n`,
    ],
    [
      "two entries with one file",
      `version: 1\ndetecteurs:\n${ENTRY}  - identifiant: b\n    fichier: a.sh\n`,
    ],
  ])("%s is refused", (_label, text) => {
    expect(parseRegistry(text).ok).toBe(false);
  });

  test("a refusal names the line and never prints a control character", () => {
    const parsed = parseRegistry("version: 1\ndetecteurs:\n  - identifiant: a\u{1b}[31m\n");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.join("\n")).toContain("line 3");
      expect(parsed.errors.join("\n")).not.toMatch(CONTROL);
    }
  });
});
