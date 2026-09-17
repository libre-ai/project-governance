import { concludeGate, GateReport } from "./gate-report";

// Specification Lock, in two explicit modes — never inferred from what happens
// to exist on disk.
//
//   (no argument)          governance mode: assert the transverse G1 locks that
//                          live in this repository.
//   --apps <name...>       product-repository mode: assert those application
//                          specifications, wherever the caller runs.
//
// ADR-0020 (design §4.2) dispatched application specifications to their product
// repositories; ADR-0018 D3 had put the layer-2 surfaces under this lock. The
// previous version bridged the two by emptying its own list when `docs/apps/`
// was absent — which is what this repository became — and then printed
// `verified: 13`, the length of the list it had just discarded. Zero
// specifications were inspected and the gate was green with a count of thirteen.
// A mode the caller states cannot silently become a mode that asserts nothing.

const requiredSections = [
  "Purpose and actors",
  "Journeys",
  "Non-goals",
  "Domain protocol",
  "Refusal matrix",
  "Data",
  "Authentication and authorization",
  "Runtime boundaries",
  "Accessibility and degraded mode",
  "Contracts",
  "Evidence",
  "Work packages",
  "Release and rollback",
];

const argv = process.argv.slice(2);
const appsFlag = argv.indexOf("--apps");
const applications =
  appsFlag === -1 ? [] : argv.slice(appsFlag + 1).filter((a) => !a.startsWith("-"));

const report = new GateReport();

if (appsFlag !== -1 && applications.length === 0) {
  report.check("--apps", false, "the flag was given without naming a single specification");
}

for (const application of applications) {
  const path = `docs/apps/${application}.md`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    report.check(path, false, "missing application specification");
    continue;
  }
  const text = await file.text();
  const missingSections = requiredSections.filter((section) => !text.includes(`## ${section}`));
  const placeholder = /\b(?:TBD|TODO|FIXME)\b/i.test(text);
  const contractPath = text.includes("contracts/");
  // A refusal code is a dotted lowercase identifier in backticks; three distinct
  // ones is the G1 floor for a specification to have a usable failure surface.
  const refusalCodes = new Set(text.match(/`[a-z][a-z0-9-]*\.[a-z0-9_.-]+`/g) ?? []);

  const defects = [
    ...missingSections.map((section) => `missing section ${section}`),
    ...(placeholder ? ["unresolved placeholder"] : []),
    ...(contractPath ? [] : ["no canonical contract authority path"]),
    ...(refusalCodes.size < 3
      ? [`fewer than three stable refusal codes (${refusalCodes.size})`]
      : []),
  ];

  report.check(
    path,
    defects.length === 0,
    defects.length === 0
      ? `${requiredSections.length} sections, ${refusalCodes.size} refusal codes, contract path present`
      : defects.join("; "),
  );
}

// Transverse G1 locks. They live in this repository, so they are asserted only
// when the caller did not name application specifications.
if (appsFlag === -1) {
  const standardPath = "docs/specifications/SPECIFICATION-STANDARD.md";
  const standard = Bun.file(standardPath);
  report.check(
    standardPath,
    await standard.exists(),
    (await standard.exists()) ? "Specification Lock standard present" : "missing",
  );

  const queuePath = "docs/specifications/DECISION-QUEUE.md";
  const queue = Bun.file(queuePath);
  if (!(await queue.exists())) {
    report.check(queuePath, false, "missing G1 decision queue");
  } else {
    const text = await queue.text();
    const missingQuestions = [1, 2, 3, 4, 5].filter((n) => !text.includes(`## Q${n} —`));
    const accepted = (text.match(/\*\*Status:\*\* accepted\./g) ?? []).length;
    const defects = [
      ...(text.includes("**Status:** closed") ? [] : ["queue is not closed"]),
      ...missingQuestions.map((n) => `missing Q${n}`),
      ...(accepted === 5 ? [] : [`${accepted} of 5 decisions accepted`]),
    ];
    report.check(
      queuePath,
      defects.length === 0,
      defects.length === 0 ? "closed, Q1–Q5 present and accepted" : defects.join("; "),
    );
  }
}

concludeGate("Specification lock", report);
