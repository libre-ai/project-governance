import { concludeGate, GateReport } from "./gate-report";

// Three independent verifications live here, and the old success line counted
// only the first: `Objective files verified: 22` said nothing about the
// forbidden-statement scan or the vision corpus. A glob that stopped matching
// would have silenced two thirds of this gate without changing its output.
// Every verification now carries its own assertion, and a scan that inspected
// no file fails instead of passing quietly.

const requiredFiles = [
  "vision.md",
  "GOALS.md",
  "STATUS.md",
  "ROADMAP.md",
  "docs/decisions/DECISION-REGISTER.md",
  "docs/transformation/CLEANUP.md",
  "docs/transformation/G0-FREEZE-EVIDENCE.md",
  "docs/transformation/G0-CANONICAL-BOOTSTRAP.md",
  "docs/transformation/BIG-BANG.md",
  "docs/transformation/G1-WORK-PACKAGES.md",
  "docs/transformation/work-packages.v1.json",
  "docs/toolchain/BUN-QUALIFICATION.md",
  "docs/specifications/SPECIFICATION-STANDARD.md",
  "docs/specifications/DECISION-QUEUE.md",
  "docs/specifications/DATA-LIFECYCLE.md",
  "docs/specifications/IDENTITY-AUTHORIZATION.md",
  "docs/adr/0002-g1-cross-cutting-product-decisions.md",
  // contracts/catalog.v1.json and contracts/COMPATIBILITY.md moved to the
  // `contracts` authority repository (ADR-0020): its own gates require them.
  "prompts/00-cleanup.md",
  "prompts/01-specification-lock.md",
  "prompts/02-foundation-build.md",
  "prompts/03-parallel-reconstruction.md",
  "prompts/04-integration-cutover.md",
];
const forbiddenStatements = [
  "Forgejo",
  "migration progressive par produit",
  "portage produit par produit",
  "Dioxus actuel devient legacy",
];
const report = new GateReport();

for (const path of requiredFiles) {
  const exists = await Bun.file(path).exists();
  report.check(path, exists, exists ? "objective file present" : "missing objective file");
}

const glob = new Bun.Glob("**/*.{md,json,yaml,yml,toml,ts,tsx}");
const staleStatements: string[] = [];
let scanned = 0;
for await (const path of glob.scan({ cwd: ".", dot: true, onlyFiles: true })) {
  if (path === "tools/quality/check-objectives.ts") continue;
  if ([".git/", ".tools/", "node_modules/", "target/"].some((prefix) => path.startsWith(prefix))) {
    continue;
  }
  scanned += 1;
  const text = await Bun.file(path).text();
  for (const statement of forbiddenStatements) {
    if (text.toLowerCase().includes(statement.toLowerCase())) {
      staleStatements.push(`${path}: forbidden stale statement ${JSON.stringify(statement)}`);
    }
  }
}
// A scan that matched nothing proves nothing: the count is part of the verdict,
// not decoration.
report.check(
  "forbidden-statement scan",
  scanned > 0 && staleStatements.length === 0,
  scanned === 0
    ? "the corpus glob matched no file — the scan asserted nothing"
    : staleStatements.length > 0
      ? staleStatements.join("; ")
      : `${scanned} tracked files carry none of the ${forbiddenStatements.length} stale statements`,
);

// Wave 0 (ADR-0009): vision.md is decomposed by authority; the anchored
// decisions live across the durable vision and its authority documents.
const visionCorpus = (
  await Promise.all(
    [
      "vision.md",
      "docs/architecture/DETAILED-TARGET.md",
      "docs/architecture/TOOLCHAIN.md",
      "docs/transformation/PROGRAM.md",
    ].map((path) => Bun.file(path).text()),
  )
).join("\n");
for (const decision of [
  "migration Big Bang",
  "GitHub et collaboration canoniques",
  "configuration est volontairement différée",
  "Bun fullstack",
  "Rust spécialisé",
]) {
  const anchored = visionCorpus.includes(decision);
  report.check(
    `vision corpus: ${decision}`,
    anchored,
    anchored ? "anchored in the vision corpus" : "missing from the vision corpus",
  );
}

concludeGate("Objectives", report);
