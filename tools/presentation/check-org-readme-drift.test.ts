import { describe, expect, test } from "bun:test";
import { STATUS_SECTION_BEGIN, STATUS_SECTION_END } from "../../ecosystem/project-cards";
import type { FleetStatus, FleetStatusRow } from "../../ecosystem/render-fleet-status";
import {
  checkOrgBrandIntroDrift,
  checkOrgReadmeDrift,
  checkProjectionFreshness,
} from "./check-org-readme-drift";
import { BRAND_INTRO_BEGIN, BRAND_INTRO_END } from "./render-org-brand-intro";

const wrap = (body: string) => `${STATUS_SECTION_BEGIN}\n${body}\n${STATUS_SECTION_END}`;

const row = (overrides: Partial<FleetStatusRow> = {}): FleetStatusRow => ({
  repository: "libre-ai/radar",
  project: "radar",
  kind: "product",
  layer: "couche-1",
  summary: "Intelligence de flux locale.",
  display: "20 % du périmètre actuellement déclaré",
  maturity: "specified",
  confidence: "medium",
  exposure: "spec-published",
  last_verified_on: "2026-07-30",
  ...overrides,
});

const status = (rows: readonly FleetStatusRow[]): FleetStatus => ({
  schema_version: "libre-ai.fleet-status.v1",
  source: "project.v1.yaml cards at each repository main",
  rows,
});

// The committed projection is what `render-org-readme.ts` renders from and
// what the website ships as a pinned git-dep; the live cards are what this
// gate renders from. Measured 2026-09-07: the projection was last regenerated
// 2026-08-03 (35a1ae2), so the gate's own remedy — "run render-org-readme.ts
// and paste" — produced a section byte-identical to the one already published
// and fixed nothing. A stale projection must be its own named failure, with
// the command that actually regenerates it.
describe("checkProjectionFreshness", () => {
  test("a projection equal to the live computation is fresh", () => {
    expect(checkProjectionFreshness(status([row()]), status([row()]))).toEqual([]);
  });

  test("a projection lagging the live cards fails and names ecosystem/render-fleet-status.ts", () => {
    const committed = status([row()]);
    const live = status([row({ display: "8,3 % du périmètre actuellement déclaré" })]);
    const failures = checkProjectionFreshness(committed, live);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("bun ecosystem/render-fleet-status.ts");
    expect(failures[0]).toContain("libre-ai/radar");
  });

  test("a row present live but absent from the projection is drift too", () => {
    const committed = status([row()]);
    const live = status([row(), row({ repository: "libre-ai/notebook", project: "notebook" })]);
    const failures = checkProjectionFreshness(committed, live);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("libre-ai/notebook");
  });
});

describe("checkOrgReadmeDrift", () => {
  test("no drift when the live section is byte-identical to a fresh render", () => {
    const section = wrap("| Radar | ... |");
    const readme = `# Libre AI\n\nSome prose.\n\n${section}\n\nMore prose.\n`;
    expect(checkOrgReadmeDrift(readme, section)).toEqual([]);
  });

  test("fails named when the live section text diverges from a fresh render", () => {
    const live = `# Libre AI\n\n${wrap("| Radar | stale |")}\n`;
    const fresh = wrap("| Radar | fresh |");
    const failures = checkOrgReadmeDrift(live, fresh);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("diverges from a fresh render");
  });

  test("fails when the sentinels are absent from the live README", () => {
    const failures = checkOrgReadmeDrift("# Libre AI\n\nNo generated section here.\n", wrap("x"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("sentinels not found");
  });

  test("fails when the live README carries a duplicated sentinel pair", () => {
    const section = wrap("x");
    const live = `${section}\n\n${section}`;
    const failures = checkOrgReadmeDrift(live, section);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("dupliquée");
  });
});

describe("checkOrgBrandIntroDrift", () => {
  const fresh = `${BRAND_INTRO_BEGIN}\nFresh intro.\n${BRAND_INTRO_END}`;

  test("accepts one byte-identical introduction", () => {
    expect(checkOrgBrandIntroDrift(`# Libre AI\n\n${fresh}\n`, fresh, "fr")).toEqual([]);
  });

  test("rejects missing, duplicate and drifting introductions", () => {
    expect(checkOrgBrandIntroDrift("# Libre AI", fresh, "fr")[0]).toContain("missing");
    expect(checkOrgBrandIntroDrift(`${fresh}\n${fresh}`, fresh, "fr")[0]).toContain("dupliquée");
    expect(
      checkOrgBrandIntroDrift(`${BRAND_INTRO_BEGIN}\nStale.\n${BRAND_INTRO_END}`, fresh, "en")[0],
    ).toContain("diverges");
  });
});
