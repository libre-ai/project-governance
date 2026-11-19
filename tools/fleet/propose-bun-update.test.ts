import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MINIMUM_RELEASE_AGE_SECONDS } from "../../ecosystem/check-release-age";
import { evaluateDoor } from "../quality/check-pr-door";
import type { Packument, Proposal } from "./plan-bun-update";
import {
  AUTHORIZING_ADR,
  BOT_IDENTITY,
  type CommandOptions,
  type CommandResult,
  type CommandRunner,
  isAuthorized,
  lockProblem,
  main,
  openProposal,
  proposalProblem,
  pullRequestBody,
  registryProblem,
  spawnCommand,
} from "./propose-bun-update";

const MANIFEST = `{
  "dependencies": {
    "pkg": "1.0.0"
  }
}
`;
const BUMPED = MANIFEST.replace('"1.0.0"', '"1.0.1"');
const INTEGRITY = "sha512-AAAA";

interface LockShape {
  readonly workspaces?: unknown;
  readonly packages?: Record<string, unknown>;
  readonly [table: string]: unknown;
}

/** A lock of the shape bun writes: trailing commas included, as JSONC allows. */
const lockText = (shape: LockShape = {}): string =>
  `${JSON.stringify(
    {
      lockfileVersion: 1,
      workspaces: { "": { dependencies: { pkg: "1.0.1" } } },
      packages: { pkg: ["pkg@1.0.1", "", {}, INTEGRITY] },
      ...shape,
    },
    null,
    2,
  ).replace(/\n(\s*)([}\]])/g, ",\n$1$2")}\n`;

const BASE_LOCK = lockText({
  workspaces: { "": { dependencies: { pkg: "1.0.0" } } },
  packages: { pkg: ["pkg@1.0.0", "", {}, INTEGRITY] },
});
const LOCK = lockText();

const proposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  name: "pkg",
  from: "1.0.0",
  to: "1.0.1",
  kind: "patch",
  publishedAt: "2026-11-10T00:00:00.000Z",
  ageSeconds: MINIMUM_RELEASE_AGE_SECONDS,
  branch: "work/bun-update/pkg@1.0.1",
  manifests: ["package.json"],
  edits: [{ manifest: "package.json", section: "dependencies", from: "1.0.0" }],
  directory: "0",
  ...overrides,
});

const NOW = new Date("2026-11-18T00:00:00.000Z");
const NOTHING_PINNED = { overrides: new Set<string>(), memberNames: new Set<string>() };

/** What the registry answers for the proposal above. */
const registryAnswer = {
  name: "pkg",
  "dist-tags": { latest: "1.0.1" },
  versions: { "1.0.0": {}, "1.0.1": {} },
  time: { "1.0.0": "2026-01-01T00:00:00.000Z", "1.0.1": "2026-11-10T00:00:00.000Z" },
};
const registry = async (): Promise<unknown> => registryAnswer;

const accepted = "# ADR\n\n- **Statut :** accepted 2026-11-20\n\n## Contexte\n";
const proposed = "# ADR\n\n- **Statut :** proposé\n\n## Contexte\n";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function fixture(adr: string = accepted): { root: string; bundle: string } {
  const root = mkdtempSync(join(tmpdir(), "propose-bun-update-root-"));
  const bundle = mkdtempSync(join(tmpdir(), "propose-bun-update-bundle-"));
  directories.push(root, bundle);
  write(root, "package.json", MANIFEST);
  write(root, "bun.lock", BASE_LOCK);
  write(root, AUTHORIZING_ADR, adr);
  write(bundle, "0/package.json", BUMPED);
  write(bundle, "0/bun.lock", LOCK);
  write(bundle, "plan.json", JSON.stringify({ proposals: [proposal()] }));
  return { root, bundle };
}

const ok = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });

/** Answers every command, and records it, so a test can assert what was run. */
function recorder(answers: (command: readonly string[]) => CommandResult | null = () => null) {
  const commands: (readonly string[])[] = [];
  const options: (CommandOptions | undefined)[] = [];
  const run: CommandRunner = (command, option) => {
    commands.push(command);
    options.push(option);
    const answer = answers(command);
    if (answer !== null) return answer;
    if (command.includes("rev-parse")) return ok("abc123\n");
    if (command.includes("--name-only")) return ok("bun.lock\npackage.json\n");
    if (command.includes("create")) return ok("https://github.com/o/r/pull/1\n");
    return ok();
  };
  return { commands, options, run };
}

