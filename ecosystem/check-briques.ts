import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
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
 * index says what an entry is without following anything.
 *
 * THE CONTENT IS THE INDEXED ONE, OR THE FILE IS REFUSED. The index gives the
 * names and the modes; the bytes are read on disk. Every file this gate reads
 * — the map, the proof targets, the doctrine sources — is therefore compared
 * to its indexed blob by content (`git hash-object`), not by timestamps: a
 * file corrected on disk and not staged was judged green on a content git does
 * not track (second review, G1), and a comparison by `git diff-files` refused
 * a file whose bytes had not changed (third review, H1). On a CI checkout the
 * two agree. Locally, stage what you changed before running the gate.
 */

const CITATIONS_CONFIG = "tools/quality/pinned-citations.v1.json";
const CATALOGUE_ADR = "0042";
const INVARIANTS = "docs/decisions/INVARIANTS.md";
const REGISTER = "docs/decisions/DECISION-REGISTER.md";
const REPOSITORIES = "ecosystem/repositories.v1.yaml";
const SCHEMA = "ecosystem/schemas/brique.v1.schema.json";
const ADR_DIRECTORY = "docs/adr/";

interface IndexEntry {
  readonly mode: string;
  readonly object: string;
  /** True when the path has unmerged stages: there is no single indexed content. */
  readonly conflicted: boolean;
}

function kindOfMode(mode: string): EntryKind {
  if (mode === "120000") return "link";
  return mode === "100644" || mode === "100755" ? "file" : "other";
}

function git(root: string, argv: readonly string[], input?: string): string {
  return execFileSync("git", [...argv], {
    encoding: "utf8",
    cwd: root,
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
  });
}

/** Tracked path to its index entry, for the whole repository. Null when git cannot list it. */
function trackedIndex(root: string): Map<string, IndexEntry> | null {
  let listing: string;
  try {
    listing = git(root, ["ls-files", "--stage", "-z"]);
  } catch {
    return null;
  }
  const index = new Map<string, IndexEntry>();
  for (const record of listing.split("\0")) {
    // `<mode> <object> <stage>\t<path>`
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const [mode = "", object = "", stage = ""] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    index.set(path, { mode, object, conflicted: stage !== "0" || index.has(path) });
  }
  return index;
}

/** The tracked entries of the map, relative to its root; the root itself is `.`. */
function entriesOf(index: ReadonlyMap<string, IndexEntry>): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const [path, entry] of index) {
    if (path === BRIQUES_ROOT) entries.push({ path: ".", kind: kindOfMode(entry.mode) });
    else if (path.startsWith(`${BRIQUES_ROOT}/`)) {
      entries.push({ path: path.slice(BRIQUES_ROOT.length + 1), kind: kindOfMode(entry.mode) });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

/**
 * Tracked regular files whose working copy is not the indexed content.
 *
 * A path is in the set when it is unmerged, when it is no longer a regular
 * file reached without crossing a symbolic link, or when the object git would
 * store for its bytes is not the indexed one. When git cannot hash, every
 * tracked path is in the set, so nothing passes.
 */
function differingPaths(root: string, index: ReadonlyMap<string, IndexEntry>): Set<string> {
  const differing = new Set<string>();
  const hashed: string[] = [];
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return new Set(index.keys());
  }
  for (const [path, entry] of index) {
    if (kindOfMode(entry.mode) !== "file") continue;
    // A name with a line break cannot be handed to `--stdin-paths`: refused.
    if (entry.conflicted || path.includes("\n")) {
      differing.add(path);
      continue;
    }
    try {
      const file = join(root, path);
      // `lstat`: a tracked file replaced by a link is not that file. `realpath`:
      // nor is a file reached through a directory that became a link.
      if (!lstatSync(file).isFile() || realpathSync(file) !== join(realRoot, path)) {
        differing.add(path);
        continue;
      }
    } catch {
      differing.add(path);
      continue;
    }
    hashed.push(path);
  }
  if (hashed.length === 0) return differing;
  let objects: string[];
  try {
    objects = git(root, ["hash-object", "--stdin-paths"], `${hashed.join("\n")}\n`)
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    return new Set(index.keys());
  }
  if (objects.length !== hashed.length) return new Set(index.keys());
  hashed.forEach((path, at) => {
    if (objects[at] !== index.get(path)?.object) differing.add(path);
  });
  return differing;
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
    return git(root, ["remote", "get-url", "origin"]).trim();
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
  const index = trackedIndex(root) ?? new Map<string, IndexEntry>();

  // The decision records are the tracked ones: an untracked `docs/adr/9999-x.md`
  // is not an ADR a brick may cite (G1).
  const adrFiles = [...index.keys()]
    .filter(
      (path) => path.startsWith(ADR_DIRECTORY) && !path.slice(ADR_DIRECTORY.length).includes("/"),
    )
    .map((path) => path.slice(ADR_DIRECTORY.length));
  const adrNumbers = new Set(
    adrFiles.flatMap((name) => /^([0-9]{4})-.+\.md$/.exec(name)?.[1] ?? []),
  );
  // Exactly one file may carry the catalogue: with two, the directory order
  // would choose which catalogue the gate reads.
  const catalogueFiles = adrFiles.filter((name) => name.startsWith(`${CATALOGUE_ADR}-`));
  const cataloguePath =
    catalogueFiles.length === 1 ? `${ADR_DIRECTORY}${catalogueFiles[0] as string}` : null;

  let repositories: unknown = null;
  try {
    repositories = Bun.YAML.parse(readOrNull(join(root, REPOSITORIES)) ?? "");
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
    const entry = index.get(path);
    if (entry === undefined) return "absent";
    const kind = kindOfMode(entry.mode);
    if (kind !== "file") return kind;
    try {
      return lstatSync(join(root, path)).size > 0 ? "regular" : "empty";
    } catch {
      return "absent";
    }
  };

  return {
    entries: entriesOf(index),
    read: (path) => readOrNull(join(root, BRIQUES_ROOT, path)),
    invariants: parseInvariants(readOrNull(join(root, INVARIANTS)) ?? ""),
    adrNumbers,
    registerDecisions: parseRegisterDecisions(readOrNull(join(root, REGISTER)) ?? ""),
    repositories: parseRepositories(repositories),
    catalogue: parseCatalogue(
      cataloguePath === null ? "" : (readOrNull(join(root, cataloguePath)) ?? ""),
    ),
    selfRepository: selfName === null ? null : `${citations.organization}/${selfName}`,
    localTarget,
    unstaged: differingPaths(root, index),
    doctrineSources: [
      INVARIANTS,
      REGISTER,
      REPOSITORIES,
      CITATIONS_CONFIG,
      SCHEMA,
      ...(cataloguePath === null ? [] : [cataloguePath]),
    ],
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
