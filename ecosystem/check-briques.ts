import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { repositoryFromRemote, validateConfig } from "../tools/quality/check-pinned-citations";
import { concludeGate } from "../tools/quality/gate-report";
import {
  BRIQUES_ROOT,
  type BriquesInput,
  type BriquesOutcome,
  type EntryKind,
  evaluateBriques,
  parseCatalogue,
  parseInvariants,
  parseRegisterDecisions,
  parseRepositories,
  type TreeEntry,
} from "./briques";

/**
 * Brick-map gate (`bun run check:briques`, ADR-0064 D5).
 *
 * The effectful half of `briques.ts`: it reads the tree under
 * `ecosystem/briques/` and the doctrine files a brick cites, hands them to
 * `evaluateBriques`, prints the counters and exits non-zero on any violation.
 * It never goes to the network; proofs held by another repository are pinned
 * citations, resolved over git by the pinned-citations gate, and this gate
 * fails when that gate's scope does not list `ecosystem/briques/`.
 *
 * It reads the working tree, as `validate-cards` does: stage a new fiche or a
 * new proof target before trusting a local green, since CI sees only what is
 * committed (AGENTS.md).
 */

const CITATIONS_CONFIG = "tools/quality/pinned-citations.v1.json";
const CATALOGUE_ADR = "0042";

function kindOf(entry: {
  isSymbolicLink(): boolean;
  isFile(): boolean;
  isDirectory(): boolean;
}): EntryKind {
  // The link test comes first: readdir does not follow links, and a link to a
  // file must not be read as the file it points to.
  if (entry.isSymbolicLink()) return "link";
  if (entry.isFile()) return "file";
  if (entry.isDirectory()) return "directory";
  return "other";
}

/** Every entry under the briques root, at any depth, links not followed. */
function listEntries(root: string): TreeEntry[] {
  const base = join(root, BRIQUES_ROOT);
  if (!existsSync(base)) return [];
  const entries: TreeEntry[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(base, relative), { withFileTypes: true })) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const kind = kindOf(entry);
      entries.push({ path, kind });
      if (kind === "directory") walk(path);
    }
  };
  walk("");
  return entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Tomorrow in the local calendar: the tolerance `project-cards.ts` gives a dated evidence. */
function latestAcceptableIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function originOf(root: string): string | null {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Everything `evaluateBriques` needs, read from the tree at `root`.
 *
 * A doctrine source that cannot be read becomes an empty collection, which the
 * evaluation fails by name: unreadable is never zero.
 */
export function readBriquesInput(root: string): BriquesInput {
  const adrDirectory = join(root, "docs/adr");
  const adrFiles = existsSync(adrDirectory) ? readdirSync(adrDirectory) : [];
  const adrNumbers = new Set(
    adrFiles.flatMap((name) => /^([0-9]{4})-.+\.md$/.exec(name)?.[1] ?? []),
  );
  const catalogueFile = adrFiles.find((name) => name.startsWith(`${CATALOGUE_ADR}-`));

  let repositories: unknown = null;
  try {
    repositories = Bun.YAML.parse(readOrNull(join(root, "ecosystem/repositories.v1.yaml")) ?? "");
  } catch {
    repositories = null;
  }

  // The citations configuration is validated by its own gate's reader, so a
  // malformed file fails here the way it fails there; unreadable gives an empty
  // scope, which the evaluation refuses.
  let citations: BriquesInput["citations"] = { organization: "", scope: [] };
  try {
    const config = validateConfig(JSON.parse(readOrNull(join(root, CITATIONS_CONFIG)) ?? ""));
    citations = { organization: config.organization, scope: config.scope };
  } catch {
    citations = { organization: "", scope: [] };
  }

  const origin = originOf(root);
  const selfName = origin === null ? null : repositoryFromRemote(origin, citations.organization);

  return {
    entries: listEntries(root),
    read: (path) => readOrNull(join(root, BRIQUES_ROOT, path)),
    invariants: parseInvariants(readOrNull(join(root, "docs/decisions/INVARIANTS.md")) ?? ""),
    adrNumbers,
    registerDecisions: parseRegisterDecisions(
      readOrNull(join(root, "docs/decisions/DECISION-REGISTER.md")) ?? "",
    ),
    repositories: parseRepositories(repositories),
    catalogue: parseCatalogue(
      catalogueFile === undefined ? "" : (readOrNull(join(adrDirectory, catalogueFile)) ?? ""),
    ),
    selfRepository: selfName === null ? null : `${citations.organization}/${selfName}`,
    localTargetExists: (path) => existsSync(join(root, path)),
    citations,
    latestDate: latestAcceptableIso(),
  };
}

/** Read the tree at `root` and judge it. Shared with the page generator. */
export function checkBriques(root: string): BriquesOutcome {
  return evaluateBriques(readBriquesInput(root));
}

if (import.meta.main) {
  const outcome = checkBriques(process.cwd());
  // A red run prints only its violations: say the volume they were found in.
  if (outcome.report.violations.length > 0) console.error(`Brick map volume: ${outcome.volume}`);
  concludeGate("Brick map", outcome.report);
}
