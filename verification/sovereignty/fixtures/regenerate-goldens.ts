import { buildFixtureReportInputs } from "../fixtures";
import { buildSovereigntyReport, renderReportJson, renderReportMarkdown } from "../report";

/**
 * Regenerates the golden report fixtures after an INTENTIONAL format change:
 * `bun verification/sovereignty/fixtures/regenerate-goldens.ts`, then review
 * the diff before committing — a golden is a reviewed artifact, not an output
 * to rubber-stamp.
 */
const report = buildSovereigntyReport(buildFixtureReportInputs());
const here = new URL("./", import.meta.url);
await Bun.write(new URL("golden-report.json", here), renderReportJson(report));
await Bun.write(new URL("golden-report.md", here), renderReportMarkdown(report));
console.log("golden fixtures regenerated — review the diff before committing");
