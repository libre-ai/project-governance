import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MINIMUM_RELEASE_AGE_SECONDS } from "../../ecosystem/check-release-age";
import { evaluateDoor } from "../quality/check-pr-door";
import type { Proposal } from "./plan-bun-update";
import {
  AUTHORIZING_ADR,
  BOT_IDENTITY,
  type CommandResult,
  type CommandRunner,
  isAuthorized,
  main,
  openProposal,
  proposalProblem,
  pullRequestBody,
} from "./propose-bun-update";

const MANIFEST = `{
  "dependencies": {
    "pkg": "1.0.0"
  }
}
`;
const BUMPED = MANIFEST.replace('"1.0.0"', '"1.0.1"');
const LOCK = '{ "packages": { "pkg": ["pkg@1.0.1"] } }\n';

const proposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  name: "pkg",
  from: "1.0.0",
  to: "1.0.1",
  kind: "patch",
  publishedAt: "2026-11-10T00:00:00.000Z",
  ageSeconds: MINIMUM_RELEASE_AGE_SECONDS,
  branch: "work/bun-update/pkg@1.0.1",
  manifests: ["package.json"],
  directory: "0",
  ...overrides,
});

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
  write(root, "bun.lock", "{}\n");
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
  const run: CommandRunner = (command) => {
    commands.push(command);
    const answer = answers(command);
    if (answer !== null) return answer;
    if (command.includes("rev-parse")) return ok("abc123\n");
    if (command.includes("--name-only")) return ok("bun.lock\npackage.json\n");
    if (command.includes("create")) return ok("https://github.com/o/r/pull/1\n");
    return ok();
  };
  return { commands, run };
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

  test("while it is not accepted, nothing runs at all", () => {
    const { root, bundle } = fixture(proposed);
    const { commands, run } = recorder();
    expect(main(ARGUMENTS(root, bundle), run)).toBe(3);
    expect(commands).toEqual([]);
  });

  test("the ADR this tool names exists and is not accepted yet", async () => {
    const text = await Bun.file(new URL(`../../${AUTHORIZING_ADR}`, import.meta.url)).text();
    expect(isAuthorized(text)).toBe(false);
  });
});

describe("proposalProblem", () => {
  test("accepts the bundle of a one-line bump", () => {
    const { root, bundle } = fixture();
    expect(proposalProblem(proposal(), root, bundle)).toBeNull();
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
  ])("refuses %s", (_label, overrides) => {
    const { root, bundle } = fixture();
    expect(proposalProblem(proposal(overrides), root, bundle)).not.toBeNull();
  });

  test("refuses a major even when its bundle is otherwise coherent", () => {
    const { root, bundle } = fixture();
    write(bundle, "0/package.json", MANIFEST.replace('"1.0.0"', '"2.0.0"'));
    write(bundle, "0/bun.lock", '{ "packages": { "pkg": ["pkg@2.0.0"] } }\n');
    const major = proposal({ to: "2.0.0", kind: "major", branch: "work/bun-update/pkg@2.0.0" });
    expect(proposalProblem(major, root, bundle)).toContain("is a major");
  });

  test("refuses a manifest that carries more than the bump", () => {
    const { root, bundle } = fixture();
    write(bundle, "0/package.json", BUMPED.replace('"pkg"', '"scripts": {}, "pkg"'));
    expect(proposalProblem(proposal(), root, bundle)).toContain("one-line bump");
  });

  test("refuses a file the proposal does not name", () => {
    const { root, bundle } = fixture();
    write(bundle, "0/.github/workflows/ci.yml", "on: push\n");
    expect(proposalProblem(proposal(), root, bundle)).toContain("the bundle holds");
  });

  test("refuses a symbolic link in place of the lockfile", () => {
    const { root, bundle } = fixture();
    rmSync(join(bundle, "0/bun.lock"));
    // The target resolves the version, so only the link itself can be refused.
    write(root, "elsewhere.lock", LOCK);
    symlinkSync(join(root, "elsewhere.lock"), join(bundle, "0/bun.lock"));
    expect(proposalProblem(proposal(), root, bundle)).toContain("not a regular file");
  });

  test("refuses a lockfile that does not resolve the target", () => {
    const { root, bundle } = fixture();
    write(bundle, "0/bun.lock", "{}\n");
    expect(proposalProblem(proposal(), root, bundle)).toContain("does not resolve");
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
});

describe("the command", () => {
  test("commits under the identity of the job token", () => {
    const { root, bundle } = fixture();
    const { commands, run } = recorder();
    expect(main(ARGUMENTS(root, bundle), run)).toBe(0);
    const flat = commands.map((command) => command.join(" "));
    expect(flat).toContain(`git -C ${root} config --local user.name ${BOT_IDENTITY.name}`);
    expect(flat).toContain(`git -C ${root} config --local user.email ${BOT_IDENTITY.email}`);
  });

  test("a refused bundle fails the run and writes nothing", () => {
    const { root, bundle } = fixture();
    write(bundle, "0/bun.lock", "{}\n");
    const { commands, run } = recorder();
    expect(main(ARGUMENTS(root, bundle), run)).toBe(1);
    expect(commands.some((command) => command.includes("push"))).toBe(false);
  });

  test("a missing argument is a usage error", () => {
    expect(main(["--root", "x"], recorder().run)).toBe(2);
  });
});
