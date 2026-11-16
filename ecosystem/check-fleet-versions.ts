import { concludeGate } from "../tools/quality/gate-report";
import {
  fetchFleetPresentationSources,
  type PresentationTarget,
  parseFleet,
} from "./check-fleet-presentation";
import { listTrackedPaths, type TreeListing } from "./fleet-tree";
import {
  type CardSource,
  catalogueFromFiches,
  evaluateFleetVersions,
  type FicheSource,
  type FleetVersionsInput,
  parseCatalogueListing,
  repositoriesToList,
} from "./fleet-versions";

/**
 * Fleet versions gate (`bun run check:fleet-versions`): the effectful half of
 * `fleet-versions.ts`.
 *
 * It reads the cards of every repository of the index that declares one, at
 * its served branch (`HEAD:`, the fetcher of the fleet presentation gate), the
 * fiches tracked under `ecosystem/produits/` with the carrier each names in
 * `depot`, and, for each
 * card that declares products, the tree of its served branch. It prints the
 * ready versions and the cards no other card consumes, then the verdict and
 * its volume.
 */

/**
 * The fiches git tracks, each with its carrier: an untracked fiche is not part
 * of the catalogue.
 */
async function readCatalogue(): Promise<FleetVersionsInput["catalogue"]> {
  const listing = Bun.spawnSync(["git", "ls-files", "-z", "--", "ecosystem/produits"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (listing.exitCode !== 0) {
    return { ok: false, reason: `git ls-files failed: ${listing.stderr.toString().trim()}` };
  }
  const tracked = parseCatalogueListing(listing.stdout.toString());
  if (!tracked.ok) return tracked;
  const fiches: FicheSource[] = await Promise.all(
    [...tracked.ids].map(async (id) => {
      try {
        return { id, text: await Bun.file(`ecosystem/produits/${id}.v1.yaml`).text(), error: null };
      } catch (error) {
        return { id, text: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  return catalogueFromFiches(fiches);
}

/**
 * Everything the evaluation reads, from the index, the served branch of each
 * repository and the tracked fiches. Shared with the generator of the list of
 * products with code (`distribution/build-products-with-code.ts`), so the list
 * and this gate never read the fleet two different ways.
 */
export async function readFleetVersionsInput(): Promise<FleetVersionsInput> {
  const fleet = parseFleet(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const targets: PresentationTarget[] = fleet.flatMap((entry) =>
    entry.card === undefined ? [] : [{ repository: entry.repository, card: entry.card }],
  );
  const fetched = await fetchFleetPresentationSources(targets);
  const cards: CardSource[] = targets.map((target) => {
    const outcome = fetched.get(target.repository)?.card ?? {
      text: null,
      error: "no fetch outcome recorded for this repository",
    };
    return { repository: target.repository, text: outcome.text, error: outcome.error };
  });

  const trees = new Map<string, TreeListing>();
  for (const repository of repositoriesToList(cards)) {
    trees.set(repository, await listTrackedPaths(repository));
  }

  const withoutCard = fleet.flatMap((entry) =>
    entry.card === undefined ? [entry.repository] : [],
  );
  return { cards, catalogue: await readCatalogue(), trees, withoutCard };
}

if (import.meta.main) {
  const outcome = evaluateFleetVersions(await readFleetVersionsInput());
  console.log(
    `Fleet versions ready: ${outcome.ready.length === 0 ? "none" : outcome.ready.join(", ")}`,
  );
  console.log(
    `Fleet versions without a consumer (candidates, not failures): ${outcome.withoutConsumer.length === 0 ? "none" : outcome.withoutConsumer.join(", ")}`,
  );
  if (outcome.report.violations.length > 0)
    console.error(`Fleet versions volume: ${outcome.volume}`);
  concludeGate("Fleet versions", outcome.report);
}