const context = (root: string, bundle: string) => ({
  root,
  bundle,
  repository: "o/r",
  base: "served",
  baseSha: "abc123",
});

const ARGUMENTS = (root: string, bundle: string): string[] => [
  "--root",
  root,
  "--bundle",
  bundle,
  "--repository",
  "o/r",
  "--base",
  "served",
];

describe("the authorizing ADR", () => {
  test("a proposed ADR does not authorize", () => {
    expect(isAuthorized(proposed)).toBe(false);
  });

  test("an accepted ADR authorizes", () => {
    expect(isAuthorized(accepted)).toBe(true);
  });

  test("the bare literal authorizes", () => {
    expect(isAuthorized("# ADR\n\n- **Statut :** accepted\n\n## Contexte\n")).toBe(true);
  });

  test.each([
    "accepted-with-reservations",
    "accepted sous réserve",
    "accepted 2026-11-20 sous réserve",
    "accepted 2026-13-45",
    "accepted 20-11-2026",
    "Accepted",
    "not accepted",
  ])("the status `%s` does not authorize", (status) => {
    expect(isAuthorized(`# ADR\n\n- **Statut :** ${status}\n\n## Contexte\n`)).toBe(false);
  });

  test("while it is not accepted, nothing runs at all", async () => {
    const { root, bundle } = fixture(proposed);
    const { commands, run } = recorder();
    expect(await main(ARGUMENTS(root, bundle), run, registry, NOW)).toBe(3);
    expect(commands).toEqual([]);
  });

  test("the ADR this tool names exists and is accepted (owner decision of 2026-11-19)", async () => {
    const text = await Bun.file(new URL(`../../${AUTHORIZING_ADR}`, import.meta.url)).text();
    expect(isAuthorized(text)).toBe(true);
  });
});

