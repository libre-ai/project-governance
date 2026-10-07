import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * SOV-02 forge-restore (sovereignty.v1): direct realization of invariant I-12
 * (git exports prevent any irreversible data dependency on the forge). The
 * check exercises the actual escape hatch — `git bundle create` from the
 * current clone, restore into a pristine directory — and verifies that both
 * the HEAD commit and its tree hash survive the round-trip. Hashes (not file
 * listings) keep the published evidence small and tamper-evident.
 */
export interface ForgeRestoreData {
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly restoredCommit: string;
  readonly restoredTree: string;
}

export type ForgeRestoreOutcome =
  | { readonly kind: "verified"; readonly data: ForgeRestoreData }
  | { readonly kind: "failed"; readonly detail: string; readonly data: ForgeRestoreData | null };

async function git(args: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0) {
    const firstLine = stderr.split("\n").find((line) => line.trim() !== "") ?? "no stderr";
    throw new Error(`git ${args[0] ?? ""} exited ${code}: ${firstLine}`);
  }
  return stdout.trim();
}

export async function runForgeRestore(repoRoot: string): Promise<ForgeRestoreOutcome> {
  const workDir = await mkdtemp(join(tmpdir(), "sovereignty-forge-restore-"));
  // Failure details are published in committed evidence: scrub machine-local
  // paths (work directory, repository root) from anything git may echo back.
  const scrub = (message: string): string =>
    message.replaceAll(workDir, "<tmp>").replaceAll(repoRoot, "<repo>");
  try {
    const bundlePath = join(workDir, "forge.bundle");
    const restorePath = join(workDir, "restore");
    await git(["bundle", "create", bundlePath, "HEAD"], repoRoot);
    await git(["clone", "--quiet", bundlePath, restorePath], workDir);
    const data: ForgeRestoreData = {
      sourceCommit: await git(["rev-parse", "HEAD"], repoRoot),
      sourceTree: await git(["rev-parse", "HEAD^{tree}"], repoRoot),
      restoredCommit: await git(["rev-parse", "HEAD"], restorePath),
      restoredTree: await git(["rev-parse", "HEAD^{tree}"], restorePath),
    };
    if (data.restoredCommit !== data.sourceCommit || data.restoredTree !== data.sourceTree) {
      return {
        kind: "failed",
        detail: "restored HEAD does not match the source clone (commit or tree hash differs)",
        data,
      };
    }
    return { kind: "verified", data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "failed", detail: scrub(message), data: null };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
