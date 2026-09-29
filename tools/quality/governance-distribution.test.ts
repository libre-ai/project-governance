import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repositoryRoot = resolve(import.meta.dir, "../..");
const protocolPath = "docs/reviews/AGENT-REVIEW-PROTOCOL.md";

test("the distributed package preserves the review protocol required by consumers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "governance-distribution-"));
  const archive = join(directory, "governance.tgz");
  try {
    // Exercise the actual package boundary; checking package.json alone cannot
    // prove that an installed consumer receives the canonical review authority.
    await execute(
      process.execPath,
      ["pm", "pack", "--ignore-scripts", "--filename", archive, "--quiet"],
      { cwd: repositoryRoot, timeout: 15_000 },
    );
    const { stdout: members } = await execute("tar", ["-tzf", archive], { timeout: 5_000 });
    expect(members.split("\n")).toContain(`package/${protocolPath}`);
    const { stdout: distributed } = await execute(
      "tar",
      ["-xOzf", archive, `package/${protocolPath}`],
      {
        timeout: 5_000,
      },
    );
    expect(distributed).toBe(await readFile(join(repositoryRoot, protocolPath), "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
