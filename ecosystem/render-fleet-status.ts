/**
 * Fleet status projection (γ 3.6, design §6.4).
 *
 * Reads every card of the constellation (same fetch surface as the fleet
 * presentation gate) and emits `ecosystem/projections/fleet-status.v1.json`:
 * one row per carded repository with its computed progress display — the
 * single data source of the org README table and the website homepage. The
 * projection carries computed values only; no percentage is ever declared.
 *
 * Usage: bun ecosystem/render-fleet-status.ts   (writes the projection)
 */
import { aggregateProgress } from "./project-cards";

export interface FleetStatusRow {
  readonly repository: string;
  readonly project: string;
  readonly kind: string;
  readonly layer: string;
  readonly summary: string;
  readonly display: string;
  readonly maturity: string;
  readonly confidence: string;
  readonly exposure: string;
  readonly last_verified_on: string;
}

export interface FleetStatus {
  readonly schema_version: "libre-ai.fleet-status.v1";
  readonly source: "project.v1.yaml cards at each repository main";
  readonly rows: readonly FleetStatusRow[];
}

interface CardShape {
  readonly project: string;
  readonly repository: string;
  readonly kind: string;
  readonly layer: string;
  readonly summary: string;
  readonly maturity: string;
  readonly confidence: string;
  readonly exposure: string;
  readonly freshness: { readonly last_verified_on: string };
}

export function toRow(cardValue: unknown): FleetStatusRow {
  const card = cardValue as CardShape;
  const progress = aggregateProgress(cardValue);
  return {
    repository: card.repository,
    project: card.project,
    kind: card.kind,
    layer: card.layer,
    summary: card.summary,
    display: progress.display,
    maturity: card.maturity,
    confidence: card.confidence,
    exposure: card.exposure,
    last_verified_on: card.freshness.last_verified_on,
  };
}

const LAYER_ORDER = ["couche-1", "couche-2", "couche-3", "couche-4", "transverse", "moyeu"];

export function buildFleetStatus(cards: readonly unknown[]): FleetStatus {
  const rows = cards.map(toRow);
  rows.sort((a, b) => {
    const la = LAYER_ORDER.indexOf(a.layer);
    const lb = LAYER_ORDER.indexOf(b.layer);
    if (la !== lb) return la - lb;
    if (a.repository < b.repository) return -1;
    if (a.repository > b.repository) return 1;
    return 0;
  });
  return {
    schema_version: "libre-ai.fleet-status.v1",
    source: "project.v1.yaml cards at each repository main",
    rows,
  };
}

function fetchFromGitHub(repository: string, path: string): string | null {
  const result = Bun.spawnSync([
    "gh",
    "api",
    `repos/${repository}/contents/${path}?ref=main`,
    "-H",
    "Accept: application/vnd.github.raw+json",
  ]);
  if (result.exitCode !== 0) return null;
  return new TextDecoder().decode(result.stdout);
}

if (import.meta.main) {
  const { parseFleet } = await import("./check-fleet-presentation");
  const fleet = parseFleet(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const yamlApi = (Bun as unknown as { YAML: { parse(text: string): unknown } }).YAML;
  const cards: unknown[] = [];
  for (const entry of fleet) {
    if (entry.card === undefined) continue;
    const text = fetchFromGitHub(entry.repository, entry.card);
    if (text === null) {
      console.error(`::error::${entry.repository}: declared card ${entry.card} is unreadable`);
      process.exit(1);
    }
    cards.push(yamlApi.parse(text));
  }
  const projection = buildFleetStatus(cards);
  await Bun.write(
    new URL("projections/fleet-status.v1.json", import.meta.url),
    `${JSON.stringify(projection, null, 2)}\n`,
  );
  console.log(`wrote ecosystem/projections/fleet-status.v1.json (${projection.rows.length} rows)`);
}