describe("proposalProblem", () => {
  const problem = (candidate: Proposal, root: string, bundle: string) =>
    proposalProblem(candidate, root, bundle, NOTHING_PINNED);

  test("accepts the bundle of a one-line bump", () => {
    const { root, bundle } = fixture();
    expect(problem(proposal(), root, bundle)).toBeNull();
  });

  test.each<[string, Partial<Proposal>]>([
    ["a major", { to: "2.0.0", kind: "major", branch: "work/bun-update/pkg@2.0.0" }],
    ["a declared class that is not the measured one", { kind: "minor" }],
    ["a branch outside the expected name", { branch: "migrate/recover-code" }],
    ["an age under the floor", { ageSeconds: MINIMUM_RELEASE_AGE_SECONDS - 1 }],
    ["an unsafe name", { name: "a;b", branch: "work/bun-update/a;b@1.0.1" }],
    ["an inexact version", { to: "^1.0.1" }],
    ["a directory that escapes the bundle", { directory: "../0" }],
    ["no manifest", { manifests: [] }],
    ["no declaration", { edits: [] }],
    ["a manifest no edit touches", { manifests: ["package.json", "packages/a/package.json"] }],
    ["a lowest version that is not the lowest", { from: "0.9.0" }],
    ["a date outside the ISO form", { publishedAt: "2026-11-10" }],
    ["a date carrying markup", { publishedAt: "[link](https://example.invalid)" }],
    [
      "a section that declares no dependency",
      {
        edits: [{ manifest: "package.json", section: "scripts" as "dependencies", from: "1.0.0" }],
      },
    ],
    [
      "a peer range",
      { edits: [{ manifest: "package.json", section: "peerDependencies", from: "1.0.0" }] },
    ],
  ])("refuses %s", (_label, overrides) => {
    const { root, bundle } = fixture();
    expect(problem(proposal(overrides), root, bundle)).not.toBeNull();
  });

  test.each([
    ["a descent", "1.5.0", "1.4.0"],
    ["a move to the same version", "1.5.0", "1.5.0"],
  ])("refuses %s", (_label, from, to) => {
    const { root, bundle } = fixture();
    write(root, "package.json", MANIFEST.replace('"1.0.0"', `"${from}"`));
    write(bundle, "0/package.json", MANIFEST.replace('"1.0.0"', `"${to}"`));
    const candidate = proposal({
      from,
      to,
      kind: "minor",
      branch: `work/bun-update/pkg@${to}`,
      edits: [{ manifest: "package.json", section: "dependencies", from }],
    });
    expect(problem(candidate, root, bundle)).toContain("does not move up");
  });

  test("names a manifest list that is not the edited one", () => {
    const { root, bundle } = fixture();
    const listed = proposal({ manifests: ["package.json", "packages/a/package.json"] });
    expect(problem(listed, root, bundle)).toContain("not the ones edited");
  });

  test("names a section that declares no dependency", () => {
    const { root, bundle } = fixture();
    const edits = [
      { manifest: "package.json", section: "scripts" as "dependencies", from: "1.0.0" },
    ];
    expect(problem(proposal({ edits }), root, bundle)).toContain("unexpected section");
  });

  test("refuses a package the workspace pins or provides, whatever the bundle says", () => {
    const { root, bundle } = fixture();
    const pinned = { ...NOTHING_PINNED, overrides: new Set(["pkg"]) };
    const member = { ...NOTHING_PINNED, memberNames: new Set(["pkg"]) };
    expect(proposalProblem(proposal(), root, bundle, pinned)).toContain("overrides");
    expect(proposalProblem(proposal(), root, bundle, member)).toContain("member");
  });

  test("refuses a major even when its bundle is otherwise coherent", () => {
    const { root, bundle } = fixture();
    write(bundle, "0/package.json", MANIFEST.replace('"1.0.0"', '"2.0.0"'));
    write(bundle, "0/bun.lock", LOCK.replaceAll("1.0.1", "2.0.0"));
    const major = proposal({ to: "2.0.0", kind: "major", branch: "work/bun-update/pkg@2.0.0" });
    expect(problem(major, root, bundle)).toContain("is a major");
  });

  test("refuses a manifest that carries more than the bump", () => {
    const { root, bundle } = fixture();
    write(bundle, "0/package.json", BUMPED.replace('"pkg"', '"scripts": {}, "pkg"'));
    expect(problem(proposal(), root, bundle)).toContain("one-line bump");
  });

  test("refuses a file the proposal does not name", () => {
    const { root, bundle } = fixture();
    write(bundle, "0/.github/workflows/ci.yml", "on: push\n");
    expect(problem(proposal(), root, bundle)).toContain("the bundle holds");
  });

  test("refuses a symbolic link in place of the lockfile", () => {
    const { root, bundle } = fixture();
    rmSync(join(bundle, "0/bun.lock"));
    // The target resolves the version, so only the link itself can be refused.
    write(root, "elsewhere.lock", LOCK);
    symlinkSync(join(root, "elsewhere.lock"), join(bundle, "0/bun.lock"));
    expect(problem(proposal(), root, bundle)).toContain("not a regular file");
  });

  test("refuses a lockfile that does not resolve the target", () => {
    const { root, bundle } = fixture();
    write(bundle, "0/bun.lock", LOCK.replace('"pkg@1.0.1"', '"pkg@1.0.0"'));
    expect(problem(proposal(), root, bundle)).toContain("does not resolve");
  });

  test("accepts declarations at two versions moving to one target", () => {
    const { root, bundle } = fixture();
    const member = MANIFEST.replace("1.0.0", "1.1.0");
    write(root, "packages/a/package.json", member);
    write(bundle, "0/packages/a/package.json", member.replace("1.1.0", "1.1.5"));
    write(bundle, "0/package.json", MANIFEST.replace("1.0.0", "1.1.5"));
    write(
      root,
      "bun.lock",
      lockText({
        workspaces: {
          "": { dependencies: { pkg: "1.0.0" } },
          "packages/a": { dependencies: { pkg: "1.1.0" } },
        },
        packages: { pkg: ["pkg@1.1.0", "", {}, INTEGRITY] },
      }),
    );
    write(
      bundle,
      "0/bun.lock",
      lockText({
        workspaces: {
          "": { dependencies: { pkg: "1.1.5" } },
          "packages/a": { dependencies: { pkg: "1.1.5" } },
        },
        packages: { pkg: ["pkg@1.1.5", "", {}, INTEGRITY] },
      }),
    );
    const grouped = proposal({
      to: "1.1.5",
      kind: "minor",
      branch: "work/bun-update/pkg@1.1.5",
      manifests: ["package.json", "packages/a/package.json"],
      edits: [
        { manifest: "package.json", section: "dependencies", from: "1.0.0" },
        { manifest: "packages/a/package.json", section: "dependencies", from: "1.1.0" },
      ],
    });
    expect(problem(grouped, root, bundle)).toBeNull();
  });
});

