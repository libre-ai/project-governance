export {};

interface BunToolchain {
  version: string;
  revision: string;
  sourceCommit: string;
  preRelease: boolean;
}

async function readToolchainPolicy(): Promise<BunToolchain> {
  // The toolchain contract is fleet governance: local file first (the
  // governance repository itself, and the hub during dismantling), then the
  // pinned governance git-dep (satellite consumers, design §5.3).
  for (const path of [
    "toolchains/bun.json",
    "node_modules/@libre-ai/governance/toolchains/bun.json",
  ]) {
    const file = Bun.file(path);
    if (await file.exists()) return (await file.json()) as BunToolchain;
  }
  throw new Error("toolchains/bun.json not found locally nor in the governance git-dep");
}

const expected = await readToolchainPolicy();
const revisionResult = Bun.spawnSync({
  cmd: [process.execPath, "--revision"],
  stdout: "pipe",
  stderr: "pipe",
});

if (revisionResult.exitCode !== 0) {
  throw new Error("Unable to read the Bun revision");
}

const actualVersion = Bun.version;
const actualRevision = revisionResult.stdout.toString().trim();
const failures: string[] = [];

if (actualVersion !== expected.version) {
  failures.push(`Bun version ${actualVersion} does not match ${expected.version}`);
}
if (actualRevision !== expected.revision) {
  failures.push(`Bun revision ${actualRevision} does not match ${expected.revision}`);
}
if (!actualRevision.includes(expected.sourceCommit.slice(0, 9))) {
  failures.push("Bun revision does not contain the pinned source commit");
}

const { concludeGate, GateReport } = await import("./gate-report");
const report = new GateReport();
for (const failure of failures) report.check("bun toolchain", false, failure);
if (failures.length === 0) {
  report.check("bun toolchain", true, `revision ${actualRevision} matches the declared toolchain`);
}
concludeGate("Bun toolchain", report);
