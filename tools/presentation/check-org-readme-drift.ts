/**
 * Org profile README drift gate (Domain I, Process & CI — chantier 3).
 *
 * `render-org-readme.ts` computes the organization profile's status section
 * from the committed fleet-status projection, but nothing verified that
 * `libre-ai/.github`'s published `profile/README.md` still carries what a
 * fresh computation would produce today — the two live in different
 * repositories, and `ecosystem/repositories.v1.yaml` or any project card can
 * change without anyone touching the other one.
 *
 * The gate reads the live README back and fails when it diverges from a
 * section rendered from the LIVE cards (never from a committed
 * intermediate). Since 2026-09-07 it also fails when the committed
 * projection `ecosystem/projections/fleet-status.v1.json` lags those same
 * live cards: that file is what `render-org-readme.ts` renders from and what
 * `libre-ai/website` ships as a pinned git-dep, and a stale copy made the
 * gate's own remedy ("run render-org-readme.ts and paste") re-render the
 * already-published, already-wrong section byte for byte. Two named
 * failures, two named commands: regenerate the projection with
 * `bun ecosystem/render-fleet-status.ts`, re-render the section with
 * `bun tools/presentation/render-org-readme.ts`.
 *
 * The heal path (`heal-org-readme.ts`) shares `readLiveState` so it splices
 * exactly the section this gate compares against, never a third rendering.
 * Failure surfaces through docs/method/AGENTIC-LOOP-INVENTORY.md's
 * "Contrôle de dérive périodique" — silence is indistinguishable from
 * correctness unless something checks.
 */

import type { PublicBrandProjection } from "../../brand/build-public-projection";
import { parseFleet } from "../../ecosystem/check-fleet-presentation";
import { STATUS_SECTION_BEGIN, STATUS_SECTION_END } from "../../ecosystem/project-cards";
import { buildFleetStatus, type FleetStatus } from "../../ecosystem/render-fleet-status";
import {
  BRAND_INTRO_BEGIN,
  BRAND_INTRO_END,
  type BrandLanguage,
  renderOrgBrandIntro,
} from "./render-org-brand-intro";
import { renderOrgSection, summarizeMigration } from "./render-org-readme";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Compares the live `.github` README against a freshly rendered section.
 * Mirrors `project-cards.ts`'s `checkStatusSection` sentinel discipline: one
 * declared pair of sentinels, byte-identical content between them.
 */
export function checkOrgReadmeDrift(liveReadme: string, freshSection: string): string[] {
  const beginCount = countOccurrences(liveReadme, STATUS_SECTION_BEGIN);
  const endCount = countOccurrences(liveReadme, STATUS_SECTION_END);
  if (beginCount === 0 || endCount === 0) {
    return [
      ".github profile/README.md: generated project-status section missing (sentinels not found)",
    ];
  }
  if (beginCount > 1 || endCount > 1) {
    return [
      ".github profile/README.md: section statut dupliquée — une seule paire de sentinelles est admise",
    ];
  }
  const begin = liveReadme.indexOf(STATUS_SECTION_BEGIN);
  const end = liveReadme.indexOf(STATUS_SECTION_END);
  const committed = liveReadme.slice(begin, end + STATUS_SECTION_END.length);
  if (committed !== freshSection) {
    return [
      ".github profile/README.md: the published status section diverges from a fresh render of " +
        "ecosystem/repositories.v1.yaml — run `bun tools/presentation/render-org-readme.ts` and " +
        "paste the result between the sentinels",
    ];
  }
  return [];
}

export function checkOrgBrandIntroDrift(
  liveReadme: string,
  freshIntro: string,
  language: BrandLanguage,
): string[] {
  const beginCount = countOccurrences(liveReadme, BRAND_INTRO_BEGIN);
  const endCount = countOccurrences(liveReadme, BRAND_INTRO_END);
  const path = language === "en" ? "profile/README.md" : "profile/README.fr.md";
  if (beginCount === 0 || endCount === 0) {
    return [`.github ${path}: generated brand introduction missing (sentinels not found)`];
  }
  if (beginCount > 1 || endCount > 1) {
    return [`.github ${path}: introduction de marque dupliquée — une seule paire est admise`];
  }
  const begin = liveReadme.indexOf(BRAND_INTRO_BEGIN);
  const end = liveReadme.indexOf(BRAND_INTRO_END);
  const committed = liveReadme.slice(begin, end + BRAND_INTRO_END.length);
  if (committed !== freshIntro) {
    return [`.github ${path}: the published brand introduction diverges from a fresh render`];
  }
  return [];
}

/**
 * Compares the committed projection against the projection the live cards
 * produce right now. Row-by-row so the failure names the repositories that
 * moved, not just "differs".
 */