describe("lockProblem", () => {
  const withDependency = (shape: LockShape = {}): string =>
    lockText({
      packages: {
        pkg: ["pkg@1.0.1", "", { dependencies: { child: "2.0.0" } }, INTEGRITY],
        child: ["child@2.0.0", "", {}, INTEGRITY],
        other: ["other@1.0.0", "", {}, INTEGRITY],
      },
      ...shape,
    });
  const base = lockText({
    workspaces: { "": { dependencies: { pkg: "1.0.0" } } },
    packages: {
      pkg: ["pkg@1.0.0", "", { dependencies: { gone: "1.0.0" } }, INTEGRITY],
      gone: ["gone@1.0.0", "", {}, INTEGRITY],
      other: ["other@1.0.0", "", {}, INTEGRITY],
    },
  });

  test("accepts the target, its new dependency and the one it dropped", () => {
    expect(lockProblem(base, withDependency(), proposal())).toBeNull();
  });

  test("reads the trailing commas bun writes", () => {
    expect(BASE_LOCK).toContain("},\n");
    expect(lockProblem(BASE_LOCK, LOCK, proposal())).toBeNull();
  });

  test.each<[string, Record<string, unknown>, string]>([
    [
      "the target redirected to a third-party archive",
      { pkg: ["pkg@1.0.1", "https://example.invalid/pkg.tgz", {}, INTEGRITY] },
      "resolves to the URL",
    ],
    [
      "an untouched package redirected to a third-party archive",
      {
        pkg: ["pkg@1.0.1", "", {}, INTEGRITY],
        other: ["other@1.0.0", "https://example.invalid/o.tgz", {}, INTEGRITY],
      },
      "resolves to the URL",
    ],
    [
      "a package moved outside the closure of the target",
      {
        pkg: ["pkg@1.0.1", "", {}, INTEGRITY],
        other: ["other@6.6.6", "", {}, INTEGRITY],
      },
      "outside the dependencies",
    ],
    [
      "a package added outside the closure of the target",
      {
        pkg: ["pkg@1.0.1", "", {}, INTEGRITY],
        other: ["other@1.0.0", "", {}, INTEGRITY],
        extra: ["extra@1.0.0", "", {}, INTEGRITY],
      },
      "outside the dependencies",
    ],
    [
      "a package removed outside the closure of the target",
      { pkg: ["pkg@1.0.1", "", {}, INTEGRITY] },
      "removed outside",
    ],
    [
      "a dependency resolved from git",
      {
        pkg: ["pkg@1.0.1", "", { dependencies: { child: "1.0.0" } }, INTEGRITY],
        child: ["child@github:owner/child#abc", {}, "owner-child-abc"],
        other: ["other@1.0.0", "", {}, INTEGRITY],
      },
      "not a registry package",
    ],
    [
      "a dependency without an integrity",
      {
        pkg: ["pkg@1.0.1", "", { dependencies: { child: "1.0.0" } }, INTEGRITY],
        child: ["child@1.0.0", "", {}, ""],
        other: ["other@1.0.0", "", {}, INTEGRITY],
      },
      "not a registry package",
    ],
    [
      "a dependency aliased to another package",
      {
        pkg: ["pkg@1.0.1", "", { dependencies: { child: "1.0.0" } }, INTEGRITY],
        // As long as `child`, so that only the name can tell the two apart.
        child: ["evils@1.0.0", "", {}, INTEGRITY],
        other: ["other@1.0.0", "", {}, INTEGRITY],
      },
      "not a registry package",
    ],
  ])("refuses %s", (_label, packages, expected) => {
    expect(lockProblem(base, lockText({ packages }), proposal())).toContain(expected);
  });

  test.each([
    ["trustedDependencies", ["pkg"]],
    ["patchedDependencies", { "pkg@1.0.1": "patches/pkg.patch" }],
    ["overrides", { other: "6.6.6" }],
    ["lockfileVersion", 2],
  ])("refuses a changed %s table", (table, value) => {
    expect(lockProblem(base, withDependency({ [table]: value }), proposal())).toContain(
      `the table ${table} changed`,
    );
  });

  test("refuses a workspace declaration that is not the bump", () => {
    const moved = withDependency({
      workspaces: { "": { dependencies: { pkg: "1.0.1", extra: "1.0.0" } } },
    });
    expect(lockProblem(base, moved, proposal())).toContain("workspaces table");
  });

  test("refuses a lock that cannot be read", () => {
    expect(lockProblem(base, "not a lock", proposal())).toContain("cannot be read");
    expect(lockProblem(base, '{ "packages": { "pkg": "text" } }', proposal())).toContain(
      "cannot be read",
    );
    expect(lockProblem("not a lock", LOCK, proposal())).toContain("checkout");
  });

  test.each([
    "optionalDependencies",
    "peerDependencies",
  ])("a package the target reaches through %s is in its closure", (field) => {
    const reached = lockText({
      packages: {
        pkg: ["pkg@1.0.1", "", { [field]: { child: "2.0.0" } }, INTEGRITY],
        child: ["child@2.0.0", "", {}, INTEGRITY],
        other: ["other@1.0.0", "", {}, INTEGRITY],
      },
    });
    expect(lockProblem(base, reached, proposal())).toBeNull();
  });

  test("a package nested under another stands for the same dependency", () => {
    const nested = lockText({
      packages: {
        pkg: ["pkg@1.0.1", "", { dependencies: { "@s/child": "2.0.0" } }, INTEGRITY],
        "other/@s/child": ["@s/child@2.0.0", "", {}, INTEGRITY],
        other: ["other@1.0.0", "", {}, INTEGRITY],
      },
    });
    expect(lockProblem(base, nested, proposal())).toBeNull();
  });
});

