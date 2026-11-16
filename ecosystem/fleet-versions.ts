import { GateReport } from "../tools/quality/gate-report";
import type { TreeListing } from "./fleet-tree";
import { validateCard } from "./project-cards";

/**
 * Products with code, phases as versions, and who consumes whom, across the
 * fleet. Owner's choices of 2026-11-16, from options:
 *
 * - « Produit + chemin vérifié »: a card names, in `products`, the products of
 *   the catalogue it carries code for, each with the path of that code; the
 *   path is held to the tree of the served branch.
 * - « Phases = versions »: a phase with a `product` is a version of it, says
 *   what it `delivers`, and waits for the phases it names in `depends_on`.
 * - « Déduit de dependencies »: no field says who provides or consumes; the
 *   consumers of a repository are read by inverting `dependencies[].on`.
 *
 * WHAT THIS MODULE HOLDS. Everything pure: the rules, the counters and the
 * ready versions. `check-fleet-versions.ts` is the effectful half: it fetches
 * the cards and the trees, and reads the catalogue.
 *
 * WHAT IS NOT JUDGED HERE. The README status section and the rest of the
 * card's shape: `check-fleet-presentation.ts` judges them. A card the schema
 * refuses is unreadable for this gate, and named.
 */

/** A card as fetched at the served branch: its text, or why it could not be read. */
export interface CardSource {
  readonly repository: string;
  /** The text of the card; null when the fetch failed or the file is absent. */
  readonly text: string | null;
  /** Why the card could not be fetched; null when it was, or when it is absent. */
  readonly error: string | null;
}

export interface FleetVersionsInput {
  /** One entry per repository of the index that declares a card. */
  readonly cards: readonly CardSource[];
  /** The identifiers of the fiches of `ecosystem/produits/`, or why they could not be read. */
  readonly catalogue:
    | { readonly ok: true; readonly ids: ReadonlySet<string> }
    | { readonly ok: false; readonly reason: string };
  /** The tree of the served branch of each repository `repositoriesToList` names. */
  readonly trees: ReadonlyMap<string, TreeListing>;
  /** The repositories of the index that declare no card: counted, so the cards sum to the index. */
  readonly withoutCard: readonly string[];
}

interface Criterion {
  readonly status: "pending" | "accepted";
}

interface VersionedPhase {
  readonly id: string;
  readonly product?: string;
  readonly delivers?: string;
  readonly depends_on?: readonly string[];
  readonly exit_criteria: readonly Criterion[];
}

interface VersionedCard {
  readonly repository: string;
  readonly products?: readonly { readonly id: string; readonly code: string }[];
  readonly dependencies: readonly { readonly on: string }[];
  readonly phases: readonly VersionedPhase[];
}

interface FleetVersionsCounters {
  readonly cards_declared: number;
  readonly cards_read: number;
  readonly cards_unreadable: number;
  readonly products_declared: number;
  readonly products_verified: number;
  readonly products_path_absent: number;
  readonly products_tree_unreadable: number;
  /** Products the catalogue does not know, or not held to it because it is unreadable: their path is not judged. */
  readonly products_unknown: number;
  readonly phases: number;
  readonly versions: number;
  readonly foundation_phases: number;
  readonly versions_done: number;
  readonly versions_ready: number;
  readonly versions_blocked: number;
  readonly dependencies: number;
  readonly dependencies_resolved: number;
  readonly dependencies_unresolved: number;
  readonly index_repositories: number;
  readonly index_without_card: number;
  /** Entries of `dependencies` of the cards read, by what they name. */
  readonly consumed_entries: number;
  readonly consumed_entries_on_a_card: number;
  /** A crate, a package, a repository without a card: not part of the consumption graph. */
  readonly consumed_entries_elsewhere: number;
  readonly cards_with_consumer: number;
  readonly cards_without_consumer: number;
}