export function checkProjectionFreshness(committed: FleetStatus, live: FleetStatus): string[] {
  const committedByRepository = new Map(committed.rows.map((r) => [r.repository, r]));
  const liveByRepository = new Map(live.rows.map((r) => [r.repository, r]));
  const stale: string[] = [];
  for (const [repository, liveRow] of liveByRepository) {
    const committedRow = committedByRepository.get(repository);
    if (committedRow === undefined || JSON.stringify(committedRow) !== JSON.stringify(liveRow)) {
      stale.push(repository);
    }
  }
  for (const repository of committedByRepository.keys()) {
    if (!liveByRepository.has(repository)) stale.push(repository);
  }
  if (stale.length === 0 && committed.rows.length === live.rows.length) return [];
  return [
    `ecosystem/projections/fleet-status.v1.json lags the live project cards (${stale.sort().join(", ")}) — ` +
      "run `bun ecosystem/render-fleet-status.ts` and commit the result; render-org-readme.ts and " +
      "libre-ai/website both read this file",
  ];
}

// ---------------------------------------------------------------------------
// Live state (network I/O — not unit-tested; the comparisons above are)

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

export interface LiveState {
  readonly readme: string;
  readonly frenchReadme: string;
  readonly freshSection: string;
  readonly freshEnglishIntro: string;
  readonly freshFrenchIntro: string;
  readonly liveStatus: FleetStatus;
  readonly committedStatus: FleetStatus;
}

export interface LiveStateFailure {
  readonly unreadable: readonly string[];
}

/**
 * Everything the gate and the heal compare: the published README, the
 * section the live cards render to, and both projections. One reader, so
 * the two callers cannot disagree on what "fresh" means.
 */
export async function readLiveState(): Promise<LiveState | LiveStateFailure> {
  const unreadable: string[] = [];
  const fleet = parseFleet(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const yamlApi = (Bun as unknown as { YAML: { parse(text: string): unknown } }).YAML;
  const cards: unknown[] = [];
  for (const entry of fleet) {
    if (entry.card === undefined) continue;
    const text = fetchFromGitHub(entry.repository, entry.card);
    if (text === null) {
      unreadable.push(`${entry.repository}: declared card ${entry.card} is unreadable at main`);
      continue;
    }
    cards.push(yamlApi.parse(text));
  }

  const migrationText = fetchFromGitHub("libre-ai/libre-ai", "ecosystem/migration-index.v1.yaml");
  if (migrationText === null) unreadable.push("libre-ai/libre-ai: migration index unreadable");
  const readme = fetchFromGitHub("libre-ai/.github", "profile/README.md");
  if (readme === null) unreadable.push("libre-ai/.github: profile/README.md unreadable");
  const frenchReadme = fetchFromGitHub("libre-ai/.github", "profile/README.fr.md");
  if (frenchReadme === null) unreadable.push("libre-ai/.github: profile/README.fr.md unreadable");
  if (migrationText === null || readme === null || frenchReadme === null || unreadable.length > 0) {
    return { unreadable };
  }

  const liveStatus = buildFleetStatus(cards);
  const committedStatus = (await Bun.file(
    new URL("../../ecosystem/projections/fleet-status.v1.json", import.meta.url),
  ).json()) as FleetStatus;
  const brandProjection = (await Bun.file(
    new URL("../../brand/projections/public-brand.v1.json", import.meta.url),
  ).json()) as PublicBrandProjection;
  return {
    readme,
    frenchReadme,
    freshSection: renderOrgSection(liveStatus, summarizeMigration(migrationText)),
    freshEnglishIntro: renderOrgBrandIntro(brandProjection, "en"),
    freshFrenchIntro: renderOrgBrandIntro(brandProjection, "fr"),
    liveStatus,
    committedStatus,
  };
}

export function isLiveState(state: LiveState | LiveStateFailure): state is LiveState {
  return "readme" in state;
}

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("../quality/gate-report");
  const report = new GateReport();
  const state = await readLiveState();

  if (!isLiveState(state)) {
    for (const failure of state.unreadable) report.check("live state", false, failure);
  } else {
    const projectionDrift = checkProjectionFreshness(state.committedStatus, state.liveStatus);
    if (projectionDrift.length === 0) {
      report.check(
        "fleet-status projection",
        true,
        `ecosystem/projections/fleet-status.v1.json matches the live cards (${state.liveStatus.rows.length} rows)`,
      );
    } else {
      for (const failure of projectionDrift)
        report.check("fleet-status projection", false, failure);
    }

    const drift = checkOrgReadmeDrift(state.readme, state.freshSection);
    if (drift.length === 0) {
      report.check(
        "org readme drift",
        true,
        `libre-ai/.github profile/README.md matches a fresh render (${state.liveStatus.rows.length} rows)`,
      );
    } else {
      for (const failure of drift) report.check("org readme drift", false, failure);
    }

    for (const failure of checkOrgBrandIntroDrift(state.readme, state.freshEnglishIntro, "en")) {
      report.check("org brand intro drift", false, failure);
    }
    for (const failure of checkOrgBrandIntroDrift(
      state.frenchReadme,
      state.freshFrenchIntro,
      "fr",
    )) {
      report.check("org brand intro drift", false, failure);
    }
  }
  concludeGate("Org README drift", report);
}