describe("registryProblem", () => {
  const packument = (overrides: Partial<Packument> = {}): Packument => ({
    latest: "1.0.1",
    versions: [
      { version: "1.0.0", deprecated: false, publishedAt: "2026-01-01T00:00:00.000Z" },
      { version: "1.0.1", deprecated: false, publishedAt: "2026-11-10T00:00:00.000Z" },
    ],
    ...overrides,
  });

  test("accepts a target the registry confirms", () => {
    expect(registryProblem(proposal(), packument(), NOW)).toBeNull();
  });

  test("a registry without an answer refuses", () => {
    expect(registryProblem(proposal(), null, NOW)).toContain("no usable answer");
  });

  test("an invented target is refused, whatever age the bundle declares", () => {
    const invented = proposal({ to: "1.0.99", ageSeconds: 999_999_999 });
    expect(registryProblem(invented, packument(), NOW)).toContain("1.0.99 is not published");
  });

  test("a declared version the registry does not publish is refused", () => {
    const unknown = proposal({
      edits: [{ manifest: "package.json", section: "dependencies", from: "0.9.0" }],
    });
    expect(registryProblem(unknown, packument(), NOW)).toContain("0.9.0 is not published");
  });

  test("the age is the registry's, not the bundle's", () => {
    const young = new Date(Date.parse("2026-11-10T00:00:00.000Z") + 1000);
    const aged = proposal({ ageSeconds: 999_999_999 });
    expect(registryProblem(aged, packument(), young)).toContain("below");
  });

  test("the floor itself is old enough", () => {
    const floor = new Date(
      Date.parse("2026-11-10T00:00:00.000Z") + MINIMUM_RELEASE_AGE_SECONDS * 1000,
    );
    expect(registryProblem(proposal(), packument(), floor)).toBeNull();
  });

  test("a date the registry does not confirm is refused", () => {
    const other = proposal({ publishedAt: "2026-01-01T00:00:00.000Z" });
    expect(registryProblem(other, packument(), NOW)).toContain("the registry says");
  });

  test("a deprecated target is refused", () => {
    const versions = packument().versions.map((version) => ({ ...version, deprecated: true }));
    expect(registryProblem(proposal(), packument({ versions }), NOW)).toContain("deprecated");
  });

  test("a target above latest is refused", () => {
    expect(registryProblem(proposal(), packument({ latest: "1.0.0" }), NOW)).toContain(
      "above latest",
    );
  });

  test("a target without a readable date is refused", () => {
    const versions = packument().versions.map((version) => ({ ...version, publishedAt: null }));
    expect(registryProblem(proposal(), packument({ versions }), NOW)).toContain("no readable date");
  });
});

