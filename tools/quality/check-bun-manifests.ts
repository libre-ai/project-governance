import { isBunVersionAtLeast } from "./bun-version";
import { concludeGate, GateReport } from "./gate-report";

interface PackageManifest {
  name?: string;
  packageManager?: string;
  engines?: { bun?: string };
  scripts?: Record<string, string>;
}

interface BunToolchainPolicy {
  minimumVersion: string;
  version: string;
  revision: string;
}

async function readToolchainPolicy(): Promise<BunToolchainPolicy> {
  // The toolchain contract is fleet governance: local file first (the
  // governance repository itself, and the hub during dismantling), then the
  // pinned governance git-dep (satellite consumers, design §5.3).
  for (const path of [
    "toolchains/bun.json",
    "node_modules/@libre-ai/governance/toolchains/bun.json",
  ]) {
    const file = Bun.file(path);
    if (await file.exists()) return (await file.json()) as BunToolchainPolicy;
  }
  throw new Error("toolchains/bun.json not found locally nor in the governance git-dep");
}

const policy = await readToolchainPolicy();
const expectedEngine = `>=${policy.minimumVersion}`;
const selectedPackageManager = `bun@${policy.revision.split("+")[0]}`;
const root = (await Bun.file("package.json").json()) as PackageManifest;
const failures: string[] = [];

// Consumers of the governance tooling git-dep (pinned github:libre-ai/
// governance#<sha>, ADR-0020 §2.5 / design §5.3) run the same scripts from
// node_modules — both forms satisfy the root contract.
const TOOLING = ["tools/quality", "node_modules/@libre-ai/governance/tools/quality"];
const runtimeForms = TOOLING.map((base) => `bun ${base}/check-bun-minimum.ts`);
const manifestForms = TOOLING.map(
  (base) => `bun run check:bun:runtime && bun ${base}/check-bun-manifests.ts`,
);
// An apps/*/ or packages/*/ manifest sits one directory below the root, so
// the same two tooling bases resolve from there through "../..": a
// repository that still carries its own top-level tools/quality/ (the hub
// during dismantling, or a repository that never split it out) keeps the
// pre-dispatch form; a repository whose only tools/quality/ is the pinned
// governance git-dep (every product repository after its ADR-0020 general
// activation) uses the node_modules form. Accepting both is additive
// tolerance, not a weakened check: a manifest still fails if it names
// neither.
const NESTED_TOOLING_BASES = TOOLING.map((base) => `../../${base}`);

if (!isBunVersionAtLeast(policy.version, policy.minimumVersion)) {
  failures.push("toolchains/bun.json: selected version is below the minimum");
}
if (root.packageManager !== selectedPackageManager) {
  failures.push(`package.json: packageManager must be ${selectedPackageManager}`);
}
if (root.engines?.bun !== expectedEngine) {
  failures.push(`package.json: engines.bun must be ${expectedEngine}`);
}
if (!runtimeForms.includes(root.scripts?.["check:bun:runtime"] ?? "")) {
  failures.push("package.json: check:bun:runtime must verify the active Bun process");
}
if (!manifestForms.includes(root.scripts?.["check:bun"] ?? "")) {
  failures.push("package.json: check:bun must verify runtime and workspace manifests");
}
// check:toolchain and build are optional since the governance split
// (ADR-0020): single-package repositories without a Rust toolchain or a
// build step simply do not declare them; when declared, they are bound.
for (const script of ["check:toolchain", "build", "check"]) {
  const command = root.scripts?.[script];
  if (script === "check" && command === undefined) {
    failures.push("package.json: check is required");
    continue;
  }
  if (command !== undefined && !command.startsWith("bun run check:bun && ")) {
    failures.push(`package.json: ${script} must enforce the Bun floor first`);
  }
}
if (root.scripts?.pretest !== "bun run check:bun") {
  failures.push("package.json: pretest must enforce the Bun floor");
}
for (const [name, command] of Object.entries(root.scripts ?? {})) {
  if (
    name.startsWith("pre") ||
    ["check:bun:runtime", "check:bun", "check:toolchain", "build", "check", "test"].includes(name)
  ) {
    continue;
  }
  if (!command.startsWith("bun run check:bun:runtime && ")) {
    failures.push(`package.json: ${name} must enforce the Bun floor first`);
  }
}

const manifestPaths = new Set<string>();
for (const pattern of [
  "apps/*/package.json",
  "packages/*/package.json",
  "distribution/templates/*/package.json",
]) {
  const glob = new Bun.Glob(pattern);
  for await (const path of glob.scan({ cwd: ".", onlyFiles: true })) manifestPaths.add(path);
}

for (const path of [...manifestPaths].sort()) {
  const manifest = (await Bun.file(path).json()) as PackageManifest;
  const template = path.startsWith("distribution/templates/");
  const nestedCheckForms = NESTED_TOOLING_BASES.map((base) => `bun ${base}/check-bun-minimum.ts`);
  const expectedCheckForms = template ? ["bun scripts/check-bun-version.ts"] : nestedCheckForms;

  if (manifest.engines?.bun !== expectedEngine) {
    failures.push(`${path}: engines.bun must be ${expectedEngine}`);
  }
  if (template && manifest.packageManager !== selectedPackageManager) {
    failures.push(`${path}: packageManager must be ${selectedPackageManager}`);
  }
  if (!expectedCheckForms.includes(manifest.scripts?.["check:bun"] ?? "")) {
    failures.push(`${path}: check:bun must be one of ${expectedCheckForms.join(" or ")}`);
  }
  if (template) {
    const guardSource = await Bun.file(
      path.replace(/package\.json$/, "scripts/check-bun-version.ts"),
    ).text();
    if (!guardSource.includes(`const MINIMUM_BUN_VERSION = "${policy.minimumVersion}";`)) {
      failures.push(`${path}: standalone Bun guard must match ${expectedEngine}`);
    }
  }
  for (const script of Object.keys(manifest.scripts ?? {})) {
    if (script === "check:bun" || script.startsWith("pre")) continue;
    if (manifest.scripts?.[`pre${script}`] !== "bun run check:bun") {
      failures.push(`${path}: pre${script} must enforce the Bun floor`);
    }
  }
}

// Zero workspace manifests is the normal state of a single-package
// repository after the workspace split (D07 as amended by ADR-0020); the
// root contract above still applies — which is why this gate can never be
// empty: the root manifest check below is always asserted.

const report = new GateReport();
for (const failure of failures) {
  const colon = failure.indexOf(":");
  report.check(failure.slice(0, colon), false, failure.slice(colon + 2));
}
if (failures.length === 0) {
  report.check(
    "package.json",
    true,
    `root + ${manifestPaths.size} package/template manifests require ${expectedEngine}`,
  );
}
concludeGate("Bun manifests", report);
