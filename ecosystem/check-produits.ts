import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { concludeGate } from "../tools/quality/gate-report";
import type { EntryKind } from "./briques";
import { gitEnvironment, readBriquesInput } from "./check-briques";
import {
  type CatalogueEntry,
  evaluateProduits,
  HOSTED_OFFERS_PATH,
  PRODUITS_ROOT,
  type ProduitsInput,
  parseCatalogueTable,
  type ReadResult,
  reconcileCatalogue,
  SCHEMA_PATH,
} from "./produits";

/**
 * Product-catalogue gate (`bun run check:produits`).
 *
 * The effectful half of `produits.ts`: it reads the index of the repository,
 * the catalogue of ADR-0042 §1 and the repository inventory, hands them to
 * `evaluateProduits`, prints the counters and exits non-zero on any violation.
 * It never goes to the network.
 *
 * ONE READER PER SOURCE. The inventory, what the index says a path is and the
 * list of files whose working copy is not the indexed content come from the
 * reader of the brick-map gate (`readBriquesInput`). Only what that reader
 * does not give is read here: the paths under `ecosystem/produits/`, the
 * schema, the list of hosted offers, and the domain of each product.
 *
 * ONE CATALOGUE, TWO READERS, HELD TOGETHER. The decision record is read by
 * the reader of the brick map and by the stricter reader of this gate, which
 * refuses any line of the table it does not read in full. Two parsers of one
 * record end up counting two catalogues, so `reconcileCatalogue` fails the
 * gate on any product one reads and the other does not.
 *
 * THE SCHEMA IS THE ONE OF THE TREE JUDGED. It is read here, from the same
 * root as the fiches, and handed to the evaluation as a text: unreadable, it
 * is a failure the gate names with its counters, not an exception thrown
 * while the module loads.
 *
 * THE INDEX, NOT THE DISK. A fiche is a tracked regular file; a link is
 * refused and an untracked file is not part of the catalogue. Its content is
 * read on disk, so a fiche whose working copy differs from the index is
 * refused: locally, stage what you changed before running the gate.
 *
 * THE HOSTED OFFERS ARE A LIST IN DATA. Which products may carry `offre` is
 * read from `ecosystem/hosted-offers.v1.yaml`, as a text the evaluation
 * parses: no identifier is written in the code, and an unreadable list is a
 * named failure, not an empty one.
 *
 * THE SOURCES ARE HELD TO THE SAME RULE. The decision record, the inventory,
 * the schema and the list of hosted offers are read on disk too. Each one is
 * declared with what the index says it is, and the evaluation refuses a
 * source that is not a tracked
 * regular file: a tracked symbolic link was followed, and a file removed from
 * the index was read, both attested « as indexed » (review of 2026-11-15, C2
 * and C4).
 *
 * THE REPOSITORY IS THE ONE THE GATE IS RUN IN. Every git child runs without
 * the variables that redirect git (`gitEnvironment`): with `GIT_DIR` set by a
 * hook, the gate listed another index and was green on it (same review, C8).
 */

const REPOSITORIES = "ecosystem/repositories.v1.yaml";
const CATALOGUE_ADR_PREFIX = "docs/adr/0042-";

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] || error.name : String(error);
}

function kindOfMode(mode: string): EntryKind {
  if (mode === "120000") return "link";
  return mode === "100644" || mode === "100755" ? "file" : "other";
}

/**
 * The tracked paths of the catalogue, relative to its root; the root itself is `.`.
 *
 * One entry per path. An unmerged path has up to three records in the index
 * (stages 1 to 3) and no single content: it is returned once, as `unmerged`,
 * so that the paths the gate counts are the paths git tracks.
 */
function trackedEntries(root: string): { entries: CatalogueEntry[]; error: string | null } {
  let listing: string;
  try {
    listing = execFileSync("git", ["ls-files", "--stage", "-z", "--", PRODUITS_ROOT], {
      encoding: "utf8",
      cwd: root,
      env: gitEnvironment(),
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    return { entries: [], error: reasonOf(error) };
  }
  const kinds = new Map<string, CatalogueEntry["kind"]>();
  for (const record of listing.split("\0")) {
    // `<mode> <object> <stage>\t<path>`
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const [mode = "", , stage = ""] = record.slice(0, tab).split(" ");
    const tracked = record.slice(tab + 1);
    const path = tracked === PRODUITS_ROOT ? "." : tracked.slice(PRODUITS_ROOT.length + 1);
    kinds.set(path, stage === "0" && !kinds.has(path) ? kindOfMode(mode) : "unmerged");
  }
  return {
    entries: [...kinds]
      .map(([path, kind]): CatalogueEntry => ({ path, kind }))
      .sort((left, right) => left.path.localeCompare(right.path, "en")),
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
function readProduitsInput(root: string): ProduitsInput {
  const shared = readBriquesInput(root);
  const tracked = trackedEntries(root);
  // The decision record the shared reader took the catalogue from; absent from
  // its sources when no file, or more than one, carries the number.
  const cataloguePath = shared.doctrineSources.find((path) =>
    path.startsWith(CATALOGUE_ADR_PREFIX),
  );
  const adr = cataloguePath === undefined ? null : readFile(join(root, cataloguePath));
  const table = parseCatalogueTable(adr?.ok === true ? adr.text : "");
  const reconciled = reconcileCatalogue(table, shared.catalogue);
  return {
    entries: tracked.entries,
    listingError: tracked.error,
    read: (path) => readFile(join(root, PRODUITS_ROOT, path)),
    schema: readFile(join(root, SCHEMA_PATH)),
    offresHebergees: readFile(join(root, HOSTED_OFFERS_PATH)),
    catalogue: reconciled.catalogue,
    domaines: table.domains,
    catalogueUnread: reconciled.unread,
    repositories: shared.repositories,
    unstaged: shared.unstaged,
    sources: [
      REPOSITORIES,
      SCHEMA_PATH,
      HOSTED_OFFERS_PATH,
      ...(cataloguePath === undefined ? [] : [cataloguePath]),
    ].map((path) => ({ path, standing: shared.localTarget(path) })),
  };
}

if (import.meta.main) {
  const outcome = evaluateProduits(readProduitsInput(process.cwd()));
  // A red run prints only its violations: say the volume they were found in.
  if (outcome.report.violations.length > 0) {
    console.error(`Product catalogue volume: ${outcome.volume}`);
  }
  concludeGate("Product catalogue", outcome.report);
}