export interface FleetVersionsOutcome {
  readonly report: GateReport;
  readonly compteurs: FleetVersionsCounters;
  readonly volume: string;
  /** `repository#phase (Pnn)` of each version ready to be worked on. */
  readonly ready: readonly string[];
  /** Repository to the repositories whose `dependencies` name it. */
  readonly consumers: ReadonlyMap<string, readonly string[]>;
  /** Repositories whose card no other card read names in its dependencies. */
  readonly withoutConsumer: readonly string[];
}

type Parsed =
  | { readonly ok: true; readonly card: VersionedCard }
  | { readonly ok: false; readonly reason: string };

function parse(source: CardSource): Parsed {
  if (source.error !== null) return { ok: false, reason: `card unreadable (${source.error})` };
  if (source.text === null) return { ok: false, reason: "card absent at the served branch" };
  let value: unknown;
  try {
    value = Bun.YAML.parse(source.text);
  } catch (error) {
    return {
      ok: false,
      reason: `card is not YAML (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  const errors = validateCard(value);
  if (errors.length > 0) return { ok: false, reason: `card invalid (${errors.join("; ")})` };
  return { ok: true, card: value as VersionedCard };
}

/** Whether a path names a tracked file, or a directory that holds one. */
export function pathIsTracked(path: string, tracked: readonly string[]): boolean {
  return tracked.some((entry) => entry === path || entry.startsWith(`${path}/`));
}

/** The repositories whose valid card declares products: the trees the effectful half lists. */
export function repositoriesToList(cards: readonly CardSource[]): string[] {
  return cards.flatMap((source) => {
    const parsed = parse(source);
    return parsed.ok && (parsed.card.products?.length ?? 0) > 0 ? [source.repository] : [];
  });
}

const isDone = (phase: VersionedPhase): boolean =>
  phase.exit_criteria.every((criterion) => criterion.status === "accepted");

const FICHE_PATH = /^ecosystem\/produits\/(P[0-9]{2})\.v1\.yaml$/;

/**
 * The identifiers of the fiches, from the NUL-separated output of
 * `git ls-files -z -- ecosystem/produits`. A path that is not a fiche (the
 * README) is not an identifier; no fiche is an unreadable catalogue, not an
 * empty one.
 */
export function parseCatalogueListing(
  listing: string,
):
  | { readonly ok: true; readonly ids: ReadonlySet<string> }
  | { readonly ok: false; readonly reason: string } {
  const ids = new Set(
    listing.split("\0").flatMap((path) => {
      const id = FICHE_PATH.exec(path)?.[1];
      return id === undefined ? [] : [id];
    }),
  );
  return ids.size === 0
    ? { ok: false, reason: "no fiche tracked under ecosystem/produits/" }
    : { ok: true, ids };
}

/**
 * The phases that wait on themselves through `depends_on` (a dependency on
 * itself, or a cycle), each with the cycle that holds it. Such a phase can
 * never be ready: it is blocked, and named. The graph is small (a few dozen
 * phases), so each phase is walked on its own.
 */
function phasesOnACycle(phases: ReadonlyMap<string, VersionedPhase>): Map<string, string> {
  const result = new Map<string, string>();
  for (const start of phases.keys()) {
    const stack: { key: string; path: string[] }[] = [{ key: start, path: [start] }];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined) break;
      for (const target of phases.get(next.key)?.depends_on ?? []) {
        if (target === start) {
          result.set(start, [...next.path, start].join(" → "));
          stack.length = 0;
          break;
        }
        if (phases.has(target) && !visited.has(target)) {
          visited.add(target);
          stack.push({ key: target, path: [...next.path, target] });
        }
      }
    }
  }
  return result;
}

export function evaluateFleetVersions(input: FleetVersionsInput): FleetVersionsOutcome {
  const report = new GateReport();
  const catalogue = input.catalogue;
  report.check(
    "catalogue of products",
    catalogue.ok && catalogue.ids.size > 0,
    !catalogue.ok
      ? `unreadable (${catalogue.reason}) — no product can be held to the catalogue`
      : catalogue.ids.size === 0
        ? "no fiche read: an empty catalogue is not zero products"
        : `${catalogue.ids.size} fiche(s) read`,
  );
  if (input.cards.length === 0) {
    report.check(
      "fleet",
      false,
      "no card declared: an empty index is not a fleet without versions",
    );
  }

  // A card is keyed by the name the INDEX gives its repository, never by the
  // `repository` the card declares: a card that named another repository would
  // otherwise replace that repository's phases, make a version ready on a phase
  // that is not done, and print its line under the other name (review of
  // 2026-11-16, finding 1). A declared name that differs is a violation.
  const parsed = input.cards.map((source) => ({ source, parsed: parse(source) }));
  const cards = parsed.flatMap((entry) =>
    entry.parsed.ok ? [{ repository: entry.source.repository, card: entry.parsed.card }] : [],
  );

  // Every phase of every card read, by `repository#phase`. A phase identifier
  // written twice in a card is refused below, and the first one is the target.
  const phases = new Map<string, VersionedPhase>();
  for (const { repository, card } of cards) {
    for (const phase of card.phases) {
      const key = `${repository}#${phase.id}`;
      if (!phases.has(key)) phases.set(key, phase);
    }
  }
  const onCycle = phasesOnACycle(phases);

  const known = (id: string): boolean => catalogue.ok && catalogue.ids.has(id);
  const unheld = (what: string): string =>
    catalogue.ok
      ? `${what}, which is not a fiche of the catalogue`
      : `${what}, which cannot be held to the catalogue: it is unreadable`;
  let productsDeclared = 0;
  let verified = 0;
  let absent = 0;
  let treeUnreadable = 0;
  let unknown = 0;
  let versions = 0;
  let done = 0;
  let readyCount = 0;
  let blocked = 0;
  let dependencies = 0;
  let resolved = 0;
  let unresolved = 0;
  let phaseCount = 0;
  const ready: string[] = [];

  for (const { source, parsed: result } of parsed) {
    if (!result.ok) {
      report.check(source.repository, false, result.reason);
      continue;
    }
    const card = result.card;
    const repository = source.repository;
    const problems: string[] = [];
    if (card.repository !== repository) {
      problems.push(
        `the card declares repository ${card.repository}, the index names ${repository}: the card is read as ${repository}`,
      );
    }
    const seen = new Set<string>();
    for (const phase of card.phases) {
      if (seen.has(phase.id)) problems.push(`phase ${phase.id} is declared twice`);
      seen.add(phase.id);
    }

    const declared = card.products ?? [];
    productsDeclared += declared.length;
    const tree = input.trees.get(repository);
    for (const product of declared) {
      if (!known(product.id)) {
        unknown += 1;
        problems.push(unheld(`products ${product.id}`));
      } else if (tree === undefined) {
        treeUnreadable += 1;
        problems.push(
          `the tree of the served branch was not listed, so ${product.code} is not verified`,
        );
      } else if (tree.kind === "unreadable") {
        treeUnreadable += 1;
        problems.push(
          `the tree of the served branch is unreadable (${tree.reason}), so ${product.code} is not verified`,
        );
      } else if (pathIsTracked(product.code, tree.paths)) {
        verified += 1;
      } else {
        absent += 1;
        problems.push(
          `products ${product.id} names ${product.code}, which the served branch does not track`,
        );
      }
    }

    for (const phase of card.phases) {
      phaseCount += 1;
      const key = `${repository}#${phase.id}`;
      let waiting = onCycle.has(key);
      if (onCycle.has(key)) {
        problems.push(
          `phase ${phase.id} waits on itself through its dependencies (${onCycle.get(key)}): it can never be ready`,
        );
      }
      for (const target of phase.depends_on ?? []) {
        dependencies += 1;
        const targetPhase = phases.get(target);
        if (targetPhase === undefined) {
          unresolved += 1;
          waiting = true;
          problems.push(`phase ${phase.id} depends on ${target}, which no card read declares`);
        } else {
          resolved += 1;
          if (!isDone(targetPhase)) waiting = true;
        }
      }
      if (phase.product === undefined) continue;
      versions += 1;
      // A version of a product the catalogue does not hold is not ready: its
      // definition is not complete.
      if (!known(phase.product)) {
        waiting = true;
        problems.push(unheld(`phase ${phase.id} is a version of ${phase.product}`));
      }
      if (isDone(phase)) done += 1;
      else if (waiting) blocked += 1;
      else {
        readyCount += 1;
        ready.push(`${key} (${phase.product})`);
      }
    }

    report.check(
      repository,
      problems.length === 0,
      problems.length === 0
        ? `${declared.length} product(s) with code, ${card.phases.filter((phase) => phase.product !== undefined).length} version(s)`
        : problems.join("; "),
    );
  }

  // Who consumes whom, from the dependencies of the cards read. An entry that
  // names something else than a card read (a crate, a package, a repository
  // without a card) is counted apart, never dropped.
  const consumers = new Map<string, string[]>();
  for (const { repository } of cards) consumers.set(repository, []);
  let consumedEntries = 0;
  let consumedOnACard = 0;
  for (const { repository, card } of cards) {
    for (const dependency of card.dependencies) {
      consumedEntries += 1;
      const list = consumers.get(dependency.on);
      if (list === undefined) continue;
      consumedOnACard += 1;
      if (!list.includes(repository)) list.push(repository);
    }
  }
  const withoutConsumer = [...consumers]
    .filter(([, list]) => list.length === 0)
    .map(([repository]) => repository)
    .sort();
  const withConsumer = [...consumers.values()].filter((list) => list.length > 0).length;

  const compteurs: FleetVersionsCounters = {
    cards_declared: input.cards.length,
    cards_read: cards.length,
    cards_unreadable: input.cards.length - cards.length,
    products_declared: productsDeclared,
    products_verified: verified,
    products_path_absent: absent,
    products_tree_unreadable: treeUnreadable,
    products_unknown: unknown,
    phases: phaseCount,
    versions,
    foundation_phases: phaseCount - versions,
    versions_done: done,
    versions_ready: readyCount,
    versions_blocked: blocked,
    dependencies,
    dependencies_resolved: resolved,
    dependencies_unresolved: unresolved,
    index_repositories: input.cards.length + input.withoutCard.length,
    index_without_card: input.withoutCard.length,
    consumed_entries: consumedEntries,
    consumed_entries_on_a_card: consumedOnACard,
    consumed_entries_elsewhere: consumedEntries - consumedOnACard,
    cards_with_consumer: withConsumer,
    cards_without_consumer: withoutConsumer.length,
  };
  const c = compteurs;
  const volume =
    `${c.index_repositories} repository(ies) in the index = ${c.cards_declared} declaring a card + ${c.index_without_card} without; ` +
    `${c.cards_declared} card(s) declared = ${c.cards_read} read + ${c.cards_unreadable} unreadable; ` +
    `${c.products_declared} product(s) with code = ${c.products_verified} verified + ${c.products_path_absent} path absent + ${c.products_tree_unreadable} tree unreadable + ${c.products_unknown} not held to the catalogue; ` +
    `${c.phases} phase(s) = ${c.versions} version(s) + ${c.foundation_phases} of the foundation; ` +
    `${c.versions} version(s) = ${c.versions_done} done + ${c.versions_ready} ready + ${c.versions_blocked} blocked; ` +
    `${c.dependencies} dependency(ies) between phases = ${c.dependencies_resolved} resolved + ${c.dependencies_unresolved} unresolved; ` +
    `${c.consumed_entries} dependency entry(ies) of the cards read = ${c.consumed_entries_on_a_card} on a card read + ${c.consumed_entries_elsewhere} elsewhere; ` +
    `consumption: ${c.cards_with_consumer} card(s) with a consumer + ${c.cards_without_consumer} without = ${c.cards_read}`;
  report.volume(volume);
  return { report, compteurs, volume, ready, consumers, withoutConsumer };
}
