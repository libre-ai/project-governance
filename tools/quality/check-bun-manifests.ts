import {
  FIXED_MANIFEST_PATTERNS,
  pathToRoot,
  reconcileManifests,
  scanManifestPatterns,
  trackedNestedManifests,
  workspaceManifestPatterns,
} from "./bun-manifest-discovery";
import {
  FLOOR_HOOK,
  findFloorBypasses,
  findNestedHookViolations,
  findRootFloorViolations,
  floorBypassNote,
} from "./bun-script-floor";
import { isBunVersionAtLeast } from "./bun-version";
import { concludeGate, GateReport } from "./gate-report";

interface PackageManifest {
  name?: string;
  packageManager?: string;
  engines?: { bun?: string };
  scripts?: Record<string, string>;
  workspaces?: unknown;
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
// A nested manifest resolves the same two tooling bases through the path
// back to the root ("../.." for apps/*/ and packages/*/): a
// repository that still carries its own top-level tools/quality/ (the hub
// during dismantling, or a repository that never split it out) keeps the
// pre-dispatch form; a repository whose only tools/quality/ is the pinned
// governance git-dep (every product repository after its ADR-0020 general
// activation) uses the node_modules form. Accepting both is additive
// tolerance, not a weakened check: a manifest still fails if it names
// neither.

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
// build step simply do not declare them; when declared, they are bound —
// `findRootFloorViolations` below holds them to `bun run check:bun && `
// chained only by `&&`.
if (root.scripts?.check === undefined) {
  failures.push("package.json: check is required");
}
if (root.scripts?.pretest !== FLOOR_HOOK) {
  failures.push("package.json: pretest must enforce the Bun floor");
}
for (const violation of findRootFloorViolations(root.scripts ?? {})) {
  failures.push(`package.json: ${violation.note}`);
}
// Declaring `pretest` is not the same as firing it: bun fires a `pre<script>`
// hook only for `bun run <script>`. Everything above asserts the hook exists
// and reads exactly right; this asserts something invokes it — the hook, or
// the root runtime floor bound above (`check:bun:runtime`) run first.
const ROOT_FLOOR_SCRIPT = "check:bun:runtime";
for (const script of findFloorBypasses(root.scripts ?? {}, ROOT_FLOOR_SCRIPT)) {
  failures.push(`package.json: ${floorBypassNote(script, ROOT_FLOOR_SCRIPT)}`);
}

const NESTED_FLOOR_SCRIPT = "check:bun";
const workspaces = workspaceManifestPatterns(root.workspaces);
for (const failure of workspaces.failures) failures.push(`package.json: ${failure}`);
const manifestPatterns = [...new Set([...FIXED_MANIFEST_PATTERNS, ...workspaces.patterns])];
const workspaceMatched = await scanManifestPatterns(".", manifestPatterns);
let tracked: string[] = [];
try {
  tracked = trackedNestedManifests(".");
} catch (error) {
  // A tree the gate cannot list is a failure, never an empty tree.
  failures.push(`git ls-files: ${error instanceof Error ? error.message : String(error)}`);
}
const inventory = reconcileManifests(tracked, workspaceMatched);

for (const path of inventory.read) {
  let manifest: PackageManifest;
  try {
    manifest = (await Bun.file(path).json()) as PackageManifest;
  } catch (error) {
    failures.push(`${path}: unreadable (${error instanceof Error ? error.message : error})`);
    continue;
  }
  const scripts = manifest.scripts ?? {};
  const template = path.startsWith("distribution/templates/");
  // The tooling bases resolve from the manifest's own directory, at whatever
  // depth a workspace pattern placed it (`apps/x` is `../..`, a
  // `crates/x/y` member `../../..`). Both forms stay accepted, as before.
  const up = pathToRoot(path);
  const nestedCheckForms = TOOLING.map((base) => `bun ${up}/${base}/check-bun-minimum.ts`);
  const expectedCheckForms = template ? ["bun scripts/check-bun-version.ts"] : nestedCheckForms;

  if (manifest.engines?.bun !== expectedEngine) {
    failures.push(`${path}: engines.bun must be ${expectedEngine}`);
  }
  if (template && manifest.packageManager !== selectedPackageManager) {
    failures.push(`${path}: packageManager must be ${selectedPackageManager}`);
  }
  // A manifest with no scripts cannot run anything through `bun run`, so it
  // has no floor to lay: it is held to the engine pin only. Any script brings
  // the whole floor contract back.
  if (Object.keys(scripts).length === 0 && !template) continue;
  if (!expectedCheckForms.includes(scripts["check:bun"] ?? "")) {
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
  for (const violation of findNestedHookViolations(scripts)) {
    failures.push(`${path}: ${violation.note}`);
  }
  // The nested requirement above is existence only — a manifest satisfies it
  // while no path ever fires the hook, which is the state this workspace
  // manifest was in on 2026-10-09 (`check` was a bare `bun test src`). The
  // floor the gate is supposed to lay was therefore never verified for it.
  // A nested manifest's runtime floor is its own `check:bun`, bound above to
  // the runtime minimum check (or the template's standalone guard).
  for (const script of findFloorBypasses(scripts, NESTED_FLOOR_SCRIPT)) {
    failures.push(`${path}: ${floorBypassNote(script, NESTED_FLOOR_SCRIPT)}`);
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
    `root + ${inventory.read.length} nested manifest(s) require ${expectedEngine}`,
  );
}
report.volume(
  `1 root manifest and ${inventory.read.length} nested manifest(s) read ` +
    `(${inventory.tracked} tracked by git, ${inventory.workspaceMatched} matched by ` +
    `${manifestPatterns.length} workspace pattern(s), ${inventory.untracked} untracked; ` +
    `${inventory.skippedNodeModules.length} skipped under node_modules, ` +
    `${inventory.universe} named by either source), ` +
    `${Object.keys(root.scripts ?? {}).length} root script(s) inspected for the Bun floor, ` +
    `against engines ${expectedEngine} and ${selectedPackageManager}`,
);
concludeGate("Bun manifests", report);
