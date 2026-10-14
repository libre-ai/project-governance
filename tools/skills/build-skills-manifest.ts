// Skills distribution manifest (ADR-0050 D7, option A) — generator and gate.
//
// The collection is distributed as a Claude Code plugin marketplace whose one
// plugin entry has this repository's root as its source and lists the admitted
// skills explicitly. The listing is what makes the manifest exact: a
// `plugin.json` `skills` key only ADDS to the default `skills/` scan, while a
// marketplace entry whose source is the marketplace root, with `strict: false`
// and an explicit `skills` list, loads exactly those directories (measured on
// 2026-10-14 with Claude Code 2.1.296: an entry listing 2 of the 8 skills
// installed with an inventory of exactly those 2).
//
// `version` is deliberately absent from the entry: without one, the installed
// version is the commit sha, so an install follows the served branch instead
// of staying on a hand-bumped string that nobody bumps.
//
// `bun tools/skills/build-skills-manifest.ts` writes the manifest;
// `--check` (wired into `bun run check`) fails when the committed manifest is
// not the one the collection generates, and names the skills on either side.

import { existsSync } from "node:fs";
import { concludeGate, GateReport } from "../quality/gate-report";

export const SKILLS_ROOT = "skills";
export const MANIFEST_PATH = ".claude-plugin/marketplace.json";
export const MARKETPLACE_NAME = "libre-ai";
export const PLUGIN_NAME = "libre-ai-skills";

export interface MarketplaceManifest {
  readonly name: string;
  readonly description: string;
  readonly owner: { readonly name: string };
  readonly plugins: readonly {
    readonly name: string;
    readonly source: string;
    readonly description: string;
    readonly strict: boolean;
    readonly skills: readonly string[];
  }[];
}

/** Pure: the manifest the admitted skills generate, in a stable order. */
export function buildSkillsManifest(skillDirs: readonly string[]): MarketplaceManifest {
  const sorted = [...new Set(skillDirs)].sort();
  return {
    name: MARKETPLACE_NAME,
    description: "Skills collection governed by libre-ai/project-governance (ADR-0025, ADR-0050).",
    owner: { name: "Libre AI contributors" },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: "./",
        description:
          "The admitted skills of libre-ai/project-governance, generated from skills/ — exactly the collection, nothing else of the repository.",
        strict: false,
        skills: sorted.map((dir) => `./${SKILLS_ROOT}/${dir}`),
      },
    ],
  };
}

export function renderSkillsManifest(manifest: MarketplaceManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** The skill directories a committed manifest lists, or why it cannot be read. */
export function listedSkills(
  text: string,
): { ok: true; dirs: string[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `not valid JSON (${message})` };
  }
  const plugins = (parsed as { plugins?: unknown }).plugins;
  const entry = Array.isArray(plugins)
    ? (plugins.find((plugin) => (plugin as { name?: unknown }).name === PLUGIN_NAME) as
        | { skills?: unknown }
        | undefined)
    : undefined;
  if (!entry || !Array.isArray(entry.skills)) {
    return { ok: false, reason: `no "${PLUGIN_NAME}" entry with a "skills" list` };
  }
  const prefix = `./${SKILLS_ROOT}/`;
  return {
    ok: true,
    dirs: entry.skills.map((path) =>
      typeof path === "string" && path.startsWith(prefix)
        ? path.slice(prefix.length)
        : String(path),
    ),
  };
}

/** Pure verdict: the committed manifest against the collection. */
export function evaluateSkillsManifest(
  collection: readonly string[],
  committed: string | null,
): GateReport {
  const report = new GateReport();
  const expected = renderSkillsManifest(buildSkillsManifest(collection));
  if (committed === null) {
    report.check(
      MANIFEST_PATH,
      false,
      `absent — generate it with \`bun tools/skills/build-skills-manifest.ts\``,
    );
    return report;
  }
  const listed = listedSkills(committed);
  if (!listed.ok) {
    report.check(MANIFEST_PATH, false, `unreadable: ${listed.reason}`);
    return report;
  }
  const inCollection = new Set(collection);
  const inManifest = new Set(listed.dirs);
  const missing = [...inCollection].filter((dir) => !inManifest.has(dir)).sort();
  const extra = [...inManifest].filter((dir) => !inCollection.has(dir)).sort();
  report.volume(
    `${inCollection.size} skill(s) in ${SKILLS_ROOT}/, ${listed.dirs.length} listed in ${MANIFEST_PATH}`,
  );
  report.check(
    `${MANIFEST_PATH} — skills = collection`,
    missing.length === 0 && extra.length === 0,
    missing.length === 0 && extra.length === 0
      ? `${inCollection.size} skill(s) listed, exactly the collection`
      : `missing from the manifest: ${missing.join(", ") || "none"}; listed but not admitted: ${extra.join(", ") || "none"}`,
  );
  report.check(
    `${MANIFEST_PATH} — generated form`,
    committed === expected,
    committed === expected
      ? "byte-identical to the generated manifest"
      : "differs from the generated manifest — regenerate it with `bun tools/skills/build-skills-manifest.ts`",
  );
  return report;
}

async function collectionDirs(): Promise<string[]> {
  const dirs: string[] = [];
  for await (const path of new Bun.Glob("*/SKILL.md").scan({ cwd: SKILLS_ROOT, onlyFiles: true })) {
    const dir = path.split("/")[0];
    if (dir) dirs.push(dir);
  }
  return dirs.sort();
}

if (import.meta.main) {
  const dirs = await collectionDirs();
  if (process.argv.includes("--check")) {
    const committed = existsSync(MANIFEST_PATH) ? await Bun.file(MANIFEST_PATH).text() : null;
    concludeGate("Skills manifest (D7-A)", evaluateSkillsManifest(dirs, committed));
  } else {
    await Bun.write(MANIFEST_PATH, renderSkillsManifest(buildSkillsManifest(dirs)));
    console.log(`Generated ${MANIFEST_PATH}: ${dirs.length} skill(s).`);
  }
}
