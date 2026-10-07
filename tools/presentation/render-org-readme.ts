/**
 * Org profile README table renderer (γ 3.6, design §6.4).
 *
 * Renders the « état des projets » table of `.github/profile/README.md` from
 * the fleet-status projection joined with the migration index — the hub row
 * always states its dismantling progress (removed/total paths), never its
 * lifecycle alone. The output lives between the project-status sentinels and
 * is never hand-edited.
 *
 * The CLI reads the COMMITTED projection (`ecosystem/projections/
 * fleet-status.v1.json`) — the same file `libre-ai/website` ships — so its
 * output is only as fresh as that file. `check-org-readme-drift.ts` fails
 * named when the projection lags the live cards (measured 2026-09-07: a
 * projection last regenerated 2026-08-03 made this CLI reproduce the
 * already-published section byte for byte). Regenerate first with
 * `bun ecosystem/render-fleet-status.ts`, then render.
 *
 * Usage: bun tools/presentation/render-org-readme.ts   (prints the section)
 */
import { STATUS_SECTION_BEGIN, STATUS_SECTION_END } from "../../ecosystem/project-cards";
import type { FleetStatus } from "../../ecosystem/render-fleet-status";

const LAYER_LABEL: Record<string, string> = {
  "couche-1": "Produits (couche 1)",
  "couche-2": "Orchestration (couche 2)",
  "couche-3": "Briques structurantes (couche 3)",
  "couche-4": "Atelier (couche 4)",
  transverse: "Transverse",
  moyeu: "Moyeu",
};

/**
 * Heading and sentence for each lifecycle the migration index can carry.
 *
 * Both used to be decided separately — a ternary for the heading, a lookup for
 * the sentence — so a state present in one and absent from the other rendered
 * the raw machine token under the wrong title. Keeping them in one entry makes
 * that shape unrepresentable.
 */
const HUB_STATE_COPY: Record<string, { readonly heading: string; readonly label: string }> = {
  "dismantling-in-progress": { heading: "Moyeu en démantèlement", label: "en démantèlement" },
  archived: { heading: "Moyeu archivé", label: "archivé" },
};

export interface MigrationSummary {
  readonly total: number;
  readonly removed: number;
  readonly hub_state: string;
}

export function summarizeMigration(indexYaml: string): MigrationSummary {
  const document = (Bun as unknown as { YAML: { parse(t: string): unknown } }).YAML.parse(
    indexYaml,
  ) as {
    hub_state: string;
    entries: readonly { hub_removal_commit: string }[];
  };
  const removed = document.entries.filter((e) => e.hub_removal_commit !== "pending").length;
  return { total: document.entries.length, removed, hub_state: document.hub_state };
}

export function renderOrgSection(status: FleetStatus, migration: MigrationSummary): string {
  const lines: string[] = [
    STATUS_SECTION_BEGIN,
    "<!-- Section générée depuis les fiches project.v1.yaml de la constellation",
    "     (projection fleet-status) et l'index de migration du hub — ne pas éditer à la main. -->",
    "",
  ];
  let currentLayer = "";
  for (const row of status.rows) {
    if (row.layer !== currentLayer) {
      currentLayer = row.layer;
      lines.push(`### ${LAYER_LABEL[row.layer] ?? row.layer}`, "");
      lines.push("| Projet | Résumé | Avancement | Maturité | Vérifié le |");
      lines.push("| --- | --- | --- | --- | --- |");
    }
    lines.push(
      `| [${row.project}](https://github.com/${row.repository}) | ${row.summary} | ${row.display} | ${row.maturity} | ${row.last_verified_on} |`,
    );
  }
  // The landing page is French prose. A lifecycle nobody wrote copy for is a
  // gap in the shop window, not a value to print: fail rather than publish the
  // machine vocabulary to the public profile.
  const copy = HUB_STATE_COPY[migration.hub_state];
  if (copy === undefined) {
    throw new Error(
      `hub_state "${migration.hub_state}" has no French copy — add it to HUB_STATE_COPY before it reaches the organization profile`,
    );
  }
  lines.push(
    "",
    `### ${copy.heading}`,
    "",
    `Le hub historique [libre-ai/libre-ai](https://github.com/libre-ai/libre-ai) est ${copy.label} : ${migration.removed}/${migration.total} chemins tracés à l'index de migration ont quitté le hub (double présence tant que la preuve verte n'est pas faite à destination — jamais d'absence).`,
    "",
    STATUS_SECTION_END,
  );
  return lines.join("\n");
}

if (import.meta.main) {
  const status = (await Bun.file(
    new URL("../../ecosystem/projections/fleet-status.v1.json", import.meta.url),
  ).json()) as FleetStatus;
  // The hub stays the authority of the migration index while it is being
  // dismantled — read it there, never from this repository's frozen copy.
  const result = Bun.spawnSync([
    "gh",
    "api",
    "repos/libre-ai/libre-ai/contents/ecosystem/migration-index.v1.yaml?ref=main",
    "-H",
    "Accept: application/vnd.github.raw+json",
  ]);
  if (result.exitCode !== 0) {
    console.error("cannot read the hub migration index");
    process.exit(1);
  }
  const migrationYaml = new TextDecoder().decode(result.stdout);
  console.log(renderOrgSection(status, summarizeMigration(migrationYaml)));
}
