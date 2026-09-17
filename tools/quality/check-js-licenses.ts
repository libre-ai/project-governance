import { concludeGate, GateReport } from "./gate-report";

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
  } else if (!allowed.has(manifest.license)) {
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
concludeGate("JavaScript licenses", report);