describe("openProposal", () => {
  test("signs off, pushes without force and never merges", () => {
    const { root, bundle } = fixture();
    const { commands, run } = recorder();
    expect(openProposal(proposal(), context(root, bundle), run).outcome).toBe("opened");
    const flat = commands.map((command) => command.join(" "));
    expect(flat.some((line) => line.includes("commit --quiet --signoff"))).toBe(true);
    const push = flat.find((line) => line.includes(" push "));
    expect(push).toContain("HEAD:refs/heads/work/bun-update/pkg@1.0.1");
    expect(push).not.toContain("--force");
    expect(push).not.toMatch(/ \+HEAD:/);
    expect(flat.some((line) => line.includes(" merge"))).toBe(false);
  });

  test("the token never reaches an argument", () => {
    const { root, bundle } = fixture();
    const { commands, run } = recorder();
    openProposal(proposal(), context(root, bundle), run);
    const push = commands.find((command) => command.includes("push")) ?? [];
    expect(push.join(" ")).toContain("$BUN_UPDATE_TOKEN");
  });

  test("only the commands that reach the forge are given the token", () => {
    const { root, bundle } = fixture();
    const { commands, options, run } = recorder();
    openProposal(proposal(), context(root, bundle), run);
    const holders = commands
      .filter((_command, index) => options[index]?.network === true)
      .map((command) => command.find((word) => ["ls-remote", "push", "create"].includes(word)));
    expect(holders).toEqual(["ls-remote", "push", "create"]);
    const local = commands.filter((_command, index) => options[index]?.network !== true);
    expect(local.length).toBeGreaterThan(0);
    for (const command of local) expect(command.join(" ")).not.toContain("BUN_UPDATE_TOKEN");
  });

  test("listing the pull requests of a branch reaches the forge too", () => {
    const { root, bundle } = fixture();
    const { commands, options, run } = recorder((command) => {
      if (command.includes("ls-remote")) return ok("abc\trefs/heads/x\n");
      if (command.includes("list")) return ok("1\n");
      return null;
    });
    openProposal(proposal(), context(root, bundle), run);
    expect(options[commands.findIndex((command) => command.includes("list"))]?.network).toBe(true);
  });

  test("a branch with an open pull request is left alone", () => {
    const { root, bundle } = fixture();
    const { commands, run } = recorder((command) => {
      if (command.includes("ls-remote")) return ok("abc\trefs/heads/x\n");
      if (command.includes("list")) return ok("1\n");
      return null;
    });
    expect(openProposal(proposal(), context(root, bundle), run).outcome).toBe("already-open");
    expect(commands.some((command) => command.includes("push"))).toBe(false);
  });

  test("a branch without a pull request fails by name, and is not overwritten", () => {
    const { root, bundle } = fixture();
    const { commands, run } = recorder((command) => {
      if (command.includes("ls-remote")) return ok("abc\trefs/heads/x\n");
      if (command.includes("list")) return ok("0\n");
      return null;
    });
    const result = openProposal(proposal(), context(root, bundle), run);
    expect(result.outcome).toBe("failed");
    expect(result.detail).toContain("compare/served...");
    expect(commands.some((command) => command.includes("push"))).toBe(false);
  });

  test("a commit that changes another file is not pushed", () => {
    const { root, bundle } = fixture();
    const { commands, run } = recorder((command) =>
      command.includes("--name-only") ? ok("bun.lock\npackage.json\nsrc/other.ts\n") : null,
    );
    expect(openProposal(proposal(), context(root, bundle), run).outcome).toBe("failed");
    expect(commands.some((command) => command.includes("push"))).toBe(false);
  });

  test("the repository setting that refuses the pull request is named", () => {
    const { root, bundle } = fixture();
    const { run } = recorder((command) =>
      command.includes("create")
        ? {
            code: 1,
            stdout: "",
            stderr: "GitHub Actions is not permitted to create or approve pull requests",
          }
        : null,
    );
    const result = openProposal(proposal(), context(root, bundle), run);
    expect(result.outcome).toBe("refused");
    expect(result.detail).toContain("Allow GitHub Actions to create and approve pull requests");
  });
});

