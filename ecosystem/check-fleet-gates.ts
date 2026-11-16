import { concludeGate, GateReport } from "../tools/quality/gate-report";
import { discoverDetectors } from "./fleet-gates";

/**
 * Fleet detectors discovery (`bun ecosystem/check-fleet-gates.ts <directory>`):
 * the effectful half of `fleet-gates.ts`. It lists the detectors of one
 * directory with their declaration and prints the volume read. Not part of
 * `bun run check`: the directory of the detectors is the owner's to name.
 */

const directory = process.argv[2];
if (directory === undefined || process.argv.length !== 3) {
  console.error("usage: bun ecosystem/check-fleet-gates.ts <detectors-directory>");
  process.exit(2);
}

const found = await discoverDetectors(directory);
const report = new GateReport();
if (found.ok) {
  for (const detector of found.detectors) {
    const target = detector.target === null ? "info" : String(detector.target);
    report.check(detector.id, true, `${detector.scope}, target ${target}, ${detector.path}`);
  }
  report.volume(
    `${found.examined} entries read: ${found.detectors.length} detector(s), ${found.ignored} other file(s), ${found.links} link(s), ${found.folders} folder(s)`,
  );
} else {
  for (const error of found.errors) report.check("discovery", false, error);
}
concludeGate("Fleet detectors", report);
