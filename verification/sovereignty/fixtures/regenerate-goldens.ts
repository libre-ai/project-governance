import { buildFixtureReportInputs } from "../fixtures";
import { buildSovereigntyReport, renderReportJson, renderReportMarkdown } from "../report";

/**
 * Regenerates the golden report fixtures after an INTENTIONAL format change:
 * `bun verification/sovereignty/fixtures/regenerate-goldens.ts`, then review
 * the diff before committing — a golden is a reviewed artifact, not an output
 * to rubber-stamp.
 *
 * The `import.meta.main` guard is how this module says it is a command rather
 * than a library: nothing imports it, and the dead-code gate reads that
 * declaration instead of inferring the fact from the usage line above — a file
 * naming its own command line proves nothing about who runs it. Without the
 * guard, importing this module would also overwrite the goldens as a side
 * effect of the import.
 */
if (import.meta.main) {
  const report = buildSovereigntyReport(buildFixtureReportInputs());
  const here = new URL("./", import.meta.url);
  await Bun.write(new URL("golden-report.json", here), renderReportJson(report));
  await Bun.write(new URL("golden-report.md", here), renderReportMarkdown(report));
  console.log("golden fixtures regenerated — review the diff before committing");
}
