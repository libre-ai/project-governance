import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  CONFIG_PATH,
  type DocCommandsConfig,
  evaluateDocCommands,
  loadDocCommandsInput,
  scanOccurrences,
  validateConfig,
} from "./check-doc-commands";

const MANIFEST = JSON.stringify({ scripts: { check: "a", lint: "b", "check:bun": "c" } });
const DOC = "docs/a.md";

const CONFIG: DocCommandsConfig = {
  manifest: "package.json",
  documents: [{ path: DOC, because: "test document" }],
  exemptions: [],
};

/** Runs the gate over one document with the test manifest. */
function judge(
  docText: string | null,
  config: DocCommandsConfig = CONFIG,
  manifest: string | null = MANIFEST,
) {
  return evaluateDocCommands(manifest, [{ path: DOC, text: docText }], config);
}

describe("scanOccurrences", () => {
  test("reads a command in a fenced block and in a code span, with its line", () => {
    expect(
      scanOccurrences("intro bun run lint\n```sh\nbun run check:bun\n```\nsee `bun run check`"),
    ).toEqual([
      { kind: "prose", line: 1 },
      { kind: "read", line: 3, name: "check:bun" },
      { kind: "read", line: 5, name: "check" },
    ]);
  });

  test("a backtick that is never closed opens no code span", () => {
    expect(scanOccurrences("`bun run lint and nothing closes it")).toEqual([
      { kind: "prose", line: 1 },
    ]);
  });

  test("a placeholder is a `<` or a name followed by an ellipsis, and reads no script", () => {
    expect(scanOccurrences("`bun run check:…` `bun run <script>` `bun run <x>`")).toEqual([
      { kind: "placeholder", line: 1 },
      { kind: "placeholder", line: 1 },
      { kind: "placeholder", line: 1 },
    ]);
  });
});

describe("evaluateDocCommands", () => {
  test("green: every command shown names a script, and the sums hold", () => {
    const { report, volume } = judge("```sh\nbun run check:bun\n```\nand `bun run lint`");
    expect(report.outcome).toBe("pass");
    expect(volume).toMatchObject({
      occurrences: 2,
      read: 2,
      resolved: 2,
      exempted: 0,
      unresolved: 0,
      declaredRead: 1,
    });
    expect(report.volumeSummary).toContain("2 read = 2 resolved + 0 exempted + 0 unresolved");
  });

  test("a command that names no script turns the gate red, with its document, line and command", () => {
    const { report } = judge("```sh\nbun run check\nbun run gone\n```");
    expect(report.violations).toEqual([
      "docs/a.md:3 bun run gone: bun run gone names no key of scripts in package.json",
    ]);
  });

  test("an exemption with the same document and command admits the unresolved command", () => {
    const config: DocCommandsConfig = {
      ...CONFIG,
      exemptions: [{ path: DOC, command: "bun run gone", because: "renamed in another repo" }],
    };
    const { report, volume } = judge("`bun run gone`", config);
    expect(report.outcome).toBe("pass");
    expect(volume).toMatchObject({
      read: 1,
      resolved: 0,
      exempted: 1,
      unresolved: 0,
      exemptionsStale: 0,
    });
  });

  test("an exemption that admits no command read is stale and turns the gate red", () => {
    const config: DocCommandsConfig = {
      ...CONFIG,
      exemptions: [{ path: DOC, command: "bun run gone", because: "old" }],
    };
    const { report, volume } = judge("`bun run lint`", config);
    expect(report.violations).toEqual([
      "exemption docs/a.md bun run gone: admits no command read in the declared documents — stale, remove it",
    ]);
    expect(volume).toMatchObject({ exemptions: 1, exemptionsStale: 1 });
  });

  test("an exemption that covers only commands that resolve is stale too", () => {
    const config: DocCommandsConfig = {
      ...CONFIG,
      exemptions: [{ path: DOC, command: "bun run lint", because: "not needed" }],
    };
    const { report } = judge("`bun run lint`", config);
    expect(report.violations).toEqual([
      "exemption docs/a.md bun run lint: admits only commands that resolve — stale, remove it",
    ]);
  });

  test("a declared document that cannot be read turns the gate red, never a zero", () => {
    const { report, volume } = judge(null);
    expect(report.violations).toEqual([
      "docs/a.md: declared document could not be read — a missing file is not zero commands",
    ]);
    expect(volume).toMatchObject({ declaredRead: 0, declaredUnreadable: 1, occurrences: 0 });
  });

  test("a manifest that cannot be read, is not JSON, has no scripts, or has none turns the gate red", () => {
    const cases: readonly [string | null, string][] = [
      [null, "manifest could not be read"],
      ["{ not json", "manifest is not valid JSON"],
      ['{"name":"x"}', "manifest has no scripts object"],
      ['{"scripts":[]}', "manifest has no scripts object"],
      ['{"scripts":{}}', "manifest declares no script"],
    ];
    for (const [manifest, reason] of cases) {
      const { report, volume } = judge("`bun run check`", CONFIG, manifest);
      expect(report.violations.join("\n")).toContain(reason);
      expect(volume).toMatchObject({ read: 1, resolved: 0, unresolved: 1 });
    }
  });

  test("a declared document that shows no command turns the gate red", () => {
    const { report } = judge("Plain prose, and a `cargo test` span.");
    expect(report.violations).toEqual([
      'docs/a.md: declared but shows no command (0 occurrence(s) of "bun run ", none read)',
    ]);
  });

  test("placeholders and bare prose are counted apart and neither verified nor failed", () => {
    const { report, volume } = judge(
      "`bun run check:…`, `bun run <script>`, bun run nope and `bun run lint`",
    );
    expect(report.outcome).toBe("pass");
    expect(volume).toMatchObject({
      occurrences: 4,
      read: 1,
      placeholders: 2,
      bareProse: 1,
      resolved: 1,
      unresolved: 0,
    });
    expect(report.volumeSummary).toContain(
      '4 occurrence(s) of "bun run " = 1 read + 2 placeholder(s) + 1 bare prose',
    );
  });

  test("the sums hold on a mixed document: occurrences and read commands both add up", () => {
    const config: DocCommandsConfig = {
      ...CONFIG,
      exemptions: [{ path: DOC, command: "bun run gone", because: "renamed elsewhere" }],
    };
    const { volume } = judge(
      "`bun run lint` `bun run gone` `bun run missing` `bun run <x>` bun run lost\n```\nbun run check\n```",
      config,
    );
    expect(volume.occurrences).toBe(volume.read + volume.placeholders + volume.bareProse);
    expect(volume.read).toBe(volume.resolved + volume.exempted + volume.unresolved);
    expect(volume).toMatchObject({
      occurrences: 6,
      read: 4,
      placeholders: 1,
      bareProse: 1,
      resolved: 2,
      exempted: 1,
      unresolved: 1,
    });
  });

  test("the success line prints the manifest and document counts", () => {
    const { report } = judge("`bun run lint`");
    expect(report.volumeSummary).toContain("3 script(s) in package.json");
    expect(report.volumeSummary).toContain("1 declared document(s) read, 0 unreadable");
  });
});

