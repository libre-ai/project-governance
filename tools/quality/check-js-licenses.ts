import { concludeGate, GateReport } from "./gate-report";

/**
 * Licences acceptable for INBOUND THIRD-PARTY code. This is a supply-chain
 * decision: each entry is a licence the fleet has reviewed and accepts from
 * code it did not write.
 */
const allowed = new Set([
  "MIT",
  "Apache-2.0",
  // Bytecode Alliance's permissive Apache grant plus LLVM linking exception.
  "(Apache-2.0 WITH LLVM-exception)",
  "MIT OR Apache-2.0",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
]);

/**
 * Licences the fleet itself publishes under. A first-party package carrying
 * one of these is not an intake decision — it is this organisation's own code
 * under its own terms, and EUPL-1.2 reciprocity is the point of it, not a
 * defect. Listing them in `allowed` would have accepted EUPL-1.2 from an
 * arbitrary upstream too, which is a different and unreviewed decision.
 */
const firstPartyLicences = new Set(["EUPL-1.2", "Apache-2.0", "CC-BY-4.0"]);

/**
 * First-party is decided by RESOLVED SOURCE, never by package name. A name in
 * the `@libre-ai/` scope proves nothing: anyone can publish that scope, and
 * treating the string as provenance would turn this gate into a name check an
 * attacker controls. `bun.lock` records where each package actually came from,
 * so only packages resolved from `github:libre-ai/` are first-party here.
 */
async function firstPartyFromLockfile(): Promise<ReadonlySet<string>> {
  const names = new Set<string>();
  const lock = Bun.file("bun.lock");
  if (!(await lock.exists())) return names;
  const text = await lock.text();
  for (const match of text.matchAll(/"(@?[^"]+)":\s*\[\s*"[^"]*@(github:libre-ai\/|workspace:)/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

const firstParty = await firstPartyFromLockfile();

/**
 * The installed package a manifest path belongs to — the segment right after
 * the LAST `node_modules/`, scope included.
 *
 * A git-dep installs a whole repository, so manifests of its own workspace
 * members appear inside its tree (`.../@libre-ai/contracts-authority/packages/
 * envelope/package.json`). Those are not installed dependencies and were never
 * resolved by this repository: they are files of the first-party package that
 * owns the path, and they inherit its provenance. Judging them on their own
 * name would again make the gate trust a string.
 */
function owningPackage(path: string): string | undefined {
  const index = path.lastIndexOf("node_modules/");
  if (index < 0) return undefined;
  const parts = path.slice(index + "node_modules/".length).split("/");
  const first = parts[0];
  if (first === undefined) return undefined;
  if (first.startsWith("@")) {
    const second = parts[1];
    return second === undefined ? undefined : `${first}/${second}`;
  }
  return first;
}

const failures: string[] = [];
const checked = new Set<string>();
const glob = new Bun.Glob("node_modules/**/package.json");

for await (const path of glob.scan({ cwd: ".", dot: true, onlyFiles: true })) {
  let manifest: { name?: string; version?: string; license?: string };
  try {
    manifest = await Bun.file(path).json();
  } catch {
    failures.push(`${path}: invalid package manifest`);
    continue;
  }

  if (!manifest.name || !manifest.version) continue;
  const id = `${manifest.name}@${manifest.version}`;
  if (checked.has(id)) continue;
  checked.add(id);

  if (!manifest.license) {
    failures.push(`${id}: missing license`);
  } else if (allowed.has(manifest.license)) {
    // Reviewed third-party licence.
  } else if (
    firstPartyLicences.has(manifest.license) &&
    (firstParty.has(manifest.name) || firstParty.has(owningPackage(path) ?? ""))
  ) {
    // First-party by resolved source — either itself, or the package whose
    // installed tree this manifest lives in.
  } else {
    failures.push(`${id}: forbidden or unreviewed license ${manifest.license}`);
  }
}

const report = new GateReport();
for (const failure of failures) {
  const subject = failure.slice(0, failure.indexOf(":"));
  report.check(subject, false, failure.slice(subject.length + 2));
}
if (failures.length === 0) {
  // An empty node_modules is not a clean audit — it is an audit of nothing.
  report.check(
    "installed JavaScript dependencies",
    checked.size > 0,
    checked.size > 0
      ? `${checked.size} dependencies, every license in the allowed set`
      : "no installed dependency found — run bun install before auditing licenses",
  );
}
report.volume(
  `${checked.size} installed dependenc${checked.size === 1 ? "y" : "ies"} audited against ` +
    `${allowed.size} allowed licence(s), ${firstParty.size} first-party package(s) resolved ` +
    `from the lockfile`,
);
concludeGate("JavaScript licenses", report);