describe("the pull request description", () => {
  test("passes the Door gate as written", () => {
    const report = evaluateDoor(
      pullRequestBody(proposal()),
      "bump",
      "github-actions[bot]",
      new Date("2026-11-18"),
    );
    expect(report.violations).toEqual([]);
    expect(report.outcome).toBe("pass");
  });

  test("tells the reviewer how to start the checks", () => {
    expect(pullRequestBody(proposal())).toContain("Approve workflows to run");
  });

  test("names every declared version a grouped bump moves", () => {
    const grouped = proposal({
      edits: [
        { manifest: "package.json", section: "dependencies", from: "1.0.0" },
        { manifest: "packages/a/package.json", section: "dependencies", from: "1.0.0" },
        { manifest: "packages/b/package.json", section: "dependencies", from: "0.9.0" },
      ],
    });
    expect(pullRequestBody(grouped)).toContain("from `1.0.0`, `0.9.0` to `1.0.1`");
  });
});

describe("spawnCommand", () => {
  const PROBE = ["sh", "-c", 'echo "[$BUN_UPDATE_TOKEN] [$GH_TOKEN]"'];

  afterEach(() => {
    delete process.env.BUN_UPDATE_TOKEN;
    delete process.env.GH_TOKEN;
  });

  test("a local command receives neither token", () => {
    process.env.BUN_UPDATE_TOKEN = "one";
    process.env.GH_TOKEN = "two";
    expect(spawnCommand(PROBE).stdout.trim()).toBe("[] []");
  });

  test("a command that reaches the forge receives both", () => {
    process.env.BUN_UPDATE_TOKEN = "one";
    process.env.GH_TOKEN = "two";
    expect(spawnCommand(PROBE, { network: true }).stdout.trim()).toBe("[one] [two]");
  });
});

describe("the command", () => {
  test("commits under the identity of the job token", async () => {
    const { root, bundle } = fixture();
    const { commands, run } = recorder();
    expect(await main(ARGUMENTS(root, bundle), run, registry, NOW)).toBe(0);
    const flat = commands.map((command) => command.join(" "));
    expect(flat).toContain(`git -C ${root} config --local user.name ${BOT_IDENTITY.name}`);
    expect(flat).toContain(`git -C ${root} config --local user.email ${BOT_IDENTITY.email}`);
  });

  test("a refused bundle fails the run and writes nothing", async () => {
    const { root, bundle } = fixture();
    write(bundle, "0/bun.lock", "{}\n");
    const { commands, run } = recorder();
    expect(await main(ARGUMENTS(root, bundle), run, registry, NOW)).toBe(1);
    expect(commands.some((command) => command.includes("push"))).toBe(false);
  });

  test("a refused bundle's name never reaches the registry", async () => {
    const { root, bundle } = fixture();
    write(bundle, "0/bun.lock", "{}\n");
    let asked = 0;
    const counting = async (): Promise<unknown> => {
      asked += 1;
      return registryAnswer;
    };
    await main(ARGUMENTS(root, bundle), recorder().run, counting, NOW);
    expect(asked).toBe(0);
  });

  test.each<[string, () => Promise<unknown>]>([
    [
      "is silent",
      async () => {
        throw new Error("offline");
      },
    ],
    ["answers about another package", async () => ({ ...registryAnswer, name: "other" })],
    ["does not publish the target", async () => ({ ...registryAnswer, versions: { "1.0.0": {} } })],
    [
      "dates the target under the floor",
      async () => ({
        ...registryAnswer,
        time: { ...registryAnswer.time, "1.0.1": "2026-11-17T00:00:00.000Z" },
      }),
    ],
  ])("nothing is pushed when the registry %s", async (_label, read) => {
    const { root, bundle } = fixture();
    const { commands, run } = recorder();
    expect(await main(ARGUMENTS(root, bundle), run, read, NOW)).toBe(1);
    expect(commands.some((command) => command.includes("push"))).toBe(false);
  });

  test("a workspace that cannot be read refuses every proposal", async () => {
    const { root, bundle } = fixture();
    // Otherwise a valid bump: only the unreadable `workspaces` field can refuse it.
    const negated = (text: string) => text.replace("{\n", '{\n  "workspaces": ["!packages/a"],\n');
    write(root, "package.json", negated(MANIFEST));
    write(bundle, "0/package.json", negated(BUMPED));
    const { commands, run } = recorder();
    expect(await main(ARGUMENTS(root, bundle), run, registry, NOW)).toBe(1);
    expect(commands.some((command) => command.includes("push"))).toBe(false);
  });

  test("a missing argument is a usage error", async () => {
    expect(await main(["--root", "x"], recorder().run, registry, NOW)).toBe(2);
  });
});
