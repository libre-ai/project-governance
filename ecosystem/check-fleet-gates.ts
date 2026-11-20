import { concludeGate, GateReport } from "../tools/quality/gate-report";
import { discoverDetectors, printable, REGISTRY_PATH } from "./fleet-gates";

/**
 * Fleet detectors discovery
 * (`bun ecosystem/check-fleet-gates.ts <directory> [<registry>]`): the
 * effectful half of `fleet-gates.ts`. It lists the detectors of one directory
 * with their declaration, checks them against the registry
 * (`ecosystem/fleet-gates.v1.yaml` unless another file is named) both ways,
 * and prints the volume read. `bun run check:fleet-gates`, part of
 * `bun run check`, runs it on this repository's detectors directory,
 * `ecosystem/fleet-detectors/` (named 2026-11-19 with its first three
 * detectors); another directory can still be named on the command line.
 */

const [directory, registryPath = REGISTRY_PATH] = process.argv.slice(2);
if (directory === undefined || process.argv.length > 4) {
  console.error("usage: bun ecosystem/check-fleet-gates.ts <detectors-directory> [<registry>]");
  process.exit(2);
}

const found = await discoverDetectors(directory, registryPath);
const report = new GateReport();
if (found.ok) {
  for (const detector of found.detectors) {
    const target = detector.target === null ? "info" : String(detector.target);
    report.check(
      detector.id,
      true,
      `${detector.scope}, target ${target}, ${printable(detector.path)}`,
    );
  }
  const plural = found.registered === 1 ? "entry" : "entries";
  report.volume(
    `${found.examined} entries read: ${found.detectors.length} detector(s), ${found.ignored} other file(s), ${found.links} link(s), ${found.folders} folder(s); registry: ${found.registered} ${plural}, ${found.detectors.length} found`,
  );
} else {
  for (const error of found.errors) report.check("discovery", false, error);
}
concludeGate("Fleet detectors", report);
