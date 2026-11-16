import { concludeGate } from "../tools/quality/gate-report";
import {
  fetchFleetPresentationSources,
  type PresentationTarget,
  parseFleet,
} from "./check-fleet-presentation";
import { listTrackedPaths, type TreeListing } from "./fleet-tree";
import {
  type CardSource,
  evaluateFleetVersions,
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
 * identifiers of the fiches tracked under `ecosystem/produits/`, and, for each
 * card that declares products, the tree of its served branch. It prints the
 * ready versions and the cards no other card consumes, then the verdict and
 * its volume.
 */

/** The identifiers of the fiches git tracks: an untracked fiche is not part of the catalogue. */
function readCatalogue(): FleetVersionsInput["catalogue"] {
  const listing = Bun.spawnSync(["git", "ls-files", "-z", "--", "ecosystem/produits"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (listing.exitCode !== 0) {
    return { ok: false, reason: `git ls-files failed: ${listing.stderr.toString().trim()}` };
  }
  return parseCatalogueListing(listing.stdout.toString());
}

if (import.meta.main) {
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
  const outcome = evaluateFleetVersions({
    cards,
    catalogue: readCatalogue(),
    trees,
    withoutCard,
  });
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
