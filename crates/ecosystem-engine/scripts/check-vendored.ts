/**
 * Byte-exact drift gates (I-05) for every vendored authority artefact this
 * crate embeds at compile time or reads in tests. Run with --write to
 * re-vendor after a pin bump.
 *
 * Two of the four original pairs are gone, not relaxed. Before the 2026-10-07
 * consolidation this crate lived in its own repository, so the knowledge-object
 * schema and the committed public projection had to be vendored from a
 * `@libre-ai/governance` pin under this gate. The crate now lives in the
 * repository that owns both files, and `src/graph.rs` and
 * `tests/public_projection.rs` read them directly from `ecosystem/`. A copy
 * that does not exist cannot drift, which is stronger than a copy a gate
 * watches — so those two pairs were retired with their vendored directories.
 *
 * The two that remain are genuine cross-repository pins: the Datalog authz
 * policies and the WIT world definitions belong to the contracts authority,
 * which is a different repository. They stay vendored and stay gated.
 *
 * A gate that asserts nothing fails: `total` is published and a run that
 * inspected zero files exits non-zero — per pair, not only overall — so an
 * emptied directory cannot pass silently behind a sibling that still has files.
 */
import { readdirSync, statSync } from "node:fs";

// Repository-root relative: this gate runs from the root like every other
// `check:*` of this repository, where `node_modules` is installed.
const CRATE = "crates/ecosystem-engine";

const PAIRS: ReadonlyArray<{ source: string; vendored: string }> = [
  {
    source: "node_modules/@libre-ai/contracts-authority/contracts/authz",
    vendored: `${CRATE}/vendored/authz`,
  },
  {
    source: "node_modules/@libre-ai/contracts-authority/contracts/wit",
    vendored: `${CRATE}/vendored/wit`,
  },
];

/**
 * Relative paths of every file under `root`, depth-first and sorted.
 *
 * The WIT pair was a dead branch before this: its entries are per-world
 * DIRECTORIES (`policy-core-v2/world.wit`, `.../SEMANTICS.md`), so a flat
 * `readdirSync` filtered on `.endsWith(".wit")` matched nothing and the pair
 * compared zero files while the gate still reported success from the Datalog
 * pair's count. Fourteen vendored files were unwatched. Walking recursively
 * and counting per pair is what makes the published total mean something.
 */
function walk(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(prefix === "" ? root : `${root}/${prefix}`).sort()) {
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(`${root}/${rel}`).isDirectory()) out.push(...walk(root, rel));
    else out.push(rel);
  }
  return out;
}
const write = process.argv.includes("--write");
const issues: string[] = [];
let total = 0;
for (const pair of PAIRS) {
  const wanted = walk(pair.vendored);
  let inPair = 0;
  for (const name of wanted) {
    total += 1;
    inPair += 1;
    const authority = Bun.file(`${pair.source}/${name}`);
    if (!(await authority.exists())) {
      issues.push(`${pair.vendored}/${name}: no counterpart in the authority pin`);
      continue;
    }
    const a = await authority.bytes();
    const v = await Bun.file(`${pair.vendored}/${name}`).bytes();
    if (Buffer.compare(Buffer.from(a), Buffer.from(v)) !== 0) {
      if (write) await Bun.write(`${pair.vendored}/${name}`, a);
      else issues.push(`${pair.vendored}/${name}: differs from the authority pin`);
    }
  }
  // Per-pair, not only overall: a pair emptied or renamed must fail even while
  // its sibling still has files to compare.
  if (inPair === 0) {
    issues.push(`${pair.vendored}: the gate found no file to compare in this pair`);
  }
}
if (issues.length > 0 && !write) {
  for (const issue of issues) console.error(issue);
  console.error("Vendored artefacts drift from their authority pins.");
  process.exit(1);
}
if (total === 0) {
  console.error(
    "Vendored drift gate inspected no file: a pair's directory is empty or its extension changed.",
  );
  process.exit(1);
}
console.log(`Vendored artefacts byte-exact against their authority pins (${total} files)`);
