// End-to-end: the Bun-manifest gate run as a process over a throwaway tree.
//
// Every case below is an attack the adversarial review of PR #55 confirmed on
// 2026-10-09 against the gate as merged: each passed the gate while
// `bun run --filter` (d-cases) or `bun run <script>` (c-cases, presuite) ran
// the suite with the floor absent or failing. They are run as a process, not
// as calls, because the defect was in what the gate DISCOVERED and in the
// rule applied at the root — both live in the command, not in a helper.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const GATE = join(import.meta.dir, "check-bun-manifests.ts");
const TOOLCHAIN = join(import.meta.dir, "..", "..", "toolchains", "bun.json");
const policy = (await Bun.file(TOOLCHAIN).json()) as { minimumVersion: string; revision: string };
const ENGINE = `>=${policy.minimumVersion}`;
const PACKAGE_MANAGER = `bun@${policy.revision.split("+")[0]}`;
const RUNTIME = "bun run check:bun:runtime && ";

const ROOT_SCRIPTS: Readonly<Record<string, string>> = {
  "check:bun:runtime": "bun tools/quality/check-bun-minimum.ts",
  "check:bun": `${RUNTIME}bun tools/quality/check-bun-manifests.ts`,
  lint: `${RUNTIME}biome ci .`,
  test: "bun test",
  pretest: "bun run check:bun",
  check: "bun run check:bun && bun run lint && bun run test",
};

/** A depth-2 workspace member that satisfies the nested contract. */
function member(up = "../.."): string {
  return JSON.stringify({
    name: "@t/member",
    engines: { bun: ENGINE },
    scripts: {
      "check:bun": `bun ${up}/tools/quality/check-bun-minimum.ts`,
      pretest: "bun run check:bun",
      test: "bun test src",
    },
  });
}

/** The shape every d-case attack used: a member with no floor at all. */
const UNFLOORED = JSON.stringify({ name: "@t/bad", scripts: { suite: "bun test" } });

interface Fixture {
  rootScripts?: Record<string, string | null>;
  workspaces?: unknown;
  /** Written AND tracked. */
  tracked?: Record<string, string>;
  /** Written, never added to the index. */
  untracked?: Record<string, string>;
  symlinks?: Record<string, string>;
  git?: boolean;
}

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, body: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}

