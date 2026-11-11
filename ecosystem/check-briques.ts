import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  exemptionKey,
  repositoryFromRemote,
  validateConfig,
} from "../tools/quality/check-pinned-citations";
import { concludeGate } from "../tools/quality/gate-report";
import {
  BRIQUES_ROOT,
  type BriquesInput,
  type BriquesOutcome,
  type EntryKind,
  evaluateBriques,
  type LocalTarget,
  parseCatalogue,
  parseInvariants,
  parseRegisterDecisions,
  parseRepositories,
  type TreeEntry,
} from "./briques";

/**
 * Brick-map gate (`bun run check:briques`, ADR-0064 D5).
 *
 * The effectful half of `briques.ts`: it reads the index of the repository and
 * the doctrine files a brick cites, hands them to `evaluateBriques`, prints
 * the counters and exits non-zero on any violation. It never goes to the
 * network; proofs held by another repository are pinned citations, resolved
 * over git by the pinned-citations gate.
 *
 * THE INDEX, NOT THE DISK. What is under `ecosystem/briques/`, and whether a
 * local proof target is a file, are both asked of `git ls-files --stage`. The
 * first version walked the directory and asked `existsSync`: a directory, a
 * symbolic link out of the tree, an untracked scratch file and
 * `node_modules/…` all « existed », and `ecosystem/briques` itself could be a
 * link the walk followed (review of 2026-11-11, F1 and F3). The mode of the
 * index says what an entry is without following anything. Stage a new fiche or
 * a new proof target before trusting a local run (AGENTS.md).
 */

const CITATIONS_CONFIG = "tools/quality/pinned-citations.v1.json";
const CATALOGUE_ADR = "0042";

function kindOfMode(mode: string): EntryKind {
  if (mode === "120000") return "link";
  return mode === "100644" || mode === "100755" ? "file" : "other";
}

/** Tracked path to git mode, for the whole repository. Null when git cannot list it. */
function trackedModes(root: string): Map<string, string> | null {
  let listing: string;
  try {
    listing = execFileSync("git", ["ls-files", "--stage", "-z"], {
      encoding: "utf8",
      cwd: root,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const modes = new Map<string, string>();
  for (const record of listing.split("\0")) {
    // `<mode> <object> <stage>\t<path>`
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    modes.set(record.slice(tab + 1), record.slice(0, 6));
  }
  return modes;
}

/** The tracked entries of the map, relative to its root; the root itself is `.`. */
function entriesOf(modes: ReadonlyMap<string, string>): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const [path, mode] of modes) {
    if (path === BRIQUES_ROOT) entries.push({ path: ".", kind: kindOfMode(mode) });
    else if (path.startsWith(`${BRIQUES_ROOT}/`)) {
      entries.push({ path: path.slice(BRIQUES_ROOT.length + 1), kind: kindOfMode(mode) });
    }
  }
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
 * A source that cannot be read becomes an empty collection, which the
 * evaluation fails by name: unreadable is never zero.
 */
export function readBriquesInput(root: string): BriquesInput {
  const modes = trackedModes(root) ?? new Map<string, string>();

  const adrDirectory = join(root, "docs/adr");
  const adrFiles = existsSync(adrDirectory) ? readdirSync(adrDirectory) : [];
  const adrNumbers = new Set(
    adrFiles.flatMap((name) => /^([0-9]{4})-.+\.md$/.exec(name)?.[1] ?? []),
  );
  // Exactly one file may carry the catalogue: with two, the directory order
  // would choose which catalogue the gate reads.
  const catalogueFiles = adrFiles.filter((name) => name.startsWith(`${CATALOGUE_ADR}-`));
  const catalogueText =
    catalogueFiles.length === 1
      ? (readOrNull(join(adrDirectory, catalogueFiles[0] as string)) ?? "")
      : "";

  let repositories: unknown = null;
  try {
    repositories = Bun.YAML.parse(readOrNull(join(root, "ecosystem/repositories.v1.yaml")) ?? "");
  } catch {
    repositories = null;
  }

  // The citations configuration is validated by its own gate's reader, so a
  // malformed file fails here the way it fails there; unreadable gives an empty
  // scope, which the evaluation refuses.
  let citations: BriquesInput["citations"] = {
    organization: "",
    scope: [],
    exemptions: new Set(),
  };
  try {
    const config = validateConfig(JSON.parse(readOrNull(join(root, CITATIONS_CONFIG)) ?? ""));
    citations = {
      organization: config.organization,
      scope: config.scope,
      exemptions: new Set(
        config.exemptions.map((exemption) => exemptionKey(exemption.file, exemption.citation)),
      ),
    };
  } catch {
    // Left empty: the evaluation names the configuration as the failing source.
  }

  const origin = originOf(root);
  const selfName = origin === null ? null : repositoryFromRemote(origin, citations.organization);

  const localTarget = (path: string): LocalTarget => {
    const mode = modes.get(path);
    if (mode === undefined) return "absent";
    const kind = kindOfMode(mode);
    if (kind !== "file") return kind;
    try {
      // Tracked and regular in the index; the working copy must still hold it.
      const stat = statSync(join(root, path));
      if (!stat.isFile()) return "other";
      return stat.size > 0 ? "regular" : "empty";
    } catch {
      return "absent";
    }
  };

  return {
    entries: entriesOf(modes),
    read: (path) => readOrNull(join(root, BRIQUES_ROOT, path)),
    invariants: parseInvariants(readOrNull(join(root, "docs/decisions/INVARIANTS.md")) ?? ""),
    adrNumbers,
    registerDecisions: parseRegisterDecisions(
      readOrNull(join(root, "docs/decisions/DECISION-REGISTER.md")) ?? "",
    ),
    repositories: parseRepositories(repositories),
    catalogue: parseCatalogue(catalogueText),
    selfRepository: selfName === null ? null : `${citations.organization}/${selfName}`,
    localTarget,
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
