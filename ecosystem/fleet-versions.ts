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
  /** Products the catalogue does not know, or that could not be held to it: their path is not judged. */
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

  const parsed = input.cards.map((source) => ({ source, parsed: parse(source) }));
  const cards = parsed.flatMap((entry) => (entry.parsed.ok ? [entry.parsed.card] : []));

  // Every phase of every card read, by `repository#phase`.
  const phases = new Map<string, VersionedPhase>();
  for (const card of cards) {
    for (const phase of card.phases) phases.set(`${card.repository}#${phase.id}`, phase);
  }

  const known = (id: string): boolean => catalogue.ok && catalogue.ids.has(id);
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
    const problems: string[] = [];

    const declared = card.products ?? [];
    productsDeclared += declared.length;
    const tree = input.trees.get(card.repository);
    for (const product of declared) {
      if (!known(product.id)) {
        unknown += 1;
        problems.push(`products ${product.id} is not a fiche of the catalogue`);
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
      let waiting = false;
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
      if (!known(phase.product)) {
        problems.push(
          `phase ${phase.id} is a version of ${phase.product}, which is not a fiche of the catalogue`,
        );
      }
      if (isDone(phase)) done += 1;
      else if (waiting) blocked += 1;
      else {
        readyCount += 1;
        ready.push(`${card.repository}#${phase.id} (${phase.product})`);
      }
    }

    report.check(
      card.repository,
      problems.length === 0,
      problems.length === 0
        ? `${declared.length} product(s) with code, ${card.phases.filter((phase) => phase.product !== undefined).length} version(s)`
        : problems.join("; "),
    );
  }

  // Who consumes whom, from the dependencies of the cards read.
  const consumers = new Map<string, string[]>();
  for (const card of cards) consumers.set(card.repository, []);
  for (const card of cards) {
    for (const dependency of card.dependencies) {
      const list = consumers.get(dependency.on);
      if (list !== undefined && !list.includes(card.repository)) list.push(card.repository);
    }
  }
  const withoutConsumer = [...consumers]
    .filter(([, list]) => list.length === 0)
    .map(([repository]) => repository)
    .sort();

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
  };
  const c = compteurs;
  const volume =
    `${c.cards_declared} card(s) declared = ${c.cards_read} read + ${c.cards_unreadable} unreadable; ` +
    `${c.products_declared} product(s) with code = ${c.products_verified} verified + ${c.products_path_absent} path absent + ${c.products_tree_unreadable} tree unreadable + ${c.products_unknown} not in the catalogue; ` +
    `${c.phases} phase(s) = ${c.versions} version(s) + ${c.foundation_phases} of the foundation; ` +
    `${c.versions} version(s) = ${c.versions_done} done + ${c.versions_ready} ready + ${c.versions_blocked} blocked; ` +
    `${c.dependencies} dependency(ies) between phases = ${c.dependencies_resolved} resolved + ${c.dependencies_unresolved} unresolved; ` +
    `consumption: ${cards.length - withoutConsumer.length} card(s) with a consumer + ${withoutConsumer.length} without = ${cards.length}`;
  report.volume(volume);
  return { report, compteurs, volume, ready, consumers, withoutConsumer };
}
