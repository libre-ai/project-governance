export {};

const forbiddenLockfiles = new Set([
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const forbiddenSourceExtensions = [".js", ".jsx", ".mjs", ".cjs"];
const ignoredPrefixes = [".git/", ".tools/", "node_modules/", "target/", "dist/"];
const glob = new Bun.Glob("**/*");
const { concludeGate, GateReport } = await import("./gate-report");
const report = new GateReport();
let scanned = 0;

for await (const path of glob.scan({ cwd: ".", dot: true, onlyFiles: true })) {
  if (ignoredPrefixes.some((prefix) => path.startsWith(prefix))) continue;
  scanned += 1;
  const name = path.split("/").at(-1) ?? path;
  if (forbiddenLockfiles.has(name)) report.check(path, false, "forbidden lockfile");
  if (forbiddenSourceExtensions.some((extension) => path.endsWith(extension))) {
    report.check(path, false, "forbidden JavaScript source");
  }
}

// The scan is the assertion: the corpus size is part of the verdict.
if (report.violations.length === 0) {
  report.check(
    "source policy",
    scanned > 0,
    scanned > 0
      ? `${scanned} tracked files carry no forbidden lockfile nor JavaScript source`
      : "the corpus glob matched no file — the scan asserted nothing",
  );
}
concludeGate("Source policy", report);