function run(fixture: Fixture): { code: number | null; out: string } {
  const root = mkdtempSync(join(tmpdir(), "bunfloor-gate-"));
  roots.push(root);
  const scripts: Record<string, string> = { ...ROOT_SCRIPTS };
  for (const [name, command] of Object.entries(fixture.rootScripts ?? {})) {
    if (command === null) delete scripts[name];
    else scripts[name] = command;
  }
  const manifest: Record<string, unknown> = {
    name: "@t/root",
    private: true,
    packageManager: PACKAGE_MANAGER,
    engines: { bun: ENGINE },
    scripts,
  };
  if (fixture.workspaces !== undefined) manifest.workspaces = fixture.workspaces;
  write(root, "package.json", JSON.stringify(manifest, null, 2));
  write(root, "toolchains/bun.json", JSON.stringify(policy));
  write(root, "packages/ok/package.json", member());
  for (const [path, body] of Object.entries(fixture.tracked ?? {})) write(root, path, body);
  for (const [link, target] of Object.entries(fixture.symlinks ?? {})) {
    mkdirSync(dirname(join(root, link)), { recursive: true });
    symlinkSync(target, join(root, link));
  }
  if (fixture.git !== false) {
    const git = (...args: string[]) => {
      const proc = Bun.spawnSync(["git", ...args], { cwd: root });
      if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr}`);
    };
    git("init", "-q");
    git("add", "package.json", "toolchains", "packages/ok", ...Object.keys(fixture.tracked ?? {}));
  }
  // Untracked files are written after `git add`, so the index never sees them.
  for (const [path, body] of Object.entries(fixture.untracked ?? {})) write(root, path, body);
  const proc = Bun.spawnSync(["bun", GATE], { cwd: root, env: { ...process.env, NO_COLOR: "1" } });
  return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
}

test("control: a compliant tree passes and says what it read", () => {
  const { code, out } = run({ workspaces: ["packages/*"] });
  expect(out).toContain("1 root manifest and 1 nested manifest(s) read");
  expect(out).toContain("1 tracked by git, 1 matched by 3 workspace pattern(s), 0 untracked");
  expect(out).toContain("0 skipped under node_modules, 1 named by either source");
  expect(code).toBe(0);
});

describe("F1 — every manifest bun executes is read", () => {
  test("d01: a member of a libs/* workspace", () => {
    const { code, out } = run({
      workspaces: ["packages/*", "libs/*"],
      untracked: { "libs/x/package.json": UNFLOORED },
    });
    expect(out).toContain("libs/x/package.json: engines.bun");
    expect(out).toContain("libs/x/package.json: presuite must enforce the Bun floor");
    expect(code).toBe(1);
  });

  test("d02: a member two directories below packages/", () => {
    const { code, out } = run({
      workspaces: ["packages/*", "packages/group/*"],
      untracked: { "packages/group/y/package.json": UNFLOORED },
    });
    expect(out).toContain("packages/group/y/package.json: presuite must enforce the Bun floor");
    expect(code).toBe(1);
  });

  test("d03: a dot directory under packages/, root manifest unchanged", () => {
    const { code, out } = run({ untracked: { "packages/.z/package.json": UNFLOORED } });
    expect(out).toContain("packages/.z/package.json: presuite must enforce the Bun floor");
    expect(code).toBe(1);
  });

  test("d05: a symlinked member directory", () => {
    const { code, out } = run({
      untracked: { "vendor-pkgs/s/package.json": UNFLOORED },
      symlinks: { "packages/s": "../vendor-pkgs/s" },
    });
    expect(out).toContain("packages/s/package.json: presuite must enforce the Bun floor");
    expect(code).toBe(1);
  });

  test("a tracked manifest outside every workspace pattern is still read", () => {
    const { code, out } = run({ tracked: { "tools/review/package.json": UNFLOORED } });
    expect(out).toContain("tools/review/package.json: presuite must enforce the Bun floor");
    expect(code).toBe(1);
  });

  test("a deeper member resolves the tooling through its own path to the root", () => {
    const { code, out } = run({
      workspaces: ["packages/*", "crates/store/check"],
      tracked: { "crates/store/check/package.json": member("../../..") },
    });
    expect(out).toContain("2 nested manifest(s) read");
    expect(code).toBe(0);
  });

  test("a script-less manifest is held to the engine pin only", () => {
    const pinned = JSON.stringify({ name: "@t/lib", engines: { bun: ENGINE } });
    expect(run({ tracked: { "tools/review/package.json": pinned } }).code).toBe(0);
    const unpinned = JSON.stringify({ name: "@t/lib" });
    const { code, out } = run({ tracked: { "tools/review/package.json": unpinned } });
    expect(out).toContain("tools/review/package.json: engines.bun");
    expect(code).toBe(1);
  });

  test("counters sum to the universe, node_modules named as the skip reason", () => {
    const { code, out } = run({
      tracked: { "vendor/node_modules/q/package.json": UNFLOORED },
      untracked: { "packages/extra/package.json": member() },
    });
    expect(out).toContain(
      "2 nested manifest(s) read (2 tracked by git, 2 matched by 3 workspace pattern(s), " +
        "1 untracked; 1 skipped under node_modules, 3 named by either source)",
    );
    expect(code).toBe(0);
  });

  test("a tree git cannot list fails instead of reading as empty", () => {
    const { code, out } = run({ git: false });
    expect(out).toContain("git ls-files");
    expect(code).toBe(1);
  });

  test("a workspace negation is refused, not dropped", () => {
    const { code, out } = run({ workspaces: ["packages/*", "!packages/ok"] });
    expect(out).toContain("negation");
    expect(code).toBe(1);
  });

  test("the { packages } workspace form is read too", () => {
    const { code, out } = run({
      workspaces: { packages: ["packages/*", "libs/*"] },
      untracked: { "libs/x/package.json": UNFLOORED },
    });
    expect(out).toContain("libs/x/package.json: presuite must enforce the Bun floor");
    expect(code).toBe(1);
  });
});

describe("F2 — a root script after a failed floor is refused however bun test is spelled", () => {
  const attacks: ReadonlyArray<readonly [id: string, command: string]> = [
    ["c00-control-or", `${RUNTIME}false || bun test`],
    ["c01-quoted-test", `${RUNTIME}false || bun "test"`],
    ["c02-flag-between", `${RUNTIME}false || bun --smol test`],
    ["c03-split-quote", `${RUNTIME}false || bun t''est`],
    ["c04-split-bun", `${RUNTIME}false || b''un test`],
    ["c05-cmdsubst", `${RUNTIME}false || $(echo bun) test`],
    ["e01-bun-bun-test", `${RUNTIME}false || bun --bun test`],
  ];
  for (const [id, command] of attacks) {
    test(id, () => {
      const { code, out } = run({ rootScripts: { "t:x": command } });
      expect(out).toContain("t:x must enforce the Bun floor first");
      expect(code).toBe(1);
    });
  }

  test("the root check is held to && after check:bun too", () => {
    const { code, out } = run({ rootScripts: { check: "bun run check:bun && false || true" } });
    expect(out).toContain("check must start with `bun run check:bun && `");
    expect(code).toBe(1);
  });

  test("the floor first, chained by &&, still passes", () => {
    expect(run({ rootScripts: { "t:x": `${RUNTIME}bun test src` } }).code).toBe(0);
  });
});

describe("F3 — only the hook of a declared script is exempt, and only at its exact value", () => {
  test("presuite with no suite is an ordinary script", () => {
    const { code, out } = run({ rootScripts: { presuite: "bun --smol test probe" } });
    expect(out).toContain("presuite must enforce the Bun floor first");
    expect(code).toBe(1);
  });

  test("the hook of a declared script must be exactly the floor", () => {
    const { code, out } = run({ rootScripts: { prelint: "bun test probe" } });
    expect(out).toContain("prelint runs before lint, so it must be exactly `bun run check:bun`");
    expect(code).toBe(1);
    expect(run({ rootScripts: { prelint: "bun run check:bun" } }).code).toBe(0);
  });

  test("a pre-named script floored first passes (project-website preview:brand)", () => {
    expect(run({ rootScripts: { "preview:brand": `${RUNTIME}bun src/preview.ts` } }).code).toBe(0);
  });
});
