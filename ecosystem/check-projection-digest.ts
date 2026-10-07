/**
 * Cross-implementation agreement on the committed knowledge projection.
 *
 * Two checks guard `ecosystem/projections/public.v1.json`, and they are not
 * redundant:
 *
 *   - `check:projection` runs the Rust engine's `ecosystem-project --check`,
 *     which proves the committed bytes REPRODUCE from `ecosystem/objects`;
 *   - this gate loads the same file through a TypeScript reader whose
 *     canonicalisation and SHA-256 were written independently of the engine,
 *     and fails if the recomputed selection digest disagrees with the one the
 *     file carries.
 *
 * A single implementation that agrees with itself proves determinism, not
 * correctness: a canonicalisation bug would reproduce faithfully and stay
 * invisible. Two implementations in two languages have to agree, which is what
 * this gate buys. The reader came from the retired `knowledge` brick, whose own
 * documentation said the engine owns ingestion and it only validates the
 * generated projection — that division is what makes the second opinion
 * independent rather than circular.
 */
import { concludeGate, GateReport } from "../tools/quality/gate-report";
import { loadCanonicalKnowledgeProjection } from "./knowledge-projection";

const report = new GateReport();

let objectCount = 0;
let indexedCount = 0;
try {
  // The loader validates against both schemas, recomputes the digest and
  // refuses a mismatch, then returns the frozen projection with its index.
  const { projection, index } = await loadCanonicalKnowledgeProjection();
  objectCount = projection.objects.length;
  indexedCount = index.all().length;
  const digest = projection.selectionDigest;
  report.check(
    "selection digest",
    true,
    `recomputed independently and agrees with the committed value (${digest.slice(0, 12)}…)`,
  );
} catch (error) {
  report.check("selection digest", false, (error as Error).message);
}

// A gate that asserted nothing fails: an empty projection would otherwise
// validate trivially and report success.
report.check(
  "selected objects",
  objectCount > 0,
  objectCount > 0
    ? `${objectCount} selected object(s) in the committed projection`
    : "the committed projection selects no object — nothing was verified",
);

// The index is built from the same objects and refuses a duplicate id, so a
// count that disagrees with the projection would mean the reader and the file
// no longer describe the same set.
report.check(
  "index agrees with the projection",
  indexedCount === objectCount,
  `${indexedCount} indexed against ${objectCount} selected`,
);

concludeGate("Knowledge projection digest", report);
