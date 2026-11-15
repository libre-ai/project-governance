import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { concludeGate } from "../tools/quality/gate-report";
import type { EntryKind, TreeEntry } from "./briques";
import { readBriquesInput } from "./check-briques";
import {
  evaluateProduits,
  PRODUITS_ROOT,
  type ProduitsInput,
  type ProduitsOutcome,
  parseCatalogueDomains,
  type ReadResult,
} from "./produits";

/**
 * Product-catalogue gate (`bun run check:produits`).
 *
 * The effectful half of `produits.ts`: it reads the index of the repository,
 * the catalogue of ADR-0042 §1 and the repository inventory, hands them to
 * `evaluateProduits`, prints the counters and exits non-zero on any violation.
 * It never goes to the network.
 *
 * ONE READER PER SOURCE. The set of products, the inventory and the list of
 * files whose working copy is not the indexed content come from the reader of
 * the brick-map gate (`readBriquesInput`): two gates that read the same
 * decision record with two parsers would end up counting two catalogues. Only
 * what that reader does not give is read here: the entries under
 * `ecosystem/produits/` and the domain of each product.
 *
 * THE INDEX, NOT THE DISK. A fiche is a tracked regular file; a link is
 * refused and an untracked file is not part of the catalogue. Its content is
 * read on disk, so a fiche whose working copy differs from the index is
 * refused: locally, stage what you changed before running the gate.
 */

const SCHEMA = "ecosystem/schemas/produit.v1.schema.json";
const REPOSITORIES = "ecosystem/repositories.v1.yaml";
const CATALOGUE_ADR_PREFIX = "docs/adr/0042-";

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] || error.name : String(error);
}

function kindOfMode(mode: string): EntryKind {
  if (mode === "120000") return "link";
  return mode === "100644" || mode === "100755" ? "file" : "other";
}

/** The tracked entries of the catalogue, relative to its root; the root itself is `.`. */
function trackedEntries(root: string): { entries: TreeEntry[]; error: string | null } {
  let listing: string;
  try {
    listing = execFileSync("git", ["ls-files", "--stage", "-z", "--", PRODUITS_ROOT], {
      encoding: "utf8",
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    return { entries: [], error: reasonOf(error) };
  }
  const entries: TreeEntry[] = [];
  for (const record of listing.split("\0")) {
    // `<mode> <object> <stage>\t<path>`
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const mode = record.slice(0, record.indexOf(" "));
    const path = record.slice(tab + 1);
    entries.push({
      path: path === PRODUITS_ROOT ? "." : path.slice(PRODUITS_ROOT.length + 1),
      kind: kindOfMode(mode),
    });
  }
  return {
    entries: entries.sort((left, right) => left.path.localeCompare(right.path, "en")),
    error: null,
  };
}

function readFile(path: string): ReadResult {
  try {
    return { ok: true, text: readFileSync(path, "utf8") };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}

/**
 * Everything `evaluateProduits` needs, read from the tree at `root`.
 *
 * A source that cannot be read becomes an empty collection, which the
 * evaluation fails by name: unreadable is never zero.
 */
export function readProduitsInput(root: string): ProduitsInput {
  const shared = readBriquesInput(root);
  const tracked = trackedEntries(root);
  // The decision record the shared reader took the catalogue from; absent from
  // its sources when no file, or more than one, carries the number.
  const cataloguePath = shared.doctrineSources.find((path) =>
    path.startsWith(CATALOGUE_ADR_PREFIX),
  );
  const adr = cataloguePath === undefined ? null : readFile(join(root, cataloguePath));
  return {
    entries: tracked.entries,
    listingError: tracked.error,
    read: (path) => readFile(join(root, PRODUITS_ROOT, path)),
    catalogue: shared.catalogue,
    domaines: parseCatalogueDomains(adr?.ok === true ? adr.text : ""),
    repositories: shared.repositories,
    unstaged: shared.unstaged,
    sources: [REPOSITORIES, SCHEMA, ...(cataloguePath === undefined ? [] : [cataloguePath])],
  };
}

/** Read the tree at `root` and judge it. */
export function checkProduits(root: string): ProduitsOutcome {
  return evaluateProduits(readProduitsInput(root));
}

if (import.meta.main) {
  const outcome = checkProduits(process.cwd());
  // A red run prints only its violations: say the volume they were found in.
  if (outcome.report.violations.length > 0) {
    console.error(`Product catalogue volume: ${outcome.volume}`);
  }
  concludeGate("Product catalogue", outcome.report);
}
