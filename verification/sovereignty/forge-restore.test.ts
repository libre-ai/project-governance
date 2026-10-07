import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runForgeRestore } from "./forge-restore";

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function git(args: readonly string[], cwd: string): Promise<void> {
  // Explicit identity and no signing: the test must not depend on the local
  // or CI git configuration.
  const proc = Bun.spawn(
    [
      "git",
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.org",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed in test setup (exit ${code})`);
  }
}

describe("runForgeRestore", () => {
  test("bundle + restore of a synthetic repository verifies HEAD and tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "sovereignty-sov02-test-"));
    created.push(root);
    const source = join(root, "source");
    await git(["init", "--quiet", source], root);
    await writeFile(join(source, "README.md"), "# synthetic forge\n");
    await git(["add", "README.md"], source);
    await git(["commit", "--quiet", "-m", "initial commit"], source);

    const outcome = await runForgeRestore(source);
    expect(outcome.kind).toBe("verified");
    if (outcome.kind !== "verified") {
      throw new Error(outcome.detail);
    }
    expect(outcome.data.restoredCommit).toBe(outcome.data.sourceCommit);
    expect(outcome.data.restoredTree).toBe(outcome.data.sourceTree);
    expect(outcome.data.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(outcome.data.sourceTree).toMatch(/^[0-9a-f]{40}$/);
  });

  test("fails cleanly when the directory is not a git repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "sovereignty-sov02-test-"));
    created.push(root);
    const outcome = await runForgeRestore(root);
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") {
      throw new Error("expected a failed outcome");
    }
    // Failure details land in committed evidence: no machine-local temp path
    // may leak through them.
    expect(outcome.detail).not.toContain(tmpdir());
  });
});