describe("validateConfig", () => {
  const exemption = { path: DOC, command: "bun run gone", because: "renamed" };
  const withExemptions = (exemptions: unknown) => ({ ...CONFIG, exemptions: [exemptions] });

  test("the exemptions list is required, written even when empty", () => {
    expect(() => validateConfig({ manifest: "package.json", documents: CONFIG.documents })).toThrow(
      "exemptions",
    );
    expect(validateConfig(CONFIG).exemptions).toEqual([]);
  });

  test("a document needs a path and a reason; the paths are unique", () => {
    expect(() => validateConfig({ ...CONFIG, documents: [{ path: DOC, because: " " }] })).toThrow(
      "non-empty because",
    );
    expect(() =>
      validateConfig({
        ...CONFIG,
        documents: [CONFIG.documents[0], { path: DOC, because: "again" }],
      }),
    ).toThrow("duplicate document");
  });

  test("an exemption names a declared document, a command of the form `bun run <name>`, and a reason", () => {
    expect(validateConfig(withExemptions(exemption)).exemptions).toEqual([exemption]);
    expect(() => validateConfig(withExemptions({ ...exemption, path: "docs/other.md" }))).toThrow(
      "not a declared document",
    );
    expect(() => validateConfig(withExemptions({ ...exemption, command: "cargo test" }))).toThrow(
      "bun run <name>",
    );
    expect(() => validateConfig(withExemptions({ ...exemption, because: "" }))).toThrow(
      "non-empty because",
    );
    expect(() =>
      validateConfig({ ...CONFIG, exemptions: [exemption, { ...exemption, because: "twice" }] }),
    ).toThrow("duplicate exemption");
  });
});

describe("the real corpus", () => {
  test("every command the declared documents show names a script of package.json", async () => {
    const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    const config = validateConfig(await Bun.file(join(root, CONFIG_PATH)).json());
    const input = await loadDocCommandsInput(root, config);
    const { report, volume } = evaluateDocCommands(input.manifest, input.documents, config);
    expect(report.violations).toEqual([]);
    expect(volume.declaredRead).toBe(config.documents.length);
    expect(volume.read).toBeGreaterThan(0);
    expect(volume.occurrences).toBe(volume.read + volume.placeholders + volume.bareProse);
    expect(volume.read).toBe(volume.resolved + volume.exempted + volume.unresolved);
  });
});
